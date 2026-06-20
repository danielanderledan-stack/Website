/* ============================================================================
   save-icon — apply {ce, svg} icon swaps to a page's raw HTML by unique data-ce.
   Drop-in core for the n8n builder-auth "save-icon" Code node (n8n has jsdom
   globally; pass it in, or it falls back to require).

   Modeled on save-elements.cjs: targeting is by the UNIQUE data-ce id (no
   occurrence ambiguity). We locate the WHOLE <svg ...data-ce="id"...>...</svg>
   element and replace it with the op's sanitised svg, byte-preserving every
   other byte on the page => tiny git diffs.

   WHY whole-element (not inner-only): the host <svg> is baked with the site's
   own viewBox + paint (e.g. viewBox="0 0 40 40" fill="none" stroke="currentColor")
   but Iconify icons are authored for THEIR own coordinate space + paint
   (tabler/lucide=24 stroke, phosphor=256 fill, mdi=24 fill). Splicing a 24/256-
   unit, fill-based icon INSIDE the host's kept 0 0 40 40 / stroke viewBox renders
   it tiny / clipped / offset / hollow. So the editor stages the FULL corrected
   svg (adopted viewBox + paint + display size + preserved data-ce* + new inner)
   and we drop that whole element in.

   Because the icon comes from a third-party API (Iconify), the svg is hard-
   sanitised through jsdom to an SVG allowlist — root svg attrs AND inner geometry
   — so customers swap icons, never inject script/handlers/external references.
   The host's unique data-ce / data-ce-cap / data-ce-label are re-asserted on the
   sanitised root so the element stays editable.
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
// Attributes allowed on the REPLACEMENT root <svg> open tag. Superset of the
// geometry attrs plus presentational/structural ones the host carries. The
// data-ce* editing refs are validated separately (re-asserted from the located
// host) so they survive sanitisation and keep the element editable.
const OK_SVG_ATTR = Object.assign(
  {
    class: 1,
    role: 1,
    "aria-hidden": 1,
    focusable: 1,
    preserveaspectratio: 1,
    "data-ce": 1,
    "data-ce-cap": 1,
    "data-ce-label": 1,
  },
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

// Sanitise a FULL <svg ...>...</svg> string to an allowlisted root <svg> with
// sanitised inner geometry. `ceAttrs` = { 'data-ce':..., 'data-ce-cap':...,
// 'data-ce-label':... } captured from the located host; these are re-asserted on
// the sanitised root so the element stays editable regardless of what the staged
// svg carried. Returns the serialised "<svg ...>...</svg>" string, or null if no
// svg root is found.
function sanitizeIconSvg(JSDOM, fullSvg, ceAttrs) {
  const win = new JSDOM("<!DOCTYPE html><body><div id='r'></div>").window;
  const doc = win.document;
  const host = doc.getElementById("r");
  host.innerHTML = String(fullSvg || "").trim();
  // NB: getElementsByTagName (not querySelector) — n8n's Code-node sandbox
  // forbids the eval/Function that jsdom's CSS-selector engine (nwsapi) uses.
  const svg = host.getElementsByTagName("svg")[0] || null;
  if (!svg) return null;
  // Sanitise the root svg's OWN attributes to the svg allowlist.
  Array.prototype.slice.call(svg.attributes).forEach((a) => {
    const name = String(a.name || "").toLowerCase();
    if (name.indexOf("on") === 0) {
      svg.removeAttribute(a.name);
      return;
    }
    if (name === "href" || name.indexOf(":href") >= 0) {
      svg.removeAttribute(a.name);
      return;
    }
    // data-ce* are re-asserted below from the host; drop whatever came in.
    if (name.indexOf("data-ce") === 0) {
      svg.removeAttribute(a.name);
      return;
    }
    if (!OK_SVG_ATTR[name]) {
      svg.removeAttribute(a.name);
      return;
    }
    if (/url\s*\(|javascript:|expression\s*\(|<|>/i.test(a.value)) {
      svg.removeAttribute(a.name);
    }
  });
  // Sanitise the inner geometry with the existing inner sanitiser, then re-set it.
  svg.innerHTML = sanitizeIconInner(JSDOM, svg.innerHTML);
  // Re-assert the host's editing refs so the swapped element stays targetable.
  if (ceAttrs) {
    Object.keys(ceAttrs).forEach((k) => {
      if (ceAttrs[k] != null) svg.setAttribute(k, ceAttrs[k]);
    });
  }
  return svg.outerHTML;
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

// Locate the element carrying data-ce=ce. Returns BOTH the inner-HTML span
// [innerStart, innerEnd) AND the whole-element span [elStart, elEnd) plus the
// host's own data-ce* attrs (parsed from the open tag) — so callers can either
// inner-splice or replace the whole element while preserving the editing refs.
// Same deterministic depth scan as save-elements.locateInner.
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
  // Parse the host's editing refs straight from the open tag so a whole-element
  // replacement can re-assert them onto the sanitised svg.
  const openTag = html.slice(ts, gt + 1);
  const ceAttrs = {};
  for (const m of openTag.matchAll(/\s(data-ce(?:-cap|-label)?)="([^"]*)"/g)) {
    ceAttrs[m[1]] = m[2];
  }
  if (html[gt - 1] === "/")
    return { void: true, tag, elStart: ts, elEnd: gt + 1, ceAttrs };
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
      if (depth === 0)
        return {
          tag,
          innerStart,
          innerEnd: c.index,
          elStart: ts,
          elEnd: c.index + c[0].length,
          ceAttrs,
        };
      pos = c.index + c[0].length;
    }
  }
  return null;
}

// Apply icon edits. Each edit: { ce, svg } where svg is the FULL corrected
// "<svg ...>...</svg>" (adopted viewBox + paint + display size + new inner) the
// editor staged. We locate the WHOLE host <svg> by its unique data-ce, sanitise
// the op's svg (root attrs + inner geometry) re-asserting the host's data-ce*
// editing refs, and replace the whole element — every other byte untouched.
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
    const clean = sanitizeIconSvg(JSDOM, e.svg, loc.ceAttrs);
    if (!clean) {
      failures.push(String(e.ce) + ": no svg in payload");
      continue;
    }
    located.push({ loc, clean });
  }
  // splice from the END backwards so earlier indices stay valid
  located.sort((a, b) => b.loc.elStart - a.loc.elStart);
  for (const { loc, clean } of located) {
    html = html.slice(0, loc.elStart) + clean + html.slice(loc.elEnd);
    applied++;
  }
  return { html, applied, failures };
}

module.exports = {
  applyIconEdits,
  sanitizeIconInner,
  sanitizeIconSvg,
  extractInner,
  locateInner,
  ALLOW,
  DROP,
  OK_ATTR,
  OK_SVG_ATTR,
};
