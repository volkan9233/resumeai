// api/ls-webhook.js
import crypto from "crypto";
import { Redis } from "@upstash/redis";

export const config = { api: { bodyParser: false } };

const redis = Redis.fromEnv();

async function readRawBody(req) {
  const chunks = [];
  for await (const chunk of req) chunks.push(Buffer.from(chunk));
  return Buffer.concat(chunks);
}

function timingSafeEqual(a, b) {
  const ba = Buffer.from(a || "", "utf8");
  const bb = Buffer.from(b || "", "utf8");
  if (ba.length !== bb.length) return false;
  return crypto.timingSafeEqual(ba, bb);
}

function sha256(s) {
  return crypto.createHash("sha256").update(String(s || "")).digest("hex");
}

export default async function handler(req, res) {
  try {
    if (req.method !== "POST") return res.status(405).json({ error: "POST required" });

    const secret = process.env.LEMON_WEBHOOK_SECRET;
    if (!secret) return res.status(500).json({ error: "LEMON_WEBHOOK_SECRET missing" });

    const raw = await readRawBody(req);
    const sig = req.headers["x-signature"]; // Lemon: X-Signature
    const digest = crypto.createHmac("sha256", secret).update(raw).digest("hex");

    if (!timingSafeEqual(String(sig || ""), digest)) {
      return res.status(401).json({ error: "Invalid signature" });
    }

    const evt = JSON.parse(raw.toString("utf8"));

    // Lemon event adı genelde meta/event alanlarında olur. Güvenli şekilde çekiyoruz:
    const eventName =
      evt?.meta?.event_name ||
      evt?.meta?.event ||
      evt?.event_name ||
      evt?.event ||
      "";

    const attrs = evt?.data?.attributes || {};
    const orderId = attrs?.order_number || attrs?.identifier || attrs?.id || attrs?.order_id;
    const email = attrs?.user_email || attrs?.customer_email || attrs?.email;

    // Sadece bizim ürünse işleyelim (ürün adıyla da filtreleyebilirsin)
    // const productName = attrs?.product_name || "";
    // if (productName && !productName.toLowerCase().includes("resumeai")) return res.status(200).json({ ok: true });

    if (!email) return res.status(200).json({ ok: true });

    const ehash = sha256(email.trim().toLowerCase());

    if (eventName === "order_created") {
      // Satın alım kaydı: email hash -> paid
      await redis.set(`resumeai:paid:email:${ehash}`, "1");
      if (orderId) await redis.set(`resumeai:paid:order:${orderId}`, ehash);

      // İstersen timestamp da tut:
      await redis.set(`resumeai:paid:email:${ehash}:ts`, String(Date.now()));

      return res.status(200).json({ ok: true });
    }

    if (eventName === "order_refunded") {
      // Refund geldiğinde iptal
      await redis.del(`resumeai:paid:email:${ehash}`);
      if (orderId) await redis.del(`resumeai:paid:order:${orderId}`);
      return res.status(200).json({ ok: true });
    }

    return res.status(200).json({ ok: true });
  } catch (e) {
    return res.status(500).json({ error: "Webhook error", details: e?.message || String(e) });
  }
}
