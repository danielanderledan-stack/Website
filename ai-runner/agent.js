'use strict';
/* Agent loop: OpenRouter (Anthropic-compatible /v1/messages endpoint) driving
   local tools (bash / read_file / write_file / list_dir) inside a per-job
   scratch workspace, optionally seeded with a git clone. */
const Anthropic = require('@anthropic-ai/sdk');
const { execFile } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');

const DEFAULT_MODEL = process.env.DEFAULT_MODEL || 'xiaomi/mimo-v2.5-pro';
const FALLBACK_MODEL = process.env.FALLBACK_MODEL || 'moonshotai/kimi-k2.6';
// The Anthropic SDK appends /v1/messages itself, so the OpenRouter base is
// https://openrouter.ai/api (final URL: https://openrouter.ai/api/v1/messages).
const BASE_URL = (process.env.OPENROUTER_BASE_URL || 'https://openrouter.ai/api').replace(/\/+$/, '');
const WORK_ROOT = process.env.WORK_ROOT || path.join(os.tmpdir(), 'ai-runner-jobs');
const MAX_TURNS = parseInt(process.env.MAX_TURNS || '24', 10);
const MAX_TOKENS = parseInt(process.env.MAX_TOKENS || '8192', 10);
const TOOL_OUTPUT_LIMIT = 30000;
const BASH_TIMEOUT_MS = parseInt(process.env.BASH_TIMEOUT_MS || '120000', 10);

const TOOLS = [
  {
    name: 'bash',
    description: 'Run a shell command with bash in the workspace. Returns stdout and stderr (truncated). git and gh are available.',
    input_schema: {
      type: 'object',
      properties: { command: { type: 'string', description: 'The command to run' } },
      required: ['command'],
    },
  },
  {
    name: 'read_file',
    description: 'Read a UTF-8 text file. Path is relative to the workspace cwd.',
    input_schema: {
      type: 'object',
      properties: { path: { type: 'string' } },
      required: ['path'],
    },
  },
  {
    name: 'write_file',
    description: 'Write a UTF-8 text file (creates parent directories). Path is relative to the workspace cwd.',
    input_schema: {
      type: 'object',
      properties: { path: { type: 'string' }, content: { type: 'string' } },
      required: ['path', 'content'],
    },
  },
  {
    name: 'list_dir',
    description: 'List a directory (non-recursive). Path is relative to the workspace cwd; defaults to ".".',
    input_schema: {
      type: 'object',
      properties: { path: { type: 'string' } },
    },
  },
];

function truncate(text, limit) {
  if (text.length <= limit) return text;
  return text.slice(0, limit) + `\n...[truncated ${text.length - limit} chars]`;
}

function sh(cmd, args, opts) {
  return new Promise((resolve) => {
    execFile(cmd, args, { maxBuffer: 16 * 1024 * 1024, ...opts }, (err, stdout, stderr) => {
      resolve({ code: err ? (err.code === undefined ? 1 : err.code) : 0, stdout: stdout || '', stderr: stderr || '', killed: !!(err && err.killed) });
    });
  });
}

function cloneUrl(repo) {
  let url = repo;
  if (/^[\w.-]+\/[\w.-]+$/.test(repo)) url = `https://github.com/${repo}.git`;
  const token = process.env.GH_TOKEN || process.env.GITHUB_TOKEN;
  if (token && url.startsWith('https://github.com/')) {
    url = url.replace('https://github.com/', `https://x-access-token:${token}@github.com/`);
  }
  return url;
}

async function runTool(name, input, ctx) {
  if (name === 'bash') {
    const r = await sh('bash', ['-c', input.command], { cwd: ctx.cwd, timeout: BASH_TIMEOUT_MS, env: process.env });
    let out = '';
    if (r.stdout) out += r.stdout;
    if (r.stderr) out += (out ? '\n--- stderr ---\n' : '') + r.stderr;
    if (r.killed) out += '\n[command timed out]';
    if (r.code !== 0) out += `\n[exit code ${r.code}]`;
    return truncate(out || '(no output)', TOOL_OUTPUT_LIMIT);
  }
  if (name === 'read_file') {
    const p = path.resolve(ctx.cwd, input.path);
    return truncate(fs.readFileSync(p, 'utf8'), TOOL_OUTPUT_LIMIT);
  }
  if (name === 'write_file') {
    const p = path.resolve(ctx.cwd, input.path);
    fs.mkdirSync(path.dirname(p), { recursive: true });
    fs.writeFileSync(p, input.content);
    return `wrote ${Buffer.byteLength(input.content)} bytes to ${input.path}`;
  }
  if (name === 'list_dir') {
    const p = path.resolve(ctx.cwd, input.path || '.');
    const entries = fs.readdirSync(p, { withFileTypes: true })
      .map((e) => (e.isDirectory() ? e.name + '/' : e.name));
    return truncate(entries.join('\n') || '(empty)', TOOL_OUTPUT_LIMIT);
  }
  throw new Error(`unknown tool: ${name}`);
}

/* Create one message, falling back to FALLBACK_MODEL on the first failure
   (any non-2xx / connection / model-unavailable error). The fallback sticks
   for the rest of the job. */
async function createMessage(client, state, params, log) {
  try {
    return await client.messages.create({ ...params, model: state.model }, { signal: state.signal });
  } catch (err) {
    if (state.signal.aborted) throw err;
    if (!state.fellBack && state.model !== FALLBACK_MODEL) {
      log(`model "${state.model}" failed (${err.status || ''} ${err.message ? String(err.message).slice(0, 200) : err}); falling back to "${FALLBACK_MODEL}"`);
      state.fellBack = true;
      state.model = FALLBACK_MODEL;
      return await client.messages.create({ ...params, model: state.model }, { signal: state.signal });
    }
    throw err;
  }
}

function extractStructured(text) {
  const fences = [...text.matchAll(/```json\s*([\s\S]*?)```/g)];
  if (fences.length) {
    try { return JSON.parse(fences[fences.length - 1][1]); } catch (e) { /* fall through */ }
  }
  const t = text.trim();
  if (t.startsWith('{') || t.startsWith('[')) {
    try { return JSON.parse(t); } catch (e) { /* not JSON */ }
  }
  return null;
}

/* job: { id, prompt, repo?, branch?, cwd?, allowedTools?, model?, deadlineMs }
   log: (msg) => void
   returns { output, structured, model, modelRequested, fellBack, turns, toolCalls } */
async function runJob(job, log) {
  if (!process.env.OPENROUTER_API_KEY) throw new Error('OPENROUTER_API_KEY is not set on the service');

  const ws = path.join(WORK_ROOT, job.id);
  fs.mkdirSync(ws, { recursive: true });
  let cwd = ws;

  try {
    if (job.repo) {
      const args = ['clone', '--depth', '1'];
      if (job.branch) args.push('--branch', String(job.branch));
      args.push(cloneUrl(job.repo), path.join(ws, 'repo'));
      log(`cloning ${job.repo}${job.branch ? '@' + job.branch : ''}`);
      const r = await sh('git', args, { timeout: 180000 });
      if (r.code !== 0) throw new Error('git clone failed: ' + truncate(r.stderr.replace(/x-access-token:[^@]+@/g, '***@'), 1000));
      cwd = path.join(ws, 'repo');
    }
    if (job.cwd) {
      const resolved = path.resolve(cwd, job.cwd);
      if (!fs.existsSync(resolved)) throw new Error(`cwd does not exist: ${job.cwd}`);
      cwd = resolved;
    }

    const tools = Array.isArray(job.allowedTools) && job.allowedTools.length
      ? TOOLS.filter((t) => job.allowedTools.includes(t.name))
      : TOOLS;

    const client = new Anthropic({
      apiKey: process.env.OPENROUTER_API_KEY,
      baseURL: BASE_URL,
      maxRetries: 1,
      defaultHeaders: { 'HTTP-Referer': 'https://railway.com', 'X-Title': 'ai-runner' },
    });

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), Math.max(1000, job.deadlineMs - Date.now()));
    const state = { model: job.model || DEFAULT_MODEL, fellBack: false, signal: controller.signal };
    const modelRequested = state.model;

    const system = [
      'You are an automated agent running in a scratch Linux workspace.',
      `Working directory: ${cwd}.`,
      tools.length ? 'Use the provided tools to inspect files and run commands as needed.' : 'No tools are available; answer directly.',
      'When you are done, reply with your final answer as plain text. If the task asks for structured output, include it as a ```json fenced block.',
      'Be direct and concise.',
    ].join(' ');

    const messages = [{ role: 'user', content: String(job.prompt) }];
    let turns = 0;
    let toolCalls = 0;
    let finalText = '';

    try {
      while (turns < MAX_TURNS) {
        turns++;
        const resp = await createMessage(client, state, {
          max_tokens: MAX_TOKENS,
          system,
          messages,
          tools: tools.length ? tools : undefined,
        }, log);

        const toolUses = resp.content.filter((b) => b.type === 'tool_use');
        const texts = resp.content.filter((b) => b.type === 'text').map((b) => b.text);
        if (texts.length) finalText = texts.join('\n');

        if (resp.stop_reason !== 'tool_use' || !toolUses.length) break;

        messages.push({ role: 'assistant', content: resp.content });
        const results = [];
        for (const tu of toolUses) {
          toolCalls++;
          log(`tool ${tu.name}: ${truncate(JSON.stringify(tu.input), 300)}`);
          let content;
          let isError = false;
          try {
            content = await runTool(tu.name, tu.input || {}, { cwd });
          } catch (err) {
            content = 'ERROR: ' + (err && err.message ? err.message : String(err));
            isError = true;
          }
          results.push({ type: 'tool_result', tool_use_id: tu.id, content, is_error: isError });
        }
        messages.push({ role: 'user', content: results });
      }
    } finally {
      clearTimeout(timer);
    }

    if (controller.signal.aborted) throw new Error('job timed out');

    return {
      output: finalText,
      structured: extractStructured(finalText),
      model: state.model,
      modelRequested,
      fellBack: state.fellBack,
      turns,
      toolCalls,
    };
  } finally {
    if (process.env.KEEP_WORKSPACES !== '1') {
      try { fs.rmSync(ws, { recursive: true, force: true }); } catch (e) { /* best effort */ }
    }
  }
}

module.exports = { runJob, DEFAULT_MODEL, FALLBACK_MODEL };
