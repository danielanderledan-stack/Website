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
   Pinned phone-scroll
   While the hero is pinned (sticky), scrolling through the tall
   `.hero-track` drives the inner site (loaded in an iframe) upward
   1:1 — so the page appears to "stop" and the phone's website scrolls
   until it reaches the bottom, after which the page continues.
   =========================================================== */
const track = document.querySelector(".hero-track");
const frame = document.querySelector(".phone-frame");
const screen = document.querySelector(".phone-screen");

let innerMax = 0;          // how far the inner site can scroll
const FALLBACK_MAX = 1400; // used if the iframe height can't be read

function readContentHeight() {
  try {
    const doc = frame.contentDocument || frame.contentWindow.document;
    if (!doc) return 0;
    const b = doc.body;
    const d = doc.documentElement;
    return Math.max(
      b ? b.scrollHeight : 0,
      b ? b.offsetHeight : 0,
      d ? d.scrollHeight : 0,
      d ? d.offsetHeight : 0
    );
  } catch (e) {
    return 0; // cross-origin / not ready
  }
}

function measure() {
  if (!track || !frame || !screen) return;

  const screenH = screen.clientHeight;
  let contentH = readContentHeight();

  if (contentH > 0) {
    frame.style.height = contentH + "px";
  } else {
    // Couldn't read the iframe; keep it screen-height and use a fallback span.
    contentH = screenH + FALLBACK_MAX;
  }

  innerMax = Math.max(Math.round(contentH - screenH), 0);
  // Track = one viewport (the pinned portion) + the inner scroll distance.
  track.style.height = window.innerHeight + innerMax + "px";
  update();
}

let ticking = false;
function update() {
  if (!track || !frame) return;
  const top = track.getBoundingClientRect().top;
  const scrolled = Math.min(Math.max(-top, 0), innerMax);
  frame.style.transform = "translateY(" + -scrolled + "px)";
}
function onScroll() {
  if (ticking) return;
  ticking = true;
  requestAnimationFrame(() => {
    update();
    ticking = false;
  });
}

if (frame) {
  frame.addEventListener("load", () => {
    measure();
    // Re-measure after web fonts / async layout settle.
    setTimeout(measure, 300);
    setTimeout(measure, 1200);
  });
}

// The inner site can also report its own height (works even cross-origin,
// and lets a swapped-in site opt in).
window.addEventListener("message", (e) => {
  const data = e && e.data;
  if (data && data.type === "phoneSiteHeight" && typeof data.height === "number") {
    const screenH = screen ? screen.clientHeight : 0;
    frame.style.height = data.height + "px";
    innerMax = Math.max(Math.round(data.height - screenH), 0);
    track.style.height = window.innerHeight + innerMax + "px";
    update();
  }
});

window.addEventListener("scroll", onScroll, { passive: true });
window.addEventListener("resize", measure);
measure();

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
