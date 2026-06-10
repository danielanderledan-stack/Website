// POST /api/square-webhook
// Receives Square webhook events so we know when someone actually PAYS,
// not just when they open a checkout link. Square calls this endpoint for:
//   payment.created / payment.updated  — card charged (initial payment)
//   subscription.created               — subscription started after checkout
//   invoice.payment_made               — recurring monthly payment collected
//
// Required env var: SQUARE_WEBHOOK_SIGNATURE_KEY (from the webhook subscription)
// Optional: N8N_PURCHASE_WEBHOOK_URL — events are forwarded there as JSON.
// Events always show up in the Vercel runtime logs ("Square purchase event").

import { createHmac, timingSafeEqual } from "node:crypto";

const NOTIFICATION_URL =
  process.env.SQUARE_WEBHOOK_NOTIFICATION_URL ||
  "https://www.completedigital.org/api/square-webhook";

function verifySignature(rawBody, signatureHeader) {
  const key = process.env.SQUARE_WEBHOOK_SIGNATURE_KEY;
  if (!key || !signatureHeader) return false;
  const expected = createHmac("sha256", key)
    .update(NOTIFICATION_URL + rawBody)
    .digest();
  let received;
  try {
    received = Buffer.from(signatureHeader, "base64");
  } catch {
    return false;
  }
  return (
    expected.length === received.length && timingSafeEqual(expected, received)
  );
}

export async function POST(request) {
  const rawBody = await request.text();
  const signature = request.headers.get("x-square-hmacsha256-signature");

  if (!verifySignature(rawBody, signature)) {
    return new Response("Invalid signature", { status: 401 });
  }

  let event;
  try {
    event = JSON.parse(rawBody);
  } catch {
    return new Response("Bad payload", { status: 400 });
  }

  const type = event.type || "";
  const obj = event.data?.object || {};

  // Compact, human-readable summary per event type.
  let summary = null;
  if (type === "payment.created" || type === "payment.updated") {
    const p = obj.payment || {};
    if (p.status === "COMPLETED") {
      summary = {
        event: "payment_completed",
        amount: (p.amount_money?.amount || 0) / 100,
        currency: p.amount_money?.currency,
        buyerEmail: p.buyer_email_address || null,
        receiptUrl: p.receipt_url || null,
        note: p.note || null,
        paymentId: p.id,
        orderId: p.order_id || null,
      };
    }
  } else if (type === "subscription.created") {
    const s = obj.subscription || {};
    summary = {
      event: "subscription_started",
      subscriptionId: s.id,
      customerId: s.customer_id || null,
      startDate: s.start_date || null,
      status: s.status || null,
    };
  } else if (type === "invoice.payment_made") {
    const inv = obj.invoice || {};
    summary = {
      event: "recurring_payment",
      invoiceId: inv.id,
      subscriptionId: inv.subscription_id || null,
      buyerEmail: inv.primary_recipient?.email_address || null,
      amount:
        (inv.payment_requests?.[0]?.computed_amount_money?.amount || 0) / 100,
    };
  }

  // Website-builder credit top-ups: the payment note carries the account
  // number ("builder-topup|<number>|<amount>"). Credit the account in n8n.
  if (
    summary &&
    summary.event === "payment_completed" &&
    typeof summary.note === "string" &&
    summary.note.startsWith("builder-topup|")
  ) {
    const number = summary.note.split("|")[1];
    const creditUrl = process.env.BUILDER_CREDIT_URL;
    const creditSecret = process.env.BUILDER_CREDIT_SECRET;
    if (creditUrl && creditSecret && number) {
      try {
        const r = await fetch(creditUrl, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            action: "credit",
            secret: creditSecret,
            number,
            amount: summary.amount, // authoritative amount from the payment
          }),
        });
        console.log(
          "Builder top-up credited:",
          number,
          summary.amount,
          "->",
          r.status,
        );
      } catch (err) {
        console.error("Builder credit failed:", err.message);
      }
    } else {
      console.error("Builder top-up received but credit env vars missing");
    }
  }

  if (summary) {
    summary.squareEventId = event.event_id;
    summary.timestamp = event.created_at;
    console.log("Square purchase event:", JSON.stringify(summary));

    if (process.env.N8N_PURCHASE_WEBHOOK_URL) {
      try {
        await fetch(process.env.N8N_PURCHASE_WEBHOOK_URL, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(summary),
        });
      } catch (err) {
        console.error("n8n forward failed:", err.message);
      }
    }
  }

  return new Response("ok", { status: 200 });
}
