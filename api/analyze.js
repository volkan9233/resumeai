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
  const expected = crypto
    .createHmac("sha256", appSecret)
    .update(data)
    .digest("base64url");

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

function clampScore(n) {
  const x = Number(n);
  if (!Number.isFinite(x)) return 0;
  return Math.max(0, Math.min(100, Math.round(x)));
}

function computeWeightedScore(componentScores, hasJD) {
  if (hasJD) {
    const jd_keyword_match = clampScore(componentScores?.jd_keyword_match);
    const section_completeness = clampScore(componentScores?.section_completeness);
    const bullet_strength = clampScore(componentScores?.bullet_strength);
    const ats_safe_formatting = clampScore(componentScores?.ats_safe_formatting);
    const role_alignment = clampScore(componentScores?.role_alignment);

    const score =
      jd_keyword_match * 0.35 +
      section_completeness * 0.15 +
      bullet_strength * 0.2 +
      ats_safe_formatting * 0.15 +
      role_alignment * 0.15;

    return clampScore(score);
  }

  const section_completeness = clampScore(componentScores?.section_completeness);
  const clarity_readability = clampScore(componentScores?.clarity_readability);
  const bullet_strength = clampScore(componentScores?.bullet_strength);
  const ats_safe_formatting = clampScore(componentScores?.ats_safe_formatting);
  const core_keyword_coverage = clampScore(componentScores?.core_keyword_coverage);

  const score =
    section_completeness * 0.25 +
    clarity_readability * 0.2 +
    bullet_strength * 0.2 +
    ats_safe_formatting * 0.2 +
    core_keyword_coverage * 0.15;

  return clampScore(score);
}

function safeJsonParse(text) {
  try {
    return JSON.parse(text);
  } catch {
    const s = String(text || "");
    const start = s.indexOf("{");
    const end = s.lastIndexOf("}");
    if (start !== -1 && end !== -1 && end > start) {
      return JSON.parse(s.slice(start, end + 1));
    }
    throw new Error("Model did not return valid JSON");
  }
}

function normalizeCompareText(str = "") {
  return String(str)
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[^\p{L}\p{N}\s-]/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function getBulletLines(str = "") {
  return String(str)
    .split("\n")
    .map((x) => x.trim())
    .filter((x) => /^[-•·‣▪▫◦]\s+/.test(x))
    .map((x) => x.replace(/^[-•·‣▪▫◦]\s+/, "").trim())
    .filter(Boolean);
}

function countUnchangedBullets(originalCv = "", optimizedCv = "") {
  const orig = getBulletLines(originalCv).map(normalizeCompareText).filter(Boolean);
  const optSet = new Set(
    getBulletLines(optimizedCv).map(normalizeCompareText).filter(Boolean)
  );

  let same = 0;
  for (const line of orig) {
    if (optSet.has(line)) same++;
  }
  return { same, total: orig.length };
}

function shouldRepairOptimizedCv(originalCv = "", optimizedCv = "") {
  if (!optimizedCv || !String(optimizedCv).trim()) return true;

  const origNorm = normalizeCompareText(originalCv);
  const optNorm = normalizeCompareText(optimizedCv);

  if (!optNorm) return true;
  if (origNorm === optNorm) return true;

  const { same, total } = countUnchangedBullets(originalCv, optimizedCv);
  if (total > 0 && same / total >= 0.3) return true;

  const optimizedBullets = getBulletLines(optimizedCv);
  if (total > 0 && optimizedBullets.length < Math.max(2, Math.floor(total * 0.85))) {
    return true;
  }

  const weakVerbHits = optimizedBullets.filter((b) =>
    /\b(helped|assisted|supported|involved in|responsible for|contributed to|worked on|played a key role in|participated in|handled)\b/i.test(
      b
    )
  ).length;

  if (weakVerbHits >= 2) return true;

  return false;
}

async function callOpenAIJson({
  apiKey,
  model,
  system,
  userPrompt,
  reasoningEffort = "medium",
  maxTokens = 3200,
}) {
  const body = {
    model,
    reasoning_effort: reasoningEffort,
    response_format: { type: "json_object" },
    max_completion_tokens: maxTokens,
    messages: [
      { role: "system", content: system },
      { role: "user", content: userPrompt },
    ],
  };

  const openaiRes = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  });

  const raw = await openaiRes.text();

  if (!openaiRes.ok) {
    const err = new Error("OpenAI error");
    err.status = openaiRes.status;
    err.details = raw.slice(0, 3000);
    throw err;
  }

  const parsed = JSON.parse(raw);
  const text = parsed?.choices?.[0]?.message?.content || "{}";
  return safeJsonParse(text);
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

    if (!cv || !String(cv).trim()) {
      return res.status(400).json({ error: "cv is required" });
    }

    const apiKey = process.env.OPENAI_API_KEY;
    if (!apiKey) {
      return res
        .status(500)
        .json({ error: "OPENAI_API_KEY is missing on Vercel" });
    }

    const model = process.env.OPENAI_MODEL || "gpt-5.1";

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

    const reasoningEffort = isPreview ? "medium" : "high";

    const system = `
CRITICAL TRUTH RULES:
- Only use facts explicitly supported by the user's resume and, if present, the job description.
- Do NOT invent or assume ANY numbers, percentages, time periods, team size, clients, budget size, revenue, KPIs, results, or business impact.
- If the resume states an explicit duration such as "6 years", keep it exact. Do NOT convert it into "5+ years" or any other variation.
- Keep the person's name, top title, location, email, company names, job titles, dates, degrees, and education wording factually faithful to the input.
- Do NOT retitle the candidate into a narrower or more senior role unless that exact title already exists in the input.
- Do NOT invent employers, titles, dates, certifications, tools, platforms, channels, industries, or projects.
- Do NOT replace generic wording with a specific platform/tool unless that platform/tool is explicitly present in the input.
- Example: if the resume says "social media", do NOT rewrite it as "Meta" unless Meta is explicitly present.
- Do NOT introduce terms such as CAC, ROI, ROAS, CRO, funnel optimization, lifecycle marketing, attribution, A/B testing, or conversion tracking unless they are explicitly supported by the input resume or job description.
- Do NOT upgrade proficiency levels. Example: if the resume says "basic data analysis", do NOT rewrite it as advanced "data analysis expertise" unless clearly supported.
- You may strengthen support-type work, but do NOT convert support into ownership, leadership, or independent strategy ownership unless clearly supported by the input.
- Use "led" ONLY if leadership is explicitly or very clearly supported.
- If a bullet has no measurable metric, rewrite it using:
  action + scope + context/tool/channel + business purpose
  WITHOUT numbers.

QUALITY RULES:
- Rewrites must be materially better than the original.
- Do NOT make shallow synonym swaps or near-duplicate rewrites.
- Each rewrite must improve at least two of these:
  clarity, ownership, specificity, scope, action strength, business context, recruiter readability.
- If a rewrite is too similar to the original, rewrite it again more strongly.
- Prefer direct, recruiter-ready phrasing over vague corporate language.
- Avoid generic filler phrases such as:
  helped improve
  worked closely with
  responsible for
  involved in
  contributed to
  assisted with
  participated in
  played a key role in
  handled
  supported
- Replace weak verbs with stronger truth-preserving verbs only when justified by the original text, such as:
  managed, executed, developed, coordinated, delivered, analyzed, optimized, partnered, prepared, collaborated.
- Do not use inflated language that invents seniority, scope, authority, or outcomes.

OPTIMIZED CV RULES:
- optimized_cv MUST NOT feel like a lightly polished copy of the original resume.
- Every experience bullet in optimized_cv should be rewritten to sound more specific, action-oriented, recruiter-ready, and ATS-friendly while staying factually faithful.
- Keep the same role structure and preserve the same number of bullets per role whenever possible.
- Do not merge multiple original bullets into one unless absolutely necessary.
- Do not preserve weak wording when a stronger truthful rewrite is possible.
- Prefer this pattern when no metrics exist:
  action verb + what was handled + context/channel/tool + business purpose
- Even without numbers, bullets should sound concrete and professionally scoped.
- Avoid copying original bullets unless they are already highly optimized.
- Keep bullets concise, clean, and recruiter-friendly.

WEAK SENTENCE RULES:
- Only output weak_sentences when the rewrite is genuinely stronger.
- If there are not enough strong candidates, return fewer items.
- Quality is more important than quantity.

SUMMARY RULES:
- The summary should reflect real strengths and weaknesses from the resume.
- The summary must explain the biggest reasons affecting the ATS score.

OUTPUT RULES:
- You are an ATS resume analyzer and resume rewriter.
- Return ONLY valid JSON.
- No markdown.
- No extra text.
- All output VALUES MUST be written ONLY in ${outLang}. Do not mix languages.
- This includes: missing_keywords items, weak_sentences.sentence, weak_sentences.rewrite, summary, optimized_cv.
- Do not add any extra keys except component_scores when requested.
`.trim();

    const linkedinSystem = `
CRITICAL RULES:
- Only use facts explicitly supported by the user's resume and, if present, the job description.
- Do NOT invent or assume ANY numbers, percentages, time periods, client names, revenue, KPIs, team size, budget size, or results.
- Keep exact years of experience unchanged if explicitly stated.
- Do NOT invent employers, titles, dates, certifications, tools, industries, or metrics.
- Do NOT replace generic platform language with a specific platform unless explicitly present.
- Do NOT introduce CAC, ROI, CRO, ROAS, attribution, lifecycle, or similar terms unless explicitly supported by the input.
- If a bullet has no measurable metric, rewrite it using stronger scope + context + business-purpose wording WITHOUT numbers.

FOR BEFORE → AFTER REWRITES:
- AFTER must preserve factual truth.
- AFTER can improve clarity and strength but must not add new facts.
- If BEFORE has no metric, AFTER must not contain any invented metric.

QUALITY:
- Rewrites must be materially better than the original.
- Do NOT make shallow synonym swaps or near-duplicate rewrites.
- Each rewrite must improve at least two of these:
  clarity, ownership, specificity, scope, action strength, business context.
- If a rewrite is too similar to the original, rewrite it again more strongly.

You are a LinkedIn profile optimization expert.
Return ONLY valid JSON. No markdown. No extra text.
CRITICAL: All output VALUES MUST be written ONLY in ${outLang}. Do not mix languages.
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
- experience_fix: 0 or 1 item only. Choose only if a materially stronger rewrite is possible.
- "before" must be a real bullet/sentence from the resume.
- "after" must be materially stronger than "before", not a light synonym swap.
- skills.top: 7–10 items.
- recruiter.keywords: 5–8 items.
- No extra keys. Return ONLY valid JSON.

TARGETING META:
- target_role: ${liTargetRole || "(not provided)"}
- seniority: ${liSeniority}
- industry: ${liIndustry || "(not provided)"}
- location: ${liLocation || "(not provided)"}
- tone: ${liTone}

HARD RULE:
- If target_role is provided, tailor every output to that role and seniority. Prefer role-specific keywords only where truthfully supported.

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
- Do NOT invent employers, titles, dates, degrees, tools, industries, or metrics.
- Headline max 220 chars each. No emojis.
- About:
  - short: 500–800 chars
  - normal: 900–1400 chars
  - bold: 900–1400 chars
- headlines: exactly 5 items with labels:
  1) "Search"
  2) "Impact"
  3) "Niche"
  4) "Leadership"
  5) "Clean"
- experience_fix: 3–6 items, but only include genuinely improvable lines.
- Each "before" must be from the resume text.
- Each "after" must be LinkedIn-ready and materially stronger.
- Do NOT use shallow synonym swaps or near-duplicate rewrites.
- skills.top: 12–18
- skills.tools: 8–16
- skills.industry: 12–20
- recruiter.keywords: 10–20
- recruiter.boolean: a single boolean string ready to paste in LinkedIn Recruiter.
- Return ONLY valid JSON. No extra keys.

TARGETING META:
- target_role: ${liTargetRole || "(not provided)"}
- seniority: ${liSeniority}
- industry: ${liIndustry || "(not provided)"}
- location: ${liLocation || "(not provided)"}
- tone: ${liTone}

HARD RULE:
- If target_role is provided, every headline + about + skills + recruiter keywords MUST align to target_role + seniority, but only where truthfully supported by the resume.

RESUME:
${cv}

TARGET ROLE / JOB (optional):
${jd || "(none)"}
`.trim();

    const previewUser = hasJD
      ? `
Return JSON in this exact schema:

{
  "component_scores": {
    "jd_keyword_match": number,
    "section_completeness": number,
    "bullet_strength": number,
    "ats_safe_formatting": number,
    "role_alignment": number
  },
  "missing_keywords": string[],
  "weak_sentences": [{"sentence": string, "rewrite": string}],
  "summary": string
}

REQUIREMENTS:
- This is a JOB-SPECIFIC ATS MATCH because a job description is provided.
- Evaluate each component score on a 0-100 scale:
  - jd_keyword_match
  - section_completeness
  - bullet_strength
  - ats_safe_formatting
  - role_alignment
- component_scores must reflect real resume-to-job alignment.
- missing_keywords MUST include exactly 5-7 items genuinely missing or underrepresented from the JOB DESCRIPTION.
- missing_keywords MUST be unique, role-relevant, practical, and written in ${outLang}.

WEAK SENTENCE RULES:
- weak_sentences MUST include 0-2 items only.
- Choose only sentences where a clearly stronger rewrite is possible.
- Both sentence and rewrite MUST be in ${outLang}.
- Do NOT include a weak sentence if the rewrite is only a tiny synonym swap.
- The rewrite must materially improve the original.
- If there are not enough strong candidates, return fewer items.

SUMMARY RULES:
- summary MUST be 4–6 bullet lines in ${outLang}.
- summary must focus on job fit, biggest missing keywords, ATS risks, and top improvements.
- Do NOT add optimized_cv.

Return ONLY valid JSON.

RESUME:
${cv}

JOB DESCRIPTION:
${jd}
`.trim()
      : `
Return JSON in this exact schema:

{
  "component_scores": {
    "section_completeness": number,
    "clarity_readability": number,
    "bullet_strength": number,
    "ats_safe_formatting": number,
    "core_keyword_coverage": number
  },
  "missing_keywords": string[],
  "weak_sentences": [{"sentence": string, "rewrite": string}],
  "summary": string
}

REQUIREMENTS:
- This is a GENERAL ATS REVIEW because no job description is provided.
- Evaluate each component score on a 0-100 scale:
  - section_completeness
  - clarity_readability
  - bullet_strength
  - ats_safe_formatting
  - core_keyword_coverage
- missing_keywords MUST include exactly 5-7 items.
- These are NOT job-specific missing keywords.
- They should be recommended ATS/recruiter-friendly resume terms based on the candidate's apparent role and existing experience.
- missing_keywords MUST be unique, practical, role-relevant, and written in ${outLang}.

WEAK SENTENCE RULES:
- weak_sentences MUST include 0-2 items only.
- Choose only sentences where a clearly stronger rewrite is possible.
- Both sentence and rewrite MUST be in ${outLang}.
- Do NOT include a weak sentence if the rewrite is only a tiny synonym swap.
- The rewrite must materially improve the original.
- If there are not enough strong candidates, return fewer items.

SUMMARY RULES:
- summary MUST be 4–6 bullet lines in ${outLang}.
- summary must focus on general ATS readiness, structure, clarity, and top improvement areas.
- Do NOT add optimized_cv.

Return ONLY valid JSON.

RESUME:
${cv}
`.trim();

    const fullUser = hasJD
      ? `
Analyze the resume vs job description and return JSON in this exact schema:

{
  "component_scores": {
    "jd_keyword_match": number,
    "section_completeness": number,
    "bullet_strength": number,
    "ats_safe_formatting": number,
    "role_alignment": number
  },
  "missing_keywords": string[],
  "weak_sentences": [{"sentence": string, "rewrite": string}],
  "optimized_cv": string,
  "summary": string
}

PRIMARY OBJECTIVE:
- The optimized_cv must materially improve ATS alignment for THIS SAME job description.
- If this optimized_cv is analyzed again against the same JD, it should score meaningfully higher than the original resume.
- Do not merely polish wording. Improve keyword coverage, role alignment, section strength, recruiter clarity, and ATS relevance while staying truthful.

HARD REQUIREMENTS:
- This is a JOB-SPECIFIC ATS MATCH because a job description is provided.
- Evaluate each component score on a 0-100 scale:
  - jd_keyword_match
  - section_completeness
  - bullet_strength
  - ats_safe_formatting
  - role_alignment

MISSING KEYWORDS:
- missing_keywords MUST include 25–35 items genuinely missing or underrepresented from the JOB DESCRIPTION.
- missing_keywords MUST be unique, role-relevant, practical, and written in ${outLang}.
- Prefer the most score-impacting missing terms first.
- Do NOT include generic fluff unless clearly relevant in the JD.

WEAK SENTENCES:
- weak_sentences should include 6–12 items only if they are genuinely improvable.
- Fewer is allowed if quality would drop.
- Both sentence and rewrite MUST be in ${outLang}.
- Only include a weak sentence if the rewrite materially improves it.
- Do NOT use shallow synonym swaps, cosmetic rewrites, or near-duplicate rewrites.

OPTIMIZED_CV RULES:
- optimized_cv MUST be a complete rewritten resume aligned to the job description and written in ${outLang}.
- optimized_cv MUST NOT be a lightly edited version of the original resume.
- Preserve truthful facts only.
- Keep the candidate top title and each job title factually faithful to the input.
- Keep exact durations unchanged.
- Preserve the same number of bullets per role whenever possible.
- Use clean ATS-friendly structure.
- Rewrite the summary so it clearly aligns the candidate to the target role in the JD.
- Naturally include high-value JD language ONLY where truthfully supported.
- Do not add fake achievements, fake platforms, fake tools, fake metrics, or fake ownership.

EXPERIENCE BULLET RULES:
- Every bullet should be stronger, cleaner, and more recruiter-ready than the original.
- Prefer direct action verbs such as:
  managed, executed, developed, optimized, coordinated, analyzed, improved, delivered, partnered, collaborated, prepared.
- Use "led" ONLY if leadership is clearly supported.
- Do NOT replace a generic platform/channel with a specific one unless explicitly present in the input.

SKILLS RULES:
- Update the skills section to better reflect JD relevance.
- Include high-value relevant terms from the JD only where supportable by the resume content.
- Do not invent tools or platforms the candidate never used.

SUMMARY OUTPUT RULES:
- summary MUST be detailed (8–14 bullet lines) in ${outLang} covering:
  1) overall job-fit diagnosis
  2) top missing skills/keywords to add
  3) biggest ATS/format risks
  4) top rewrite themes
  5) why the optimized version should score better

JSON STRICTNESS:
- KEYS must remain exactly: component_scores, missing_keywords, weak_sentences, optimized_cv, summary.
- No extra keys.
- No comments.
- No markdown.

RESUME:
${cv}

JOB DESCRIPTION:
${jd}
`.trim()
      : `
Analyze the resume and return JSON in this exact schema:

{
  "component_scores": {
    "section_completeness": number,
    "clarity_readability": number,
    "bullet_strength": number,
    "ats_safe_formatting": number,
    "core_keyword_coverage": number
  },
  "missing_keywords": string[],
  "weak_sentences": [{"sentence": string, "rewrite": string}],
  "optimized_cv": string,
  "summary": string
}

PRIMARY OBJECTIVE:
- The optimized_cv must materially improve ATS readiness even without a job description.
- Do not merely polish wording.
- Improve structure, clarity, recruiter readability, keyword strength, bullet quality, and overall role fit based on the resume’s own content.

HARD REQUIREMENTS:
- This is a GENERAL ATS REVIEW because no job description is provided.
- Evaluate each component score on a 0-100 scale:
  - section_completeness
  - clarity_readability
  - bullet_strength
  - ats_safe_formatting
  - core_keyword_coverage

MISSING KEYWORDS:
- missing_keywords MUST include 25–35 items.
- These are NOT job-specific missing keywords.
- They must be recommended ATS/recruiter-friendly keywords based on the candidate’s likely role, seniority, and experience already visible in the resume.
- missing_keywords MUST be unique, practical, and written in ${outLang}.

WEAK SENTENCES:
- weak_sentences should include 6–12 items only if they are genuinely improvable.
- Fewer is allowed if quality would drop.
- Both sentence and rewrite MUST be in ${outLang}.
- Only include a weak sentence if the rewrite materially improves it.
- Do NOT use shallow synonym swaps, cosmetic rewrites, or near-duplicate rewrites.

OPTIMIZED_CV RULES:
- optimized_cv MUST be a complete rewritten ATS-friendly resume in ${outLang}.
- optimized_cv MUST NOT be a lightly edited version of the original resume.
- Preserve truthful information only.
- Keep the candidate top title and each job title factually faithful to the input.
- Keep exact durations unchanged.
- Preserve the same number of bullets per role whenever possible.
- Use clear ATS-friendly sections supported by the input.
- Rewrite the summary to sound more role-focused, recruiter-ready, and keyword-aware.
- Do not invent achievements, tools, domain experience, or scale.
- Do NOT replace a generic platform/channel with a more specific one unless explicitly present.
- Do NOT upgrade a "basic" skill level into advanced expertise unless clearly supported.

EXPERIENCE BULLET RULES:
- Every bullet should be rewritten with stronger, cleaner recruiter-ready phrasing.
- Prefer direct action verbs such as:
  managed, executed, developed, optimized, coordinated, analyzed, improved, delivered, partnered, collaborated, prepared.
- Use "led" ONLY if leadership is clearly supported.
- If the original bullet is vague, rewrite it into a sharper professional statement WITHOUT inventing metrics.

SKILLS RULES:
- Update the skills section to better reflect the candidate’s likely role.
- Prefer recruiter- and ATS-friendly phrasing.
- Add strong general role-relevant terms only where clearly compatible with the resume content.
- Do not invent tools or platforms the candidate never used.

SUMMARY OUTPUT RULES:
- summary MUST be detailed (8–14 bullet lines) in ${outLang} covering:
  1) general ATS readiness diagnosis
  2) top keyword gaps to improve
  3) biggest ATS/format risks
  4) top rewrite themes
  5) why the optimized version is stronger

JSON STRICTNESS:
- KEYS must remain exactly: component_scores, missing_keywords, weak_sentences, optimized_cv, summary.
- No extra keys.
- No comments.
- No markdown.

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

    let data;
    try {
      data = await callOpenAIJson({
        apiKey,
        model,
        system: chosenSystem,
        userPrompt,
        reasoningEffort,
        maxTokens: isPreview ? 1800 : 4200,
      });
    } catch (err) {
      return res.status(err?.status || 500).json({
        error: err?.message || "OpenAI error",
        status: err?.status || 500,
        details: err?.details || String(err),
      });
    }

    if (reqMode === "linkedin") {
      const out = {
        headlines: Array.isArray(data?.headlines) ? data.headlines : [],
        about: data?.about && typeof data.about === "object" ? data.about : {},
        experience_fix: Array.isArray(data?.experience_fix)
          ? data.experience_fix
          : [],
        skills: data?.skills && typeof data.skills === "object" ? data.skills : {},
        recruiter:
          data?.recruiter && typeof data.recruiter === "object"
            ? data.recruiter
            : {},
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

    const componentScores =
      data?.component_scores && typeof data.component_scores === "object"
        ? data.component_scores
        : {};

    const finalScore = computeWeightedScore(componentScores, hasJD);

    const normalized = {
      ats_score: finalScore,
      component_scores: componentScores,
      missing_keywords: Array.isArray(data?.missing_keywords)
        ? data.missing_keywords
        : [],
      weak_sentences: Array.isArray(data?.weak_sentences)
        ? data.weak_sentences
        : [],
      summary: typeof data?.summary === "string" ? data.summary : "",
      ...(isPreview
        ? {}
        : {
            optimized_cv:
              typeof data?.optimized_cv === "string" ? data.optimized_cv.trim() : "",
          }),
    };

    if (
      !isPreview &&
      normalized.optimized_cv &&
      shouldRepairOptimizedCv(cv, normalized.optimized_cv)
    ) {
      const repairPrompt = hasJD
        ? `
Return JSON in this exact schema:

{
  "optimized_cv": string
}

TASK:
You already generated an optimized resume, but it is still too close to the original or still contains weak phrasing.
Rewrite it again so the result is materially stronger, cleaner, more ATS-friendly, and more recruiter-ready.

STRICT RULES:
- Keep all facts truthful.
- Keep exact years of experience, dates, employers, titles, degrees, location, and education wording factually faithful to the original input.
- Do NOT invent metrics, tools, platforms, acronyms, or achievements.
- Do NOT replace generic wording with specific tools/platforms unless explicitly present in the original input.
- Do NOT introduce Meta, CAC, ROI, CRO, ROAS, attribution, or similar terms unless explicitly present in the original resume or JD.
- Do NOT upgrade "basic" skills into advanced expertise unless clearly supported.
- Preserve the same number of bullets per role whenever possible.
- Every experience bullet must be materially stronger than the original bullet.
- Avoid weak phrases:
  helped, assisted, supported, involved in, responsible for, contributed to, worked on, played a key role in, participated in, handled
- Prefer direct action + scope + business context wording.
- The result must not read like a lightly polished copy.
- The result must still be a truthful ATS-friendly resume aligned to the job description.

RESUME (original):
${cv}

JOB DESCRIPTION:
${jd}

CURRENT OPTIMIZED CV (rewrite this into a stronger final version):
${normalized.optimized_cv}
`.trim()
        : `
Return JSON in this exact schema:

{
  "optimized_cv": string
}

TASK:
You already generated an optimized resume, but it is still too close to the original or still contains weak phrasing.
Rewrite it again so the result is materially stronger, cleaner, more ATS-friendly, and more recruiter-ready.

STRICT RULES:
- Keep all facts truthful.
- Keep exact years of experience, dates, employers, titles, degrees, location, and education wording factually faithful to the original input.
- Do NOT invent metrics, tools, platforms, acronyms, or achievements.
- Do NOT replace generic wording with specific tools/platforms unless explicitly present in the original input.
- Do NOT introduce Meta, CAC, ROI, CRO, ROAS, attribution, or similar terms unless explicitly present in the original resume.
- Do NOT upgrade "basic" skills into advanced expertise unless clearly supported.
- This is GENERAL optimization without a job description.
- Optimize for ATS readiness and recruiter clarity based on the resume’s own content and apparent role.
- Preserve the same number of bullets per role whenever possible.
- Every experience bullet must be materially stronger than the original bullet.
- Avoid weak phrases:
  helped, assisted, supported, involved in, responsible for, contributed to, worked on, played a key role in, participated in, handled
- Prefer direct action + scope + business context wording.
- The result must not read like a lightly polished copy.

RESUME (original):
${cv}

CURRENT OPTIMIZED CV (rewrite this into a stronger final version):
${normalized.optimized_cv}
`.trim();

      try {
        const repaired = await callOpenAIJson({
          apiKey,
          model,
          system,
          userPrompt: repairPrompt,
          reasoningEffort: "high",
          maxTokens: 3200,
        });

        if (typeof repaired?.optimized_cv === "string" && repaired.optimized_cv.trim()) {
          normalized.optimized_cv = repaired.optimized_cv.trim();
        }
      } catch {
        // İlk sürüm kullanılmaya devam eder
      }
    }

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
      ats_score: normalized.ats_score,
      missing_keywords: normalized.missing_keywords,
      weak_sentences: normalized.weak_sentences,
      optimized_cv: normalized.optimized_cv,
      summary: normalized.summary,
      review_mode: hasJD ? "job_specific" : "general",
    });
  } catch (err) {
    return res.status(500).json({
      error: "Server error",
      details: err?.message || String(err),
    });
  }
}
