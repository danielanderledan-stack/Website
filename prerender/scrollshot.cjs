const { chromium } = require("playwright");
const path = require("path");
const root = path.resolve(__dirname, "..");
const file = process.argv[2] || "homepagetest.html";
const base = file.replace(/\.html$/, "");
const secs = (process.argv[3] || "how,what,pricing,why,faq").split(",");
const url = "file:///" + path.join(root, file).replace(/\\/g, "/");
(async () => {
  const b = await chromium.launch();
  const c = await b.newContext({ viewport: { width: 1280, height: 900 } });
  const p = await c.newPage();
  await p.goto(url, { waitUntil: "networkidle" });
  for (const sec of secs) {
    await p.evaluate((s) => {
      const el = document.getElementById(s);
      if (el) el.scrollIntoView();
    }, sec);
    await p.waitForTimeout(700);
    await p.screenshot({ path: path.join(root, `shot-${base}-${sec}.png`) });
  }
  await b.close();
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
