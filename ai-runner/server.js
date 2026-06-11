'use strict';
/* Thin HTTP wrapper around the agent loop.

   POST /run        — run a job (sync by default; async when callbackUrl given)
   GET  /jobs/:id   — job status / result
   GET  /healthz    — liveness + capacity info

   Auth: Authorization: Bearer $RUNNER_SECRET  (or x-runner-secret header). */
const http = require('http');
const crypto = require('crypto');
const { runJob, DEFAULT_MODEL, FALLBACK_MODEL } = require('./agent');

const PORT = parseInt(process.env.PORT || '8080', 10);
const SECRET = process.env.RUNNER_SECRET || '';
const MAX_CONCURRENCY = parseInt(process.env.MAX_CONCURRENCY || '1', 10);
const QUEUE_LIMIT = parseInt(process.env.QUEUE_LIMIT || '10', 10);
// Railway's HTTP proxy cuts requests around 5 minutes — keep sync jobs under it.
const SYNC_DEFAULT_S = 240, SYNC_MAX_S = 280;
const ASYNC_DEFAULT_S = 600, ASYNC_MAX_S = 1800;
const JOB_HISTORY = 200;

const jobs = new Map(); // id -> record
const queue = [];       // async job ids waiting to run
let running = 0;

function log(id, msg) {
  console.log(`[${new Date().toISOString()}] [${id ? id.slice(0, 8) : 'server'}] ${msg}`);
}

function authorized(req) {
  if (!SECRET) return false; // refuse everything until a secret is configured
  const header = req.headers['authorization'] || '';
  const bearer = header.startsWith('Bearer ') ? header.slice(7) : '';
  const candidate = bearer || req.headers['x-runner-secret'] || '';
  const a = crypto.createHash('sha256').update(String(candidate)).digest();
  const b = crypto.createHash('sha256').update(SECRET).digest();
  return crypto.timingSafeEqual(a, b);
}

function json(res, status, body) {
  const text = JSON.stringify(body);
  res.writeHead(status, { 'content-type': 'application/json', 'content-length': Buffer.byteLength(text) });
  res.end(text);
}

function readBody(req, limit) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    req.on('data', (c) => {
      size += c.length;
      if (size > limit) { reject(new Error('body too large')); req.destroy(); return; }
      chunks.push(c);
    });
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    req.on('error', reject);
  });
}

function publicRecord(r) {
  return {
    jobId: r.id, status: r.status, mode: r.mode, meta: r.meta,
    createdAt: r.createdAt, startedAt: r.startedAt, finishedAt: r.finishedAt,
    durationMs: r.startedAt && r.finishedAt ? r.finishedAt - r.startedAt : undefined,
    result: r.result, error: r.error,
  };
}

function trimHistory() {
  while (jobs.size > JOB_HISTORY) {
    const oldest = jobs.keys().next().value;
    if (jobs.get(oldest).status === 'running' || jobs.get(oldest).status === 'queued') break;
    jobs.delete(oldest);
  }
}

async function execute(record) {
  running++;
  record.status = 'running';
  record.startedAt = Date.now();
  log(record.id, `start mode=${record.mode} model=${record.job.model || DEFAULT_MODEL} repo=${record.job.repo || '-'} timeout=${Math.round((record.job.deadlineMs - record.startedAt) / 1000)}s`);
  try {
    record.result = await runJob(record.job, (m) => log(record.id, m));
    record.status = 'succeeded';
    log(record.id, `done model=${record.result.model} fellBack=${record.result.fellBack} turns=${record.result.turns} toolCalls=${record.result.toolCalls}`);
  } catch (err) {
    record.status = 'failed';
    record.error = err && err.message ? err.message : String(err);
    log(record.id, `failed: ${record.error}`);
  } finally {
    record.finishedAt = Date.now();
    running--;
    trimHistory();
    setImmediate(pump);
  }
  if (record.callbackUrl) await deliverCallback(record);
}

async function deliverCallback(record) {
  const payload = JSON.stringify(publicRecord(record));
  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      const res = await fetch(record.callbackUrl, {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'x-runner-secret': SECRET, ...(record.callbackHeaders || {}) },
        body: payload,
        signal: AbortSignal.timeout(30000),
      });
      log(record.id, `callback POST ${record.callbackUrl} -> ${res.status}`);
      if (res.ok) return;
    } catch (err) {
      log(record.id, `callback attempt ${attempt} failed: ${err.message}`);
    }
    await new Promise((r) => setTimeout(r, attempt * 5000));
  }
  log(record.id, 'callback delivery gave up after 3 attempts');
}

function pump() {
  while (running < MAX_CONCURRENCY && queue.length) {
    const record = jobs.get(queue.shift());
    if (record) execute(record);
  }
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, 'http://localhost');

  if (req.method === 'GET' && url.pathname === '/healthz') {
    return json(res, 200, { ok: true, running, queued: queue.length, defaultModel: DEFAULT_MODEL, fallbackModel: FALLBACK_MODEL, hasKey: !!process.env.OPENROUTER_API_KEY });
  }

  if (!authorized(req)) return json(res, 401, { error: 'unauthorized' });

  if (req.method === 'GET' && url.pathname.startsWith('/jobs/')) {
    const record = jobs.get(url.pathname.slice('/jobs/'.length));
    if (!record) return json(res, 404, { error: 'job not found' });
    return json(res, 200, publicRecord(record));
  }

  if (req.method === 'POST' && url.pathname === '/run') {
    let body;
    try {
      body = JSON.parse((await readBody(req, 2 * 1024 * 1024)) || '{}');
    } catch (err) {
      return json(res, 400, { error: 'invalid JSON body: ' + err.message });
    }
    if (!body.prompt || typeof body.prompt !== 'string') return json(res, 400, { error: '"prompt" (string) is required' });

    const isAsync = !!body.callbackUrl;
    const defS = isAsync ? ASYNC_DEFAULT_S : SYNC_DEFAULT_S;
    const maxS = isAsync ? ASYNC_MAX_S : SYNC_MAX_S;
    const timeoutS = Math.min(Math.max(parseInt(body.timeout, 10) || defS, 10), maxS);

    const id = crypto.randomUUID();
    const record = {
      id,
      status: 'queued',
      mode: isAsync ? 'async' : 'sync',
      meta: body.meta,
      createdAt: Date.now(),
      callbackUrl: isAsync ? String(body.callbackUrl) : undefined,
      callbackHeaders: body.callbackHeaders && typeof body.callbackHeaders === 'object' ? body.callbackHeaders : undefined,
      job: {
        id,
        prompt: body.prompt,
        repo: body.repo ? String(body.repo) : undefined,
        branch: body.branch ? String(body.branch) : undefined,
        cwd: body.cwd ? String(body.cwd) : undefined,
        allowedTools: body.allowedTools,
        model: body.model ? String(body.model) : undefined,
        deadlineMs: Date.now() + timeoutS * 1000,
      },
    };

    if (isAsync) {
      if (queue.length >= QUEUE_LIMIT) return json(res, 429, { error: 'queue full, retry later' });
      jobs.set(id, record);
      queue.push(id);
      log(id, 'queued (async)');
      pump();
      return json(res, 202, { jobId: id, status: 'queued' });
    }

    if (running >= MAX_CONCURRENCY) return json(res, 429, { error: 'busy, retry later or use callbackUrl for async mode' });
    jobs.set(id, record);
    record.job.deadlineMs = Date.now() + timeoutS * 1000;
    await execute(record);
    return json(res, record.status === 'succeeded' ? 200 : 500, publicRecord(record));
  }

  return json(res, 404, { error: 'not found (use POST /run, GET /jobs/:id, GET /healthz)' });
});

server.requestTimeout = 0;
server.headersTimeout = 60000;
server.listen(PORT, () => {
  log(null, `ai-runner listening on :${PORT} (concurrency=${MAX_CONCURRENCY}, queue=${QUEUE_LIMIT}, default=${DEFAULT_MODEL}, fallback=${FALLBACK_MODEL}, key=${process.env.OPENROUTER_API_KEY ? 'set' : 'MISSING'}, secret=${SECRET ? 'set' : 'MISSING'})`);
});
