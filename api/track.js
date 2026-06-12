// /api/track — analytics passthrough for Complete Digital customer sites.
//
// Storage moved to n8n (Railway data table "analytics") on 2026-06-12 —
// events are no longer committed to GitHub. The old per-event commits
// were burning Vercel's daily Git-deployment quota on every repo and
// polluting site histories.
//
// POST: forwards the beacon body untouched to the n8n collector webhook
//       (which sanitizes events and stores one table row per event).
// GET ?site=<site-id>: proxies the n8n reader and returns NDJSON (CORS *),
//       the same wire format this endpoint always served, so dashboard
//       copies that still point here keep working.
//
// Newly generated sites beacon straight to the n8n webhook (assets/site.js
// section 10); this endpoint stays for sites deployed before the switch.
// See the n8n "ANALYTICS" workflow for the collector/reader logic.

const TRACK_URL =
  "https://n8n-production-d02c.up.railway.app/webhook/analytics-track";
const DATA_URL =
  "https://n8n-production-d02c.up.railway.app/webhook/analytics-data";

const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type",
};

export function OPTIONS() {
  return new Response(null, { status: 204, headers: CORS_HEADERS });
}

export async function GET(request) {
  const site = new URL(request.url).searchParams.get("site");
  if (!site) {
    return new Response(
      JSON.stringify({ error: "site query param required." }),
      {
        status: 400,
        headers: { "Content-Type": "application/json", ...CORS_HEADERS },
      },
    );
  }
  try {
    const res = await fetch(DATA_URL + "?site=" + encodeURIComponent(site));
    const text = await res.text();
    return new Response(res.ok ? text : "", {
      status: res.ok ? 200 : 502,
      headers: {
        "Content-Type": "application/x-ndjson; charset=utf-8",
        "Cache-Control": "no-store",
        ...CORS_HEADERS,
      },
    });
  } catch (err) {
    console.error("analytics proxy read failed:", err);
    return new Response(null, { status: 502, headers: CORS_HEADERS });
  }
}

export async function POST(request) {
  try {
    const body = await request.text();
    const res = await fetch(TRACK_URL, {
      method: "POST",
      headers: { "Content-Type": "text/plain" },
      body,
    });
    return new Response(null, {
      status: res.ok ? 204 : 502,
      headers: CORS_HEADERS,
    });
  } catch (err) {
    console.error("analytics proxy forward failed:", err);
    return new Response(null, { status: 502, headers: CORS_HEADERS });
  }
}
