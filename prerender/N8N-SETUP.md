# n8n setup — static site fuser

Turns a customer config JSON into a complete pre-rendered static website
(committed to GitHub, served by Vercel). No React at runtime, all content,
SEO and theming baked in, interactivity via one standard `site.js`.

---

## 1. One-time: prepare the n8n instance (Railway) — DONE 2026-06-10

The Code node runs the real React bundle inside **jsdom**, and loads the
fuser as the **cd-fuser** module (the Code node sandbox blocks eval, so the
fuser must be a real installed module, not a downloaded string).

**Railway environment variables** (n8n service → Variables):

```
NODE_FUNCTION_ALLOW_EXTERNAL=jsdom,cd-fuser
```

**The n8n service deploys from `danielanderledan-stack/n8n-railway-updated`**,
whose Dockerfile installs both:

```dockerfile
FROM n8nio/n8n:latest
USER root
# global install: the n8n package dir uses pnpm catalog: refs npm can't touch
RUN npm install -g jsdom@26 --omit=dev --no-audit --no-fund
# the fuser (prerender/fuse.cjs) baked in as a requireable module
ADD https://raw.githubusercontent.com/danielanderledan-stack/Website/claude/elegant-maxwell-THblU/prerender/fuse.cjs /usr/local/lib/node_modules/cd-fuser/index.js
RUN printf '{"name":"cd-fuser","version":"1.0.0","main":"index.js"}' > /usr/local/lib/node_modules/cd-fuser/package.json && chmod -R a+r /usr/local/lib/node_modules/cd-fuser
```

**To ship a fuser update:** push the new `prerender/fuse.cjs` to the Website
repo's default branch, then redeploy the n8n service on Railway (the ADD
fetches the latest copy at build time).

## 2. One-time: template files in GitHub

The fuser needs 3 template files, downloaded fresh on every run so sites are
always built from the current template. Stable-named copies live in this repo:

| file | purpose |
|---|---|
| `prerender/template/bundle.js` | the React bundle (copy of `sites/assets/index-*.js`) |
| `prerender/template/template.css` | the template CSS (copy of `sites/assets/index-*.css`) |
| `prerender/template/site.js` | standard vanilla interactivity (master copy: `prerender/site.js`) |

**Whenever you deploy a new demo bundle** (the hashed files in `sites/assets/`
change), refresh the copies:

```
copy sites\assets\index-<newhash>.js  prerender\template\bundle.js
copy sites\assets\index-<newhash>.css prerender\template\template.css
```

commit, and every site generated afterwards uses the new template.

## 3. The workflow

```
[customer config arrives]          (your existing purchase flow)
        │
        ├─ HTTP Request "Get Bundle"   GET raw.githubusercontent.com/.../prerender/template/bundle.js     (Response Format: Text)
        ├─ HTTP Request "Get CSS"      GET .../prerender/template/template.css                            (Response Format: Text)
        ├─ HTTP Request "Get SiteJS"   GET .../prerender/template/site.js                                 (Response Format: Text)
        │
        ▼
[Code node "Fuse Static Site"]     (paste prerender/n8n-code-node.js + fuse.cjs as described inside it)
        │
        ├─ items type=file  ──► GitHub node "Create or Update File"
        │                        repo: the customer's site repo
        │                        path: {{$json.path}}   content: {{$json.content}}
        │
        ├─ items type=image ──► HTTP Request (GET {{$json.rawUrl}}, Response: File)
        │                        └► GitHub "Create or Update File"
        │                            path: {{$json.to}}  (binary upload)
        │
        └─ item  type=meta  ──► (optional) notification / logging; check `warnings`
```

Filter items by `{{$json.type}}` with an IF or Switch node.

### Code node input format

The item flowing into the Code node is the customer config itself — the same
JSON shape the demo SPA uses (`sites/configs/<slug>.json`). Two optional extra
fields:

```json
{
  "domain": "https://www.customerdomain.com.au",   ← used for canonical/OG/sitemap URLs
  "slug":   "custom-slug",                          ← otherwise derived from business name + suburb
  ...rest of the normal config...
}
```

Always pass `domain` when the customer has a real domain — otherwise
canonicals point at `https://<slug>.vercel.app`.

## 4. What gets committed (per customer repo)

```
index.html                ← home
about/index.html          services/index.html
pricing/index.html        contact/index.html
blog/index.html           blog/1/index.html ... blog/4/index.html
assets/site.css           assets/site.js
assets/images/...         ← local template images (from the copy manifest)
favicon.svg  robots.txt  sitemap.xml  vercel.json  EDITING.md
```

Commit everything at the repo root. **Vercel project settings:** Framework
Preset = "Other", Build Command = empty, Output Directory = `.` — the included
`vercel.json` handles clean URLs. Connect the repo, every push deploys.

`EDITING.md` (generated into each site) documents the structure, the
`data-cd` interactivity hooks and the CSS-variable theming for whoever
(human or AI) edits the site later.

## 5. Verifying a build locally (optional, this repo)

```
node prerender/test-build.cjs sites/configs/<slug>.json https://www.domain.com.au
node prerender/verify.cjs              # compares against the live demo
node prerender/test-interactions.cjs   # exercises every interactive behavior
node prerender/test-edits.cjs          # edit-resilience checks
```

## 6. Known behaviors / decisions

- **Demo-only overlays excluded.** The FYI popup, sales burger and tracking
  webhook from the demo shell are not included in customer sites on purpose.
- **Missing trade images**: configs whose trade has no local image set yet
  reference files that don't exist; the standard image-fallback (in site.js,
  same as the demo) swaps them to picsum placeholders at runtime — identical
  to current demo behavior. The meta item's `warnings` array also surfaces
  anything the fuser couldn't capture.
- **External images** (Unsplash, randomuser avatars) stay external by design;
  only `/sites/images/...` template images are localized into `assets/images/`.
- **Hero CTA button** does nothing — same as the demo (it has no handler there
  either).
