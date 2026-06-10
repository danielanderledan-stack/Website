/* Opens edit-ui.html in Chromium, sends a real message through the live
   n8n webhook, and verifies the reply renders. */
"use strict";
const path = require("path");
const http = require("http");
const fs = require("fs");
const { chromium } = require("playwright-core");

(async () => {
  const server = http
    .createServer((req, res) => {
      res.writeHead(200, { "Content-Type": "text/html" });
      res.end(fs.readFileSync(path.join(__dirname, "edit-ui.html")));
    })
    .listen(8151);

  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 900, height: 800 } });
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));

  await page.goto(
    "http://localhost:8151/?site=Premo-Caulking&token=cd-edit-9drx84kq2m&domain=https://example.com",
    { waitUntil: "load" },
  );
  await page.evaluate(() => localStorage.clear());
  await page.reload({ waitUntil: "load" });

  console.log("greeting shown:", (await page.locator(".row.ai").count()) === 1);

  await page.fill("#input", "Is my phone number shown on the contact page?");
  await page.click("#send");
  console.log(
    "typing indicator:",
    (await page.locator(".typing").count()) === 1,
  );

  await page.waitForFunction(
    () =>
      !document.querySelector(".typing") &&
      document.querySelectorAll(".row.ai").length >= 2,
    null,
    { timeout: 240000 },
  );
  const reply = await page.locator(".row.ai .bubble").last().textContent();
  console.log("REPLY:", reply.slice(0, 220));
  console.log(
    "user bubble kept:",
    (await page.locator(".row.user").count()) === 1,
  );
  console.log("JS errors:", errors.length ? errors : "none");

  // history persisted?
  const stored = await page.evaluate(
    () =>
      JSON.parse(localStorage.getItem("cd-edit-history-Premo-Caulking") || "[]")
        .length,
  );
  console.log("history entries stored:", stored);

  await page.screenshot({ path: path.join(__dirname, "shots", "edit-ui.png") });
  await browser.close();
  server.close();
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
