const { chromium } = require("playwright");
const path = require("path");
const root = path.resolve(__dirname, "..");
const url =
  "file:///" + path.join(root, "homepagetest1.html").replace(/\\/g, "/");
(async () => {
  const b = await chromium.launch();
  const c = await b.newContext({
    viewport: { width: 390, height: 780 },
    deviceScaleFactor: 2,
    isMobile: true,
  });
  const p = await c.newPage();
  await p.goto(url, { waitUntil: "networkidle" });
  await p.evaluate(() => window.scrollTo(0, 1400));
  await p.waitForTimeout(700);
  await p.screenshot({
    path: path.join(root, "shot-homepagetest1-mobile-callbar.png"),
  });
  const barVisible = await p.evaluate(() => {
    const el = document.querySelector(".callbar");
    return el ? getComputedStyle(el).display : "missing";
  });
  console.log("callbar display:", barVisible);
  await b.close();
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
