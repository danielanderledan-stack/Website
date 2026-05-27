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

let innerMax = 0;          // how far the inner site can scroll (in screen px)
let frameScale = 1;        // inner site is rendered at a reference width then scaled
let lastScrolled = -1;     // memo: skip rewriting the iframe transform when unchanged
const FRAME_REF_W = 238;   // logical width of the inner site (desktop screen inner width)
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
  const screenW = screen.clientWidth;
  // Render the inner site at a fixed reference width and scale it to fill the
  // screen, so the UI scales with the phone rather than reflowing. On desktop
  // the screen is ~238px wide, so the scale is 1 and nothing changes.
  frameScale = screenW / FRAME_REF_W;
  frame.style.width = FRAME_REF_W + "px";

  let contentH = readContentHeight(); // measured at the reference width

  if (contentH > 0) {
    frame.style.height = contentH + "px";
  } else {
    // Couldn't read the iframe; fall back to a generous span.
    contentH = screenH / frameScale + FALLBACK_MAX;
    frame.style.height = contentH + "px";
  }

  // Visual (post-scale) distance the inner site can travel inside the screen.
  innerMax = Math.max(Math.round(contentH * frameScale - screenH), 0);
  // Track = one viewport (the pinned portion) + the inner scroll distance.
  track.style.height = window.innerHeight + innerMax + "px";
  lastScrolled = -1; // scale/height may have changed — force the next write
  update();
}

function update() {
  if (!track || !frame) return;
  const top = track.getBoundingClientRect().top;
  const scrolled = Math.min(Math.max(-top, 0), innerMax);
  // Once the phone is fully scrolled (or not yet reached) `scrolled` is pinned
  // to a constant; skip re-applying the transform so we don't keep
  // recompositing the scaled iframe (a full secondary document) every frame.
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
   6 tiles, each 100vw; the rail translates left as you scroll.
   On mobile (≤900px) the pin is disabled; scroll-snap handles it.
   =========================================================== */
const tacticsTrack = document.querySelector(".tactics-track");
const tacticsRail = document.querySelector(".tactics-rail");
const tacticsDots = Array.prototype.slice.call(document.querySelectorAll(".tactics-dot"));
const isMobileTactics = () => window.innerWidth <= 900;
let tacticsLastS = -1; // memo: skip rewriting the rail transform when unchanged

function measureTactics() {
  if (!tacticsTrack || !tacticsRail) return;
  if (isMobileTactics()) {
    tacticsTrack.style.height = "";
    return;
  }
  const n = document.querySelectorAll(".tactic").length;
  const scrollDist = window.innerWidth * (n - 1);
  tacticsTrack.style.height = window.innerHeight + scrollDist + "px";
  tacticsLastS = -1; // dimensions changed — force the next write
  updateTactics();
}

function updateTactics() {
  if (!tacticsTrack || !tacticsRail) return;
  if (isMobileTactics()) {
    tacticsRail.style.transform = "";
    return;
  }
  const n = document.querySelectorAll(".tactic").length;
  const scrollDist = window.innerWidth * (n - 1);
  const top = tacticsTrack.getBoundingClientRect().top;
  const s = Math.min(Math.max(-top, 0), scrollDist);
  if (s === tacticsLastS) return;
  tacticsLastS = s;
  tacticsRail.style.transform = "translateX(" + -s + "px)";
  const active = Math.min(Math.round(s / window.innerWidth), n - 1);
  tacticsDots.forEach(function(dot, i) {
    dot.classList.toggle("active", i === active);
  });
}

function measureAll() {
  measure();
  measureAwd();
  measureTactics();
}

let ticking = false;
function onScroll() {
  if (ticking) return;
  ticking = true;
  requestAnimationFrame(() => {
    update();
    updateAwd();
    updateTactics();
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
    innerMax = Math.max(Math.round(data.height * frameScale - screenH), 0);
    track.style.height = window.innerHeight + innerMax + "px";
    lastScrolled = -1; // innerMax changed — force the next write
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
   Contact form → POST the enquiry to the n8n webhook as JSON
   =========================================================== */
const WEBHOOK_URL = "http://localhost:5678/webhook-test/a9535112-5d90-4ecc-a74a-7a9c8bcbdc81";
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
   Tactics carousel — auto-advance on mobile (no pin there).
   Plays only while the section is on screen; stops once the
   visitor takes over by swiping.
   =========================================================== */
const tacticsSection = document.querySelector(".tactics");
const tacticsPin = document.querySelector(".tactics-pin");
let tacticsTimer = null;
let tacticsUserTook = false;

function tacticsStep() {
  if (!tacticsPin || !isMobileTactics() || tacticsUserTook) return;
  const tileW = tacticsPin.clientWidth;
  const max = tacticsPin.scrollWidth - tileW - 2;
  let next = tacticsPin.scrollLeft + tileW;
  if (next > max) next = 0;
  tacticsPin.scrollTo({ left: next, behavior: "smooth" });
}
function startTacticsAuto() {
  if (tacticsTimer || tacticsUserTook || !isMobileTactics()) return;
  tacticsTimer = setInterval(tacticsStep, 3500);
}
function stopTacticsAuto() {
  if (tacticsTimer) { clearInterval(tacticsTimer); tacticsTimer = null; }
}
if (tacticsPin) {
  ["touchstart", "pointerdown", "wheel"].forEach((ev) =>
    tacticsPin.addEventListener(ev, () => { tacticsUserTook = true; stopTacticsAuto(); }, { passive: true })
  );
}
if (tacticsSection && "IntersectionObserver" in window) {
  const tio = new IntersectionObserver((entries) => {
    entries.forEach((en) => { en.isIntersecting ? startTacticsAuto() : stopTacticsAuto(); });
  }, { threshold: 0.35 });
  tio.observe(tacticsSection);
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
