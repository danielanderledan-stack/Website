/* ============================================================================
   Migration: tag-icons
   Makes the prominent service/feature SVG ICONS editable. The generic
   tagEditable walk tags TEXT (and the navbar via tagNav), but the inline-<svg>
   glyphs that sit above service/feature titles never received a data-ce, so the
   editor couldn't target them. This migration runs the canonical tagIcons()
   pass over EVERY page of an already-deployed site, stamping section-scoped
   s{section}-icon-{n} ids onto each "icon + heading" card icon.

   ADDITIVE-ATTRIBUTES-ONLY: it inserts no section and changes no text — it only
   ADDS `data-ce` / `data-ce-cap="icon"` / `data-ce-label="Icon"` attributes to
   existing <svg> elements. (Contrast with add-location-map, which inserts a
   #cd-map section.) ids are section-scoped (s{n}-icon-{m}), so they are stable
   within a page (the editor saves an icon by its data-ce).

   targets = ALL .html pages of the site (discovered from the repo). The runner
   (run-tag-icons.cjs) gates each page so the ONLY change is added data-ce* attrs:
   it strips every data-ce(-cap|-label)? attribute from both the output and the
   original and requires the two to be byte-identical after EOL normalisation,
   and verifies every NEWLY added id matches /^s\d+-icon-\d+$/ (no s{n}-text or
   nav-* id disturbed).
   ============================================================================ */
"use strict";

const fs = require("fs");
const path = require("path");
const { tagIcons } = require("../tag-editable.cjs");

// Discover every page of the site. Icon ids are section-scoped per page, so each
// page is tagged independently (and most pages have zero card icons -> SKIP).
function discoverTargets(repoDir) {
  const out = [];
  (function walk(d) {
    for (const e of fs.readdirSync(d, { withFileTypes: true })) {
      if (e.name === ".git" || e.name === "node_modules") continue;
      const p = path.join(d, e.name);
      if (e.isDirectory()) walk(p);
      else if (e.name.endsWith(".html")) {
        const rel = path.relative(repoDir, p).replace(/\\/g, "/");
        out.push({
          route: rel.replace(/\/?index\.html$/, "") || "home",
          file: rel,
        });
      }
    }
  })(repoDir);
  return out;
}

// ADDITIVE-attributes-only: stamp s{n}-icon-{m} refs onto existing card icons.
// Returns the number of icons newly tagged (0 => nothing to do / already tagged).
function apply(doc, route, siteCtx) {
  return tagIcons(doc);
}

module.exports = {
  id: "tag-icons",
  label: "Editable service/feature icons (svg)",
  // This migration ADDS attributes; it does not insert a removable section.
  // The runner gates by stripping data-ce* attrs rather than by selector.
  addedSelector: null,
  additiveAttrsOnly: true,
  // every id this migration stamps matches this pattern (section-scoped icon id)
  idPattern: /^s\d+-icon-\d+$/,
  // ALL pages of the site (function form: resolved per-repo by the runner)
  targets: discoverTargets,
  discoverTargets,
  apply,
};
