// api/me.js
import crypto from "crypto";

function verifySession(req) {
  const appSecret = process.env.APP_SECRET;
  if (!appSecret) return false;

  const cookie = req.headers.cookie || "";
  const m = cookie.match(/(?:^|;\s*)resumeai_session=([^;]+)/);
  if (!m) return false;

  const token = decodeURIComponent(m[1]);
  const [data, sig] = token.split(".");
  if (!data || !sig) return false;

  const expected = crypto.createHmac("sha256", appSecret).update(data).digest("base64url");
  if (sig !== expected) return false;

  try {
    const payload = JSON.parse(Buffer.from(data, "base64url").toString("utf8"));
    if (!payload?.exp || Date.now() > payload.exp) return false;
  } catch {
    return false;
  }

  return true;
}

export default function handler(req, res) {
  const ok = verifySession(req);
  return res.status(200).json({ unlocked: ok });
}
