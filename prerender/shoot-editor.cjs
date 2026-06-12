/* Capture populated screenshots of the visual editor for the /dashboard
   showcase page. Mocks the builder-auth webhook entirely — nothing real
   is called. Outputs to dashboard-assets/. */
const http = require("http");
const fs = require("fs");
const path = require("path");
const { chromium } = require("playwright");

const ROOT = path.join(__dirname, "..");
const AUTH = "https://n8n-production-d02c.up.railway.app/webhook/builder-auth";
const OUT = path.join(ROOT, "dashboard-assets");
const MIME = {
  ".html": "text/html",
  ".json": "application/json",
  ".js": "text/javascript",
  ".css": "text/css",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".svg": "image/svg+xml",
};

const IMGS = [
  "banner-living-room-split.jpg",
  "about-owner-condenser.jpg",
  "blog-1-smart-control.jpg",
  "blog-3-bedroom-split.jpg",
  "about-owner-customer.jpg",
  "blog-4-maintenance.jpg",
];

const MOCK = {
  session: {
    ok: true,
    site: "hvac-expert-in-melbourne",
    number: "0432 839 654",
  },
  "site-info": {
    ok: true,
    homepage: "https://www.completedigital.org/sites/hvac-expert-in-melbourne",
    details: {
      name: "HVAC Expert in Melbourne",
      phone: "03 9000 0212",
      email: "team@hvacexpert.com.au",
      address: "12 Trade Street",
      suburb: "Melbourne VIC",
    },
    hours: null,
    fonts: { heading: "Roboto Slab" },
    announce: { on: false, text: "", href: "" },
  },
  images: {
    ok: true,
    images: IMGS.map((f) => ({
      url: "http://localhost:8932/sites/images/hvac/" + f,
      path: "images/" + f,
    })),
  },
  texts: {
    ok: true,
    blocks: [
      {
        tag: "h1",
        text: "Melbourne's Commercial HVAC Specialists",
        find: "",
        occurrence: 1,
      },
      {
        tag: "p",
        text: "Heating, cooling and ventilation done right the first time. Servicing all of metro Melbourne with same-week installs.",
        find: "",
        occurrence: 1,
      },
      { tag: "h2", text: "Quality Workmanship", find: "", occurrence: 1 },
      { tag: "button", text: "Book now", find: "", occurrence: 1 },
      {
        tag: "h2",
        text: "Split systems, ducted & evaporative",
        find: "",
        occurrence: 1,
      },
      {
        tag: "p",
        text: "From a single bedroom split to a full commercial fit-out — we quote fast and install faster.",
        find: "",
        occurrence: 1,
      },
    ],
  },
};

const server = http.createServer((req, res) => {
  const p = decodeURIComponent(req.url.split("?")[0]);
  const file = path.join(ROOT, p === "/" ? "index.html" : p);
  if (!fs.existsSync(file) || fs.statSync(file).isDirectory()) {
    res.writeHead(404);
    return res.end("nf");
  }
  res.writeHead(200, {
    "Content-Type": MIME[path.extname(file)] || "application/octet-stream",
  });
  fs.createReadStream(file).pipe(res);
});

(async () => {
  fs.mkdirSync(OUT, { recursive: true });
  await new Promise((r) => server.listen(8932, r));
  const browser = await chromium.launch();
  const page = await browser.newPage({
    viewport: { width: 1280, height: 860 },
    deviceScaleFactor: 2,
  });

  await page.route(AUTH, async (route) => {
    let body = {};
    try {
      body = JSON.parse(route.request().postData() || "{}");
    } catch (e) {}
    const data = MOCK[body.action] || { ok: true };
    await route.fulfill({
      contentType: "application/json",
      body: JSON.stringify(data),
    });
  });

  await page.addInitScript(() => {
    localStorage.setItem("cd-builder-token", "demo-token");
  });

  await page.goto("http://localhost:8932/visual-editor/index.html", {
    waitUntil: "networkidle",
  });
  await page.waitForTimeout(1500);

  const shot = async (tab, name) => {
    if (tab) {
      await page.click('[data-tab="' + tab + '"]');
      await page.waitForTimeout(1800);
    }
    await page.screenshot({ path: path.join(OUT, name) });
    console.log("shot:", name);
  };

  await shot(null, "editor-todo.png");
  await shot("tabPhotos", "editor-photos.png");
  await shot("tabText", "editor-text.png");
  await shot("tabColours", "editor-colours.png");
  await shot("tabFonts", "editor-fonts.png");

  await browser.close();
  server.close();
})();
