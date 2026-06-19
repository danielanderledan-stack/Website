# Visual Editor Redesign — Design Spec (v1)

**Date:** 2026-06-19
**Branch:** `claude/elegant-maxwell-THblU`
**Dev route:** `/editor` (will replace `/visual-editor` once stable)
**Status:** Approved architecture — proceeding to UI design phase.

---

## 1. Problem

The current "visual editor" (`visual-editor/index.html`) is **not visual**. It's 12 tabs of
textareas and selects. The customer never sees their site; they edit a field labelled
"Main heading" and the backend does a blind find/replace in the HTML. It exposes the
site's *adaptable structure* instead of the site itself.

We are replacing it with a **Shopify/Wix-style WYSIWYG**, deliberately dumbed-down: the
customer sees their actual site and clicks the thing they want to change — text or image.

## 2. The model (ground truth)

Every live customer is a **GitHub repo of fully prerendered static HTML**, deployed to
Vercel. Example: `saferoofrepairs.au` → repo `danielanderledan-stack/SAFE-ROOF-RESTORATION`.

```
index.html  about/  services/  pricing/  blog/(+1-4)  contact/   ← 6 pages, full DOM baked in
assets/site.css   assets/site.js (vanilla)   assets/images/...    ← NO React, NO runtime config
sitemap.xml  robots.txt  vercel.json  EDITING.md
```

Three facts drive the whole design:

1. **The site IS the HTML.** No React at runtime, no config to round-trip. (The
   `sites/configs/*.json` + SPA bundle are the spam-demo track — irrelevant here.)
2. **The HTML is highly structured.** Every page carries `<!-- ===== SECTION: name ===== -->`
   delimiters, `data-cd="..."` hooks, and clean semantic tags. Because every site is the
   *same template*, these landmarks are identical across all customers.
3. **A working backend already exists.** `builder-auth` (n8n) authenticates the customer,
   reads their repo's HTML from GitHub, applies **SEARCH/REPLACE** (`find` + `occurrence` →
   `text`) for text and byte-`swap` for images, commits, and Vercel redeploys (~1–2 min).

So this is a **front-end problem**, not a backend one. The backend stays; we build a
visual front-end on top of it.

## 3. Goals / Non-goals

**v1 goals:** customer logs in, sees their real site, edits existing text spots in place,
swaps images, changes brand colours and business details — all visually — and publishes.

**Non-goals (deferred):**
- **v2:** blog post editor; re-add analytics/stats.
- **v2+/v3:** section hide/reorder, new pages, fonts, announcement banner, domain
  purchase. The UI must be **modular** so these slot back in as panels without a rewrite.
- Adding/removing text elements. Only **existing** text spots are editable.

## 4. Architecture

### 4.1 Where it lives
One central editor app at `completedigital.org/editor` (dev). It edits each customer's
**own** git repo via `builder-auth`. It is *not* copied into customer repos. Kept in the
main repo (same deploy, same `builder-auth` origin, reuses `cd-builder-token` auth).

### 4.2 Instant display — host the real HTML *inside* the page
The page HTML is fetched once, then hosted **same-origin** via
`<iframe srcdoc="…">` with a `<base href="https://<customer-domain>/">`.

- `srcdoc` inherits the editor's origin → parent has **full DOM access** to inject edit
  handlers/overlays.
- `<base href>` makes baked-in `/assets/site.css`, images and fonts load from the
  customer's deployment (stylesheets/images/scripts load cross-origin fine).
- **Instant:** after the one HTML fetch, every edit is an in-memory DOM mutation — no
  server round-trip to preview. Switching pages swaps `srcdoc` (cached after first load).
- **Pixel-perfect:** it literally is the deployed site.

Why not iframe the live URL: cross-origin (no DOM access, can't inject editing) and every
navigation is a full reload. `srcdoc` is the fix.

In edit mode the page is loaded with the existing `?capture=1` hook (template already
supports it) to neutralize the loader screen and scroll-reveal animation so all content is
visible and static while editing.

### 4.3 The one backend addition: `page-html`
`builder-auth` gains a read action `page-html` → returns the **raw committed HTML** of a
page from the repo (GitHub read; authenticated; no browser CORS). The editor renders that
exact source, so the find/replace anchors it computes are against the same bytes the
backend will patch — **zero drift**. Everything else reuses existing actions.

### 4.4 Edit layer
Injected into the iframe document:
- **Hover** → outline editable text / images (amber).
- **Click text** → element becomes `contenteditable` with an outline; on blur, if changed,
  record an op and mark the element edited (subtle dot).
- **Click image** → file picker → client-side downscale → live preview swap in canvas +
  record op.

### 4.5 Edit ops (held client-side until Publish)
- **Text:** `{ page, find, occurrence, text }`. The editor computes `find` =
  the element's original `innerHTML` (preserves inline `<strong>`/`<a>`), and `occurrence`
  = deterministic index of that exact string on the page (it can see the whole DOM). This
  is the existing `save-texts` contract — but far more reliable than the blind editor,
  because the editor *sees* which node was clicked.
- **Image:** `{ page, path, bytes }` → existing `swap`.
- **Colours:** `{ primary, secondary }` → existing `colours` (live-previewed in-canvas via
  CSS-var override before publish).
- **Business details:** see §4.6.

### 4.6 Business details — dual scope (the workaround)
Two distinct user actions with two different scopes:
- **Side-panel field** (name / phone / email / address / suburb): change → on publish,
  replace **every** occurrence across all pages. → existing `save-details`.
- **In-canvas direct edit** of a specific text spot that happens to contain a detail:
  changes **that one occurrence only**, even if it's a business detail. → normal text op.

The side panel prefills from `site-info`. Both paths can be used; they don't conflict.

### 4.7 Publish
Collect all ops → batch to `builder-auth` (`save-texts` per page, `swap` per image,
`colours`, `save-details`) → GitHub commits → Vercel redeploys → live in ~1–2 min.
Show progress; success toast; clear the op buffer.

### 4.8 UI shell & extensibility
- **Top bar:** logo/brand, page switcher (Home/About/Services/Pricing/Blog/Contact),
  desktop/mobile toggle, "view live", **Publish**.
- **Left rail:** a **panel registry** — v1 panels: *Edit* (default click-to-edit),
  *Colours*, *Business details*. v2/v3 register more (*Analytics*, *Blog*, *Sections*,
  *Fonts*, *Banner*, *Domain*) without touching the shell.
- **Canvas:** the `srcdoc` iframe + edit overlay.
- **Undo:** in-session op stack.

## 5. Edge cases & solutions

| Risk | Solution |
|---|---|
| `site.js` loader/carousel/reveal interfere | Load with `?capture=1` (existing hook); or strip `site.js` in edit mode. |
| Ambiguous find/replace (same text twice) | Editor sees exact node → anchor on section + tag + occurrence-within-page; send full `innerHTML` as `find`. |
| Cross-origin HTML fetch | Go through `page-html` (GitHub read) — authenticated, no CORS. |
| Image size/format | Client-side max-size check + auto-downscale before `swap`. |
| Inline markup inside a paragraph | Edit unit = smallest text-bearing element; `find`/replace on `innerHTML` to preserve inline tags. |
| Older/variant sites missing a marker | Schema panels show only for positively-detected regions; fall back to generic click-anything. |
| Stale source (repo changed since load) | Re-fetch + checksum page HTML at publish; warn + reload on mismatch. |
| Undo / safety | Ops buffered client-side; in-session undo; every publish is a revertible git commit. |
| Mobile preview | Toggle iframe width — site is responsive, free. |

## 6. How other builders do this (reference)
- **Shopify theme editor / WordPress full-site:** real theme in a same-origin iframe +
  `postMessage` + constrained section schema. ← closest analog.
- **TinaCMS contextual editing:** real site in an iframe + click-to-edit overlays mapping
  back to content. ← almost exactly our model.
- **Wix/Webflow/Framer:** proprietary renderer + JSON document model — re-platforming;
  wrong for static-HTML sites.
- **Builder.io/Plasmic/Puck/GrapesJS:** data-attribute / component-registry editing — the
  "bake stable `data-edit-id`s" upgrade path for later precision.

We clone **Shopify/TinaCMS**, but simpler: every site is the identical template, so the
"schema" of editable regions is hardcoded once, not derived per site.

## 7. Rollout
1. Build at `/editor` (dev) against a real test repo (SAFE-ROOF-RESTORATION).
2. Validate text + image + colours + details + publish end-to-end.
3. Swap `/visual-editor` → `/editor` once stable; keep old editor reachable during cutover.

## 8. Brand / design direction
New brand colours **#fb8500 / #ffb703** (warm orange/amber), sleek and modern.
Deliberately avoid AI-stereotype design (no purple gradients, glassmorphism, emoji
headers, generic Inter-everything, over-rounded). Pro-tool chrome: crisp, dense, warm
neutrals, confident accent. Detailed in the design-phase deliverable.
