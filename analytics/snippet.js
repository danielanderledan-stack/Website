/* ============================================================================
   Complete Digital visitor analytics — standalone snippet
   ----------------------------------------------------------------------------
   Self-contained and structure-agnostic: works on ANY customer site
   regardless of markup (no data-cd hooks, no template assumptions).
   Tracks pageviews (with time-on-page), unique visitors (first-party
   localStorage id — no cookies), new vs returning, referrer, device
   class, and — via event delegation on document — every tel: link,
   mailto: link and outbound link click. Events are beaconed to the
   collector (n8n webhook on Railway), which stores them in
   analytics/events.ndjson in the Website repo.

   New sites get this automatically: the same code is embedded as
   section 10 of prerender/template/site.js (keep the two in sync).
   To add it to an existing site by hand, copy this file into the site
   as /assets/analytics.js and add to every page's <head>:
       <script defer src="/assets/analytics.js"></script>
   Optionally pin a stable site id (else the hostname is used):
       <meta name="cd-site" content="my-site-slug">
   ========================================================================= */
(function () {
  "use strict";
  try {
    if (navigator.webdriver || /[?&]capture=1/.test(location.search)) return;
    var ENDPOINT = "https://n8n-production-d02c.up.railway.app/webhook/analytics-track";
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
  } catch (e) {
    /* analytics must never break a customer site */
  }
})();
