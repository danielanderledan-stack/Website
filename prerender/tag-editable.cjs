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
const BLOCK_CHILDREN =
  "h1,h2,h3,h4,h5,h6,p,li,img,ul,ol,section,div,header,footer,nav";

function tagEditable(doc, schema) {
  schema = schema || DEFAULT_SCHEMA;
  const main = doc.querySelector("#root main") || doc.querySelector("main");
  if (!main) return 0;

  const excluded = (el) => {
    for (const sel of schema.exclude) {
      try {
        if (el.matches(sel) || el.closest(sel)) return true;
      } catch (e) {}
    }
    return false;
  };

  const tagSel = Object.keys(schema.byTag).join(",");
  let count = 0;

  Array.prototype.forEach.call(main.children, (sec, si) => {
    // friendly section label (display only)
    for (const r of schema.sectionRoles) {
      try {
        if (r.test(sec)) {
          sec.setAttribute("data-ce-section", r.role);
          break;
        }
      } catch (e) {}
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
        if (!(el.textContent || "").trim()) return; // needs real text
        if (el.querySelector(BLOCK_CHILDREN)) return; // it's a container
      }

      counters[tag] = (counters[tag] || 0) + 1;
      el.setAttribute("data-ce", "s" + si + "-" + tag + "-" + counters[tag]);
      el.setAttribute("data-ce-cap", def.cap);
      el.setAttribute("data-ce-label", def.label);
      count++;
    });
  });

  // tag the navbar too (lives outside <main>, in the header)
  count += tagNav(doc, schema);

  // tag prominent service/feature SVG icons (icon-above-heading cards)
  count += tagIcons(doc, schema);

  return count;
}

/* ----------------------------------------------------------------------
   tagIcons(doc[, schema]) — stamp `s{section}-icon-{n}` ids onto the prominent
   inline-<svg> ICONS that sit directly above a service/feature title (the
   "icon + heading" card pattern used by service cards and the services page).

   These use the SAME section-scoped scheme as the text walk (s{section}-...),
   so an icon's id is unique + position-stable within its page. Runs over
   #root main's children (sharing the section index `si` with tagEditable's
   text pass) and is CONSERVATIVE: an <svg> is tagged ONLY when it is the lone
   element child of a plain wrapper <div> whose nextElementSibling is a heading.

   Skips everything else via schema.icons.exclude: the logo, hero arrows/scroll
   strip (data-cd), burger, in-text checkmarks (no wrapper+heading), social
   icons, the map pin, link/button arrows (a/button + already-data-ce), the
   decorative split-CTA accents, anything data-cd-marked or inside nav/header/
   footer, and any svg already inside a [data-ce]. Idempotent; never re-tags and
   never disturbs existing s{n}-* / nav-* ids.
---------------------------------------------------------------------- */
function tagIcons(doc, schema) {
  schema = schema || DEFAULT_SCHEMA;
  const cfg = schema.icons;
  if (!cfg) return 0;
  const main = doc.querySelector("#root main") || doc.querySelector("main");
  if (!main) return 0;

  const headSel = (cfg.headingTags || []).join(",");
  const inExcluded = (el) =>
    (cfg.exclude || []).some((sel) => {
      try {
        return el.matches(sel) || el.closest(sel);
      } catch (e) {
        return false;
      }
    });

  // an <svg> qualifies as a card icon iff it is the ONLY element child of a
  // <div> whose immediately following sibling is a heading.
  const isCardIcon = (svg) => {
    if (svg.hasAttribute("data-ce")) return false;
    if (inExcluded(svg)) return false;
    const wrap = svg.parentElement;
    if (!wrap || wrap.tagName.toLowerCase() !== "div") return false;
    if (wrap.children.length !== 1 || wrap.children[0] !== svg) return false;
    const next = wrap.nextElementSibling;
    if (!next) return false;
    try {
      if (!headSel || !next.matches(headSel)) return false;
    } catch (e) {
      return false;
    }
    return true;
  };

  let count = 0;
  Array.prototype.forEach.call(main.children, (sec, si) => {
    let n = 0;
    Array.prototype.forEach.call(
      sec.querySelectorAll(cfg.iconSelector),
      (svg) => {
        if (!isCardIcon(svg)) return;
        n++;
        svg.setAttribute("data-ce", "s" + si + "-icon-" + n);
        svg.setAttribute("data-ce-cap", cfg.cap);
        svg.setAttribute("data-ce-label", cfg.label);
        count++;
      },
    );
  });

  return count;
}

/* ----------------------------------------------------------------------
   tagNav(doc[, schema]) — stamp STABLE, page-independent `nav-*` ids onto the
   editable TEXT in the header navbar (brand wordmark + tagline + each desktop
   menu link). These ids are IDENTICAL on every page (DOM order, NOT s{n}-*), so
   an edit to any nav-* element is publishable to the whole site.

   Tags only visible nav text the owner would sensibly rename. Skips: the logo
   image / empty logo circle, the burger, the mobile-menu clone (so duplicates
   never collide), the CTA button (duplicates a contact detail), and any empty
   or icon-only link. Idempotent; never re-tags an element that already has
   data-ce, and never touches the s{n}-* tagging done in <main>.
---------------------------------------------------------------------- */
function tagNav(doc, schema) {
  schema = schema || DEFAULT_SCHEMA;
  const cfg = schema.nav;
  if (!cfg) return 0;

  let nav = null;
  for (const sel of cfg.rootSelectors) {
    try {
      nav = doc.querySelector(sel);
    } catch (e) {
      nav = null;
    }
    if (nav) break;
  }
  if (!nav) return 0;

  const inExcluded = (el) =>
    (cfg.exclude || []).some((sel) => {
      try {
        return el.matches(sel) || el.closest(sel);
      } catch (e) {
        return false;
      }
    });

  const set = (el, id, cap, label) => {
    if (!el || el.hasAttribute("data-ce")) return false;
    if (!(el.textContent || "").trim()) return false; // visible text only
    if (inExcluded(el)) return false;
    el.setAttribute("data-ce", id);
    el.setAttribute("data-ce-cap", cap);
    el.setAttribute("data-ce-label", label);
    return true;
  };

  let count = 0;

  // brand wordmark + tagline (fixed ids)
  for (const b of cfg.brand || []) {
    let el = null;
    try {
      el = nav.querySelector(b.sel);
    } catch (e) {
      el = null;
    }
    if (set(el, b.id, b.cap, b.label)) count++;
  }

  // desktop menu links: scope to the desktop container so the mobile-menu clone
  // is never reached (it duplicates the same labels -> would collide on ids).
  let container = null;
  if (cfg.linkContainer) {
    try {
      // prefer a container that is NOT the mobile-menu clone
      const cands = Array.prototype.filter.call(
        nav.querySelectorAll(cfg.linkContainer),
        (c) => !inExcluded(c),
      );
      container = cands[0] || null;
    } catch (e) {
      container = null;
    }
  }
  const scope = container || nav;
  let links = [];
  try {
    links = Array.prototype.slice.call(
      scope.querySelectorAll(cfg.linkSelector),
    );
  } catch (e) {
    links = [];
  }
  let n = 0;
  for (const a of links) {
    // never tag a link inside the mobile-menu clone or marked excluded
    if (inExcluded(a)) continue;
    // gapless numbering: only advance when an editable text link is tagged.
    // The nav is identical on every page, so the same links tag the same way
    // -> nav-link-N is stable across pages.
    if (set(a, "nav-link-" + (n + 1), cfg.linkCap, cfg.linkLabel)) {
      n++;
      count++;
    }
  }

  return count;
}

module.exports = { tagEditable, tagNav, tagIcons };
