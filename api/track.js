// /api/track — visitor-analytics collector for Complete Digital
// customer sites.
//
// POST: receives a JSON array of events (sent via navigator.sendBeacon
// from assets/site.js on each customer site) and appends them — one JSON
// object per line — to analytics/events.ndjson in TWO places:
//   1. this repo (claude/elegant-maxwell-THblU branch) — the master,
//      all-sites file;
//   2. the customer site's own repo (default branch) — a per-site mirror
//      so each customer's dashboard only ever reads its own data.
// The site → repo mapping is resolved from the event's `site` field
// (repo slug from <meta name="cd-site">, or the site's vercel hostname
// with its random deploy suffix stripped). Unresolvable sites still land
// in the master file.
//
// GET ?site=<site-id>: returns that site's mirror NDJSON (CORS *), so a
// dashboard page can fetch fresh data without a GitHub token and without
// waiting for the customer site to redeploy.
//
// See analytics/README.md for the schema and how to query the files.
//
// Required env var: ANALYTICS_GITHUB_TOKEN (or GITHUB_TOKEN) — a token
// with contents:write on the danielanderledan-stack repos.

const OWNER = "danielanderledan-stack";
const CENTRAL_REPO = "Website";
const CENTRAL_BRANCH = "claude/elegant-maxwell-THblU";
const FILE_PATH = "analytics/events.ndjson";
const MAX_EVENTS_PER_BATCH = 50;

// sendBeacon posts are CORS "simple requests" (text/plain) so these are
// only needed for the fetch() fallback and the GET endpoint.
const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
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

function contentsUrl(repo, ref) {
  return (
    "https://api.github.com/repos/" +
    OWNER +
    "/" +
    repo +
    "/contents/" +
    FILE_PATH +
    (ref ? "?ref=" + encodeURIComponent(ref) : "")
  );
}

// Resolve a site id to its GitHub repo. Site ids are either the repo
// slug itself (<meta name="cd-site">) or the site's hostname; vercel
// hostnames carry a random 4-char deploy suffix (premo-caulking-yw8s
// .vercel.app -> repo Premo-Caulking; GitHub lookups are
// case-insensitive). Custom domains can't be derived — those sites only
// get the master file. Cached per warm lambda.
const repoCache = new Map();
export async function resolveSiteRepo(site, token) {
  if (!site) return null;
  if (repoCache.has(site)) return repoCache.get(site);

  let candidates = [];
  if (site.includes(".")) {
    if (site.endsWith(".vercel.app")) {
      const base = site.slice(0, -".vercel.app".length);
      candidates = [base, base.replace(/-[a-z0-9]{4}$/i, "")];
    }
  } else {
    candidates = [site];
  }
  candidates = [...new Set(candidates)].filter(
    (c) => c && c.toLowerCase() !== CENTRAL_REPO.toLowerCase(),
  );

  let repo = null;
  for (const c of candidates) {
    const res = await fetch("https://api.github.com/repos/" + OWNER + "/" + c, {
      headers: ghHeaders(token),
    });
    if (res.ok) {
      repo = (await res.json()).name;
      break;
    }
  }
  repoCache.set(site, repo);
  return repo;
}

// Read a repo's events.ndjson (content + blob sha). The Contents API
// only inlines files up to 1 MB; past that it returns content:"" with
// encoding:"none", so fall back to the raw media type (good to 100 MB).
async function readCurrentFile(token, repo, ref) {
  const res = await fetch(contentsUrl(repo, ref), {
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
    const raw = await fetch(contentsUrl(repo, ref), {
      headers: ghHeaders(token, "application/vnd.github.raw+json"),
    });
    if (!raw.ok) throw new Error("GitHub raw read failed: " + raw.status);
    text = await raw.text();
  }
  return { sha: json.sha, text };
}

// Append-by-rewrite: deserialise the existing NDJSON, add the new lines,
// commit the whole file back. Retries on sha conflicts (409/422) so
// concurrent beacons from different visitors don't drop events.
// branch=null writes to the repo's default branch (per-site mirrors).
export async function appendEvents(events, token, repo, branch) {
  const lines = events.map((ev) => JSON.stringify(ev));
  let lastError = null;
  for (let attempt = 0; attempt < 3; attempt++) {
    const { sha, text } = await readCurrentFile(token, repo, branch);
    const body =
      (text && !text.endsWith("\n") ? text + "\n" : text) +
      lines.join("\n") +
      "\n";
    const put = await fetch(contentsUrl(repo), {
      method: "PUT",
      headers: ghHeaders(token),
      body: JSON.stringify({
        message:
          "analytics: " + lines.length + " event(s) from " + events[0].site,
        content: Buffer.from(body, "utf8").toString("base64"),
        ...(branch ? { branch } : {}),
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

// Per-site mirror read for customer dashboards. Returns NDJSON text.
export async function GET(request) {
  const token = process.env.ANALYTICS_GITHUB_TOKEN || process.env.GITHUB_TOKEN;
  if (!token) return respond(500, { error: "Collector is not configured." });

  const site = new URL(request.url).searchParams.get("site");
  if (!site) return respond(400, { error: "site query param required." });

  let repo;
  try {
    repo = await resolveSiteRepo(str(site, "site"), token);
  } catch (err) {
    console.error("analytics site lookup failed:", err);
    return respond(502, { error: "Lookup failed." });
  }
  if (!repo) return respond(404, { error: "Unknown site." });

  try {
    const { text } = await readCurrentFile(token, repo, null);
    return new Response(text, {
      status: 200,
      headers: {
        "Content-Type": "application/x-ndjson; charset=utf-8",
        "Cache-Control": "no-store",
        ...CORS_HEADERS,
      },
    });
  } catch (err) {
    console.error("analytics mirror read failed:", err);
    return respond(502, { error: "Read failed." });
  }
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

  // Master file first — it must never miss an event.
  try {
    await appendEvents(events, token, CENTRAL_REPO, CENTRAL_BRANCH);
  } catch (err) {
    console.error("analytics append failed:", err);
    return respond(502, { error: "Storage failed." });
  }

  // Per-site mirrors are best-effort: a failure here must not fail the
  // beacon (the events are already safe in the master file).
  const bySite = new Map();
  for (const ev of events) {
    if (!bySite.has(ev.site)) bySite.set(ev.site, []);
    bySite.get(ev.site).push(ev);
  }
  for (const [site, siteEvents] of bySite) {
    try {
      const repo = await resolveSiteRepo(site, token);
      if (repo) await appendEvents(siteEvents, token, repo, null);
    } catch (err) {
      console.error("analytics mirror append failed for " + site + ":", err);
    }
  }

  return respond(204);
}
