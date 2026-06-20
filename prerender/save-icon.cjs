/* ============================================================================
   save-icon — apply {ce, svg} icon swaps to a page's raw HTML by unique data-ce.
   Drop-in core for the n8n builder-auth "save-icon" Code node (n8n has jsdom
   globally; pass it in, or it falls back to require).

   Modeled on save-elements.cjs: targeting is by the UNIQUE data-ce id (no
   occurrence ambiguity) and we splice ONLY the element's inner HTML as a string,
   so formatting elsewhere is byte-preserved => tiny git diffs.

   The tagged element (data-ce-cap="icon") IS the <svg> baked by the site. Its
   OWN attributes (width/height/class/viewBox + the site's sizing/colour context)
   are byte-preserved — we only replace what is BETWEEN <svg ...> and </svg> with
   the new icon's inner geometry (paths/shapes/gradients).

   Because the icon comes from a third-party API (Iconify), the inner markup is
   hard-sanitised through jsdom to an SVG geometry allowlist: customers swap
   icons, never inject script/handlers/external references.
   ============================================================================ */
"use strict";

// Geometry + presentational SVG elements only. NO <svg> here — the host <svg>
// is the data-ce element itself and is preserved; we sanitise its INNER markup.
// (If a full <svg> wrapper is supplied we unwrap it before sanitising — see
// extractInner below — so a nested <svg> child is intentionally disallowed.)
const ALLOW = {
  G: 1,
  PATH: 1,
  CIRCLE: 1,
  RECT: 1,
  LINE: 1,
  POLYLINE: 1,
  POLYGON: 1,
  ELLIPSE: 1,
  DEFS: 1,
  USE: 1,
  TITLE: 1,
  LINEARGRADIENT: 1,
  RADIALGRADIENT: 1,
  STOP: 1,
};
// Hard-drop these and everything inside them.
const DROP = {
  SCRIPT: 1,
  FOREIGNOBJECT: 1,
  IMAGE: 1,
  A: 1,
  STYLE: 1,
  IFRAME: 1,
  OBJECT: 1,
  ANIMATE: 1,
  ANIMATETRANSFORM: 1,
  ANIMATEMOTION: 1,
  SET: 1,
  MPATH: 1,
};
// Safe presentational attributes (lower-cased). Anything else is stripped,
// including ALL on* handlers and any href / xlink:href.
const OK_ATTR = {
  viewbox: 1,
  d: 1,
  fill: 1,
  stroke: 1,
  "stroke-width": 1,
  "stroke-linecap": 1,
  "stroke-linejoin": 1,
  "stroke-miterlimit": 1,
  "stroke-dasharray": 1,
  cx: 1,
  cy: 1,
  r: 1,
  rx: 1,
  ry: 1,
  x: 1,
  y: 1,
  x1: 1,
  y1: 1,
  x2: 1,
  y2: 1,
  width: 1,
  height: 1,
  points: 1,
  transform: 1,
  opacity: 1,
  "fill-opacity": 1,
  "stroke-opacity": 1,
  "fill-rule": 1,
  "clip-rule": 1,
  offset: 1,
  "stop-color": 1,
  "stop-opacity": 1,
  gradientunits: 1,
  gradienttransform: 1,
  spreadmethod: 1,
  id: 1,
  xmlns: 1,
  "xmlns:xlink": 1,
};
// Attributes allowed ONLY on the host <svg> open tag (when serialising a full
// replacement svg — not used by the inner-splice path, kept for completeness).
const OK_SVG_ATTR = Object.assign(
  { class: 1, role: 1, "aria-hidden": 1 },
  OK_ATTR,
);

// Sanitise INNER svg markup (children of <svg>) to the geometry allowlist.
function sanitizeIconInner(JSDOM, inner) {
  // Parse inside a real <svg> so SVG elements get the SVG namespace and tag
  // names resolve (jsdom is case-insensitive for HTML but svg children parse
  // fine inside an <svg> context).
  const doc = new JSDOM("<!DOCTYPE html><body><svg id='r'></svg>").window
    .document;
  const root = doc.getElementById("r");
  root.innerHTML = String(inner || "");
  (function walk(node) {
    Array.prototype.slice.call(node.childNodes).forEach((c) => {
      if (c.nodeType === 1) {
        const tag = String(c.tagName || "").toUpperCase();
        if (DROP[tag]) {
          node.removeChild(c);
          return;
        }
        if (!ALLOW[tag]) {
          // unknown element: drop the element but keep safe children
          while (c.firstChild) node.insertBefore(c.firstChild, c);
          node.removeChild(c);
          return;
        }
        Array.prototype.slice.call(c.attributes).forEach((a) => {
          const name = String(a.name || "").toLowerCase();
          if (name.indexOf("on") === 0) {
            c.removeAttribute(a.name);
            return;
          }
          if (
            name === "href" ||
            name === "xlink:href" ||
            name.indexOf(":href") >= 0
          ) {
            c.removeAttribute(a.name);
            return;
          }
          if (!OK_ATTR[name]) {
            c.removeAttribute(a.name);
            return;
          }
          // url(...) / javascript: in any value -> strip (defends paint refs)
          if (/url\s*\(|javascript:|expression\s*\(|<|>/i.test(a.value)) {
            c.removeAttribute(a.name);
          }
        });
        walk(c);
      } else if (c.nodeType !== 3) {
        // comments / CDATA / anything non-text -> drop
        node.removeChild(c);
      }
    });
  })(root);
  return root.innerHTML;
}

// Pull the inner markup out of a payload. Accepts either a full "<svg ...>...</svg>"
// (we take what's inside the outermost svg) or already-inner markup.
function extractInner(svg) {
  const s = String(svg || "");
  const open = s.match(/<svg\b[^>]*>/i);
  if (open) {
    const start = s.indexOf(open[0]) + open[0].length;
    const end = s.lastIndexOf("</svg>");
    if (end > start) return s.slice(start, end);
    return s.slice(start);
  }
  return s;
}

// Find the inner-HTML span [innerStart, innerEnd) of the element carrying
// data-ce=ce. Same deterministic scan as save-elements.locateInner.
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
  if (html[gt - 1] === "/") return { void: true, tag };
  const innerStart = gt + 1;
  const openRe = new RegExp("<" + tag + "\\b", "gi");
  const closeRe = new RegExp("</" + tag + "\\s*>", "gi");
  let depth = 1,
    pos = innerStart;
  while (depth > 0) {
    openRe.lastIndex = pos;
    closeRe.lastIndex = pos;
    const o = openRe.exec(html);
    const c = closeRe.exec(html);
    if (!c) return null;
    if (o && o.index < c.index) {
      depth++;
      pos = o.index + 1;
    } else {
      depth--;
      if (depth === 0) return { tag, innerStart, innerEnd: c.index };
      pos = c.index + c[0].length;
    }
  }
  return null;
}

// Apply icon edits. Each edit: { ce, svg }. We locate the data-ce host element
// (the <svg>), sanitise the new icon's inner geometry, and splice it as the
// host's new inner HTML — host open/close tags & every other byte untouched.
function applyIconEdits(html, edits, JSDOM) {
  JSDOM = JSDOM || require("jsdom").JSDOM;
  let applied = 0;
  const failures = [];
  const located = [];
  for (const e of edits || []) {
    if (!e || !e.ce) {
      failures.push("missing ce");
      continue;
    }
    const loc = locateInner(html, e.ce);
    if (!loc || loc.void) {
      failures.push(String(e.ce) + ": not found");
      continue;
    }
    located.push({ loc, svg: e.svg });
  }
  // splice from the END backwards so earlier indices stay valid
  located.sort((a, b) => b.loc.innerStart - a.loc.innerStart);
  for (const { loc, svg } of located) {
    const clean = sanitizeIconInner(JSDOM, extractInner(svg));
    html = html.slice(0, loc.innerStart) + clean + html.slice(loc.innerEnd);
    applied++;
  }
  return { html, applied, failures };
}

module.exports = {
  applyIconEdits,
  sanitizeIconInner,
  extractInner,
  locateInner,
  ALLOW,
  DROP,
  OK_ATTR,
  OK_SVG_ATTR,
};
