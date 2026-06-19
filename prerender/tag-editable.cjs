/* ============================================================================
   tagEditable(doc[, schema]) — stamp editing references onto the rendered DOM.
   Called by fuse.cjs (postProcess) for every new site, and by tag-sample.cjs
   for local editor testing. Pure DOM; no React/template source required.

   Each editable leaf gets:
     data-ce        unique, position-stable id  (e.g. "s5-h3-2")
     data-ce-cap    plain | rich | image
     data-ce-label  friendly name for the editor

   Split headings ("Foo & <span>Bar</span>") are tagged as ONE rich unit: the
   parent is tagged and its inline children are skipped, so the whole thing is
   editable while inline formatting/highlights are preserved.
   ============================================================================ */
"use strict";
const DEFAULT_SCHEMA = require("./edit-schema.cjs");

// tags that, if present as a descendant, mean this element is a CONTAINER (tag
// the children instead). Inline tags (span/a/b/i/u/em/strong) are NOT here, so
// elements holding only inline markup are tagged as one editable unit.
const BLOCK_CHILDREN = "h1,h2,h3,h4,h5,h6,p,li,img,ul,ol,section,div,header,footer,nav";

function tagEditable(doc, schema) {
  schema = schema || DEFAULT_SCHEMA;
  const main = doc.querySelector("#root main") || doc.querySelector("main");
  if (!main) return 0;

  const excluded = (el) => {
    for (const sel of schema.exclude) {
      try { if (el.matches(sel) || el.closest(sel)) return true; } catch (e) {}
    }
    return false;
  };

  const tagSel = Object.keys(schema.byTag).join(",");
  let count = 0;

  Array.prototype.forEach.call(main.children, (sec, si) => {
    // friendly section label (display only)
    for (const r of schema.sectionRoles) {
      try { if (r.test(sec)) { sec.setAttribute("data-ce-section", r.role); break; } } catch (e) {}
    }

    const counters = {};
    Array.prototype.forEach.call(sec.querySelectorAll(tagSel), (el) => {
      const tag = el.tagName.toLowerCase();
      const def = schema.byTag[tag];
      if (!def || el.hasAttribute("data-ce")) return;
      if (excluded(el)) return;
      // don't tag an element nested inside an already-tagged editable
      if (el.parentElement && el.parentElement.closest("[data-ce]")) return;

      if (def.cap === "image") {
        const src = el.getAttribute("src") || "";
        if (!src || src.indexOf("data:") === 0) return;
      } else {
        if (!(el.textContent || "").trim()) return;       // needs real text
        if (el.querySelector(BLOCK_CHILDREN)) return;       // it's a container
      }

      counters[tag] = (counters[tag] || 0) + 1;
      el.setAttribute("data-ce", "s" + si + "-" + tag + "-" + counters[tag]);
      el.setAttribute("data-ce-cap", def.cap);
      el.setAttribute("data-ce-label", def.label);
      count++;
    });
  });

  return count;
}

module.exports = { tagEditable };
