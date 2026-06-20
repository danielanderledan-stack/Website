/* ============================================================================
   apply-migration — local seed of the updater engine. Applies ONE migration to
   a customer site repo, page by page, behind an ADDITIVE integrity gate:
   stripping the migration's `addedSelector` from the output must leave content
   identical to the original — so the migration only ADDS its new section and
   touches nothing else. Also verifies clamp/min/max + data-cd + JSON-LD are
   conserved (original + the new section's own). Exits non-zero on any failure.

   Usage:
     NODE_PATH=<electro-design>/node_modules \
       node apply-migration.cjs <repoDir> <migrationFile> '<siteCtxJson>'
   e.g. siteCtxJson = {"coordinates":{"latitude":-38.0,"longitude":145.2}}
   ============================================================================ */
"use strict";

const fs = require("fs");
const path = require("path");
const { JSDOM } = require("jsdom");
const { serializeDoc, protectClamps, restoreClamps } = require("./serialize-doc.cjs");

const [, , repoDir, migFile, ctxJson] = process.argv;
if (!repoDir || !migFile) { console.error("usage: apply-migration.cjs <repoDir> <migrationFile> '<siteCtxJson>'"); process.exit(2); }
const mig = require(path.resolve(migFile));
const siteCtx = ctxJson ? JSON.parse(ctxJson) : {};

const count = (s, sub) => s.split(sub).length - 1;
const contentSig = (html) => new JSDOM(html).window.document.body.textContent.replace(/\s+/g, "");
function strippedSig(html, sel) {
  const dom = new JSDOM(html);
  dom.window.document.querySelectorAll(sel).forEach((n) => n.remove());
  return dom.window.document.body.textContent.replace(/\s+/g, "");
}

let ok = 0, failed = 0, changed = 0;
const report = [];

for (const t of mig.targets) {
  const file = path.join(repoDir, t.file);
  if (!fs.existsSync(file)) { report.push(`MISS  ${t.file} (not in repo)`); continue; }
  const original = fs.readFileSync(file, "utf8");
  try {
    const { html: prot, map } = protectClamps(original);
    const dom = new JSDOM(prot);
    const added = mig.apply(dom.window.document, t.route, siteCtx);
    if (!added) { report.push(`SKIP  ${t.file} (already present / no-op)`); continue; }
    const out = restoreClamps(serializeDoc(dom.window.document), map);

    const checks = [];
    // ADDITIVE gate: the page minus the new section(s) must equal the original
    if (strippedSig(out, mig.addedSelector) !== contentSig(original)) checks.push("existing content changed");
    // structural conservation: a clean strip removes exactly the new section
    const stripCount = (html) => { const d = new JSDOM(html); d.window.document.querySelectorAll(mig.addedSelector).forEach((n) => n.remove()); return d.window.document.documentElement.outerHTML; };
    const outStripped = stripCount(out), origStripped = original;
    for (const fn of ["clamp(", "min(", "max("]) {
      if (count(outStripped, fn) !== count(origStripped, fn)) checks.push(`${fn} drift after strip`);
    }
    if (count(outStripped, "data-cd=") !== count(origStripped, "data-cd=")) checks.push("data-cd drift after strip");
    if (count(out, "application/ld+json") !== count(original, "application/ld+json")) checks.push("ld+json count changed");
    for (const m of out.matchAll(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/g)) {
      try { JSON.parse(m[1].trim()); } catch (e) { checks.push("ld+json unparseable"); break; }
    }

    if (checks.length) { report.push(`FAIL  ${t.file} :: ${checks.join("; ")}`); failed++; continue; }
    fs.writeFileSync(file, out);
    report.push(`OK    ${t.file} (+${added} ${mig.addedSelector})`);
    ok++; changed += added;
  } catch (e) { report.push(`ERROR ${t.file} :: ${e.message}`); failed++; }
}

console.log(report.join("\n"));
console.log(`\nSUMMARY ${repoDir} [${mig.id}]: ok=${ok} failed=${failed} changed=${changed}`);
process.exit(failed > 0 ? 1 : 0);
