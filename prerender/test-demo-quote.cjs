/* Verify the cd-quote block in sites/index.html: serves the repo root with
   the vercel.json /sites/:path* -> /sites/index.html rewrite, then checks the
   loader, quote-only pricing page, home quote card, and contact-band CTAs. */
const { chromium } = require("playwright-core");
const http = require("http");
const fs = require("fs");
const path = require("path");

const ROOT = path.join(__dirname, "..");
const SLUG = "hvac-expert-in-melbourne";
const PORT = 8741;

const MIME = {
  ".html": "text/html",
  ".js": "text/javascript",
  ".css": "text/css",
  ".json": "application/json",
  ".jpg": "image/jpeg",
  ".png": "image/png",
  ".svg": "image/svg+xml",
};

const server = http.createServer((req, res) => {
  let p = decodeURIComponent(req.url.split("?")[0]);
  let file = path.join(ROOT, p);
  if (!fs.existsSync(file) || fs.statSync(file).isDirectory()) {
    if (p.startsWith("/sites/")) file = path.join(ROOT, "sites/index.html");
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
  await new Promise((r) => server.listen(PORT, r));
  const browser = await chromium.launch();
  const page = await browser.newPage();
  const errors = [];
  page.on("pageerror", (e) => errors.push("pageerror: " + e.message));
  page.on("console", (m) => {
    if (m.type() === "error") errors.push("console: " + m.text());
  });

  const results = [];
  const check = (name, ok) => {
    results.push((ok ? "PASS" : "FAIL") + "  " + name);
  };

  /* --- pricing page --- */
  await page.goto(`http://localhost:${PORT}/sites/${SLUG}/pricing`);
  const loaderSeen = await page
    .waitForSelector('[data-cd="loader"]', { timeout: 3000 })
    .then(() => true)
    .catch(() => false);
  check("loader appears", loaderSeen);
  const loaderGone = await page
    .waitForSelector('[data-cd="loader"]', { state: "detached", timeout: 9000 })
    .then(() => true)
    .catch(() => false);
  check("loader hides after load", loaderGone);
  await page.waitForSelector("#quote-only", { timeout: 8000 }).catch(() => {});
  check("quote-only section", !!(await page.$("#quote-only")));
  check(
    "discount-notify form",
    !!(await page.$('form[data-cd="discount-notify"]')),
  );
  check("call (tel:) CTA", !!(await page.$('#quote-only a[href^="tel:"]')));
  check("email CTA", !!(await page.$("#quote-only a.btn-outline")));
  const dollarTexts = await page.$$eval("#root main section", (secs) =>
    secs
      .filter(
        (s) => !["quote-only", "discount-notify", "contact"].includes(s.id),
      )
      .slice(1)
      .map((s) => s.id || s.className),
  );
  check(
    "price sections removed (only banner+quote+notify+contact left)",
    dollarTexts.length === 0,
  );

  /* dismiss the once-per-session FYI popup, then submit the discount form */
  const fyi = await page.$("#cd-fyi-go");
  if (fyi) {
    await fyi.click();
    await page
      .waitForSelector("#cd-fyi", { state: "detached", timeout: 3000 })
      .catch(() => {});
  }
  await page.fill('form[data-cd="discount-notify"] input', "0400000000");
  await page.click('form[data-cd="discount-notify"] button');
  await page.waitForTimeout(300);
  const confirmed = await page.$$eval("#discount-notify p", (ps) =>
    ps.some((p) => /let you know when a discount/i.test(p.textContent)),
  );
  check("discount form confirmation", confirmed);

  /* --- home page --- */
  await page.goto(`http://localhost:${PORT}/sites/${SLUG}`);
  await page.waitForSelector("#root main", { timeout: 8000 });
  await page.waitForTimeout(1500);
  const cardText = await page
    .$eval(".pricing-calc-card", (el) => el.textContent)
    .catch(() => "");
  check("home calc card -> quote card", /Get a Free Quote/.test(cardText));
  const rowVals = await page.$$eval(
    "#prices .price-row span:last-child",
    (sp) =>
      sp
        .filter((s) => !s.classList.contains("price-dots"))
        .map((s) => s.textContent),
  );
  check(
    "price rows say Quote only (" + rowVals.length + " rows)",
    rowVals.length > 0 && rowVals.every((v) => v === "Quote only"),
  );
  const bandCall = await page.$('#contact a[href^="tel:"]');
  check("contact band Call Now link", !!bandCall);
  const loaderHome = await page
    .waitForSelector('[data-cd="loader"]', { state: "detached", timeout: 9000 })
    .then(() => true)
    .catch(() => false);
  check("home loader hides", loaderHome);

  /* capture mode: no loader, transforms still applied */
  await page.goto(`http://localhost:${PORT}/sites/${SLUG}/pricing?capture=1`);
  await page.waitForTimeout(2500);
  check("capture mode: no loader", !(await page.$('[data-cd="loader"]')));
  check(
    "capture mode: quote-only still applied",
    !!(await page.$("#quote-only")),
  );

  await page.screenshot({
    path: path.join(__dirname, "shots", "demo-quote-pricing.png"),
    fullPage: false,
  });

  console.log(results.join("\n"));
  console.log(
    errors.length ? "\nERRORS:\n" + errors.join("\n") : "\nno page errors",
  );
  await browser.close();
  server.close();
  process.exit(
    results.some((r) => r.startsWith("FAIL")) || errors.length ? 1 : 0,
  );
})();
