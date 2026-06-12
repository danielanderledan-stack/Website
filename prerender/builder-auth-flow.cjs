/* Customer auth + intent routing + billing for the site editor workflow.
   v3: gpt-oss-120b router classifies each message; $1 is charged ONLY when
   an edit actually happens (questions/major-requests are free; major work
   is referred to Dan on 0432 839 654).

   Run: node prerender/builder-auth-flow.cjs          (create everything)
        node prerender/builder-auth-flow.cjs update   (re-apply parameters)
        node prerender/builder-auth-flow.cjs migrate  (v2 -> v3 in-place)
*/
"use strict";
const fs = require("fs");
const path = require("path");
const { execFileSync } = require("child_process");

const WORKFLOW_ID = "HKIl5u3EycOQkW1t";
const TABLE = {
  __rl: true,
  value: "NJUM0H4anjWD9V7U",
  mode: "list",
  cachedResultName: "Customer",
  cachedResultUrl: "/projects/plQj1g7Jh5oWs2Nv/datatables/NJUM0H4anjWD9V7U",
};
const OR_CRED = { id: "a3JC3E3Sxx6KtLLv", name: "OpenRouter account 3" };
const ROUTER_MODEL = "openai/gpt-oss-120b";
const CREDIT_SECRET = "cd-credit-w7m2p9xk4fqz";
const EDIT_TOKEN = "cd-edit-9drx84kq2m"; // legacy per-site links keep working (unbilled)
const MSG_FEE = 1; // dollars per ACTIONED message
const DAN = "0432 839 654";

/* ---------------- account webhook (login / session / credit) ---------------- */

const CODE_CHECK_LOGIN = `
// Verifies number+password against the Customer table row (if any).
const body = $('Builder Webhook').first().json.body || {};
const row = $input.first().json || {};
const ok = !!(row.id !== undefined && row.Password && String(row.Password) === String(body.password || ''));
if (!ok) return [{ json: { ok: false, error: 'Wrong phone number or password.' } }];

let token;
try { token = crypto.randomUUID() + '-' + crypto.randomUUID(); }
catch (e) { token = Array.from({ length: 64 }, () => Math.floor(Math.random() * 16).toString(16)).join(''); }
const expiry = String(Date.now() + 7 * 24 * 3600 * 1000);

let history = [];
try { history = JSON.parse(row.message_history || '[]'); } catch (e) {}

return [{ json: {
  ok: true, token, expiry,
  rowId: row.id,
  number: row.Number,
  site: row.site || '',
  balance: parseFloat(row.account_balance || '0') || 0,
  history: history.slice(-40),
} }];
`.trim();

const CODE_LOGIN_REPLY = `
// Shape the login response (after the session row was saved).
const s = $('Check Login').first().json;
return [{ json: { ok: true, token: s.token, balance: s.balance, history: s.history, site: s.site, number: s.number } }];
`.trim();

const CODE_SESSION_REPLY = `
// Restores a session from its token.
const row = $input.first().json || {};
const valid = row.id !== undefined && Number(row.session_expiry || 0) > Date.now();
if (!valid) return [{ json: { ok: false, error: 'Session expired — please log in again.' } }];
let history = [];
try { history = JSON.parse(row.message_history || '[]'); } catch (e) {}
return [{ json: {
  ok: true,
  balance: parseFloat(row.account_balance || '0') || 0,
  history: history.slice(-40),
  site: row.site || '',
  number: row.Number,
} }];
`.trim();

const CODE_CREDIT_GUARD = `
// Auth + sanity for balance credits (called by the Vercel Square webhook).
const body = $('Builder Webhook').first().json.body || {};
if (body.secret !== '${CREDIT_SECRET}') throw new Error('bad credit secret');
const amount = Math.round(Number(body.amount) * 100) / 100;
if (!(amount >= 1 && amount <= 1000)) throw new Error('bad amount');
if (!body.number) throw new Error('no account number');
return [{ json: { number: String(body.number), amount } }];
`.trim();

const CODE_APPLY_CREDIT = `
const row = $input.first().json || {};
if (row.id === undefined) throw new Error('account not found');
const g = $('Credit Guard').first().json;
const balance = (parseFloat(row.account_balance || '0') || 0) + g.amount;
return [{ json: { rowId: row.id, newBalance: String(Math.round(balance * 100) / 100), balance: Math.round(balance * 100) / 100 } }];
`.trim();

const CODE_CREDIT_REPLY = `
return [{ json: { ok: true, balance: $('Apply Credit').first().json.balance } }];
`.trim();

/* ---------------- image gallery + swap (free) ---------------- */

const CODE_IMG_GUARD = `
// Session check for the image gallery.
const row = $input.first().json || {};
const valid = row.id !== undefined && Number(row.session_expiry || 0) > Date.now();
if (!valid) throw new Error('Session expired');
if (!row.site) throw new Error('No website linked to this account');
return [{ json: { site: row.site } }];
`.trim();

const CODE_DIR_ITEMS = `
// One item per image subfolder (e.g. assets/images/hvac). Always emits at
// least one item so the chain never dies on flat/empty layouts.
const dirs = $input.all().map((i) => i.json).filter((e) => e && e.type === 'dir');
if (!dirs.length) return [{ json: { path: 'assets/images' } }];
return dirs.map((d) => ({ json: { path: d.path } }));
`.trim();

const CODE_BUILD_IMAGE_LIST = `
// Collects every image found in assets/, deduped, with tokenized preview
// URLs (the repos are private; download_url carries a temporary token).
const seen = new Map();
const grab = (node) => {
  try {
    $(node).all().forEach((i) => {
      const e = i.json || {};
      if (e.type === 'file' && /\\.(jpe?g|png|webp|gif|svg)$/i.test(e.path || '')) {
        seen.set(e.path, { path: e.path, url: e.download_url || '' });
      }
    });
  } catch (err) {}
};
grab('List Img Root'); grab('List Img Sub'); grab('List Uploads');
return [{ json: { ok: true, images: [...seen.values()] } }];
`.trim();

const CODE_SWAP_GUARD = `
// Validates a swap request and prepares the binary for the commit.
const body = $('Builder Webhook').first().json.body || {};
const row = $input.first().json || {};
const valid = row.id !== undefined && Number(row.session_expiry || 0) > Date.now();
if (!valid) throw new Error('Session expired');
const path = String(body.path || '');
if (path.includes('..') || !/^assets\\/(images|uploads)\\/[A-Za-z0-9._-]+(\\/[A-Za-z0-9._-]+)*\\.(jpe?g|png|webp|gif|svg)$/i.test(path)) {
  throw new Error('Invalid image path');
}
const b64 = String(body.b64 || '');
if (!b64 || b64.length > 6 * 1024 * 1024) throw new Error('Image missing or too large (max ~4MB)');
const name = path.split('/').pop();
const ext = (name.split('.').pop() || 'jpg').toLowerCase();
const mime = { jpg: 'image/jpeg', jpeg: 'image/jpeg', png: 'image/png', webp: 'image/webp', gif: 'image/gif', svg: 'image/svg+xml' }[ext] || 'image/jpeg';
return [{ json: { site: row.site, path }, binary: { data: { data: b64, mimeType: mime, fileName: name } } }];
`.trim();

const CODE_SWAP_REPLY = `
return [{ json: { ok: true, path: $('Swap Guard').first().json.path } }];
`.trim();

/* ---------------- text editor (free, deterministic) ---------------- */

const PAGE_RE =
  "^(index|about\\\\/index|services\\\\/index|pricing\\\\/index|blog\\\\/index|contact\\\\/index|blog\\\\/\\\\d+\\\\/index)\\\\.html$";

const CODE_TEXTS_GUARD = `
// Session + page validation for text extraction.
const body = $('Builder Webhook').first().json.body || {};
const row = $input.first().json || {};
const valid = row.id !== undefined && Number(row.session_expiry || 0) > Date.now();
if (!valid) throw new Error('Session expired');
const page = String(body.page || 'index.html');
if (!new RegExp('${PAGE_RE}').test(page)) throw new Error('Invalid page');
return [{ json: { site: row.site, page } }];
`.trim();

const CODE_EXTRACT_TEXTS = `
// Pull every pure-text element out of the page. Each block carries its exact
// outer HTML as a relocation anchor + its occurrence index among identical
// matches, so edits can be spliced back deterministically.
const g = $('Texts Guard').first().json;
const html = Buffer.from($input.first().json.content, 'base64').toString('utf8');
const bodyStart = html.indexOf('<body');
const bodyHtml = bodyStart === -1 ? html : html.slice(bodyStart);

const re = /<(h[1-6]|p|a|button|span|li)\\b([^>]*)>([^<>]+)<\\/\\1>/g;
const dec = (s) => s.replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'");
const seen = {};
const blocks = [];
let m;
while ((m = re.exec(bodyHtml)) !== null) {
  const text = m[3];
  if (text.trim().length < 2) continue;
  if (/^[\\s\\d.,$%–—\\-]+$/.test(text)) continue; // pure numbers/punctuation (prices live in bigger context)
  const full = m[0];
  seen[full] = (seen[full] || 0) + 1;
  blocks.push({ tag: m[1], text: dec(text), find: full, occurrence: seen[full] });
}
return [{ json: { ok: true, page: g.page, blocks: blocks.slice(0, 200) } }];
`.trim();

const CODE_SAVE_GUARD = `
// Session + payload validation for text saves.
const body = $('Builder Webhook').first().json.body || {};
const row = $input.first().json || {};
const valid = row.id !== undefined && Number(row.session_expiry || 0) > Date.now();
if (!valid) throw new Error('Session expired');
const page = String(body.page || '');
if (!new RegExp('${PAGE_RE}').test(page)) throw new Error('Invalid page');
const edits = (Array.isArray(body.edits) ? body.edits : []).slice(0, 60);
if (!edits.length) throw new Error('No edits supplied');
return [{ json: { site: row.site, page, edits } }];
`.trim();

const CODE_APPLY_TEXTS = `
// Splices the edited text back into the page by exact-occurrence replacement.
// The find anchor is re-validated against the safe element shape, and the new
// text is entity-encoded — customers can change words, never inject markup.
const g = $('Save Guard').first().json;
let html = Buffer.from($input.first().json.content, 'base64').toString('utf8');
const elRe = /^<(h[1-6]|p|a|button|span|li)\\b([^>]*)>([^<>]+)<\\/\\1>$/;
const enc = (s) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

let applied = 0;
const failures = [];
for (const e of g.edits) {
  const find = String(e.find || '');
  const m = elRe.exec(find);
  if (!m) { failures.push('invalid block'); continue; }
  const newInner = enc(String(e.text || '')).slice(0, 2000);
  if (!newInner.trim()) { failures.push('empty text'); continue; }
  const replacement = '<' + m[1] + m[2] + '>' + newInner + '</' + m[1] + '>';
  let idx = -1;
  for (let k = 0; k < (Number(e.occurrence) || 1); k++) {
    idx = html.indexOf(find, idx + 1);
    if (idx === -1) break;
  }
  if (idx === -1) { failures.push('"' + m[3].slice(0, 40) + '": no longer found'); continue; }
  html = html.slice(0, idx) + replacement + html.slice(idx + find.length);
  // hero caption lives twice: the h1 AND the matching slide data-title
  if (m[2].includes('data-cd="hero-title"')) {
    html = html.split('data-title="' + m[3] + '"').join('data-title="' + newInner + '"');
  }
  applied++;
}
if (!applied) throw new Error('No edits could be applied: ' + failures.join('; '));
return [{ json: { site: g.site, page: g.page, content: html, applied, failures } }];
`.trim();

const CODE_TEXTS_REPLY = `
const a = $('Apply Texts').first().json;
return [{ json: { ok: true, applied: a.applied, failures: a.failures } }];
`.trim();

/* ---------------- colour editor (free, deterministic) ---------------- */

const CODE_COLOUR_GUARD = `
// Validates the two hex colours and derives rgb + hover (12% darker).
const body = $('Builder Webhook').first().json.body || {};
const row = $input.first().json || {};
const valid = row.id !== undefined && Number(row.session_expiry || 0) > Date.now();
if (!valid) throw new Error('Session expired');
const hexRe = /^#[0-9a-fA-F]{6}$/;
const primary = String(body.primary || '');
const secondary = String(body.secondary || '');
if (!hexRe.test(primary) || !hexRe.test(secondary)) throw new Error('Invalid colour');
const ch = (h, i) => parseInt(h.slice(1 + i * 2, 3 + i * 2), 16);
const rgb = ch(primary, 0) + ', ' + ch(primary, 1) + ', ' + ch(primary, 2);
const hover = '#' + [0, 1, 2].map((i) => Math.round(ch(primary, i) * 0.88).toString(16).padStart(2, '0')).join('');
return [{ json: { site: row.site, primary, secondary, rgb, hover } }];
`.trim();

const CODE_COLOUR_PAGES = `
// Page list from the site's sitemap (fallback: the standard set).
const g = $('Colour Guard').first().json;
let pages = ['index.html', 'about/index.html', 'services/index.html', 'pricing/index.html', 'blog/index.html', 'contact/index.html'];
try {
  const sm = Buffer.from($input.first().json.content, 'base64').toString('utf8');
  const urls = [...sm.matchAll(/<loc>([^<]+)<\\/loc>/g)].map((m) => String(m[1]).replace(/^https?:\\/\\/[^\\/]+/, ''));
  if (urls.length) pages = urls.map((p) => (p.replace(/^\\/+|\\/+$/g, '') ? p.replace(/^\\/+|\\/+$/g, '') + '/index.html' : 'index.html'));
} catch (e) {}
return pages.map((p) => ({ json: { path: p, site: g.site } }));
`.trim();

const CODE_APPLY_COLOURS = `
// Full re-theme. The pages contain the theme in TWO forms: the four CSS
// variables on <html>, and literal colour values React baked into inline
// styles at generation time (hex, rgb(), and bare r,g,b triples inside
// rgba()). We read each page's CURRENT colours from its own variables, then
// token-replace every literal form before swapping the variables themselves
// (tokens prevent chained replacements when old/new palettes overlap).
const g = $('Colour Guard').first().json;

const hexToRgbStr = (hex) => {
  const c = (i) => parseInt(hex.slice(1 + i * 2, 3 + i * 2), 16);
  return c(0) + ', ' + c(1) + ', ' + c(2);
};
const escRe = (s) => s.replace(/[.*+?^\\\${}()|[\\]\\\\]/g, '\\\\$&');

return $input.all().map((it) => {
  let html = Buffer.from(it.json.content, 'base64').toString('utf8');

  // current palette, read from the page itself
  const cur = (name) => {
    const m = html.match(new RegExp('--color-' + name + ':\\\\s*([^;"]+)'));
    return m ? m[1].trim() : null;
  };
  const oldPrimary = cur('primary');
  const oldHover = cur('primary-hover');
  const oldSecondary = cur('secondary');

  // [oldValue, token, newValue] — hex (any case), rgb(...) and bare triples
  const subs = [];
  const addColour = (oldHex, token, newHex) => {
    if (!oldHex || !/^#[0-9a-fA-F]{6}$/.test(oldHex)) return;
    const oldTriple = hexToRgbStr(oldHex);
    subs.push([oldHex, token + 'X', newHex]);
    subs.push(['rgb(' + oldTriple + ')', token + 'R', newHex]);
    subs.push([oldTriple, token + 'T', hexToRgbStr(newHex)]);
    subs.push([oldTriple.replace(/ /g, ''), token + 'N', hexToRgbStr(newHex)]);
  };
  addColour(oldPrimary, '@@P', g.primary);
  addColour(oldHover, '@@H', g.hover);
  addColour(oldSecondary, '@@S', g.secondary);

  // pass 1: old values -> unique tokens (case-insensitive for hex)
  for (const [oldV, token] of subs) {
    html = html.replace(new RegExp(escRe(oldV), 'gi'), token);
  }
  // pass 2: tokens -> new values
  for (const [, token, newV] of subs) {
    html = html.split(token).join(newV);
  }

  // canonical variables last (covers pages where extraction failed)
  html = html
    .replace(/--color-primary:\\s*[^;"]+/, '--color-primary: ' + g.primary)
    .replace(/--color-primary-rgb:\\s*[^;"]+/, '--color-primary-rgb: ' + g.rgb)
    .replace(/--color-primary-hover:\\s*[^;"]+/, '--color-primary-hover: ' + g.hover)
    .replace(/--color-secondary:\\s*[^;"]+/, '--color-secondary: ' + g.secondary);

  return { json: { path: it.json.path, content: html, site: g.site } };
});
`.trim();

const CODE_COLOURS_REPLY = `
return [{ json: { ok: true, pages: $('Apply Colours').all().length } }];
`.trim();

/* ---------------- site info (read: details/fonts/hours/announce/homepage) ----- */

const CODE_INFO_GUARD = `
// Session check for the combined site-info read.
const row = $input.first().json || {};
const valid = row.id !== undefined && Number(row.session_expiry || 0) > Date.now();
if (!valid) throw new Error('Session expired');
if (!row.site) throw new Error('No website linked to this account');
return [{ json: { site: row.site } }];
`.trim();

const CODE_EXTRACT_INFO = `
// One read serving the Details / Hours / Fonts / Banner tabs and the live
// preview. Everything is feature-detected from index.html — fields a site
// doesn't have come back null so the UI can hide those controls.
let homepage = '';
try { homepage = $('Get Repo Info').first().json.homepage || ''; } catch (e) {}
let html = '';
try { html = Buffer.from($('Get Index Info').first().json.content, 'base64').toString('utf8'); } catch (e) {}

// business details live canonically in the JSON-LD block
let ld = null;
const ldm = html.match(/<script id="cd-ldjson"[^>]*>([\\s\\S]*?)<\\/script>/);
if (ldm) { try { ld = JSON.parse(ldm[1]); } catch (e) {} }
let details = null, hours = null;
if (ld) {
  const addr = ld.address || {};
  const street = String(addr.streetAddress || '');
  let suburb = String(addr.addressLocality || '');
  if (!suburb) {
    const sm = street.match(/,\\s*([A-Za-z' ]+?)\\s+(?:VIC|NSW|QLD|SA|WA|TAS|NT|ACT)\\b/i);
    if (sm) suburb = sm[1].trim();
  }
  details = {
    name: String(ld.name || ''),
    phone: String(ld.telephone || ''),
    email: String(ld.email || ''),
    address: street,
    suburb,
  };
  if (Array.isArray(ld.openingHoursSpecification)) {
    hours = ld.openingHoursSpecification.map((h) => ({
      day: String(h.dayOfWeek || ''), opens: String(h.opens || ''), closes: String(h.closes || ''),
    }));
  }
}

// current font pairing, from the Google Fonts link + how the page uses each
// family (serif fallback = heading, sans-serif fallback = body)
let fonts = null;
const fl = html.match(/href="https:\\/\\/fonts\\.googleapis\\.com\\/css2\\?([^"]+)"/);
if (fl) {
  const fams = [...fl[1].matchAll(/family=([^:&]+)/g)].map((m) => decodeURIComponent(m[1]).replace(/\\+/g, ' '));
  const escRe = (s) => s.replace(/[.*+?^\\\${}()|[\\]\\\\]/g, '\\\\$&');
  let heading = null, body = null;
  for (const f of fams) {
    if (new RegExp(escRe(f) + '\\\\s*,\\\\s*serif').test(html)) heading = heading || f;
    else if (new RegExp(escRe(f) + '\\\\s*,\\\\s*sans-serif').test(html)) body = body || f;
  }
  if (fams.length >= 2) fonts = { heading: heading || fams[fams.length - 1], body: body || fams[0] };
}

// announcement bar state
const announce = { on: false, text: '', href: '' };
const am = html.match(/<div id="cd-announce"[^>]*>([\\s\\S]*?)<\\/div>/);
if (am) {
  announce.on = true;
  const lm = am[1].match(/<a [^>]*href="([^"]*)"/);
  if (lm) announce.href = lm[1];
  announce.text = am[1].replace(/<[^>]+>/g, ' ').replace(/&amp;/g, '&').replace(/\\s+/g, ' ').trim();
}

return [{ json: {
  ok: true, homepage, details, hours, fonts, announce,
  sectionsSupported: /<!-- =+ SECTION: /.test(html) || /<section[\\s>]/.test(html),
} }];
`.trim();

/* ---------------- sections (read, per page) ---------------- */

const CODE_SECTIONS_GUARD = `
// Session + page validation for the section list.
const body = $('Builder Webhook').first().json.body || {};
const row = $input.first().json || {};
const valid = row.id !== undefined && Number(row.session_expiry || 0) > Date.now();
if (!valid) throw new Error('Session expired');
const page = String(body.page || 'index.html');
if (!new RegExp('${PAGE_RE}').test(page)) throw new Error('Invalid page');
return [{ json: { site: row.site, page } }];
`.trim();

const CODE_EXTRACT_SECTIONS = `
// Sections come from the fuser's <!-- ===== SECTION: name ===== --> markers
// (a section runs to the next marker or the footer). Sites without markers
// fall back to depth-scanned top-level <section> elements.
const g = $('Sections Guard').first().json;
const html = Buffer.from($input.first().json.content, 'base64').toString('utf8');

const labelOf = (region, fallback) => {
  const h = region.match(/<h[1-3][^>]*>([^<]{2,90})</);
  if (h) return h[1].replace(/&amp;/g, '&').trim();
  return fallback.replace(/-/g, ' ').replace(/\\b\\w/g, (c) => c.toUpperCase()).trim();
};

const out = [];
const marks = [];
const mre = /<!-- =+ SECTION: ([a-z0-9-]+) =+ -->/g;
let m;
while ((m = mre.exec(html))) marks.push({ name: m[1], at: m.index, end: m.index + m[0].length });

if (marks.length) {
  const f = html.indexOf('<footer');
  const stop = f === -1 ? html.length : f;
  for (let i = 0; i < marks.length; i++) {
    const region = html.slice(marks[i].end, i + 1 < marks.length ? marks[i + 1].at : stop);
    const idm = region.match(/\\bid="([^"]+)"/);
    out.push({
      name: marks[i].name,
      label: labelOf(region, marks[i].name),
      hidden: /^\\s*<!-- cd-hide:/.test(region),
      anchor: idm ? idm[1] : '',
    });
  }
} else {
  // top-level <section> scan
  const tre = /<section\\b|<\\/section>/g;
  let depth = 0, start = -1, t, idx = 0;
  while ((t = tre.exec(html))) {
    if (t[0] === '<section') { if (depth === 0) start = t.index; depth++; }
    else if (depth > 0) {
      depth--;
      if (depth === 0) {
        const region = html.slice(start, t.index + 10);
        const idm = region.slice(0, 300).match(/\\bid="([^"]+)"/);
        const name = idm ? idm[1] : 's' + idx;
        out.push({
          name,
          label: labelOf(region, idm ? idm[1] : 'section ' + (idx + 1)),
          hidden: /<!-- cd-hide:/.test(html.slice(Math.max(0, start - 120), start)),
          anchor: idm ? idm[1] : '',
        });
        idx++;
      }
    }
  }
}
return [{ json: { ok: true, page: g.page, mode: marks.length ? 'markers' : 'fallback', sections: out.slice(0, 40) } }];
`.trim();

/* ---------------- generic multi-page site writes ---------------- */

const FONT_PAIRS = {
  classic: {
    heading: "Roboto Slab",
    body: "Roboto",
    hw: "400;600;700;800",
    bw: "300;400;500;700",
  },
  modern: {
    heading: "Montserrat",
    body: "Open Sans",
    hw: "400;600;700;800",
    bw: "300;400;500;700",
  },
  bold: {
    heading: "Oswald",
    body: "Source Sans 3",
    hw: "400;500;600;700",
    bw: "300;400;500;700",
  },
  traditional: {
    heading: "Merriweather",
    body: "Lato",
    hw: "400;700;900",
    bw: "300;400;700",
  },
  friendly: {
    heading: "Poppins",
    body: "Inter",
    hw: "400;600;700;800",
    bw: "300;400;500;700",
  },
  elegant: {
    heading: "Playfair Display",
    body: "Source Sans 3",
    hw: "400;600;700;800",
    bw: "300;400;500;700",
  },
  punchy: {
    heading: "Bebas Neue",
    body: "Inter",
    hw: "400",
    bw: "300;400;500;700",
  },
  tech: {
    heading: "Space Grotesk",
    body: "Inter",
    hw: "400;500;600;700",
    bw: "300;400;500;700",
  },
  warm: {
    heading: "Nunito",
    body: "Nunito Sans",
    hw: "400;600;700;800",
    bw: "300;400;600;700",
  },
  stylish: {
    heading: "Raleway",
    body: "Open Sans",
    hw: "400;600;700;800",
    bw: "300;400;500;700",
  },
};

const CODE_SITE_WRITE_GUARD = `
// One guard for every deterministic multi-page write. Validates the
// per-action payload and decides the commit message.
const body = $('Builder Webhook').first().json.body || {};
const row = $input.first().json || {};
const valid = row.id !== undefined && Number(row.session_expiry || 0) > Date.now();
if (!valid) throw new Error('Session expired');
if (!row.site) throw new Error('No website linked to this account');
const action = String(body.action || '');
const clean = (s, n) => String(s == null ? '' : s).slice(0, n).trim();
const out = { site: row.site, action };

if (action === 'save-details') {
  out.details = {
    name: clean(body.name, 80),
    phone: clean(body.phone, 30),
    email: clean(body.email, 80),
    address: clean(body.address, 140),
    suburb: clean(body.suburb, 40),
  };
  if (!Object.values(out.details).some(Boolean)) throw new Error('Nothing to save');
  if (out.details.email && !/^[^\\s@]+@[^\\s@]+\\.[^\\s@]+$/.test(out.details.email)) throw new Error('That email address does not look right');
  out.commitMsg = 'business details update';
} else if (action === 'save-hours') {
  const days = ['Monday','Tuesday','Wednesday','Thursday','Friday','Saturday','Sunday'];
  const t = /^([01]?\\d|2[0-3]):[0-5]\\d$/;
  const rows = Array.isArray(body.hours) ? body.hours : [];
  out.hours = days.map((d) => {
    const r = rows.find((x) => x && x.day === d) || {};
    if (r.closed || !t.test(String(r.opens || '')) || !t.test(String(r.closes || ''))) return { day: d, closed: true };
    return { day: d, opens: String(r.opens), closes: String(r.closes), closed: false };
  });
  if (!out.hours.some((h) => !h.closed)) throw new Error('Set at least one open day');
  out.commitMsg = 'opening hours update';
} else if (action === 'save-fonts') {
  const pairs = ${JSON.stringify(FONT_PAIRS)};
  const p = pairs[String(body.pair || '')];
  if (!p) throw new Error('Unknown font pairing');
  out.fonts = p;
  out.commitMsg = 'font change: ' + p.heading + ' + ' + p.body;
} else if (action === 'save-announce') {
  out.announce = { on: !!body.on, text: clean(body.text, 160), href: clean(body.href, 300) };
  if (out.announce.on && !out.announce.text) throw new Error('The bar needs some text');
  if (out.announce.href && !/^(https?:\\/\\/|\\/|tel:|mailto:)/i.test(out.announce.href)) throw new Error('Link must start with https://, /, tel: or mailto:');
  out.commitMsg = 'announcement bar ' + (out.announce.on ? 'on' : 'off');
} else if (action === 'toggle-section') {
  const page = String(body.page || '');
  if (!new RegExp('${PAGE_RE}').test(page)) throw new Error('Invalid page');
  const name = String(body.name || '');
  if (!/^[a-z0-9][a-z0-9-]{0,59}$/i.test(name)) throw new Error('Invalid section');
  out.toggle = { page, name, hide: !!body.hide };
  out.commitMsg = 'section ' + (body.hide ? 'hidden' : 'restored') + ': ' + name + ' on ' + page;
} else throw new Error('Unknown action');
return [{ json: out }];
`.trim();

const CODE_SITE_PAGES = `
// Page list for the write: sitemap-driven (like colours); fonts also edit
// the shared stylesheet; section toggles touch exactly one page.
const g = $('Site Write Guard').first().json;
if (g.action === 'toggle-section') return [{ json: { path: g.toggle.page, site: g.site } }];
let pages = ['index.html', 'about/index.html', 'services/index.html', 'pricing/index.html', 'blog/index.html', 'contact/index.html'];
try {
  const sm = Buffer.from($input.first().json.content, 'base64').toString('utf8');
  const urls = [...sm.matchAll(/<loc>([^<]+)<\\/loc>/g)].map((m) => String(m[1]).replace(/^https?:\\/\\/[^\\/]+/, ''));
  if (urls.length) pages = urls.map((p) => (p.replace(/^\\/+|\\/+$/g, '') ? p.replace(/^\\/+|\\/+$/g, '') + '/index.html' : 'index.html'));
} catch (e) {}
if (g.action === 'save-fonts') pages.push('assets/site.css');
return pages.map((p) => ({ json: { path: p, site: g.site } }));
`.trim();

const CODE_APPLY_SITE_EDIT = `
// The transform hub for every deterministic write. Each handler feature-
// detects its anchors and leaves pages it can't safely change untouched —
// a page only comes back (and gets committed) when it actually changed.
const g = $('Site Write Guard').first().json;
const escRe = (s) => s.replace(/[.*+?^\\\${}()|[\\]\\\\]/g, '\\\\$&');
const enc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const notes = [];

const items = $input.all().map((i) => i.json).filter((i) => i && i.content && i.path);

// ---- shared: tokenised multi-substitution (prevents chained replacements)
const makeSub = () => {
  const toks = [];
  return {
    sub(html, re, newV) {
      const t = '\\u0001CD' + toks.length + '\\u0001';
      const before = html;
      html = html.replace(re, t);
      if (html !== before) toks.push([t, newV]); else toks.push([t, newV]);
      return html;
    },
    expand(html) {
      for (const [t, v] of toks) html = html.split(t).join(v);
      return html;
    },
  };
};

// ---- details: old values come from each page's own JSON-LD (fallback: the
// first page that has one — index is first in the sitemap)
let globalOld = null;
const ldOf = (html) => {
  const m = html.match(/<script id="cd-ldjson"[^>]*>([\\s\\S]*?)<\\/script>/);
  if (!m) return null;
  try { return { raw: m[0], inner: m[1], data: JSON.parse(m[1]) }; } catch (e) { return null; }
};
const oldFrom = (ld) => {
  const addr = (ld.data.address || {});
  const street = String(addr.streetAddress || '');
  let suburb = String(addr.addressLocality || '');
  if (!suburb) {
    const sm = street.match(/,\\s*([A-Za-z' ]+?)\\s+(?:VIC|NSW|QLD|SA|WA|TAS|NT|ACT)\\b/i);
    if (sm) suburb = sm[1].trim();
  }
  return { name: String(ld.data.name || ''), phone: String(ld.data.telephone || ''), email: String(ld.data.email || ''), address: street, suburb };
};

const phoneRes = (p) => {
  const digits = String(p).replace(/\\D/g, '');
  if (digits.length < 8) return [];
  const variants = new Set([digits]);
  if (digits.indexOf('61') === 0) variants.add('0' + digits.slice(2));
  else if (digits.indexOf('0') === 0) variants.add('61' + digits.slice(1));
  return [...variants].map((v) => new RegExp('\\\\+?' + v.split('').join('[\\\\s().-]{0,2}'), 'g'));
};

const applyDetails = (html) => {
  const ld = ldOf(html);
  if (ld && !globalOld) globalOld = oldFrom(ld);
  const old = ld ? oldFrom(ld) : globalOld;
  if (!old) { notes.push('No business-data block found on your site.'); return html; }
  const d = g.details;
  const s = makeSub();
  if (d.phone && old.phone && d.phone !== old.phone) for (const re of phoneRes(old.phone)) html = s.sub(html, re, d.phone);
  const pairs = [['name', 'gi'], ['address', 'g'], ['suburb', 'g'], ['email', 'gi']]
    .filter(([k]) => d[k] && old[k] && d[k] !== old[k])
    .map(([k, fl]) => [old[k], d[k], fl]);
  pairs.sort((a, b) => b[0].length - a[0].length);
  for (const [oldV, newV, fl] of pairs) html = s.sub(html, new RegExp(escRe(oldV), fl), newV);
  html = s.expand(html);
  // canonical JSON-LD fields, set explicitly
  const ld2 = ldOf(html);
  if (ld2) {
    const data = ld2.data;
    if (d.name) data.name = d.name;
    if (d.phone) data.telephone = d.phone;
    if (d.email) data.email = d.email;
    if (d.address) { data.address = data.address || { '@type': 'PostalAddress' }; data.address.streetAddress = d.address; }
    if (d.suburb) { data.address = data.address || { '@type': 'PostalAddress' }; data.address.addressLocality = d.suburb; }
    html = html.replace(ld2.raw, ld2.raw.replace(ld2.inner, '\\n' + JSON.stringify(data) + '\\n    '));
  }
  return html;
};

// ---- opening hours
const fmt12 = (t) => {
  const [h, mn] = t.split(':').map(Number);
  const ap = h >= 12 ? 'pm' : 'am';
  const hh = h % 12 === 0 ? 12 : h % 12;
  return hh + (mn ? ':' + String(mn).padStart(2, '0') : '') + ap;
};
const hoursBlock = () => {
  const rows = g.hours.map((h) =>
    '<div style="display:flex;justify-content:space-between;gap:18px;padding:7px 0;border-bottom:1px solid rgba(255,255,255,0.12);font-size:14px;"><span style="font-weight:700;">' + h.day + '</span><span style="opacity:0.92;">' + (h.closed ? 'Closed' : fmt12(h.opens) + ' – ' + fmt12(h.closes)) + '</span></div>'
  ).join('');
  return '<div id="cd-hours" style="background:var(--color-secondary,#1a1a1a);color:#fff;padding:42px 30px;"><div style="max-width:560px;margin:0 auto;"><h4 style="margin:0 0 16px;font-size:15px;font-weight:700;text-transform:uppercase;letter-spacing:2px;text-align:center;">Opening Hours</h4>' + rows + '</div></div><!-- /cd-hours -->';
};
const applyHours = (html) => {
  let changed = false;
  const ld = ldOf(html);
  if (ld) {
    ld.data.openingHoursSpecification = g.hours.filter((h) => !h.closed).map((h) => ({ '@type': 'OpeningHoursSpecification', dayOfWeek: h.day, opens: h.opens, closes: h.closes }));
    html = html.replace(ld.raw, ld.raw.replace(ld.inner, '\\n' + JSON.stringify(ld.data) + '\\n    '));
    changed = true;
  }
  const block = hoursBlock();
  if (/<div id="cd-hours"/.test(html)) {
    html = html.replace(/<div id="cd-hours"[\\s\\S]*?<!-- \\/cd-hours -->/, () => block);
    changed = true;
  } else if (html.indexOf('</footer>') !== -1) {
    html = html.replace('</footer>', () => block + '</footer>');
    changed = true;
  }
  if (!changed) notes.push('No footer or business-data block to put the hours in.');
  return html;
};

// ---- fonts (HTML pages AND the shared stylesheet)
const applyFonts = (content, isCss) => {
  const f = g.fonts;
  const curH = (content.match(/font-family:\\s*"?([A-Za-z0-9 ]+?)"?\\s*,\\s*serif/) || [])[1];
  const curB = (content.match(/font-family:\\s*"?([A-Za-z0-9 ]+?)"?\\s*,\\s*sans-serif/) || [])[1];
  if (!curH && !curB) { if (!isCss) notes.push('Could not detect the current fonts on a page.'); return content; }
  if (!isCss) {
    const plus = (s) => s.replace(/ /g, '+');
    const href = 'https://fonts.googleapis.com/css2?family=' + plus(f.heading) + ':wght@' + f.hw + '&amp;family=' + plus(f.body) + ':wght@' + f.bw + '&amp;display=swap';
    content = content.replace(/href="https:\\/\\/fonts\\.googleapis\\.com\\/css2\\?[^"]+"/, () => 'href="' + href + '"');
  }
  const s = makeSub();
  const subs = [];
  if (curH && curH !== f.heading) subs.push([curH, f.heading]);
  if (curB && curB !== f.body) subs.push([curB, f.body]);
  subs.sort((a, b) => b[0].length - a[0].length);
  for (const [oldV, newV] of subs) {
    content = s.sub(content, new RegExp(escRe(oldV) + '(?=\\\\s*[,"\\';])', 'g'), newV);
  }
  return s.expand(content);
};

// ---- announcement bar
const applyAnnounce = (html) => {
  const had = /<!-- cd-announce -->/.test(html);
  html = html.replace(/<!-- cd-announce -->[\\s\\S]*?<!-- \\/cd-announce -->\\n?/, '');
  const a = g.announce;
  if (!a.on) { if (!had) notes.push('The bar was already off.'); return html; }
  const text = enc(a.text);
  const inner = a.href ? '<a href="' + enc(a.href) + '" style="color:inherit;text-decoration:underline;font-weight:700;">' + text + '</a>' : text;
  const fixedNav = /<nav[^>]*(data-cd="nav"|class="[^"]*\\bfixed\\b)/.test(html);
  const bar = fixedNav
    ? '<!-- cd-announce --><div id="cd-announce" style="position:fixed;top:0;left:0;right:0;z-index:2000;display:flex;align-items:center;justify-content:center;min-height:40px;padding:8px 16px;box-sizing:border-box;background:var(--color-primary,#222);color:#fff;font-size:14px;font-weight:600;text-align:center;line-height:1.3;">' + inner + '</div><style id="cd-announce-style">nav[data-cd="nav"],nav.fixed{top:40px !important;}</style><!-- /cd-announce -->'
    : '<!-- cd-announce --><div id="cd-announce" style="display:flex;align-items:center;justify-content:center;min-height:40px;padding:8px 16px;box-sizing:border-box;background:var(--color-primary,#222);color:#fff;font-size:14px;font-weight:600;text-align:center;line-height:1.3;">' + inner + '</div><!-- /cd-announce -->';
  const bm = html.match(/<body[^>]*>/);
  if (!bm) { notes.push('Could not find where to put the bar on a page.'); return html; }
  const at = html.indexOf(bm[0]) + bm[0].length;
  return html.slice(0, at) + '\\n' + bar + html.slice(at);
};

// ---- section show / hide (single page)
const applyToggle = (html) => {
  const t = g.toggle;
  if (!t.hide) {
    const un = new RegExp('<!-- cd-hide:' + escRe(t.name) + ' --><div[^>]*>([\\\\s\\\\S]*?)<\\\\/div><!-- \\\\/cd-hide:' + escRe(t.name) + ' -->');
    const next = html.replace(un, (m, p1) => p1);
    if (next === html) notes.push('That section is not hidden.');
    return next;
  }
  if (new RegExp('<!-- cd-hide:' + escRe(t.name) + ' -->').test(html)) { notes.push('That section is already hidden.'); return html; }
  const HIDE_OPEN = '<!-- cd-hide:' + t.name + ' --><div hidden style="display:none !important">';
  const HIDE_CLOSE = '</div><!-- /cd-hide:' + t.name + ' -->';
  const mm = html.match(new RegExp('<!-- =+ SECTION: ' + escRe(t.name) + ' =+ -->'));
  if (mm) {
    const from = html.indexOf(mm[0]) + mm[0].length;
    const nxt = html.slice(from).search(/<!-- =+ SECTION: [a-z0-9-]+ =+ -->/);
    const foot = html.indexOf('<footer', from);
    let to = nxt !== -1 ? from + nxt : (foot !== -1 ? foot : html.length);
    return html.slice(0, from) + HIDE_OPEN + html.slice(from, to) + HIDE_CLOSE + html.slice(to);
  }
  // fallback: top-level <section> matched by id or sN index
  const tre = /<section\\b|<\\/section>/g;
  let depth = 0, start = -1, m2, idx = 0;
  while ((m2 = tre.exec(html))) {
    if (m2[0] === '<section') { if (depth === 0) start = m2.index; depth++; }
    else if (depth > 0) {
      depth--;
      if (depth === 0) {
        const end = m2.index + 10;
        const open = html.slice(start, html.indexOf('>', start) + 1);
        const idm = open.match(/\\bid="([^"]+)"/);
        const name = idm ? idm[1] : 's' + idx;
        if (name === t.name) {
          return html.slice(0, start) + HIDE_OPEN + html.slice(start, end) + HIDE_CLOSE + html.slice(end);
        }
        idx++;
      }
    }
  }
  notes.push('Could not find that section on the page.');
  return html;
};

const out = [];
for (const it of items) {
  const isCss = /\\.css$/.test(it.path);
  let content = Buffer.from(it.content, 'base64').toString('utf8');
  const before = content;
  if (g.action === 'save-details' && !isCss) content = applyDetails(content);
  else if (g.action === 'save-hours' && !isCss) content = applyHours(content);
  else if (g.action === 'save-fonts') content = applyFonts(content, isCss);
  else if (g.action === 'save-announce' && !isCss) content = applyAnnounce(content);
  else if (g.action === 'toggle-section' && !isCss) content = applyToggle(content);
  if (content !== before) out.push({ json: { path: it.path, content, site: g.site } });
}
out.push({ json: { summary: true, changed: out.length, notes: [...new Set(notes)] } });
return out;
`.trim();

const CODE_SITE_EDIT_REPLY = `
let items = [];
try { items = $('Apply Site Edit').all().map((i) => i.json); } catch (e) {}
const changed = items.filter((i) => i.path).length;
const sum = items.find((i) => i.summary) || {};
const notes = sum.notes || [];
if (!changed) return [{ json: { ok: false, error: notes[0] || 'That change is not available on your site yet.' } }];
return [{ json: { ok: true, pages: changed, notes } }];
`.trim();

/* ---------------- editor chain: validate / route / bill ---------------- */

const CODE_VALIDATE_V3 = `
// Validates the edit request: customer session (billed) or legacy site link.
const body = $('Edit Webhook').first().json.body || {};
const row = $input.first().json || {}; // from Load Session (may be empty)

let site, history, billing = null;

if (body.token === '${EDIT_TOKEN}' && body.site) {
  // legacy unbilled per-site link
  site = String(body.site);
  history = (Array.isArray(body.history) ? body.history : []).slice(-12);
} else {
  const valid = row.id !== undefined && Number(row.session_expiry || 0) > Date.now();
  if (!valid) return [{ json: { authFailed: true } }];
  site = String(row.site || '');
  const balance = parseFloat(row.account_balance || '0') || 0;
  try { history = JSON.parse(row.message_history || '[]'); } catch (e) { history = []; }
  history = history.slice(-12);
  billing = {
    rowId: row.id,
    number: row.Number,
    balanceNow: Math.round(balance * 100) / 100,
    newBalance: String(Math.round((balance - ${MSG_FEE}) * 100) / 100),
    canAfford: balance >= ${MSG_FEE},
    prevHistory: JSON.parse(row.message_history || '[]'),
  };
}

if (!/^[A-Za-z0-9._-]{1,80}$/.test(site)) throw new Error('Invalid site');
const message = String(body.message || '').slice(0, 6000);
if (!message.trim()) throw new Error('Empty message');
history = history.map((m) => ({ role: m.role === 'assistant' ? 'assistant' : 'user', content: String(m.content || '').slice(0, 4000) }));

const stamp = Date.now();
const images = (Array.isArray(body.images) ? body.images : []).slice(0, 4).map((img, i) => {
  const name = String(img.name || 'image.jpg').replace(/[^A-Za-z0-9._-]/g, '_').slice(-60);
  const b64 = String(img.b64 || '');
  if (b64.length > 6 * 1024 * 1024) throw new Error('Image too large (max ~4MB)');
  const ext = (name.split('.').pop() || 'jpg').toLowerCase();
  const mime = { jpg: 'image/jpeg', jpeg: 'image/jpeg', png: 'image/png', webp: 'image/webp', gif: 'image/gif', svg: 'image/svg+xml' }[ext] || 'image/jpeg';
  return { name, b64, mime, path: 'assets/uploads/' + stamp + '-' + i + '-' + name };
});

return [{ json: { site, message, history, images, imagePaths: images.map((x) => '/' + x.path), billing } }];
`.trim();

const CODE_ROUTER_PROMPT = `
// Cheap, fast intent classification before any money is spent or charged.
const v = $('Validate Edit Request').first().json;
const recent = v.history.slice(-6).map((m) => m.role.toUpperCase() + ': ' + m.content).join('\\n');

const prompt = [
  'You route customer requests for a small-business website editing chat. Classify the message; when no edit should happen, also draft the reply.',
  '',
  'ALLOWED here (MINOR changes, $1 each): wording/text changes, headings, the prices shown on the site, contact details, swapping/adding/removing images, fixing obvious issues (typos, broken bits), and improving the content of ONE section at a time. Messages starting with "[PRESET:" are curated jobs and always count as edits.',
  'NOT allowed (MAJOR work, free reply, refer to Dan): redesigns, layout/structural changes, new pages or features, full-page or whole-site rewrites, integrations/bookings/forms, SEO overhauls, anything spanning many sections or pages. For these the customer needs Dan directly on ${DAN}.',
  '',
  v.imagePaths.length ? 'THE CUSTOMER ATTACHED ' + v.imagePaths.length + ' IMAGE(S) THIS TURN.' : 'No images attached this turn.',
  '',
  'RECENT CONVERSATION:',
  recent || '(first message)',
  '',
  'CUSTOMER MESSAGE:',
  v.message,
  '',
  'INTENTS:',
  '- question  : asking about the site or service, chit-chat, or so unclear you need a follow-up. Not charged.',
  '- text_edit : change/fix text, headings, prices, contact details, typos.',
  '- image_edit: add/swap/remove an image (especially when images are attached).',
  '- content_edit: rewrite/improve ONE section of one page.',
  '- preset    : message starts with [PRESET:, OR the customer is confirming/continuing a recent [PRESET: ...] task visible in the conversation (e.g. answering its follow-up question). Curated preset jobs are allowed even when they would otherwise be major (like adding a blog post).',
  '- major     : anything from the NOT-allowed list. Not charged.',
  '',
  'REPLY STYLE (question/major only): you are Dan\\'s website assistant. Sound like a friendly, busy Aussie texting a client: first person, contractions, short and warm, no corporate fluff, no emojis, never "I have successfully" or "as an AI". You CANNOT look at or check the website yourself — never promise to "take a look" or report back; share what you know and ask what they want changed. For major: kindly explain that is a bigger job best done properly, and to call or text Dan on ${DAN} — and that this chat has not charged them.',
  '',
  'Output ONLY JSON: {"intent": "question|text_edit|image_edit|content_edit|preset|major", "reply": "<for question/major, else empty>"}',
].join('\\n');

return [{ json: { prompt } }];
`.trim();

const CODE_PARSE_ROUTE = `
// Extracts the router's decision.
// Presets are OURS — never let the model reclassify them (it once bounced a
// curated blog preset to "major" because new pages are normally off-limits).
const vmsg = String($('Validate Edit Request').first().json.message || '').trim();
if (/^\\[PRESET:/i.test(vmsg)) return [{ json: { intent: 'preset', reply: '' } }];
let raw = String($json.text || '');
const t = raw.lastIndexOf('</think>');
if (t !== -1) raw = raw.slice(t + 8);
const m = raw.match(/\\{[\\s\\S]*\\}/);
let out = {};
try { out = JSON.parse(m ? m[0] : '{}'); } catch (e) {}
const intents = ['question', 'text_edit', 'image_edit', 'content_edit', 'preset', 'major'];
const intent = intents.includes(out.intent) ? out.intent : 'question';
const reply = String(out.reply || '').trim() || 'Happy to help — could you tell me a bit more about what you want changed?';
return [{ json: { intent, reply } }];
`.trim();

const CODE_FREE_REPLY = `
// No-charge response (questions, major-work referrals). Still saves history.
const v = $('Validate Edit Request').first().json;
const r = $('Parse Route').first().json;
const reply = r.reply;
let newHistory = null, billingRowId = null, balance = null;
if (v.billing) {
  balance = v.billing.balanceNow;
  billingRowId = v.billing.rowId;
  newHistory = JSON.stringify((v.billing.prevHistory || []).concat([
    { role: 'user', content: v.message },
    { role: 'assistant', content: reply },
  ]).slice(-40));
}
return [{ json: { reply, changed: [], changedUrls: [], site: v.site, balance, failures: [], newHistory, billingRowId, free: true } }];
`.trim();

const CODE_GATE_REPLY_V3 = `
// Friendly responses for the not-allowed paths.
const v = $('Validate Edit Request').first().json;
if (v.authFailed) return [{ json: { error: 'auth', reply: 'Your session has expired — please log in again.' } }];
return [{ json: {
  error: 'insufficient_balance',
  balance: v.billing ? v.billing.balanceNow : 0,
  reply: "You're out of editing credit — top up and I'll get straight onto it. (Questions are always free.)",
} }];
`.trim();

const CODE_BUILD_REPLY_V3 = `
// Final response payload for the chat UI (edit paths).
const items = $input.all();
const first = items[0] ? items[0].json : {};
let reply = first.reply || 'Done.';
try { reply = $('Apply Edits').first().json.reply || reply; } catch (e) {}
let changed = [];
try { changed = $('Apply Edits').all().filter((i) => i.json.path).map((i) => i.json.path); } catch (e) {}
changed = [...new Set(changed)];
const v = $('Validate Edit Request').first().json;

// the fee only applies when Charge Fee actually ran (i.e. a commit happened)
let charged = false;
try { $('Charge Fee').first(); charged = true; } catch (e) {}

let failures = first.failures || [];
try { failures = $('Apply Edits').first().json.failures || failures; } catch (e) {}

let newHistory = null, balance = null, billingRowId = null;
if (v.billing) {
  balance = charged ? parseFloat(v.billing.newBalance) : v.billing.balanceNow;
  billingRowId = v.billing.rowId;
  newHistory = JSON.stringify((v.billing.prevHistory || []).concat([
    { role: 'user', content: v.message },
    { role: 'assistant', content: reply },
  ]).slice(-40));
}

return [{ json: {
  reply, changed,
  changedUrls: changed.map((p) => '/' + p.replace(/index\\.html$/, '').replace(/\\.html$/, '')),
  site: v.site,
  balance,
  failures,
  newHistory,
  billingRowId,
} }];
`.trim();

const CODE_FINAL_REPLY_V3 = `
// Strip internals before responding to the UI (edit OR free path).
let src = null;
try { src = $('Build Edit Reply').first().json; } catch (e) {}
if (!src) { try { src = $('Free Reply').first().json; } catch (e) {} }
const r = { ...(src || { reply: 'Done.' }) };
delete r.newHistory; delete r.billingRowId;
return [{ json: r }];
`.trim();

/* ---------------- helpers ---------------- */

const dtGet = (filterKey, filterValueExpr) => ({
  operation: "get",
  dataTableId: TABLE,
  filters: { conditions: [{ keyName: filterKey, keyValue: filterValueExpr }] },
});

const dtUpdate = (filterKey, filterValueExpr, cols) => ({
  operation: "update",
  dataTableId: TABLE,
  filters: { conditions: [{ keyName: filterKey, keyValue: filterValueExpr }] },
  columns: {
    mappingMode: "defineBelow",
    value: cols,
    matchingColumns: [],
    schema: [],
    attemptToConvertTypes: false,
    convertFieldsToString: false,
  },
});

const ifCond = (id, leftExpr, op, right) => ({
  conditions: {
    options: {
      caseSensitive: true,
      leftValue: "",
      typeValidation: "loose",
      version: 2,
    },
    conditions: [{ id, leftValue: leftExpr, rightValue: right, operator: op }],
    combinator: "and",
  },
  options: {},
});

const switchRule = (key, val) => ({
  conditions: {
    options: {
      caseSensitive: true,
      leftValue: "",
      typeValidation: "loose",
      version: 2,
    },
    conditions: [
      {
        leftValue: "={{ $json.body.action }}",
        rightValue: val,
        operator: { type: "string", operation: "equals" },
      },
    ],
    combinator: "and",
  },
  renameOutput: true,
  outputKey: key,
});

const VREF = "$('Validate Edit Request').first().json";

/* ---------------- nodes ---------------- */

const Y = 1150;
const accountNodes = [
  {
    name: "Builder Webhook",
    type: "n8n-nodes-base.webhook",
    typeVersion: 2,
    position: [1000, Y],
    parameters: {
      httpMethod: "POST",
      path: "builder-auth",
      responseMode: "responseNode",
      options: { allowedOrigins: "*" },
    },
  },
  {
    name: "Route Action",
    type: "n8n-nodes-base.switch",
    typeVersion: 3.2,
    position: [1200, Y],
    parameters: {
      rules: {
        values: [
          switchRule("login", "login"),
          switchRule("session", "session"),
          switchRule("credit", "credit"),
          switchRule("images", "images"),
          switchRule("swap", "swap"),
          switchRule("texts", "texts"),
          switchRule("savetexts", "save-texts"),
          switchRule("colours", "colours"),
          switchRule("siteinfo", "site-info"),
          switchRule("sections", "sections"),
          switchRule("savedetails", "save-details"),
          switchRule("savehours", "save-hours"),
          switchRule("savefonts", "save-fonts"),
          switchRule("saveannounce", "save-announce"),
          switchRule("togglesection", "toggle-section"),
        ],
      },
      options: {},
    },
  },
  {
    name: "Find User",
    type: "n8n-nodes-base.dataTable",
    typeVersion: 1.1,
    position: [1420, Y - 160],
    settings: { alwaysOutputData: true },
    parameters: dtGet(
      "Number",
      "={{ $('Builder Webhook').first().json.body.number }}",
    ),
  },
  {
    name: "Check Login",
    type: "n8n-nodes-base.code",
    typeVersion: 2,
    position: [1620, Y - 160],
    parameters: { mode: "runOnceForAllItems", jsCode: CODE_CHECK_LOGIN },
  },
  {
    name: "Login OK",
    type: "n8n-nodes-base.if",
    typeVersion: 2.2,
    position: [1820, Y - 160],
    parameters: ifCond(
      "lo1",
      "={{ $json.ok ? 1 : 0 }}",
      { type: "number", operation: "equals" },
      1,
    ),
  },
  {
    name: "Save Session",
    type: "n8n-nodes-base.dataTable",
    typeVersion: 1.1,
    position: [2020, Y - 220],
    parameters: dtUpdate("id", "={{ $json.rowId }}", {
      session_token: "={{ $json.token }}",
      session_expiry: "={{ $json.expiry }}",
    }),
  },
  {
    name: "Login Reply",
    type: "n8n-nodes-base.code",
    typeVersion: 2,
    position: [2220, Y - 220],
    settings: { executeOnce: true },
    parameters: { mode: "runOnceForAllItems", jsCode: CODE_LOGIN_REPLY },
  },
  {
    name: "Find Session",
    type: "n8n-nodes-base.dataTable",
    typeVersion: 1.1,
    position: [1420, Y],
    settings: { alwaysOutputData: true },
    parameters: dtGet(
      "session_token",
      "={{ $('Builder Webhook').first().json.body.token }}",
    ),
  },
  {
    name: "Session Reply",
    type: "n8n-nodes-base.code",
    typeVersion: 2,
    position: [1620, Y],
    parameters: { mode: "runOnceForAllItems", jsCode: CODE_SESSION_REPLY },
  },
  {
    name: "Credit Guard",
    type: "n8n-nodes-base.code",
    typeVersion: 2,
    position: [1420, Y + 160],
    parameters: { mode: "runOnceForAllItems", jsCode: CODE_CREDIT_GUARD },
  },
  {
    name: "Find User Credit",
    type: "n8n-nodes-base.dataTable",
    typeVersion: 1.1,
    position: [1620, Y + 160],
    settings: { alwaysOutputData: true },
    parameters: dtGet("Number", "={{ $json.number }}"),
  },
  {
    name: "Apply Credit",
    type: "n8n-nodes-base.code",
    typeVersion: 2,
    position: [1820, Y + 160],
    parameters: { mode: "runOnceForAllItems", jsCode: CODE_APPLY_CREDIT },
  },
  {
    name: "Save Credit",
    type: "n8n-nodes-base.dataTable",
    typeVersion: 1.1,
    position: [2020, Y + 160],
    parameters: dtUpdate("id", "={{ $json.rowId }}", {
      account_balance: "={{ $json.newBalance }}",
    }),
  },
  {
    name: "Credit Reply",
    type: "n8n-nodes-base.code",
    typeVersion: 2,
    position: [2220, Y + 160],
    settings: { executeOnce: true },
    parameters: { mode: "runOnceForAllItems", jsCode: CODE_CREDIT_REPLY },
  },
  /* image gallery + swap */
  {
    name: "Find Session Images",
    type: "n8n-nodes-base.dataTable",
    typeVersion: 1.1,
    position: [1420, Y + 320],
    settings: { alwaysOutputData: true },
    parameters: dtGet(
      "session_token",
      "={{ $('Builder Webhook').first().json.body.token }}",
    ),
  },
  {
    name: "Img Guard",
    type: "n8n-nodes-base.code",
    typeVersion: 2,
    position: [1560, Y + 320],
    parameters: { mode: "runOnceForAllItems", jsCode: CODE_IMG_GUARD },
  },
  {
    name: "List Img Root",
    type: "n8n-nodes-base.github",
    typeVersion: 1.1,
    position: [1700, Y + 320],
    credentials: {
      githubApi: { id: "5nFNKB7SlRtiwZqO", name: "GitHub account" },
    },
    settings: { alwaysOutputData: true, onError: "continueRegularOutput" },
    parameters: {
      resource: "file",
      operation: "list",
      owner: { __rl: true, value: "danielanderledan-stack", mode: "name" },
      repository: {
        __rl: true,
        value: "={{ $('Img Guard').first().json.site }}",
        mode: "name",
      },
      filePath: "assets/images",
    },
  },
  {
    name: "Dir Items",
    type: "n8n-nodes-base.code",
    typeVersion: 2,
    position: [1840, Y + 320],
    parameters: { mode: "runOnceForAllItems", jsCode: CODE_DIR_ITEMS },
  },
  {
    name: "List Img Sub",
    type: "n8n-nodes-base.github",
    typeVersion: 1.1,
    position: [1980, Y + 320],
    credentials: {
      githubApi: { id: "5nFNKB7SlRtiwZqO", name: "GitHub account" },
    },
    settings: { alwaysOutputData: true, onError: "continueRegularOutput" },
    parameters: {
      resource: "file",
      operation: "list",
      owner: { __rl: true, value: "danielanderledan-stack", mode: "name" },
      repository: {
        __rl: true,
        value: "={{ $('Img Guard').first().json.site }}",
        mode: "name",
      },
      filePath: "={{ $json.path }}",
    },
  },
  {
    name: "List Uploads",
    type: "n8n-nodes-base.github",
    typeVersion: 1.1,
    position: [2120, Y + 320],
    credentials: {
      githubApi: { id: "5nFNKB7SlRtiwZqO", name: "GitHub account" },
    },
    settings: {
      alwaysOutputData: true,
      onError: "continueRegularOutput",
      executeOnce: true,
    },
    parameters: {
      resource: "file",
      operation: "list",
      owner: { __rl: true, value: "danielanderledan-stack", mode: "name" },
      repository: {
        __rl: true,
        value: "={{ $('Img Guard').first().json.site }}",
        mode: "name",
      },
      filePath: "assets/uploads",
    },
  },
  {
    name: "Build Image List",
    type: "n8n-nodes-base.code",
    typeVersion: 2,
    position: [2260, Y + 320],
    settings: { executeOnce: true },
    parameters: { mode: "runOnceForAllItems", jsCode: CODE_BUILD_IMAGE_LIST },
  },
  {
    name: "Find Session Swap",
    type: "n8n-nodes-base.dataTable",
    typeVersion: 1.1,
    position: [1420, Y + 480],
    settings: { alwaysOutputData: true },
    parameters: dtGet(
      "session_token",
      "={{ $('Builder Webhook').first().json.body.token }}",
    ),
  },
  {
    name: "Swap Guard",
    type: "n8n-nodes-base.code",
    typeVersion: 2,
    position: [1620, Y + 480],
    parameters: { mode: "runOnceForAllItems", jsCode: CODE_SWAP_GUARD },
  },
  {
    name: "Commit Swap",
    type: "n8n-nodes-base.github",
    typeVersion: 1.1,
    position: [1820, Y + 480],
    credentials: {
      githubApi: { id: "5nFNKB7SlRtiwZqO", name: "GitHub account" },
    },
    parameters: {
      resource: "file",
      operation: "edit",
      owner: { __rl: true, value: "danielanderledan-stack", mode: "name" },
      repository: { __rl: true, value: "={{ $json.site }}", mode: "name" },
      filePath: "={{ $json.path }}",
      binaryData: true,
      binaryPropertyName: "data",
      commitMessage: "={{ 'image swap: ' + $json.path }}",
    },
  },
  {
    name: "Swap Reply",
    type: "n8n-nodes-base.code",
    typeVersion: 2,
    position: [2020, Y + 480],
    settings: { executeOnce: true },
    parameters: { mode: "runOnceForAllItems", jsCode: CODE_SWAP_REPLY },
  },
  /* text editor */
  {
    name: "Find Session Texts",
    type: "n8n-nodes-base.dataTable",
    typeVersion: 1.1,
    position: [1420, Y + 640],
    settings: { alwaysOutputData: true },
    parameters: dtGet(
      "session_token",
      "={{ $('Builder Webhook').first().json.body.token }}",
    ),
  },
  {
    name: "Texts Guard",
    type: "n8n-nodes-base.code",
    typeVersion: 2,
    position: [1580, Y + 640],
    parameters: { mode: "runOnceForAllItems", jsCode: CODE_TEXTS_GUARD },
  },
  {
    name: "Get Page Text",
    type: "n8n-nodes-base.github",
    typeVersion: 1.1,
    position: [1740, Y + 640],
    credentials: {
      githubApi: { id: "5nFNKB7SlRtiwZqO", name: "GitHub account" },
    },
    parameters: {
      resource: "file",
      operation: "get",
      owner: { __rl: true, value: "danielanderledan-stack", mode: "name" },
      repository: { __rl: true, value: "={{ $json.site }}", mode: "name" },
      filePath: "={{ $json.page }}",
      asBinaryProperty: false,
      additionalParameters: {},
    },
  },
  {
    name: "Extract Texts",
    type: "n8n-nodes-base.code",
    typeVersion: 2,
    position: [1900, Y + 640],
    parameters: { mode: "runOnceForAllItems", jsCode: CODE_EXTRACT_TEXTS },
  },
  /* text saver */
  {
    name: "Find Session SaveT",
    type: "n8n-nodes-base.dataTable",
    typeVersion: 1.1,
    position: [1420, Y + 800],
    settings: { alwaysOutputData: true },
    parameters: dtGet(
      "session_token",
      "={{ $('Builder Webhook').first().json.body.token }}",
    ),
  },
  {
    name: "Save Guard",
    type: "n8n-nodes-base.code",
    typeVersion: 2,
    position: [1580, Y + 800],
    parameters: { mode: "runOnceForAllItems", jsCode: CODE_SAVE_GUARD },
  },
  {
    name: "Get Page For Save",
    type: "n8n-nodes-base.github",
    typeVersion: 1.1,
    position: [1740, Y + 800],
    credentials: {
      githubApi: { id: "5nFNKB7SlRtiwZqO", name: "GitHub account" },
    },
    parameters: {
      resource: "file",
      operation: "get",
      owner: { __rl: true, value: "danielanderledan-stack", mode: "name" },
      repository: { __rl: true, value: "={{ $json.site }}", mode: "name" },
      filePath: "={{ $json.page }}",
      asBinaryProperty: false,
      additionalParameters: {},
    },
  },
  {
    name: "Apply Texts",
    type: "n8n-nodes-base.code",
    typeVersion: 2,
    position: [1900, Y + 800],
    parameters: { mode: "runOnceForAllItems", jsCode: CODE_APPLY_TEXTS },
  },
  {
    name: "Commit Texts",
    type: "n8n-nodes-base.github",
    typeVersion: 1.1,
    position: [2060, Y + 800],
    credentials: {
      githubApi: { id: "5nFNKB7SlRtiwZqO", name: "GitHub account" },
    },
    parameters: {
      resource: "file",
      operation: "edit",
      owner: { __rl: true, value: "danielanderledan-stack", mode: "name" },
      repository: { __rl: true, value: "={{ $json.site }}", mode: "name" },
      filePath: "={{ $json.page }}",
      fileContent: "={{ $json.content }}",
      commitMessage: "={{ 'text edits: ' + $json.page }}",
    },
  },
  {
    name: "Texts Reply",
    type: "n8n-nodes-base.code",
    typeVersion: 2,
    position: [2220, Y + 800],
    settings: { executeOnce: true },
    parameters: { mode: "runOnceForAllItems", jsCode: CODE_TEXTS_REPLY },
  },
  /* colour editor */
  {
    name: "Find Session Colours",
    type: "n8n-nodes-base.dataTable",
    typeVersion: 1.1,
    position: [1420, Y + 960],
    settings: { alwaysOutputData: true },
    parameters: dtGet(
      "session_token",
      "={{ $('Builder Webhook').first().json.body.token }}",
    ),
  },
  {
    name: "Colour Guard",
    type: "n8n-nodes-base.code",
    typeVersion: 2,
    position: [1580, Y + 960],
    parameters: { mode: "runOnceForAllItems", jsCode: CODE_COLOUR_GUARD },
  },
  {
    name: "Get Sitemap Colours",
    type: "n8n-nodes-base.github",
    typeVersion: 1.1,
    position: [1740, Y + 960],
    credentials: {
      githubApi: { id: "5nFNKB7SlRtiwZqO", name: "GitHub account" },
    },
    settings: { alwaysOutputData: true, onError: "continueRegularOutput" },
    parameters: {
      resource: "file",
      operation: "get",
      owner: { __rl: true, value: "danielanderledan-stack", mode: "name" },
      repository: { __rl: true, value: "={{ $json.site }}", mode: "name" },
      filePath: "sitemap.xml",
      asBinaryProperty: false,
      additionalParameters: {},
    },
  },
  {
    name: "Colour Pages",
    type: "n8n-nodes-base.code",
    typeVersion: 2,
    position: [1900, Y + 960],
    parameters: { mode: "runOnceForAllItems", jsCode: CODE_COLOUR_PAGES },
  },
  {
    name: "Get Page For Colour",
    type: "n8n-nodes-base.github",
    typeVersion: 1.1,
    position: [2060, Y + 960],
    credentials: {
      githubApi: { id: "5nFNKB7SlRtiwZqO", name: "GitHub account" },
    },
    parameters: {
      resource: "file",
      operation: "get",
      owner: { __rl: true, value: "danielanderledan-stack", mode: "name" },
      repository: { __rl: true, value: "={{ $json.site }}", mode: "name" },
      filePath: "={{ $json.path }}",
      asBinaryProperty: false,
      additionalParameters: {},
    },
  },
  {
    name: "Apply Colours",
    type: "n8n-nodes-base.code",
    typeVersion: 2,
    position: [2220, Y + 960],
    parameters: { mode: "runOnceForAllItems", jsCode: CODE_APPLY_COLOURS },
  },
  {
    name: "Commit Colours",
    type: "n8n-nodes-base.github",
    typeVersion: 1.1,
    position: [2380, Y + 960],
    credentials: {
      githubApi: { id: "5nFNKB7SlRtiwZqO", name: "GitHub account" },
    },
    parameters: {
      resource: "file",
      operation: "edit",
      owner: { __rl: true, value: "danielanderledan-stack", mode: "name" },
      repository: { __rl: true, value: "={{ $json.site }}", mode: "name" },
      filePath: "={{ $json.path }}",
      fileContent: "={{ $json.content }}",
      commitMessage: "colour change",
    },
  },
  {
    name: "Colours Reply",
    type: "n8n-nodes-base.code",
    typeVersion: 2,
    position: [2540, Y + 960],
    settings: { executeOnce: true },
    parameters: { mode: "runOnceForAllItems", jsCode: CODE_COLOURS_REPLY },
  },
  /* site info (read) */
  {
    name: "Find Session Info",
    type: "n8n-nodes-base.dataTable",
    typeVersion: 1.1,
    position: [1420, Y + 1120],
    settings: { alwaysOutputData: true },
    parameters: dtGet(
      "session_token",
      "={{ $('Builder Webhook').first().json.body.token }}",
    ),
  },
  {
    name: "Info Guard",
    type: "n8n-nodes-base.code",
    typeVersion: 2,
    position: [1580, Y + 1120],
    parameters: { mode: "runOnceForAllItems", jsCode: CODE_INFO_GUARD },
  },
  {
    name: "Get Repo Info",
    type: "n8n-nodes-base.github",
    typeVersion: 1.1,
    position: [1740, Y + 1120],
    credentials: {
      githubApi: { id: "5nFNKB7SlRtiwZqO", name: "GitHub account" },
    },
    settings: { alwaysOutputData: true, onError: "continueRegularOutput" },
    parameters: {
      resource: "repository",
      operation: "get",
      owner: { __rl: true, value: "danielanderledan-stack", mode: "name" },
      repository: {
        __rl: true,
        value: "={{ $('Info Guard').first().json.site }}",
        mode: "name",
      },
    },
  },
  {
    name: "Get Index Info",
    type: "n8n-nodes-base.github",
    typeVersion: 1.1,
    position: [1900, Y + 1120],
    credentials: {
      githubApi: { id: "5nFNKB7SlRtiwZqO", name: "GitHub account" },
    },
    settings: { alwaysOutputData: true, onError: "continueRegularOutput" },
    parameters: {
      resource: "file",
      operation: "get",
      owner: { __rl: true, value: "danielanderledan-stack", mode: "name" },
      repository: {
        __rl: true,
        value: "={{ $('Info Guard').first().json.site }}",
        mode: "name",
      },
      filePath: "index.html",
      asBinaryProperty: false,
      additionalParameters: {},
    },
  },
  {
    name: "Extract Site Info",
    type: "n8n-nodes-base.code",
    typeVersion: 2,
    position: [2060, Y + 1120],
    settings: { executeOnce: true },
    parameters: { mode: "runOnceForAllItems", jsCode: CODE_EXTRACT_INFO },
  },
  /* sections (read) */
  {
    name: "Find Session Sections",
    type: "n8n-nodes-base.dataTable",
    typeVersion: 1.1,
    position: [1420, Y + 1280],
    settings: { alwaysOutputData: true },
    parameters: dtGet(
      "session_token",
      "={{ $('Builder Webhook').first().json.body.token }}",
    ),
  },
  {
    name: "Sections Guard",
    type: "n8n-nodes-base.code",
    typeVersion: 2,
    position: [1580, Y + 1280],
    parameters: { mode: "runOnceForAllItems", jsCode: CODE_SECTIONS_GUARD },
  },
  {
    name: "Get Page Sections",
    type: "n8n-nodes-base.github",
    typeVersion: 1.1,
    position: [1740, Y + 1280],
    credentials: {
      githubApi: { id: "5nFNKB7SlRtiwZqO", name: "GitHub account" },
    },
    parameters: {
      resource: "file",
      operation: "get",
      owner: { __rl: true, value: "danielanderledan-stack", mode: "name" },
      repository: { __rl: true, value: "={{ $json.site }}", mode: "name" },
      filePath: "={{ $json.page }}",
      asBinaryProperty: false,
      additionalParameters: {},
    },
  },
  {
    name: "Extract Sections",
    type: "n8n-nodes-base.code",
    typeVersion: 2,
    position: [1900, Y + 1280],
    parameters: { mode: "runOnceForAllItems", jsCode: CODE_EXTRACT_SECTIONS },
  },
  /* generic multi-page writes (details / hours / fonts / announce / toggle) */
  {
    name: "Find Session Site",
    type: "n8n-nodes-base.dataTable",
    typeVersion: 1.1,
    position: [1420, Y + 1440],
    settings: { alwaysOutputData: true },
    parameters: dtGet(
      "session_token",
      "={{ $('Builder Webhook').first().json.body.token }}",
    ),
  },
  {
    name: "Site Write Guard",
    type: "n8n-nodes-base.code",
    typeVersion: 2,
    position: [1580, Y + 1440],
    parameters: { mode: "runOnceForAllItems", jsCode: CODE_SITE_WRITE_GUARD },
  },
  {
    name: "Get Site Sitemap",
    type: "n8n-nodes-base.github",
    typeVersion: 1.1,
    position: [1740, Y + 1440],
    credentials: {
      githubApi: { id: "5nFNKB7SlRtiwZqO", name: "GitHub account" },
    },
    settings: { alwaysOutputData: true, onError: "continueRegularOutput" },
    parameters: {
      resource: "file",
      operation: "get",
      owner: { __rl: true, value: "danielanderledan-stack", mode: "name" },
      repository: { __rl: true, value: "={{ $json.site }}", mode: "name" },
      filePath: "sitemap.xml",
      asBinaryProperty: false,
      additionalParameters: {},
    },
  },
  {
    name: "Site Pages",
    type: "n8n-nodes-base.code",
    typeVersion: 2,
    position: [1900, Y + 1440],
    parameters: { mode: "runOnceForAllItems", jsCode: CODE_SITE_PAGES },
  },
  {
    name: "Get Page For Site",
    type: "n8n-nodes-base.github",
    typeVersion: 1.1,
    position: [2060, Y + 1440],
    credentials: {
      githubApi: { id: "5nFNKB7SlRtiwZqO", name: "GitHub account" },
    },
    settings: { alwaysOutputData: true, onError: "continueRegularOutput" },
    parameters: {
      resource: "file",
      operation: "get",
      owner: { __rl: true, value: "danielanderledan-stack", mode: "name" },
      repository: { __rl: true, value: "={{ $json.site }}", mode: "name" },
      filePath: "={{ $json.path }}",
      asBinaryProperty: false,
      additionalParameters: {},
    },
  },
  {
    name: "Apply Site Edit",
    type: "n8n-nodes-base.code",
    typeVersion: 2,
    position: [2220, Y + 1440],
    parameters: { mode: "runOnceForAllItems", jsCode: CODE_APPLY_SITE_EDIT },
  },
  {
    name: "Made Site Changes",
    type: "n8n-nodes-base.if",
    typeVersion: 2.2,
    position: [2380, Y + 1440],
    parameters: ifCond(
      "msc1",
      "={{ $json.path ? 1 : 0 }}",
      { type: "number", operation: "equals" },
      1,
    ),
  },
  {
    name: "Commit Site Edit",
    type: "n8n-nodes-base.github",
    typeVersion: 1.1,
    position: [2540, Y + 1400],
    credentials: {
      githubApi: { id: "5nFNKB7SlRtiwZqO", name: "GitHub account" },
    },
    parameters: {
      resource: "file",
      operation: "edit",
      owner: { __rl: true, value: "danielanderledan-stack", mode: "name" },
      repository: { __rl: true, value: "={{ $json.site }}", mode: "name" },
      filePath: "={{ $json.path }}",
      fileContent: "={{ $json.content }}",
      commitMessage: "={{ $('Site Write Guard').first().json.commitMsg }}",
    },
  },
  {
    name: "Site Edit Reply",
    type: "n8n-nodes-base.code",
    typeVersion: 2,
    position: [2700, Y + 1480],
    settings: { executeOnce: true },
    parameters: { mode: "runOnceForAllItems", jsCode: CODE_SITE_EDIT_REPLY },
  },
  {
    name: "Respond Builder",
    type: "n8n-nodes-base.respondToWebhook",
    typeVersion: 1.1,
    position: [2440, Y],
    parameters: { respondWith: "firstIncomingItem", options: {} },
  },
];

const editorNodes = [
  {
    name: "Load Session",
    type: "n8n-nodes-base.dataTable",
    typeVersion: 1.1,
    position: [1100, 430],
    settings: { alwaysOutputData: true },
    parameters: dtGet("session_token", "={{ $json.body.token }}"),
  },
  {
    name: "Validate Edit Request",
    type: "n8n-nodes-base.code",
    typeVersion: 2,
    position: [1200, 430],
    parameters: { mode: "runOnceForAllItems", jsCode: CODE_VALIDATE_V3 },
  },
  {
    name: "Can Proceed",
    type: "n8n-nodes-base.if",
    typeVersion: 2.2,
    position: [1300, 430],
    parameters: ifCond(
      "cp1",
      "={{ $json.authFailed ? 1 : 0 }}",
      { type: "number", operation: "equals" },
      0,
    ),
  },
  {
    name: "Gate Reply",
    type: "n8n-nodes-base.code",
    typeVersion: 2,
    position: [1500, 530],
    parameters: { mode: "runOnceForAllItems", jsCode: CODE_GATE_REPLY_V3 },
  },
  /* router (new in v3) */
  {
    name: "Build Router Prompt",
    type: "n8n-nodes-base.code",
    typeVersion: 2,
    position: [1440, 330],
    parameters: { mode: "runOnceForAllItems", jsCode: CODE_ROUTER_PROMPT },
  },
  {
    name: "Route Intent",
    type: "@n8n/n8n-nodes-langchain.chainLlm",
    typeVersion: 1.9,
    position: [1580, 330],
    parameters: {
      promptType: "define",
      text: "={{ $json.prompt }}",
      batching: {},
    },
  },
  {
    name: "Router Model",
    type: "@n8n/n8n-nodes-langchain.lmChatOpenRouter",
    typeVersion: 1,
    position: [1580, 480],
    credentials: { openRouterApi: OR_CRED },
    parameters: { model: ROUTER_MODEL, options: {} },
  },
  {
    name: "Parse Route",
    type: "n8n-nodes-base.code",
    typeVersion: 2,
    position: [1720, 330],
    parameters: { mode: "runOnceForAllItems", jsCode: CODE_PARSE_ROUTE },
  },
  {
    name: "Action Switch",
    type: "n8n-nodes-base.if",
    typeVersion: 2.2,
    position: [1860, 330],
    parameters: ifCond(
      "as1",
      "={{ ['text_edit','image_edit','content_edit','preset'].includes($json.intent) ? 1 : 0 }}",
      { type: "number", operation: "equals" },
      1,
    ),
  },
  {
    name: "Charge Gate",
    type: "n8n-nodes-base.if",
    typeVersion: 2.2,
    position: [2000, 280],
    parameters: ifCond(
      "cg1",
      "={{ (!" +
        VREF +
        ".billing || " +
        VREF +
        ".billing.canAfford) ? 1 : 0 }}",
      { type: "number", operation: "equals" },
      1,
    ),
  },
  {
    name: "Free Reply",
    type: "n8n-nodes-base.code",
    typeVersion: 2,
    position: [2000, 430],
    settings: { executeOnce: true },
    parameters: { mode: "runOnceForAllItems", jsCode: CODE_FREE_REPLY },
  },
  {
    /* charges AFTER a successful commit — failed or no-op runs cost nothing */
    name: "Charge Fee",
    type: "n8n-nodes-base.dataTable",
    typeVersion: 1.1,
    position: [3800, 520],
    settings: { alwaysOutputData: true, executeOnce: true },
    parameters: dtUpdate(
      "id",
      "={{ " + VREF + ".billing ? " + VREF + ".billing.rowId : -1 }}",
      {
        account_balance:
          "={{ " + VREF + ".billing ? " + VREF + ".billing.newBalance : '' }}",
      },
    ),
  },
  {
    /* guards Commit Edit from the "no changes applied" item */
    name: "Made Changes",
    type: "n8n-nodes-base.if",
    typeVersion: 2.2,
    position: [3500, 520],
    parameters: ifCond(
      "mc1",
      "={{ $json.path ? 1 : 0 }}",
      { type: "number", operation: "equals" },
      1,
    ),
  },
  {
    /* the GitHub node's operation field can't be an expression — route
       brand-new files (blog posts) to a dedicated file:create node */
    name: "Is New File",
    type: "n8n-nodes-base.if",
    typeVersion: 2.2,
    position: [3650, 520],
    parameters: ifCond(
      "inf1",
      "={{ $json.isNew ? 1 : 0 }}",
      { type: "number", operation: "equals" },
      1,
    ),
  },
  {
    name: "Commit New File",
    type: "n8n-nodes-base.github",
    typeVersion: 1.1,
    position: [3800, 420],
    credentials: {
      githubApi: { id: "5nFNKB7SlRtiwZqO", name: "GitHub account" },
    },
    parameters: {
      resource: "file",
      operation: "create",
      owner: { __rl: true, value: "danielanderledan-stack", mode: "name" },
      repository: {
        __rl: true,
        value: "={{ $('Validate Edit Request').first().json.site }}",
        mode: "name",
      },
      filePath: "={{ $json.path }}",
      fileContent: "={{ $json.content }}",
      commitMessage:
        "={{ 'site edit (new page): ' + $('Validate Edit Request').first().json.message.slice(0, 60) }}",
    },
  },
  {
    name: "Save Chat History",
    type: "n8n-nodes-base.dataTable",
    typeVersion: 1.1,
    position: [4200, 600],
    settings: { alwaysOutputData: true, executeOnce: true },
    parameters: dtUpdate("id", "={{ $json.billingRowId ?? -1 }}", {
      message_history: "={{ $json.newHistory || '' }}",
    }),
  },
  {
    name: "Build Edit Reply",
    type: "n8n-nodes-base.code",
    typeVersion: 2,
    position: [4000, 600],
    settings: { executeOnce: true },
    parameters: { mode: "runOnceForAllItems", jsCode: CODE_BUILD_REPLY_V3 },
  },
  {
    name: "Final Reply",
    type: "n8n-nodes-base.code",
    typeVersion: 2,
    position: [4400, 600],
    settings: { executeOnce: true },
    parameters: { mode: "runOnceForAllItems", jsCode: CODE_FINAL_REPLY_V3 },
  },
  /* owned here so the editor-flow script can't revert it */
  {
    name: "Has Images",
    type: "n8n-nodes-base.if",
    typeVersion: 2.2,
    position: [2280, 280],
    parameters: ifCond(
      "h1",
      "={{ " + VREF + ".images.length }}",
      { type: "number", operation: "gt" },
      0,
    ),
  },
];

const NEW_IN_V3 = new Set([
  "Build Router Prompt",
  "Route Intent",
  "Router Model",
  "Parse Route",
  "Action Switch",
  "Charge Gate",
  "Free Reply",
]);

const accountConnections = [
  ["Builder Webhook", "Route Action"],
  { source: "Route Action", target: "Find User", sourceIndex: 0 },
  { source: "Route Action", target: "Find Session", sourceIndex: 1 },
  { source: "Route Action", target: "Credit Guard", sourceIndex: 2 },
  ["Find User", "Check Login"],
  ["Check Login", "Login OK"],
  { source: "Login OK", target: "Save Session", sourceIndex: 0 },
  { source: "Login OK", target: "Respond Builder", sourceIndex: 1 },
  ["Save Session", "Login Reply"],
  ["Login Reply", "Respond Builder"],
  ["Find Session", "Session Reply"],
  ["Session Reply", "Respond Builder"],
  ["Credit Guard", "Find User Credit"],
  ["Find User Credit", "Apply Credit"],
  ["Apply Credit", "Save Credit"],
  ["Save Credit", "Credit Reply"],
  ["Credit Reply", "Respond Builder"],
  /* image gallery + swap */
  { source: "Route Action", target: "Find Session Images", sourceIndex: 3 },
  { source: "Route Action", target: "Find Session Swap", sourceIndex: 4 },
  ["Find Session Images", "Img Guard"],
  ["Img Guard", "List Img Root"],
  ["List Img Root", "Dir Items"],
  ["Dir Items", "List Img Sub"],
  ["List Img Sub", "List Uploads"],
  ["List Uploads", "Build Image List"],
  ["Build Image List", "Respond Builder"],
  ["Find Session Swap", "Swap Guard"],
  ["Swap Guard", "Commit Swap"],
  ["Commit Swap", "Swap Reply"],
  ["Swap Reply", "Respond Builder"],
  /* text + colour editors */
  { source: "Route Action", target: "Find Session Texts", sourceIndex: 5 },
  { source: "Route Action", target: "Find Session SaveT", sourceIndex: 6 },
  { source: "Route Action", target: "Find Session Colours", sourceIndex: 7 },
  ["Find Session Texts", "Texts Guard"],
  ["Texts Guard", "Get Page Text"],
  ["Get Page Text", "Extract Texts"],
  ["Extract Texts", "Respond Builder"],
  ["Find Session SaveT", "Save Guard"],
  ["Save Guard", "Get Page For Save"],
  ["Get Page For Save", "Apply Texts"],
  ["Apply Texts", "Commit Texts"],
  ["Commit Texts", "Texts Reply"],
  ["Texts Reply", "Respond Builder"],
  ["Find Session Colours", "Colour Guard"],
  ["Colour Guard", "Get Sitemap Colours"],
  ["Get Sitemap Colours", "Colour Pages"],
  ["Colour Pages", "Get Page For Colour"],
  ["Get Page For Colour", "Apply Colours"],
  ["Apply Colours", "Commit Colours"],
  ["Commit Colours", "Colours Reply"],
  ["Colours Reply", "Respond Builder"],
  /* site info + sections + generic site writes */
  { source: "Route Action", target: "Find Session Info", sourceIndex: 8 },
  { source: "Route Action", target: "Find Session Sections", sourceIndex: 9 },
  { source: "Route Action", target: "Find Session Site", sourceIndex: 10 },
  { source: "Route Action", target: "Find Session Site", sourceIndex: 11 },
  { source: "Route Action", target: "Find Session Site", sourceIndex: 12 },
  { source: "Route Action", target: "Find Session Site", sourceIndex: 13 },
  { source: "Route Action", target: "Find Session Site", sourceIndex: 14 },
  ["Find Session Info", "Info Guard"],
  ["Info Guard", "Get Repo Info"],
  ["Get Repo Info", "Get Index Info"],
  ["Get Index Info", "Extract Site Info"],
  ["Extract Site Info", "Respond Builder"],
  ["Find Session Sections", "Sections Guard"],
  ["Sections Guard", "Get Page Sections"],
  ["Get Page Sections", "Extract Sections"],
  ["Extract Sections", "Respond Builder"],
  ["Find Session Site", "Site Write Guard"],
  ["Site Write Guard", "Get Site Sitemap"],
  ["Get Site Sitemap", "Site Pages"],
  ["Site Pages", "Get Page For Site"],
  ["Get Page For Site", "Apply Site Edit"],
  ["Apply Site Edit", "Made Site Changes"],
  { source: "Made Site Changes", target: "Commit Site Edit", sourceIndex: 0 },
  { source: "Made Site Changes", target: "Site Edit Reply", sourceIndex: 1 },
  ["Commit Site Edit", "Site Edit Reply"],
  ["Site Edit Reply", "Respond Builder"],
];

const editorConnections = [
  { source: "Can Proceed", target: "Build Router Prompt", sourceIndex: 0 },
  { source: "Can Proceed", target: "Gate Reply", sourceIndex: 1 },
  ["Build Router Prompt", "Route Intent"],
  {
    source: "Router Model",
    target: "Route Intent",
    connectionType: "ai_languageModel",
  },
  ["Route Intent", "Parse Route"],
  ["Parse Route", "Action Switch"],
  { source: "Action Switch", target: "Charge Gate", sourceIndex: 0 },
  { source: "Action Switch", target: "Free Reply", sourceIndex: 1 },
  { source: "Charge Gate", target: "Has Images", sourceIndex: 0 },
  { source: "Charge Gate", target: "Gate Reply", sourceIndex: 1 },
  ["Free Reply", "Save Chat History"],
  ["Gate Reply", "Respond Edit"],
  /* charge only after edits were actually committed */
  ["Apply Edits", "Made Changes"],
  { source: "Made Changes", target: "Is New File", sourceIndex: 0 },
  { source: "Made Changes", target: "Build Edit Reply", sourceIndex: 1 },
  { source: "Is New File", target: "Commit New File", sourceIndex: 0 },
  { source: "Is New File", target: "Commit Edit", sourceIndex: 1 },
  ["Commit New File", "Charge Fee"],
  ["Commit Edit", "Charge Fee"],
  ["Charge Fee", "Build Edit Reply"],
  ["Build Edit Reply", "Save Chat History"],
  ["Save Chat History", "Final Reply"],
  ["Final Reply", "Respond Edit"],
];

/* ---------------- apply ---------------- */

const mode = process.argv[2] || "create";
const ops = [];
const allNodes = [...accountNodes, ...editorNodes];

function addNodeOps(nodeList) {
  for (const n of nodeList) {
    const { settings, ...node } = n;
    ops.push({ type: "addNode", node });
    if (settings)
      ops.push({ type: "setNodeSettings", nodeName: n.name, settings });
  }
}
function updateOps(nodeList) {
  for (const n of nodeList) {
    ops.push({
      type: "updateNodeParameters",
      nodeName: n.name,
      parameters: n.parameters,
      replace: true,
    });
    if (n.settings)
      ops.push({
        type: "setNodeSettings",
        nodeName: n.name,
        settings: n.settings,
      });
  }
}

if (mode === "update") {
  updateOps(allNodes);
} else if (mode === "migrate") {
  /* v2 -> v3: add router nodes, rewire the charge, update changed params */
  addNodeOps(editorNodes.filter((n) => NEW_IN_V3.has(n.name)));
  ops.push({
    type: "removeConnection",
    source: "Can Proceed",
    target: "Charge Fee",
  });
  for (const c of editorConnections) {
    ops.push(
      Array.isArray(c)
        ? { type: "addConnection", source: c[0], target: c[1] }
        : { type: "addConnection", ...c },
    );
  }
  updateOps(
    allNodes.filter(
      (n) =>
        !NEW_IN_V3.has(n.name) &&
        [
          "Validate Edit Request",
          "Gate Reply",
          "Charge Fee",
          "Save Chat History",
          "Build Edit Reply",
          "Final Reply",
          "Has Images",
        ].includes(n.name),
    ),
  );
} else if (mode !== "reconcile") {
  addNodeOps(allNodes);
  for (const c of [...accountConnections, ...editorConnections]) {
    ops.push(
      Array.isArray(c)
        ? { type: "addConnection", source: c[0], target: c[1] }
        : { type: "addConnection", ...c },
    );
  }
  ops.push({
    type: "addConnection",
    source: "Edit Webhook",
    target: "Load Session",
  });
  ops.push({
    type: "addConnection",
    source: "Load Session",
    target: "Validate Edit Request",
  });
  ops.push({
    type: "addConnection",
    source: "Validate Edit Request",
    target: "Can Proceed",
  });
}

if (mode === "reconcile") {
  /* Diff against the LIVE workflow: add missing nodes/connections, refresh
     params of owned nodes, remove stale legacy wiring. Survives manual UI
     edits and version restores. */
  const live = JSON.parse(
    execFileSync(
      process.execPath,
      [
        path.join(__dirname, "n8n-mcp.cjs"),
        "get_workflow_details",
        JSON.stringify({ workflowId: WORKFLOW_ID }),
      ],
      { encoding: "utf8", maxBuffer: 64e6 },
    ),
  ).workflow;
  const liveNames = new Set(live.nodes.map((n) => n.name));
  const hasConn = (src, tgt, type, si) => {
    const c = live.connections[src];
    const lists = (c && c[type || "main"]) || [];
    const list = lists[si || 0] || [];
    return list.some((t) => t && t.node === tgt);
  };

  for (const n of allNodes) {
    if (liveNames.has(n.name)) {
      ops.push({
        type: "updateNodeParameters",
        nodeName: n.name,
        parameters: n.parameters,
        replace: true,
      });
      if (n.credentials) {
        const key = Object.keys(n.credentials)[0];
        ops.push({
          type: "setNodeCredential",
          nodeName: n.name,
          credentialKey: key,
          credentialId: n.credentials[key].id,
          credentialName: n.credentials[key].name,
        });
      }
    } else {
      const { settings, ...node } = n;
      ops.push({ type: "addNode", node });
    }
    if (n.settings)
      ops.push({
        type: "setNodeSettings",
        nodeName: n.name,
        settings: n.settings,
      });
  }

  /* stale direct wiring from older topologies */
  const stale = [
    ["Edit Webhook", "Validate Edit Request"],
    ["Validate Edit Request", "Has Images"],
    ["Build Edit Reply", "Respond Edit"],
    ["Can Proceed", "Charge Fee"],
    ["Made Changes", "Commit Edit"],
    /* v3.1: charge moved to post-commit */
    ["Charge Gate", "Charge Fee"],
    ["Charge Fee", "Has Images"],
    ["Apply Edits", "Commit Edit"],
    ["Commit Edit", "Build Edit Reply"],
  ];
  for (const [s, t] of stale) {
    if (hasConn(s, t))
      ops.push({ type: "removeConnection", source: s, target: t });
  }

  const wanted = [
    ...accountConnections,
    ...editorConnections,
    ["Edit Webhook", "Load Session"],
    ["Load Session", "Validate Edit Request"],
    ["Validate Edit Request", "Can Proceed"],
  ];
  for (const c of wanted) {
    const o = Array.isArray(c) ? { source: c[0], target: c[1] } : c;
    if (!hasConn(o.source, o.target, o.connectionType, o.sourceIndex)) {
      ops.push({ type: "addConnection", ...o });
    }
  }
}

/* the MCP tool caps operations at 100 — apply in ordered batches
   (reconcile is idempotent, so a mid-run failure is safely re-runnable) */
console.log("mode:", mode, "— ops:", ops.length, "— applying...");
for (let i = 0; i < ops.length; i += 90) {
  const batch = ops.slice(i, i + 90);
  fs.writeFileSync(
    path.join(__dirname, "builder-ops.json"),
    JSON.stringify({ workflowId: WORKFLOW_ID, operations: batch }),
  );
  const out = execFileSync(
    process.execPath,
    [
      path.join(__dirname, "n8n-mcp.cjs"),
      "update_workflow",
      "@" + path.join(__dirname, "builder-ops.json"),
    ],
    { encoding: "utf8" },
  );
  console.log("batch", i / 90 + 1, ":", out.slice(0, 200).replace(/\s+/g, " "));
}
