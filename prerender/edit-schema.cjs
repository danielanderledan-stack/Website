/* ============================================================================
   EDIT SCHEMA — the single source of truth for what the visual editor can edit.
   Consumed by tag-editable.cjs at fuse time. Adaptable by design:
     - add an editing capability  -> add a `cap`
     - change what's editable      -> tweak `byTag` / `exclude`
     - name a section nicely       -> add a `sectionRoles` signature
     - support a NEW section type   -> it's auto-covered by the generic walk;
                                       add a signature only for a nicer label.
   IDs are POSITION-based (s{section}-{tag}-{n}) so they're unique + stable and
   never change when the customer edits the text inside them.
   ============================================================================ */
module.exports = {
  // Capability registry. The editor maps each to a UI:
  //   plain -> inline text only   rich -> text + bold/italic/underline/colour/font
  //   image -> swap               icon -> Iconify picker (save-icon by data-ce)
  //   (future: list, color-only, link…)
  caps: ["plain", "rich", "image", "icon"],

  // Never tag these (chrome / controls / duplicated carousel nodes).
  exclude: [
    "nav",
    "header",
    "footer",
    '[data-cd="hero-prev"]',
    '[data-cd="hero-next"]',
    '[data-cd="t-dot"]',
    '[data-cd="burger"]',
    '[data-cd="mobile-menu"]',
    ".cd-loader",
    "[data-ce]",
  ],

  // Default capability + friendly label per tag.
  byTag: {
    h1: { cap: "rich", label: "Heading" },
    h2: { cap: "rich", label: "Heading" },
    h3: { cap: "rich", label: "Heading" },
    h4: { cap: "rich", label: "Subheading" },
    h5: { cap: "rich", label: "Subheading" },
    h6: { cap: "rich", label: "Subheading" },
    p: { cap: "rich", label: "Text" },
    li: { cap: "rich", label: "List item" },
    a: { cap: "rich", label: "Button" },
    button: { cap: "rich", label: "Button" },
    span: { cap: "rich", label: "Label" },
    img: { cap: "image", label: "Photo" },
  },

  // NAVBAR text editing. The nav lives in the header (outside <main>), so the
  // generic section walk never reaches it. tagNav() handles it separately with
  // STABLE, page-INDEPENDENT ids prefixed "nav-" (NOT the s{n}-* scheme), so an
  // edit can be published to every page. Only visible nav TEXT is tagged; the
  // logo image, burger, mobile-menu clone, and CTA button are left untouched.
  nav: {
    // where the nav lives (first match wins)
    rootSelectors: ['nav[data-cd="nav"]', "#root nav", "nav"],
    // brand wordmark + tagline (the <a href="/"> logo block's text spans)
    brand: [
      { sel: ".nav-logo-text", id: "nav-brand", cap: "rich", label: "Brand" },
      {
        sel: ".nav-logo-tagline",
        id: "nav-tagline",
        cap: "rich",
        label: "Tagline",
      },
    ],
    // desktop menu link container (the mobile-menu clone is excluded explicitly)
    linkContainer: "div.lg\\:flex",
    linkSelector: "a.nav-link",
    linkCap: "rich",
    linkLabel: "Menu link",
    // never tag these nav descendants (interactive / duplicated / icon-only)
    exclude: ['[data-cd="burger"]', '[data-cd="mobile-menu"]', ".btn-yellow"],
  },

  // SERVICE / FEATURE ICONS. Prominent inline-<svg> glyphs that sit directly
  // above a service/feature title (the "icon + heading" card pattern). tagIcons()
  // stamps these with the section-scoped s{section}-icon-{n} scheme (same family
  // as the s{n}-* text ids) so they're unique + position-stable within a page.
  // Capability "icon" -> the editor binds an Iconify picker + save-icon action.
  //
  // CONSERVATIVE by design — an <svg> is tagged ONLY when ALL hold:
  //   - it is the ONLY element child of a plain wrapper <div>, and
  //   - that wrapper's nextElementSibling is a heading (h1..h6).
  // Everything else is skipped via `exclude` (logo, hero arrows/strip, burger,
  // social, map pin, link/button arrows, decorative split-CTA accents, anything
  // data-cd-marked or inside nav/header/footer, and any svg already in a
  // [data-ce]). In-text checkmarks never match (no wrapper-div+heading-sibling).
  icons: {
    // the svg's wrapper div must have exactly one element child: the svg itself
    iconSelector: "svg",
    // the wrapper div's next sibling must be one of these (the card title)
    headingTags: ["h1", "h2", "h3", "h4", "h5", "h6"],
    cap: "icon",
    label: "Icon",
    // never tag an svg matching/closest to any of these (decorative/structural/
    // chrome/already-editable). data-ce + a/button cover button arrows; data-cd
    // covers hero arrows + scroll strip; split-cta-right is a decorative accent
    // (the split-cta-left lightning bolt IS an editable icon).
    exclude: [
      "nav",
      "header",
      "footer",
      "a",
      "button",
      "[data-cd]",
      "[data-ce]",
      // .split-cta-left is intentionally NOT excluded: its prominent lightning
      // bolt is a "icon + heading" card (lone svg in a div whose next sibling is
      // the h2), so the customer can swap it like any other service icon.
      ".split-cta-right",
      ".cd-loader",
    ],
  },

  // Friendly section names (LABEL only — never used for ids). Signature-based,
  // resolved against structure, not heading text, so they stay correct.
  sectionRoles: [
    { role: "Hero", test: (s) => !!s.querySelector('[data-cd="hero-title"]') },
    { role: "About", test: (s) => !!s.querySelector('[data-cd="statbar"]') },
    { role: "Reviews", test: (s) => !!s.querySelector('[data-cd="t-slide"]') },
    {
      role: "Services",
      test: (s) =>
        s.querySelectorAll("h3").length >= 3 &&
        s.querySelectorAll("img").length === 0,
    },
    {
      role: "Gallery",
      test: (s) =>
        s.querySelectorAll("img").length >= 3 && !s.querySelector("h1,h2,h3"),
    },
    { role: "Highlight", test: (s) => /circuit-bg/.test(String(s.className)) },
  ],
};
