# Manager AI — Design Spec

**Date:** 2026-06-13
**Status:** Design approved in brainstorming; awaiting written-spec sign-off before implementation planning.
**Owner:** Daniel Anderle

## 1. Purpose

A reactive "helpful manager / dedicated assistant" AI for the tradies who use Complete Digital sites. It keeps leads warm, holds fluent SMS conversations with customers (with full history), runs a lightweight CRM / job board, books call-outs (quoting the **call-out fee only**), sends review requests, and escalates to the tradie only what is worth reporting.

Guiding philosophy (from the user): **give the agent guidelines and capabilities, then let it adapt.** Avoid rigid scripted flows. Keep it adaptable so new capabilities are cheap to add later.

### Success criteria

- Can receive an SMS from a tradie or a customer and reply fluently using that conversation's history + memory.
- Can send SMS (one message per recipient per turn).
- Can add / complete / delete jobs in the CRM, and reacts when a job is created/completed.
- Can quote and book a **call-out** (base fee + travel) — never a job/work price.
- Can send review requests (Google review/maps link from config).
- Maintains per-customer memory that improves over time.
- Infrastructure exists for the website "call us" number form, even though provisioning is not complete.

### Explicitly out of scope (now)

- Quoting the price of the actual work/job (hard guardrail — call-out fee only).
- Per-tradie dedicated phone numbers (single shared number for now; schema leaves room).
- Sharing/relaying every customer message to the tradie (assistant is an autonomous buffer; escalates only noteworthy items).
- Voice/calls, email, payments inside the assistant.

## 2. Architecture overview

Three pieces, with clean boundaries:

```
                 ┌──────────────────────────────────────────────┐
   inbound SMS ─▶ │  n8n workflow "Ai manager" (KnmoZcolFZegudxZ) │
   web lead    ─▶ │  • identify tradie + thread (routing)        │
   CRM event   ─▶ │  • injection/safety gate                     │ ─┐ tool req
                 │  • call brain (ai-runner)                     │  │ (distance/site)
                 │  • run tool, call brain again (≤3 hops)       │ ◀┘
                 │  • execute returned actions                   │
                 │  • persist history + memory                   │
                 └───────────────┬──────────────────────────────┘
                                 │ POST /run  (private URL, async)
                                 ▼
                    ┌────────────────────────────┐        ┌─────────────────────┐
                    │  ai-runner (Railway)        │        │  n8n data tables    │
                    │  mimo-v2.5-pro brain        │        │  • AiManagerConfig  │
                    │  stateless reasoning,       │        │  • Conversations    │
                    │  returns structured JSON    │        │  • Jobs (CRM)       │
                    └────────────────────────────┘        └─────────────────────┘

   /CRM page (completedigital.org/CRM/)  ──▶ CRM webhooks on the same workflow
```

**Component responsibilities**

- **`ai-runner` (the brain).** The existing Railway Claude-Code-style service (project `faithful-eagerness`, service `ecf375fc-07fc-41d3-88fd-2c1b1ec1b84c`, `DEFAULT_MODEL=xiaomi/mimo-v2.5-pro`, fallback `kimi-k2.6`). Used as a **stateless reasoning gateway**: given a manager persona (`system`), the conversation so far, and the available actions/tools, it returns a structured JSON decision. Called from n8n **synchronously** over the **private URL `http://ai-runner.railway.internal:8080/run`** — the private URL bypasses Railway's HTTP proxy, so there is **no 5-minute cap** and the bounded tool loop can stay inside one workflow execution. (Async `callbackUrl` mode remains available for unusually long one-off jobs.) `allowedTools: []` — the agent does **not** get a shell; n8n runs every tool and side-effect. Auth via `RUNNER_SECRET`.

- **n8n workflow "Ai manager" (the hands + store).** Single workflow, multiple webhook entry points. Owns all credentials and side-effects, identifies who is talking, runs the safety gate, drives a small tool loop, executes the brain's actions, and reads/writes the data tables. "Advanced as needed, but one workflow."

- **n8n data tables (the memory + state).** `AiManagerConfig`, `Conversations`, `Jobs`. The brain is stateless; everything persistent lives here.

- **`/CRM` page (the cockpit).** A new standalone page (like `/visual-editor/`) where the tradie fills the capabilities questionnaire and manages the job board. Same `cd-builder-token` auth.

### Why this shape

- Reuses the agent the user already pointed to ("just use that") and its model fallback / queue / async machinery.
- Keeping the brain **shell-free and stateless** sidesteps two known problems at once: mimo's fragility inside autonomous tool loops (documented in the site-editor), and prompt-injection risk from untrusted customer SMS. The agent can only _recommend_ actions; n8n decides whether to run them.
- All side-effects funnel through n8n, so the "one SMS at a time" rule and audit/logging are enforced in one place.

## 3. Data model (n8n data tables)

### 3.1 `AiManagerConfig` — per-tradie capabilities (new table)

Keyed by the tradie's `Number` (their mobile / login, matching the existing `Customer` table). The `/CRM` questionnaire writes this.

| field              | type                     | meaning                                                                        |
| ------------------ | ------------------------ | ------------------------------------------------------------------------------ |
| `number`           | string                   | Tradie mobile (PK, links to `Customer.Number`).                                |
| `site`             | string                   | Customer site repo (links to `Customer.site`); the tradie's own git/website.   |
| `business_name`    | string                   | For voice/persona.                                                             |
| `business_address` | string                   | **Origin** for travel-distance calc.                                           |
| `services_summary` | text                     | What they do (pre-filled from the site repo at onboarding; editable).          |
| `review_link`      | string                   | Google review / maps link for review requests (the "customer_info" maps link). |
| `ai_enabled`       | bool                     | Master on/off for the assistant.                                               |
| `ai_guidelines`    | text                     | Free-text "what the AI can / can't do, tone, do's and don'ts".                 |
| `booking_enabled`  | bool                     | Can it book call-outs?                                                         |
| `base_callout_fee` | number                   | Base call-out fee (AUD).                                                       |
| `cost_per_minute`  | number                   | Travel cost per driving minute (AUD/min).                                      |
| `travel_charge`    | enum `return`\|`one_way` | Default `return`.                                                              |
| `booking_mode`     | enum `auto`\|`propose`   | Default `auto`.                                                                |
| `updated_at`       | string                   | ISO timestamp.                                                                 |

> Travel math: `travel_cost = drive_minutes * cost_per_minute * (travel_charge == 'return' ? 2 : 1)`. `drive_minutes` comes from the Apify scraper's duration; fallback `drive_minutes = distance_km * 1.2` only if duration is absent. **Quote = `base_callout_fee + travel_cost`.** Never anything beyond the call-out.

### 3.2 `Conversations` — per (tradie, phone) thread + memory (new table)

| field           | type                                                | meaning                                                                                         |
| --------------- | --------------------------------------------------- | ----------------------------------------------------------------------------------------------- |
| `id`            | string                                              | UUID.                                                                                           |
| `tradie_number` | string                                              | Which tradie this thread belongs to.                                                            |
| `party_phone`   | string                                              | The other party's phone (customer, or the tradie's own number for the tradie↔assistant thread). |
| `party_kind`    | enum `customer`\|`tradie`                           | Who the assistant is talking to.                                                                |
| `customer_name` | string                                              | If known.                                                                                       |
| `lead_status`   | enum `new`\|`warm`\|`booked`\|`won`\|`lost`\|`idle` | Funnel state.                                                                                   |
| `pending`       | string                                              | Transient flag, e.g. `awaiting_busy_reply`, `awaiting_address`.                                 |
| `history`       | json                                                | Last N turns `[{role, text, ts}]` (cap ~40, like the editor).                                   |
| `memory`        | text                                                | Free-form notes the assistant maintains about this customer.                                    |
| `updated_at`    | string                                              | ISO timestamp.                                                                                  |

**Routing key:** inbound is matched by `party_phone`. The web "call us" form is what first creates a `(tradie_number, party_phone, kind=customer)` row, establishing the association.

### 3.3 `Jobs` — the CRM board (new table)

| field                       | type                                                          | meaning                                    |
| --------------------------- | ------------------------------------------------------------- | ------------------------------------------ |
| `id`                        | string                                                        | UUID.                                      |
| `tradie_number`             | string                                                        | Owner.                                     |
| `customer_phone`            | string                                                        | Links to a conversation.                   |
| `customer_name`             | string                                                        |                                            |
| `address`                   | string                                                        |                                            |
| `title`                     | string                                                        | Short description of the work.             |
| `status`                    | enum `lead`\|`booked`\|`in_progress`\|`complete`\|`cancelled` |                                            |
| `callout_fee_quoted`        | number                                                        | The call-out fee quoted (not a job price). |
| `scheduled_for`             | string                                                        | Optional date/time.                        |
| `notes`                     | text                                                          |                                            |
| `created_at` / `updated_at` | string                                                        |                                            |

> The existing `Customer` table (`NJUM0H4anjWD9V7U`) is left as-is for auth/builder/editor; the assistant's config lives in the new `AiManagerConfig` to avoid disturbing that table.

## 4. The n8n "Ai manager" workflow

One workflow (`KnmoZcolFZegudxZ`) with several webhook trigger nodes. Each trigger starts its own execution path; they share the data-table nodes and the "call brain" / "execute actions" sub-sections.

### 4.1 Webhook entry points

| path                          | source                                            | payload                                              |
| ----------------------------- | ------------------------------------------------- | ---------------------------------------------------- |
| `POST /webhook/aim-sms-in`    | MobileMessage inbound (number `61468104279`)      | `{ from, to, message, messageId }`                   |
| `POST /webhook/aim-web-lead`  | website "call us" form                            | `{ site, customer_phone, customer_name? }`           |
| `POST /webhook/aim-crm-event` | `/CRM` page                                       | `{ token, event: created\|completed\|deleted, job }` |
| `POST /webhook/aim-callback`  | ai-runner async result (optional, long jobs only) | runner job record (with `meta` to correlate)         |

The core SMS-in path calls the brain synchronously (no callback needed); `aim-callback` exists only for the optional async path. Tools (`get_distance`, `get_site_content`) are dispatched by inline nodes inside the workflow, never exposed to the model directly — see 4.3.

### 4.2 Inbound message path (SMS in)

1. **Identify.** If `from` equals a tradie's `Number` (in `AiManagerConfig`) → tradie↔assistant thread for that tradie. Else look up `from` in `Conversations` (`party_kind=customer`): exactly one tradie → that thread. **Zero or 2+ matches → stop, do not reply** (cannot safely attribute; optionally log).
2. **Safety gate.** Run the message through `gpt-oss-safeguard-20b` (cheap classifier). If it flags injection / a discrepancy → **do not reply to the customer; send the tradie a heads-up** and stop.
3. **Load context.** `AiManagerConfig` for the tradie + the `Conversations` row (history + memory) + relevant open `Jobs`.
4. **Call brain** (see 4.3) and **execute the returned actions** (see 4.4).
5. **Persist.** Append the turn to `history`; write back `memory` if the brain returned a `memory_update`; update `lead_status`/`pending` if set.

### 4.3 Brain call + bounded tool loop

- n8n POSTs **synchronously** to `ai-runner /run` (private URL) with:
  - `system`: the manager persona + the tradie's `ai_guidelines` + hard rules (call-out-fee-only; one SMS; escalate noteworthy; don't invent prices/links).
  - the conversation as `messages` (system rules + history + this inbound + any tool results so far).
- The brain returns **structured JSON** (parsed from its last ```json block):

```json
{
  "reply": "message to send to the other party, or null to stay silent",
  "reply_to": "customer | tradie | none",
  "notify_tradie": "optional separate note to the tradie, or null",
  "tool_request": { "tool": "get_distance | get_site_content", "args": {} },
  "actions": [
    {
      "type": "crm_add_job",
      "title": "...",
      "address": "...",
      "callout_fee_quoted": 0
    },
    { "type": "crm_complete_job", "job_id": "..." },
    { "type": "set_lead_status", "status": "warm" },
    { "type": "send_review_request" }
  ],
  "memory_update": "free-form notes to persist, or null"
}
```

- If `tool_request` is present **and** there is no final `reply`/`actions`: n8n runs the tool inline, appends `{role:'tool', ...}` to `messages`, and loops back to the synchronous `/run` call. **Max 3 hops** (n8n loop counter), then force a final, tool-free pass. Tools (n8n-internal nodes, never exposed to the model directly):
  - `get_distance(origin, destination)` → Apify actor `seemuapps/google-distance-matrix-scraper` (n8n `apifyApi` credential) → `{ distance_km, drive_minutes }`. Travel cost computed per 3.1.
  - `get_site_content(repo, query?)` → read the tradie's own site repo from **git** (GitHub API, never scraping) → returns relevant text (services, about, etc.).
- Otherwise n8n proceeds to execute actions.

### 4.4 Action execution (n8n, side-effects)

- `reply` + `reply_to` → **send exactly one SMS** to that party via MobileMessage (reuse the disabled "sms send" node pattern; from `61468104279`). One message per recipient per turn — enforced here.
- `notify_tradie` → one SMS to the tradie's `Number`.
- `crm_add_job` / `crm_update_job` / `crm_complete_job` → `Jobs` table writes.
- `set_lead_status` → `Conversations.lead_status`.
- `send_review_request` → one SMS containing `review_link`.
- `memory_update` → `Conversations.memory`.

### 4.5 Web "call us" lead path

1. Resolve `site` → tradie (`AiManagerConfig`). Create/find the `Conversations(tradie, customer_phone, kind=customer)` row; set `lead_status=new`.
2. Send the customer a warm acknowledgement SMS ("Thanks for reaching out — {business_name} will be in touch shortly").
3. Send the tradie: "📞 Call {name/number}. Reply BUSY if you can't right now." Set `pending=awaiting_busy_reply`.
4. If the tradie replies **BUSY** (normal inbound path, recognised via `pending`): the brain (per guidelines) **asks the tradie** for an ETA / what to say, then relays an apology + ETA to the customer. No CRM lookup for "what he's doing" — it just asks.

### 4.6 CRM event path

- `created` → optionally notify/seed; `completed` → trigger a **review request** (subject to guidelines/toggles); `deleted` → no assistant action. All go through the brain so wording adapts.

## 5. `ai-runner` change (small, backward-compatible)

Add two optional fields to `POST /run`:

- `system` (string): appended to / overrides the persona portion of the system prompt, so we can install the manager voice cleanly.
- `messages` (array): when present, used instead of `[{role:'user', content: prompt}]`, so n8n can drive a multi-turn / multi-hop conversation. `prompt` stays supported for existing callers (the fuser workflow).

No other runner behaviour changes; existing callers are unaffected. (If we want zero runner changes initially, the fallback is to cram persona + history into the single `prompt` string — but adding `system`/`messages` is cleaner and the user pre-approved a small tweak.)

## 6. `/CRM` page

New standalone page at `completedigital.org/CRM/` (frontend on Vercel, same `cd-builder-token` localStorage auth + session restore as `/visual-editor/`). Two sections:

1. **Setup (capabilities questionnaire)** → writes `AiManagerConfig`: assistant on/off, guidelines free-text, business name/address, services (pre-filled from the site repo), review link, booking on/off, base call-out fee, cost-per-minute, travel `return/one_way`, booking `auto/propose`.
2. **Jobs board** → list/add/complete/delete jobs (`Jobs` table) via `aim-crm-event`. Creating/completing a job notifies the assistant workflow.

Styled with the **electro** design system (read `SKILL.md` / `references/DESIGN.md` before building UI).

## 7. Safety & guardrails

- **Injection gate** (`gpt-oss-safeguard-20b`) on every inbound customer message; flag → silent to customer, notify tradie.
- **Ambiguous routing** (phone matches 0 or 2+ tradies) → no reply.
- **Shell-free brain** (`allowedTools: []`); n8n is the only actor; Apify/GitHub tokens never reach the model.
- **Call-out-fee-only** pricing rule baked into the system prompt and reinforced in `ai_guidelines`.
- **One SMS per recipient per turn**, enforced in n8n action execution.
- **Never invent** prices, links, or availability — only use config values and tool results.

## 8. Status / provisioning notes

- MobileMessage inbound webhook + the single number **`61468104279`** must be pointed at `aim-sms-in`. Infrastructure is built now; carrier/number wiring is a config step (same status as the web "call us" form, which is "just a webhook" today).
- Apify `apifyApi` credential already exists in n8n (was deliberately unwired).
- `RUNNER_SECRET` shared between n8n and ai-runner already exists.

## 9. Build order (high level — detailed plan to follow in writing-plans)

1. Data tables: `AiManagerConfig`, `Conversations`, `Jobs`.
2. `ai-runner`: add optional `system` + `messages`.
3. n8n "Ai manager": SMS-in path (identify → gate → brain → actions → persist) end-to-end with the tradie↔assistant thread.
4. Tool loop: `get_distance` (+ Apify), `get_site_content` (git), travel/quote math, booking.
5. Web-lead + BUSY handoff path.
6. `/CRM` page: questionnaire + jobs board, CRM-event trigger.
7. Review-request on job completion.
8. MobileMessage inbound wiring (when number is provisioned).

```

```
