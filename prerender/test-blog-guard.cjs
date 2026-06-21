/* Reproduce the live "Session expired" blog bug and prove the fix.
   Blog Guard runs as: Find Session Blog -> Get Blog Sitemap -> Blog Guard,
   so $input is the GitHub sitemap blob, NOT the session row. */
"use strict";

const sitemapXml =
  '<urlset><url><loc>https://x.com/blog/1/</loc></url>' +
  '<url><loc>https://x.com/blog/2/</loc></url></urlset>';
const sitemapBlob = { content: Buffer.from(sitemapXml, "utf8").toString("base64") };
const sessionRow = {
  id: 4,
  session_expiry: Date.now() + 5 * 86400e3,
  site: "safe-roof-restoration",
};

// n8n helpers as the runtime presents them to a Code node:
//   $input.first()      -> the node's INPUT item (here: Get Blog Sitemap)
//   $('NodeName').first()-> output of any named upstream node
const $input = { first: () => ({ json: sitemapBlob }) };
function makeRefs() {
  return {
    "Find Session Blog": { first: () => ({ json: sessionRow }) },
    "Get Blog Sitemap": { first: () => ({ json: sitemapBlob }) },
  };
}
function runGuard(sessionExpr) {
  const refs = makeRefs();
  const $ = (n) => refs[n];
  // ---- guard body (only the session source differs) ----
  const row = sessionExpr === "input" ? ($input.first().json || {}) : ($("Find Session Blog").first().json || {});
  const valid = row.id !== undefined && Number(row.session_expiry || 0) > Date.now();
  if (!valid) throw new Error("Session expired");
  if (!row.site) throw new Error("No website linked to this account");
  let existing = [];
  let sampleNum = 1;
  try {
    const sm = Buffer.from($("Get Blog Sitemap").first().json.content, "base64").toString("utf8");
    existing = [...sm.matchAll(/\/blog\/(\d+)\//g)].map((m) => "blog/" + m[1] + "/index.html");
    const nums = [...new Set([...sm.matchAll(/\/blog\/(\d+)\//g)].map((m) => +m[1]))];
    if (nums.length) sampleNum = Math.min(...nums);
  } catch (e) {}
  return { site: row.site, existing, sampleNum, samplePath: "blog/" + sampleNum + "/index.html" };
}

// 1) OLD behaviour ($input) must reproduce the live failure
let reproduced = false;
try { runGuard("input"); } catch (e) { reproduced = e.message === "Session expired"; }
console.log(reproduced ? "PASS  old code throws 'Session expired' (bug reproduced)"
                       : "FAIL  old code did NOT reproduce the bug");

// 2) FIXED behaviour (named session node) must succeed with the right shape
let out, ok = false;
try {
  out = runGuard("named");
  ok = out.site === "safe-roof-restoration" &&
       out.sampleNum === 1 &&
       out.samplePath === "blog/1/index.html" &&
       out.existing.length === 2;
} catch (e) { out = "THREW: " + e.message; }
console.log(ok ? "PASS  fixed code returns " + JSON.stringify(out)
               : "FAIL  fixed code wrong: " + JSON.stringify(out));

process.exit(reproduced && ok ? 0 : 1);
