/* Local test for blog-ops.cjs against a clone of SAFE-ROOF-RESTORATION.
   Usage: NODE_PATH=<...>/node_modules node prerender/test-blog-ops.cjs /tmp/sr-test
   Asserts: new post page valid, new card added, sitemap entry added,
   and every OTHER existing file is byte-identical. */
"use strict";
const fs = require("fs");
const path = require("path");
const { JSDOM } = require("jsdom");
const { applyCreateBlogPost, applyDeleteBlogPost } = require("./blog-ops.cjs");

const REPO = process.argv[2] || "/tmp/sr-test";
const read = (p) => fs.readFileSync(path.join(REPO, p), "utf8");

let fails = 0;
const ok = (c, m) => {
  console.log((c ? "PASS" : "FAIL") + " — " + m);
  if (!c) fails++;
};

// enumerate existing posts
const blogDir = path.join(REPO, "blog");
const existing = fs
  .readdirSync(blogDir)
  .filter(
    (d) =>
      /^\d+$/.test(d) && fs.existsSync(path.join(blogDir, d, "index.html")),
  )
  .map((d) => "blog/" + d + "/index.html");
console.log("Existing posts:", existing.join(", "));

const blogIndexBefore = read("blog/index.html");
const sitemapBefore = read("sitemap.xml");
const post1Before = read("blog/1/index.html");

const res = applyCreateBlogPost({
  blogIndex: { path: "blog/index.html", content: blogIndexBefore },
  sample: { path: "blog/1/index.html", content: post1Before },
  sitemap: { path: "sitemap.xml", content: sitemapBefore },
  existing,
  title: "Roof Ventilation Tips for Dandenong Homes",
  JSDOM,
});

console.log("\n--- create result ---");
console.log(
  "num:",
  res.num,
  "| url:",
  res.url,
  "| card:",
  res.cardAppended,
  "| sitemap:",
  res.sitemapAppended,
);
console.log("notes:", JSON.stringify(res.notes));
console.log(
  "files:",
  res.files.map((f) => f.path + (f.isNew ? " (new)" : " (edit)")).join(", "),
);

ok(res.ok, "create returned ok");
ok(res.num === 5, "next post number is 5 (max 4 + 1)");
ok(res.cardAppended, "listing card appended");
ok(res.sitemapAppended, "sitemap entry appended");

const newPost = res.files.find((f) => f.path === "blog/5/index.html");
ok(!!newPost, "new post file blog/5/index.html present");

// validate the new post page parses + has the right head/body
const ndom = new JSDOM(newPost.content);
const ndoc = ndom.window.document;
ok(
  /Roof Ventilation Tips/.test(ndoc.querySelector("title").textContent),
  "new title set in <title>",
);
ok(
  ndoc
    .querySelector('link[rel="canonical"]')
    .getAttribute("href")
    .endsWith("/blog/5/"),
  "canonical -> /blog/5/",
);
ok(
  ndoc
    .querySelector('meta[property="og:url"]')
    .getAttribute("content")
    .endsWith("/blog/5/"),
  "og:url -> /blog/5/",
);
ok(
  ndoc.querySelector('[data-ce="s0-h1-1"]').textContent.trim() ===
    "Roof Ventilation Tips for Dandenong Homes",
  "H1 set to new title",
);
const bodyParas = ndoc.querySelectorAll('[data-ce^="s1-p-"]');
ok(
  bodyParas.length === 1,
  "body collapsed to a single placeholder paragraph (got " +
    bodyParas.length +
    ")",
);
ok(
  /Write your article here/.test(bodyParas[0] ? bodyParas[0].textContent : ""),
  "placeholder body text present",
);
ok(
  ndoc.querySelector('[data-ce="s1-img-1"]') !== null,
  "feature image preserved + data-ce intact",
);
ok(
  ndoc.querySelectorAll("[data-ce]").length >= 4,
  "new page is data-ce tagged (editable)",
);
ok(
  /<!DOCTYPE html>/i.test(newPost.content) && /<\/html>/i.test(newPost.content),
  "new page is a complete document",
);

// validate the listing card
const newIndex = res.files.find((f) => f.path === "blog/index.html").content;
ok(newIndex.indexOf('href="/blog/5/"') !== -1, "listing has href=/blog/5/");
const idom = new JSDOM(newIndex);
const cards = idom.window.document.querySelectorAll("a.blog-card");
ok(cards.length === 5, "listing now has 5 cards (was 4)");
ok(
  cards[0].getAttribute("href") === "/blog/5/",
  "new card is FIRST in the grid",
);
ok(
  /Roof Ventilation Tips/.test(cards[0].textContent),
  "new card shows new title",
);
// data-ce ids on the listing page must all be unique
const ceIds = Array.prototype.map.call(
  newIndex.match(/data-ce="[^"]+"/g) || [],
  (s) => s,
);
ok(
  ceIds.length === new Set(ceIds).size,
  "all data-ce ids on listing remain unique",
);

// validate the sitemap
const newSitemap = res.files.find((f) => f.path === "sitemap.xml").content;
ok(/\/blog\/5\/<\/loc>/.test(newSitemap), "sitemap has /blog/5/ entry");
ok(
  (newSitemap.match(/<url>/g) || []).length ===
    (sitemapBefore.match(/<url>/g) || []).length + 1,
  "sitemap gained exactly one <url>",
);
ok(
  /^<\?xml/.test(newSitemap) && /<\/urlset>\s*$/.test(newSitemap),
  "sitemap still well-formed",
);

// CRITICAL: every existing post page is byte-UNCHANGED
let unchanged = true;
for (const p of existing) {
  if (read(p) !== read(p)) unchanged = false; // sanity
}
ok(
  post1Before === read("blog/1/index.html"),
  "blog/1 source on disk untouched (we never wrote it)",
);
// The function must not have returned any existing post page as a changed file:
const touchedPosts = res.files.filter((f) =>
  /^blog\/[1-4]\/index\.html$/.test(f.path),
);
ok(
  touchedPosts.length === 0,
  "no existing post page (1-4) returned as changed",
);

// blog/index.html diff is ONLY the inserted card (existing card substrings still present, in order)
ok(
  newIndex.indexOf('href="/blog/1/"') !== -1 &&
    newIndex.indexOf('href="/blog/4/"') !== -1,
  "all original cards still present in listing",
);
ok(newIndex.length > blogIndexBefore.length, "listing grew (card inserted)");

// Rigorous: the change is a PURE INSERTION — common prefix + common suffix
// reconstruct the original byte-for-byte (no existing byte mutated).
function pureInsertion(before, after) {
  let i = 0;
  while (i < before.length && i < after.length && before[i] === after[i]) i++;
  let j = 0;
  while (
    j < before.length - i &&
    j < after.length - i &&
    before[before.length - 1 - j] === after[after.length - 1 - j]
  )
    j++;
  return {
    ok: after.slice(0, i) + after.slice(after.length - j) === before,
    inserted: after.length - i - j,
  };
}
const insIdx = pureInsertion(blogIndexBefore, newIndex);
ok(
  insIdx.ok,
  "blog/index.html change is a PURE insertion (" +
    insIdx.inserted +
    " bytes, 0 deletions)",
);
const insSm = pureInsertion(sitemapBefore, newSitemap);
ok(
  insSm.ok,
  "sitemap.xml change is a PURE insertion (" +
    insSm.inserted +
    " bytes, 0 deletions)",
);

// idempotency-ish: a SECOND create (now with 5 existing) should make 6, not collide
const existing2 = existing.concat(["blog/5/index.html"]);
const res2 = applyCreateBlogPost({
  blogIndex: { path: "blog/index.html", content: newIndex },
  sample: { path: "blog/1/index.html", content: post1Before },
  sitemap: { path: "sitemap.xml", content: newSitemap },
  existing: existing2,
  title: "Second new post",
  JSDOM,
});
ok(res2.num === 6, "second create yields num 6");
const idom2 = new JSDOM(
  res2.files.find((f) => f.path === "blog/index.html").content,
);
const ceIds2 = Array.prototype.map.call(
  res2.files
    .find((f) => f.path === "blog/index.html")
    .content.match(/data-ce="[^"]+"/g) || [],
  (s) => s,
);
ok(
  ceIds2.length === new Set(ceIds2).size,
  "data-ce ids still unique after a second card",
);

// delete round-trip
const del = applyDeleteBlogPost({
  num: 5,
  blogIndex: { path: "blog/index.html", content: newIndex },
  sitemap: { path: "sitemap.xml", content: newSitemap },
});
const delIndex = del.files.find((f) => f.path === "blog/index.html");
const delSitemap = del.files.find((f) => f.path === "sitemap.xml");
ok(
  delIndex && delIndex.content.indexOf('href="/blog/5/"') === -1,
  "delete removed the listing card",
);
ok(
  delSitemap && !/\/blog\/5\/<\/loc>/.test(delSitemap.content),
  "delete removed the sitemap entry",
);
ok(
  del.deletePaths && del.deletePaths[0] === "blog/5/index.html",
  "delete returns the page path to remove",
);
// deleting then re-adding the card should round-trip the listing back to original
ok(
  delIndex.content === blogIndexBefore,
  "delete after create restores blog/index.html byte-for-byte",
);

// write the new page out so we can eyeball / screenshot it
fs.mkdirSync(path.join(REPO, "blog", "5"), { recursive: true });
fs.writeFileSync(path.join(REPO, "blog", "5", "index.html"), newPost.content);
fs.writeFileSync(path.join(REPO, "blog", "index.html"), newIndex);
console.log(
  "\nWrote blog/5/index.html + updated blog/index.html into the clone for inspection.",
);

console.log("\n" + (fails === 0 ? "ALL PASS" : fails + " FAILURE(S)"));
process.exit(fails ? 1 : 0);
