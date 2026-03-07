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

async function ensureMinDelay(startedAt, minMs) {
  const elapsed = Date.now() - startedAt;
  const remain = minMs - elapsed;
  if (remain > 0) {
    await new Promise((resolve) => setTimeout(resolve, remain));
  }
}

export default async function handler(req, res) {
  const startedAt = Date.now();

  try {
    if (req.method !== "POST") {
      return res.status(405).json({ error: "POST required" });
    }

    const { cv, jd, preview, lang, mode, linkedin_meta } = req.body || {};
    const reqMode =
      typeof mode === "string" && mode.trim() ? mode.trim().toLowerCase() : "ats";

    const sessionOk = verifySession(req);
    const requestedPreview = !!preview;
    const isPreview = requestedPreview || !sessionOk;

    console.log("ANALYZE FLAGS", {
      requestedPreview,
      sessionOk,
      isPreview,
      hasCookie: !!req.headers.cookie,
    });

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

    const apiKey = process.env.OPENAI_API_KEY;
    if (!apiKey) {
      return res.status(500).json({ error: "OPENAI_API_KEY is missing on Vercel" });
    }

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

    const langCode =
      typeof lang === "string" && lang.trim() ? lang.trim().toLowerCase() : "en";
    const outLang = LANG_MAP[langCode] || "English";

    const hasJD = typeof jd === "string" && jd.trim().length > 0;

    const system = `
CRITICAL RULES (must follow):
- Do NOT invent or assume ANY numbers, percentages, time periods, client names, revenue, KPIs, team size, budget, or results.
- Only use metrics that are explicitly present in the user's resume/job description input text.
- If a bullet has no measurable metric, rewrite it using: scope + actions + tools + context + outcome wording WITHOUT numbers.
- Never write “increased by X%”, “grew by X”, “reduced by X%”, “saved $X”, “managed $X budget”, “served X clients”, “led X people” unless those exact facts appear in the input text.
- If unsure, prefer neutral phrasing (e.g., “improved”, “supported”, “contributed”, “helped drive”) with no numbers.
- If the input contains a number, keep it exact; do not round up/down or change it.
- DO NOT invent employers, titles, degrees, dates, certifications, tools, or projects.
- Rewrites must be materially better than the original.
- Do NOT make shallow synonym swaps or near-duplicate rewrites.
- Each rewrite must improve at least two of these: clarity, ownership, specificity, scope, action strength, business context.
- If a rewrite is too similar to the original, rewrite it again with stronger professional phrasing.
- Prefer stronger professional phrasing, but keep all claims truthful.
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
- If resume has no numbers, rewrite using scope + tools + outcome (without guessing numbers).
- Rewrites must be materially better than the original.
- Do NOT make shallow synonym swaps or near-duplicate rewrites.
- Each rewrite must improve at least two of these: clarity, ownership, specificity, scope, action strength, business context.
- If a rewrite is too similar to the original, rewrite it again with stronger professional phrasing.
No extra keys.
`.trim();

    const liMeta =
      linkedin_meta && typeof linkedin_meta === "object" ? linkedin_meta : {};
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
- "after" must be materially stronger than "before", not a light synonym swap.
- Choose only a sentence where a clearly better rewrite is possible.
- If the rewrite is too similar to the original, choose another sentence.
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
- experience_fix: exactly 5-6 items. Each "before" must be from the resume text. "after" must be LinkedIn-ready bullet. "why" must explain (clarity/impact/scope/keywords).
- Do NOT use shallow synonym swaps or near-duplicate rewrites.
- Each "after" must improve at least two of these: clarity, ownership, specificity, scope, action strength, business context.
- If a sentence cannot be improved meaningfully, do not include it.
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

    const previewUser = hasJD
      ? `
Return JSON in this exact schema:

{
  "ats_score": number,
  "missing_keywords": string[],
  "weak_sentences": [{"sentence": string, "rewrite": string}],
  "summary": string
}

REQUIREMENTS:
- This is a JOB-SPECIFIC ATS MATCH because a job description is provided.
- ats_score must be derived from these weighted components for a JOB-SPECIFIC ATS MATCH:
  - JD keyword match: 35
  - Section completeness: 15
  - Bullet strength: 20
  - ATS-safe formatting: 15
  - Role alignment: 15
- First internally evaluate each component on a 0-100 scale.
- Then calculate the final ats_score as the weighted overall result.
- Return only the final ats_score number in JSON.
- Do not return the component scores unless explicitly requested.
- missing_keywords MUST include exactly 5-7 items that are genuinely missing or underrepresented from the JOB DESCRIPTION.
- missing_keywords MUST be unique, role-relevant, and written in ${outLang}.
- weak_sentences MUST include exactly 2 items picked from real resume sentences.
- Both sentence and rewrite MUST be in ${outLang}.
- Select only sentences where a clearly better rewrite is possible.
- Do NOT select sentences that can only be improved with tiny synonym swaps.
- Each rewrite must feel meaningfully stronger, clearer, and more professional.
- weak_sentences.rewrite must not be a near-copy of sentence.
- If no strong rewrite is possible, choose a different sentence.
- summary MUST be 4–6 bullet lines in ${outLang}.
- summary must focus on job fit, biggest missing keywords, ATS risks, and top improvements.
- summary should reflect the weighted scoring logic above.
- Do NOT add extra keys. Do NOT add optimized_cv.
- Do NOT mix languages.
- Proper nouns / technical terms may stay as-is.

Return ONLY valid JSON.

RESUME:
${cv}

JOB DESCRIPTION:
${jd}
`.trim()
      : `
Return JSON in this exact schema:

{
  "ats_score": number,
  "missing_keywords": string[],
  "weak_sentences": [{"sentence": string, "rewrite": string}],
  "summary": string
}

REQUIREMENTS:
- This is a GENERAL ATS REVIEW because no job description is provided.
- ats_score must be derived from these weighted components for a GENERAL ATS REVIEW:
  - Section completeness: 25
  - Clarity / readability: 20
  - Bullet strength: 20
  - ATS-safe formatting: 20
  - Core keyword coverage: 15
- First internally evaluate each component on a 0-100 scale.
- Then calculate the final ats_score as the weighted overall result.
- Return only the final ats_score number in JSON.
- Do not return the component scores unless explicitly requested.
- missing_keywords MUST include exactly 5-7 items.
- These are NOT job-specific missing keywords. They should be recommended ATS/recruiter-friendly resume keywords based on the candidate's apparent role and experience.
- missing_keywords MUST be unique, practical, role-relevant, and written in ${outLang}.
- weak_sentences MUST include exactly 2 items picked from real resume sentences.
- Both sentence and rewrite MUST be in ${outLang}.
- Select only sentences where a clearly better rewrite is possible.
- Do NOT select sentences that can only be improved with tiny synonym swaps.
- Each rewrite must feel meaningfully stronger, clearer, and more professional.
- weak_sentences.rewrite must not be a near-copy of sentence.
- If no strong rewrite is possible, choose a different sentence.
- summary MUST be 4–6 bullet lines in ${outLang}.
- summary must focus on general ATS readiness, structure, clarity, and top improvement areas.
- summary should reflect the weighted scoring logic above.
- Do NOT add extra keys. Do NOT add optimized_cv.
- Do NOT mix languages.
- Proper nouns / technical terms may stay as-is.

Return ONLY valid JSON.

RESUME:
${cv}
`.trim();

    const fullUser = hasJD
      ? `
Analyze the resume vs job description and return JSON in this exact schema:

{
  "ats_score": number,
  "missing_keywords": string[],
  "weak_sentences": [{"sentence": string, "rewrite": string}],
  "optimized_cv": string,
  "summary": string
}

HARD REQUIREMENTS:
- This is a JOB-SPECIFIC ATS MATCH because a job description is provided.
- ats_score must be derived from these weighted components for a JOB-SPECIFIC ATS MATCH:
  - JD keyword match: 35
  - Section completeness: 15
  - Bullet strength: 20
  - ATS-safe formatting: 15
  - Role alignment: 15
- First internally evaluate each component on a 0-100 scale.
- Then calculate the final ats_score as the weighted overall result.
- Return only the final ats_score number in JSON.
- Do not return the component scores unless explicitly requested.
- missing_keywords MUST include 25–35 items genuinely missing or underrepresented from the JOB DESCRIPTION.
- missing_keywords MUST be unique, role-relevant, and written in ${outLang}.
- weak_sentences MUST include 12–18 items from the resume text, each with a materially stronger rewrite.
- Both sentence and rewrite MUST be in ${outLang}.
- Do NOT use shallow synonym swaps or near-duplicate rewrites.
- Each rewrite must improve at least two of these: clarity, ownership, specificity, scope, action strength, business context.
- weak_sentences.rewrite must feel materially stronger and more professional than sentence.
- If a sentence cannot be improved meaningfully, do not include it; choose a different one.
- summary MUST be detailed (8–14 bullet lines) in ${outLang} covering:
  1) overall job-fit diagnosis
  2) top missing skills/keywords to add
  3) biggest ATS/format risks
  4) top rewrite themes
- optimized_cv MUST be a complete rewritten resume aligned to the job description and written in ${outLang}.
- Keep claims truthful. Do not invent employers, degrees, titles, dates, tools, or metrics.
- Do NOT mix languages.
- Do NOT invent or assume numbers/percentages/results. Use numbers ONLY if they exist in RESUME or JOB DESCRIPTION.
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
`.trim()
      : `
Analyze the resume and return JSON in this exact schema:

{
  "ats_score": number,
  "missing_keywords": string[],
  "weak_sentences": [{"sentence": string, "rewrite": string}],
  "optimized_cv": string,
  "summary": string
}

HARD REQUIREMENTS:
- This is a GENERAL ATS REVIEW because no job description is provided.
- ats_score must be derived from these weighted components for a GENERAL ATS REVIEW:
  - Section completeness: 25
  - Clarity / readability: 20
  - Bullet strength: 20
  - ATS-safe formatting: 20
  - Core keyword coverage: 15
- First internally evaluate each component on a 0-100 scale.
- Then calculate the final ats_score as the weighted overall result.
- Return only the final ats_score number in JSON.
- Do not return the component scores unless explicitly requested.
- missing_keywords MUST include 25–35 items.
- These are NOT job-specific missing keywords. They must be recommended ATS/recruiter-friendly resume keywords based on the candidate's likely role, seniority, and experience.
- missing_keywords MUST be unique, practical, and written in ${outLang}.
- weak_sentences MUST include 12–18 items from the resume text, each with a materially stronger rewrite.
- Both sentence and rewrite MUST be in ${outLang}.
- Do NOT use shallow synonym swaps or near-duplicate rewrites.
- Each rewrite must improve at least two of these: clarity, ownership, specificity, scope, action strength, business context.
- weak_sentences.rewrite must feel materially stronger and more professional than sentence.
- If a sentence cannot be improved meaningfully, do not include it; choose a different one.
- summary MUST be detailed (8–14 bullet lines) in ${outLang} covering:
  1) general ATS readiness diagnosis
  2) top keyword gaps to improve
  3) biggest ATS/format risks
  4) top rewrite themes
- The summary should clearly reflect the weighted scoring logic and explain the biggest factors affecting the score.
- optimized_cv MUST be a complete rewritten ATS-friendly resume in ${outLang}.
- It must improve structure, clarity, section naming, bullet writing, and recruiter readability.
- Keep claims truthful. Do not invent employers, degrees, titles, dates, tools, or metrics.
- Do NOT mix languages.
- Do NOT invent or assume numbers/percentages/results. Use numbers ONLY if they exist in RESUME.
- If resume has no numbers, do NOT add any numbers in rewrites. Use scope + tools + outcome wording without numbers.

JSON STRICTNESS:
- KEYS must remain exactly: ats_score, missing_keywords, weak_sentences, optimized_cv, summary.
- Do NOT translate keys.
- No extra keys. No comments. No code fences.

Return ONLY valid JSON.

RESUME:
${cv}
`.trim();

    let userPrompt;
    if (reqMode === "linkedin") {
      userPrompt = isPreview ? linkedinPreviewUser : linkedinFullUser;
    } else {
      userPrompt = isPreview ? previewUser : fullUser;
    }

    const chosenSystem = reqMode === "linkedin" ? linkedinSystem : system;

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
        max_tokens: isPreview ? 900 : 1800,
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
        about: data?.about && typeof data.about === "object" ? data.about : {},
        experience_fix: Array.isArray(data?.experience_fix) ? data.experience_fix : [],
        skills: data?.skills && typeof data.skills === "object" ? data.skills : {},
        recruiter:
          data?.recruiter && typeof data.recruiter === "object" ? data.recruiter : {},
      };

      if (isPreview) {
        return res.status(200).json({
          headlines: out.headlines.slice(0, 1),
          about: { short: String(out.about.short || "") },
          experience_fix: out.experience_fix.slice(0, 1),
          skills: {
            top: Array.isArray(out.skills.top) ? out.skills.top.slice(0, 10) : [],
          },
          recruiter: {
            keywords: Array.isArray(out.recruiter.keywords)
              ? out.recruiter.keywords.slice(0, 8)
              : [],
          },
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
      await ensureMinDelay(startedAt, 15000);

      return res.status(200).json({
        ats_score: normalized.ats_score,
        summary: normalized.summary,
        missing_keywords: normalized.missing_keywords.slice(0, 5),
        weak_sentences: normalized.weak_sentences.slice(0, 2),
        review_mode: hasJD ? "job_specific" : "general",
      });
    }

    return res.status(200).json({
      ...normalized,
      review_mode: hasJD ? "job_specific" : "general",
    });
  } catch (err) {
    return res
      .status(500)
      .json({ error: "Server error", details: err?.message || String(err) });
  }
}
