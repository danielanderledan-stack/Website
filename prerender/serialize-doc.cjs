/* ============================================================================
   serialize-doc — fuse's exact HTML pretty-printer + clamp() protection,
   extracted so the retrofit/updater produce byte-identical formatting to fresh
   fuse output. Round-trip-stable on fuse output (whitespace-only text nodes are
   ignored by isElementOnly), so re-serializing an existing page surfaces ONLY
   the attributes you actually changed.

   fuse.cjs should later require this module instead of its inline copies.
   ============================================================================ */
"use strict";

const VOID_TAGS = new Set([
  "area", "base", "br", "col", "embed", "hr", "img", "input",
  "link", "meta", "param", "source", "track", "wbr",
]);

function openTag(el) {
  let attrs = "";
  for (const at of el.attributes) {
    attrs += " " + at.name + '="' + at.value.replace(/&/g, "&amp;").replace(/"/g, "&quot;") + '"';
  }
  return "<" + el.tagName.toLowerCase() + attrs + ">";
}

function isElementOnly(el) {
  let any = false;
  for (const ch of el.childNodes) {
    if (ch.nodeType === 3 && ch.textContent.trim() !== "") return false;
    if (ch.nodeType === 1 || ch.nodeType === 8) any = true;
  }
  return any;
}

function fmtNode(node, indent, out) {
  if (node.nodeType === 8) { out.push(indent + "<!--" + node.textContent + "-->"); return; }
  if (node.nodeType === 3) { const t = node.textContent.trim(); if (t) out.push(indent + t); return; }
  if (node.nodeType !== 1) return;
  const tag = node.tagName.toLowerCase();
  if (tag === "script" || tag === "style") {
    const txt = node.textContent.trim();
    if (txt) { out.push(indent + openTag(node)); out.push(txt); out.push(indent + "</" + tag + ">"); }
    else out.push(indent + openTag(node) + "</" + tag + ">");
    return;
  }
  if (VOID_TAGS.has(tag)) { out.push(indent + openTag(node)); return; }
  if (!node.childNodes.length) { out.push(indent + openTag(node) + "</" + tag + ">"); return; }
  if (isElementOnly(node)) {
    out.push(indent + openTag(node));
    for (const ch of node.childNodes) fmtNode(ch, indent + "  ", out);
    out.push(indent + "</" + tag + ">");
  } else {
    out.push(indent + node.outerHTML);
  }
}

function serializeDoc(doc) {
  const out = ["<!DOCTYPE html>"];
  fmtNode(doc.documentElement, "", out);
  return out.join("\n") + "\n";
}

/* jsdom's CSS parser silently DROPS the CSS math-comparison functions
   clamp()/min()/max() from PARSED inline styles (mixed-content nodes serialize
   via outerHTML). Swap each literal for a var() sentinel (jsdom passes var()
   through verbatim) before parsing, restore it after serializing. The mapping
   is fully reversible, so protecting an incidental Math.min/max in script text
   is harmless. Nested forms (clamp(min(...))) are left for the gate to catch.
   Matches fuse.cjs's clamp approach, generalised. */
function protectClamps(html) {
  const map = new Map();
  const out = String(html).replace(/(?:clamp|min|max)\([^()]*\)/g, (expr) => {
    let key = null;
    for (const [k, v] of map) if (v === expr) key = k;
    if (!key) { key = "var(--cdclamp-" + map.size + ")"; map.set(key, expr); }
    return key;
  });
  return { html: out, map };
}

function restoreClamps(html, map) {
  for (const [key, expr] of map) html = html.split(key).join(expr);
  return html;
}

module.exports = { VOID_TAGS, openTag, isElementOnly, fmtNode, serializeDoc, protectClamps, restoreClamps };
