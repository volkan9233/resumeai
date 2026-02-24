module.exports = async function handler(req, res) {
  try {
    if (req.method !== "POST") {
      return res.status(405).json({ error: "POST required" });
    }

    const { cv, jd, preview, lang } = req.body || {};
const targetLang = (typeof lang === "string" && lang) ? lang : "en";
    if (!cv || !jd) {
      return res.status(400).json({ error: "cv and jd are required" });
    }

    const apiKey = process.env.OPENAI_API_KEY;
    if (!apiKey) {
      return res.status(500).json({ error: "OPENAI_API_KEY is missing on Vercel" });
    }

    const model = process.env.OPENAI_MODEL || "gpt-4o-mini";
    const isPreview = !!preview;

    const system =
      "You are an ATS resume analyzer. Return ONLY valid JSON. No markdown. No extra text.";

    // Daha dolu sonuç için net minimumlar
    const user = `
Analyze the resume vs job description and return JSON in this exact schema:

{
  "ats_score": number,
  "missing_keywords": string[],
  "weak_sentences": [{"sentence": string, "rewrite": string}],
  "optimized_cv": string,
  "summary": string
}

HARD REQUIREMENTS (do NOT be brief):
- missing_keywords MUST include 25–40 items (unique, role-relevant).
- weak_sentences MUST include 12–18 items (each from the resume text, with a stronger rewrite).
- summary MUST be detailed (8–14 bullet lines) covering:
  1) overall fit diagnosis
  2) top 5 missing skills/keywords to add
  3) biggest ATS/format risks
  4) top 5 rewrite themes (impact/metrics/ownership)
- optimized_cv MUST be a complete rewritten resume (not partial), ATS-friendly, bullet-based, achievement-focused, and aligned to the JD.
- Keep claims truthful. Do not invent employers, degrees, titles, or metrics. If a metric is unknown, rewrite without numbers rather than guessing.
- missing_keywords should be single words or short phrases (2–4 words max). No duplicates.
JSON STRICTNESS:
- The JSON KEYS must remain exactly as in the schema (English snake_case): ats_score, missing_keywords, weak_sentences, optimized_cv, summary.
- Only translate the VALUES (summary text, rewrites, optimized_cv text) into ${targetLang}.
- Do not add extra keys. Do not add comments. Do not wrap in code fences.

SCORING GUIDANCE:
- ats_score is based on keyword overlap + seniority fit + impact metrics + structure + clarity.
LANGUAGE REQUIREMENT:
- Write ALL output fields (summary, rewrites, optimized_cv) in this target language: ${targetLang}.
- Use native, professional HR tone for ${targetLang}. No slang, no awkward literal translations.

TERMINOLOGY RULES:
- Do NOT translate proper nouns and technical terms (React, Next.js, GA4, SQL, Core Web Vitals, TypeScript, Git, Vercel, AWS, etc.).
- Keep bullet formatting and section headers consistent and ATS-friendly.

QUALITY CHECK:
Before finalizing, ensure:
1) Sounds natural in ${targetLang} (native-level).
2) No invented experience/metrics.
3) ATS-friendly structure preserved.
Return ONLY valid JSON. No markdown.
INPUTS:

RESUME:
${cv}

JOB DESCRIPTION:
${jd}
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
        // Dolu CV çıktısı için biraz alan bırakıyoruz
        max_tokens: isPreview ? 1200 : 3200,
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
} catch (e1) {
  // fallback: ilk { ile son } arasını alıp parse et
  const s = String(text);
  const start = s.indexOf("{");
  const end = s.lastIndexOf("}");
  if (start !== -1 && end !== -1 && end > start) {
    try {
      data = JSON.parse(s.slice(start, end + 1));
    } catch (e2) {
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
    }

    // Küçük güvenlik: tipleri normalize et (UI boş kalmasın)
    const normalized = {
      ats_score: Number.isFinite(data.ats_score) ? data.ats_score : 0,
      missing_keywords: Array.isArray(data.missing_keywords) ? data.missing_keywords : [],
      weak_sentences: Array.isArray(data.weak_sentences) ? data.weak_sentences : [],
      optimized_cv: typeof data.optimized_cv === "string" ? data.optimized_cv : "",
      summary: typeof data.summary === "string" ? data.summary : "",
    };

    // PREVIEW MODE: sadece küçük parça göster
    if (isPreview) {
      const previewData = {
        ats_score: normalized.ats_score,
        summary: normalized.summary,
        missing_keywords: normalized.missing_keywords.slice(0, 5),
        weak_sentences: normalized.weak_sentences.slice(0, 2),
        // optimized_cv deliberately omitted
      };
      return res.status(200).json(previewData);
    }

    return res.status(200).json(normalized);
  } catch (err) {
    return res.status(500).json({ error: "Server error", details: err?.message || String(err) });
  }
}
