/* ============================================================================
   blog-ops — create / delete blog posts on a prerendered customer site.
   Drop-in core for the n8n builder-auth "create-blog-post" / "delete-blog-post"
   Code nodes (n8n has jsdom globally; pass it in, or it falls back to require).

   A customer site's blog is three coupled artefacts:
     - blog/index.html          the listing page (a grid of <a class="blog-card">)
     - blog/<N>/index.html      one file per post, already data-ce tagged
     - sitemap.xml              one <loc>.../blog/<N>/</loc> per post

   create-blog-post produces, IDEMPOTENTLY and with minimal diff:
     1. a NEW blog/<next>/index.html  — cloned from an existing post's structure,
        re-titled, with a single placeholder body paragraph (so the customer then
        edits it through the normal data-ce text/image flow);
     2. ONE new <a class="blog-card"> spliced into blog/index.html (first in grid);
     3. ONE new <url><loc>…/blog/<next>/</loc></url> spliced into sitemap.xml.

   Existing post pages are NEVER touched. blog/index.html and sitemap.xml are
   edited by STRING SPLICING (not a jsdom round-trip) so every existing byte is
   preserved — the diff is exactly the inserted card + the inserted sitemap line.
   The new post page is built in jsdom and serialized via serialize-doc so its
   formatting matches fresh fuse output (and the editor can tag it cleanly).

   Contract (inputs the n8n guard assembles from the webhook body):
     applyCreateBlogPost({
       blogIndex : { path:'blog/index.html', content:<utf8> },   // required
       sample    : { path:'blog/<n>/index.html', content:<utf8> },// an existing post to clone (required)
       sitemap   : { path:'sitemap.xml', content:<utf8> } | null, // optional
       existing  : ['blog/1/index.html', ...],                    // every blog/<n>/index.html that exists
       title     : 'My new post',                                  // optional (placeholder if blank)
       JSDOM     : <jsdom.JSDOM>,                                  // optional (require fallback)
     }) -> { ok, num, files:[{path,content}], cardAppended, sitemapAppended, notes }

   Each returned file is committed by the workflow (create for the new post page,
   edit for blog/index.html + sitemap.xml).
   ============================================================================ */
"use strict";

let serializeDoc, protectClamps, restoreClamps;
try {
  ({
    serializeDoc,
    protectClamps,
    restoreClamps,
  } = require("./serialize-doc.cjs"));
} catch (e) {
  // n8n Code node: serialize-doc is inlined below as a fallback.
}

/* ---- minimal fuse-matching serializer fallback (mirrors serialize-doc.cjs) ---- */
const VOID_TAGS = new Set([
  "area",
  "base",
  "br",
  "col",
  "embed",
  "hr",
  "img",
  "input",
  "link",
  "meta",
  "param",
  "source",
  "track",
  "wbr",
]);
function _openTag(el) {
  let attrs = "";
  for (const at of el.attributes)
    attrs +=
      " " +
      at.name +
      '="' +
      at.value.replace(/&/g, "&amp;").replace(/"/g, "&quot;") +
      '"';
  return "<" + el.tagName.toLowerCase() + attrs + ">";
}
function _isElementOnly(el) {
  let any = false;
  for (const ch of el.childNodes) {
    if (ch.nodeType === 3 && ch.textContent.trim() !== "") return false;
    if (ch.nodeType === 1 || ch.nodeType === 8) any = true;
  }
  return any;
}
function _fmtNode(node, indent, out) {
  if (node.nodeType === 8) {
    out.push(indent + "<!--" + node.textContent + "-->");
    return;
  }
  if (node.nodeType === 3) {
    const t = node.textContent.trim();
    if (t) out.push(indent + t);
    return;
  }
  if (node.nodeType !== 1) return;
  const tag = node.tagName.toLowerCase();
  if (tag === "script" || tag === "style") {
    const txt = node.textContent.trim();
    if (txt) {
      out.push(indent + _openTag(node));
      out.push(txt);
      out.push(indent + "</" + tag + ">");
    } else out.push(indent + _openTag(node) + "</" + tag + ">");
    return;
  }
  if (VOID_TAGS.has(tag)) {
    out.push(indent + _openTag(node));
    return;
  }
  if (!node.childNodes.length) {
    out.push(indent + _openTag(node) + "</" + tag + ">");
    return;
  }
  if (_isElementOnly(node)) {
    out.push(indent + _openTag(node));
    for (const ch of node.childNodes) _fmtNode(ch, indent + "  ", out);
    out.push(indent + "</" + tag + ">");
  } else {
    out.push(indent + node.outerHTML);
  }
}
function _serializeDocFallback(doc) {
  const out = ["<!DOCTYPE html>"];
  _fmtNode(doc.documentElement, "", out);
  return out.join("\n") + "\n";
}
function _protectClampsFallback(html) {
  const map = new Map();
  const out = String(html).replace(/(?:clamp|min|max)\([^()]*\)/g, (expr) => {
    let key = null;
    for (const [k, v] of map) if (v === expr) key = k;
    if (!key) {
      key = "var(--cdclamp-" + map.size + ")";
      map.set(key, expr);
    }
    return key;
  });
  return { html: out, map };
}
function _restoreClampsFallback(html, map) {
  for (const [key, expr] of map) html = html.split(key).join(expr);
  return html;
}
const _serialize = (doc) => (serializeDoc || _serializeDocFallback)(doc);
const _protect = (html) => (protectClamps || _protectClampsFallback)(html);
const _restore = (html, map) =>
  (restoreClamps || _restoreClampsFallback)(html, map);

/* -------------------- helpers -------------------- */
function _esc(s) {
  return String(s == null ? "" : s)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}
function _escAttr(s) {
  return _esc(s).replace(/"/g, "&quot;");
}
function _stripTags(s) {
  return String(s == null ? "" : s)
    .replace(/<[^>]+>/g, "")
    .replace(/\s+/g, " ")
    .trim();
}
// Next post number = max(existing N) + 1, min 1. Robust to gaps.
function nextPostNum(existing) {
  let max = 0;
  for (const p of existing || []) {
    const m =
      String(p).match(/blog\/(\d+)\/index\.html$/i) ||
      String(p).match(/^(\d+)$/);
    if (m) max = Math.max(max, parseInt(m[1], 10) || 0);
  }
  return max + 1;
}

/* -------------------- build the NEW post page (pure string; eval-safe) --------------------
   The sample post is ALREADY fuse-formatted, so we edit it with targeted string
   replacements and DON'T re-serialize — every untouched byte is preserved, and we
   never parse the full page in jsdom. (A full-page `new JSDOM(html)` crashes in the
   n8n Code-node sandbox: inserting the page's <link> tags makes jsdom resolve the
   document baseURL via querySelector('base'), whose CSS engine compiles selectors
   with `new Function` — "Code generation from strings disallowed". So: zero jsdom.) */
function buildPostPage(JSDOM, sampleHtml, num, title, opts) {
  opts = opts || {};
  const safeTitle = _stripTags(title) || "New blog post — edit me";
  let html = String(sampleHtml);

  // -- canonical URL base (from the sample's canonical / og:url; attr order-agnostic) --
  let srcUrl = "";
  let m =
    html.match(/<link\b[^>]*\brel="canonical"[^>]*\bhref="([^"]*)"/i) ||
    html.match(/<link\b[^>]*\bhref="([^"]*)"[^>]*\brel="canonical"/i);
  if (m) srcUrl = m[1];
  if (!srcUrl) {
    m =
      html.match(/<meta\b[^>]*\bproperty="og:url"[^>]*\bcontent="([^"]*)"/i) ||
      html.match(/<meta\b[^>]*\bcontent="([^"]*)"[^>]*\bproperty="og:url"/i);
    if (m) srcUrl = m[1];
  }
  let base = "";
  const bm = srcUrl.match(/^(https?:\/\/[^/]+)/);
  if (bm) base = bm[1];
  const newUrl = base ? base + "/blog/" + num + "/" : "/blog/" + num + "/";

  // Brand suffix taken from the existing <title> ("…Headline… | Brand")
  const tm = html.match(/<title>([\s\S]*?)<\/title>/i);
  const oldTitle = tm ? tm[1] : "";
  const brand =
    oldTitle.indexOf("|") >= 0
      ? oldTitle.slice(oldTitle.lastIndexOf("|") + 1).trim()
      : "";
  const pageTitle = brand ? safeTitle + " | " + brand : safeTitle;
  const desc = "A new article — open the editor to write it.";

  // -- head: title, description, canonical, og/twitter url+title+description --
  html = html.replace(
    /<title>[\s\S]*?<\/title>/i,
    "<title>" + _esc(pageTitle) + "</title>",
  );
  html = _setMetaStr(html, "name", "description", desc);
  html = _setMetaStr(html, "property", "og:title", pageTitle);
  html = _setMetaStr(html, "property", "og:description", desc);
  html = _setMetaStr(html, "property", "og:url", newUrl);
  html = _setMetaStr(html, "name", "twitter:title", pageTitle);
  html = _setMetaStr(html, "name", "twitter:description", desc);
  html = html
    .replace(
      /(<link\b[^>]*\brel="canonical"[^>]*\bhref=")[^"]*(")/i,
      "$1" + _escAttr(newUrl) + "$2",
    )
    .replace(
      /(<link\b[^>]*\bhref=")[^"]*("[^>]*\brel="canonical")/i,
      "$1" + _escAttr(newUrl) + "$2",
    );

  // -- hero heading + date line (data-ce text) --
  html = _replaceCeInner(html, /data-ce="s0-h1-1"/, _esc(safeTitle));
  const monthYear = new Date().toLocaleDateString("en-AU", {
    month: "long",
    year: "numeric",
  });
  html = _replaceCeInner(html, /data-ce="s0-p-1"/, _esc(monthYear));

  // -- feature image alt (keep src so it renders; customer swaps it) --
  html = _setCeImgAlt(html, "s1-img-1", safeTitle);

  // -- body: collapse the cloned paragraphs to a SINGLE placeholder --
  html = _collapseBodyParas(
    html,
    "s1-p-",
    "Write your article here. Click this text in the editor to replace it with your own — share a tip, answer a common customer question, or talk about a recent job. Add as much as you like.",
  );

  return { html, url: newUrl, title: safeTitle, desc, monthYear, brand, base };
}

/* ---- pure-string DOM helpers (eval-safe: no querySelector / no full-page parse) ---- */
// Set the `content` of the <meta> whose attribute key="val" (order-independent;
// inserts a content attr if the tag has none).
function _setMetaStr(html, key, val, content) {
  const kr = new RegExp(
    "\\b" + key + '="' + val.replace(/[.*+?^${}()|[\]\\]/g, "\\$&") + '"',
    "i",
  );
  return html.replace(/<meta\b[^>]*>/gi, (tag) => {
    if (!kr.test(tag)) return tag;
    if (/\bcontent="/i.test(tag))
      return tag.replace(
        /(\bcontent=")[^"]*(")/i,
        "$1" + _escAttr(content) + "$2",
      );
    return tag.replace(/\s*\/?>$/, ' content="' + _escAttr(content) + '">');
  });
}

// Set the alt of the <img> carrying data-ce="ceId" (insert alt if missing).
function _setCeImgAlt(html, ceId, alt) {
  const m = new RegExp('data-ce="' + ceId + '"').exec(html);
  if (!m) return html;
  const ts = html.lastIndexOf("<", m.index);
  const gt = html.indexOf(">", m.index);
  if (ts === -1 || gt === -1) return html;
  let tag = html.slice(ts, gt + 1);
  if (/\balt="/i.test(tag))
    tag = tag.replace(/(\balt=")[^"]*(")/i, "$1" + _escAttr(alt) + "$2");
  else tag = tag.replace(/\s*\/?>$/, ' alt="' + _escAttr(alt) + '">');
  return html.slice(0, ts) + tag + html.slice(gt + 1);
}

// Remove the whole element carrying data-ce="ceId" (depth-matched, plus a leading
// blank line so the diff stays clean).
function _removeCeElement(html, ceId) {
  const m = new RegExp('data-ce="' + ceId + '"').exec(html);
  if (!m) return html;
  const ts = html.lastIndexOf("<", m.index);
  if (ts === -1) return html;
  const tm = /^<([a-zA-Z0-9]+)/.exec(html.slice(ts));
  if (!tm) return html;
  const tag = tm[1].toLowerCase();
  const gt = html.indexOf(">", m.index);
  if (gt === -1) return html;
  const openRe = new RegExp("<" + tag + "\\b", "gi");
  const closeRe = new RegExp("</" + tag + "\\s*>", "gi");
  let depth = 1,
    pos = gt + 1,
    endIdx = -1;
  while (depth > 0) {
    openRe.lastIndex = pos;
    closeRe.lastIndex = pos;
    const o = openRe.exec(html),
      c = closeRe.exec(html);
    if (!c) break;
    if (o && o.index < c.index) {
      depth++;
      pos = o.index + 1;
    } else {
      depth--;
      if (depth === 0) endIdx = c.index + c[0].length;
      pos = c.index + c[0].length;
    }
  }
  if (endIdx === -1) return html;
  let from = ts;
  const ls = html.lastIndexOf("\n", ts - 1);
  if (ls !== -1 && html.slice(ls + 1, ts).trim() === "") from = ls;
  return html.slice(0, from) + html.slice(endIdx);
}

// Collapse a run of data-ce="{prefix}{n}" elements to ONE: the first gets the
// placeholder text, the rest are removed (last->first so indices stay valid).
function _collapseBodyParas(html, prefix, placeholder) {
  const re = new RegExp(
    'data-ce="(' + prefix.replace(/[-]/g, "\\$&") + '\\d+)"',
    "gi",
  );
  const ids = [];
  let mm;
  while ((mm = re.exec(html))) ids.push(mm[1]);
  if (!ids.length) return html;
  for (let i = ids.length - 1; i >= 1; i--)
    html = _removeCeElement(html, ids[i]);
  html = _replaceCeInner(
    html,
    new RegExp('data-ce="' + ids[0] + '"'),
    _esc(placeholder),
  );
  return html;
}

/* -------------------- splice a NEW card into blog/index.html -------------------- */
// String-spliced so every existing byte is preserved. Clones the first existing
// <a class="blog-card"> … </a>, rewrites href/title/desc/date/img-alt, and
// inserts it as the FIRST card inside the grid (right after the grid's open tag).
function buildCard(blogIndexHtml, num, post) {
  // Locate the first blog-card anchor and its matching close tag (depth-counted).
  const startRe = /<a\b[^>]*class="[^"]*\bblog-card\b[^"]*"[^>]*>/i;
  const sm = startRe.exec(blogIndexHtml);
  if (!sm) return { ok: false, reason: "no blog-card template found" };
  const openIdx = sm.index;
  // depth-match <a> … </a>
  const aOpen = /<a\b/gi,
    aClose = /<\/a\s*>/gi;
  let depth = 1,
    pos = openIdx + sm[0].length;
  let endIdx = -1;
  while (depth > 0) {
    aOpen.lastIndex = pos;
    aClose.lastIndex = pos;
    const o = aOpen.exec(blogIndexHtml);
    const c = aClose.exec(blogIndexHtml);
    if (!c) break;
    if (o && o.index < c.index) {
      depth++;
      pos = o.index + 2;
    } else {
      depth--;
      if (depth === 0) {
        endIdx = c.index + c[0].length;
      }
      pos = c.index + c[0].length;
    }
  }
  if (endIdx === -1)
    return { ok: false, reason: "blog-card template not closed" };

  let card = blogIndexHtml.slice(openIdx, endIdx);
  const indent = (function () {
    const ls = blogIndexHtml.lastIndexOf("\n", openIdx);
    return blogIndexHtml.slice(ls + 1, openIdx).match(/^\s*/)[0];
  })();

  // Rewrite the clone:
  // 1) href -> /blog/<num>/
  card = card.replace(/(<a\b[^>]*\bhref=")[^"]*(")/i, "$1/blog/" + num + "/$2");
  // 2) heading (data-ce s1-h2-*) inner text -> new title
  card = _replaceCeInner(card, /data-ce="s1-h2-\d+"/, _esc(post.title));
  // 3) description (data-ce s1-p-*) inner text -> placeholder excerpt
  card = _replaceCeInner(
    card,
    /data-ce="s1-p-\d+"/,
    "A new article — open the editor to write it.",
  );
  // 4) image alt + data-ce id collision: leave src, update alt
  card = card.replace(
    /(<img\b[^>]*\balt=")[^"]*(")/i,
    "$1" + _escAttr(post.title) + "$2",
  );
  // 5) date label (the non-data-ce div above the heading) -> current month/year
  card = card.replace(
    /(color:\s*var\(--color-primary\);[^"]*"\s*>)[^<]*(<\/div>)/i,
    "$1" + _esc(post.monthYear) + "$2",
  );
  // 6) re-key the data-ce ids so they stay UNIQUE on the listing page
  //    (s1-*-<k> -> s1-*-<num+offset>); pick an index above any existing one.
  const maxIdx = _maxCeIndex(blogIndexHtml, "s1-");
  const newIdx = maxIdx + 1;
  card = card.replace(
    /data-ce="s1-(img|h2|p|span)-\d+"/g,
    'data-ce="s1-$1-' + newIdx + '"',
  );

  // Insert as the FIRST child of the grid that holds the cards.
  const beforeCards = blogIndexHtml.slice(0, openIdx);
  // find the grid container open tag immediately preceding the first card
  const gridOpenIdx = beforeCards.lastIndexOf("<div");
  let insertAt, insertText;
  if (gridOpenIdx !== -1) {
    const gridClose = blogIndexHtml.indexOf(">", gridOpenIdx);
    insertAt = gridClose + 1;
    insertText = "\n" + indent + card;
  } else {
    insertAt = openIdx;
    insertText = card + "\n" + indent;
  }
  const next =
    blogIndexHtml.slice(0, insertAt) +
    insertText +
    blogIndexHtml.slice(insertAt);
  return { ok: true, content: next };
}

// Replace inner text of the element carrying a data-ce matched by `ceRe`
// within a small HTML fragment (depth-matched on its own tag).
function _replaceCeInner(frag, ceRe, newText) {
  const m = ceRe.exec(frag);
  if (!m) return frag;
  const markerIdx = m.index;
  const ts = frag.lastIndexOf("<", markerIdx);
  if (ts === -1) return frag;
  const tm = /^<([a-zA-Z0-9]+)/.exec(frag.slice(ts));
  if (!tm) return frag;
  const tag = tm[1].toLowerCase();
  const gt = frag.indexOf(">", markerIdx);
  if (gt === -1) return frag;
  const innerStart = gt + 1;
  const openRe = new RegExp("<" + tag + "\\b", "gi");
  const closeRe = new RegExp("</" + tag + "\\s*>", "gi");
  let depth = 1,
    pos = innerStart;
  while (depth > 0) {
    openRe.lastIndex = pos;
    closeRe.lastIndex = pos;
    const o = openRe.exec(frag),
      c = closeRe.exec(frag);
    if (!c) return frag;
    if (o && o.index < c.index) {
      depth++;
      pos = o.index + 1;
    } else {
      depth--;
      if (depth === 0)
        return frag.slice(0, innerStart) + newText + frag.slice(c.index);
      pos = c.index + c[0].length;
    }
  }
  return frag;
}

function _maxCeIndex(html, prefix) {
  let max = 0;
  const re = new RegExp(
    'data-ce="' + prefix.replace(/[-]/g, "\\$&") + '[a-z0-9]+-(\\d+)"',
    "gi",
  );
  let m;
  while ((m = re.exec(html))) max = Math.max(max, parseInt(m[1], 10) || 0);
  return max;
}

/* -------------------- splice a NEW <url> into sitemap.xml -------------------- */
function buildSitemap(sitemapXml, num, base) {
  if (!sitemapXml) return { ok: false, reason: "no sitemap" };
  const loc = (base || "") + "/blog/" + num + "/";
  if (sitemapXml.indexOf("<loc>" + loc + "</loc>") !== -1)
    return { ok: true, content: sitemapXml, already: true };
  const closeIdx = sitemapXml.lastIndexOf("</urlset>");
  if (closeIdx === -1) return { ok: false, reason: "no </urlset>" };
  // match the indentation of the last <url> line
  const lastUrl = sitemapXml.lastIndexOf("<url>");
  let indent = "  ";
  if (lastUrl !== -1) {
    const ls = sitemapXml.lastIndexOf("\n", lastUrl);
    indent = sitemapXml.slice(ls + 1, lastUrl).match(/^\s*/)[0] || "  ";
  }
  const entry = indent + "<url><loc>" + loc + "</loc></url>\n";
  const next =
    sitemapXml.slice(0, closeIdx) + entry + sitemapXml.slice(closeIdx);
  return { ok: true, content: next };
}

/* -------------------- top-level: create -------------------- */
function applyCreateBlogPost(input) {
  // buildPostPage is now pure-string, so jsdom is not needed (and must not be
  // used — see buildPostPage's note on the n8n sandbox eval ban). The param is
  // kept only for backward-compatible call sites.
  const JSDOM = input.JSDOM || null;
  const notes = [];
  if (!input.blogIndex || !input.blogIndex.content)
    throw new Error("blog/index.html is required");
  if (!input.sample || !input.sample.content)
    throw new Error("a sample post (blog/<n>/index.html) is required to clone");

  const existing =
    input.existing && input.existing.length
      ? input.existing
      : [input.sample.path];
  const num = nextPostNum(existing);

  const post = buildPostPage(JSDOM, input.sample.content, num, input.title, {});
  const files = [
    { path: "blog/" + num + "/index.html", content: post.html, isNew: true },
  ];

  // listing card
  const card = buildCard(input.blogIndex.content, num, post);
  let cardAppended = false;
  if (card.ok) {
    files.push({
      path: "blog/index.html",
      content: card.content,
      isNew: false,
    });
    cardAppended = true;
  } else {
    notes.push("Listing card not added: " + card.reason);
  }

  // sitemap
  let sitemapAppended = false;
  if (input.sitemap && input.sitemap.content) {
    const sm = buildSitemap(input.sitemap.content, num, post.base);
    if (sm.ok && !sm.already) {
      files.push({ path: "sitemap.xml", content: sm.content, isNew: false });
      sitemapAppended = true;
    } else if (sm.already) {
      notes.push("Sitemap already had this URL.");
    } else {
      notes.push("Sitemap not updated: " + sm.reason);
    }
  }

  return {
    ok: true,
    num,
    url: post.url,
    files,
    cardAppended,
    sitemapAppended,
    notes,
  };
}

/* -------------------- top-level: delete -------------------- */
// Removes a post: its listing card + its sitemap entry. The page file itself is
// removed by the workflow's GitHub delete (returned in `deletePaths`). Existing
// bytes elsewhere are preserved (pure string splicing).
function applyDeleteBlogPost(input) {
  const num = parseInt(input.num, 10);
  if (!(num >= 1)) throw new Error("invalid post number");
  const notes = [];
  const files = [];

  // remove the card whose href is /blog/<num>/
  if (input.blogIndex && input.blogIndex.content) {
    const html = input.blogIndex.content;
    const hrefRe = new RegExp('<a\\b[^>]*\\bhref="/blog/' + num + '/"', "i");
    const sm = hrefRe.exec(html);
    if (sm) {
      const openIdx =
        html.lastIndexOf("<a", sm.index + 2) === sm.index ? sm.index : sm.index;
      const aOpen = /<a\b/gi,
        aClose = /<\/a\s*>/gi;
      let depth = 1,
        pos = openIdx + 2,
        endIdx = -1;
      const tagEnd = html.indexOf(">", openIdx) + 1;
      pos = tagEnd;
      while (depth > 0) {
        aOpen.lastIndex = pos;
        aClose.lastIndex = pos;
        const o = aOpen.exec(html),
          c = aClose.exec(html);
        if (!c) break;
        if (o && o.index < c.index) {
          depth++;
          pos = o.index + 2;
        } else {
          depth--;
          if (depth === 0) endIdx = c.index + c[0].length;
          pos = c.index + c[0].length;
        }
      }
      if (endIdx !== -1) {
        // also swallow the leading whitespace/newline before the card
        let from = openIdx;
        const ls = html.lastIndexOf("\n", openIdx - 1);
        if (ls !== -1 && html.slice(ls + 1, openIdx).trim() === "") from = ls;
        const next = html.slice(0, from) + html.slice(endIdx);
        files.push({ path: "blog/index.html", content: next, isNew: false });
      } else notes.push("Card close tag not found.");
    } else notes.push("No listing card for that post.");
  }

  // remove the sitemap entry
  if (input.sitemap && input.sitemap.content) {
    const html = input.sitemap.content;
    const re = new RegExp(
      "\\s*<url><loc>[^<]*/blog/" + num + "/</loc></url>",
      "i",
    );
    if (re.test(html)) {
      files.push({
        path: "sitemap.xml",
        content: html.replace(re, ""),
        isNew: false,
      });
    } else notes.push("No sitemap entry for that post.");
  }

  return {
    ok: true,
    num,
    files,
    deletePaths: ["blog/" + num + "/index.html"],
    notes,
  };
}

module.exports = {
  applyCreateBlogPost,
  applyDeleteBlogPost,
  nextPostNum,
  buildPostPage,
  buildCard,
  buildSitemap,
};
