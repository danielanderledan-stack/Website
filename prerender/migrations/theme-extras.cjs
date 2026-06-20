/* ============================================================================
   Migration: theme-extras
   Two style upgrades for ALREADY-DEPLOYED sites, shipped as ONE fenced CSS block
   appended to assets/site.css (mirrors the new-site rules baked into fuse.cjs
   EXTRA_CSS, so migrated sites match freshly-fused ones):

     1. split-CTA band -> plain white. React baked the brand colour inline on
        .split-cta-left; a !important rule re-whites it (the lightning bolt +
        dark text stay readable). [Task 3]
     2. themeable PAGE BACKGROUND. body + the neutral white sections follow the
        --color-bg variable (set by the editor's Colours tab); it defaults to
        white when unset, so the look is unchanged until the owner picks a tint.
        Cards / dark / coloured sections keep their own colour. [Task 4]

   CSS-APPEND-ONLY: it changes NO HTML and NO existing CSS byte — it only APPENDS
   the clearly-fenced block (between CD_THEME_EXTRAS markers) to assets/site.css.
   The runner (run-theme-extras.cjs) gates this: output must equal the original
   with exactly our fenced block appended (idempotent — re-running is a no-op),
   the block must contain ONLY our three known selectors and no dangerous token,
   and no .html page is touched.
   ============================================================================ */
"use strict";

const path = require("path");

const BEGIN = "/* CD_THEME_EXTRAS:begin (theme-extras migration) */";
const END = "/* CD_THEME_EXTRAS:end */";

// The appended rules. Kept byte-for-byte in step with fuse.cjs EXTRA_CSS.
const CSS_BLOCK =
  "\n" +
  BEGIN +
  "\n" +
  "/* split-CTA band: plain white (was the brand colour) */\n" +
  ".split-cta-left{background:#fff!important}\n" +
  "/* themeable page background (Colours tab). Defaults to white when unset. */\n" +
  "body{background:var(--color-bg,#fff)}\n" +
  'section[style*="rgb(255, 255, 255)"]{background:var(--color-bg,#fff)!important}\n' +
  END +
  "\n";

function cssPath(repoDir) {
  return path.join(repoDir, "assets", "site.css");
}

function isApplied(css) {
  return css.indexOf(BEGIN) !== -1;
}

module.exports = {
  id: "theme-extras",
  label: "White split-CTA + themeable page background (CSS append)",
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
    const base = css.endsWith("\n") ? css.replace(/\n+$/, "\n") : css + "\n";
    return { changed: true, css: base + CSS_BLOCK };
  },
};
