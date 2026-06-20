/* ============================================================================
   Migration: tag-navbar
   Makes the HEADER navbar's TEXT editable. The generic tagEditable walk only
   visits #root main's children, so the nav (which lives in the header, outside
   <main>) never receives data-ce and isn't editable. This migration runs the
   canonical tagNav() pass over EVERY page of a site, stamping STABLE,
   page-independent ids prefixed "nav-" onto the brand wordmark, the tagline,
   and each desktop menu link.

   ADDITIVE-ATTRIBUTES-ONLY: it inserts no section and changes no text — it only
   ADDS `nav-*` data-ce / data-ce-cap / data-ce-label attributes to existing nav
   elements. (Contrast with add-location-map, which inserts a #cd-map section.)
   Because the ids are identical on every page, an edit to any nav-* element is
   publishable site-wide by the editor.

   targets = ALL .html pages of the site (discovered from the repo). The runner
   (run-tag-navbar.cjs) gates each page so the ONLY change is added nav-* attrs:
   it strips every data-ce(-cap|-label)? attribute from both the output and the
   original and requires the two to be byte-identical after EOL normalisation.
   ============================================================================ */
"use strict";

const fs = require("fs");
const path = require("path");
const { tagNav } = require("../tag-editable.cjs");

// Discover every page of the site. The nav is identical across pages, so each
// page is tagged with the same nav-* ids.
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

// ADDITIVE-attributes-only: stamp nav-* refs onto existing nav text. Returns the
// number of nav elements newly tagged (0 => nothing to do / already tagged).
function apply(doc, route, siteCtx) {
  return tagNav(doc);
}

module.exports = {
  id: "tag-navbar",
  label: "Editable navbar text (brand + menu links)",
  // This migration ADDS attributes; it does not insert a removable section.
  // The runner gates by stripping data-ce* attrs rather than by selector.
  addedSelector: null,
  additiveAttrsOnly: true,
  // ids this migration stamps (all start with this prefix)
  idPrefix: "nav-",
  // ALL pages of the site (function form: resolved per-repo by the runner)
  targets: discoverTargets,
  discoverTargets,
  apply,
};
