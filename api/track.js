// POST /api/track — visitor-analytics collector for Complete Digital
// customer sites.
//
// Receives a JSON array of events (sent via navigator.sendBeacon from
// assets/site.js on each customer site) and appends them — one JSON
// object per line — to analytics/events.ndjson on this repo's
// claude/elegant-maxwell-THblU branch via the GitHub Contents API.
// That NDJSON file is the entire analytics database; see
// analytics/README.md for the schema and how to query it.
//
// Required env var: ANALYTICS_GITHUB_TOKEN (or GITHUB_TOKEN) — a token
// with contents:write on danielanderledan-stack/Website.

const REPO = "danielanderledan-stack/Website";
const BRANCH = "claude/elegant-maxwell-THblU";
const FILE_PATH = "analytics/events.ndjson";
const CONTENTS_URL =
  "https://api.github.com/repos/" + REPO + "/contents/" + FILE_PATH;
const MAX_EVENTS_PER_BATCH = 50;

// sendBeacon posts are CORS "simple requests" (text/plain) so these are
// only needed for the fetch() fallback, but they cost nothing.
const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type",
};

function respond(status, data) {
  return new Response(data ? JSON.stringify(data) : null, {
    status,
    headers: { "Content-Type": "application/json", ...CORS_HEADERS },
  });
}

const STRING_LIMITS = {
  site: 120,
  path: 300,
  visitor_id: 48,
  session_id: 48,
  referrer: 500,
  device: 16,
  href: 500,
  link_text: 160,
  link_type: 16,
};

function str(value, field) {
  if (typeof value !== "string") return "";
  return value.slice(0, STRING_LIMITS[field]);
}

// Whitelist + length-cap every field; anything unrecognised is dropped.
// Returns null for events that aren't worth storing.
function sanitize(raw) {
  if (!raw || typeof raw !== "object") return null;
  if (raw.event !== "pageview" && raw.event !== "click") return null;

  const ts =
    typeof raw.ts === "string" && !isNaN(Date.parse(raw.ts))
      ? new Date(raw.ts).toISOString()
      : new Date().toISOString();

  const ev = {
    ts,
    site: str(raw.site, "site"),
    event: raw.event,
    path: str(raw.path, "path") || "/",
    visitor_id: str(raw.visitor_id, "visitor_id"),
    session_id: str(raw.session_id, "session_id"),
    referrer: str(raw.referrer, "referrer"),
    device: str(raw.device, "device") || "desktop",
    returning: !!raw.returning,
  };
  if (!ev.site || !ev.visitor_id) return null;

  if (raw.event === "pageview") {
    const d = Math.round(Number(raw.duration_ms));
    ev.duration_ms = isFinite(d) ? Math.min(Math.max(d, 0), 86400000) : 0;
  } else {
    ev.href = str(raw.href, "href");
    ev.link_text = str(raw.link_text, "link_text");
    ev.link_type = str(raw.link_type, "link_type");
    if (!ev.href) return null;
  }
  return ev;
}

function ghHeaders(token, accept) {
  return {
    Authorization: "Bearer " + token,
    Accept: accept || "application/vnd.github+json",
    "X-GitHub-Api-Version": "2022-11-28",
    "User-Agent": "cd-analytics-collector",
  };
}

// Read current events.ndjson (content + blob sha). The Contents API only
// inlines files up to 1 MB; past that it returns content:"" with
// encoding:"none", so fall back to the raw media type (good to 100 MB).
async function readCurrentFile(token) {
  const res = await fetch(CONTENTS_URL + "?ref=" + encodeURIComponent(BRANCH), {
    headers: ghHeaders(token),
  });
  if (res.status === 404) return { sha: null, text: "" };
  if (!res.ok) {
    throw new Error(
      "GitHub read failed: " + res.status + " " + (await res.text()),
    );
  }
  const json = await res.json();
  let text = "";
  if (json.encoding === "base64" && typeof json.content === "string") {
    text = Buffer.from(json.content, "base64").toString("utf8");
  } else if (json.size > 0) {
    const raw = await fetch(
      CONTENTS_URL + "?ref=" + encodeURIComponent(BRANCH),
      {
        headers: ghHeaders(token, "application/vnd.github.raw+json"),
      },
    );
    if (!raw.ok) throw new Error("GitHub raw read failed: " + raw.status);
    text = await raw.text();
  }
  return { sha: json.sha, text };
}

// Append-by-rewrite: deserialise the existing NDJSON, add the new lines,
// commit the whole file back. Retries on sha conflicts (409/422) so
// concurrent beacons from different visitors don't drop events.
export async function appendEvents(events, token) {
  const lines = events.map((ev) => JSON.stringify(ev));
  let lastError = null;
  for (let attempt = 0; attempt < 3; attempt++) {
    const { sha, text } = await readCurrentFile(token);
    const body =
      (text && !text.endsWith("\n") ? text + "\n" : text) +
      lines.join("\n") +
      "\n";
    const site = events[0].site;
    const put = await fetch(CONTENTS_URL, {
      method: "PUT",
      headers: ghHeaders(token),
      body: JSON.stringify({
        message: "analytics: " + lines.length + " event(s) from " + site,
        content: Buffer.from(body, "utf8").toString("base64"),
        branch: BRANCH,
        ...(sha ? { sha } : {}),
      }),
    });
    if (put.ok) return;
    lastError = "GitHub write failed: " + put.status + " " + (await put.text());
    // 409/422 = the file moved under us (another batch landed) — refetch sha.
    if (put.status !== 409 && put.status !== 422) break;
  }
  throw new Error(lastError || "GitHub write failed");
}

export function OPTIONS() {
  return new Response(null, { status: 204, headers: CORS_HEADERS });
}

export async function POST(request) {
  const token = process.env.ANALYTICS_GITHUB_TOKEN || process.env.GITHUB_TOKEN;
  if (!token) return respond(500, { error: "Collector is not configured." });

  let parsed;
  try {
    // sendBeacon delivers text/plain, so parse the raw body ourselves.
    parsed = JSON.parse(await request.text());
  } catch {
    return respond(400, { error: "Invalid JSON." });
  }

  const events = (Array.isArray(parsed) ? parsed : [parsed])
    .slice(0, MAX_EVENTS_PER_BATCH)
    .map(sanitize)
    .filter(Boolean);
  if (!events.length) return respond(400, { error: "No valid events." });

  try {
    await appendEvents(events, token);
  } catch (err) {
    console.error("analytics append failed:", err);
    return respond(502, { error: "Storage failed." });
  }
  return respond(204);
}
