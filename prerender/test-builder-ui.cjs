/* E2E browser test of the LIVE /website-builder/: login, balance pill,
   send a (billed) message, top-up modal. */
"use strict";
const path = require("path");
const { chromium } = require("playwright-core");

(async () => {
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 900, height: 800 } });
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));

  await page.goto("https://www.completedigital.org/website-builder/", {
    waitUntil: "load",
  });
  await page.evaluate(() => localStorage.clear());
  await page.reload({ waitUntil: "load" });

  console.log(
    "login modal shown:",
    !(await page.locator("#loginOverlay").isHidden()),
  );

  // wrong password first
  await page.fill("#loginNumber", "0400111222");
  await page.fill("#loginPassword", "nope");
  await page.click("#loginGo");
  await page.waitForSelector("#loginErr", { state: "visible", timeout: 30000 });
  console.log(
    "wrong-password error:",
    (await page.locator("#loginErr").textContent()).trim(),
  );

  // correct login
  await page.fill("#loginPassword", "claude-test-pw");
  await page.click("#loginGo");
  await page.waitForSelector("#composer:not([hidden])", { timeout: 30000 });
  const bal0 = await page.locator("#balance").textContent();
  console.log("logged in, balance pill:", bal0);
  console.log("history restored bubbles:", await page.locator(".row").count());

  // top-up modal content
  await page.click("#topupBtn");
  console.log(
    "topup modal has Dan photo:",
    (await page.locator('.me img[src*="dan.jpg"]').count()) === 1,
  );
  console.log(
    "topup copy mentions cost:",
    (await page.locator(".me p").textContent()).includes("costs us real money"),
  );
  await page.click("#topupClose");

  // billed message
  await page.fill(
    "#input",
    "On the about page, change the mission statement to mention we are family-owned.",
  );
  await page.click("#send");
  await page.waitForFunction(
    () =>
      !document.querySelector(".typing") &&
      document.querySelectorAll(".row.ai").length >= 1 &&
      [...document.querySelectorAll(".row.ai .bubble")].some(
        (b) => b.textContent.length > 20,
      ),
    null,
    { timeout: 240000 },
  );
  const lastAi = await page.locator(".row.ai .bubble").last().textContent();
  console.log("AI reply:", lastAi.slice(0, 160));
  const bal1 = await page.locator("#balance").textContent();
  console.log("balance after message:", bal1, "(was", bal0 + ")");
  console.log("JS errors:", errors.length ? errors : "none");

  await page.screenshot({
    path: path.join(__dirname, "shots", "builder-ui.png"),
  });
  await browser.close();
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
