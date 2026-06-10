/* Minimal MCP-over-HTTP client for the n8n MCP server.
   Usage: node n8n-mcp.cjs <toolName> ['<argsJson>']
   Prints the tool result content as text. */
'use strict';
const URLBASE = 'https://n8n-production-d02c.up.railway.app/mcp-server/http';
const TOK = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiI3YTVlNjQwYy1iYjBmLTQwYjMtOTVjZi01OTRmMzZjZjBjYjkiLCJpc3MiOiJuOG4iLCJhdWQiOiJtY3Atc2VydmVyLWFwaSIsImp0aSI6IjUzMzZlMTI2LTQ1MzgtNDE3Yi05MTUyLWY1MTg2NWNjNGQyZCIsImlhdCI6MTc4MTA5NDY4NH0.EYkD9JX8Vfa3KjBVxFctLFE-bCWTbExrvmH4iP7cqK8';

const HEADERS = {
  Authorization: 'Bearer ' + TOK,
  'Content-Type': 'application/json',
  Accept: 'application/json, text/event-stream',
};

function parseBody(text) {
  // server may answer plain JSON or SSE ("data: {...}")
  const lines = text.split('\n').map((l) => l.replace(/^data: /, '').trim()).filter((l) => l.startsWith('{'));
  return lines.map((l) => JSON.parse(l)).pop();
}

async function rpc(method, params, id, sid) {
  const res = await fetch(URLBASE, {
    method: 'POST',
    headers: sid ? { ...HEADERS, 'Mcp-Session-Id': sid } : HEADERS,
    body: JSON.stringify({ jsonrpc: '2.0', id, method, params }),
  });
  const newSid = res.headers.get('mcp-session-id') || sid;
  const text = await res.text();
  return { json: text ? parseBody(text) : null, sid: newSid, status: res.status };
}

(async () => {
  const tool = process.argv[2];
  const init = await rpc('initialize', {
    protocolVersion: '2025-03-26', capabilities: {},
    clientInfo: { name: 'claude-helper', version: '1.0' },
  }, 1);
  await rpc('notifications/initialized', undefined, undefined, init.sid);
  if (tool === '--schema') {
    const r = await rpc('tools/list', {}, 2, init.sid);
    const names = (process.argv[3] || '').split(',');
    r.json.result.tools.filter((t) => names.includes(t.name))
      .forEach((t) => console.log('====', t.name, '\n', JSON.stringify(t.inputSchema)));
    return;
  }
  const raw = process.argv[3] || '{}';
  const args = raw.startsWith('@') ? JSON.parse(require('fs').readFileSync(raw.slice(1), 'utf8')) : JSON.parse(raw);
  const r = await rpc('tools/call', { name: tool, arguments: args }, 2, init.sid);
  if (!r.json) { console.error('empty response, status', r.status); process.exit(1); }
  if (r.json.error) { console.error('RPC error:', JSON.stringify(r.json.error)); process.exit(1); }
  const res = r.json.result || {};
  if (res.isError) process.exitCode = 1;
  (res.content || []).forEach((c) => console.log(c.text !== undefined ? c.text : JSON.stringify(c)));
})().catch((e) => { console.error(e); process.exit(1); });
