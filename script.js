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

/* ===========================================================
   Story scroll: one pinned stage, scroll mapped to phases
     1) rail        — cards translate right-to-left
     2) cover       — white panel rises over the tiles
     3) crm title   — heading swaps to "Complete CRM System"
     4) steps       — each info fades in/out (last one holds)
   =========================================================== */
const storyTrack = document.querySelector(".story-track");
const storyPin = document.querySelector(".story-pin");
const railEl = document.querySelector(".do-rail");
const barEl = document.querySelector(".do-progress span");
const coverEl = document.querySelector(".cover");
const headEl = document.querySelector(".head-bar");
const crmEl = document.querySelector(".crm");
const stepEls = Array.prototype.slice.call(document.querySelectorAll(".crm-step"));

const story = { railDist: 0, coverDist: 0, titleDist: 0, stepDist: 0, total: 0 };

function clamp01(v) { return v < 0 ? 0 : v > 1 ? 1 : v; }

function measureStory() {
  if (!storyTrack || !storyPin || !railEl) return;
  const vh = window.innerHeight;
  story.railDist = Math.max(railEl.scrollWidth - storyPin.clientWidth, 0);
  story.coverDist = vh * 0.9;
  story.titleDist = vh * 0.6;
  story.stepDist = vh * 1.0;
  story.total =
    story.railDist + story.coverDist + story.titleDist + story.stepDist * stepEls.length;
  storyTrack.style.height = vh + story.total + "px";
  updateStory();
}

// Triangle window: 0 -> in -> 1 -> out -> 0 (or hold at 1 when `hold`)
function windowFade(local, hold) {
  if (local <= 0) return 0;
  if (local >= 1) return hold ? 1 : 0;
  const fin = 0.3, fout = 0.7;
  if (local < fin) return local / fin;
  if (local > fout) return hold ? 1 : (1 - local) / (1 - fout);
  return 1;
}

function updateStory() {
  if (!storyTrack || !railEl) return;
  const top = storyTrack.getBoundingClientRect().top;
  const s = Math.min(Math.max(-top, 0), story.total);

  // 1) rail
  const railS = Math.min(s, story.railDist);
  railEl.style.transform = "translateX(" + -railS + "px)";
  if (barEl) {
    const p = story.railDist > 0 ? railS / story.railDist : 1;
    barEl.style.transform = "scaleX(" + p + ")";
  }

  // 2) cover rises
  const b1 = story.railDist;
  const coverP = clamp01((s - b1) / story.coverDist);
  if (coverEl) coverEl.style.transform = "translateY(" + (1 - coverP) * 100 + "%)";

  // 3) heading fades out / CRM fades in
  const b2 = b1 + story.coverDist;
  const titleP = clamp01((s - b2) / story.titleDist);
  if (headEl) {
    headEl.style.opacity = String(1 - titleP);
    headEl.style.transform = "translateY(" + -titleP * 30 + "px)";
  }
  if (crmEl) crmEl.style.opacity = String(titleP);

  // 4) steps fade in/out (last holds)
  const b3 = b2 + story.titleDist;
  for (let i = 0; i < stepEls.length; i++) {
    const local = (s - (b3 + i * story.stepDist)) / story.stepDist;
    const hold = i === stepEls.length - 1;
    const o = windowFade(local, hold);
    stepEls[i].style.opacity = String(o);
    stepEls[i].style.transform = "translateY(" + (1 - o) * 22 + "px)";
  }
}

function measureAll() {
  measure();
  measureStory();
}

let ticking = false;
function onScroll() {
  if (ticking) return;
  ticking = true;
  requestAnimationFrame(() => {
    update();
    updateStory();
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

// Build the calendar figure (coded mock with a few booked days).
function buildCalendar() {
  const grid = document.querySelector(".cal-grid");
  if (!grid || grid.childElementCount) return;
  const lead = 3; // leading days from the previous month
  const days = 31;
  const busy = { 6: 1, 13: 1, 18: 2, 25: 1 }; // 2 = two bookings that day
  let html = "";
  for (let i = 0; i < lead; i++) html += '<span class="cal-day muted">' + (26 + i) + "</span>";
  for (let d = 1; d <= days; d++) {
    let cls = "cal-day";
    if (busy[d]) cls += " busy" + (busy[d] === 2 ? " two" : "");
    html += '<span class="' + cls + '">' + d + "</span>";
  }
  const trail = (7 - ((lead + days) % 7)) % 7;
  for (let i = 1; i <= trail; i++) html += '<span class="cal-day muted">' + i + "</span>";
  grid.innerHTML = html;
}
buildCalendar();

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
