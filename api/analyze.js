const RL = globalThis.__resumeai_rl || (globalThis.__resumeai_rl = new Map());

function rateLimit(key, limit, windowMs) {
  const now = Date.now();
  const item = RL.get(key) || { count: 0, reset: now + windowMs };
  if (now > item.reset) {
    item.count = 0;
    item.reset = now + windowMs;
  }
  item.count += 1;
  RL.set(key, item);
  return { ok: item.count <= limit, reset: item.reset };
}

function getClientIp(req){
  const xf = req.headers["x-forwarded-for"];
  if (typeof xf === "string" && xf.length) return xf.split(",")[0].trim();
  return req.socket?.remoteAddress || "unknown";
}

export default async function handler(req, res) {
  try {
    if (req.method !== "POST") {
      return res.status(405).json({ error: "POST required" });
    }

    const { cv, jd, preview, lang } = req.body || {};
    const isPreview = !!preview;

    // ✅ Rate limit
    const ip = getClientIp(req);
    const key = `${ip}:${isPreview ? "preview" : "full"}`;

    // Try: 10 dakikada 1 | Full: 1 dakikada 3
    const limit = isPreview ? 1 : 3;
    const windowMs = isPreview ? 10 * 60 * 1000 : 60 * 1000;

    const { ok, reset } = rateLimit(key, limit, windowMs);
    if (!ok) {
      const retrySec = Math.ceil((reset - Date.now()) / 1000);
      return res.status(429).json({
        error: "Too many requests",
        retry_after_seconds: retrySec
      });
    }

    if (!cv || !jd) {
      return res.status(400).json({ error: "cv and jd are required" });
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

    const langCode = (typeof lang === "string" && lang.trim()) ? lang.trim().toLowerCase() : "en";
    const outLang = LANG_MAP[langCode] || "English";

    // ✅ Strong system instruction: one language only
    const system = `
You are an ATS resume analyzer.
Return ONLY valid JSON. No markdown. No extra text.
CRITICAL: All output VALUES MUST be written ONLY in ${outLang}. Do not mix languages.
This includes: missing_keywords items, weak_sentences.sentence and weak_sentences.rewrite, summary, and optimized_cv.
Do not add any extra keys.
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

    const userPrompt = isPreview ? previewUser : fullUser;

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
          { role: "system", content: system },
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

    const normalized = {
      ats_score: Number.isFinite(data?.ats_score) ? data.ats_score : 0,
      missing_keywords: Array.isArray(data?.missing_keywords) ? data.missing_keywords : [],
      weak_sentences: Array.isArray(data?.weak_sentences) ? data.weak_sentences : [],
      summary: typeof data?.summary === "string" ? data.summary : "",
      ...(isPreview ? {} : { optimized_cv: typeof data?.optimized_cv === "string" ? data.optimized_cv : "" }),
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
    return res.status(500).json({ error: "Server error", details: err?.message || String(err) });
  }
}
