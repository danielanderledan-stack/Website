/* ============================================================================
   site.js — standard interactivity for Complete Digital static sites
   ----------------------------------------------------------------------------
   This file is IDENTICAL across all customer sites. It contains no content
   and no per-customer data: everything it needs is read from the HTML via
   data-cd attributes and CSS classes. Every feature checks that its hooks
   exist and does nothing if they don't, so removing or rewriting a section
   of the HTML never breaks the rest of the page.

   Hooks used (all optional):
     [data-cd="nav"]                 navbar (scroll shadow)
     [data-cd="burger"]              mobile menu button
     [data-cd="mobile-menu"]         mobile menu panel
     [data-cd="hero"]                hero section
     [data-cd="slide"]               hero slide (data-title / data-sub)
     [data-cd="hero-title"]          hero headline
     [data-cd="hero-sub"]            hero subheadline
     [data-cd="hero-prev"] / [data-cd="hero-next"]  arrows
     [data-cd="statbar"]             animated progress bar (data-target="84%")
     [data-cd="t-slide"]             testimonial slide
     [data-cd="t-dot"]               testimonial dot button
     [data-cd="calc"]                price calculator root
       [data-cd="calc-service"]      <select> (options carry data-base="120")
       [data-cd="calc-distance"]     range input
       [data-cd="calc-distance-value"] "10 km" badge (data-unit="km")
       [data-cd="calc-urgency"]      urgency button group (Yes / No)
       [data-cd="calc-type"]         type button group (visual only)
       [data-cd="calc-price"]        price output (data-currency="$")
     [data-cd="newsletter"]          footer newsletter form
     .reveal / .reveal-l / .reveal-r scroll-reveal elements
   ========================================================================= */
(function () {
  "use strict";

  function $(sel, root) {
    return (root || document).querySelector(sel);
  }
  function $all(sel, root) {
    return Array.prototype.slice.call((root || document).querySelectorAll(sel));
  }
  function safe(name, fn) {
    try {
      fn();
    } catch (e) {
      /* a broken/edited section must not stop the others */
    }
  }

  /* ------------------------------------------------------------------
     1. Scroll-reveal animations
     Matches the original: IntersectionObserver, threshold 0.12,
     rootMargin "0px 0px -40px 0px", adds .visible once intersecting.
     The HTML is generated WITHOUT .visible; if this script never runs,
     a CSS fallback (html:not(.js) .reveal {...}) keeps content visible.
  ------------------------------------------------------------------ */
  safe("reveal", function () {
    var els = $all(".reveal, .reveal-l, .reveal-r");
    if (!els.length) return;
    if (!("IntersectionObserver" in window)) {
      els.forEach(function (el) {
        el.classList.add("visible");
      });
      return;
    }
    var io = new IntersectionObserver(
      function (entries) {
        entries.forEach(function (en) {
          if (en.isIntersecting) {
            en.target.classList.add("visible");
            io.unobserve(en.target);
          }
        });
      },
      { threshold: 0.12, rootMargin: "0px 0px -40px 0px" },
    );
    els.forEach(function (el) {
      io.observe(el);
    });
  });

  /* ------------------------------------------------------------------
     2. Navbar shadow after scrolling 30px (matches original)
  ------------------------------------------------------------------ */
  safe("nav-shadow", function () {
    var nav = $('[data-cd="nav"]') || $("nav");
    if (!nav) return;
    var update = function () {
      nav.style.boxShadow =
        window.scrollY > 30 ? "0 2px 20px rgba(0,0,0,0.6)" : "none";
    };
    window.addEventListener("scroll", update, { passive: true });
    update();
  });

  /* ------------------------------------------------------------------
     3. Mobile burger menu
     The menu panel is pre-rendered in the HTML (display:none). The
     button toggles it and morphs its three bars into an X via the
     .cd-open class (CSS lives in site.css).
  ------------------------------------------------------------------ */
  safe("burger", function () {
    var btn = $('[data-cd="burger"]');
    var menu = $('[data-cd="mobile-menu"]');
    if (!btn || !menu) return;
    btn.addEventListener("click", function () {
      var open = menu.style.display !== "none";
      menu.style.display = open ? "none" : "";
      btn.classList.toggle("cd-open", !open);
    });
  });

  /* ------------------------------------------------------------------
     4. Hero carousel
     Auto-advances every 5.5s (timer resets on manual navigation, like
     the original). Crossfades slides via inline opacity/z-index and
     swaps the headline/subheadline from each slide's data-title /
     data-sub, re-triggering the fadeUp animation.
  ------------------------------------------------------------------ */
  safe("hero", function () {
    var hero = $('[data-cd="hero"]');
    if (!hero) return;
    var slides = $all('[data-cd="slide"]', hero);
    if (slides.length < 2) return;
    var title = $('[data-cd="hero-title"]', hero);
    var sub = $('[data-cd="hero-sub"]', hero);
    var titleAnim = title ? title.style.animation : "";
    var subAnim = sub ? sub.style.animation : "";
    var current = 0,
      timer = null;

    function replay(el, anim) {
      if (!el) return;
      el.style.animation = "none";
      void el.offsetWidth; /* force reflow so the animation restarts */
      el.style.animation = anim;
    }
    function show(i) {
      current = (i + slides.length) % slides.length;
      slides.forEach(function (sl, k) {
        sl.style.opacity = k === current ? "1" : "0";
        sl.style.zIndex = k === current ? "1" : "0";
        var img = sl.querySelector("img");
        if (img && img.getAttribute("loading") === "lazy")
          img.setAttribute("loading", "eager");
      });
      var sl = slides[current];
      if (title && sl.getAttribute("data-title")) {
        title.textContent = sl.getAttribute("data-title");
        replay(title, titleAnim);
      }
      if (sub && sl.getAttribute("data-sub")) {
        sub.textContent = sl.getAttribute("data-sub");
        replay(sub, subAnim);
      }
      restart();
    }
    function restart() {
      if (timer) clearInterval(timer);
      timer = setInterval(function () {
        show(current + 1);
      }, 5500);
    }
    var prev = $('[data-cd="hero-prev"]', hero);
    var next = $('[data-cd="hero-next"]', hero);
    if (prev)
      prev.addEventListener("click", function () {
        show(current - 1);
      });
    if (next)
      next.addEventListener("click", function () {
        show(current + 1);
      });
    restart();
  });

  /* ------------------------------------------------------------------
     5. Animated stat / progress bar (home about section)
     The HTML ships with the bar at its final width (so it looks right
     without JS). We reset it to 0 and animate to the target when at
     least half the bar is on screen — same as the original.
  ------------------------------------------------------------------ */
  safe("statbar", function () {
    var bars = $all('[data-cd="statbar"]');
    if (!bars.length || !("IntersectionObserver" in window)) return;
    bars.forEach(function (bar) {
      var target = bar.getAttribute("data-target") || bar.style.width;
      if (!target) return;
      bar.style.width = "0%";
      var io = new IntersectionObserver(
        function (entries) {
          entries.forEach(function (en) {
            if (en.isIntersecting) {
              bar.style.width = target;
              io.disconnect();
            }
          });
        },
        { threshold: 0.5 },
      );
      io.observe(bar.parentElement || bar);
    });
  });

  /* ------------------------------------------------------------------
     6. Testimonial switcher
     All testimonials are pre-rendered as [data-cd="t-slide"] blocks
     (only the first visible). Dots toggle visibility + active state.
  ------------------------------------------------------------------ */
  safe("testimonials", function () {
    var slides = $all('[data-cd="t-slide"]');
    var dots = $all('[data-cd="t-dot"]');
    if (!slides.length || !dots.length) return;
    dots.forEach(function (dot, i) {
      dot.addEventListener("click", function () {
        slides.forEach(function (sl, k) {
          sl.style.display = k === i ? "" : "none";
        });
        dots.forEach(function (d, k) {
          d.classList.toggle("active", k === i);
        });
      });
    });
  });

  /* ------------------------------------------------------------------
     7. Price calculator (home page)
     Exact formula from the original site:
       no service selected            -> 250
       otherwise: base + distance*0.8, *1.3 if urgent, rounded
     The property/vehicle "type" toggle is visual only (as original).
     Service base prices are carried on each <option data-base="...">.
  ------------------------------------------------------------------ */
  safe("calculator", function () {
    var calc = $('[data-cd="calc"]');
    if (!calc) return;
    var select = $('[data-cd="calc-service"]', calc);
    var range = $('[data-cd="calc-distance"]', calc);
    var badge = $('[data-cd="calc-distance-value"]', calc);
    var priceEl = $('[data-cd="calc-price"]', calc);
    var urgWrap = $('[data-cd="calc-urgency"]', calc);
    var typeWrap = $('[data-cd="calc-type"]', calc);
    var urgent = false;

    function recompute() {
      if (!priceEl) return;
      var price = 250;
      var opt = select && select.options[select.selectedIndex];
      var base = opt && opt.getAttribute("data-base");
      if (base) {
        price = parseFloat(base) + (range ? +range.value : 10) * 0.8;
        if (urgent) price *= 1.3;
        price = Math.round(price);
      }
      var currency = priceEl.getAttribute("data-currency") || "$";
      priceEl.textContent = currency + " " + price;
      if (badge && range)
        badge.textContent =
          range.value + " " + (badge.getAttribute("data-unit") || "km");
      if (select)
        select.style.color = select.value ? "var(--color-secondary)" : "#999";
    }
    function wireGroup(wrap, onPick) {
      if (!wrap) return;
      $all("button", wrap).forEach(function (btn, i, all) {
        btn.addEventListener("click", function () {
          all.forEach(function (b) {
            b.classList.remove("cd-on");
          });
          btn.classList.add("cd-on");
          onPick(i);
        });
      });
    }
    if (select) select.addEventListener("change", recompute);
    if (range) range.addEventListener("input", recompute);
    wireGroup(urgWrap, function (i) {
      urgent = i === 0;
      recompute();
    });
    wireGroup(typeWrap, function () {
      /* visual only, like the original */
    });
    recompute();
  });

  /* ------------------------------------------------------------------
     8. Footer newsletter form (no backend — same as original demo:
     shows a thank-you message instead of submitting)
  ------------------------------------------------------------------ */
  safe("newsletter", function () {
    $all('form[data-cd="newsletter"]').forEach(function (form) {
      form.addEventListener("submit", function (e) {
        e.preventDefault();
        var input = form.querySelector('input[type="email"]');
        if (!input || !input.value) return;
        var p = document.createElement("p");
        p.style.cssText =
          "font-family:Roboto;font-size:13px;color:#1bd760;font-weight:700";
        p.textContent = "Thanks for subscribing!";
        form.parentNode.replaceChild(p, form);
      });
    });
  });

  /* ------------------------------------------------------------------
     8b. Discount-notify form (pricing page; no backend — mirrors the
     newsletter form: shows a confirmation instead of submitting)
  ------------------------------------------------------------------ */
  safe("discount-notify", function () {
    $all('form[data-cd="discount-notify"]').forEach(function (form) {
      form.addEventListener("submit", function (e) {
        e.preventDefault();
        var input = form.querySelector("input");
        if (!input || !input.value.trim()) return;
        var p = document.createElement("p");
        p.style.cssText =
          "font-family:Roboto;font-size:14px;color:#1bd760;font-weight:700";
        p.textContent = "Thanks! We'll let you know when a discount is on.";
        form.parentNode.replaceChild(p, form);
      });
    });
  });

  /* ------------------------------------------------------------------
     8c. Page loading screen
     A full-screen [data-cd="loader"] overlay (content lives in the HTML)
     is shown until the page finishes loading, then slides up out of view.
     Fails safe: a CSS rule hides it without JS, and a timeout guarantees
     it is removed even if the load event never fires.
  ------------------------------------------------------------------ */
  safe("loader", function () {
    var loader = $('[data-cd="loader"]');
    if (!loader) return;
    var done = false;
    function hide() {
      if (done) return;
      done = true;
      loader.classList.add("cd-hide");
      setTimeout(function () {
        if (loader.parentNode) loader.parentNode.removeChild(loader);
      }, 800);
    }
    if (document.readyState === "complete") {
      setTimeout(hide, 250);
    } else {
      window.addEventListener("load", function () {
        setTimeout(hide, 300);
      });
    }
    setTimeout(hide, 6000); /* failsafe */
  });

  /* ------------------------------------------------------------------
     9. Broken-image fallback (identical to the original inline script):
     a failed image is replaced with a themed picsum placeholder, and if
     that fails too, with a neutral grey box. Also sweeps images that
     already failed before this script loaded.
  ------------------------------------------------------------------ */
  safe("image-fallback", function () {
    function fb(img) {
      if (img.getAttribute("data-fb") === "2") return;
      var w = 600,
        h = 400,
        m = (img.src || "").match(/w=(\d+)&h=(\d+)/);
      if (m) {
        w = m[1];
        h = m[2];
      } else {
        w = img.naturalWidth || img.width || 600;
        h = img.naturalHeight || img.height || 400;
      }
      if (img.getAttribute("data-fb") !== "1") {
        img.setAttribute("data-fb", "1");
        img.src =
          "https://picsum.photos/seed/" +
          encodeURIComponent(((img.alt || "img") + w + h).slice(0, 24)) +
          "/" +
          w +
          "/" +
          h;
      } else {
        img.setAttribute("data-fb", "2");
        img.src =
          "data:image/svg+xml;utf8," +
          encodeURIComponent(
            '<svg xmlns="http://www.w3.org/2000/svg" width="' +
              w +
              '" height="' +
              h +
              '"><rect width="100%" height="100%" fill="#dfe3e8"/></svg>',
          );
      }
    }
    document.addEventListener(
      "error",
      function (e) {
        var t = e.target;
        if (t && t.tagName === "IMG") fb(t);
      },
      true,
    );
    /* images that errored before this script ran */
    $all("img").forEach(function (img) {
      if (img.complete && img.naturalWidth === 0 && img.src) fb(img);
    });
  });

  /* ------------------------------------------------------------------
     10. Visitor analytics (self-contained, structure-agnostic)
     Sends pageview + conversion-click events to the Complete Digital
     collector (n8n webhook on Railway), which stores them
     in the analytics data table. First-party
     localStorage id only — no cookies, nothing consent-triggering.
     Uses document-level event delegation so it keeps working however
     the page markup is edited. Skips headless browsers (screenshot
     pipeline) and ?capture=1 renders.
  ------------------------------------------------------------------ */
  safe("analytics", function () {
    if (navigator.webdriver || /[?&]capture=1/.test(location.search)) return;
    var ENDPOINT =
      "https://n8n-production-d02c.up.railway.app/webhook/analytics-track";
    var siteMeta = document.querySelector('meta[name="cd-site"]');
    var SITE =
      (siteMeta && siteMeta.getAttribute("content")) || location.hostname;

    function uid() {
      return Date.now().toString(36) + Math.random().toString(36).slice(2, 10);
    }
    function get(store, key) {
      try {
        return store.getItem(key);
      } catch (e) {
        return null;
      }
    }
    function set(store, key, val) {
      try {
        store.setItem(key, val);
      } catch (e) {}
      return val;
    }

    var vid = get(window.localStorage, "cd_vid");
    var returning = !!vid;
    if (!vid) vid = set(window.localStorage, "cd_vid", uid());
    var sid =
      get(window.sessionStorage, "cd_sid") ||
      set(window.sessionStorage, "cd_sid", uid());
    var ua = navigator.userAgent;
    var device = /iPad|Tablet|PlayBook|Silk|Android(?!.*Mobi)/i.test(ua)
      ? "tablet"
      : /Mobi|iPhone|Android/i.test(ua)
        ? "mobile"
        : "desktop";

    function baseEvent(type) {
      return {
        ts: new Date().toISOString(),
        site: SITE,
        event: type,
        path: location.pathname,
        visitor_id: vid,
        session_id: sid,
        referrer: document.referrer || "",
        device: device,
        returning: returning,
      };
    }
    function post(events) {
      var body = JSON.stringify(events);
      try {
        if (navigator.sendBeacon && navigator.sendBeacon(ENDPOINT, body))
          return;
      } catch (e) {}
      try {
        fetch(ENDPOINT, {
          method: "POST",
          body: body,
          keepalive: true,
          mode: "no-cors",
        });
      } catch (e) {}
    }

    /* Pageview is sent once, the first time the page is hidden or left,
       so it carries time-on-page. Opening the dialer / mail app also
       fires visibilitychange, so views before a call aren't lost. */
    var t0 = Date.now(),
      pvSent = false;
    function sendPageview() {
      if (pvSent) return;
      pvSent = true;
      var ev = baseEvent("pageview");
      ev.duration_ms = Date.now() - t0;
      post([ev]);
    }
    window.addEventListener("pagehide", sendPageview);
    document.addEventListener("visibilitychange", function () {
      if (document.visibilityState === "hidden") sendPageview();
    });

    /* Conversion clicks: delegation on document survives any DOM edits.
       tel: / mailto: / outbound anchors, beaconed immediately so the
       event isn't lost when the link navigates away. */
    function onClick(e) {
      var t = e.target;
      var a = t && t.closest ? t.closest("a[href]") : null;
      if (!a) return;
      var href = a.getAttribute("href") || "";
      var type = "";
      if (/^tel:/i.test(href)) type = "tel";
      else if (/^mailto:/i.test(href)) type = "mailto";
      else if (
        a.hostname &&
        /^https?:$/i.test(String(a.protocol)) &&
        a.hostname !== location.hostname
      )
        type = "outbound";
      if (!type) return;
      var ev = baseEvent("click");
      ev.link_type = type;
      ev.href = href;
      ev.link_text =
        (a.textContent || "").replace(/\s+/g, " ").trim().slice(0, 120) ||
        (a.getAttribute("aria-label") || "").slice(0, 120);
      post([ev]);
    }
    document.addEventListener("click", onClick, true);
    document.addEventListener("auxclick", onClick, true);
  });
})();
