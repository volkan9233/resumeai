import { Redis } from "@upstash/redis";
import { Ratelimit } from "@upstash/ratelimit";
import crypto from "crypto";

const redis = Redis.fromEnv();

// Preview: 10 dakika / 3
const rlPreview = new Ratelimit({
  redis,
  limiter: Ratelimit.slidingWindow(3, "10 m"),
  prefix: "resumeai:rl:preview",
});

// Full: 1 dakika / 3
const rlFull = new Ratelimit({
  redis,
  limiter: Ratelimit.slidingWindow(3, "1 m"),
  prefix: "resumeai:rl:full",
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

  let payload;
  try {
    const payloadJson = Buffer.from(data, "base64url").toString("utf8");
    payload = JSON.parse(payloadJson);
  } catch {
    return false;
  }

  if (!payload?.exp || Date.now() > payload.exp) return false;
  return true;
}

export default async function handler(req, res) {
  try {
    if (req.method !== "POST") {
      return res.status(405).json({ error: "POST required" });
    }

    const { cv, jd, preview, lang, mode, linkedin_meta } = req.body || {};
const reqMode = (typeof mode === "string" && mode.trim()) ? mode.trim().toLowerCase() : "ats";

const sessionOk = verifySession(req);      // ✅ cookie var mı?
const requestedPreview = !!preview;        // client preview istedi mi?
const isPreview = requestedPreview || !sessionOk; // ✅ session yoksa full verme!
    console.log("ANALYZE FLAGS", {
  requestedPreview,
  sessionOk,
  isPreview,
  hasCookie: !!req.headers.cookie,
});

    // ✅ Upstash Rate limit
    const ip = getClientIp(req);
    const limiter = isPreview ? rlPreview : rlFull;

    const { success, reset } = await limiter.limit(ip);

    if (!success) {
      const retrySec = Math.max(1, Math.ceil((reset - Date.now()) / 1000));
      return res.status(429).json({
        error: "Too many requests",
        retry_after_seconds: retrySec,
      });
    }

    if (!cv) {
  return res.status(400).json({ error: "cv is required" });
}
if (reqMode !== "linkedin" && !jd) {
  return res.status(400).json({ error: "jd is required" });
}

    const apiKey = process.env.OPENAI_API_KEY;
    if (!apiKey) {
      return res.status(500).json({ error: "OPENAI_API_KEY is missing on Vercel" });
    }

    const model = process.env.OPENAI_MODEL || "gpt-4o-mini";

    // --- Language mapping (important) ---
    const LANG_MAP = {
      en: "English",
      tr: "Turkish",
      es: "Spanish",
      ru: "Russian",
      fr: "French",
      ar: "Arabic",
      zh: "Chinese (Simplified)",
    };

    const langCode =
      typeof lang === "string" && lang.trim() ? lang.trim().toLowerCase() : "en";
    const outLang = LANG_MAP[langCode] || "English";

 // ✅ Strong system instruction: one language only
const system = `
CRITICAL RULES (must follow):
- Do NOT invent or assume ANY numbers, percentages, time periods, client names, revenue, KPIs, team size, budget, or results.
- Only use metrics that are explicitly present in the user's resume/job description input text.
- If a bullet has no measurable metric, rewrite it using: scope + actions + tools + context + outcome wording WITHOUT numbers.
- Never write “increased by X%”, “grew by X”, “reduced by X%”, “saved $X”, “managed $X budget”, “served X clients”, “led X people” unless those exact facts appear in the input text.
- If unsure, prefer neutral phrasing (e.g., “improved”, “supported”, “contributed”, “helped drive”) with no numbers.
- If the input contains a number, keep it exact; do not round up/down or change it.
- DO NOT invent employers, titles, degrees, dates, certifications, tools, or projects.
You are an ATS resume analyzer.
Return ONLY valid JSON. No markdown. No extra text.
CRITICAL: All output VALUES MUST be written ONLY in ${outLang}. Do not mix languages.
This includes: missing_keywords items, weak_sentences.sentence and weak_sentences.rewrite, summary, and optimized_cv.
Do not add any extra keys.
`.trim();
const linkedinSystem = `
CRITICAL RULES (must follow):
- Do NOT invent or assume ANY numbers, percentages, time periods, client names, revenue, KPIs, team size, budget, or results.
- Only use metrics that are explicitly present in the user's resume/job description input text.
- If a bullet has no measurable metric, rewrite it using: scope + actions + tools + context + outcome wording WITHOUT numbers.
- Never write “increased by X%”, “grew by X”, “reduced by X%”, “saved $X”, “managed $X budget”, “served X clients”, “led X people” unless those exact facts appear in the input text.
- If unsure, prefer neutral phrasing with no numbers.
- If the input contains a number, keep it exact; do not round up/down or change it.

For BEFORE → AFTER rewrites:
- AFTER must preserve factual truth. It can improve clarity and strength but must not add new facts.
- If BEFORE has no metric, AFTER must not contain any metric.
You are a LinkedIn profile optimization expert.
Return ONLY valid JSON. No markdown. No extra text.
CRITICAL: All output VALUES MUST be written ONLY in ${outLang}. Do not mix languages.
Do not invent employers, titles, degrees, dates, certifications, or metrics.
If resume has no numbers, rewrite using scope + tools + outcome (without guessing numbers).
No extra keys.
`.trim();
    // --- LinkedIn meta normalize ---
const liMeta = (linkedin_meta && typeof linkedin_meta === "object") ? linkedin_meta : {};
const liTargetRole = String(liMeta.target_role || "").trim();
const liSeniority = String(liMeta.seniority || "mid").trim();
const liIndustry = String(liMeta.industry || "").trim();
const liLocation = String(liMeta.location || "").trim();
const liTone = String(liMeta.tone || "clean").trim();
    const linkedinPreviewUser = `
Return JSON in this exact schema:

{
  "headlines": [{"label": string, "text": string}],
  "about": { "short": string },
  "experience_fix": [{"before": string, "after": string, "why": string}],
  "skills": { "top": string[] },
  "recruiter": { "keywords": string[] }
}

RULES:
- Output VALUES must be in ${outLang} (proper nouns/tools can stay).
- headlines: exactly 1 item.
- about.short: 600–900 chars, punchy, no emojis.
- experience_fix: exactly 1 item. "before" must be a real bullet/sentence from the resume.
- skills.top: 7–10 items.
- recruiter.keywords: 5–8 items.
- No extra keys. Return ONLY valid JSON.

TARGETING META (use strictly):
- target_role: ${liTargetRole || "(not provided)"}
- seniority: ${liSeniority}
- industry: ${liIndustry || "(not provided)"}
- location: ${liLocation || "(not provided)"}
- tone: ${liTone} (clean=professional, confident=assertive, bold=high-energy)

HARD RULE:
- If target_role is provided, tailor every output to that role and seniority. Prefer role-specific keywords and tools.

RESUME:
${cv}

TARGET ROLE / JOB (optional):
${jd || "(none)"}
`.trim();

const linkedinFullUser = `
Return JSON in this exact schema:

{
  "headlines": [{"label": string, "text": string}],
  "about": { "short": string, "normal": string, "bold": string },
  "experience_fix": [{"before": string, "after": string, "why": string}],
  "skills": { "top": string[], "tools": string[], "industry": string[] },
  "recruiter": { "keywords": string[], "boolean": string }
}

QUALITY RULES:
- Output VALUES must be in ${outLang}. Do not mix languages.
- Do NOT invent employers, titles, dates, degrees, or metrics.
- If resume has no numbers, improve bullets using scope + tools + outcome WITHOUT guessing numbers.
- Headline max 220 chars each. No emojis.
- About:
  - short: 500–800 chars
  - normal: 900–1400 chars
  - bold: 900–1400 chars (more confident, still truthful)
- headlines: exactly 5 items with labels:
  1) "Search"
  2) "Impact"
  3) "Niche"
  4) "Leadership"
  5) "Clean"
- experience_fix: exactly 5 items. Each "before" must be from the resume text. "after" must be LinkedIn-ready bullet. "why" must explain (clarity/impact/scope/keywords).
- skills.top: 12–18
- skills.tools: 8–16
- skills.industry: 12–20
- recruiter.keywords: 10–20
- recruiter.boolean: a single boolean string using OR groups + a few AND terms, ready to paste in LinkedIn Recruiter.
- Return ONLY valid JSON. No extra keys.

TARGETING META (must drive output strongly):
- target_role: ${liTargetRole || "(not provided)"}
- seniority: ${liSeniority}
- industry: ${liIndustry || "(not provided)"}
- location: ${liLocation || "(not provided)"}
- tone: ${liTone} (clean=professional, confident=assertive, bold=high-energy)

HARD RULE:
- If target_role is provided, every headline + about + skills + recruiter keywords MUST align to target_role + seniority.

RESUME:
${cv}

TARGET ROLE / JOB (optional):
${jd || "(none)"}
`.trim();

    // ✅ PREVIEW prompt (small output)
    const previewUser = `
Return JSON in this exact schema:

{
  "ats_score": number,
  "missing_keywords": string[],
  "weak_sentences": [{"sentence": string, "rewrite": string}],
  "summary": string
}

REQUIREMENTS:
- missing_keywords MUST include exactly 5 items (unique, role-relevant) and MUST be written in ${outLang}.
- weak_sentences MUST include exactly 1 item (pick a real sentence from RESUME). Both sentence and rewrite MUST be in ${outLang}.
- summary MUST be 4–6 bullet lines in ${outLang}.
- Do NOT add extra keys. Do NOT add optimized_cv.
- Do NOT mix languages.
- Proper nouns / technical terms (SQL, GA4, React, AWS, Git, etc.) may stay as-is.
Return ONLY valid JSON.

RESUME:
${cv}

JOB DESCRIPTION:
${jd}
`.trim();

    // ✅ FULL prompt (large output)
    const fullUser = `
Analyze the resume vs job description and return JSON in this exact schema:

{
  "ats_score": number,
  "missing_keywords": string[],
  "weak_sentences": [{"sentence": string, "rewrite": string}],
  "optimized_cv": string,
  "summary": string
}

HARD REQUIREMENTS (do NOT be brief):
- missing_keywords MUST include 25–40 items (unique, role-relevant) and MUST be written in ${outLang}.
- weak_sentences MUST include 12–18 items (each from the resume text, with a stronger rewrite). Both sentence and rewrite MUST be in ${outLang}.
- summary MUST be detailed (8–14 bullet lines) in ${outLang} covering:
  1) overall fit diagnosis
  2) top 5 missing skills/keywords to add
  3) biggest ATS/format risks
  4) top 5 rewrite themes (impact/metrics/ownership)
- optimized_cv MUST be a complete rewritten resume (ATS-friendly, bullet-based, achievement-focused, aligned to JD) and MUST be written in ${outLang}.
- Keep claims truthful. Do not invent employers, degrees, titles, or metrics.
- Proper nouns / technical terms (SQL, GA4, React, AWS, Git, etc.) may stay as-is.
- Do NOT mix languages.
- Do NOT invent or assume any numbers/percentages/results. Use numbers ONLY if they exist in RESUME or JOB DESCRIPTION.
- If resume has no numbers, do NOT add any numbers in rewrites. Use scope + tools + outcome wording without numbers.

JSON STRICTNESS:
- KEYS must remain exactly: ats_score, missing_keywords, weak_sentences, optimized_cv, summary.
- Do NOT translate keys.
- No extra keys. No comments. No code fences.

Return ONLY valid JSON.

RESUME:
${cv}

JOB DESCRIPTION:
${jd}
`.trim();

    let userPrompt;

if (reqMode === "linkedin") {
  userPrompt = isPreview ? linkedinPreviewUser : linkedinFullUser;
} else {
  userPrompt = isPreview ? previewUser : fullUser;
}
    const chosenSystem = (reqMode === "linkedin") ? linkedinSystem : system;

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
        max_tokens: isPreview ? 650 : 1800,
        messages: [
          { role: "system", content: chosenSystem },
          { role: "user", content: userPrompt },
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
      const s = String(text);
      const start = s.indexOf("{");
      const end = s.lastIndexOf("}");
      if (start !== -1 && end !== -1 && end > start) {
        try {
          data = JSON.parse(s.slice(start, end + 1));
        } catch {
          return res.status(500).json({
            error: "Model did not return valid JSON",
            model_output: s.slice(0, 2000),
          });
        }
      } else {
        return res.status(500).json({
          error: "Model did not return valid JSON",
          model_output: s.slice(0, 2000),
        });
      }
    }
    if (reqMode === "linkedin") {
  const out = {
    headlines: Array.isArray(data?.headlines) ? data.headlines : [],
    about: (data?.about && typeof data.about === "object") ? data.about : {},
    experience_fix: Array.isArray(data?.experience_fix) ? data.experience_fix : [],
    skills: (data?.skills && typeof data.skills === "object") ? data.skills : {},
    recruiter: (data?.recruiter && typeof data.recruiter === "object") ? data.recruiter : {},
  };

  if (isPreview) {
    return res.status(200).json({
      headlines: out.headlines.slice(0, 1),
      about: { short: String(out.about.short || "") },
      experience_fix: out.experience_fix.slice(0, 1),
      skills: { top: Array.isArray(out.skills.top) ? out.skills.top.slice(0, 10) : [] },
      recruiter: { keywords: Array.isArray(out.recruiter.keywords) ? out.recruiter.keywords.slice(0, 8) : [] },
    });
  }

  return res.status(200).json(out);
}

    const normalized = {
      ats_score: Number.isFinite(data?.ats_score) ? data.ats_score : 0,
      missing_keywords: Array.isArray(data?.missing_keywords) ? data.missing_keywords : [],
      weak_sentences: Array.isArray(data?.weak_sentences) ? data.weak_sentences : [],
      summary: typeof data?.summary === "string" ? data.summary : "",
      ...(isPreview
        ? {}
        : { optimized_cv: typeof data?.optimized_cv === "string" ? data.optimized_cv : "" }),
    };

    if (isPreview) {
      return res.status(200).json({
        ats_score: normalized.ats_score,
        summary: normalized.summary,
        missing_keywords: normalized.missing_keywords.slice(0, 5),
        weak_sentences: normalized.weak_sentences.slice(0, 1),
      });
    }

    return res.status(200).json(normalized);
  } catch (err) {
    return res
      .status(500)
      .json({ error: "Server error", details: err?.message || String(err) });
  }
}
