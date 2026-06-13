// Screenshot the redesigned homepage test pages (desktop + mobile) for review.
// Usage: node prerender/shoot-homepagetest.cjs [file]   (default homepagetest.html)
const { chromium } = require("playwright");
const path = require("path");

const file = process.argv[2] || "homepagetest.html";
const root = path.resolve(__dirname, "..");
const url = "file:///" + path.join(root, file).replace(/\\/g, "/");
const base = file.replace(/\.html$/, "");

(async () => {
  const browser = await chromium.launch();

  // Desktop
  const d = await browser.newContext({
    viewport: { width: 1280, height: 900 },
    deviceScaleFactor: 1,
  });
  const dp = await d.newPage();
  const t0 = Date.now();
  await dp.goto(url, { waitUntil: "networkidle" });
  const loadMs = Date.now() - t0;
  await dp.waitForTimeout(700);
  await dp.screenshot({
    path: path.join(root, `shot-${base}-desktop-top.png`),
  });
  await dp.screenshot({
    path: path.join(root, `shot-${base}-desktop-full.png`),
    fullPage: true,
  });

  // Click a trade chip to confirm interactivity, capture
  try {
    await dp.click('.chip[data-trade="plumber"]');
    await dp.waitForTimeout(300);
    await dp.screenshot({
      path: path.join(root, `shot-${base}-desktop-plumber.png`),
    });
  } catch (e) {
    console.log("chip click failed:", e.message);
  }

  // Mobile
  const m = await browser.newContext({
    viewport: { width: 390, height: 844 },
    deviceScaleFactor: 2,
    isMobile: true,
  });
  const mp = await m.newPage();
  await mp.goto(url, { waitUntil: "networkidle" });
  await mp.waitForTimeout(500);
  await mp.screenshot({ path: path.join(root, `shot-${base}-mobile-top.png`) });
  await mp.screenshot({
    path: path.join(root, `shot-${base}-mobile-full.png`),
    fullPage: true,
  });

  // Basic metrics
  const metrics = await dp.evaluate(() => {
    const imgs = document.querySelectorAll("img").length;
    const iframes = document.querySelectorAll("iframe").length;
    const scripts = document.querySelectorAll("script").length;
    const h1 = document.querySelector("h1")
      ? document.querySelector("h1").innerText
      : null;
    return {
      imgs,
      iframes,
      scripts,
      h1,
      html: document.documentElement.outerHTML.length,
    };
  });
  console.log(JSON.stringify({ file, loadMs, ...metrics }, null, 2));

  await browser.close();
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
