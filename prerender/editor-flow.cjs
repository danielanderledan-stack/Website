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
let route = { intent: 'text_edit' };
try { route = $('Parse Route').first().json; } catch (e) {}

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

const isPreset = route.intent === 'preset';
const editable = [...pages, 'assets/site.css', ...(isPreset ? ['sitemap.xml'] : [])];

const INTENT_RULES = {
  text_edit: 'This is a TEXT change (wording, headings, prices, contact details, typo fixes). Change text and attribute values only — no structural/markup redesign. Keep edits tight.',
  image_edit: 'This is an IMAGE change (add/swap/remove an image). Use ONLY the uploaded image paths listed above or images already on the site — never invent a path. "Header image" / "main image" means the home page hero slide image.',
  content_edit: 'This is a CONTENT improvement, limited to ONE section of ONE page. Pick the single most relevant section. If the request actually spans multiple sections or pages, do NOT edit: set files_to_edit to [] and reply that bigger reworks are best done by Dan personally on 0432 839 654 (no charge for asking).',
  preset: [
    'This is a CURATED PRESET job — follow the preset instructions in the message exactly. Preset notes:',
    '- [PRESET: quote-only]: remove/hide all specific dollar amounts across pages (pricing cards, price lists, calculator) and re-word pricing CTAs to "Get a free quote". You may edit up to 8 files.',
    '- [PRESET: colours]: change the four CSS variables (--color-primary, --color-primary-rgb, --color-primary-hover, --color-secondary) in the <html> style attribute of EVERY page. primary-rgb is the primary hex as "r, g, b"; primary-hover is primary darkened ~12%. Edit every page file.',
    '- [PRESET: offer]: add or update a special-offer line on the home page (hero subheading or banner section) with the offer text given. One page only.',
    '- [PRESET: blog]: write a NEW blog post. files_to_edit MUST be ["blog/index.html", "blog/1/index.html"] (the listing + a reference post). Plan: create blog/<next-number>/index.html cloned from the reference post structure (same head/nav/footer/sections, new title/date/body), add a matching card to the blog listing, and add the new URL to sitemap.xml (also include "sitemap.xml" in files_to_edit). Use todays date.',
  ].join('\\n'),
};

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
  '== REQUEST TYPE (pre-classified) ==',
  route.intent,
  INTENT_RULES[route.intent] || INTENT_RULES.text_edit,
  '',
  '== YOUR JOB ==',
  '1. Plan the edit. Pick the file(s) to change — usually ONE page' + (isPreset ? ' (presets may span more, see notes)' : ', never more than 4') + '. Page URLs map to files: / -> index.html, /about/ -> about/index.html.',
  '2. Write a concrete implementation plan: which sections (pages contain <!-- SECTION: name --> markers), exact text/markup changes, which images to use. Constraints the implementer must keep: data-cd attributes, CSS variables for theme colors, hero captions exist both in <h1 data-cd="hero-title"> AND the matching slide data-title, page <head> (title/description/og/JSON-LD) stays consistent with visible changes.',
  '3. If the uploaded-images section is present, the customer DID attach image(s) this turn — never claim otherwise; plan with those exact paths.',
  '4. If anything is unclear, ask in reply and files_to_edit MUST be [] — never edit while asking. If the request is really MAJOR work (redesign, new features, many sections), files_to_edit [] and point them to Dan on 0432 839 654.',
  '5. ' + "REPLY STYLE: you are Dan's website assistant — sound like a friendly, busy Aussie texting a client. First person, contractions, short warm sentences, no corporate fluff, no emojis, never \\"I have successfully\\", never mention being an AI, files, code or paths.",
  '',
  'Output ONLY a JSON object, no markdown fences:',
  '{"reply": "<what you tell the customer>", "files_to_edit": ["index.html"], "plan": "<detailed notes for the implementer>"}',
].join('\\n');

return [{ json: { prompt, editable, isPreset } }];
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

const src = $('Build Planner Prompt').first().json;
const editable = new Set(src.editable);
const cap = src.isPreset ? 8 : 4;
const files = (Array.isArray(plan.files_to_edit) ? plan.files_to_edit : [])
  .map(String).filter((p) => editable.has(p)).slice(0, cap);

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
  'To CREATE a brand-new file (ONLY when the plan says to, e.g. a new blog post page) output instead:',
  '<<<NEWFILE blog/5/index.html',
  '(the complete file content)',
  '>>>',
  'Repeat blocks as needed. After all blocks output:',
  '<<<REPLY',
  '(one or two sentences telling the customer what changed)',
  '>>>',
  '',
  '== RULES ==',
  '- SEARCH text must match the file byte-for-byte (same indentation, quotes, entities). Copy it, never retype it.',
  '- Never remove or rename data-cd attributes or <!-- SECTION --> comments.',
  '- Colors that should follow the site theme must use var(--color-primary) etc., never hard-coded copies of theme colors.',
  '- Hero heading changes: update BOTH the <h1 data-cd="hero-title"> text AND the matching data-title attribute on the first [data-cd="slide"].',
  '- If visible business info changes (name, suburb, services), also update the page <title>, meta description and og: tags in the same page.',
  '- NEVER invent or alter image filenames/paths. An <img src> or background-image value may ONLY be: (a) one of the UPLOADED IMAGE PATHS above copied character-for-character, (b) a path that already appears in the provided files, or (c) an https URL the customer explicitly gave. Anything else 404s and the live site swaps in a random placeholder photo.',
  '- NEWFILE paths must be blog/<number>/index.html only; model the page on the provided reference post (keep its head structure, nav, footer, css link, site.js) with new content.',
  '- Give every <img> meaningful alt text. Use loading="lazy" except above-the-fold.',
  '- Keep HTML valid; keep the existing inline-style coding style of the file.',
  '- ' + "REPLY STYLE: you are Dan's website assistant — sound like a friendly, busy Aussie texting a client. First person, contractions, short warm sentences, no corporate fluff, no emojis, never \\"I have successfully\\", never mention being an AI, files, code or paths.",
].join('\\n');

return [{ json: { prompt, files } }];
`.trim();

const CODE_APPLY_EDITS = `
// Parses SEARCH/REPLACE + NEWFILE blocks and applies them.
let out = String($json.text || '');
const tIdx2 = out.lastIndexOf('</think>');
if (tIdx2 !== -1) out = out.slice(tIdx2 + 8);
const src = $('Build Implementer Prompt').first().json;
const files = { ...src.files };

const blockRe = /<<<FILE ([^\\n]+)\\n<<<SEARCH\\n([\\s\\S]*?)\\n===\\n([\\s\\S]*?)\\n>>>/g;
const newFileRe = /<<<NEWFILE ([^\\n]+)\\n([\\s\\S]*?)\\n>>>/g;
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
  const norm = (s) => s.replace(/\\r/g, '').split('\\n').map((l) => l.replace(/\\s+$/, '')).join('\\n');
  const normFile = norm(files[file]);
  const normSearch = norm(search);
  const idx = normFile.indexOf(normSearch);
  if (idx !== -1) {
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

// brand-new files (blog posts only)
const created = {};
while ((m = newFileRe.exec(out)) !== null) {
  const file = m[1].trim();
  if (!/^blog\\/\\d+\\/index\\.html$/.test(file)) { failed.push(file + ': NEWFILE path not allowed'); continue; }
  if (file in files) { failed.push(file + ': NEWFILE already exists'); continue; }
  created[file] = m[2];
  applied.push(file);
}

const replyM = out.match(replyRe);
const reply = replyM ? replyM[1].trim() : $('Parse Plan').first().json.reply;

const changed = [...new Set(applied)];
if (!changed.length) {
  return [{ json: { noChanges: true, reply: 'Sorry — I could not make that change automatically. Could you describe it a little differently?', failures: failed } }];
}
return changed.map((p) => ({ json: {
  path: p,
  content: created[p] !== undefined ? created[p] : files[p],
  isNew: created[p] !== undefined,
  reply, failures: failed,
} }));
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

/* These nodes are OWNED by builder-auth-flow.cjs (auth/billing versions).
   Updating them from here would revert billing — never touch them in
   update mode. After any full re-create, run builder-auth-flow.cjs too. */
const OWNED_ELSEWHERE = new Set([
  "Validate Edit Request",
  "Build Edit Reply",
  "Has Images",
]);

const ops = [];
for (const n of nodes) {
  if (updateOnly) {
    if (OWNED_ELSEWHERE.has(n.name)) continue;
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
