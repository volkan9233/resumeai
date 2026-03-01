// /api/create.js
import { Redis } from "@upstash/redis";
import { Ratelimit } from "@upstash/ratelimit";
import crypto from "crypto";

const redis = Redis.fromEnv();

// Preview: 10 dakika / 3
const rlPreview = new Ratelimit({
  redis,
  limiter: Ratelimit.slidingWindow(3, "10 m"),
  prefix: "resumeai:rl:create:preview",
});

// Full: 1 dakika / 3
const rlFull = new Ratelimit({
  redis,
  limiter: Ratelimit.slidingWindow(3, "1 m"),
  prefix: "resumeai:rl:create:full",
});

function getClientIp(req) {
  const xf = req.headers["x-forwarded-for"];
  if (typeof xf === "string" && xf.length) return xf.split(",")[0].trim();
  return req.socket?.remoteAddress || "unknown";
}

function verifySession(req) {
  const appSecret = process.env.APP_SECRET;
  if (!appSecret) return false;

  const cookie = req.headers.cookie || "";
  const m = cookie.match(/(?:^|;\s*)resumeai_session=([^;]+)/);
  if (!m) return false;

  const token = decodeURIComponent(m[1]);
  const parts = token.split(".");
  if (parts.length !== 2) return false;

  const [data, sig] = parts;
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

export default async function handler(req, res) {
  try {
    if (req.method !== "POST") return res.status(405).json({ error: "POST required" });

    const sessionOk = verifySession(req);
    const { profile, preview, lang, jd } = req.body || {};

    const requestedPreview = !!preview;
    const isPreview = requestedPreview || !sessionOk;

    // rate limit
    const ip = getClientIp(req);
    const limiter = isPreview ? rlPreview : rlFull;
    const { success, reset } = await limiter.limit(ip);
    if (!success) {
      const retrySec = Math.max(1, Math.ceil((reset - Date.now()) / 1000));
      return res.status(429).json({ error: "Too many requests", retry_after_seconds: retrySec });
    }

    if (!profile || typeof profile !== "object") {
      return res.status(400).json({ error: "profile is required" });
    }

    const apiKey = process.env.OPENAI_API_KEY;
    if (!apiKey) return res.status(500).json({ error: "OPENAI_API_KEY is missing" });

    const model = process.env.OPENAI_MODEL || "gpt-4o-mini";

    const LANG_MAP = {
      en: "English",
      tr: "Turkish",
      es: "Spanish",
      ru: "Russian",
      fr: "French",
      ar: "Arabic",
      zh: "Chinese (Simplified)",
    };
    const langCode = (typeof lang === "string" && lang.trim() ? lang.trim().toLowerCase() : "en");
    const outLang = LANG_MAP[langCode] || "English";

    // Input normalize
    const safe = (v) => (v == null ? "" : String(v)).trim();
    const p = profile;

    const basics = {
      fullName: safe(p.fullName),
      title: safe(p.title),
      location: safe(p.location),
      phone: safe(p.phone),
      email: safe(p.email),
      links: Array.isArray(p.links) ? p.links.slice(0, 6) : [],
      photoUrl: "",
    };

    const exp = Array.isArray(p.experience) ? p.experience : [];
    const edu = Array.isArray(p.education) ? p.education : [];
    const skills = Array.isArray(p.skills) ? p.skills : [];
    const projects = Array.isArray(p.projects) ? p.projects : [];
    const certificates = Array.isArray(p.certificates) ? p.certificates : [];
    const languages = Array.isArray(p.languages) ? p.languages : [];

    const system = `
You are ResumeAI.
Return ONLY valid JSON. No markdown. No extra text.
CRITICAL: All output VALUES MUST be ONLY in ${outLang}. Do not mix languages.
Do not invent employers, degrees, titles, dates, or metrics. If metrics are missing, write impact without numbers.
Do not add extra keys beyond the required schema.
`.trim();

    // We generate ONLY: cv_data.summary, cv_data.skills (names), cv_data.experience[*].highlights
    // We keep user-provided company/role/dates unchanged.
    const user = `
Create a strong ATS-friendly resume content based on the structured profile.
Return JSON with this exact schema:

{
  "cv_data": {
    "basics": {
      "fullName": string,
      "title": string,
      "location": string,
      "phone": string,
      "email": string,
      "links": [{"label": string, "url": string}],
      "photoUrl": string
    },
    "summary": string,
    "skills": [{"name": string, "level": string}],
    "experience": [{
      "company": string,
      "position": string,
      "start": string,
      "end": string|null,
      "location": string,
      "highlights": string[]
    }],
    "projects": [{
      "name": string,
      "tech": string[],
      "highlights": string[]
    }],
    "education": [{
      "school": string,
      "degree": string,
      "start": string,
      "end": string
    }],
    "certificates": string[],
    "languages": [{"name": string, "level": string}],
    "meta": { "accent": string, "includePhoto": boolean, "lang": string }
  }
}

HARD REQUIREMENTS:
- summary MUST be ${isPreview ? "3–4" : "5–7"} bullets (each bullet a single line starting with "- ").
- skills MUST contain ${isPreview ? "10–14" : "18–28"} relevant items (2–4 words max each). Use level as "".
- For each experience role, highlights MUST contain ${isPreview ? "3–4" : "6–8"} bullets.
- Bullets must be strong: Action + Tool/Process + Scope + Outcome (no fake numbers).
- If a JD is provided, tailor summary/skills/highlights toward it.
- Keep company/position/start/end/location as provided. Do not change them.
- Output language: ${outLang}. Proper nouns/tech terms (SQL, GA4, React, AWS, Git...) can stay as-is.

INPUT PROFILE (structured):
${JSON.stringify({ basics, skills, exp, projects, edu, certificates, languages, jd: safe(jd) }, null, 2)}

Return ONLY valid JSON.
`.trim();

    const openaiRes = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model,
        temperature: 0.3,
        response_format: { type: "json_object" },
        max_tokens: isPreview ? 1100 : 2200,
        messages: [
          { role: "system", content: system },
          { role: "user", content: user },
        ],
      }),
    });

    const raw = await openaiRes.text();
    if (!openaiRes.ok) {
      return res.status(openaiRes.status).json({
        error: "OpenAI error",
        status: openaiRes.status,
        details: raw.slice(0, 2000),
      });
    }

    const parsed = JSON.parse(raw);
    const text = parsed?.choices?.[0]?.message?.content || "{}";

    let data;
    try {
      data = JSON.parse(text);
    } catch {
      return res.status(500).json({ error: "Model did not return valid JSON", model_output: String(text).slice(0, 2000) });
    }

    const cv = data?.cv_data;

    // Basic fallback merge: always keep user-provided skeleton
    const normalized = {
      basics,
      summary: typeof cv?.summary === "string" ? cv.summary : "",
      skills: Array.isArray(cv?.skills) ? cv.skills : skills.map((s) => ({ name: String(s || "").trim(), level: "" })).filter(x => x.name),
      experience: exp.map((e, i) => ({
        company: safe(e.company),
        position: safe(e.position),
        start: safe(e.start),
        end: e.end == null ? null : safe(e.end),
        location: safe(e.location),
        highlights: Array.isArray(cv?.experience?.[i]?.highlights) ? cv.experience[i].highlights : (Array.isArray(e.highlights) ? e.highlights : []),
      })),
      projects,
      education: edu,
      certificates: certificates.map(x => String(x || "").trim()).filter(Boolean),
      languages: languages.map(l => ({ name: safe(l.name), level: safe(l.level) })).filter(x => x.name),
      meta: { accent: "#6366F1", includePhoto: false, lang: langCode },
    };

    return res.status(200).json({ cv_data: normalized, preview: isPreview });
  } catch (e) {
    return res.status(500).json({ error: "Server error", details: e?.message || String(e) });
  }
}
