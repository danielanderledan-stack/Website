// Trigger entrance animations once the page is ready.
// The `.loaded` class releases the flying tools from their off-screen
// start positions and kicks off the phone's idle float + screen reveal.
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
