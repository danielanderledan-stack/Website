// POST /api/create-topup-link
// Body: { number: "04...", amount: 5..500 (whole AUD dollars) }
// Creates a one-off Square Payment Link for website-editing credit and
// returns { url }. The account is credited by /api/square-webhook when the
// payment completes (matched via the payment note).
//
// Required env var: SQUARE_ACCESS_TOKEN

const SQUARE_API = "https://connect.squareup.com/v2";
const SQUARE_VERSION = "2025-01-23";
const LOCATION_ID = process.env.SQUARE_LOCATION_ID || "L95XNA62G7FVM";

function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

export async function POST(request) {
  if (!process.env.SQUARE_ACCESS_TOKEN) {
    return json({ error: "Payments are not configured yet." }, 500);
  }

  let body;
  try {
    body = await request.json();
  } catch {
    return json({ error: "Invalid request body." }, 400);
  }

  const number = String(body.number || "").trim();
  if (!/^[0-9+ ]{6,20}$/.test(number)) {
    return json({ error: "Invalid account number." }, 400);
  }
  const amount = parseInt(body.amount, 10);
  if (!(amount >= 5 && amount <= 500)) {
    return json({ error: "Top-up must be between $5 and $500." }, 400);
  }

  const origin =
    request.headers.get("origin") ||
    process.env.SITE_URL ||
    "https://www.completedigital.org";

  // The webhook parses this note to credit the right account.
  const note = "builder-topup|" + number.replace(/ /g, "") + "|" + amount;

  try {
    const res = await fetch(SQUARE_API + "/online-checkout/payment-links", {
      method: "POST",
      headers: {
        Authorization: "Bearer " + process.env.SQUARE_ACCESS_TOKEN,
        "Square-Version": SQUARE_VERSION,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        idempotency_key: crypto.randomUUID(),
        quick_pay: {
          name: "Complete Digital — website editing credit",
          price_money: { amount: amount * 100, currency: "AUD" },
          location_id: LOCATION_ID,
        },
        description: "$" + amount + " editing credit for your website",
        payment_note: note.slice(0, 500),
        checkout_options: {
          redirect_url: origin + "/website-builder/?topup=success",
          ask_for_shipping_address: false,
        },
      }),
    });

    const data = await res.json();
    if (!res.ok || !data.payment_link || !data.payment_link.url) {
      console.error(
        "Square top-up link error:",
        JSON.stringify(data.errors || data),
      );
      return json(
        { error: "Could not start checkout. Please try again." },
        502,
      );
    }
    return json({ url: data.payment_link.url });
  } catch (err) {
    console.error("Square top-up error:", err.message);
    return json({ error: "Could not start checkout. Please try again." }, 502);
  }
}
