// Read-only proxy: fetches a customer page's HTML server-side so the editor
// can host it same-origin in a srcdoc iframe (no browser CORS). Returns the
// raw HTML as text/plain. Writes still go through builder-auth (n8n).
//
// SSRF guard: https only, no localhost / private / link-local / metadata hosts.

const BLOCKED = [
  /^localhost$/i,
  /\.local$/i,
  /^127\./,
  /^10\./,
  /^0\./,
  /^192\.168\./,
  /^169\.254\./, // link-local + cloud metadata (169.254.169.254)
  /^172\.(1[6-9]|2\d|3[01])\./, // 172.16-31.x
  /^::1$/,
  /^fc00:/i,
  /^fe80:/i,
];

export default async function handler(req, res) {
  try {
    const raw = (req.query.url || "").toString();
    let u;
    try {
      u = new URL(raw);
    } catch {
      return res.status(400).json({ error: "Invalid url" });
    }
    if (u.protocol !== "https:") {
      return res.status(400).json({ error: "https only" });
    }
    if (BLOCKED.some((re) => re.test(u.hostname))) {
      return res.status(400).json({ error: "Blocked host" });
    }

    const upstream = await fetch(u.toString(), {
      headers: { "User-Agent": "CompleteDigital-Editor/1.0" },
      redirect: "follow",
    });
    if (!upstream.ok) {
      return res
        .status(502)
        .json({ error: "Upstream " + upstream.status });
    }
    const html = await upstream.text();
    res.setHeader("Content-Type", "text/plain; charset=utf-8");
    res.setHeader("Cache-Control", "no-store");
    return res.status(200).send(html);
  } catch (e) {
    return res
      .status(500)
      .json({ error: String((e && e.message) || e) });
  }
}
