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

function update() {
  if (!track || !frame) return;
  const top = track.getBoundingClientRect().top;
  const scrolled = Math.min(Math.max(-top, 0), innerMax);
  frame.style.transform = "translateY(" + -scrolled + "px)";
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
const awd = { coverDist: 0, convDist: 0, outroDist: 0, total: 0, spacing: 0 };

function measureAwd() {
  if (!awdTrack || !awdPin) return;
  const vh = window.innerHeight;
  awd.coverDist = vh * 0.85;
  awd.convDist = vh * 0.55 * awdItems.length;
  awd.outroDist = vh * 0.9;
  awd.total = awd.coverDist + awd.convDist + awd.outroDist;
  awd.spacing = Math.max((awdConveyor ? awdConveyor.clientHeight : vh) * 0.24, 62);
  awdTrack.style.height = vh + awd.total + "px";
  updateAwd();
}
function updateAwd() {
  if (!awdTrack) return;
  const top = awdTrack.getBoundingClientRect().top;
  const s = Math.min(Math.max(-top, 0), awd.total);

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

function measureAll() {
  measure();
  measureAwd();
}

let ticking = false;
function onScroll() {
  if (ticking) return;
  ticking = true;
  requestAnimationFrame(() => {
    update();
    updateAwd();
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
window.addEventListener("resize", measureAll);
measureAll();

// Card widths depend on fonts; re-measure once they settle.
if (document.fonts && document.fonts.ready) {
  document.fonts.ready.then(measureAll);
}
setTimeout(measureAll, 400);

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
