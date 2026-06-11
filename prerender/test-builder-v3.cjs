/* E2E of the LIVE v3 builder: sidebar presets, blog preset (NEWFILE), free
   question, mobile drawer. */
"use strict";
const path = require("path");
const { chromium } = require("playwright-core");

(async () => {
  const browser = await chromium.launch();
  const page = await browser.newPage({
    viewport: { width: 1280, height: 850 },
  });
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));

  await page.goto("https://www.completedigital.org/website-builder/", {
    waitUntil: "load",
  });
  await page.evaluate(() => localStorage.clear());
  await page.reload({ waitUntil: "load" });

  await page.fill("#loginNumber", "0400111222");
  await page.fill("#loginPassword", "claude-test-pw");
  await page.click("#loginGo");
  await page.waitForSelector("#composer:not([hidden])", { timeout: 30000 });
  console.log(
    "login ok, balance:",
    await page.locator("#balance").textContent(),
  );
  console.log("sidebar tiles:", await page.locator(".tile").count());

  // free question on the new flow
  await page.fill(
    "#input",
    "whats the cheapest way to get more enquiries from the site?",
  );
  await page.click("#send");
  await page.waitForFunction(() => !document.querySelector(".typing"), null, {
    timeout: 240000,
  });
  console.log(
    "free Q reply:",
    (await page.locator(".row.ai .bubble").last().textContent()).slice(0, 140),
  );
  console.log(
    "balance after free Q:",
    await page.locator("#balance").textContent(),
  );

  // blog preset (NEWFILE path) — the big one
  await page.fill(
    "#blogTopic",
    "how to tell when your shower needs recaulking",
  );
  await page.click('button[data-preset="blog"]');
  console.log(
    "preset bubble shown:",
    (await page.locator(".preset-tag").count()) >= 1,
  );
  await page.waitForFunction(() => !document.querySelector(".typing"), null, {
    timeout: 300000,
  });
  console.log(
    "blog reply:",
    (await page.locator(".row.ai .bubble").last().textContent()).slice(0, 180),
  );
  console.log(
    "balance after blog:",
    await page.locator("#balance").textContent(),
  );

  await page.screenshot({
    path: path.join(__dirname, "shots", "builder-v3.png"),
  });

  // mobile drawer
  await page.setViewportSize({ width: 390, height: 800 });
  await page.click("#menuBtn");
  await page.waitForTimeout(400);
  const open = await page.evaluate(() =>
    document.getElementById("sidebar").classList.contains("open"),
  );
  console.log("mobile drawer opens:", open);
  await page.screenshot({
    path: path.join(__dirname, "shots", "builder-v3-mobile.png"),
  });

  console.log("JS errors:", errors.length ? errors : "none");
  await browser.close();
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
