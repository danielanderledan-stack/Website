# Editor v2 — Reference-Based Rich Editing (design + implementation plan)

**Date:** 2026-06-19
**Branch:** `claude/elegant-maxwell-THblU`
**Scope:** NEW customer sites only (the 3 existing customers are not retrofitted).
**Builds on:** `2026-06-19-visual-editor-redesign-design.md`

---

## 1. The two decisions you asked me to make

**Q: Do we need to touch the HTML template (the React bundle)?**
**A: No.** The bundle is minified (no source) *and* we don't need it. `fuse.cjs`
already holds the fully-rendered DOM in jsdom at `postProcess`, and sections are
already clean, self-contained children of `#root main` (see the SECTION-marker
loop, fuse.cjs ~L1000). We stamp editing references there. If a region lacks a
clean selector, `fuse.cjs` adds the hook itself during tagging — still zero
template edits.

**Q: Is modifying the merger (`fuse.cjs`) enough?**
**A: Yes** — `fuse.cjs` + a declarative **edit-schema manifest** it consumes.
That's the whole generator-side change. New sites are then born editable.

## 2. The reference scheme (baked at fuse time)

Every editable element gets three stamps:

```html
<h1 data-ce="hero.title" data-ce-cap="rich" data-ce-label="Headline"> … </h1>
```

- **`data-ce`** — a unique, content-independent id: `{section}.{role}[.{index}]`
  (e.g. `services.card.2.title`). Unique ⇒ **unambiguous targeting, no occurrence
  guessing ever** — the core robustness win over find/replace.
- **`data-ce-cap`** — capability: `plain | rich | image | color | list`. Declares
  what the editor may do to it. This is your "allow just certain parts, reliably."
- **`data-ce-label`** — friendly name; powers an optional structured outline panel
  later, and makes the HTML self-documenting.

Stable because the id is derived from the section's canonical **role + position**,
never from its text — editing a heading never changes its id.

## 3. The edit-schema manifest — single source of truth (and the formatting guide)

`prerender/edit-schema.cjs` declares, per canonical section, what's editable.
This is the adaptability layer: a new editing feature is a new `cap`; a new
section is a new entry. Code doesn't change — data does.

```js
module.exports = {
  // capability registry — extend this to add new editing powers
  caps: ["plain", "rich", "image", "color", "list"],

  sections: [
    {
      role: "hero",
      // how to find this section's root among #root main children:
      match: '[data-cd="hero"]',            // hook, signature, or nth fallback
      label: "Hero",
      regions: [
        { role: "title", sel: '[data-cd="hero-title"]', cap: "rich",  label: "Headline" },
        { role: "sub",   sel: '[data-cd="hero-sub"]',   cap: "rich",  label: "Subheading" },
        { role: "cta",   sel: '.hero-btn',              cap: "rich",  label: "Button" },
        { role: "bg",    sel: '[data-cd="hero"] img',   cap: "image", label: "Background" },
      ],
    },
    {
      role: "services",
      match: ':section-with(h2:contains("Services"))',  // resolved by a matcher fn
      label: "Services",
      regions: [
        { role: "heading",     sel: '.section-h2',           cap: "rich",  label: "Section heading" },
        { role: "card.title",  sel: '.service-card h3',      cap: "plain", label: "Service title", repeat: true },
        { role: "card.desc",   sel: '.service-card p',       cap: "rich",  label: "Service text",  repeat: true },
        { role: "card.icon",   sel: '.service-card img,svg', cap: "image", label: "Icon",          repeat: true },
      ],
    },
    // about, photo-strip, testimonials, pricing, blog, contact, map …
  ],
};
```

`repeat: true` ⇒ tag every match, indexed (`services.card.1.title`,
`services.card.2.title`…), so variable counts across trades just work. Missing
sections (a trade with no pricing) are simply skipped.

## 4. `fuse.cjs` tagging pass

Add `tagEditable(doc, schema)` invoked inside the existing section walk in
`postProcess`:

1. For each `#root main` child, resolve its canonical `role` via the schema's
   `match` (hook → signature → ordinal fallback). Set `data-ce-section="hero"`.
2. For each region, `querySelectorAll(sel)` **scoped to that section**; assign
   `data-ce` / `data-ce-cap` / `data-ce-label` (indexing repeats).
3. Where a target has no stable selector, add a class/attr here (DOM-only; never
   the template).

Deterministic, idempotent, and co-located with the SECTION-marker logic that
already proves fuse understands the section layout.

## 5. Backend — one new n8n action `save-elements`

`builder-auth` gains `save-elements`; **`save-texts` stays untouched**.

- Input: `{ page, edits: [{ ce, html?, style? }] }`.
- Locate the element by its **unique** `data-ce="ce"` (find the start tag, scan to
  the depth-matched close tag — inner nesting is inline-only, so bounded).
- `html` → replace inner HTML; `style` → merge into the element's `style` attr.
- **Sanitize hard** (server-side allowlist): tags `b strong i em u br span a`;
  attrs `href` (http/https/tel/mailto only) and `style` limited to
  `color | font-weight | font-style | text-decoration | font-family`
  (font-family from a known set; emit the matching Google-Fonts `<link>` if absent).
  Everything else stripped. Customers format text; they never inject markup/JS.
- Commit → redeploy (unchanged).

Unique-id targeting = no occurrence ambiguity, and inner-HTML replace = rich +
mixed-content (split headings, div labels) all just work.

## 6. Editor (frontend) changes

- **Bind from `data-ce`** (retire the regex `computeBlocks`). The DOM *is* the
  schema now — read caps directly.
- `cap="plain"` → contenteditable text (today's behaviour).
- `cap="rich"` → contenteditable + a **floating Canva/Shopify-style toolbar**:
  **Bold / Italic / Underline / Colour / Font** on the current selection
  (execCommand or manual range-wrapping → allow-listed inner HTML).
- `cap="color"` / per-element colour & font → set element style; per-element font
  triggers a font-load.
- `cap="image"` → swap (today's behaviour).
- Save sends `{ce, html|style}` to `save-elements`. Publish-watcher unchanged.
- `data-ce-label` enables a future **structured outline** (Hero ▸ Services ▸ …).

## 7. Section modularity & the "add new sections later" path

Sections are already isolated (`#root main` children + SECTION markers). The
formatting guide we commit (`prerender/EDITING-FORMAT.md`):

- A **section** = one direct child of `#root main`, with a canonical `role`.
- Editable elements carry `data-ce` / `-cap` / `-label`.
- Rich content allowlist (above).
- **To add a section type:** (1) make the renderer/config emit the block, (2) add
  one `sections[]` entry to `edit-schema.cjs`. It's editable automatically — no
  editor or backend change.

This is the same shape as Shopify section schemas, scoped to our fixed template.

## 8. Implementation phases

1. **Schema + guide** — write `edit-schema.cjs` + `EDITING-FORMAT.md`; validate
   selectors against ≥3 trades' rendered output (electrician/plumber/roofer).
2. **`fuse.cjs` `tagEditable`** — tagging pass; unit-check the stamped output.
3. **Backend `save-elements`** — additive n8n action + sanitizer; test via MCP.
4. **Editor** — bind-from-`data-ce`, rich toolbar, per-element colour/font.
5. **Validate end-to-end** — run `fuse.cjs` **locally** on a config to get tagged
   HTML, drive the editor in dev against it; then deploy + test login/publish on
   the **abbey-boilers test account** (re-fused once, purely to validate — not a
   retrofit programme).
6. **Rebuild the n8n fuser image** so the live pipeline emits references for all
   new customers.

## 9. Risks
- Selector drift across trades → mitigated by validating the schema on multiple
  trades + ordinal/signature fallbacks; `repeat` for variable counts.
- Sanitizer is security-critical → strict allowlist, server-side, tested.
- Depth-matched close-tag scan in the backend → bounded (inline-only nesting);
  covered by tests with nested `<span>`/`<b>`.
- n8n fuser image rebuild is the one infra step → isolated to Phase 6.
