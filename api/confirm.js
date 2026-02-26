// api/confirm.js
import crypto from "crypto";
import { Redis } from "@upstash/redis";

const redis = Redis.fromEnv();

function sha256(s) {
  return crypto.createHash("sha256").update(String(s || "")).digest("hex");
}

function sign(payloadJson, secret) {
  const data = Buffer.from(payloadJson, "utf8").toString("base64url");
  const sig = crypto.createHmac("sha256", secret).update(data).digest("base64url");
  return `${data}.${sig}`;
}

export default async function handler(req, res) {
  try {
    const appSecret = process.env.APP_SECRET;
    if (!appSecret) return res.status(500).json({ error: "APP_SECRET missing" });

    const { order_id, email } = req.query || {};
    if (!email) return res.status(400).json({ error: "email required" });

    const ehash = sha256(String(email).trim().toLowerCase());

    // 1) order_id varsa: redis'te kayıtlıysa eşleşmeli (kayıt yoksa bloklama)
    if (order_id) {
      const saved = await redis.get(`resumeai:paid:order:${order_id}`);
      if (saved && String(saved) !== ehash) {
        return res.status(401).json({ error: "Order not recognized" });
      }
    }

    // 2) email paid mi?
    const paid = await redis.get(`resumeai:paid:email:${ehash}`);
    if (String(paid) !== "1") {
      return res.status(401).json({ error: "Not paid" });
    }

    // 3) token üret (1 yıl)
    const tokenPayload = JSON.stringify({
      e: ehash,
      exp: Date.now() + 365 * 24 * 60 * 60 * 1000,
    });
    const token = sign(tokenPayload, appSecret);

    // 4) cookie set (HOST-ONLY: Domain koymuyoruz → Safari/edge case daha stabil)
    const isProd = process.env.NODE_ENV === "production";
    const parts = [
      `resumeai_session=${encodeURIComponent(token)}`,
      "Path=/",
      `Max-Age=${365 * 24 * 60 * 60}`,
      "SameSite=Lax",
      "HttpOnly",
    ];
    if (isProd) parts.push("Secure");

    res.setHeader("Set-Cookie", parts.join("; "));
    return res.status(200).json({ ok: true });
  } catch (e) {
    return res.status(500).json({ error: "Confirm error", details: e?.message || String(e) });
  }
}
