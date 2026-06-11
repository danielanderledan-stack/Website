# Customer-site visitor analytics

Self-hosted, zero-dependency analytics for every Complete Digital customer
site. The entire database is one file in this directory:

```
analytics/events.ndjson
```

One JSON object per line (NDJSON). Download it, `grep` it, or query it with
`jq` — nothing else to set up.

## How it works

```
visitor's browser                    Vercel (completedigital.org)        GitHub
┌──────────────────────┐  beacon   ┌──────────────────┐   Contents API  ┌──────────────────────┐
│ assets/site.js §10   │ ────────► │ /api/track       │ ──────────────► │ analytics/           │
│ (or snippet.js)      │           │ validate + append│   (commit)      │   events.ndjson      │
└──────────────────────┘           └──────────────────┘                 └──────────────────────┘
```

- **Snippet** (`analytics/snippet.js`, embedded as **section 10 of
  `prerender/template/site.js`** — keep the two in sync): self-contained and
  structure-agnostic. No data-cd hooks, no template assumptions, document-level
  event delegation, `sendBeacon` (with `fetch keepalive` fallback) so clicks on
  navigating links aren't lost. First-party `localStorage` id only — no
  cookies, nothing consent-triggering. It skips headless browsers
  (`navigator.webdriver`, i.e. the screenshot pipeline) and `?capture=1`
  renders.
- **Collector** (`api/track.js` on the Vercel `website` project): whitelists +
  length-caps fields, then appends to `events.ndjson` on branch
  `claude/elegant-maxwell-THblU` via the GitHub Contents API (read → append →
  re-commit, with sha-conflict retries). Needs env var
  `ANALYTICS_GITHUB_TOKEN` (contents:write on this repo) on Vercel.
- **Rollout**: baked into the fuser template only — every NEW site generated
  by `prerender/fuse.cjs` ships with it (the fuser also injects
  `<meta name="cd-site" content="<slug>">` for a stable site id; without the
  meta the snippet falls back to `location.hostname`). Existing sites are NOT
  retrofitted; to add one by hand, see the header comment in `snippet.js`.

## Event schema

Common fields (every line):

| field        | type    | notes                                                           |
| ------------ | ------- | --------------------------------------------------------------- |
| `ts`         | string  | ISO 8601 UTC, client clock                                      |
| `site`       | string  | site id — repo slug from `<meta name="cd-site">`, else hostname |
| `event`      | string  | `pageview` \| `click`                                           |
| `path`       | string  | `location.pathname`, e.g. `/pricing/`                           |
| `visitor_id` | string  | random first-party id, persists in localStorage                 |
| `session_id` | string  | random id per browser session (sessionStorage)                  |
| `referrer`   | string  | `document.referrer`, empty for direct visits                    |
| `device`     | string  | `mobile` \| `tablet` \| `desktop` (user-agent class)            |
| `returning`  | boolean | `false` on the visit that created the visitor id                |

`pageview` only — sent once per page, when the page is first hidden/left:

| field         | type   | notes                                                     |
| ------------- | ------ | --------------------------------------------------------- |
| `duration_ms` | number | time on page (load → first hidden/unload), capped at 24 h |

`click` only — sent immediately on tel: / mailto: / outbound link clicks:

| field       | type   | notes                                                                                        |
| ----------- | ------ | -------------------------------------------------------------------------------------------- |
| `link_type` | string | `tel` \| `mailto` \| `outbound`                                                              |
| `href`      | string | the link target, e.g. `tel:0432839654`                                                       |
| `link_text` | string | visible text (or aria-label), so you can tell the header "Call us" from the pricing-page CTA |

`path` + `link_text` together answer "called from the pricing page" vs
"called from the header".

## Getting the file

```sh
gh api "repos/danielanderledan-stack/Website/contents/analytics/events.ndjson?ref=claude/elegant-maxwell-THblU" \
  -H "Accept: application/vnd.github.raw" > events.ndjson
```

(or just pull the branch — the file is committed like any other.)

## Useful jq one-liners

```sh
# pageviews per site
jq -r 'select(.event=="pageview") | .site' events.ndjson | sort | uniq -c | sort -rn

# conversions (calls + emails) per site
jq -r 'select(.link_type=="tel" or .link_type=="mailto") | .site' events.ndjson | sort | uniq -c | sort -rn

# everything for one site
jq 'select(.site=="safe-roof-restoration")' events.ndjson

# where on the site do calls happen (page + which button)
jq -r 'select(.site=="safe-roof-restoration" and .link_type=="tel") | "\(.path)\t\(.link_text)"' events.ndjson | sort | uniq -c | sort -rn

# unique visitors per site
jq -r '"\(.site)\t\(.visitor_id)"' events.ndjson | sort -u | cut -f1 | uniq -c | sort -rn

# new vs returning pageviews for one site
jq -r 'select(.event=="pageview" and .site=="safe-roof-restoration") | if .returning then "returning" else "new" end' events.ndjson | sort | uniq -c

# average time on page (seconds) per path, one site
jq -rs '[ .[] | select(.event=="pageview" and .site=="safe-roof-restoration") ]
  | group_by(.path)[] | "\(.[0].path)\t\((map(.duration_ms) | add / length / 1000 * 10 | round) / 10)s"' events.ndjson

# traffic sources (external referrers only)
jq -r 'select(.event=="pageview" and .referrer != "") | .referrer' events.ndjson \
  | sed -E 's|https?://([^/]+).*|\1|' | sort | uniq -c | sort -rn

# device split
jq -r 'select(.event=="pageview") | .device' events.ndjson | sort | uniq -c

# daily pageviews, one site
jq -r 'select(.event=="pageview" and .site=="safe-roof-restoration") | .ts[0:10]' events.ndjson | sort | uniq -c
```

## How the file grows

- One line per event, roughly **250–400 bytes**; 10,000 events ≈ 3–4 MB.
- Every beacon batch is **one git commit** on the branch (message
  `analytics: N event(s) from <site>`), so expect a steady trickle of
  commits — that's by design, the commit history doubles as a backup log.
- The collector reads the file inline up to GitHub's 1 MB Contents-API limit
  and automatically switches to the raw media type beyond that (good to
  100 MB), so nothing breaks as it grows.
- When the file gets unwieldy (say >20 MB), **rotate it**: rename it to
  `analytics/events-2026.ndjson` (archive) and the collector will recreate
  `events.ndjson` on the next event. Concatenate archives for all-time
  queries: `cat events-*.ndjson events.ndjson | jq ...`
- Caveats: timestamps come from visitor clocks; `duration_ms` is lost if a
  browser is killed without firing `pagehide`/`visibilitychange`; the
  endpoint is necessarily public, so a hostile actor could insert junk events
  (fields are whitelisted and length-capped, batches capped at 50 — filter by
  known `site` values if it ever matters).
