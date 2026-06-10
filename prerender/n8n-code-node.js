/* ============================================================================
   n8n CODE NODE WRAPPER — "Fuse Static Site"
   Mode: "Run Once for All Items", Language: JavaScript

   HOW TO USE
   1. Paste the ENTIRE contents of prerender/fuse.cjs into this node,
      REPLACING the marker line below, and DELETE its last line
      (`module.exports = { fuseSite };`).
   2. Adjust the three $('Node Name') references to match your workflow's
      node names.
   3. Requires env var on the n8n instance:  NODE_FUNCTION_ALLOW_EXTERNAL=jsdom
      (and jsdom installed in the n8n container — see N8N-SETUP.md).

   INPUT
     - the item arriving into this node: the customer config JSON
       (same shape the SPA fetches, e.g. 1300-findleak.json), optionally with
       an added "domain" field ("https://www.customerdomain.com.au")
     - three Get-template HTTP Request nodes (Response Format: Text)

   OUTPUT (one item each)
     { type:'file',  path, content }   -> text files to commit
     { type:'image', from, to, rawUrl} -> binaries to download + commit
     { type:'meta',  slug, domain, warnings, routes }
   ========================================================================= */

const TEMPLATE_REPO_RAW = 'https://raw.githubusercontent.com/danielanderledan-stack/Website/claude/elegant-maxwell-THblU/';

/* GitHub file:get nodes (asBinaryProperty=false) return base64 in json.content.
   If you use HTTP Request nodes (Response Format: Text) instead, swap to:
   $('Get Bundle').first().json.data */
const file = (name) => Buffer.from($(name).first().json.content, 'base64').toString('utf8');

/* The fuser is baked into the n8n image as the cd-fuser module (see the
   service's Dockerfile: danielanderledan-stack/n8n-railway-updated). The
   Code node sandbox blocks eval/new Function, so it cannot be loaded from a
   downloaded string. To pick up a newer prerender/fuse.cjs from GitHub,
   redeploy the n8n service on Railway. Requires env var:
   NODE_FUNCTION_ALLOW_EXTERNAL=jsdom,cd-fuser */
const { fuseSite } = require('cd-fuser');

/* Customer config: tolerate the common shapes — the object itself, or a
   stringified copy under a data/json/config field (Set-node variations). */
let config = $('Customer Config').first().json;
if (typeof config === 'string') config = JSON.parse(config);
for (const k of ['data', 'json', 'config']) {
  if (config && typeof config[k] === 'string') { try { config = JSON.parse(config[k]); break; } catch (e) {} }
  else if (config && config[k] && typeof config[k] === 'object' && !config.businessName && !config.siteType) { config = config[k]; break; }
}

const bundleJs = file('Get Bundle');
const cssText = file('Get CSS');
const siteJs = file('Get SiteJS');

const result = await fuseSite({
  config,
  bundleJs,
  cssText,
  siteJs,
  domain: config.domain, // falls back to https://<slug>.vercel.app when absent
});

return [
  ...result.files.map((f) => ({ json: { type: 'file', path: f.path, content: f.content } })),
  ...result.copies.map((c) => ({ json: { type: 'image', from: c.from, to: c.to, rawUrl: TEMPLATE_REPO_RAW + c.from } })),
  { json: { type: 'meta', slug: result.slug, domain: result.domain, warnings: result.warnings, routes: result.routes } },
];
