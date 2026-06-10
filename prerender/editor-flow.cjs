/* Builds the "customer site editor" chain inside the fuser workflow via the
   n8n MCP update_workflow tool. Run: node prerender/editor-flow.cjs
   Re-runnable for parameter tweaks: node prerender/editor-flow.cjs update
   (update mode only re-applies parameters of existing nodes). */
"use strict";
const fs = require("fs");
const path = require("path");
const { execFileSync } = require("child_process");

const WORKFLOW_ID = "HKIl5u3EycOQkW1t";
const OWNER = "danielanderledan-stack";
const GH_CRED = { id: "5nFNKB7SlRtiwZqO", name: "GitHub account" };
const OR_CRED = { id: "cjg2z7JN1qTLGSKX", name: "OpenRouter account" };
const MODEL = "xiaomi/mimo-v2.5-pro";
const EDIT_TOKEN = "cd-edit-9drx84kq2m";

/* ------------------------------------------------------------------ */
/* Code node sources                                                    */
/* ------------------------------------------------------------------ */

const CODE_VALIDATE = `
// Validates and normalizes the incoming edit-chat request.
const TOKEN = '${EDIT_TOKEN}'; // shared edit secret — rotate here + in the UI link
const body = $input.first().json.body || $input.first().json;

if (!body || body.token !== TOKEN) throw new Error('Invalid edit token');
const site = String(body.site || '');
if (!/^[A-Za-z0-9._-]{1,80}$/.test(site)) throw new Error('Invalid site');
const message = String(body.message || '').slice(0, 6000);
if (!message.trim()) throw new Error('Empty message');

const history = (Array.isArray(body.history) ? body.history : [])
  .slice(-12)
  .map((m) => ({ role: m.role === 'assistant' ? 'assistant' : 'user', content: String(m.content || '').slice(0, 4000) }));

const stamp = Date.now();
const images = (Array.isArray(body.images) ? body.images : []).slice(0, 4).map((img, i) => {
  const name = String(img.name || 'image.jpg').replace(/[^A-Za-z0-9._-]/g, '_').slice(-60);
  const b64 = String(img.b64 || '');
  if (b64.length > 6 * 1024 * 1024) throw new Error('Image too large (max ~4MB)');
  const ext = (name.split('.').pop() || 'jpg').toLowerCase();
  const mime = { jpg: 'image/jpeg', jpeg: 'image/jpeg', png: 'image/png', webp: 'image/webp', gif: 'image/gif', svg: 'image/svg+xml' }[ext] || 'image/jpeg';
  return { name, b64, mime, path: 'assets/uploads/' + stamp + '-' + i + '-' + name };
});

return [{ json: { site, message, history, images, imagePaths: images.map((x) => '/' + x.path) } }];
`.trim();

const CODE_IMAGE_ITEMS = `
// One item per uploaded image, with binary data for the GitHub upload node.
const src = $('Validate Edit Request').first().json;
return src.images.map((img) => ({
  json: { path: img.path, name: img.name },
  binary: { data: { data: img.b64, mimeType: img.mime, fileName: img.name } },
}));
`.trim();

const CODE_PLANNER_PROMPT = `
// Assembles the planner prompt. Edit freely — this is plain text in, JSON out.
const req = $('Validate Edit Request').first().json;

// page list from sitemap.xml (fallback: the standard generated page set)
let pages = ['index.html', 'about/index.html', 'services/index.html', 'pricing/index.html', 'blog/index.html', 'contact/index.html'];
try {
  const sm = Buffer.from($('Get Sitemap').first().json.content, 'base64').toString('utf8');
  const urls = [...sm.matchAll(/<loc>([^<]+)<\\/loc>/g)].map((m) => new URL(m[1]).pathname);
  if (urls.length) pages = urls.map((p) => (p.replace(/^\\/+|\\/+$/g, '') ? p.replace(/^\\/+|\\/+$/g, '') + '/index.html' : 'index.html'));
} catch (e) {}

let guide = '';
try {
  const g = $('Get Editing Guide').first().json;
  if (g && g.content) guide = Buffer.from(g.content, 'base64').toString('utf8');
} catch (e) {}

const editable = [...pages, 'assets/site.css'];

const prompt = [
  'You are the PLANNING agent of a website editing assistant. Customers of a web agency chat with you to change their own small-business website (fully static HTML, no build step).',
  '',
  '== SITE FILES (editable) ==',
  editable.join('\\n'),
  '',
  guide ? '== EDITING GUIDE (how this site is structured) ==\\n' + guide : '',
  '',
  req.imagePaths.length ? '== IMAGES THE CUSTOMER JUST UPLOADED (already live at these absolute paths) ==\\n' + req.imagePaths.join('\\n') : '',
  '',
  '== CONVERSATION SO FAR ==',
  req.history.map((m) => m.role.toUpperCase() + ': ' + m.content).join('\\n') || '(first message)',
  '',
  '== CUSTOMER MESSAGE ==',
  req.message,
  '',
  '== YOUR JOB ==',
  '1. Decide if this needs file edits at all. Pure questions ("what pages do I have?") need none. NOTE: you can see file names and the editing guide but NOT page contents — never promise to "check" or "have a look at" a page, because no follow-up happens unless the customer asks for a change. If you cannot answer, say what you do know and ask them to tell you what they want changed.',
  '2. If edits are needed, pick the file(s) to change — usually ONE page, never more than 4. Page URLs map to files: / -> index.html, /about/ -> about/index.html, etc. Styling/theme changes go in the <html> style attribute of each page (CSS variables) or assets/site.css.',
  '3. Write a concrete implementation plan: which sections (pages contain <!-- SECTION: name --> markers), what text/markup changes, which images to use. Mention constraints the implementer must keep: data-cd attributes, CSS variables for colors, hero captions exist both in <h1 data-cd="hero-title"> and the matching slide data-title, page <head> (title/description/og/JSON-LD) must stay consistent with visible changes.',
  '4. Keep the reply to the customer short, friendly, plain-language (no tech jargon, no file paths). Australian small-business tone.',
  '',
  'Output ONLY a JSON object, no markdown fences:',
  '{"reply": "<what you tell the customer>", "files_to_edit": ["index.html"], "plan": "<detailed notes for the implementer>"}',
].join('\\n');

return [{ json: { prompt, editable } }];
`.trim();

const CODE_PARSE_PLAN = `
// Extracts the planner's JSON and validates the file list.
let raw = String($json.text || '');
const tIdx = raw.lastIndexOf('</think>');
if (tIdx !== -1) raw = raw.slice(tIdx + 8);
const m = raw.match(/\\{[\\s\\S]*\\}/);
if (!m) throw new Error('Planner returned no JSON: ' + raw.slice(0, 300));
let plan;
try { plan = JSON.parse(m[0]); } catch (e) { throw new Error('Planner JSON invalid: ' + m[0].slice(0, 300)); }

const editable = new Set($('Build Planner Prompt').first().json.editable);
const files = (Array.isArray(plan.files_to_edit) ? plan.files_to_edit : [])
  .map(String).filter((p) => editable.has(p)).slice(0, 4);

return [{ json: {
  reply: String(plan.reply || 'Done.'),
  plan: String(plan.plan || ''),
  files,
} }];
`.trim();

const CODE_FILE_ITEMS = `
// One item per file the planner wants to edit.
return $json.files.map((p) => ({ json: { path: p } }));
`.trim();

const CODE_IMPL_PROMPT = `
// Assembles the implementer prompt with full file contents.
const req = $('Validate Edit Request').first().json;
const plan = $('Parse Plan').first().json;
const files = {};
for (const item of $input.all()) {
  files[item.json.path] = Buffer.from(item.json.content, 'base64').toString('utf8');
}

const fileBlocks = Object.entries(files)
  .map(([p, c]) => '== FILE: ' + p + ' ==\\n' + c)
  .join('\\n\\n');

const prompt = [
  'You are the IMPLEMENTATION agent of a website editing assistant. Apply the plan below to the given files by producing exact SEARCH/REPLACE edits.',
  '',
  '== CUSTOMER MESSAGE ==',
  req.message,
  '',
  '== PLAN (from the planning agent) ==',
  plan.plan,
  '',
  req.imagePaths.length ? '== UPLOADED IMAGE PATHS (use exactly these in src attributes) ==\\n' + req.imagePaths.join('\\n') : '',
  '',
  fileBlocks,
  '',
  '== OUTPUT FORMAT (follow EXACTLY) ==',
  'For each edit output a block:',
  '<<<FILE index.html',
  '<<<SEARCH',
  '(exact contiguous lines copied verbatim from that file — must be unique in the file; keep it as short as possible while unique)',
  '===',
  '(the replacement lines)',
  '>>>',
  'Repeat blocks as needed (multiple blocks per file are fine). After all blocks output:',
  '<<<REPLY',
  '(one or two friendly sentences telling the customer what changed — plain language, no file names)',
  '>>>',
  '',
  '== RULES ==',
  '- SEARCH text must match the file byte-for-byte (same indentation, quotes, entities). Copy it, never retype it.',
  '- Never remove or rename data-cd attributes or <!-- SECTION --> comments.',
  '- Colors that should follow the site theme must use var(--color-primary) etc., never hard-coded copies of theme colors.',
  '- Hero heading changes: update BOTH the <h1 data-cd="hero-title"> text AND the matching data-title attribute on the first [data-cd="slide"].',
  '- If visible business info changes (name, suburb, services), also update the page <title>, meta description and og: tags in the same page.',
  '- Use uploaded image paths verbatim; give every <img> a meaningful alt text. Use loading="lazy" except above-the-fold.',
  '- Keep HTML valid; keep the existing inline-style coding style of the file.',
].join('\\n');

return [{ json: { prompt, files } }];
`.trim();

const CODE_APPLY_EDITS = `
// Parses SEARCH/REPLACE blocks and applies them to the fetched files.
let out = String($json.text || '');
const tIdx2 = out.lastIndexOf('</think>');
if (tIdx2 !== -1) out = out.slice(tIdx2 + 8);
const src = $('Build Implementer Prompt').first().json;
const files = { ...src.files };

const blockRe = /<<<FILE ([^\\n]+)\\n<<<SEARCH\\n([\\s\\S]*?)\\n===\\n([\\s\\S]*?)\\n>>>/g;
const replyRe = /<<<REPLY\\n([\\s\\S]*?)\\n?>>>/;

const applied = [];
const failed = [];
let m;
while ((m = blockRe.exec(out)) !== null) {
  const file = m[1].trim();
  const search = m[2];
  const replace = m[3];
  if (!(file in files)) { failed.push(file + ': not in fetched files'); continue; }
  if (files[file].includes(search)) {
    files[file] = files[file].replace(search, replace);
    applied.push(file);
    continue;
  }
  // fallback: tolerate trailing-whitespace / CRLF drift per line
  const norm = (s) => s.replace(/\\r/g, '').split('\\n').map((l) => l.replace(/\\s+$/, '')).join('\\n');
  const normFile = norm(files[file]);
  const normSearch = norm(search);
  const idx = normFile.indexOf(normSearch);
  if (idx !== -1) {
    // map back via line counts
    const pre = normFile.slice(0, idx).split('\\n').length - 1;
    const lines = files[file].split('\\n');
    const span = normSearch.split('\\n').length;
    lines.splice(pre, span, ...replace.split('\\n'));
    files[file] = lines.join('\\n');
    applied.push(file);
  } else {
    failed.push(file + ': SEARCH text not found');
  }
}

const replyM = out.match(replyRe);
const reply = replyM ? replyM[1].trim() : $('Parse Plan').first().json.reply;

const changed = [...new Set(applied)];
if (!changed.length) {
  // nothing applied — surface a useful error to the customer
  return [{ json: { noChanges: true, reply: 'Sorry — I could not apply that change automatically. Could you describe it a little differently?', failures: failed } }];
}
return changed.map((p) => ({ json: { path: p, content: files[p], reply, failures: failed } }));
`.trim();

const CODE_BUILD_REPLY = `
// Final response payload for the chat UI (handles both edit and no-edit paths).
const items = $input.all();
const first = items[0] ? items[0].json : {};
let reply = first.reply || 'Done.';
try { reply = $('Apply Edits').first().json.reply || reply; } catch (e) {}
let changed = [];
try { changed = $('Apply Edits').all().filter((i) => i.json.path).map((i) => i.json.path); } catch (e) {}
changed = [...new Set(changed)];
const site = $('Validate Edit Request').first().json.site;
return [{ json: {
  reply,
  changed,
  changedUrls: changed.map((p) => '/' + p.replace(/index\\.html$/, '').replace(/\\.html$/, '')),
  site,
  failures: first.failures || [],
} }];
`.trim();

/* ------------------------------------------------------------------ */
/* Nodes                                                                */
/* ------------------------------------------------------------------ */

const X0 = 1000,
  Y0 = 600,
  DX = 200;
let xi = 0;
const pos = (row = 0) => [X0 + xi++ * DX, Y0 + row * 170];

const nodes = [
  {
    name: "Edit Webhook",
    type: "n8n-nodes-base.webhook",
    typeVersion: 2,
    position: pos(),
    parameters: {
      httpMethod: "POST",
      path: "site-editor",
      responseMode: "responseNode",
      options: { allowedOrigins: "*" },
    },
  },
  {
    name: "Validate Edit Request",
    type: "n8n-nodes-base.code",
    typeVersion: 2,
    position: pos(),
    parameters: { mode: "runOnceForAllItems", jsCode: CODE_VALIDATE },
  },
  {
    name: "Has Images",
    type: "n8n-nodes-base.if",
    typeVersion: 2.2,
    position: pos(),
    parameters: {
      conditions: {
        options: {
          caseSensitive: true,
          leftValue: "",
          typeValidation: "loose",
          version: 2,
        },
        conditions: [
          {
            id: "h1",
            leftValue: "={{ $json.images.length }}",
            rightValue: 0,
            operator: { type: "number", operation: "gt" },
          },
        ],
        combinator: "and",
      },
      options: {},
    },
  },
  {
    name: "Image Items",
    type: "n8n-nodes-base.code",
    typeVersion: 2,
    position: pos(1),
    parameters: { mode: "runOnceForAllItems", jsCode: CODE_IMAGE_ITEMS },
  },
  {
    name: "Upload Edit Image",
    type: "n8n-nodes-base.github",
    typeVersion: 1.1,
    position: pos(1),
    credentials: { githubApi: GH_CRED },
    parameters: {
      resource: "file",
      operation: "create",
      owner: { __rl: true, value: OWNER, mode: "name" },
      repository: {
        __rl: true,
        value: "={{ $('Validate Edit Request').first().json.site }}",
        mode: "name",
      },
      filePath: "={{ $json.path }}",
      binaryData: true,
      binaryPropertyName: "data",
      commitMessage: "customer image upload",
    },
  },
  {
    name: "Merge Edit Paths",
    type: "n8n-nodes-base.merge",
    typeVersion: 3,
    position: pos(),
    parameters: {},
  },
  {
    name: "Get Sitemap",
    type: "n8n-nodes-base.github",
    typeVersion: 1.1,
    position: pos(),
    credentials: { githubApi: GH_CRED },
    onError: "continueRegularOutput",
    executeOnce: true,
    parameters: {
      resource: "file",
      operation: "get",
      owner: { __rl: true, value: OWNER, mode: "name" },
      repository: {
        __rl: true,
        value: "={{ $('Validate Edit Request').first().json.site }}",
        mode: "name",
      },
      filePath: "sitemap.xml",
      asBinaryProperty: false,
      additionalParameters: {},
    },
  },
  {
    name: "Get Editing Guide",
    type: "n8n-nodes-base.github",
    typeVersion: 1.1,
    position: pos(),
    credentials: { githubApi: GH_CRED },
    onError: "continueRegularOutput",
    parameters: {
      resource: "file",
      operation: "get",
      owner: { __rl: true, value: OWNER, mode: "name" },
      repository: {
        __rl: true,
        value: "={{ $('Validate Edit Request').first().json.site }}",
        mode: "name",
      },
      filePath: "EDITING.md",
      asBinaryProperty: false,
      additionalParameters: {},
    },
  },
  {
    name: "Build Planner Prompt",
    type: "n8n-nodes-base.code",
    typeVersion: 2,
    position: pos(),
    parameters: {
      mode: "runOnceForAllItems",
      jsCode: CODE_PLANNER_PROMPT,
    },
  },
  {
    name: "Plan Edit",
    type: "@n8n/n8n-nodes-langchain.chainLlm",
    typeVersion: 1.9,
    position: pos(),
    parameters: {
      promptType: "define",
      text: "={{ $json.prompt }}",
      batching: {},
    },
  },
  {
    name: "Planner Model",
    type: "@n8n/n8n-nodes-langchain.lmChatOpenRouter",
    typeVersion: 1,
    position: [X0 + 9 * DX, Y0 + 320],
    credentials: { openRouterApi: OR_CRED },
    parameters: { model: MODEL, options: {} },
  },
  {
    name: "Parse Plan",
    type: "n8n-nodes-base.code",
    typeVersion: 2,
    position: pos(),
    parameters: { mode: "runOnceForAllItems", jsCode: CODE_PARSE_PLAN },
  },
  {
    name: "Needs Edits",
    type: "n8n-nodes-base.if",
    typeVersion: 2.2,
    position: pos(),
    parameters: {
      conditions: {
        options: {
          caseSensitive: true,
          leftValue: "",
          typeValidation: "loose",
          version: 2,
        },
        conditions: [
          {
            id: "n1",
            leftValue: "={{ $json.files.length }}",
            rightValue: 0,
            operator: { type: "number", operation: "gt" },
          },
        ],
        combinator: "and",
      },
      options: {},
    },
  },
  {
    name: "File Items",
    type: "n8n-nodes-base.code",
    typeVersion: 2,
    position: pos(),
    parameters: { mode: "runOnceForAllItems", jsCode: CODE_FILE_ITEMS },
  },
  {
    name: "Fetch Page",
    type: "n8n-nodes-base.github",
    typeVersion: 1.1,
    position: pos(),
    credentials: { githubApi: GH_CRED },
    parameters: {
      resource: "file",
      operation: "get",
      owner: { __rl: true, value: OWNER, mode: "name" },
      repository: {
        __rl: true,
        value: "={{ $('Validate Edit Request').first().json.site }}",
        mode: "name",
      },
      filePath: "={{ $json.path }}",
      asBinaryProperty: false,
      additionalParameters: {},
    },
  },
  {
    name: "Build Implementer Prompt",
    type: "n8n-nodes-base.code",
    typeVersion: 2,
    position: pos(),
    parameters: { mode: "runOnceForAllItems", jsCode: CODE_IMPL_PROMPT },
  },
  {
    name: "Implement Edit",
    type: "@n8n/n8n-nodes-langchain.chainLlm",
    typeVersion: 1.9,
    position: pos(),
    parameters: {
      promptType: "define",
      text: "={{ $json.prompt }}",
      batching: {},
    },
  },
  {
    name: "Implementer Model",
    type: "@n8n/n8n-nodes-langchain.lmChatOpenRouter",
    typeVersion: 1,
    position: [X0 + 16 * DX, Y0 + 320],
    credentials: { openRouterApi: OR_CRED },
    parameters: { model: MODEL, options: {} },
  },
  {
    name: "Apply Edits",
    type: "n8n-nodes-base.code",
    typeVersion: 2,
    position: pos(),
    parameters: { mode: "runOnceForAllItems", jsCode: CODE_APPLY_EDITS },
  },
  {
    name: "Commit Edit",
    type: "n8n-nodes-base.github",
    typeVersion: 1.1,
    position: pos(),
    credentials: { githubApi: GH_CRED },
    parameters: {
      resource: "file",
      operation: "edit",
      owner: { __rl: true, value: OWNER, mode: "name" },
      repository: {
        __rl: true,
        value: "={{ $('Validate Edit Request').first().json.site }}",
        mode: "name",
      },
      filePath: "={{ $json.path }}",
      fileContent: "={{ $json.content }}",
      commitMessage:
        "={{ 'site edit: ' + $('Validate Edit Request').first().json.message.slice(0, 60) }}",
    },
  },
  {
    name: "Build Edit Reply",
    type: "n8n-nodes-base.code",
    typeVersion: 2,
    position: pos(),
    parameters: { mode: "runOnceForAllItems", jsCode: CODE_BUILD_REPLY },
    executeOnce: true,
  },
  {
    name: "Respond Edit",
    type: "n8n-nodes-base.respondToWebhook",
    typeVersion: 1.1,
    position: pos(),
    parameters: { respondWith: "firstIncomingItem", options: {} },
  },
];

const connections = [
  ["Edit Webhook", "Validate Edit Request"],
  ["Validate Edit Request", "Has Images"],
  // IF true (output 0) -> images; IF false (output 1) -> merge input 1
  { source: "Has Images", target: "Image Items", sourceIndex: 0 },
  {
    source: "Has Images",
    target: "Merge Edit Paths",
    sourceIndex: 1,
    targetIndex: 1,
  },
  ["Image Items", "Upload Edit Image"],
  { source: "Upload Edit Image", target: "Merge Edit Paths", targetIndex: 0 },
  ["Merge Edit Paths", "Get Sitemap"],
  ["Get Sitemap", "Get Editing Guide"],
  ["Get Editing Guide", "Build Planner Prompt"],
  ["Build Planner Prompt", "Plan Edit"],
  ["Plan Edit", "Parse Plan"],
  ["Parse Plan", "Needs Edits"],
  { source: "Needs Edits", target: "File Items", sourceIndex: 0 },
  { source: "Needs Edits", target: "Build Edit Reply", sourceIndex: 1 },
  ["File Items", "Fetch Page"],
  ["Fetch Page", "Build Implementer Prompt"],
  ["Build Implementer Prompt", "Implement Edit"],
  ["Implement Edit", "Apply Edits"],
  ["Apply Edits", "Commit Edit"],
  ["Commit Edit", "Build Edit Reply"],
  ["Build Edit Reply", "Respond Edit"],
  {
    source: "Planner Model",
    target: "Plan Edit",
    connectionType: "ai_languageModel",
  },
  {
    source: "Implementer Model",
    target: "Implement Edit",
    connectionType: "ai_languageModel",
  },
];

/* ------------------------------------------------------------------ */

const updateOnly = process.argv[2] === "update";
const ops = [];
for (const n of nodes) {
  if (updateOnly) {
    ops.push({
      type: "updateNodeParameters",
      nodeName: n.name,
      parameters: n.parameters,
      replace: true,
    });
  } else {
    ops.push({ type: "addNode", node: n });
  }
}
if (!updateOnly) {
  for (const c of connections) {
    if (Array.isArray(c))
      ops.push({ type: "addConnection", source: c[0], target: c[1] });
    else ops.push({ type: "addConnection", ...c });
  }
}

const payload = { workflowId: WORKFLOW_ID, operations: ops };
fs.writeFileSync(
  path.join(__dirname, "editor-ops.json"),
  JSON.stringify(payload),
);
console.log("ops:", ops.length, "— applying...");
const out = execFileSync(
  process.execPath,
  [
    path.join(__dirname, "n8n-mcp.cjs"),
    "update_workflow",
    "@" + path.join(__dirname, "editor-ops.json"),
  ],
  { encoding: "utf8" },
);
console.log(out.slice(0, 600));
