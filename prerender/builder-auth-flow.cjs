/* Adds customer auth + billing to the workflow:
   - /webhook/builder-auth  (login / session / credit actions)
   - editor chain: session check, $1/message charge, server-side history.
   Run: node prerender/builder-auth-flow.cjs        (create everything)
        node prerender/builder-auth-flow.cjs update (re-apply parameters)
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
const CREDIT_SECRET = "cd-credit-w7m2p9xk4fqz";
const EDIT_TOKEN = "cd-edit-9drx84kq2m"; // legacy per-site links keep working
const MSG_FEE = 1; // dollars per message

/* ---------------- Code node sources ---------------- */

const CODE_CHECK_LOGIN = `
// Verifies number+password against the Customer table row (if any).
const body = $('Builder Webhook').first().json.body || {};
const row = $input.first().json || {};
const ok = !!(row.id !== undefined && row.Password && String(row.Password) === String(body.password || ''));
if (!ok) return [{ json: { ok: false, error: 'Wrong phone number or password.' } }];

// session token: webcrypto when available, layered Math.random fallback
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

/* Replacement for the editor chain's Validate Edit Request: session + billing */
const CODE_VALIDATE_V2 = `
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
  if (balance < ${MSG_FEE}) {
    return [{ json: { insufficient: true, balance: Math.round(balance * 100) / 100 } }];
  }
  try { history = JSON.parse(row.message_history || '[]'); } catch (e) { history = []; }
  history = history.slice(-12);
  billing = {
    rowId: row.id,
    number: row.Number,
    newBalance: String(Math.round((balance - ${MSG_FEE}) * 100) / 100),
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

const CODE_GATE_REPLY = `
// Friendly responses for the not-allowed paths.
const j = $input.first().json;
if (j.authFailed) return [{ json: { error: 'auth', reply: 'Your session has expired — please log in again.' } }];
return [{ json: { error: 'insufficient_balance', balance: j.balance, reply: 'You are out of editing credit. Top up to keep making changes.' } }];
`.trim();

/* Build Edit Reply v2: include balance + prepare history to persist */
const CODE_BUILD_REPLY_V2 = `
// Final response payload for the chat UI (handles both edit and no-edit paths).
const items = $input.all();
const first = items[0] ? items[0].json : {};
let reply = first.reply || 'Done.';
try { reply = $('Apply Edits').first().json.reply || reply; } catch (e) {}
let changed = [];
try { changed = $('Apply Edits').all().filter((i) => i.json.path).map((i) => i.json.path); } catch (e) {}
changed = [...new Set(changed)];
const v = $('Validate Edit Request').first().json;

let newHistory = null, balance = null;
if (v.billing) {
  balance = parseFloat(v.billing.newBalance);
  const h = (v.billing.prevHistory || []).concat([
    { role: 'user', content: v.message },
    { role: 'assistant', content: reply },
  ]).slice(-40);
  newHistory = JSON.stringify(h);
}

return [{ json: {
  reply, changed,
  changedUrls: changed.map((p) => '/' + p.replace(/index\\.html$/, '').replace(/\\.html$/, '')),
  site: v.site,
  balance,
  failures: first.failures || [],
  newHistory,
  billingRowId: v.billing ? v.billing.rowId : null,
} }];
`.trim();

const CODE_FINAL_REPLY = `
// Strip internals before responding to the UI.
const r = { ...$('Build Edit Reply').first().json };
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

/* ---------------- nodes ---------------- */

const Y = 1150;
const nodes = [
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

  /* login */
  {
    name: "Find User",
    type: "n8n-nodes-base.dataTable",
    typeVersion: 1.1,
    position: [1420, Y - 160],
    alwaysOutputData: true,
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
    executeOnce: true,
    parameters: { mode: "runOnceForAllItems", jsCode: CODE_LOGIN_REPLY },
  },

  /* session restore */
  {
    name: "Find Session",
    type: "n8n-nodes-base.dataTable",
    typeVersion: 1.1,
    position: [1420, Y],
    alwaysOutputData: true,
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

  /* credit (from Vercel Square webhook) */
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
    alwaysOutputData: true,
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
    executeOnce: true,
    parameters: { mode: "runOnceForAllItems", jsCode: CODE_CREDIT_REPLY },
  },

  {
    name: "Respond Builder",
    type: "n8n-nodes-base.respondToWebhook",
    typeVersion: 1.1,
    position: [2440, Y],
    parameters: { respondWith: "firstIncomingItem", options: {} },
  },

  /* editor chain additions */
  {
    name: "Load Session",
    type: "n8n-nodes-base.dataTable",
    typeVersion: 1.1,
    position: [1100, 430],
    alwaysOutputData: true,
    parameters: dtGet("session_token", "={{ $json.body.token }}"),
  },
  {
    name: "Can Proceed",
    type: "n8n-nodes-base.if",
    typeVersion: 2.2,
    position: [1300, 430],
    parameters: ifCond(
      "cp1",
      "={{ ($json.insufficient || $json.authFailed) ? 1 : 0 }}",
      { type: "number", operation: "equals" },
      0,
    ),
  },
  {
    name: "Gate Reply",
    type: "n8n-nodes-base.code",
    typeVersion: 2,
    position: [1500, 470],
    parameters: { mode: "runOnceForAllItems", jsCode: CODE_GATE_REPLY },
  },
  {
    name: "Charge Fee",
    type: "n8n-nodes-base.dataTable",
    typeVersion: 1.1,
    position: [1500, 350],
    alwaysOutputData: true,
    parameters: dtUpdate(
      "id",
      "={{ $json.billing ? $json.billing.rowId : -1 }}",
      {
        account_balance: "={{ $json.billing ? $json.billing.newBalance : '' }}",
      },
    ),
  },
  {
    name: "Save Chat History",
    type: "n8n-nodes-base.dataTable",
    typeVersion: 1.1,
    position: [4200, 600],
    alwaysOutputData: true,
    executeOnce: true,
    parameters: dtUpdate(
      "id",
      "={{ $('Build Edit Reply').first().json.billingRowId ?? -1 }}",
      {
        message_history:
          "={{ $('Build Edit Reply').first().json.newHistory || '' }}",
      },
    ),
  },
  {
    name: "Final Reply",
    type: "n8n-nodes-base.code",
    typeVersion: 2,
    position: [4400, 600],
    executeOnce: true,
    parameters: { mode: "runOnceForAllItems", jsCode: CODE_FINAL_REPLY },
  },
];

const connections = [
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

/* editor chain rewiring */
const rewires = [
  {
    type: "removeConnection",
    source: "Edit Webhook",
    target: "Validate Edit Request",
  },
  { type: "addConnection", source: "Edit Webhook", target: "Load Session" },
  {
    type: "addConnection",
    source: "Load Session",
    target: "Validate Edit Request",
  },
  {
    type: "removeConnection",
    source: "Validate Edit Request",
    target: "Has Images",
  },
  {
    type: "addConnection",
    source: "Validate Edit Request",
    target: "Can Proceed",
  },
  {
    type: "addConnection",
    source: "Can Proceed",
    target: "Charge Fee",
    sourceIndex: 0,
  },
  {
    type: "addConnection",
    source: "Can Proceed",
    target: "Gate Reply",
    sourceIndex: 1,
  },
  { type: "addConnection", source: "Gate Reply", target: "Respond Edit" },
  { type: "addConnection", source: "Charge Fee", target: "Has Images" },
  {
    type: "removeConnection",
    source: "Build Edit Reply",
    target: "Respond Edit",
  },
  {
    type: "addConnection",
    source: "Build Edit Reply",
    target: "Save Chat History",
  },
  { type: "addConnection", source: "Save Chat History", target: "Final Reply" },
  { type: "addConnection", source: "Final Reply", target: "Respond Edit" },
];

/* parameter updates to existing editor nodes */
const paramUpdates = [
  {
    type: "updateNodeParameters",
    nodeName: "Validate Edit Request",
    parameters: { mode: "runOnceForAllItems", jsCode: CODE_VALIDATE_V2 },
    replace: true,
  },
  {
    type: "updateNodeParameters",
    nodeName: "Build Edit Reply",
    parameters: { mode: "runOnceForAllItems", jsCode: CODE_BUILD_REPLY_V2 },
    replace: true,
  },
  /* Has Images must read from Validate output via node reference (its direct
     input is now Charge Fee, whose output is the updated table row) */
  {
    type: "updateNodeParameters",
    nodeName: "Has Images",
    parameters: ifCond(
      "h1",
      "={{ $('Validate Edit Request').first().json.images.length }}",
      { type: "number", operation: "gt" },
      0,
    ),
    replace: true,
  },
];

/* ---------------- apply ---------------- */

const updateOnly = process.argv[2] === "update";
const ops = [];
if (updateOnly) {
  for (const n of nodes)
    ops.push({
      type: "updateNodeParameters",
      nodeName: n.name,
      parameters: n.parameters,
      replace: true,
    });
  ops.push(...paramUpdates);
} else {
  for (const n of nodes) ops.push({ type: "addNode", node: n });
  for (const c of connections)
    ops.push(
      Array.isArray(c)
        ? { type: "addConnection", source: c[0], target: c[1] }
        : { type: "addConnection", ...c },
    );
  ops.push(...rewires);
  ops.push(...paramUpdates);
}

const payload = { workflowId: WORKFLOW_ID, operations: ops };
fs.writeFileSync(
  path.join(__dirname, "builder-ops.json"),
  JSON.stringify(payload),
);
console.log("ops:", ops.length, "— applying...");
const out = execFileSync(
  process.execPath,
  [
    path.join(__dirname, "n8n-mcp.cjs"),
    "update_workflow",
    "@" + path.join(__dirname, "builder-ops.json"),
  ],
  { encoding: "utf8" },
);
console.log(out.slice(0, 500));
