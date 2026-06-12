/* Smoke test for the /sites/ "get it running" funnel.
   Serves the repo root with the /sites/:path* rewrite, stubs the
   provisioning webhook (never hits the real n8n), and walks:
   FYI popup -> dismiss -> 3s -> Get it running -> progress overlay
   -> mock credentials. */
const http = require("http");
const fs = require("fs");
const path = require("path");
const { chromium } = require("playwright");

const ROOT = path.join(__dirname, "..");
const HOOK =
  "https://n8n-production-d02c.up.railway.app/webhook/6f32b0a5-4c51-49b2-bad6-f8e5150a8cbd";
const MIME = {
  ".html": "text/html",
  ".json": "application/json",
  ".js": "text/javascript",
  ".css": "text/css",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".svg": "image/svg+xml",
};

const server = http.createServer((req, res) => {
  let p = decodeURIComponent(req.url.split("?")[0]);
  let file = path.join(ROOT, p);
  if (!fs.existsSync(file) || fs.statSync(file).isDirectory()) {
    if (p.startsWith("/sites/")) file = path.join(ROOT, "sites", "index.html");
    else {
      res.writeHead(404);
      return res.end("nf");
    }
  }
  res.writeHead(200, {
    "Content-Type": MIME[path.extname(file)] || "application/octet-stream",
  });
  fs.createReadStream(file).pipe(res);
});

(async () => {
  await new Promise((r) => server.listen(8931, r));
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
  const fails = [];
  const ok = (name, cond) => {
    console.log((cond ? "PASS" : "FAIL") + "  " + name);
    if (!cond) fails.push(name);
  };

  // Stub the webhook so it is never actually executed.
  await page.route(HOOK, async (route) => {
    await new Promise((r) => setTimeout(r, 7000));
    await route.fulfill({
      contentType: "application/json",
      body: JSON.stringify({
        username: "hvac-expert",
        password: "Test1234!",
        dashboard: "https://www.completedigital.org/visual-editor/?s=hvac",
      }),
    });
  });
  let webhookHit = false;
  page.on("request", (r) => {
    if (r.url() === HOOK) webhookHit = true;
  });

  await page.goto("http://localhost:8931/sites/hvac-expert-in-melbourne", {
    waitUntil: "load",
    timeout: 30000,
  });
  await page.waitForTimeout(2500); // loader screen

  // 1. FYI popup with new copy
  const fyi = await page.evaluate(() => {
    const el = document.getElementById("cd-fyi");
    return el ? el.innerText : "";
  });
  ok("FYI popup shown", !!fyi);
  ok("FYI mentions dashboard", /dashboard/i.test(fyi));
  ok("FYI has YES IT'S FREE", /YES, IT.S FREE/i.test(fyi));
  const dashHref = await page.getAttribute("#cd-fyi-dash", "href");
  ok(
    "See-the-dashboard links to /dashboard",
    dashHref === "https://www.completedigital.org/dashboard",
  );
  await page.screenshot({ path: "prerender/shots/funnel-fyi.png" });

  // 2. Dismiss via "See the website"
  await page.click("#cd-fyi-go");
  await page.waitForTimeout(500);
  ok(
    "FYI closed",
    await page.evaluate(() => !document.getElementById("cd-fyi")),
  );
  ok(
    "run prompt not yet shown",
    await page.evaluate(() => !document.getElementById("cd-run")),
  );

  // 3. Get-it-running prompt appears ~3s later
  await page.waitForTimeout(3200);
  ok(
    "run prompt shown after 3s",
    await page.evaluate(() => {
      const el = document.getElementById("cd-run");
      return !!el && getComputedStyle(el).opacity === "1";
    }),
  );
  await page.screenshot({ path: "prerender/shots/funnel-run-prompt.png" });

  // 4. Click it -> progress overlay
  await page.click("#cd-run-go");
  await page.waitForTimeout(1200);
  ok(
    "progress overlay shown",
    await page.evaluate(() => !!document.getElementById("cd-run-ov")),
  );
  ok("webhook POSTed (stubbed)", webhookHit);
  const w1 = await page.evaluate(
    () => document.getElementById("cd-run-bar").style.width,
  );
  await page.waitForTimeout(4000);
  const w2 = await page.evaluate(
    () => document.getElementById("cd-run-bar").style.width,
  );
  ok(
    "bar progresses (" + w1 + " -> " + w2 + ")",
    parseFloat(w2) > parseFloat(w1),
  );
  const m = await page.evaluate(
    () => document.getElementById("cd-run-msg").textContent,
  );
  ok("status message rotating ('" + m + "')", m.length > 3);
  await page.screenshot({ path: "prerender/shots/funnel-progress.png" });

  // 5. Stub responds at ~7s -> credentials
  await page.waitForTimeout(4500);
  const bodyTxt = await page.evaluate(
    () => document.getElementById("cd-run-body").innerText,
  );
  ok("username shown", bodyTxt.includes("hvac-expert"));
  ok("password shown", bodyTxt.includes("Test1234!"));
  const dash = await page.evaluate(() => {
    const a = document.querySelector("#cd-run-body a");
    return a ? a.href : "";
  });
  ok("dashboard link shown", dash.includes("visual-editor"));
  ok(
    "bar at 100%",
    await page.evaluate(
      () => document.getElementById("cd-run-bar").style.width === "100%",
    ),
  );
  await page.screenshot({ path: "prerender/shots/funnel-creds.png" });

  await browser.close();
  server.close();
  console.log(
    fails.length ? "\n" + fails.length + " FAILURE(S)" : "\nALL PASS",
  );
  process.exit(fails.length ? 1 : 0);
})();
