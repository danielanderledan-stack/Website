/* ============================================================================
   run-theme-extras — apply the theme-extras migration to a customer site repo
   behind a fail-closed, CSS-APPEND-ONLY integrity gate.

   The migration appends ONE fenced CSS block to assets/site.css (white split-CTA
   + themeable --color-bg page background). It touches NO HTML. The gate:

     (1) the migrated CSS, with our fenced block stripped, must be byte-identical
         (EOL-normalised) to the original — i.e. the ONLY change is our block;
     (2) the appended block must contain ONLY our three known selectors and no
         dangerous token (@import/url()/expression()/</style/javascript:);
     (3) re-running is a no-op (idempotent): an already-migrated site.css is SKIP;
     (4) no .html page is read or written — only assets/site.css.

   Fail-closed: a failing repo is NEVER written and the process exits non-zero.

   Usage:
     node run-theme-extras.cjs <repoDir> [--check]
   --check = dry run (gate only, write nothing).
   ============================================================================ */
"use strict";

const fs = require("fs");
const path = require("path");

const mig = require("./migrations/theme-extras.cjs");

const repoDir = process.argv[2];
const dryRun = process.argv.includes("--check");
if (!repoDir) {
  console.error("usage: run-theme-extras.cjs <repoDir> [--check]");
  process.exit(2);
}

const norm = (s) => String(s).replace(/\r\n/g, "\n");
function stripBlock(css) {
  const b = css.indexOf(mig.begin);
  if (b === -1) return norm(css);
  const e = css.indexOf(mig.end, b);
  if (e === -1) return norm(css);
  const end = e + mig.end.length;
  let start = b;
  if (css[start - 1] === "\n") start -= 1;
  let after = end;
  if (css[after] === "\n") after += 1;
  return norm(css.slice(0, start) + css.slice(after));
}

const cssFile = mig.cssPath(repoDir);
const report = [];
let failed = 0;

try {
  if (!fs.existsSync(cssFile)) {
    console.error(`FAIL  no site.css at ${path.relative(repoDir, cssFile)}`);
    process.exit(1);
  }
  const original = fs.readFileSync(cssFile, "utf8");

  if (mig.isApplied(original)) {
    console.log(`SKIP  ${path.relative(repoDir, cssFile)} (already has theme-extras)`);
    console.log(`\nSUMMARY ${repoDir} [${mig.id}]: ok=0 skipped=1 failed=0`);
    process.exit(0);
  }

  const { changed, css: out } = mig.applyCss(original);
  const checks = [];

  if (!changed) checks.push("migration reported no change");

  // (1) only-our-block gate
  if (stripBlock(out) !== norm(original))
    checks.push("non-fenced CSS change detected");

  // (2) block content gate: exactly our three selectors, nothing dangerous.
  const b = out.indexOf(mig.begin);
  const e = out.indexOf(mig.end);
  const block = e > b ? out.slice(b, e + mig.end.length) : "";
  if (!/\.split-cta-left\s*\{/.test(block))
    checks.push("block missing .split-cta-left rule");
  if (!/body\s*\{/.test(block)) checks.push("block missing body rule");
  if (!/section\[style\*="rgb\(255, 255, 255\)"\]\s*\{/.test(block))
    checks.push("block missing white-section rule");
  const ruleOpens = (block.match(/\{/g) || []).length;
  if (ruleOpens !== 3) checks.push(`block has ${ruleOpens} rules (want 3)`);
  if (/@import|url\s*\(|expression\s*\(|<\/style|javascript:/i.test(block))
    checks.push("block has disallowed token (@import/url/</style/etc.)");

  // (3) idempotency: re-applying the OUTPUT must be a no-op.
  if (mig.applyCss(out).changed) checks.push("not idempotent");

  if (checks.length) {
    report.push(`FAIL  site.css :: ${checks.join("; ")}`);
    failed++;
  } else {
    if (!dryRun) fs.writeFileSync(cssFile, out);
    report.push(
      `${dryRun ? "CHECK" : "OK   "} ${path.relative(repoDir, cssFile)} (+theme-extras, +${out.length - original.length} bytes)`,
    );
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
