/* ============================================================================
   add-backlink.cjs — retrofit the "Website by Complete Digital" footer
   backlink onto already-deployed (fused) customer sites.

   String-surgical (NOT a jsdom re-serialize) so the diff is one line per page
   and the existing pretty-printed HTML is left untouched. Idempotent.

   The injected markup MUST stay byte-identical to what fuse.cjs bakes into
   new sites (see CREDIT_* constants in prerender/fuse.cjs).

   Usage:
     node prerender/add-backlink.cjs <dir> [--write]
       <dir>     a checked-out site repo (or any folder of fused *.html)
       --write   actually rewrite files; omit for a dry run (default)
   ========================================================================= */
"use strict";
const fs = require("fs");
const path = require("path");

const HREF = "https://completedigital.org";
const TEXT = "Website by Complete Digital";
const TITLE = "Website by Complete Digital — Melbourne web design &amp; SEO";
const STYLE =
  "color: inherit; text-decoration: underline; text-underline-offset: 2px;";

/* exactly what fuse.cjs's serializer emits, prefixed with the "  ·  " sep */
const ANCHOR =
  '  ·  <a class="cd-credit" href="' +
  HREF +
  '" title="' +
  TITLE +
  '" style="' +
  STYLE +
  '">' +
  TEXT +
  "</a>";

/* the footer credit line: a <p> whose inline style carries both
   `font-size: 12px` and `text-align: center` (the newsletter <p> is 11px, so
   this combination is unique to the bottom-bar business-name line). */
const CREDIT_P =
  /<p\b[^>]*font-size:\s*12px[^>]*text-align:\s*center[^>]*>([\s\S]*?)<\/p>/g;

function walk(dir, out) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    if (e.name === ".git" || e.name === "node_modules") continue;
    const p = path.join(dir, e.name);
    if (e.isDirectory()) walk(p, out);
    else if (e.isFile() && e.name.endsWith(".html")) out.push(p);
  }
  return out;
}

function injectOne(html) {
  if (html.includes(HREF)) return { status: "skip-present", html };
  const matches = html.match(CREDIT_P);
  if (!matches) return { status: "no-credit-line", html };
  if (matches.length > 1) return { status: "ambiguous", html };
  const next = html.replace(
    CREDIT_P,
    (m, inner) => m.slice(0, m.length - "</p>".length) + ANCHOR + "</p>",
  );
  return { status: "injected", html: next };
}

function main() {
  const args = process.argv.slice(2);
  const write = args.includes("--write");
  const dir = args.find((a) => !a.startsWith("--"));
  if (!dir) {
    console.error("usage: node prerender/add-backlink.cjs <dir> [--write]");
    process.exit(2);
  }
  const files = walk(path.resolve(dir), []);
  const tally = {};
  for (const f of files) {
    const html = fs.readFileSync(f, "utf8");
    const r = injectOne(html);
    tally[r.status] = (tally[r.status] || 0) + 1;
    const rel = path.relative(dir, f);
    if (r.status === "injected") {
      if (write) fs.writeFileSync(f, r.html);
      console.log((write ? "WROTE   " : "WOULD   ") + rel);
    } else if (r.status !== "skip-present") {
      console.log(r.status.toUpperCase().padEnd(8) + rel);
    }
  }
  console.log(
    "\n" +
      (write ? "[write] " : "[dry run] ") +
      dir +
      "  →  " +
      JSON.stringify(tally),
  );
  /* non-zero exit if any page couldn't be handled, so callers can halt */
  if (tally["no-credit-line"] || tally["ambiguous"]) process.exit(1);
}

main();
