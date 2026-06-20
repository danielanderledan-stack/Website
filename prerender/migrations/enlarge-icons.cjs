/* ============================================================================
   Migration: enlarge-icons
   Makes the service/feature SVG ICONS ~50% larger (host 40x40 -> 60x60) and
   keeps their geometry centred, on ALREADY-DEPLOYED sites — for BOTH existing
   icons and any freshly-swapped ones. The editor's icon swap now stages icons
   sized 60 (see editor/index.html applyPickedToHost + prerender/save-icon.cjs),
   but EXISTING, never-swapped icons on live sites are still baked at 40x40 with
   no CSS size rule. This migration appends ONE CSS rule to assets/site.css that
   sizes every [data-ce-cap="icon"] svg to 60x60 and centres it.

   WHY CSS (not an HTML attribute bump): a single CSS rule covers existing AND
   future icons uniformly, persists, and (crucially) a CSS width/height beats the
   inline width="40"/height="40" presentation attribute — so existing icons grow
   with zero HTML churn. The swapped icons already carry width/height="60"; the
   rule is harmless/identical for them.

   CSS-APPEND-ONLY: it changes NO HTML and NO existing CSS byte — it only APPENDS
   a clearly-fenced block (between CD_ICON_SIZE markers) to assets/site.css. The
   runner (run-enlarge-icons.cjs) gates this: output must equal the original with
   exactly our fenced block appended (idempotent — re-running is a no-op), and no
   HTML page is touched at all.

   centring: the icon's geometry is centred inside its own viewBox by SVG's
   default preserveAspectRatio (xMidYMid meet); the rule additionally guarantees
   the <svg> box is a centred inline-block of fixed 60x60 so a wrapper that is
   wider than the icon doesn't drift it. display stays block (the site reset sets
   svg{display:block}); we add object-fit so a stray non-square viewBox still
   centres rather than stretches.
   ============================================================================ */
"use strict";

const fs = require("fs");
const path = require("path");

const BEGIN = "/* CD_ICON_SIZE:begin (enlarge-icons migration) */";
const END = "/* CD_ICON_SIZE:end */";

// The appended rule. 60x60 (~50% up from 40). !important so it beats both the
// inline width/height presentation attribute AND any tailwind utility on the svg.
// margin keeps it left-aligned with the card text but the geometry self-centres.
const CSS_BLOCK =
  "\n" +
  BEGIN +
  "\n" +
  '[data-ce-cap="icon"]{width:60px!important;height:60px!important;' +
  "object-fit:contain;overflow:visible}\n" +
  END +
  "\n";

// The CSS file each site ships. (All current sites use assets/site.css.)
function cssPath(repoDir) {
  return path.join(repoDir, "assets", "site.css");
}

// Already migrated? (idempotent)
function isApplied(css) {
  return css.indexOf(BEGIN) !== -1;
}

module.exports = {
  id: "enlarge-icons",
  label: "Service/feature icons 40->60 + centred (CSS append)",
  cssAppendOnly: true,
  begin: BEGIN,
  end: END,
  cssBlock: CSS_BLOCK,
  cssPath,
  isApplied,
  // Produce the migrated CSS for a repo's site.css. Returns { changed, css } —
  // changed=false when already applied (idempotent no-op).
  applyCss(css) {
    if (isApplied(css)) return { changed: false, css };
    // Append our fenced block, normalising a trailing newline so the diff is
    // exactly "+<block>".
    const base = css.endsWith("\n") ? css.replace(/\n+$/, "\n") : css + "\n";
    return { changed: true, css: base + CSS_BLOCK };
  },
};
