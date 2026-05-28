# SEO Audit — Complete Digital
**Date:** 2026-05-28  
**Auditor:** Claude Code  
**Branch:** claude/elegant-maxwell-THblU

---

## 1. Framework

**Vanilla HTML / CSS / JavaScript — no framework, no build system.**

- Pure static HTML files served directly
- No Next.js, Astro, WordPress, or any CMS
- No `package.json`, no bundler, no server-side rendering
- Fonts loaded via Google Fonts CDN (`preconnect` hint present)
- All JS in a single `script.js` file
- All styles in a single `styles.css` file

**Implication for SEO plan:** Steps written for Next.js App Router (`export const metadata`, `/seo/config.ts`) cannot be applied as-is. Equivalent approach for this stack: a central `seo.js` data file (plain JS object) + per-page `<head>` tags edited directly. No TypeScript — use `.js`.

---

## 2. Existing Pages and Routes

| File | Route (current) | Purpose |
|---|---|---|
| `index.html` | `/` or `/index.html` | Homepage |
| `design.html` | `/design.html` | Design philosophy (5-stage process) |
| `seo.html` | `/seo.html` | SEO approach (6-stage process) |
| `contact.html` | `/contact.html` | Get a quote / contact form |
| `phone-site.html` | `/phone-site.html` | Demo tradie site embedded in phone showcase — NOT a real agency page |

**Missing pages flagged in SEO plan:**
- No `/about` page
- No `/services/*` pages (web design, SEO, maintenance, etc.)
- No location pages (`/melbourne`, `/bayside`, `/black-rock`, etc.)
- No `/work` or `/pricing` page
- No `/press` or `/featured-in` page
- No `/sitemap.xml`
- No `/robots.txt`

---

## 3. Current Meta Tag Implementation

**Method:** Per-page, hand-written in each `<head>`. No centralised config.

### index.html
```html
<title>Complete digital… — Websites that get tradies booked out</title>
<meta name="description" content="Complete digital builds fast, mobile-first websites for sparkies, chippies, plumbers and builders." />
<html lang="en">
```
- No `<link rel="canonical">`
- No OG tags
- No Twitter card
- No `<meta name="robots">`

### design.html
```html
<title>Design philosophy — Complete digital…</title>
<meta name="description" content="How Complete digital builds tradie websites: listen, mobile-first, speed, convert, maintain." />
```
- No canonical, no OG, no robots meta

### seo.html
```html
<title>SEO approach — Complete digital…</title>
<meta name="description" content="How Complete digital gets tradies found on Google: research, on-page, local, content, authority, monitor." />
```
- No canonical, no OG, no robots meta

### contact.html
```html
<title>Get a quote — Complete digital…</title>
<meta name="description" content="Tell us your trade and your area — Complete digital comes back with a plan and a fixed price, usually the same day." />
```
- No canonical, no OG, no robots meta

**Summary of meta tag gaps across all pages:**

| Tag | Present? |
|---|---|
| `<title>` | ✅ All pages |
| `<meta name="description">` | ✅ All pages |
| `<link rel="canonical">` | ❌ None |
| `<meta property="og:title">` | ❌ None |
| `<meta property="og:description">` | ❌ None |
| `<meta property="og:image">` | ❌ None |
| `<meta property="og:url">` | ❌ None |
| `<meta name="twitter:card">` | ❌ None |
| `<meta name="robots">` | ❌ None |
| `<html lang="en-AU">` | ❌ All pages use `lang="en"` |

---

## 4. Existing Schema Markup

### index.html — LocalBusiness (partial)
```json
{
  "@type": "LocalBusiness",
  "name": "Complete digital",
  "description": "...",
  "url": "https://completedigital.com.au",
  "email": "daniel.anderle.dan@gmail.com",
  "telephone": "+61432839654",
  "address": {
    "@type": "PostalAddress",
    "addressCountry": "AU"
  },
  "areaServed": "Australia",
  "knowsAbout": [...],
  "contactPoint": {...}
}
```

**Missing from LocalBusiness schema:**
- `addressLocality` / `addressRegion` / `postalCode` / `streetAddress` — only country present
- `geo` (latitude/longitude)
- `priceRange`
- `sameAs` (social profiles, GBP)
- `openingHoursSpecification`
- `founder` (Person)
- `logo` / `image`
- `legalName`
- `aggregateRating` (correct — none fabricated)
- `WebSite` schema with `SearchAction`
- `Organization` schema

### contact.html — ContactPage + LocalBusiness (minimal)
Present but minimal — same gaps as above.

### design.html — No schema
### seo.html — No schema

---

## 5. Sitemap

**No `sitemap.xml` exists anywhere in the project.**

There is no build process to auto-generate one. Will need to be created manually as a static file and updated when new pages are added.

---

## 6. robots.txt

**No `robots.txt` exists.**

Crawlers will crawl everything by default (equivalent to `Allow: /` for all agents). No explicit disallow rules, no sitemap declaration.

---

## 7. Image Optimisation Strategy

**No `<img>` tags exist on any page.** All visuals are:
- Inline `<svg>` elements (trade tool illustrations, tactic diagrams, warmth chart, merch flatlay)
- CSS-generated elements (blobs, gradients, dots)
- One cross-origin `<iframe>` (phone showcase)

**Implication:** Step 6.3 WebP / `<picture>` / width+height requirements don't apply until real photography or raster images are added. When they are, those rules apply from day one.

Google Fonts: loaded via external CDN with `rel="preconnect"` hints. No `font-display: swap` visible (that's in the Google Fonts URL parameter `&display=swap` — ✅ present).

---

## 8. Internal Linking Patterns

### Navigation (all pages)
- Brand logo → `index.html#home`
- Home → `index.html#home`
- Design → `design.html`
- SEO → `seo.html`
- Get a quote → `contact.html`

All nav links are real `<a href>` elements. ✅

### Footer (all pages)
- Phone number: `tel:+61432839654`
- Email: `mailto:daniel.anderle.dan@gmail.com`
- **No page links in footer** — no Design, SEO, Contact, or location links

### In-body cross-links
- `design.html` → bottom: `<a href="seo.html">Next: how we get you found...</a>`
- `seo.html` → bottom: `<a href="contact.html">Want to rank? Let's talk →</a>`
- `index.html` → contact section: links to `design.html` and `seo.html`
- `index.html` → merch section CTA: `href="#contact"` (anchor-only, not a page link)
- `contact.html` → `design.html` and `seo.html`

All links use relative URLs. No absolute URLs used for internal links. No `rel="nofollow"` on any internal link. ✅

**Gaps:** Footer has no page navigation — sitelinks and crawl depth both suffer. No breadcrumbs. No links to location pages (none exist yet).

---

## 9. CMS / Content Layer

**None.** All content is hard-coded in HTML files. No headless CMS, no WordPress, no Contentful, no markdown pipeline. Updating content requires direct HTML edits.

---

## 10. Brand Name Consistency Issue (Critical)

**The SEO plan specifies `Complete Digital` (both words capitalised).** The current codebase uses `Complete digital` (lowercase 'd') throughout:

- All HTML visible text: "Complete digital…"
- Schema `name` field: `"Complete digital"`  
- Nav brand name: "Complete digital"
- Footer: "Complete digital…"
- Page titles: "Complete digital…"
- Meta descriptions: "Complete digital"

This needs to be resolved with Dan before implementing the SEO plan. Two options:
1. Adopt `Complete Digital` everywhere (schema, meta, visible copy) — aligns with SEO plan
2. Keep `Complete digital` as the stylistic brand choice (lowercase 'd' is intentional) — schema `name` should still match the legal/registered name

**Recommendation:** Confirm with Dan whether the stylised lowercase is intentional or a typo. The SEO plan is unambiguous (`Complete Digital`), so this audit flags it as a discrepancy requiring decision before Step 1.

---

## 11. Summary: Gap Matrix vs SEO Plan

| SEO Plan Requirement | Current State | Priority |
|---|---|---|
| Canonical tags | ❌ Missing all pages | High |
| OG / Twitter meta | ❌ Missing all pages | High |
| `lang="en-AU"` | ❌ Using `lang="en"` | Medium |
| `robots.txt` | ❌ Missing | High |
| `sitemap.xml` | ❌ Missing | High |
| Complete LocalBusiness schema | ⚠️ Partial (no geo, address, founder, sameAs) | High |
| WebSite + Organization schema | ❌ Missing | High |
| Service pages schema | ❌ No service pages exist | High |
| Breadcrumb schema | ❌ No breadcrumbs exist | Medium |
| Footer nav links | ❌ Phone/email only | Medium |
| `<address>` element | ❌ Missing all pages | Medium |
| About page | ❌ Doesn't exist | High |
| Location pages (8+) | ❌ None exist | High |
| Services pages (6+) | ❌ None exist | High |
| Work / case studies page | ❌ Doesn't exist | Medium |
| `<meta name="robots">` | ❌ Missing all pages | Low |
| Title tag keyword targeting | ⚠️ Not keyword-optimised | High |
| Meta description length | ⚠️ Short (index: 92 chars, target 140–155) | Medium |
| Unique titles per page | ✅ All unique | — |
| Unique descriptions per page | ✅ All unique | — |
| Internal links are real `<a>` tags | ✅ | — |
| No `rel="nofollow"` on internal links | ✅ | — |
| Brand name capitalisation | ⚠️ "Complete digital" vs "Complete Digital" | Needs Dan input |

---

## 12. Recommended Execution Order (given vanilla HTML stack)

1. **Confirm with Dan:** brand capitalisation (`Complete Digital` vs `Complete digital`)
2. **Step 1 adapted:** Create `/seo/config.js` as a plain JS object (not TypeScript)
3. **Step 2:** Add canonical, OG, Twitter, robots meta + fix titles/descriptions — directly in each HTML `<head>`
4. **Step 3:** Expand existing schema + add WebSite/Organization/Breadcrumb where pages exist
5. **Step 6.1–6.2:** Create static `sitemap.xml` + `robots.txt`
6. **Step 4.1:** Add footer navigation links; `<address>` block
7. **Step 5:** Create location pages as new HTML files
8. **Step 4.2:** Create `about.html`
9. **Steps 7:** Footer brand block, logo alt text consistency

Steps 4.3 (press page), service pages, and work pages require content from Dan before they can be built.

---

*End of audit. Review before proceeding to Step 1.*
