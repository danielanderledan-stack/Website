/* ============================================================================
   run-tag-split-cta-bolt — apply the tag-split-cta-bolt migration to a customer
   repo behind a fail-closed, ATTRS-ONLY integrity gate.

   The migration string-splices `data-ce="s1-icon-1" data-ce-cap="icon"
   data-ce-label="Icon"` onto the split-CTA bolt <svg> on index.html. The gate:

     (1) the output, with the inserted attribute string removed, must be byte-
         identical (EOL-normalised) to the original — i.e. the ONLY change is our
         three attributes on one tag;
     (2) the inserted id appears exactly once;
     (3) re-running is a no-op (idempotent): an already-tagged page is SKIP;
     (4) only index.html is read / written.

   Fail-closed: a failing repo is NEVER written and the process exits non-zero.

   Usage: node run-tag-split-cta-bolt.cjs <repoDir> [--check]
   ============================================================================ */
"use strict";

const fs = require("fs");
const path = require("path");

const mig = require("./migrations/tag-split-cta-bolt.cjs");

const repoDir = process.argv[2];
const dryRun = process.argv.includes("--check");
if (!repoDir) {
  console.error("usage: run-tag-split-cta-bolt.cjs <repoDir> [--check]");
  process.exit(2);
}

const norm = (s) => String(s).replace(/\r\n/g, "\n");
const htmlFile = path.join(repoDir, "index.html");
const report = [];
let failed = 0;

try {
  if (!fs.existsSync(htmlFile)) {
    console.error("FAIL  no index.html");
    process.exit(1);
  }
  const original = fs.readFileSync(htmlFile, "utf8");

  if (mig.isApplied(original)) {
    console.log("SKIP  index.html (bolt already tagged)");
    console.log(`\nSUMMARY ${repoDir} [${mig.id}]: ok=0 skipped=1 failed=0`);
    process.exit(0);
  }

  const { changed, html: out, reason } = mig.applyHtml(original);
  const checks = [];
  if (!changed) checks.push(reason || "no change");
  // (1) only-our-attrs gate
  if (changed && norm(out.split(mig.attrs).join("")) !== norm(original))
    checks.push("non-attr change detected");
  // (2) inserted id appears exactly once
  const idCount = (out.match(/data-ce="s1-icon-1"/g) || []).length;
  if (changed && idCount !== 1) checks.push(`id count ${idCount} (want 1)`);
  // (3) idempotency
  if (changed && mig.applyHtml(out).changed) checks.push("not idempotent");

  if (checks.length) {
    report.push(`FAIL  index.html :: ${checks.join("; ")}`);
    failed++;
  } else {
    if (!dryRun) fs.writeFileSync(htmlFile, out);
    report.push(`${dryRun ? "CHECK" : "OK   "} index.html (+bolt data-ce s1-icon-1)`);
  }
} catch (err) {
  report.push(`ERROR :: ${err.message}`);
  failed++;
}

console.log(report.join("\n"));
console.log(
  `\nSUMMARY ${repoDir} [${mig.id}]${dryRun ? " (dry-run)" : ""}: ok=${failed ? 0 : 1} skipped=0 failed=${failed}`,
);
process.exit(failed > 0 ? 1 : 0);
