// Trigger entrance animations once the page is ready.
function start() {
  requestAnimationFrame(() => {
    requestAnimationFrame(() => document.body.classList.add("loaded"));
  });
}
if (document.readyState === "complete") {
  start();
} else {
  window.addEventListener("load", start);
}

// Mobile menu toggle (bubble nav burger)
const burger = document.querySelector(".nav-burger");
const links = document.querySelector(".nav-links");
if (burger && links) {
  burger.addEventListener("click", () => {
    const open = burger.getAttribute("aria-expanded") === "true";
    burger.setAttribute("aria-expanded", String(!open));
    links.classList.toggle("is-open");
  });
}

/* ===========================================================
   Phone showcase — two modes, chosen automatically:
   • Pinned scroll-through (the premium effect): while the hero pins,
     page scroll drives the inner site upward 1:1, then the page carries
     on. Needs the inner site's height, which is readable only for a
     same-origin site or one that posts its height (see message handler).
   • Interactive (fallback): the site fills the screen and you scroll it
     inside the phone like a real device. Used when the height can't be
     known (e.g. a cross-origin site that doesn't report it), so the whole
     site is always reachable.
   The inner site is always rendered at a real phone viewport width and
   scaled to fit, so it shows its proper mobile layout, never squished.
   =========================================================== */
const track = document.querySelector(".hero-track");
const frame = document.querySelector(".phone-frame");
const screen = document.querySelector(".phone-screen");
const FRAME_REF_W = 390;   // render the inner site at a real phone viewport width

let frameScale = 1;
let innerMax = 0;          // pinned: visual px the inner site can travel
let pinHeight = 0;         // pinned: inner site content height at the reference width
let lastScrolled = -1;     // pinned: memo to skip redundant transform writes
let pinned = false;

function readContentHeight() {
  try {
    const doc = frame.contentDocument || frame.contentWindow.document;
    if (!doc) return 0;
    const b = doc.body, d = doc.documentElement;
    return Math.max(
      b ? b.scrollHeight : 0, b ? b.offsetHeight : 0,
      d ? d.scrollHeight : 0, d ? d.offsetHeight : 0
    );
  } catch (e) {
    return 0; // cross-origin / not ready
  }
}

// Interactive: lay the site out at a real phone width, scale to fit, and let
// it scroll inside the frame on its own.
function fitInteractive() {
  const screenW = screen.clientWidth, screenH = screen.clientHeight;
  frameScale = screenW / FRAME_REF_W;
  frame.style.width = FRAME_REF_W + "px";
  frame.style.height = screenH / frameScale + "px";
  frame.style.transform = "scale(" + frameScale + ")";
}

// Pinned: size the iframe to the full content height; page scroll drives it.
function enablePinned(contentH) {
  if (!track || !(contentH > 0)) return;
  pinned = true;
  pinHeight = contentH;
  const screenW = screen.clientWidth, screenH = screen.clientHeight;
  frameScale = screenW / FRAME_REF_W;
  frame.style.width = FRAME_REF_W + "px";
  frame.style.height = contentH + "px";
  frame.classList.add("is-pinned");
  innerMax = Math.max(Math.round(contentH * frameScale - screenH), 0);
  track.style.height = window.innerHeight + innerMax + "px";
  lastScrolled = -1;
  updatePhone();
}

function measurePhone() {
  if (!frame || !screen) return;
  if (pinned) {
    enablePinned(pinHeight);          // recompute scale / innerMax (e.g. on resize)
  } else {
    fitInteractive();
    const h = readContentHeight();    // same-origin sites upgrade to pinned
    if (h > 0) enablePinned(h);
  }
}

function updatePhone() {
  if (!pinned || !track || !frame) return;
  const top = track.getBoundingClientRect().top;
  const scrolled = Math.min(Math.max(-top, 0), innerMax);
  if (scrolled === lastScrolled) return;
  lastScrolled = scrolled;
  frame.style.transform = "translateY(" + -scrolled + "px) scale(" + frameScale + ")";
}

function clamp01(v) { return v < 0 ? 0 : v > 1 ? 1 : v; }

/* ===========================================================
   "Here's what we can do" — white cover rises over the previous
   section, then a conveyor of capabilities streams bottom-left ->
   centre -> top-left as you scroll, ending on "We do it all."
   =========================================================== */
const awdTrack = document.querySelector(".awd-track");
const awdPin = document.querySelector(".awd-pin");
const awdPanel = document.querySelector(".awd-panel");
const awdHead = document.querySelector(".awd-head");
const awdConveyor = document.querySelector(".awd-conveyor");
const awdItems = Array.prototype.slice.call(document.querySelectorAll(".awd-item"));
const awdOutro = document.querySelector(".awd-outro");
const awd = { coverDist: 0, convDist: 0, outroDist: 0, total: 0, spacing: 0, lastS: -1 };

function measureAwd() {
  if (!awdTrack || !awdPin) return;
  const vh = window.innerHeight;
  awd.coverDist = vh * 0.85;
  awd.convDist = vh * 0.55 * awdItems.length;
  awd.outroDist = vh * 0.9;
  awd.total = awd.coverDist + awd.convDist + awd.outroDist;
  awd.spacing = Math.max((awdConveyor ? awdConveyor.clientHeight : vh) * 0.24, 62);
  awdTrack.style.height = vh + awd.total + "px";
  awd.lastS = -1; // dimensions changed — force the next write
  updateAwd();
}
function updateAwd() {
  if (!awdTrack) return;
  const top = awdTrack.getBoundingClientRect().top;
  const s = Math.min(Math.max(-top, 0), awd.total);
  // Off-section (above or fully past) `s` is pinned to a constant; skip the
  // whole per-item loop so we aren't recomputing 13 transforms every frame
  // while the user is actually scrolling some other section.
  if (s === awd.lastS) return;
  awd.lastS = s;

  // Phase A: white panel rises to cover the previous section
  const coverP = clamp01(s / awd.coverDist);
  if (awdPanel) awdPanel.style.transform = "translateY(" + (1 - coverP) * 100 + "%)";

  // Phase B: conveyor streams
  const b1 = awd.coverDist;
  const convP = clamp01((s - b1) / awd.convDist);
  const N = awdItems.length;
  const a = -1.5 + convP * (N + 3); // active fractional index
  const sp = awd.spacing;
  for (let i = 0; i < N; i++) {
    const d = i - a;
    const ad = Math.abs(d);
    const y = d * sp;
    const x = -(Math.min(ad, 2.5) / 2.5) * 90;
    const sc = 1 - Math.min(ad, 3) * 0.07;
    const op = clamp01(1 - (ad - 0.3) / 1.3);
    const el = awdItems[i];
    el.style.transform =
      "translate(" + x.toFixed(1) + "px, calc(-50% + " + y.toFixed(1) + "px)) scale(" + sc.toFixed(3) + ")";
    el.style.opacity = op.toFixed(3);
    el.classList.toggle("active", ad < 0.55);
  }

  // Phase C: outro — fade head + conveyor out, "We do it all." in
  const b2 = b1 + awd.convDist;
  const outP = clamp01((s - b2) / awd.outroDist);
  if (awdOutro) awdOutro.style.opacity = outP.toFixed(3);
  const fade = (1 - outP).toFixed(3);
  if (awdHead) awdHead.style.opacity = fade;
  if (awdConveyor) awdConveyor.style.opacity = fade;
}

/* ===========================================================
   "We play the system" — pinned horizontal scroll
   6 tiles, each 100vw; the rail translates left as you scroll
   down. Runs on every screen size (incl. mobile).
   =========================================================== */
const tacticsTrack = document.querySelector(".tactics-track");
const tacticsRail = document.querySelector(".tactics-rail");
const tacticsDots = Array.prototype.slice.call(document.querySelectorAll(".tactics-dot"));
let tacticsLastS = -1; // memo: skip rewriting the rail transform when unchanged

function tacticTileWidth() {
  // Use the real tile width so the rail can't drift from the layout.
  const first = tacticsRail && tacticsRail.firstElementChild;
  return first ? first.getBoundingClientRect().width : window.innerWidth;
}

function measureTactics() {
  if (!tacticsTrack || !tacticsRail) return;
  const n = document.querySelectorAll(".tactic").length;
  const scrollDist = tacticTileWidth() * (n - 1);
  tacticsTrack.style.height = window.innerHeight + scrollDist + "px";
  tacticsLastS = -1; // dimensions changed — force the next write
  updateTactics();
}

function updateTactics() {
  if (!tacticsTrack || !tacticsRail) return;
  const tileW = tacticTileWidth();
  const n = document.querySelectorAll(".tactic").length;
  const scrollDist = tileW * (n - 1);
  const top = tacticsTrack.getBoundingClientRect().top;
  const s = Math.min(Math.max(-top, 0), scrollDist);
  if (s === tacticsLastS) return;
  tacticsLastS = s;
  tacticsRail.style.transform = "translateX(" + -s + "px)";
  const active = Math.min(Math.round(s / tileW), n - 1);
  tacticsDots.forEach(function(dot, i) {
    dot.classList.toggle("active", i === active);
  });
}

function measureAll() {
  measurePhone();
  measureAwd();
  measureTactics();
}

let ticking = false;
function onScroll() {
  if (ticking) return;
  ticking = true;
  requestAnimationFrame(() => {
    updatePhone();
    updateAwd();
    updateTactics();
    ticking = false;
  });
}

if (frame) {
  frame.addEventListener("load", () => {
    measurePhone();
    // Re-check after web fonts / async layout (and SPA render) settle.
    setTimeout(measurePhone, 300);
    setTimeout(measurePhone, 1200);
  });
}

// A same-origin site, or any site that opts in, can report its own height —
// which upgrades the showcase from interactive to the pinned scroll-through.
window.addEventListener("message", (e) => {
  const data = e && e.data;
  if (data && data.type === "phoneSiteHeight" && typeof data.height === "number") {
    enablePinned(data.height);
  }
});

window.addEventListener("scroll", onScroll, { passive: true });

// On mobile the URL bar showing/hiding fires `resize` with a new height on
// almost every scroll. Re-measuring then changes the vh-based pin track
// heights mid-scroll, which makes the page jump ("teleport"). Only re-measure
// when the WIDTH actually changes (rotation / real resize).
let lastWidth = window.innerWidth;
window.addEventListener("resize", () => {
  if (window.innerWidth === lastWidth) return;
  lastWidth = window.innerWidth;
  measureAll();
});
window.addEventListener("orientationchange", measureAll);

measureAll();

// Card widths depend on fonts; re-measure once they settle.
if (document.fonts && document.fonts.ready) {
  document.fonts.ready.then(measureAll);
}
setTimeout(measureAll, 400);

/* ===========================================================
   Contact form → POST the enquiry to the n8n webhook as JSON
   =========================================================== */
const WEBHOOK_URL = "https://n8n-production-d02c.up.railway.app/webhook/a9535112-5d90-4ecc-a74a-7a9c8bcbdc81";
const contactForm = document.getElementById("contactForm");
if (contactForm) {
  const statusEl = contactForm.querySelector(".form-status");
  const submitBtn = contactForm.querySelector("button[type=submit]");
  const setStatus = (msg, cls) => {
    if (!statusEl) return;
    statusEl.textContent = msg;
    statusEl.className = "form-status" + (cls ? " " + cls : "");
  };

  contactForm.addEventListener("submit", async function(e) {
    e.preventDefault();
    const d = new FormData(contactForm);
    // n8n expects an array with one object, using these exact field names.
    const payload = [{
      "name": (d.get("name") || "").trim(),
      "number": (d.get("number") || "").trim(),
      "email": (d.get("email") || "").trim(),
      "Trade": (d.get("trade") || "").trim(),
      "Suburb/area": (d.get("suburb") || "").trim(),
      "Message": (d.get("message") || "").trim()
    }];

    if (submitBtn) submitBtn.disabled = true;
    setStatus("Sending…", "");
    try {
      const res = await fetch(WEBHOOK_URL, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload)
      });
      if (!res.ok) throw new Error("HTTP " + res.status);
      contactForm.reset();
      setStatus("Thanks — we'll be in touch shortly.", "ok");
    } catch (err) {
      setStatus("Couldn't send just now — email us at daniel.anderle.dan@gmail.com", "err");
    } finally {
      if (submitBtn) submitBtn.disabled = false;
    }
  });
}

/* ===========================================================
   Scroll reveals
   - `.stage` gets `.revealed` (phone fly-up) as it scrolls into view,
     so the phone is centred & landing before the inner site can scroll.
   - `.reveal` elements (ally section) fade/rise in once.
   =========================================================== */
const revealEls = document.querySelectorAll(".stage, .reveal");
if ("IntersectionObserver" in window) {
  const io = new IntersectionObserver(
    (entries) => {
      entries.forEach((entry) => {
        if (!entry.isIntersecting) return;
        const el = entry.target;
        el.classList.add(el.classList.contains("stage") ? "revealed" : "in");
        io.unobserve(el);
      });
    },
    { threshold: 0.2 }
  );
  revealEls.forEach((el) => io.observe(el));
} else {
  revealEls.forEach((el) => el.classList.add(el.classList.contains("stage") ? "revealed" : "in"));
}
