/* ============================================================================
   run-tag-icons — apply the tag-icons migration to a customer site repo, page
   by page, behind an ADDITIVE-ATTRIBUTES-ONLY integrity gate.

   The tag-icons migration only ADDS `data-ce*` attributes to existing <svg>
   icons (no new section). So the gate can't be "strip a selector"; instead it
   strips EVERY data-ce(-cap|-label)? attribute from both the migrated output and
   the original, EOL-normalises, and requires the two to be byte-identical. If
   they match, the ONLY thing the migration changed was added data-ce* attrs.

   On top of that it verifies, per page:
     - every data-ce id NEWLY added matches /^s\d+-icon-\d+$/ (no s{n}-text or
       nav-* id disturbed, no stray non-icon ce introduced)
     - no existing data-ce id removed
     - clamp()/min()/max() counts unchanged
     - data-cd count unchanged
     - visible textContent (whitespace-insensitive) unchanged
     - JSON-LD count unchanged and still parses

   Fail-closed: a failing page is NEVER written and the process exits non-zero,
   so a worker will not commit a partially/incorrectly migrated site.

   Usage:
     NODE_PATH=<electro-design>/node_modules \
       node run-tag-icons.cjs <repoDir> [--check]
   --check = dry run (gate only, write nothing).
   ============================================================================ */
"use strict";

const fs = require("fs");
const path = require("path");
const { JSDOM } = require("jsdom");
const {
  serializeDoc,
  protectClamps,
  restoreClamps,
} = require("./serialize-doc.cjs");

const repoDir = process.argv[2];
const dryRun = process.argv.includes("--check");
if (!repoDir) {
  console.error("usage: run-tag-icons.cjs <repoDir> [--check]");
  process.exit(2);
}

const mig = require("./migrations/tag-icons.cjs");

const count = (s, sub) => s.split(sub).length - 1;
const norm = (s) => String(s).replace(/\r\n/g, "\n");
// strip every data-ce / data-ce-cap / data-ce-label attribute (and any leading
// space) so two HTML strings can be compared ignoring ALL editing refs.
const stripCe = (html) =>
  norm(html).replace(/\s+data-ce(?:-cap|-label)?="[^"]*"/g, "");
const contentSig = (html) =>
  new JSDOM(html).window.document.body.textContent.replace(/\s+/g, "");
const ceIds = (html) => {
  const set = new Set();
  for (const m of String(html).matchAll(/\sdata-ce="([^"]*)"/g)) set.add(m[1]);
  return set;
};

// Resolve ALL pages of the site.
const targets =
  typeof mig.targets === "function"
    ? mig.targets(repoDir)
    : mig.discoverTargets
      ? mig.discoverTargets(repoDir)
      : mig.targets;

let ok = 0,
  skipped = 0,
  failed = 0,
  totalCe = 0;
const report = [];

for (const t of targets) {
  const file = path.join(repoDir, t.file);
  if (!fs.existsSync(file)) {
    report.push(`MISS  ${t.file} (not in repo)`);
    continue;
  }
  const original = fs.readFileSync(file, "utf8");

  try {
    const { html: prot, map } = protectClamps(original);
    const dom = new JSDOM(prot);
    const added = mig.apply(dom.window.document, t.route, {});
    if (!added) {
      report.push(`SKIP  ${t.file} (no card icons / already tagged)`);
      skipped++;
      continue;
    }
    const out = restoreClamps(serializeDoc(dom.window.document), map);

    const checks = [];

    // (1) PRIMARY additive-attrs-only gate: with ALL data-ce* attrs stripped,
    //     migrated output must be byte-identical (EOL-normalised) to the original.
    if (stripCe(out) !== stripCe(original))
      checks.push("non-data-ce change detected");

    // (2) every NEWLY added data-ce id must match the icon id pattern; no
    //     existing id (s{n}-text or nav-*) may be removed.
    const before = ceIds(original),
      after = ceIds(out);
    const addedIds = [...after].filter((id) => !before.has(id));
    const removedIds = [...before].filter((id) => !after.has(id));
    const strayAdded = addedIds.filter((id) => !mig.idPattern.test(id));
    if (strayAdded.length)
      checks.push("non-icon ids added: " + strayAdded.join(","));
    if (removedIds.length)
      checks.push("existing ids removed: " + removedIds.join(","));

    // (3) structural conservation
    if (contentSig(original) !== contentSig(out))
      checks.push("visible text changed");
    for (const fn of ["clamp(", "min(", "max("]) {
      if (count(out, fn) !== count(original, fn))
        checks.push(`${fn} ${count(original, fn)}->${count(out, fn)}`);
    }
    if (count(out, "data-cd=") !== count(original, "data-cd="))
      checks.push(
        `data-cd ${count(original, "data-cd=")}->${count(out, "data-cd=")}`,
      );
    if (
      count(out, "application/ld+json") !==
      count(original, "application/ld+json")
    )
      checks.push("ld+json count changed");
    for (const m of out.matchAll(
      /<script type="application\/ld\+json">([\s\S]*?)<\/script>/g,
    )) {
      try {
        JSON.parse(m[1].trim());
      } catch (e) {
        checks.push("ld+json unparseable");
        break;
      }
    }

    if (checks.length) {
      report.push(`FAIL  ${t.file} :: ${checks.join("; ")}`);
      failed++;
      continue;
    }

    if (!dryRun) fs.writeFileSync(file, out);
    totalCe += addedIds.length;
    report.push(
      `${dryRun ? "CHECK" : "OK   "} ${t.file} (+${addedIds.length} icon : ${addedIds.join(",")})`,
    );
    ok++;
  } catch (e) {
    report.push(`ERROR ${t.file} :: ${e.message}`);
    failed++;
  }
}

console.log(report.join("\n"));
console.log(
  `\nSUMMARY ${repoDir} [${mig.id}]${dryRun ? " (dry-run)" : ""}: ok=${ok} skipped=${skipped} failed=${failed} added_icon_ce=${totalCe}`,
);
process.exit(failed > 0 ? 1 : 0);
