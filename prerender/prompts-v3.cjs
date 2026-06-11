/* Replaces the four big prompt/code constants in editor-flow.cjs with the
   v3 versions (intent specialization, presets, NEWFILE blog support,
   humanized replies). Run once: node prerender/prompts-v3.cjs */
"use strict";
const fs = require("fs");
const FILE = "prerender/editor-flow.cjs";

const HUMANIZER = [
  "REPLY STYLE: you are Dan's website assistant — sound like a friendly, busy Aussie texting a client.",
  'First person, contractions, short warm sentences, no corporate fluff, no emojis, never "I have successfully", never mention being an AI, files, code or paths.',
].join(" ");

const PLANNER = `
// Assembles the planner prompt. Edit freely — this is plain text in, JSON out.
const req = $('Validate Edit Request').first().json;
let route = { intent: 'text_edit' };
try { route = $('Parse Route').first().json; } catch (e) {}

// page list from sitemap.xml (fallback: the standard generated page set)
let pages = ['index.html', 'about/index.html', 'services/index.html', 'pricing/index.html', 'blog/index.html', 'contact/index.html'];
try {
  const sm = Buffer.from($('Get Sitemap').first().json.content, 'base64').toString('utf8');
  const urls = [...sm.matchAll(/<loc>([^<]+)<\\/loc>/g)].map((m) => new URL(m[1]).pathname);
  if (urls.length) pages = urls.map((p) => (p.replace(/^\\/+|\\/+$/g, '') ? p.replace(/^\\/+|\\/+$/g, '') + '/index.html' : 'index.html'));
} catch (e) {}

let guide = '';
try {
  const g = $('Get Editing Guide').first().json;
  if (g && g.content) guide = Buffer.from(g.content, 'base64').toString('utf8');
} catch (e) {}

const isPreset = route.intent === 'preset';
const editable = [...pages, 'assets/site.css', ...(isPreset ? ['sitemap.xml'] : [])];

const INTENT_RULES = {
  text_edit: 'This is a TEXT change (wording, headings, prices, contact details, typo fixes). Change text and attribute values only — no structural/markup redesign. Keep edits tight.',
  image_edit: 'This is an IMAGE change (add/swap/remove an image). Use ONLY the uploaded image paths listed above or images already on the site — never invent a path. "Header image" / "main image" means the home page hero slide image.',
  content_edit: 'This is a CONTENT improvement, limited to ONE section of ONE page. Pick the single most relevant section. If the request actually spans multiple sections or pages, do NOT edit: set files_to_edit to [] and reply that bigger reworks are best done by Dan personally on 0432 839 654 (no charge for asking).',
  preset: [
    'This is a CURATED PRESET job — follow the preset instructions in the message exactly. Preset notes:',
    '- [PRESET: quote-only]: remove/hide all specific dollar amounts across pages (pricing cards, price lists, calculator) and re-word pricing CTAs to "Get a free quote". You may edit up to 8 files.',
    '- [PRESET: colours]: change the four CSS variables (--color-primary, --color-primary-rgb, --color-primary-hover, --color-secondary) in the <html> style attribute of EVERY page. primary-rgb is the primary hex as "r, g, b"; primary-hover is primary darkened ~12%. Edit every page file.',
    '- [PRESET: offer]: add or update a special-offer line on the home page (hero subheading or banner section) with the offer text given. One page only.',
    '- [PRESET: blog]: write a NEW blog post. files_to_edit MUST be ["blog/index.html", "blog/1/index.html"] (the listing + a reference post). Plan: create blog/<next-number>/index.html cloned from the reference post structure (same head/nav/footer/sections, new title/date/body), add a matching card to the blog listing, and add the new URL to sitemap.xml (also include "sitemap.xml" in files_to_edit). Use todays date.',
  ].join('\\n'),
};

const prompt = [
  'You are the PLANNING agent of a website editing assistant. Customers of a web agency chat with you to change their own small-business website (fully static HTML, no build step).',
  '',
  '== SITE FILES (editable) ==',
  editable.join('\\n'),
  '',
  guide ? '== EDITING GUIDE (how this site is structured) ==\\n' + guide : '',
  '',
  req.imagePaths.length ? '== IMAGES THE CUSTOMER JUST UPLOADED (already live at these absolute paths) ==\\n' + req.imagePaths.join('\\n') : '',
  '',
  '== CONVERSATION SO FAR ==',
  req.history.map((m) => m.role.toUpperCase() + ': ' + m.content).join('\\n') || '(first message)',
  '',
  '== CUSTOMER MESSAGE ==',
  req.message,
  '',
  '== REQUEST TYPE (pre-classified) ==',
  route.intent,
  INTENT_RULES[route.intent] || INTENT_RULES.text_edit,
  '',
  '== YOUR JOB ==',
  '1. Plan the edit. Pick the file(s) to change — usually ONE page' + (isPreset ? ' (presets may span more, see notes)' : ', never more than 4') + '. Page URLs map to files: / -> index.html, /about/ -> about/index.html.',
  '2. Write a concrete implementation plan: which sections (pages contain <!-- SECTION: name --> markers), exact text/markup changes, which images to use. Constraints the implementer must keep: data-cd attributes, CSS variables for theme colors, hero captions exist both in <h1 data-cd="hero-title"> AND the matching slide data-title, page <head> (title/description/og/JSON-LD) stays consistent with visible changes.',
  '3. If the uploaded-images section is present, the customer DID attach image(s) this turn — never claim otherwise; plan with those exact paths.',
  '4. If anything is unclear, ask in reply and files_to_edit MUST be [] — never edit while asking. If the request is really MAJOR work (redesign, new features, many sections), files_to_edit [] and point them to Dan on 0432 839 654.',
  '5. ' + ${JSON.stringify("HUMANIZER_SLOT")},
  '',
  'Output ONLY a JSON object, no markdown fences:',
  '{"reply": "<what you tell the customer>", "files_to_edit": ["index.html"], "plan": "<detailed notes for the implementer>"}',
].join('\\n');

return [{ json: { prompt, editable, isPreset } }];
`.trim();

const PARSE_PLAN = `
// Extracts the planner's JSON and validates the file list.
let raw = String($json.text || '');
const tIdx = raw.lastIndexOf('</think>');
if (tIdx !== -1) raw = raw.slice(tIdx + 8);
const m = raw.match(/\\{[\\s\\S]*\\}/);
if (!m) throw new Error('Planner returned no JSON: ' + raw.slice(0, 300));
let plan;
try { plan = JSON.parse(m[0]); } catch (e) { throw new Error('Planner JSON invalid: ' + m[0].slice(0, 300)); }

const src = $('Build Planner Prompt').first().json;
const editable = new Set(src.editable);
const cap = src.isPreset ? 8 : 4;
const files = (Array.isArray(plan.files_to_edit) ? plan.files_to_edit : [])
  .map(String).filter((p) => editable.has(p)).slice(0, cap);

return [{ json: {
  reply: String(plan.reply || 'Done.'),
  plan: String(plan.plan || ''),
  files,
} }];
`.trim();

const IMPL = `
// Assembles the implementer prompt with full file contents.
const req = $('Validate Edit Request').first().json;
const plan = $('Parse Plan').first().json;
const files = {};
for (const item of $input.all()) {
  files[item.json.path] = Buffer.from(item.json.content, 'base64').toString('utf8');
}

const fileBlocks = Object.entries(files)
  .map(([p, c]) => '== FILE: ' + p + ' ==\\n' + c)
  .join('\\n\\n');

const prompt = [
  'You are the IMPLEMENTATION agent of a website editing assistant. Apply the plan below to the given files by producing exact SEARCH/REPLACE edits.',
  '',
  '== CUSTOMER MESSAGE ==',
  req.message,
  '',
  '== PLAN (from the planning agent) ==',
  plan.plan,
  '',
  req.imagePaths.length ? '== UPLOADED IMAGE PATHS (use exactly these in src attributes) ==\\n' + req.imagePaths.join('\\n') : '',
  '',
  fileBlocks,
  '',
  '== OUTPUT FORMAT (follow EXACTLY) ==',
  'For each edit output a block:',
  '<<<FILE index.html',
  '<<<SEARCH',
  '(exact contiguous lines copied verbatim from that file — must be unique in the file; keep it as short as possible while unique)',
  '===',
  '(the replacement lines)',
  '>>>',
  'To CREATE a brand-new file (ONLY when the plan says to, e.g. a new blog post page) output instead:',
  '<<<NEWFILE blog/5/index.html',
  '(the complete file content)',
  '>>>',
  'Repeat blocks as needed. After all blocks output:',
  '<<<REPLY',
  '(one or two sentences telling the customer what changed)',
  '>>>',
  '',
  '== RULES ==',
  '- SEARCH text must match the file byte-for-byte (same indentation, quotes, entities). Copy it, never retype it.',
  '- Never remove or rename data-cd attributes or <!-- SECTION --> comments.',
  '- Colors that should follow the site theme must use var(--color-primary) etc., never hard-coded copies of theme colors.',
  '- Hero heading changes: update BOTH the <h1 data-cd="hero-title"> text AND the matching data-title attribute on the first [data-cd="slide"].',
  '- If visible business info changes (name, suburb, services), also update the page <title>, meta description and og: tags in the same page.',
  '- NEVER invent or alter image filenames/paths. An <img src> or background-image value may ONLY be: (a) one of the UPLOADED IMAGE PATHS above copied character-for-character, (b) a path that already appears in the provided files, or (c) an https URL the customer explicitly gave. Anything else 404s and the live site swaps in a random placeholder photo.',
  '- NEWFILE paths must be blog/<number>/index.html only; model the page on the provided reference post (keep its head structure, nav, footer, css link, site.js) with new content.',
  '- Give every <img> meaningful alt text. Use loading="lazy" except above-the-fold.',
  '- Keep HTML valid; keep the existing inline-style coding style of the file.',
  '- ' + ${JSON.stringify("HUMANIZER_SLOT")},
].join('\\n');

return [{ json: { prompt, files } }];
`.trim();

const APPLY = `
// Parses SEARCH/REPLACE + NEWFILE blocks and applies them.
let out = String($json.text || '');
const tIdx2 = out.lastIndexOf('</think>');
if (tIdx2 !== -1) out = out.slice(tIdx2 + 8);
const src = $('Build Implementer Prompt').first().json;
const files = { ...src.files };

const blockRe = /<<<FILE ([^\\n]+)\\n<<<SEARCH\\n([\\s\\S]*?)\\n===\\n([\\s\\S]*?)\\n>>>/g;
const newFileRe = /<<<NEWFILE ([^\\n]+)\\n([\\s\\S]*?)\\n>>>/g;
const replyRe = /<<<REPLY\\n([\\s\\S]*?)\\n?>>>/;

const applied = [];
const failed = [];
let m;
while ((m = blockRe.exec(out)) !== null) {
  const file = m[1].trim();
  const search = m[2];
  const replace = m[3];
  if (!(file in files)) { failed.push(file + ': not in fetched files'); continue; }
  if (files[file].includes(search)) {
    files[file] = files[file].replace(search, replace);
    applied.push(file);
    continue;
  }
  const norm = (s) => s.replace(/\\r/g, '').split('\\n').map((l) => l.replace(/\\s+$/, '')).join('\\n');
  const normFile = norm(files[file]);
  const normSearch = norm(search);
  const idx = normFile.indexOf(normSearch);
  if (idx !== -1) {
    const pre = normFile.slice(0, idx).split('\\n').length - 1;
    const lines = files[file].split('\\n');
    const span = normSearch.split('\\n').length;
    lines.splice(pre, span, ...replace.split('\\n'));
    files[file] = lines.join('\\n');
    applied.push(file);
  } else {
    failed.push(file + ': SEARCH text not found');
  }
}

// brand-new files (blog posts only)
const created = {};
while ((m = newFileRe.exec(out)) !== null) {
  const file = m[1].trim();
  if (!/^blog\\/\\d+\\/index\\.html$/.test(file)) { failed.push(file + ': NEWFILE path not allowed'); continue; }
  if (file in files) { failed.push(file + ': NEWFILE already exists'); continue; }
  created[file] = m[2];
  applied.push(file);
}

const replyM = out.match(replyRe);
const reply = replyM ? replyM[1].trim() : $('Parse Plan').first().json.reply;

const changed = [...new Set(applied)];
if (!changed.length) {
  return [{ json: { noChanges: true, reply: 'Sorry — I could not make that change automatically. Could you describe it a little differently?', failures: failed } }];
}
return changed.map((p) => ({ json: {
  path: p,
  content: created[p] !== undefined ? created[p] : files[p],
  isNew: created[p] !== undefined,
  reply, failures: failed,
} }));
`.trim();

/* ---- splice the constants into editor-flow.cjs ---- */
let s = fs.readFileSync(FILE, "utf8");
function spliceConst(name, body) {
  // body is the FINAL jsCode value — re-escape it so editor-flow.cjs's own
  // template literal evaluates back to exactly this value
  const esc = body
    .replace(/\\/g, "\\\\")
    .replace(/`/g, "\\`")
    .replace(/\$\{/g, "\\${");
  const re = new RegExp("const " + name + " = `[\\s\\S]*?`.trim\\(\\);");
  if (!re.test(s)) throw new Error(name + " span not found");
  s = s.replace(re, "const " + name + " = `\n" + esc + "\n`.trim();");
}
const fix = (b) =>
  b.split(JSON.stringify("HUMANIZER_SLOT")).join(JSON.stringify(HUMANIZER));
spliceConst("CODE_PLANNER_PROMPT", fix(PLANNER));
spliceConst("CODE_PARSE_PLAN", PARSE_PLAN);
spliceConst("CODE_IMPL_PROMPT", fix(IMPL));
spliceConst("CODE_APPLY_EDITS", APPLY);

/* Commit Edit gains create-vs-edit per item */
s = s.replace(
  /operation: "edit",/,
  "operation: \"={{ $json.isNew ? 'create' : 'edit' }}\",",
);

fs.writeFileSync(FILE, s);
console.log(
  "spliced. checks:",
  s.includes("REQUEST TYPE (pre-classified)"),
  s.includes("NEWFILE blog"),
  s.includes("isNew ? 'create'"),
  s.includes("busy Aussie"),
);
