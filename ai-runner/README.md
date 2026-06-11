# ai-runner

Claude Code-style AI runner for the `faithful-eagerness` Railway project.
A thin HTTP wrapper around an agentic loop: it accepts a prompt, optionally
clones a GitHub repo into a scratch workspace, lets the model use tools
(`bash`, `read_file`, `write_file`, `list_dir`) inside that workspace, and
returns the final answer. Inference goes through **OpenRouter** using the
`@anthropic-ai/sdk` (OpenRouter exposes an Anthropic-compatible
`/api/v1/messages` endpoint).

- **Deployed from:** `danielanderledan-stack/Website`, branch
  `claude/elegant-maxwell-THblU`, root directory `/ai-runner` (Dockerfile build).
- **Callers:** n8n workflows — see the "AI RUNNER" sticky-note group in the
  *Static Site Fuser — template download* workflow (`HKIl5u3EycOQkW1t`).

## Endpoints

### `POST /run`

Auth: `Authorization: Bearer $RUNNER_SECRET` (or `x-runner-secret: $RUNNER_SECRET`).

Request body:

| field | type | meaning |
|---|---|---|
| `prompt` | string (required) | The task for the agent. |
| `repo` | string | GitHub repo to clone first — `owner/name` or full https URL. Cloned (depth 1) to `<workspace>/repo`, which becomes the cwd. Private repos need `GH_TOKEN` set on the service. The workspace is deleted after the job: the agent is instructed to `git commit && git push` when the task changes the repo (the clone remote is pre-authenticated), and to report the commit hash. |
| `branch` | string | Branch/tag to clone (default: repo default branch). |
| `cwd` | string | Subdirectory (relative to the clone / workspace) to run in. |
| `allowedTools` | string[] | Subset of `bash`, `read_file`, `write_file`, `list_dir`. Empty/omitted = all. |
| `model` | string | OpenRouter model id override (default `xiaomi/mimo-v2.5-pro`). |
| `timeout` | number (seconds) | Job deadline. Sync: default 240, max 280 (Railway's HTTP proxy kills requests at ~5 min). Async: default 600, max 1800. |
| `callbackUrl` | string | **Presence switches to async mode.** The full result is POSTed here when the job finishes (3 attempts, with `x-runner-secret: $RUNNER_SECRET` header so the receiver can verify it's really the runner). |
| `callbackHeaders` | object | Extra headers for the callback POST. |
| `meta` | any | Echoed back untouched (use it to correlate async results in n8n). |

Sync response (200 on success, 500 on failure):

```json
{
  "jobId": "…", "status": "succeeded", "mode": "sync", "meta": …,
  "createdAt": 0, "startedAt": 0, "finishedAt": 0, "durationMs": 0,
  "result": {
    "output": "final assistant text",
    "structured": { "…": "parsed from the last ```json block, or null" },
    "model": "model actually used",
    "modelRequested": "model asked for",
    "fellBack": false,
    "turns": 3,
    "toolCalls": 2
  },
  "error": null
}
```

Async response: `202 {"jobId":"…","status":"queued"}` — the JSON above arrives
later at `callbackUrl`. `429` = busy (sync) or queue full (async); retry later.

### `GET /jobs/:id`

Status/result of a recent job (in-memory, last ~200). Same auth.

### `GET /healthz`

No auth. `{ ok, running, queued, defaultModel, fallbackModel, hasKey }`.

## Model selection & fallback

1. `model` from the request, else `DEFAULT_MODEL` env, else `xiaomi/mimo-v2.5-pro`.
2. If a `messages` call fails (non-2xx, connection error, model unavailable),
   the job switches **once** to the fallback (`FALLBACK_MODEL` env, default
   `moonshotai/kimi-k2.6`) and stays on it for the rest of the job.
   The response reports `model`, `modelRequested` and `fellBack`.
3. If the fallback also fails, the job fails with the underlying error.

To swap models permanently: change the `DEFAULT_MODEL` / `FALLBACK_MODEL`
variables on the Railway service (no redeploy needed beyond the automatic
restart). Any OpenRouter model id works — list: `GET https://openrouter.ai/api/v1/models`.

## Environment variables (Railway service `ai-runner`)

| var | required | meaning |
|---|---|---|
| `OPENROUTER_API_KEY` | **yes** | OpenRouter API key — the only auth the runner needs for inference. |
| `RUNNER_SECRET` | **yes** | Shared secret callers must present. The server rejects everything if unset. |
| `GH_TOKEN` | no | GitHub token used for cloning private repos and available to `gh` inside jobs. |
| `DEFAULT_MODEL` / `FALLBACK_MODEL` | no | See above. |
| `MAX_CONCURRENCY` | no | Parallel jobs (default 1; excess sync requests get 429). |
| `QUEUE_LIMIT` | no | Async queue depth (default 10). |
| `MAX_TURNS` / `MAX_TOKENS` | no | Agent loop limits (default 24 / 8192). |
| `BASH_TIMEOUT_MS` | no | Per-command timeout for the bash tool (default 120000). |
| `KEEP_WORKSPACES` | no | `1` keeps `/tmp/ai-runner-jobs/<id>` after the job (debugging). |
| `OPENROUTER_BASE_URL` | no | Default `https://openrouter.ai/api`. **Note:** the Anthropic SDK appends `/v1/messages` itself, so do *not* include `/v1` here. |

## Calling from n8n

Sync (fits most prompts):

- HTTP Request node → `POST https://<runner-domain>/run`,
  header `x-runner-secret`, JSON body as above, node timeout ≥ 290000 ms.

Async (long jobs):

- Same request plus `"callbackUrl": "https://<n8n-domain>/webhook/ai-runner-callback"`
  and a `meta` value to correlate. The workflow's **AI Runner Callback** webhook
  receives the result.
- n8n and the runner share a Railway project, so n8n can also call the private
  URL `http://ai-runner.railway.internal:8080` — no proxy, no 5-minute cap.

## Operations

- **Logs:** Railway → `ai-runner` service → Deployments → View logs. Every job
  logs start/finish, each tool call, fallbacks, and callback delivery.
- **Update the SDK:** bump `@anthropic-ai/sdk` in `ai-runner/package.json`
  (current pin `^0.104.0`), push to the deploy branch, Railway rebuilds.
  Check the SDK changelog for `messages.create` breaking changes — the runner
  only uses `client.messages.create`, tool blocks, and `stop_reason`.
- **Redeploy without changes:** Railway dashboard → service → "Redeploy",
  or push any commit touching `ai-runner/` on the deploy branch.
