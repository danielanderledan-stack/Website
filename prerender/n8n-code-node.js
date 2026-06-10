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

/* >>> PASTE prerender/fuse.cjs HERE (without its module.exports line) <<< */

const TEMPLATE_REPO_RAW = 'https://raw.githubusercontent.com/danielanderledan-stack/Website/claude/elegant-maxwell-THblU/';

const config = $('Customer Config').first().json;
/* GitHub file:get nodes (asBinaryProperty=false) return base64 in json.content.
   If you use HTTP Request nodes (Response Format: Text) instead, swap to:
   $('Get Bundle').first().json.data */
const file = (name) => Buffer.from($(name).first().json.content, 'base64').toString('utf8');
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
