/* E2E of the LIVE photo gallery: login, open gallery, count cards, swap one
   image, verify the repo commit. */
"use strict";
const path = require("path");
const { execFileSync } = require("child_process");
const { chromium } = require("playwright-core");

(async () => {
  const before = execFileSync(
    "gh",
    [
      "api",
      "repos/danielanderledan-stack/Premo-Caulking/contents/assets/uploads/1781116477950-0-team-photo.png",
      "-q",
      ".sha",
    ],
    { encoding: "utf8" },
  ).trim();

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

  await page.click("#openGallery");
  await page.waitForSelector(".gcard", { timeout: 60000 });
  const cards = await page.locator(".gcard").count();
  console.log("gallery cards:", cards);
  // thumbnails actually load?
  await page.waitForTimeout(2500);
  const loaded = await page.evaluate(
    () =>
      [...document.querySelectorAll(".gcard img")].filter(
        (i) => i.complete && i.naturalWidth > 0,
      ).length,
  );
  console.log("thumbnails loaded:", loaded, "/", cards);

  // swap the test upload image via the file chooser
  const target = page.locator(".gcard", {
    hasText: "1781116477950-0-team-photo.png",
  });
  const [chooser] = await Promise.all([
    page.waitForEvent("filechooser"),
    target.locator("button").click(),
  ]);
  // tiny green png
  const png = Buffer.from(
    "iVBORw0KGgoAAAANSUhEUgAAAAgAAAAICAYAAADED76LAAAAFUlEQVR4nGNk+M9AAmAaVT2qmlYAAH9kAgWN1f5SAAAAAElFTkSuQmCC",
    "base64",
  );
  const tmp = path.join(__dirname, "tmp-swap.png");
  require("fs").writeFileSync(tmp, png);
  await chooser.setFiles(tmp);

  await page.waitForFunction(
    () =>
      [...document.querySelectorAll(".gcard button")].some((b) =>
        b.textContent.includes("Swapped"),
      ),
    null,
    { timeout: 60000 },
  );
  console.log("UI shows swapped:", true);
  await page.waitForTimeout(1500);

  const after = execFileSync(
    "gh",
    [
      "api",
      "repos/danielanderledan-stack/Premo-Caulking/contents/assets/uploads/1781116477950-0-team-photo.png",
      "-q",
      ".sha",
    ],
    { encoding: "utf8" },
  ).trim();
  console.log("repo sha changed:", before !== after);
  console.log(
    "chat bubble:",
    (await page.locator(".row.ai .bubble").last().textContent()).slice(0, 80),
  );
  console.log("JS errors:", errors.length ? errors : "none");

  await page.screenshot({ path: path.join(__dirname, "shots", "gallery.png") });
  require("fs").unlinkSync(tmp);
  await browser.close();
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
