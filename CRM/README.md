# Tradie CRM — `/CRM`

Frontend **design preview** (PC-only) of the tradie CRM + website-assistant dashboard.
No backend: all data is mock (`data.js`). Built to be pixel-faithful to **shadcn/ui**
using Tailwind (CDN) + shadcn design tokens, with hand-built SVG charts in a
semantic colour palette. Ships as static files on the existing pipeline.

## Run
Open `index.html` in a browser (it pulls Tailwind + Lucide + Inter from CDNs), or
serve the folder. Deployed it lives at `/CRM`.

## Layout
- **Sidebar** (navy, grouped): Home · Work [Leads, Quotes, Jobs, Clients] · Money · Website [Chatbot, Stats] · Setup · Help
- **Home** — KPI tiles (earned / owed / leads / visits), money+traffic area chart, pipeline funnel + win-rate radial, this-week calendar, up-next + to-do + recent leads
- **Leads** — list ⇄ drag-and-drop pipeline (New→Contacted→Quoted→Won→Lost)
- **Quotes** — list + quote builder (line items, price-list, GST, PDF) in a slide-over
- **Jobs** — month calendar with status-coloured job chips ⇄ list; job card sheet (photos, notes)
- **Money** — earned/owed/overdue KPIs, invoices table with **Mark paid**, revenue-by-month bars
- **Clients** — table → client sheet with spend + history timeline
- **Chatbot** — standalone website-change assistant (thread + presets + live-preview). Not wired to any editor.
- **Stats** — visits over time, traffic-source donut, top-pages bars (fed by `events.ndjson` in real life)
- **Setup** — business details · branding · account (shared source of truth)

## Colour with intent
Neutral shell; brand **sky-cyan** accent; semantic palette reserved for KPIs / status / charts:
green = money-in/paid/won/done · amber = owed/in-progress · red = overdue/lost · sky = leads/new · violet = web traffic.

## Files
`index.html` (shell + tokens) · `styles.css` (shadcn tokens + components) ·
`data.js` (mock data) · `charts.js` (SVG charts) · `app.js` (router, views, interactions).

## Not built yet (deferred)
Auto lead sources (SMS/email/forms), real persistence, Xero/payments, mobile layout,
real shadcn-React migration. Leads are manual-entry for now.
