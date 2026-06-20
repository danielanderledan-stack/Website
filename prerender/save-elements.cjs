/* ============================================================================
   save-elements — apply {ce, html} edits to a page's raw HTML by unique data-ce.
   Drop-in core for the n8n builder-auth "save-elements" Code node (n8n has
   jsdom globally; pass it in, or it falls back to require).

   Targeting is by the UNIQUE data-ce id, so there is no occurrence ambiguity.
   We splice ONLY the element's inner HTML as a string (formatting elsewhere is
   byte-preserved => tiny git diffs). The new inner fragment is hard-sanitised
   through jsdom to an allowlist — customers format text, never inject markup/JS.
   ============================================================================ */
"use strict";

const ALLOW = { B: 1, STRONG: 1, I: 1, EM: 1, U: 1, BR: 1, SPAN: 1, A: 1, FONT: 1 };
const DROP = { SCRIPT: 1, STYLE: 1, IFRAME: 1, OBJECT: 1, EMBED: 1, LINK: 1, META: 1, NOSCRIPT: 1, SVG: 1 };
const OK_STYLE = ["color", "font-weight", "font-style", "text-decoration", "text-decoration-color", "text-decoration-line", "text-decoration-style", "font-family", "background-color"];
const VOID = { img: 1, br: 1, hr: 1, input: 1, meta: 1, link: 1 };

function sanitizeFragment(JSDOM, html) {
  const doc = new JSDOM("<!DOCTYPE html><body><div id='r'></div>").window.document;
  const root = doc.getElementById("r");
  root.innerHTML = String(html || "");
  (function walk(node) {
    Array.prototype.slice.call(node.childNodes).forEach((c) => {
      if (c.nodeType === 1) {
        if (DROP[c.tagName]) { node.removeChild(c); return; }
        if (!ALLOW[c.tagName]) {
          while (c.firstChild) node.insertBefore(c.firstChild, c);
          node.removeChild(c);
          return;
        }
        Array.prototype.slice.call(c.attributes).forEach((a) => {
          if (c.tagName === "A" && a.name === "href") {
            if (!/^(https?:|tel:|mailto:|\/)/i.test(a.value)) c.removeAttribute("href");
            return;
          }
          if (a.name === "style") {
            const clean = a.value
              .split(";").map((d) => d.trim()).filter(Boolean)
              .filter((d) => OK_STYLE.indexOf(d.split(":")[0].trim().toLowerCase()) >= 0)
              .join("; ");
            if (clean) c.setAttribute("style", clean); else c.removeAttribute("style");
            return;
          }
          if (a.name === "color" && c.tagName === "FONT") return;
          c.removeAttribute(a.name);
        });
        walk(c);
      } else if (c.nodeType !== 3) {
        node.removeChild(c);
      }
    });
  })(root);
  return root.innerHTML;
}

// Find the inner-HTML span [innerStart, innerEnd) of the element carrying data-ce=ce.
function locateInner(html, ce) {
  const marker = 'data-ce="' + ce + '"';
  const mi = html.indexOf(marker);
  if (mi === -1) return null;
  const ts = html.lastIndexOf("<", mi);
  if (ts === -1) return null;
  const tm = /^<([a-zA-Z0-9]+)/.exec(html.slice(ts, mi + marker.length));
  if (!tm) return null;
  const tag = tm[1].toLowerCase();
  const gt = html.indexOf(">", mi);
  if (gt === -1) return null;
  if (VOID[tag] || html[gt - 1] === "/") return { void: true, tag };
  const innerStart = gt + 1;
  const openRe = new RegExp("<" + tag + "\\b", "gi");
  const closeRe = new RegExp("</" + tag + "\\s*>", "gi");
  let depth = 1, pos = innerStart;
  while (depth > 0) {
    openRe.lastIndex = pos;
    closeRe.lastIndex = pos;
    const o = openRe.exec(html);
    const c = closeRe.exec(html);
    if (!c) return null;
    if (o && o.index < c.index) { depth++; pos = o.index + 1; }
    else { depth--; if (depth === 0) return { tag, innerStart, innerEnd: c.index }; pos = c.index + c[0].length; }
  }
  return null;
}

function applyElementEdits(html, edits, JSDOM) {
  JSDOM = JSDOM || require("jsdom").JSDOM;
  let applied = 0;
  const failures = [];
  // apply from the END of the document backwards so earlier indices stay valid
  const located = [];
  for (const e of edits || []) {
    const loc = locateInner(html, e.ce);
    if (!loc || loc.void) { failures.push(String(e.ce) + ": not found"); continue; }
    located.push({ loc, html: e.html });
  }
  located.sort((a, b) => b.loc.innerStart - a.loc.innerStart);
  for (const { loc, html: frag } of located) {
    const clean = sanitizeFragment(JSDOM, frag);
    html = html.slice(0, loc.innerStart) + clean + html.slice(loc.innerEnd);
    applied++;
  }
  return { html, applied, failures };
}

module.exports = { applyElementEdits, sanitizeFragment, locateInner };
