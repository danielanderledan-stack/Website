/* ============================================================================
   retrofit-site — bring an existing customer site repo up to current fuse
   output structure. Today that means stamping data-ce editing refs (idempotent),
   preserving everything else: clamp() sizing, JSON-LD, visible content, and
   fuse's exact formatting (so the git diff is ONLY the added attributes).

   Hard integrity gate per page: parse before & after, and refuse to write any
   page whose visible text changed, whose clamp()/data-cd counts drifted, or
   whose JSON-LD no longer parses. A failure aborts that file (never written)
   and makes the process exit non-zero so a worker will NOT commit a bad site.

   Usage: NODE_PATH=<electro-design>/node_modules node retrofit-site.cjs <repoDir>
   ============================================================================ */
"use strict";

const fs = require("fs");
const path = require("path");
const { JSDOM } = require("jsdom");
const { tagEditable } = require("./tag-editable.cjs");
const { serializeDoc, protectClamps, restoreClamps } = require("./serialize-doc.cjs");

const repoDir = process.argv[2];
if (!repoDir) { console.error("usage: retrofit-site.cjs <repoDir>"); process.exit(2); }

function walk(d) {
  return fs.readdirSync(d, { withFileTypes: true }).flatMap((e) => {
    if (e.name === ".git" || e.name === "node_modules") return [];
    const p = path.join(d, e.name);
    return e.isDirectory() ? walk(p) : (e.name.endsWith(".html") ? [p] : []);
  });
}

const count = (s, sub) => s.split(sub).length - 1;
// Visible-content fingerprint: textContent with ALL whitespace removed. This
// guarantees no character was added/dropped/reordered, while tolerating the
// inter-element whitespace that fuse's pretty-printer reflows around block/flex
// elements (e.g. the injected #cd-hours footer) — reflow that never renders.
const contentSig = (html) => new JSDOM(html).window.document.body.textContent.replace(/\s+/g, "");

let ok = 0, skipped = 0, failed = 0, totalCe = 0;
const report = [];

for (const file of walk(repoDir)) {
  const rel = path.relative(repoDir, file).replace(/\\/g, "/");
  const original = fs.readFileSync(file, "utf8");
  if (original.indexOf("data-ce=") >= 0) { report.push(`SKIP  ${rel} (already tagged)`); skipped++; continue; }

  try {
    const { html: protectedHtml, map } = protectClamps(original);
    const dom = new JSDOM(protectedHtml);
    const added = tagEditable(dom.window.document);
    const out = restoreClamps(serializeDoc(dom.window.document), map);

    const checks = [];
    if (!/^<!DOCTYPE html>/.test(out)) checks.push("missing doctype");
    if (contentSig(original) !== contentSig(out)) checks.push("visible text changed");
    for (const fn of ["clamp(", "min(", "max("]) {
      if (count(out, fn) !== count(original, fn)) checks.push(`${fn} ${count(original, fn)}->${count(out, fn)}`);
    }
    if (count(out, "data-cd=") !== count(original, "data-cd=")) checks.push(`data-cd ${count(original, "data-cd=")}->${count(out, "data-cd=")}`);
    if (count(out, "application/ld+json") !== count(original, "application/ld+json")) checks.push("ld+json count changed");
    for (const m of out.matchAll(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/g)) {
      try { JSON.parse(m[1].trim()); } catch (e) { checks.push("ld+json unparseable"); break; }
    }

    if (checks.length) { report.push(`FAIL  ${rel} :: ${checks.join("; ")}`); failed++; continue; }

    fs.writeFileSync(file, out);
    totalCe += added;
    report.push(`OK    ${rel} (+${added} data-ce)`);
    ok++;
  } catch (e) {
    report.push(`ERROR ${rel} :: ${e.message}`);
    failed++;
  }
}

console.log(report.join("\n"));
console.log(`\nSUMMARY ${repoDir}: ok=${ok} skipped=${skipped} failed=${failed} total_data_ce=${totalCe}`);
process.exit(failed > 0 ? 1 : 0);
