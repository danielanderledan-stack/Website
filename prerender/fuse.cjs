/* ============================================================================
   fuse.js — pre-renders a customer config + React template bundle into a
   fully static site.

   Runs the REAL production bundle inside jsdom (no browser needed), lets it
   render every page exactly as it would in a visitor's browser, then:
     - drives the live React app (clicks) to capture markup React only
       renders conditionally (mobile menu, testimonial slides, hero captions,
       calculator base prices) — so no template logic is ever reimplemented
     - bakes SEO tags, JSON-LD and CSS-variable theming into each page
     - strips the React bundle and wires the standard vanilla site.js
     - rewrites /sites/<slug>/... URLs to clean root-relative URLs
     - pretty-prints the HTML with section markers for later (AI) editing

   Exports: fuseSite(input) -> { files: [{path, content}], copies: [{from, to}],
                                 warnings: [string] }

   input = {
     config:   customer config object (same JSON the SPA fetches)
     bundleJs: contents of sites/assets/index-*.js   (the React bundle)
     cssText:  contents of sites/assets/index-*.css  (the template CSS)
     siteJs:   contents of prerender/site.js         (standard interactivity)
     domain:   final site origin, e.g. "https://www.1300findleak.com.au"
               (used for canonical/og:url/sitemap; default https://<slug>.vercel.app)
     slug:     optional, derived from config if missing
   }

   Only dependency: jsdom  (n8n: NODE_FUNCTION_ALLOW_EXTERNAL=jsdom)
   ========================================================================= */

"use strict";

/* ----------------------------------------------------------------------
   CSS appended to the template stylesheet. Replaces the hover effects the
   React app attached with JS, styles the burger X animation and calculator
   active states (driven by classes site.js toggles), and keeps reveal
   content visible when JS is unavailable. Theme-aware via CSS variables.
---------------------------------------------------------------------- */
const EXTRA_CSS = `
/* ===== cd-static additions (generated; safe to edit) ===== */
/* button height patch carried over from the demo shell */
.btn-yellow{padding-top:9px!important;padding-bottom:9px!important}
/* reveal fallback: if site.js never runs, content must stay visible */
html:not(.js) .reveal,html:not(.js) .reveal-l,html:not(.js) .reveal-r{opacity:1!important;transform:none!important}
/* photo-row hover (was a React mouseenter handler) */
.cd-zoom:hover img{transform:scale(1.06)!important}
.cd-zoom:hover .cd-tint{background:rgba(var(--color-primary-rgb),.18)!important}
/* footer bottom-link hover (was a React mouseenter handler) */
.cd-flink:hover{color:var(--color-primary)!important}
/* "Website by Complete Digital" footer backlink */
.cd-credit{transition:color .2s ease}
.cd-credit:hover{color:var(--color-primary)!important}
/* burger icon morphs into an X when open */
[data-cd="burger"].cd-open span:nth-child(1){transform:rotate(45deg) translateY(7px)!important}
[data-cd="burger"].cd-open span:nth-child(2){opacity:0!important}
[data-cd="burger"].cd-open span:nth-child(3){transform:rotate(-45deg) translateY(-7px)!important}
/* calculator toggle active states (site.js toggles .cd-on) */
[data-cd="calc-urgency"] button.cd-on{background:var(--color-primary)!important;color:#111!important}
[data-cd="calc-type"] button.cd-on{background:var(--color-secondary)!important;color:var(--color-primary)!important}
/* outline button (quote-only + contact-band ctas) */
.btn-outline{display:inline-flex;align-items:center;justify-content:center;gap:8px;background:transparent;color:var(--color-secondary);font-family:Roboto,sans-serif;font-size:13px;font-weight:700;letter-spacing:.5px;padding:9px 28px;border:2px solid var(--color-secondary);cursor:pointer;transition:background .2s ease,color .2s ease}
.btn-outline:hover{background:var(--color-secondary);color:#fff}
.btn-outline-light{color:#fff;border-color:rgba(255,255,255,.6)}
.btn-outline-light:hover{background:#fff;color:var(--color-secondary)}
/* quote-only section heading (clamp lives here, not inline — jsdom-safe) */
.cd-quote-h2{font-size:clamp(26px,3.5vw,40px);margin-bottom:20px}
/* full-screen loading screen (site.js slides it away after load) */
.cd-loader{position:fixed;inset:0;z-index:9999;background:#0b0b0b;display:flex;flex-direction:column;align-items:center;justify-content:center;text-align:center;padding:24px;transition:transform .7s cubic-bezier(.7,0,.2,1)}
.cd-loader.cd-hide{transform:translateY(-100%)}
.cd-loader-name{font-family:Roboto Slab,serif;font-weight:800;color:#fff;font-size:clamp(28px,6vw,56px);letter-spacing:1px;line-height:1.12;opacity:0;animation:cd-loader-fade .8s ease .1s forwards}
.cd-loader-slogan{font-family:Roboto,sans-serif;font-size:clamp(11px,2.4vw,14px);font-weight:700;letter-spacing:4px;text-transform:uppercase;color:var(--color-primary);margin-top:16px;opacity:0;animation:cd-loader-fade .8s ease .35s forwards}
.cd-loader-bar{width:54px;height:2px;background:rgba(255,255,255,.14);margin-top:30px;overflow:hidden;position:relative}
.cd-loader-bar:after{content:"";position:absolute;top:0;bottom:0;left:-40%;width:40%;background:var(--color-primary);animation:cd-loader-slide 1.1s ease-in-out infinite}
@keyframes cd-loader-fade{to{opacity:1}}
@keyframes cd-loader-slide{0%{left:-40%}100%{left:100%}}
html:not(.js) .cd-loader{display:none}
`;

const PAGES = ["home", "about", "services", "pricing", "blog", "contact"];

function deriveSlug(cfg) {
  if (cfg.slug) return cfg.slug;
  return (
    (cfg.logoPrefix || cfg.businessName || "site") +
    " " +
    (cfg.suburb || "")
  )
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
}

/* ---------- tiny async helpers ---------- */
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function waitFor(fn, timeoutMs, label) {
  const t0 = Date.now();
  for (;;) {
    let v;
    try {
      v = fn();
    } catch (e) {
      v = null;
    }
    if (v) return v;
    if (Date.now() - t0 > timeoutMs)
      throw new Error("Timed out waiting for " + label);
    await sleep(15);
  }
}

/* ----------------------------------------------------------------------
   Render one route in jsdom by executing the real bundle.
---------------------------------------------------------------------- */
async function renderRoute(
  { JSDOM, VirtualConsole },
  bundleJs,
  config,
  slug,
  domain,
  route,
) {
  const url =
    domain + "/sites/" + slug + (route === "home" ? "/" : "/" + route);
  const vc = new VirtualConsole(); // silence jsdom CSS/feature noise
  const dom = new JSDOM(
    `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<link rel="icon" type="image/svg+xml" href="/favicon.svg">
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin="">
<link href="https://fonts.googleapis.com/css2?family=Roboto:wght@300;400;500;700&amp;family=Roboto+Slab:wght@400;600;700;800&amp;display=swap" rel="stylesheet">
<link rel="stylesheet" href="/assets/site.css">
</head>
<body><div id="root"></div></body>
</html>`,
    {
      url,
      runScripts: "outside-only",
      pretendToBeVisual: true,
      virtualConsole: vc,
    },
  );
  const w = dom.window;

  /* The app only needs fetch (the config) and IntersectionObserver.
     The IO stub fires immediately so IO-gated state (stat bar width)
     reaches its final value; reveal classes are stripped afterwards. */
  w.fetch = () =>
    Promise.resolve({
      ok: true,
      status: 200,
      json: () => Promise.resolve(JSON.parse(JSON.stringify(config))),
    });
  w.IntersectionObserver = class {
    constructor(cb) {
      this.cb = cb;
    }
    observe(target) {
      const self = this;
      w.setTimeout(() => {
        try {
          self.cb([{ isIntersecting: true, target }], self);
        } catch (e) {}
      }, 0);
    }
    unobserve() {}
    disconnect() {}
    takeRecords() {
      return [];
    }
  };
  w.scrollTo = () => {};

  w.eval(bundleJs);

  await waitFor(
    () =>
      w.document.querySelector("#root nav") &&
      w.document.querySelector("#root footer"),
    8000,
    "page render (" + route + ")",
  );
  await sleep(60); // let SEO/meta effects and IO stubs settle
  return dom;
}

/* ----------------------------------------------------------------------
   React controlled inputs ignore plain .value writes — use the native
   setter then dispatch the event React listens for.
---------------------------------------------------------------------- */
function setNativeValue(w, el, value, eventType) {
  const proto =
    el.tagName === "SELECT"
      ? w.HTMLSelectElement.prototype
      : w.HTMLInputElement.prototype;
  Object.getOwnPropertyDescriptor(proto, "value").set.call(el, value);
  el.dispatchEvent(new w.Event(eventType, { bubbles: true }));
}

/* ========================================================================
   CAPTURE PHASE — drive the live React app to extract conditional markup
   ======================================================================== */

/* React 18 flushes click-driven renders via microtasks in jsdom — give it
   a beat after every synthetic interaction before reading the DOM. */
const settle = () => sleep(15);

/* Open the burger menu, clone the panel React renders, close it again. */
async function captureMobileMenu(w) {
  const doc = w.document;
  const btn = doc.querySelector('nav button[aria-label="Toggle menu"]');
  const nav = btn && btn.closest("nav");
  if (!btn || !nav) return null;
  const before = nav.children.length;
  btn.click();
  await settle();
  if (nav.children.length <= before) return null;
  const clone = nav.children[nav.children.length - 1].cloneNode(true);
  btn.click(); // restore closed state (burger bars un-X themselves)
  await settle();
  return clone;
}

/* Click through hero slides, recording each slide's headline/subheadline. */
async function captureHeroCaptions(w) {
  const doc = w.document;
  const hero = doc.getElementById("home");
  if (!hero) return null;
  const next = hero.querySelector('button[aria-label="Next slide"]');
  const slides = [...hero.children].filter(
    (el) =>
      el.tagName === "DIV" &&
      el.querySelector(":scope > img") &&
      !el.querySelector("h1"),
  );
  if (!next || slides.length === 0) return null;
  const captions = [];
  for (let i = 0; i < slides.length; i++) {
    const h1 = hero.querySelector("h1");
    const sub =
      h1 && h1.nextElementSibling && h1.nextElementSibling.tagName === "P"
        ? h1.nextElementSibling
        : null;
    captions.push({
      title: h1 ? h1.textContent : "",
      sub: sub ? sub.textContent : "",
    });
    next.click(); // after the last click we're back at slide 0
    await settle();
  }
  return { slides, captions };
}

/* Click each testimonial dot, cloning the quote + author markup React
   renders for it. Returns clones plus the live nodes to replace. */
async function captureTestimonials(w) {
  const doc = w.document;
  const dots = [...doc.querySelectorAll("#root .dot")];
  if (dots.length < 2) return null;
  const dotsWrap = dots[0].parentElement;
  const col = dotsWrap.parentElement;
  const variants = [];
  for (let i = 0; i < dots.length; i++) {
    doc.querySelectorAll("#root .dot")[i].click();
    await settle();
    const quote = col.querySelector(":scope > p");
    const author = col.querySelector(":scope > div.flex");
    if (!quote || !author) return null;
    variants.push({
      quote: quote.cloneNode(true),
      author: author.cloneNode(true),
    });
  }
  doc.querySelectorAll("#root .dot")[0].click(); // back to the first
  await settle();
  return { col, dotsWrap, variants };
}

/* Probe the calculator: with distance 0 and urgency off, the displayed
   price for each selected service equals its base price. Stamp it on the
   option so site.js can recompute with the original formula. */
async function probeCalculator(w, warnings) {
  const doc = w.document;
  const section = doc.getElementById("prices");
  if (!section) return null;
  const select = section.querySelector("select");
  const range = section.querySelector('input[type="range"]');
  const card = select && select.closest("div");
  const root = select ? select.closest(".pricing-calc-card") || section : null;
  if (!select || !range || !root) return null;
  const priceEl = [...root.querySelectorAll("span")].find(
    (s) =>
      /(^|\s)250\s*$/.test(s.textContent) && s.textContent.trim().length <= 8,
  );
  if (!priceEl) {
    warnings.push("calculator: price element not found — bases not probed");
    return null;
  }
  const currency = priceEl.textContent.replace(/[\d\s]+$/, "").trim() || "$";

  setNativeValue(w, range, 0, "input");
  await settle();
  for (const opt of [...select.options]) {
    if (!opt.value) continue;
    setNativeValue(w, select, opt.value, "change");
    await settle();
    const shown = parseInt(priceEl.textContent.replace(/[^\d]/g, ""), 10);
    if (!isNaN(shown)) opt.setAttribute("data-base", String(shown));
  }
  /* restore the defaults a fresh visitor sees */
  setNativeValue(w, select, "", "change");
  setNativeValue(w, range, 10, "input");
  await settle();
  return { section, select, range, root, priceEl, currency };
}

/* ========================================================================
   QUOTE-ONLY MARKUP — pricing is quote-only on every generated site: the
   pricing page's price sections are replaced with a text block + call/email
   CTAs, the home calculator becomes a static quote card, price-list rows
   show "Quote only", and a discount-notify form sits under the quote block.
   No config field carries the quote copy, so the text is generated from
   trade/suburb; quoteOnlyHeading / quoteOnlyText (string or array) override
   it when a config provides them.
   ======================================================================== */
function escHtml(s) {
  return String(s == null ? "" : s)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}
function telHref(phone) {
  return "tel:" + String(phone || "").replace(/[^\d+]/g, "");
}

/* Call + Email button pair. The call button dials config.phone; the email
   button is mailto: when the config has an address and inert otherwise. */
function ctaButtonsHtml(cfg, { callLabel, light }) {
  const outline = "btn-outline" + (light ? " btn-outline-light" : "");
  const call = cfg.phone
    ? '<a href="' +
      telHref(cfg.phone) +
      '" class="btn-yellow" style="font-size: 14px; padding: 15px 34px;">' +
      escHtml(callLabel || "Call " + cfg.phone) +
      "</a>"
    : "";
  const email =
    "<a" +
    (cfg.email ? ' href="mailto:' + escHtml(cfg.email) + '"' : "") +
    ' class="' +
    outline +
    '" style="font-size: 14px; padding: 13px 34px;">Email Us</a>';
  return call + email;
}

function quoteOnlyParas(cfg) {
  if (cfg.quoteOnlyText)
    return (
      Array.isArray(cfg.quoteOnlyText) ? cfg.quoteOnlyText : [cfg.quoteOnlyText]
    ).map(escHtml);
  const trade = (cfg.trade || "").toLowerCase();
  const job = trade ? trade + " job" : "job";
  return [
    "Some " +
      escHtml(job) +
      "s are a quick fix and you're sorted the same day. Others take real time and care to get right. No two are ever quite the same, and we'd rather not pretend they are by putting a one-size-fits-all price on yours.",
    "That's exactly why we're quote-only. We take a proper look at what you actually need and give you an honest, fixed price — nothing padded, nothing you didn't ask for. The quote is completely free, with no obligation to go ahead. If it turns out you only need a small fix, we'll tell you that too.",
  ];
}

function buildQuoteOnlySection(cfg) {
  const trade = (cfg.trade || "").toLowerCase();
  const heading = cfg.quoteOnlyHeading
    ? escHtml(cfg.quoteOnlyHeading)
    : "Every " + escHtml(trade ? trade + " job" : "job") + " is different";
  const paras = quoteOnlyParas(cfg);
  const ps = paras
    .map(
      (p, i) =>
        '<p style="font-family: Roboto, sans-serif; font-size: 16px; color: rgb(85, 85, 85); line-height: 1.85; margin-bottom: ' +
        (i === paras.length - 1 ? "36px" : "18px") +
        ';">' +
        p +
        "</p>",
    )
    .join("");
  return (
    '<section id="quote-only" style="padding: 64px 30px 76px;">' +
    '<div class="mx-auto" style="max-width: 760px; text-align: center;">' +
    '<div class="section-label" style="color: var(--color-primary);">Quote Only</div>' +
    '<h2 class="section-h2 cd-quote-h2">' +
    heading +
    "</h2>" +
    ps +
    '<div style="display: flex; gap: 12px; flex-wrap: wrap; justify-content: center;">' +
    ctaButtonsHtml(cfg, {}) +
    "</div></div></section>"
  );
}

function buildNotifySection() {
  return (
    '<section id="discount-notify" style="background: rgb(245, 245, 245); padding: 56px 30px 64px;">' +
    '<div class="mx-auto" style="max-width: 560px; text-align: center;">' +
    '<h2 class="section-h2" style="font-size: 24px; margin-bottom: 10px;">Get notified when we have a discount</h2>' +
    '<p style="font-family: Roboto, sans-serif; font-size: 14px; color: rgb(85, 85, 85); margin-bottom: 24px;">Leave your number or email below and we\'ll let you know.</p>' +
    '<form data-cd="discount-notify" style="display: flex; gap: 10px; flex-wrap: wrap; justify-content: center;">' +
    '<input type="text" required="" placeholder="Phone number or email" style="flex: 1 1 240px; max-width: 340px; border: 1.5px solid rgb(204, 204, 204); padding: 12px 14px; font-family: Roboto, sans-serif; font-size: 14px; color: rgb(51, 51, 51); background: rgb(255, 255, 255); outline: none;">' +
    '<button type="submit" class="btn-yellow" style="font-size: 13px;">Notify Me</button>' +
    "</form></div></section>"
  );
}

/* Static replacement for the home-page price calculator card. */
function buildQuoteCardInner(cfg) {
  const li = (t) =>
    '<li style="font-family: Roboto, sans-serif; font-size: 14px; color: rgb(26, 26, 26); display: flex; gap: 11px; align-items: center;"><span style="color: var(--color-primary); font-weight: 800;">✓</span>' +
    t +
    "</li>";
  const call = cfg.phone
    ? '<a href="' +
      telHref(cfg.phone) +
      '" class="btn-yellow" style="justify-content: center; width: 100%; margin-bottom: 12px;">Call ' +
      escHtml(cfg.phone) +
      "</a>"
    : "";
  return (
    '<h3 style="font-family: Roboto Slab, serif; font-weight: 700; font-size: 24px; color: rgb(26, 26, 26); margin-bottom: 14px;">Get a Free Quote</h3>' +
    "<p style=\"font-family: Roboto, sans-serif; font-size: 14px; color: rgb(85, 85, 85); line-height: 1.7; margin-bottom: 26px;\">Every job is different, so we don't do guesswork. Tell us what you need and we'll give you a clear, fixed quote &mdash; free and no obligation.</p>" +
    '<ul style="list-style: none; padding: 0px; margin: 0px 0px 28px; display: flex; flex-direction: column; gap: 12px;">' +
    li("Free, no-obligation quotes") +
    li("Upfront fixed pricing, no surprises") +
    li("Fully licensed &amp; insured") +
    "</ul>" +
    call +
    '<a href="/contact/" class="btn-outline" style="width: 100%;">Get a Quote</a>'
  );
}

/* ----------------------------------------------------------------------
   "Website by Complete Digital" footer backlink. A plain dofollow <a>
   (no rel=nofollow, so it passes link equity) appended to the footer credit
   line — the bottom-bar <p> carrying the business name — on every page of
   every MERGED customer site. Demos render straight from the bundle and
   never pass through fuse, so they stay credit-free. Inline-styled so it
   renders correctly even on already-deployed sites whose site.css predates
   the .cd-credit hover rule. Keep these constants in sync with the static
   injector in prerender/add-backlink.cjs (used to retrofit existing sites).
---------------------------------------------------------------------- */
const CREDIT_HREF = "https://completedigital.org";
const CREDIT_TEXT = "Website by Complete Digital";
const CREDIT_TITLE = "Website by Complete Digital — Melbourne web design & SEO";
const CREDIT_STYLE =
  "color: inherit; text-decoration: underline; text-underline-offset: 2px;";

function addCreditBacklink(doc, footer) {
  if (footer.querySelector("a.cd-credit")) return; // idempotent
  const a = doc.createElement("a");
  a.className = "cd-credit";
  a.setAttribute("href", CREDIT_HREF);
  a.setAttribute("title", CREDIT_TITLE);
  a.setAttribute("style", CREDIT_STYLE);
  a.textContent = CREDIT_TEXT;
  const bar = footer.lastElementChild;
  const line = bar && bar.querySelector("p");
  if (line) {
    line.appendChild(doc.createTextNode("  ·  "));
    line.appendChild(a);
  } else {
    /* fallback: no credit line — add our own centered bottom strip */
    const strip = doc.createElement("div");
    strip.setAttribute(
      "style",
      "padding: 16px 30px; text-align: center; font-family: Roboto, sans-serif; font-size: 12px; color: rgb(170, 170, 170);",
    );
    strip.appendChild(a);
    footer.appendChild(strip);
  }
}

/* ----------------------------------------------------------------------
   CONFIG-DRIVEN IMAGES. The template engine baked into the bundle forces
   every image to the hvac default set and ignores config-provided images.
   Here we let a config OVERRIDE any image slot: after the bundle renders
   (with hvac defaults), we swap the rendered default for the config value.

   A slot left absent, blank, or set to the string "default" keeps the
   standard (hvac) image — so existing image-less configs are unaffected.

   Slots whose hvac default filename maps 1:1 to one slot are swapped by
   filename (covers <img>, og/twitter image, preload, JSON-LD). The two
   filenames the engine reuses across sections (hero-2 / hero-3 appear in
   both the hero carousel AND the gallery) are handled by DOM position so
   the hero and gallery can hold different images.

   Accepted values: an absolute https URL, or a local /sites/images/<…>
   path (fuse's copy manifest + URL rewriter handle local paths the same
   way as the defaults).
---------------------------------------------------------------------- */
const HVAC_DIR = "/sites/images/hvac/";
function cfgImg(v) {
  if (typeof v !== "string") return null;
  const t = v.trim();
  if (!t || t.toLowerCase() === "default") return null;
  return t;
}
function applyConfigImages(doc, cfg, ctx) {
  cfg = cfg || {};
  const arr = (k) => (Array.isArray(cfg[k]) ? cfg[k] : []);
  const hero = arr("heroSlides");
  const posts = arr("blogPosts");

  /* --- filename -> override map (unique-filename slots only) --- */
  const map = {};
  const put = (file, val) => {
    const v = cfgImg(val);
    if (v) map[file] = v;
  };
  put("hero-1-owner-van.jpg", (hero[0] || {}).image);
  put("splitcta-owner-phone.jpg", cfg.splitCtaImage);
  [
    "photorow-split-install-hands.jpg",
    "photorow-refrigerant-gauges.jpg",
    "photorow-ducted-vent.jpg",
    "photorow-thermostat.jpg",
  ].forEach((f, i) => put(f, arr("photoRowImages")[i]));
  [
    "about-owner-portrait.jpg",
    "about-owner-condenser.jpg",
    "about-owner-customer.jpg",
  ].forEach((f, i) => put(f, arr("aboutImages")[i]));
  put("fullwidth-van-home.jpg", cfg.fullWidthImage);
  put("banner-living-room-split.jpg", cfg.bannerImage);
  put("testimonial-ceiling-cassette.jpg", cfg.testimonialsImage);
  put("pricingbg-split-dark.jpg", cfg.pricingBgImage);
  [
    "blog-1-smart-control.jpg",
    "blog-2-filter-compare.jpg",
    "blog-3-bedroom-split.jpg",
    "blog-4-maintenance.jpg",
  ].forEach((f, i) => put(f, (posts[i] || {}).image));

  /* og:image / JSON-LD render the default as a domain-absolute URL
     (domain + /sites/images/hvac/…); <img src> renders it relative. Replace
     the absolute form first (else the relative match leaves the domain
     stranded in front of an absolute override URL), then the relative form. */
  const domain = ctx.domain || "";
  const swap = (s) => {
    if (!s) return s;
    let out = s;
    for (const f in map) {
      const val = map[f];
      const absVal = /^https?:\/\//.test(val) ? val : domain + val;
      out = out.split(domain + HVAC_DIR + f).join(absVal);
      out = out.split(HVAC_DIR + f).join(val);
    }
    return out;
  };
  const swapAttr = (el, attr) => {
    const v = el.getAttribute(attr);
    const n = swap(v);
    if (n !== v) el.setAttribute(attr, n);
  };
  [...doc.querySelectorAll("#root img[src]")].forEach((im) =>
    swapAttr(im, "src"),
  );
  [...doc.querySelectorAll("meta[content]")].forEach((m) =>
    swapAttr(m, "content"),
  );
  [...doc.querySelectorAll("link[href]")].forEach((l) => swapAttr(l, "href"));
  [...doc.querySelectorAll('script[type="application/ld+json"]')].forEach(
    (s) => {
      const n = swap(s.textContent);
      if (n !== s.textContent) s.textContent = n;
    },
  );

  /* --- collisions: hero slides 1 & 2 (shared with the gallery) --- */
  if (ctx.heroCap && Array.isArray(ctx.heroCap.slides)) {
    [1, 2].forEach((i) => {
      const v = cfgImg((hero[i] || {}).image);
      const sl = v && ctx.heroCap.slides[i];
      const im = sl && sl.querySelector("img");
      if (im) im.setAttribute("src", v);
    });
  }
  /* --- gallery strip (5 images, rendered twice for the marquee) --- */
  const gal = arr("galleryImages");
  if (gal.some((x) => cfgImg(x))) {
    [...doc.querySelectorAll("#root img.blog-card-img.object-cover")].forEach(
      (im, idx) => {
        const v = cfgImg(gal[idx % 5]);
        if (v) im.setAttribute("src", v);
      },
    );
  }
}

/* ========================================================================
   POST-PROCESS PHASE — tag hooks, rebuild conditional markup statically,
   strip React, rewrite URLs, add section markers
   ======================================================================== */

function postProcess(w, ctx) {
  const doc = w.document;
  const { slug, domain, route, config, menuClone, heroCap, testi, calc } = ctx;
  const cfg = config || {};

  /* --- loading screen: name + first header text; the bar/slogan pick up
         the config colour via var(--color-primary) baked on <html> --- */
  const loader = doc.createElement("div");
  loader.className = "cd-loader";
  loader.setAttribute("data-cd", "loader");
  const loaderName = doc.createElement("div");
  loaderName.className = "cd-loader-name";
  loaderName.textContent = cfg.businessName || cfg.logoPrefix || slug;
  const loaderSlogan = doc.createElement("div");
  loaderSlogan.className = "cd-loader-slogan";
  loaderSlogan.textContent =
    (cfg.heroSlides && cfg.heroSlides[0] && cfg.heroSlides[0].title) ||
    cfg.logoTagline ||
    "";
  const loaderBar = doc.createElement("div");
  loaderBar.className = "cd-loader-bar";
  loader.appendChild(loaderName);
  loader.appendChild(loaderSlogan);
  loader.appendChild(loaderBar);
  doc.body.insertBefore(loader, doc.body.firstChild);

  /* --- navbar + mobile menu --- */
  const nav = doc.querySelector("#root nav") || doc.querySelector("nav");
  if (nav) {
    nav.setAttribute("data-cd", "nav");
    const burger = nav.querySelector('button[aria-label="Toggle menu"]');
    if (burger) burger.setAttribute("data-cd", "burger");
    if (menuClone) {
      menuClone.setAttribute("data-cd", "mobile-menu");
      menuClone.style.display = "none";
      nav.appendChild(menuClone);
    }
  }

  /* --- hero carousel --- */
  if (heroCap) {
    const hero = doc.getElementById("home");
    hero.setAttribute("data-cd", "hero");
    heroCap.slides.forEach((sl, i) => {
      sl.setAttribute("data-cd", "slide");
      if (heroCap.captions[i]) {
        sl.setAttribute("data-title", heroCap.captions[i].title);
        sl.setAttribute("data-sub", heroCap.captions[i].sub);
      }
    });
    const h1 = hero.querySelector("h1");
    if (h1) {
      h1.setAttribute("data-cd", "hero-title");
      const sub = h1.nextElementSibling;
      if (sub && sub.tagName === "P") sub.setAttribute("data-cd", "hero-sub");
    }
    const prev = hero.querySelector('button[aria-label="Previous slide"]');
    const next = hero.querySelector('button[aria-label="Next slide"]');
    if (prev) prev.setAttribute("data-cd", "hero-prev");
    if (next) next.setAttribute("data-cd", "hero-next");
  }

  /* --- testimonials: materialise every slide, first one visible --- */
  if (testi) {
    const { col, dotsWrap, variants } = testi;
    [...col.querySelectorAll(":scope > p, :scope > div.flex")].forEach((el) => {
      if (el !== dotsWrap) el.remove();
    });
    variants.forEach((v, i) => {
      const wrap = doc.createElement("div");
      wrap.setAttribute("data-cd", "t-slide");
      if (i !== 0) wrap.style.display = "none";
      wrap.appendChild(v.quote);
      wrap.appendChild(v.author);
      col.insertBefore(wrap, dotsWrap);
    });
    [...dotsWrap.querySelectorAll(".dot")].forEach((d, i) => {
      d.setAttribute("data-cd", "t-dot");
      d.classList.toggle("active", i === 0);
    });
  }

  /* --- calculator hooks --- */
  if (calc) {
    calc.root.setAttribute("data-cd", "calc");
    calc.select.setAttribute("data-cd", "calc-service");
    calc.range.setAttribute("data-cd", "calc-distance");
    calc.priceEl.setAttribute("data-cd", "calc-price");
    calc.priceEl.setAttribute("data-currency", calc.currency);
    const flexHead = calc.range.parentElement.firstElementChild;
    const badge = flexHead && flexHead.lastElementChild;
    if (badge && badge.tagName === "SPAN") {
      badge.setAttribute("data-cd", "calc-distance-value");
      const unit = badge.textContent.replace(/[\d\s]+/, "").trim();
      if (unit) badge.setAttribute("data-unit", unit);
    }
    /* The two Yes/No-style button groups (urgency first, type second in
       source order). React baked the active look as inline styles; move
       active-state styling to the .cd-on class so site.js can toggle it. */
    const groups = [...calc.root.querySelectorAll("div.flex.gap-0")];
    const tag = (group, name, activeIdx) => {
      if (!group) return;
      group.setAttribute("data-cd", name);
      [...group.querySelectorAll("button")].forEach((b, i) => {
        b.style.background = "#fff";
        b.style.color = "#1a1a1a";
        b.classList.toggle("cd-on", i === activeIdx);
      });
    };
    tag(groups[0], "calc-urgency", 1); /* "No" is the default */
    tag(groups[1], "calc-type", 0);
  }

  /* --- quote-only: home calculator becomes a static quote card and
         price-list rows show "Quote only" instead of a dollar figure --- */
  const pricesSec = doc.getElementById("prices");
  if (pricesSec) {
    const card = pricesSec.querySelector(".pricing-calc-card");
    if (card) {
      card.removeAttribute("data-cd");
      card.innerHTML = buildQuoteCardInner(cfg);
    }
    [...pricesSec.querySelectorAll(".price-row")].forEach((row) => {
      const val = row.lastElementChild;
      if (
        val &&
        val.tagName === "SPAN" &&
        !val.classList.contains("price-dots")
      )
        val.textContent = "Quote only";
    });
  }

  /* --- pricing page: drop every price section between the header banner
         and the contact band; insert the quote-only text block + the
         discount-notify form in their place --- */
  if (route === "pricing") {
    const main = doc.querySelector("#root main");
    if (main && main.children.length) {
      const first = main.children[0];
      const contactSec = doc.getElementById("contact");
      [...main.children].forEach((sec) => {
        if (sec !== first && sec !== contactSec) sec.remove();
      });
      const holder = doc.createElement("div");
      holder.innerHTML = buildQuoteOnlySection(cfg) + buildNotifySection();
      [...holder.children].forEach((sec) =>
        main.insertBefore(sec, contactSec || null),
      );
    }
  }

  /* --- contact band: the inert "Get a Quote" button becomes working
         Call Now / Email Us links (email inert when config has none) --- */
  const contactBand = doc.getElementById("contact");
  if (contactBand) {
    const bandBtn = contactBand.querySelector(
      "div.reveal-r > button.btn-yellow",
    );
    if (bandBtn) {
      const wrap = bandBtn.parentElement;
      wrap.style.display = "flex";
      wrap.style.gap = "12px";
      wrap.style.flexWrap = "wrap";
      wrap.style.justifyContent = "center";
      wrap.innerHTML = ctaButtonsHtml(cfg, {
        callLabel: "Call Now",
        light: true,
      });
    }
  }

  /* --- stat/progress bar: keep final width baked (works without JS),
         site.js re-animates from 0 using data-target --- */
  [...doc.querySelectorAll('div[style*="width 1.4s"]')].forEach((bar) => {
    bar.setAttribute("data-cd", "statbar");
    if (bar.style.width) bar.setAttribute("data-target", bar.style.width);
  });

  /* --- photo-row hover (was React mouseenter): class-based CSS now --- */
  [...doc.querySelectorAll("#root img")].forEach((img) => {
    if ((img.getAttribute("style") || "").includes("transform 0.5s")) {
      const wrap = img.parentElement;
      wrap.classList.add("cd-zoom");
      const tint = img.nextElementSibling;
      if (tint && tint.tagName === "DIV") tint.classList.add("cd-tint");
    }
  });

  /* --- footer: newsletter + bottom-link hover --- */
  [...doc.querySelectorAll("#root form")].forEach((f) => {
    if (f.querySelector('input[type="email"]'))
      f.setAttribute("data-cd", "newsletter");
  });
  const footer = doc.querySelector("#root footer");
  if (footer) {
    [...footer.querySelectorAll("a")].forEach((a) => {
      if ((a.getAttribute("style") || "").includes("color 0.2s"))
        a.classList.add("cd-flink");
    });
    /* --- "Website by Complete Digital" backlink: a real, crawlable dofollow
           link baked into the footer credit line of EVERY page of every
           MERGED (customer) site. Demos render straight from the bundle and
           never pass through fuse, so they stay credit-free. The inline style
           keeps it rendering correctly even on already-deployed sites whose
           site.css predates the .cd-credit hover rule. --- */
    addCreditBacklink(doc, footer);
  }

  /* --- reveal animations: strip the .visible our IO stub added so they
         replay on scroll exactly like the demo --- */
  [
    ...doc.querySelectorAll(
      ".reveal.visible, .reveal-l.visible, .reveal-r.visible",
    ),
  ].forEach((el) => el.classList.remove("visible"));

  /* --- strip React, wire the static assets --- */
  [
    ...doc.querySelectorAll('script[type="module"], link[rel="modulepreload"]'),
  ].forEach((el) => el.remove());
  const jsFlag = doc.createElement("script");
  jsFlag.textContent = "document.documentElement.classList.add('js')";
  doc.head.insertBefore(jsFlag, doc.head.firstChild);
  const siteScript = doc.createElement("script");
  siteScript.setAttribute("defer", "");
  siteScript.setAttribute("src", "/assets/site.js");
  doc.head.appendChild(siteScript);

  /* --- stable site id for the analytics tracker (site.js section 10);
         without it the tracker falls back to location.hostname --- */
  if (!doc.querySelector('meta[name="cd-site"]')) {
    const siteIdMeta = doc.createElement("meta");
    siteIdMeta.setAttribute("name", "cd-site");
    siteIdMeta.setAttribute("content", slug);
    doc.head.insertBefore(siteIdMeta, siteScript);
  }

  /* --- config-driven image overrides (before URL rewriting, so local
         override paths get the same /sites -> /assets treatment) --- */
  applyConfigImages(doc, config, ctx);

  /* --- URL rewriting: /sites/<slug>/page -> /page/, images -> /assets --- */
  const rew = (v) => {
    if (!v) return v;
    let out = v.split("/sites/images/").join("/assets/images/");
    const base = "/sites/" + slug;
    out = out.replace(
      new RegExp(
        "(^|" +
          domain.replace(/[.*+?^${}()|[\]\\]/g, "\\$&") +
          ")" +
          base.replace(/[.*+?^${}()|[\]\\]/g, "\\$&") +
          "(/[a-z0-9/-]*)?",
        "g",
      ),
      (m, origin, rest) => {
        let p = rest || "/";
        if (p !== "/" && !p.endsWith("/")) p += "/";
        return origin + p;
      },
    );
    return out;
  };
  [...doc.querySelectorAll("a[href]")].forEach((a) =>
    a.setAttribute("href", rew(a.getAttribute("href"))),
  );
  [...doc.querySelectorAll("img[src]")].forEach((i) =>
    i.setAttribute("src", rew(i.getAttribute("src"))),
  );
  [...doc.querySelectorAll("meta[content]")].forEach((m) =>
    m.setAttribute("content", rew(m.getAttribute("content"))),
  );
  [...doc.querySelectorAll('link[rel="canonical"]')].forEach((l) =>
    l.setAttribute("href", rew(l.getAttribute("href"))),
  );
  [...doc.querySelectorAll('script[type="application/ld+json"]')].forEach(
    (s) => {
      s.textContent = rew(s.textContent);
    },
  );

  /* --- section markers for future editors --- */
  const main = doc.querySelector("#root main");
  if (main) {
    [...main.children].forEach((sec, i) => {
      let name = sec.id;
      if (!name) {
        const h = sec.querySelector("h1,h2,h3");
        name = h
          ? h.textContent
              .trim()
              .toLowerCase()
              .replace(/[^a-z0-9]+/g, "-")
              .split("-")
              .slice(0, 4)
              .join("-")
              .replace(/^-|-$/g, "")
          : "";
      }
      if (!name) {
        const imgs = sec.querySelectorAll("img").length;
        name =
          (imgs >= 2
            ? "photo-strip"
            : imgs === 1
              ? "feature-image"
              : "section") +
          "-" +
          (i + 1);
      }
      sec.parentNode.insertBefore(
        doc.createComment(
          " ==================== SECTION: " + name + " ==================== ",
        ),
        sec,
      );
    });
  }
}

/* ========================================================================
   PRETTY-PRINTER — readable, edit-friendly HTML.
   Elements whose children are all elements/comments get one per line and
   indented; anything containing text keeps its exact serialized form
   (whitespace inside text-bearing markup is rendering-sensitive).
   ======================================================================== */
const VOID_TAGS = new Set([
  "area",
  "base",
  "br",
  "col",
  "embed",
  "hr",
  "img",
  "input",
  "link",
  "meta",
  "param",
  "source",
  "track",
  "wbr",
]);

function openTag(el) {
  let attrs = "";
  for (const at of el.attributes) {
    attrs +=
      " " +
      at.name +
      '="' +
      at.value.replace(/&/g, "&amp;").replace(/"/g, "&quot;") +
      '"';
  }
  return "<" + el.tagName.toLowerCase() + attrs + ">";
}
function isElementOnly(el) {
  let any = false;
  for (const ch of el.childNodes) {
    if (ch.nodeType === 3 && ch.textContent.trim() !== "") return false;
    if (ch.nodeType === 1 || ch.nodeType === 8) any = true;
  }
  return any;
}
function fmtNode(node, indent, out) {
  if (node.nodeType === 8) {
    out.push(indent + "<!--" + node.textContent + "-->");
    return;
  }
  if (node.nodeType === 3) {
    const t = node.textContent.trim();
    if (t) out.push(indent + t);
    return;
  }
  if (node.nodeType !== 1) return;
  const tag = node.tagName.toLowerCase();
  if (tag === "script" || tag === "style") {
    const txt = node.textContent.trim();
    if (txt) {
      out.push(indent + openTag(node));
      out.push(txt);
      out.push(indent + "</" + tag + ">");
    } else out.push(indent + openTag(node) + "</" + tag + ">");
    return;
  }
  if (VOID_TAGS.has(tag)) {
    out.push(indent + openTag(node));
    return;
  }
  if (!node.childNodes.length) {
    out.push(indent + openTag(node) + "</" + tag + ">");
    return;
  }
  if (isElementOnly(node)) {
    out.push(indent + openTag(node));
    for (const ch of node.childNodes) fmtNode(ch, indent + "  ", out);
    out.push(indent + "</" + tag + ">");
  } else {
    out.push(indent + node.outerHTML);
  }
}
function serializeDoc(doc) {
  const out = ["<!DOCTYPE html>"];
  fmtNode(doc.documentElement, "", out);
  return out.join("\n") + "\n";
}

/* ========================================================================
   SITE-LEVEL EXTRAS
   ======================================================================== */
function buildFavicon(cfg) {
  const letter = (
    cfg.logoCircleLetter ||
    (cfg.businessName || cfg.logoPrefix || "C").trim()[0] ||
    "C"
  ).toUpperCase();
  const bg = cfg.primaryColor || "#FFD338";
  const fg = cfg.secondaryColor || "#1a1a1a";
  return (
    '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64">' +
    '<circle cx="32" cy="32" r="30" fill="' +
    bg +
    '"/>' +
    '<text x="32" y="43" text-anchor="middle" font-family="Roboto Slab, serif" font-size="34" font-weight="800" fill="' +
    fg +
    '">' +
    letter +
    "</text></svg>\n"
  );
}
function buildSitemap(domain, routes) {
  const urls = routes
    .map(
      (r) =>
        "  <url><loc>" +
        domain +
        (r === "home" ? "/" : "/" + r + "/") +
        "</loc></url>",
    )
    .join("\n");
  return (
    '<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n' +
    urls +
    "\n</urlset>\n"
  );
}
function buildEditingGuide(slug) {
  return `# Editing guide — generated static site (${slug})

This site is fully static, pre-rendered HTML. There is no build step: edit a
file, commit, and Vercel serves it.

## Structure
- \`index.html\`, \`about/\`, \`services/\`, \`pricing/\`, \`blog/\`, \`blog/<n>/\`, \`contact/\`
  — one folder per page, each with its own \`index.html\`. URLs are the folder
  paths (e.g. \`/about/\`).
- \`assets/site.css\` — all styling. Brand colors are CSS variables set as an
  inline \`style\` on the \`<html>\` tag of every page (\`--color-primary\`,
  \`--color-primary-rgb\`, \`--color-primary-hover\`, \`--color-secondary\`).
  To re-theme the site, change those four values in each page's \`<html>\` tag;
  never hard-code colors that should follow the theme — use
  \`var(--color-primary)\` etc.
- \`assets/site.js\` — standard interactivity (carousel, mobile menu, reveal
  animations, price calculator, newsletter). It is identical on every site:
  do not put content in it. It finds its targets via \`data-cd\` attributes
  and skips anything missing, so deleting a section never breaks the rest.
- \`assets/images/\` — local images. External (CDN) image URLs are also fine.

## Conventions
- Every page section is preceded by \`<!-- ===== SECTION: name ===== -->\`.
  Keep these markers when editing; add one if you add a section.
- Keep \`data-cd\` attributes intact when moving/editing elements — they are
  the JS hooks. Removing an element with a hook is safe; renaming the
  attribute silently disables that one behavior.
- Hero slides: each \`[data-cd="slide"]\` carries \`data-title\`/\`data-sub\`
  (shown when that slide is active). The visible \`<h1 data-cd="hero-title">\`
  must match slide 1's \`data-title\` — edit both together.
- Calculator service prices live on each \`<option data-base="...">\`.
- Each page owns its full \`<head>\` (title, description, OG tags, JSON-LD).
  Keep them in sync with visible content when editing.
- SEO: keep exactly one \`<h1>\` per page and the canonical link correct.
`;
}

/* ========================================================================
   MAIN
   ======================================================================== */
async function fuseSite(input) {
  /* n8n's task runner freezes JS built-in prototypes (prototype-pollution
     hardening), which breaks jsdom's dependency chain at load time
     (decimal.js assigns .toString on plain objects). When we detect frozen
     intrinsics, re-run this same file in a clean child Node process —
     fresh, unfrozen intrinsics — and stream the result back. */
  if (Object.isFrozen(Object.prototype) && !process.env.CD_FUSER_CHILD) {
    return fuseInChildProcess(input);
  }
  const jsdomLib = input.jsdom || require("jsdom");
  const config = input.config;
  const slug = input.slug || deriveSlug(config);
  const domain = (input.domain || "https://" + slug + ".vercel.app").replace(
    /\/$/,
    "",
  );
  const warnings = [];
  const files = [];

  /* jsdom's CSS parser silently DROPS clamp() inline-style values, which the
     design uses for all responsive heading sizes. Swap each clamp() string
     literal in the bundle for a var() sentinel (which jsdom passes through
     verbatim), render, then restore the original clamp() text in the HTML. */
  const clampMap = new Map();
  const bundleJs = input.bundleJs.replace(/"(clamp\([^")]*\))"/g, (m, expr) => {
    let key = null;
    for (const [k, v] of clampMap) if (v === expr) key = k;
    if (!key) {
      key = "var(--cdclamp-" + clampMap.size + ")";
      clampMap.set(key, expr);
    }
    return '"' + key + '"';
  });
  const restoreClamps = (html) => {
    for (const [key, expr] of clampMap) html = html.split(key).join(expr);
    return html;
  };

  /* --- 1. blog post count: render the blog listing first and count links --- */
  const blogDom = await renderRoute(
    jsdomLib,
    bundleJs,
    config,
    slug,
    domain,
    "blog",
  );
  const postNums = new Set();
  [...blogDom.window.document.querySelectorAll("a[href]")].forEach((a) => {
    const m = (a.getAttribute("href") || "").match(/\/blog\/(\d+)\/?$/);
    if (m) postNums.add(parseInt(m[1], 10));
  });
  const routes = [
    ...PAGES,
    ...[...postNums].sort((a, b) => a - b).map((n) => "blog/" + n),
  ];

  /* --- 2. render + capture + post-process every route --- */
  for (const route of routes) {
    const dom =
      route === "blog"
        ? blogDom
        : await renderRoute(jsdomLib, bundleJs, config, slug, domain, route);
    const w = dom.window;

    const menuClone = await captureMobileMenu(w);
    const heroCap = await captureHeroCaptions(w);
    const calc = await probeCalculator(w, warnings);
    const testi = await captureTestimonials(w);
    if (route === "home") {
      if (!menuClone) warnings.push("home: mobile menu not captured");
      if (!heroCap) warnings.push("home: hero slides not captured");
      if (!calc) warnings.push("home: calculator not found/probed");
      if (!testi) warnings.push("home: testimonials not captured");
    }

    await sleep(30); // drain React's pending microtask work from the capture clicks

    postProcess(w, {
      slug,
      domain,
      route,
      config,
      menuClone,
      heroCap,
      testi,
      calc,
    });

    const path = route === "home" ? "index.html" : route + "/index.html";
    files.push({ path, content: restoreClamps(serializeDoc(w.document)) });
    await sleep(30); // let queued microtasks finish while the window is still alive
    try {
      w.close();
    } catch (e) {}
  }

  /* --- 3. site-wide assets --- */
  files.push({
    path: "assets/site.css",
    content: input.cssText + "\n" + EXTRA_CSS,
  });
  files.push({ path: "assets/site.js", content: input.siteJs });
  files.push({ path: "favicon.svg", content: buildFavicon(config) });
  files.push({
    path: "robots.txt",
    content: "User-agent: *\nAllow: /\n\nSitemap: " + domain + "/sitemap.xml\n",
  });
  files.push({ path: "sitemap.xml", content: buildSitemap(domain, routes) });
  /* ignoreCommand: analytics-mirror commits (analytics/events.ndjson, written
     by the collector after every visitor session) must not trigger a Vercel
     rebuild of the site — dashboards read the mirror via the collector's GET
     endpoint, not the deployed copy. Exits 0 (skip build) when only analytics/
     changed; errors on the first commit (no HEAD^), which Vercel treats as
     "build". */
  files.push({
    path: "vercel.json",
    content:
      JSON.stringify(
        {
          cleanUrls: true,
          trailingSlash: true,
          ignoreCommand: "git diff --quiet HEAD^ HEAD -- ':!analytics'",
        },
        null,
        2,
      ) + "\n",
  });
  files.push({ path: "EDITING.md", content: buildEditingGuide(slug) });

  /* --- 4. local images referenced by the pages -> copy manifest --- */
  const copies = [];
  const seen = new Set();
  for (const f of files) {
    if (!f.path.endsWith(".html")) continue;
    for (const m of f.content.matchAll(
      /\/assets\/images\/([a-zA-Z0-9_\-./]+)/g,
    )) {
      const rel = m[1];
      if (!seen.has(rel)) {
        seen.add(rel);
        copies.push({
          from: "sites/images/" + rel,
          to: "assets/images/" + rel,
        });
      }
    }
  }

  return { files, copies, warnings, slug, domain, routes };
}

function fuseInChildProcess(input) {
  const { execFile } = require("child_process");
  return new Promise((resolve, reject) => {
    const child = execFile(
      process.execPath,
      [__filename],
      {
        env: { ...process.env, CD_FUSER_CHILD: "1" },
        maxBuffer: 256 * 1024 * 1024,
        timeout: 180000,
      },
      (err, stdout, stderr) => {
        if (err)
          return reject(
            new Error(
              "cd-fuser child failed: " +
                ((stderr || "").slice(-2000) || err.message),
            ),
          );
        try {
          resolve(JSON.parse(stdout));
        } catch (e) {
          reject(
            new Error(
              "cd-fuser child returned invalid JSON: " + stdout.slice(0, 300),
            ),
          );
        }
      },
    );
    child.stdin.on("error", reject);
    child.stdin.write(JSON.stringify(input));
    child.stdin.end();
  });
}

/* child-process entry: input JSON on stdin, result JSON on stdout */
if (process.env.CD_FUSER_CHILD === "1" && require.main === module) {
  let buf = "";
  process.stdin.setEncoding("utf8");
  process.stdin.on("data", (c) => {
    buf += c;
  });
  process.stdin.on("end", async () => {
    try {
      const out = await fuseSite(JSON.parse(buf));
      process.stdout.write(JSON.stringify(out));
    } catch (e) {
      process.stderr.write(String((e && e.stack) || e));
      process.exit(1);
    }
  });
}

module.exports = { fuseSite };
