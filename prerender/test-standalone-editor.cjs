/* Smoke test of the LIVE standalone editor page. */
"use strict";
const path = require("path");
const { chromium } = require("playwright-core");

(async () => {
  const browser = await chromium.launch();
  const page = await browser.newPage({
    viewport: { width: 1100, height: 800 },
  });
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));

  await page.goto("https://www.completedigital.org/visual-editor/", {
    waitUntil: "load",
  });
  await page.evaluate(() => localStorage.clear());
  await page.reload({ waitUntil: "load" });
  console.log("login shown:", await page.locator("#loginOverlay").isVisible());

  await page.fill("#loginNumber", "0400111222");
  await page.fill("#loginPassword", "claude-test-pw");
  await page.click("#loginGo");
  await page.waitForSelector("#editor:not([hidden])", { timeout: 30000 });
  console.log("site pill:", await page.locator("#siteLabel").textContent());

  await page.waitForSelector(".gcard", { timeout: 60000 });
  console.log("photos:", await page.locator(".gcard").count());

  await page.click('.vtab[data-tab="tabText"]');
  await page.waitForSelector(".trow", { timeout: 60000 });
  console.log("text rows:", await page.locator(".trow").count());

  await page.click('.vtab[data-tab="tabColours"]');
  console.log("colours tab:", await page.locator("#applyColours").isVisible());

  await page.screenshot({
    path: path.join(__dirname, "shots", "standalone-editor.png"),
  });

  // session restore on reload
  await page.reload({ waitUntil: "load" });
  await page.waitForSelector("#editor:not([hidden])", { timeout: 30000 });
  console.log("session restored on reload:", true);
  console.log("JS errors:", errors.length ? errors : "none");
  await browser.close();
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
