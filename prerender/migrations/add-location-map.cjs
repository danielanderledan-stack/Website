/* ============================================================================
   Migration: add-location-map
   Injects the #cd-map "Find Us" section (OpenStreetMap embed) onto the home and
   services pages, exactly where fuse places it — home: right after #prices;
   services: before #contact. Idempotent (skips if a map already exists).

   Coordinates are supplied per-site by the runner (siteCtx.coordinates). The
   business name / suburb / address are read from the page's own JSON-LD so the
   section matches the customer's current details. The HTML mirrors fuse.cjs
   buildMapSection / mapCoords byte-for-byte; the heading/sub/CTA are tagged with
   map-scoped data-ce ids (cdmap-*) so they stay editable without colliding with
   the retrofit's s{n}-* ids.
   ============================================================================ */
"use strict";

function escHtml(s) {
  return String(s == null ? "" : s)
    .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

function mapCoords(cfg) {
  const c = cfg && cfg.coordinates;
  if (!c || typeof c !== "object") return null;
  const lat = parseFloat(c.latitude != null ? c.latitude : c.lat);
  const lon = parseFloat(c.longitude != null ? c.longitude : c.lng != null ? c.lng : c.lon);
  if (isNaN(lat) || isNaN(lon)) return null;
  if (lat < -90 || lat > 90 || lon < -180 || lon > 180) return null;
  return { lat, lon };
}

function buildMapSection(cfg) {
  const co = mapCoords(cfg);
  if (!co) return "";
  const { lat, lon } = co;
  const dLat = 0.0085, dLon = 0.014;
  const bbox = [lon - dLon, lat - dLat, lon + dLon, lat + dLat].join(",");
  const marker = lat + "," + lon;
  const biz = cfg.businessName || cfg.logoPrefix || "us";
  const heading = cfg.suburb ? "Visit Us in " + cfg.suburb : "Where to Find Us";
  const sub = cfg.address ? cfg.address : cfg.suburb ? "Servicing " + cfg.suburb + " and all surrounding suburbs." : "";
  const embed = "https://www.openstreetmap.org/export/embed.html?bbox=" + encodeURIComponent(bbox) + "&layer=mapnik&marker=" + encodeURIComponent(marker);
  const directions = "https://www.google.com/maps/search/?api=1&query=" + encodeURIComponent(marker);
  return (
    '<section id="cd-map" data-cd="map" style="padding: 64px 30px; background: rgb(250, 250, 250);">' +
    '<div class="mx-auto" style="max-width: 1000px;">' +
    '<div class="text-center" style="margin-bottom: 32px;">' +
    '<div class="section-label" style="color: var(--color-primary);">Find Us</div>' +
    '<h2 class="section-h2" style="font-size: clamp(24px, 3vw, 38px); margin-bottom: 8px;">' + escHtml(heading) + "</h2>" +
    (sub ? '<p style="font-family: Roboto, sans-serif; font-size: 15px; color: rgb(119, 119, 119); max-width: 580px; margin: 0px auto; line-height: 1.6;">' + escHtml(sub) + "</p>" : "") +
    "</div>" +
    '<div style="position: relative; border-radius: 18px; overflow: hidden; box-shadow: 0 18px 50px rgba(0,0,0,0.16); border: 1px solid rgba(0,0,0,0.06);">' +
    '<div style="position: absolute; top: 0px; left: 0px; right: 0px; height: 4px; background: var(--color-primary); z-index: 2;"></div>' +
    '<iframe title="Map showing ' + escHtml(biz) + '" loading="lazy" referrerpolicy="no-referrer-when-downgrade" src="' + escHtml(embed) + '" style="width: 100%; height: 420px; border: 0px; display: block;"></iframe>' +
    '<a href="' + escHtml(directions) + '" target="_blank" rel="noopener" class="btn-yellow" style="position: absolute; right: 16px; bottom: 16px; z-index: 2; font-size: 13px; padding: 12px 22px; box-shadow: 0 8px 24px rgba(0,0,0,0.28);">Get Directions</a>' +
    "</div></div></section>"
  );
}

// read business name / suburb / address from the page's JSON-LD (canonical)
function pageContext(doc) {
  const out = {};
  const el = doc.querySelector('script[type="application/ld+json"]');
  if (el) {
    try {
      let d = JSON.parse(el.textContent.trim());
      if (Array.isArray(d)) d = d[0];
      if (d && d["@graph"]) d = d["@graph"].find((n) => n && (n.address || n.name)) || d["@graph"][0];
      if (d) {
        const addr = d.address || {};
        out.businessName = d.name || "";
        out.address = addr.streetAddress || "";
        out.suburb = addr.addressLocality || "";
      }
    } catch (e) {}
  }
  return out;
}

// make the inserted section's text editable without colliding with s{n}-* ids
function tagMap(sec) {
  const set = (el, id, cap, label) => {
    if (!el || el.hasAttribute("data-ce")) return;
    el.setAttribute("data-ce", id);
    el.setAttribute("data-ce-cap", cap);
    el.setAttribute("data-ce-label", label);
  };
  set(sec.querySelector("h2"), "cdmap-heading", "rich", "Heading");
  set(sec.querySelector("p"), "cdmap-sub", "rich", "Text");
  set(sec.querySelector("a.btn-yellow"), "cdmap-directions", "rich", "Button");
}

const targets = [
  { route: "home", file: "index.html" },
  { route: "services", file: "services/index.html" },
];

function apply(doc, route, siteCtx) {
  if (doc.querySelector("#cd-map") || doc.querySelector('[data-cd="map"]')) return 0; // idempotent
  const cfg = Object.assign({}, pageContext(doc), { coordinates: siteCtx && siteCtx.coordinates });
  if (!mapCoords(cfg)) return 0;
  const holder = doc.createElement("div");
  holder.innerHTML = buildMapSection(cfg);
  const mapSec = holder.firstChild;
  if (!mapSec) return 0;
  let inserted = false;
  if (route === "home") {
    const anchor = doc.getElementById("prices");
    if (anchor && anchor.parentNode) { anchor.parentNode.insertBefore(mapSec, anchor.nextSibling); inserted = true; }
  } else if (route === "services") {
    const main = doc.querySelector("#root main") || doc.querySelector("main");
    if (main) { main.insertBefore(mapSec, doc.getElementById("contact") || null); inserted = true; }
  }
  if (!inserted) return 0;
  tagMap(mapSec);
  return 1;
}

module.exports = { id: "add-location-map", label: "Location map (Find Us) section", addedSelector: "#cd-map", targets, apply };
