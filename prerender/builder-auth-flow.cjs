/* Customer auth + intent routing + billing for the site editor workflow.
   v3: gpt-oss-120b router classifies each message; $1 is charged ONLY when
   an edit actually happens (questions/major-requests are free; major work
   is referred to Dan on 0432 839 654).

   Run: node prerender/builder-auth-flow.cjs          (create everything)
        node prerender/builder-auth-flow.cjs update   (re-apply parameters)
        node prerender/builder-auth-flow.cjs migrate  (v2 -> v3 in-place)
*/
"use strict";
const fs = require("fs");
const path = require("path");
const { execFileSync } = require("child_process");

const WORKFLOW_ID = "HKIl5u3EycOQkW1t";
const TABLE = {
  __rl: true,
  value: "NJUM0H4anjWD9V7U",
  mode: "list",
  cachedResultName: "Customer",
  cachedResultUrl: "/projects/plQj1g7Jh5oWs2Nv/datatables/NJUM0H4anjWD9V7U",
};
const OR_CRED = { id: "a3JC3E3Sxx6KtLLv", name: "OpenRouter account 3" };
const ROUTER_MODEL = "openai/gpt-oss-120b";
const CREDIT_SECRET = "cd-credit-w7m2p9xk4fqz";
const EDIT_TOKEN = "cd-edit-9drx84kq2m"; // legacy per-site links keep working (unbilled)
const MSG_FEE = 1; // dollars per ACTIONED message
const DAN = "0432 839 654";

/* ---------------- account webhook (login / session / credit) ---------------- */

const CODE_CHECK_LOGIN = `
// Verifies number+password against the Customer table row (if any).
const body = $('Builder Webhook').first().json.body || {};
const row = $input.first().json || {};
const ok = !!(row.id !== undefined && row.Password && String(row.Password) === String(body.password || ''));
if (!ok) return [{ json: { ok: false, error: 'Wrong phone number or password.' } }];

let token;
try { token = crypto.randomUUID() + '-' + crypto.randomUUID(); }
catch (e) { token = Array.from({ length: 64 }, () => Math.floor(Math.random() * 16).toString(16)).join(''); }
const expiry = String(Date.now() + 7 * 24 * 3600 * 1000);

let history = [];
try { history = JSON.parse(row.message_history || '[]'); } catch (e) {}

return [{ json: {
  ok: true, token, expiry,
  rowId: row.id,
  number: row.Number,
  site: row.site || '',
  balance: parseFloat(row.account_balance || '0') || 0,
  history: history.slice(-40),
} }];
`.trim();

const CODE_LOGIN_REPLY = `
// Shape the login response (after the session row was saved).
const s = $('Check Login').first().json;
return [{ json: { ok: true, token: s.token, balance: s.balance, history: s.history, site: s.site, number: s.number } }];
`.trim();

const CODE_SESSION_REPLY = `
// Restores a session from its token.
const row = $input.first().json || {};
const valid = row.id !== undefined && Number(row.session_expiry || 0) > Date.now();
if (!valid) return [{ json: { ok: false, error: 'Session expired — please log in again.' } }];
let history = [];
try { history = JSON.parse(row.message_history || '[]'); } catch (e) {}
return [{ json: {
  ok: true,
  balance: parseFloat(row.account_balance || '0') || 0,
  history: history.slice(-40),
  site: row.site || '',
  number: row.Number,
} }];
`.trim();

const CODE_CREDIT_GUARD = `
// Auth + sanity for balance credits (called by the Vercel Square webhook).
const body = $('Builder Webhook').first().json.body || {};
if (body.secret !== '${CREDIT_SECRET}') throw new Error('bad credit secret');
const amount = Math.round(Number(body.amount) * 100) / 100;
if (!(amount >= 1 && amount <= 1000)) throw new Error('bad amount');
if (!body.number) throw new Error('no account number');
return [{ json: { number: String(body.number), amount } }];
`.trim();

const CODE_APPLY_CREDIT = `
const row = $input.first().json || {};
if (row.id === undefined) throw new Error('account not found');
const g = $('Credit Guard').first().json;
const balance = (parseFloat(row.account_balance || '0') || 0) + g.amount;
return [{ json: { rowId: row.id, newBalance: String(Math.round(balance * 100) / 100), balance: Math.round(balance * 100) / 100 } }];
`.trim();

const CODE_CREDIT_REPLY = `
return [{ json: { ok: true, balance: $('Apply Credit').first().json.balance } }];
`.trim();

/* ---------------- editor chain: validate / route / bill ---------------- */

const CODE_VALIDATE_V3 = `
// Validates the edit request: customer session (billed) or legacy site link.
const body = $('Edit Webhook').first().json.body || {};
const row = $input.first().json || {}; // from Load Session (may be empty)

let site, history, billing = null;

if (body.token === '${EDIT_TOKEN}' && body.site) {
  // legacy unbilled per-site link
  site = String(body.site);
  history = (Array.isArray(body.history) ? body.history : []).slice(-12);
} else {
  const valid = row.id !== undefined && Number(row.session_expiry || 0) > Date.now();
  if (!valid) return [{ json: { authFailed: true } }];
  site = String(row.site || '');
  const balance = parseFloat(row.account_balance || '0') || 0;
  try { history = JSON.parse(row.message_history || '[]'); } catch (e) { history = []; }
  history = history.slice(-12);
  billing = {
    rowId: row.id,
    number: row.Number,
    balanceNow: Math.round(balance * 100) / 100,
    newBalance: String(Math.round((balance - ${MSG_FEE}) * 100) / 100),
    canAfford: balance >= ${MSG_FEE},
    prevHistory: JSON.parse(row.message_history || '[]'),
  };
}

if (!/^[A-Za-z0-9._-]{1,80}$/.test(site)) throw new Error('Invalid site');
const message = String(body.message || '').slice(0, 6000);
if (!message.trim()) throw new Error('Empty message');
history = history.map((m) => ({ role: m.role === 'assistant' ? 'assistant' : 'user', content: String(m.content || '').slice(0, 4000) }));

const stamp = Date.now();
const images = (Array.isArray(body.images) ? body.images : []).slice(0, 4).map((img, i) => {
  const name = String(img.name || 'image.jpg').replace(/[^A-Za-z0-9._-]/g, '_').slice(-60);
  const b64 = String(img.b64 || '');
  if (b64.length > 6 * 1024 * 1024) throw new Error('Image too large (max ~4MB)');
  const ext = (name.split('.').pop() || 'jpg').toLowerCase();
  const mime = { jpg: 'image/jpeg', jpeg: 'image/jpeg', png: 'image/png', webp: 'image/webp', gif: 'image/gif', svg: 'image/svg+xml' }[ext] || 'image/jpeg';
  return { name, b64, mime, path: 'assets/uploads/' + stamp + '-' + i + '-' + name };
});

return [{ json: { site, message, history, images, imagePaths: images.map((x) => '/' + x.path), billing } }];
`.trim();

const CODE_ROUTER_PROMPT = `
// Cheap, fast intent classification before any money is spent or charged.
const v = $('Validate Edit Request').first().json;
const recent = v.history.slice(-6).map((m) => m.role.toUpperCase() + ': ' + m.content).join('\\n');

const prompt = [
  'You route customer requests for a small-business website editing chat. Classify the message; when no edit should happen, also draft the reply.',
  '',
  'ALLOWED here (MINOR changes, $1 each): wording/text changes, headings, the prices shown on the site, contact details, swapping/adding/removing images, fixing obvious issues (typos, broken bits), and improving the content of ONE section at a time. Messages starting with "[PRESET:" are curated jobs and always count as edits.',
  'NOT allowed (MAJOR work, free reply, refer to Dan): redesigns, layout/structural changes, new pages or features, full-page or whole-site rewrites, integrations/bookings/forms, SEO overhauls, anything spanning many sections or pages. For these the customer needs Dan directly on ${DAN}.',
  '',
  v.imagePaths.length ? 'THE CUSTOMER ATTACHED ' + v.imagePaths.length + ' IMAGE(S) THIS TURN.' : 'No images attached this turn.',
  '',
  'RECENT CONVERSATION:',
  recent || '(first message)',
  '',
  'CUSTOMER MESSAGE:',
  v.message,
  '',
  'INTENTS:',
  '- question  : asking about the site or service, chit-chat, or so unclear you need a follow-up. Not charged.',
  '- text_edit : change/fix text, headings, prices, contact details, typos.',
  '- image_edit: add/swap/remove an image (especially when images are attached).',
  '- content_edit: rewrite/improve ONE section of one page.',
  '- preset    : message starts with [PRESET:, OR the customer is confirming/continuing a recent [PRESET: ...] task visible in the conversation (e.g. answering its follow-up question). Curated preset jobs are allowed even when they would otherwise be major (like adding a blog post).',
  '- major     : anything from the NOT-allowed list. Not charged.',
  '',
  'REPLY STYLE (question/major only): you are Dan\\'s website assistant. Sound like a friendly, busy Aussie texting a client: first person, contractions, short and warm, no corporate fluff, no emojis, never "I have successfully" or "as an AI". You CANNOT look at or check the website yourself — never promise to "take a look" or report back; share what you know and ask what they want changed. For major: kindly explain that is a bigger job best done properly, and to call or text Dan on ${DAN} — and that this chat has not charged them.',
  '',
  'Output ONLY JSON: {"intent": "question|text_edit|image_edit|content_edit|preset|major", "reply": "<for question/major, else empty>"}',
].join('\\n');

return [{ json: { prompt } }];
`.trim();

const CODE_PARSE_ROUTE = `
// Extracts the router's decision.
// Presets are OURS — never let the model reclassify them (it once bounced a
// curated blog preset to "major" because new pages are normally off-limits).
const vmsg = String($('Validate Edit Request').first().json.message || '').trim();
if (/^\\[PRESET:/i.test(vmsg)) return [{ json: { intent: 'preset', reply: '' } }];
let raw = String($json.text || '');
const t = raw.lastIndexOf('</think>');
if (t !== -1) raw = raw.slice(t + 8);
const m = raw.match(/\\{[\\s\\S]*\\}/);
let out = {};
try { out = JSON.parse(m ? m[0] : '{}'); } catch (e) {}
const intents = ['question', 'text_edit', 'image_edit', 'content_edit', 'preset', 'major'];
const intent = intents.includes(out.intent) ? out.intent : 'question';
const reply = String(out.reply || '').trim() || 'Happy to help — could you tell me a bit more about what you want changed?';
return [{ json: { intent, reply } }];
`.trim();

const CODE_FREE_REPLY = `
// No-charge response (questions, major-work referrals). Still saves history.
const v = $('Validate Edit Request').first().json;
const r = $('Parse Route').first().json;
const reply = r.reply;
let newHistory = null, billingRowId = null, balance = null;
if (v.billing) {
  balance = v.billing.balanceNow;
  billingRowId = v.billing.rowId;
  newHistory = JSON.stringify((v.billing.prevHistory || []).concat([
    { role: 'user', content: v.message },
    { role: 'assistant', content: reply },
  ]).slice(-40));
}
return [{ json: { reply, changed: [], changedUrls: [], site: v.site, balance, failures: [], newHistory, billingRowId, free: true } }];
`.trim();

const CODE_GATE_REPLY_V3 = `
// Friendly responses for the not-allowed paths.
const v = $('Validate Edit Request').first().json;
if (v.authFailed) return [{ json: { error: 'auth', reply: 'Your session has expired — please log in again.' } }];
return [{ json: {
  error: 'insufficient_balance',
  balance: v.billing ? v.billing.balanceNow : 0,
  reply: "You're out of editing credit — top up and I'll get straight onto it. (Questions are always free.)",
} }];
`.trim();

const CODE_BUILD_REPLY_V3 = `
// Final response payload for the chat UI (edit paths).
const items = $input.all();
const first = items[0] ? items[0].json : {};
let reply = first.reply || 'Done.';
try { reply = $('Apply Edits').first().json.reply || reply; } catch (e) {}
let changed = [];
try { changed = $('Apply Edits').all().filter((i) => i.json.path).map((i) => i.json.path); } catch (e) {}
changed = [...new Set(changed)];
const v = $('Validate Edit Request').first().json;

// the fee only applies when Charge Fee actually ran (i.e. a commit happened)
let charged = false;
try { $('Charge Fee').first(); charged = true; } catch (e) {}

let failures = first.failures || [];
try { failures = $('Apply Edits').first().json.failures || failures; } catch (e) {}

let newHistory = null, balance = null, billingRowId = null;
if (v.billing) {
  balance = charged ? parseFloat(v.billing.newBalance) : v.billing.balanceNow;
  billingRowId = v.billing.rowId;
  newHistory = JSON.stringify((v.billing.prevHistory || []).concat([
    { role: 'user', content: v.message },
    { role: 'assistant', content: reply },
  ]).slice(-40));
}

return [{ json: {
  reply, changed,
  changedUrls: changed.map((p) => '/' + p.replace(/index\\.html$/, '').replace(/\\.html$/, '')),
  site: v.site,
  balance,
  failures,
  newHistory,
  billingRowId,
} }];
`.trim();

const CODE_FINAL_REPLY_V3 = `
// Strip internals before responding to the UI (edit OR free path).
let src = null;
try { src = $('Build Edit Reply').first().json; } catch (e) {}
if (!src) { try { src = $('Free Reply').first().json; } catch (e) {} }
const r = { ...(src || { reply: 'Done.' }) };
delete r.newHistory; delete r.billingRowId;
return [{ json: r }];
`.trim();

/* ---------------- helpers ---------------- */

const dtGet = (filterKey, filterValueExpr) => ({
  operation: "get",
  dataTableId: TABLE,
  filters: { conditions: [{ keyName: filterKey, keyValue: filterValueExpr }] },
});

const dtUpdate = (filterKey, filterValueExpr, cols) => ({
  operation: "update",
  dataTableId: TABLE,
  filters: { conditions: [{ keyName: filterKey, keyValue: filterValueExpr }] },
  columns: {
    mappingMode: "defineBelow",
    value: cols,
    matchingColumns: [],
    schema: [],
    attemptToConvertTypes: false,
    convertFieldsToString: false,
  },
});

const ifCond = (id, leftExpr, op, right) => ({
  conditions: {
    options: {
      caseSensitive: true,
      leftValue: "",
      typeValidation: "loose",
      version: 2,
    },
    conditions: [{ id, leftValue: leftExpr, rightValue: right, operator: op }],
    combinator: "and",
  },
  options: {},
});

const switchRule = (key, val) => ({
  conditions: {
    options: {
      caseSensitive: true,
      leftValue: "",
      typeValidation: "loose",
      version: 2,
    },
    conditions: [
      {
        leftValue: "={{ $json.body.action }}",
        rightValue: val,
        operator: { type: "string", operation: "equals" },
      },
    ],
    combinator: "and",
  },
  renameOutput: true,
  outputKey: key,
});

const VREF = "$('Validate Edit Request').first().json";

/* ---------------- nodes ---------------- */

const Y = 1150;
const accountNodes = [
  {
    name: "Builder Webhook",
    type: "n8n-nodes-base.webhook",
    typeVersion: 2,
    position: [1000, Y],
    parameters: {
      httpMethod: "POST",
      path: "builder-auth",
      responseMode: "responseNode",
      options: { allowedOrigins: "*" },
    },
  },
  {
    name: "Route Action",
    type: "n8n-nodes-base.switch",
    typeVersion: 3.2,
    position: [1200, Y],
    parameters: {
      rules: {
        values: [
          switchRule("login", "login"),
          switchRule("session", "session"),
          switchRule("credit", "credit"),
        ],
      },
      options: {},
    },
  },
  {
    name: "Find User",
    type: "n8n-nodes-base.dataTable",
    typeVersion: 1.1,
    position: [1420, Y - 160],
    settings: { alwaysOutputData: true },
    parameters: dtGet(
      "Number",
      "={{ $('Builder Webhook').first().json.body.number }}",
    ),
  },
  {
    name: "Check Login",
    type: "n8n-nodes-base.code",
    typeVersion: 2,
    position: [1620, Y - 160],
    parameters: { mode: "runOnceForAllItems", jsCode: CODE_CHECK_LOGIN },
  },
  {
    name: "Login OK",
    type: "n8n-nodes-base.if",
    typeVersion: 2.2,
    position: [1820, Y - 160],
    parameters: ifCond(
      "lo1",
      "={{ $json.ok ? 1 : 0 }}",
      { type: "number", operation: "equals" },
      1,
    ),
  },
  {
    name: "Save Session",
    type: "n8n-nodes-base.dataTable",
    typeVersion: 1.1,
    position: [2020, Y - 220],
    parameters: dtUpdate("id", "={{ $json.rowId }}", {
      session_token: "={{ $json.token }}",
      session_expiry: "={{ $json.expiry }}",
    }),
  },
  {
    name: "Login Reply",
    type: "n8n-nodes-base.code",
    typeVersion: 2,
    position: [2220, Y - 220],
    settings: { executeOnce: true },
    parameters: { mode: "runOnceForAllItems", jsCode: CODE_LOGIN_REPLY },
  },
  {
    name: "Find Session",
    type: "n8n-nodes-base.dataTable",
    typeVersion: 1.1,
    position: [1420, Y],
    settings: { alwaysOutputData: true },
    parameters: dtGet(
      "session_token",
      "={{ $('Builder Webhook').first().json.body.token }}",
    ),
  },
  {
    name: "Session Reply",
    type: "n8n-nodes-base.code",
    typeVersion: 2,
    position: [1620, Y],
    parameters: { mode: "runOnceForAllItems", jsCode: CODE_SESSION_REPLY },
  },
  {
    name: "Credit Guard",
    type: "n8n-nodes-base.code",
    typeVersion: 2,
    position: [1420, Y + 160],
    parameters: { mode: "runOnceForAllItems", jsCode: CODE_CREDIT_GUARD },
  },
  {
    name: "Find User Credit",
    type: "n8n-nodes-base.dataTable",
    typeVersion: 1.1,
    position: [1620, Y + 160],
    settings: { alwaysOutputData: true },
    parameters: dtGet("Number", "={{ $json.number }}"),
  },
  {
    name: "Apply Credit",
    type: "n8n-nodes-base.code",
    typeVersion: 2,
    position: [1820, Y + 160],
    parameters: { mode: "runOnceForAllItems", jsCode: CODE_APPLY_CREDIT },
  },
  {
    name: "Save Credit",
    type: "n8n-nodes-base.dataTable",
    typeVersion: 1.1,
    position: [2020, Y + 160],
    parameters: dtUpdate("id", "={{ $json.rowId }}", {
      account_balance: "={{ $json.newBalance }}",
    }),
  },
  {
    name: "Credit Reply",
    type: "n8n-nodes-base.code",
    typeVersion: 2,
    position: [2220, Y + 160],
    settings: { executeOnce: true },
    parameters: { mode: "runOnceForAllItems", jsCode: CODE_CREDIT_REPLY },
  },
  {
    name: "Respond Builder",
    type: "n8n-nodes-base.respondToWebhook",
    typeVersion: 1.1,
    position: [2440, Y],
    parameters: { respondWith: "firstIncomingItem", options: {} },
  },
];

const editorNodes = [
  {
    name: "Load Session",
    type: "n8n-nodes-base.dataTable",
    typeVersion: 1.1,
    position: [1100, 430],
    settings: { alwaysOutputData: true },
    parameters: dtGet("session_token", "={{ $json.body.token }}"),
  },
  {
    name: "Validate Edit Request",
    type: "n8n-nodes-base.code",
    typeVersion: 2,
    position: [1200, 430],
    parameters: { mode: "runOnceForAllItems", jsCode: CODE_VALIDATE_V3 },
  },
  {
    name: "Can Proceed",
    type: "n8n-nodes-base.if",
    typeVersion: 2.2,
    position: [1300, 430],
    parameters: ifCond(
      "cp1",
      "={{ $json.authFailed ? 1 : 0 }}",
      { type: "number", operation: "equals" },
      0,
    ),
  },
  {
    name: "Gate Reply",
    type: "n8n-nodes-base.code",
    typeVersion: 2,
    position: [1500, 530],
    parameters: { mode: "runOnceForAllItems", jsCode: CODE_GATE_REPLY_V3 },
  },
  /* router (new in v3) */
  {
    name: "Build Router Prompt",
    type: "n8n-nodes-base.code",
    typeVersion: 2,
    position: [1440, 330],
    parameters: { mode: "runOnceForAllItems", jsCode: CODE_ROUTER_PROMPT },
  },
  {
    name: "Route Intent",
    type: "@n8n/n8n-nodes-langchain.chainLlm",
    typeVersion: 1.9,
    position: [1580, 330],
    parameters: {
      promptType: "define",
      text: "={{ $json.prompt }}",
      batching: {},
    },
  },
  {
    name: "Router Model",
    type: "@n8n/n8n-nodes-langchain.lmChatOpenRouter",
    typeVersion: 1,
    position: [1580, 480],
    credentials: { openRouterApi: OR_CRED },
    parameters: { model: ROUTER_MODEL, options: {} },
  },
  {
    name: "Parse Route",
    type: "n8n-nodes-base.code",
    typeVersion: 2,
    position: [1720, 330],
    parameters: { mode: "runOnceForAllItems", jsCode: CODE_PARSE_ROUTE },
  },
  {
    name: "Action Switch",
    type: "n8n-nodes-base.if",
    typeVersion: 2.2,
    position: [1860, 330],
    parameters: ifCond(
      "as1",
      "={{ ['text_edit','image_edit','content_edit','preset'].includes($json.intent) ? 1 : 0 }}",
      { type: "number", operation: "equals" },
      1,
    ),
  },
  {
    name: "Charge Gate",
    type: "n8n-nodes-base.if",
    typeVersion: 2.2,
    position: [2000, 280],
    parameters: ifCond(
      "cg1",
      "={{ (!" +
        VREF +
        ".billing || " +
        VREF +
        ".billing.canAfford) ? 1 : 0 }}",
      { type: "number", operation: "equals" },
      1,
    ),
  },
  {
    name: "Free Reply",
    type: "n8n-nodes-base.code",
    typeVersion: 2,
    position: [2000, 430],
    settings: { executeOnce: true },
    parameters: { mode: "runOnceForAllItems", jsCode: CODE_FREE_REPLY },
  },
  {
    /* charges AFTER a successful commit — failed or no-op runs cost nothing */
    name: "Charge Fee",
    type: "n8n-nodes-base.dataTable",
    typeVersion: 1.1,
    position: [3800, 520],
    settings: { alwaysOutputData: true, executeOnce: true },
    parameters: dtUpdate(
      "id",
      "={{ " + VREF + ".billing ? " + VREF + ".billing.rowId : -1 }}",
      {
        account_balance:
          "={{ " + VREF + ".billing ? " + VREF + ".billing.newBalance : '' }}",
      },
    ),
  },
  {
    /* guards Commit Edit from the "no changes applied" item */
    name: "Made Changes",
    type: "n8n-nodes-base.if",
    typeVersion: 2.2,
    position: [3500, 520],
    parameters: ifCond(
      "mc1",
      "={{ $json.path ? 1 : 0 }}",
      { type: "number", operation: "equals" },
      1,
    ),
  },
  {
    /* the GitHub node's operation field can't be an expression — route
       brand-new files (blog posts) to a dedicated file:create node */
    name: "Is New File",
    type: "n8n-nodes-base.if",
    typeVersion: 2.2,
    position: [3650, 520],
    parameters: ifCond(
      "inf1",
      "={{ $json.isNew ? 1 : 0 }}",
      { type: "number", operation: "equals" },
      1,
    ),
  },
  {
    name: "Commit New File",
    type: "n8n-nodes-base.github",
    typeVersion: 1.1,
    position: [3800, 420],
    credentials: {
      githubApi: { id: "5nFNKB7SlRtiwZqO", name: "GitHub account" },
    },
    parameters: {
      resource: "file",
      operation: "create",
      owner: { __rl: true, value: "danielanderledan-stack", mode: "name" },
      repository: {
        __rl: true,
        value: "={{ $('Validate Edit Request').first().json.site }}",
        mode: "name",
      },
      filePath: "={{ $json.path }}",
      fileContent: "={{ $json.content }}",
      commitMessage:
        "={{ 'site edit (new page): ' + $('Validate Edit Request').first().json.message.slice(0, 60) }}",
    },
  },
  {
    name: "Save Chat History",
    type: "n8n-nodes-base.dataTable",
    typeVersion: 1.1,
    position: [4200, 600],
    settings: { alwaysOutputData: true, executeOnce: true },
    parameters: dtUpdate("id", "={{ $json.billingRowId ?? -1 }}", {
      message_history: "={{ $json.newHistory || '' }}",
    }),
  },
  {
    name: "Build Edit Reply",
    type: "n8n-nodes-base.code",
    typeVersion: 2,
    position: [4000, 600],
    settings: { executeOnce: true },
    parameters: { mode: "runOnceForAllItems", jsCode: CODE_BUILD_REPLY_V3 },
  },
  {
    name: "Final Reply",
    type: "n8n-nodes-base.code",
    typeVersion: 2,
    position: [4400, 600],
    settings: { executeOnce: true },
    parameters: { mode: "runOnceForAllItems", jsCode: CODE_FINAL_REPLY_V3 },
  },
  /* owned here so the editor-flow script can't revert it */
  {
    name: "Has Images",
    type: "n8n-nodes-base.if",
    typeVersion: 2.2,
    position: [2280, 280],
    parameters: ifCond(
      "h1",
      "={{ " + VREF + ".images.length }}",
      { type: "number", operation: "gt" },
      0,
    ),
  },
];

const NEW_IN_V3 = new Set([
  "Build Router Prompt",
  "Route Intent",
  "Router Model",
  "Parse Route",
  "Action Switch",
  "Charge Gate",
  "Free Reply",
]);

const accountConnections = [
  ["Builder Webhook", "Route Action"],
  { source: "Route Action", target: "Find User", sourceIndex: 0 },
  { source: "Route Action", target: "Find Session", sourceIndex: 1 },
  { source: "Route Action", target: "Credit Guard", sourceIndex: 2 },
  ["Find User", "Check Login"],
  ["Check Login", "Login OK"],
  { source: "Login OK", target: "Save Session", sourceIndex: 0 },
  { source: "Login OK", target: "Respond Builder", sourceIndex: 1 },
  ["Save Session", "Login Reply"],
  ["Login Reply", "Respond Builder"],
  ["Find Session", "Session Reply"],
  ["Session Reply", "Respond Builder"],
  ["Credit Guard", "Find User Credit"],
  ["Find User Credit", "Apply Credit"],
  ["Apply Credit", "Save Credit"],
  ["Save Credit", "Credit Reply"],
  ["Credit Reply", "Respond Builder"],
];

const editorConnections = [
  { source: "Can Proceed", target: "Build Router Prompt", sourceIndex: 0 },
  { source: "Can Proceed", target: "Gate Reply", sourceIndex: 1 },
  ["Build Router Prompt", "Route Intent"],
  {
    source: "Router Model",
    target: "Route Intent",
    connectionType: "ai_languageModel",
  },
  ["Route Intent", "Parse Route"],
  ["Parse Route", "Action Switch"],
  { source: "Action Switch", target: "Charge Gate", sourceIndex: 0 },
  { source: "Action Switch", target: "Free Reply", sourceIndex: 1 },
  { source: "Charge Gate", target: "Has Images", sourceIndex: 0 },
  { source: "Charge Gate", target: "Gate Reply", sourceIndex: 1 },
  ["Free Reply", "Save Chat History"],
  ["Gate Reply", "Respond Edit"],
  /* charge only after edits were actually committed */
  ["Apply Edits", "Made Changes"],
  { source: "Made Changes", target: "Is New File", sourceIndex: 0 },
  { source: "Made Changes", target: "Build Edit Reply", sourceIndex: 1 },
  { source: "Is New File", target: "Commit New File", sourceIndex: 0 },
  { source: "Is New File", target: "Commit Edit", sourceIndex: 1 },
  ["Commit New File", "Charge Fee"],
  ["Commit Edit", "Charge Fee"],
  ["Charge Fee", "Build Edit Reply"],
  ["Build Edit Reply", "Save Chat History"],
  ["Save Chat History", "Final Reply"],
  ["Final Reply", "Respond Edit"],
];

/* ---------------- apply ---------------- */

const mode = process.argv[2] || "create";
const ops = [];
const allNodes = [...accountNodes, ...editorNodes];

function addNodeOps(nodeList) {
  for (const n of nodeList) {
    const { settings, ...node } = n;
    ops.push({ type: "addNode", node });
    if (settings)
      ops.push({ type: "setNodeSettings", nodeName: n.name, settings });
  }
}
function updateOps(nodeList) {
  for (const n of nodeList) {
    ops.push({
      type: "updateNodeParameters",
      nodeName: n.name,
      parameters: n.parameters,
      replace: true,
    });
    if (n.settings)
      ops.push({
        type: "setNodeSettings",
        nodeName: n.name,
        settings: n.settings,
      });
  }
}

if (mode === "update") {
  updateOps(allNodes);
} else if (mode === "migrate") {
  /* v2 -> v3: add router nodes, rewire the charge, update changed params */
  addNodeOps(editorNodes.filter((n) => NEW_IN_V3.has(n.name)));
  ops.push({
    type: "removeConnection",
    source: "Can Proceed",
    target: "Charge Fee",
  });
  for (const c of editorConnections) {
    ops.push(
      Array.isArray(c)
        ? { type: "addConnection", source: c[0], target: c[1] }
        : { type: "addConnection", ...c },
    );
  }
  updateOps(
    allNodes.filter(
      (n) =>
        !NEW_IN_V3.has(n.name) &&
        [
          "Validate Edit Request",
          "Gate Reply",
          "Charge Fee",
          "Save Chat History",
          "Build Edit Reply",
          "Final Reply",
          "Has Images",
        ].includes(n.name),
    ),
  );
} else if (mode !== "reconcile") {
  addNodeOps(allNodes);
  for (const c of [...accountConnections, ...editorConnections]) {
    ops.push(
      Array.isArray(c)
        ? { type: "addConnection", source: c[0], target: c[1] }
        : { type: "addConnection", ...c },
    );
  }
  ops.push({
    type: "addConnection",
    source: "Edit Webhook",
    target: "Load Session",
  });
  ops.push({
    type: "addConnection",
    source: "Load Session",
    target: "Validate Edit Request",
  });
  ops.push({
    type: "addConnection",
    source: "Validate Edit Request",
    target: "Can Proceed",
  });
}

if (mode === "reconcile") {
  /* Diff against the LIVE workflow: add missing nodes/connections, refresh
     params of owned nodes, remove stale legacy wiring. Survives manual UI
     edits and version restores. */
  const live = JSON.parse(
    execFileSync(
      process.execPath,
      [
        path.join(__dirname, "n8n-mcp.cjs"),
        "get_workflow_details",
        JSON.stringify({ workflowId: WORKFLOW_ID }),
      ],
      { encoding: "utf8", maxBuffer: 64e6 },
    ),
  ).workflow;
  const liveNames = new Set(live.nodes.map((n) => n.name));
  const hasConn = (src, tgt, type, si) => {
    const c = live.connections[src];
    const lists = (c && c[type || "main"]) || [];
    const list = lists[si || 0] || [];
    return list.some((t) => t && t.node === tgt);
  };

  for (const n of allNodes) {
    if (liveNames.has(n.name)) {
      ops.push({
        type: "updateNodeParameters",
        nodeName: n.name,
        parameters: n.parameters,
        replace: true,
      });
      if (n.credentials) {
        const key = Object.keys(n.credentials)[0];
        ops.push({
          type: "setNodeCredential",
          nodeName: n.name,
          credentialKey: key,
          credentialId: n.credentials[key].id,
          credentialName: n.credentials[key].name,
        });
      }
    } else {
      const { settings, ...node } = n;
      ops.push({ type: "addNode", node });
    }
    if (n.settings)
      ops.push({
        type: "setNodeSettings",
        nodeName: n.name,
        settings: n.settings,
      });
  }

  /* stale direct wiring from older topologies */
  const stale = [
    ["Edit Webhook", "Validate Edit Request"],
    ["Validate Edit Request", "Has Images"],
    ["Build Edit Reply", "Respond Edit"],
    ["Can Proceed", "Charge Fee"],
    ["Made Changes", "Commit Edit"],
    /* v3.1: charge moved to post-commit */
    ["Charge Gate", "Charge Fee"],
    ["Charge Fee", "Has Images"],
    ["Apply Edits", "Commit Edit"],
    ["Commit Edit", "Build Edit Reply"],
  ];
  for (const [s, t] of stale) {
    if (hasConn(s, t))
      ops.push({ type: "removeConnection", source: s, target: t });
  }

  const wanted = [
    ...accountConnections,
    ...editorConnections,
    ["Edit Webhook", "Load Session"],
    ["Load Session", "Validate Edit Request"],
    ["Validate Edit Request", "Can Proceed"],
  ];
  for (const c of wanted) {
    const o = Array.isArray(c) ? { source: c[0], target: c[1] } : c;
    if (!hasConn(o.source, o.target, o.connectionType, o.sourceIndex)) {
      ops.push({ type: "addConnection", ...o });
    }
  }
}

/* the MCP tool caps operations at 100 — apply in ordered batches
   (reconcile is idempotent, so a mid-run failure is safely re-runnable) */
console.log("mode:", mode, "— ops:", ops.length, "— applying...");
for (let i = 0; i < ops.length; i += 90) {
  const batch = ops.slice(i, i + 90);
  fs.writeFileSync(
    path.join(__dirname, "builder-ops.json"),
    JSON.stringify({ workflowId: WORKFLOW_ID, operations: batch }),
  );
  const out = execFileSync(
    process.execPath,
    [
      path.join(__dirname, "n8n-mcp.cjs"),
      "update_workflow",
      "@" + path.join(__dirname, "builder-ops.json"),
    ],
    { encoding: "utf8" },
  );
  console.log("batch", i / 90 + 1, ":", out.slice(0, 200).replace(/\s+/g, " "));
}
