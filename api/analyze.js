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
    .replace(/\r/g, "")
    .split("\n")
    .map((x) => x.trim())
    .filter((x) => /^[-•·‣▪▫◦]\s+/.test(x))
    .map((x) => x.replace(/^[-•·‣▪▫◦]\s+/, "").trim())
    .filter(Boolean);
}

function extractNumbers(str = "") {
  return new Set(String(str).match(/\b\d+(?:[.,]\d+)?\b/g) || []);
}

function hasInventedNumbers(originalCv = "", optimizedCv = "", jd = "") {
  const allowed = new Set([
    ...extractNumbers(originalCv),
    ...extractNumbers(jd),
  ]);

  for (const n of extractNumbers(optimizedCv)) {
    if (!allowed.has(n)) return true;
  }
  return false;
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

function countWeakVerbHits(text = "") {
  const bullets = getBulletLines(text);
  return bullets.filter((b) =>
    /\b(helped|assisted|supported|involved in|responsible for|contributed to|worked on|played a key role in|participated in|handled|destek verdim|katkı sağladım|görev aldım|yardımcı oldum|sorumluydum)\b/i.test(
      b
    )
  ).length;
}

function hasBasicUpgrade(original = "", optimized = "") {
  const basicRe =
    /\b(basic|temel|beginner|entry-level|introductory|foundation)\b/i;
  const strongRe =
    /\b(expert|advanced|uzman|uzmanlık|ileri|expertise|mastery)\b/i;

  return basicRe.test(original) && strongRe.test(optimized) && !strongRe.test(original);
}

function shouldRepairOptimizedCv(originalCv = "", optimizedCv = "", jd = "") {
  if (!optimizedCv || !String(optimizedCv).trim()) return true;

  const origNorm = normalizeCompareText(originalCv);
  const optNorm = normalizeCompareText(optimizedCv);

  if (!optNorm) return true;
  if (origNorm === optNorm) return true;
  if (hasInventedNumbers(originalCv, optimizedCv, jd)) return true;
  if (hasBasicUpgrade(originalCv, optimizedCv)) return true;

  const { same, total } = countUnchangedBullets(originalCv, optimizedCv);
  if (total > 0 && same / total >= 0.3) return true;

  if (countWeakVerbHits(optimizedCv) >= 1) return true;

  return false;
}

function uniqueStrings(items = [], limit = 999) {
  const out = [];
  const seen = new Set();

  for (const raw of items || []) {
    const value = String(raw || "").trim();
    if (!value) continue;

    const key = normalizeCompareText(value);
    if (!key || seen.has(key)) continue;

    seen.add(key);
    out.push(value);

    if (out.length >= limit) break;
  }

  return out;
}

function normalizeWeakSentences(items = [], limit = 999) {
  const out = [];
  const seen = new Set();

  for (const item of items || []) {
    if (!item || typeof item !== "object") continue;

    const sentence = String(item.sentence || "").trim();
    const rewrite = String(item.rewrite || "").trim();

    if (!sentence || !rewrite) continue;
    if (normalizeCompareText(sentence) === normalizeCompareText(rewrite)) continue;

    const key =
      `${normalizeCompareText(sentence)}__${normalizeCompareText(rewrite)}`;
    if (seen.has(key)) continue;

    seen.add(key);
    out.push({ sentence, rewrite });

    if (out.length >= limit) break;
  }

  return out;
}

function componentLabel(key) {
  const map = {
    jd_keyword_match: "JD keyword match",
    section_completeness: "Section completeness",
    bullet_strength: "Bullet strength",
    ats_safe_formatting: "ATS-safe formatting",
    role_alignment: "Role alignment",
    clarity_readability: "Clarity/readability",
    core_keyword_coverage: "Core keyword coverage",
  };
  return map[key] || key;
}

function getFocusAreas(componentScores = {}, hasJD) {
  const keys = hasJD
    ? [
        "jd_keyword_match",
        "section_completeness",
        "bullet_strength",
        "ats_safe_formatting",
        "role_alignment",
      ]
    : [
        "section_completeness",
        "clarity_readability",
        "bullet_strength",
        "ats_safe_formatting",
        "core_keyword_coverage",
      ];

  return keys
    .map((k) => ({ key: k, score: clampScore(componentScores?.[k]) }))
    .sort((a, b) => a.score - b.score)
    .slice(0, 3);
}

function minimumGainNeeded(originalScore, hasJD) {
  if (hasJD) {
    if (originalScore >= 85) return 3;
    if (originalScore >= 75) return 5;
    return 6;
  }

  if (originalScore >= 85) return 2;
  if (originalScore >= 75) return 4;
  return 5;
}

async function callOpenAIJson({
  apiKey,
  model,
  system,
  userPrompt,
  temperature = 0.1,
  maxTokens = 2800,
}) {
  const openaiRes = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model,
      temperature,
      response_format: { type: "json_object" },
      max_tokens: maxTokens,
      messages: [
        { role: "system", content: system },
        { role: "user", content: userPrompt },
      ],
    }),
  });

  const raw = await openaiRes.text();

  if (!openaiRes.ok) {
    const err = new Error("OpenAI error");
    err.status = openaiRes.status;
    err.details = raw.slice(0, 2000);
    throw err;
  }

  const parsed = JSON.parse(raw);
  const text = parsed?.choices?.[0]?.message?.content || "{}";
  return safeJsonParse(text);
}

function buildLinkedinSystem(outLang) {
  return `
CRITICAL RULES:
- Do NOT invent or assume ANY numbers, percentages, time periods, client names, revenue, KPIs, team size, budget, or results.
- Only use metrics explicitly present in the user's input text.
- If a bullet has no measurable metric, rewrite it using scope + actions + tools already present + context + outcome wording WITHOUT numbers.
- If the input contains a number, keep it exact.
- Do NOT invent employers, titles, dates, degrees, certifications, tools, platforms, or metrics.
- Do NOT replace generic platform language with a specific platform unless it is explicitly present.
- Do NOT upgrade support work into leadership unless clearly supported.

QUALITY STANDARD:
- Rewrites must be materially better than the original.
- Do NOT make shallow synonym swaps or near-duplicate rewrites.
- Each rewrite must improve at least two of these:
  clarity, ownership, specificity, scope, action strength, business context.

OUTPUT RULES:
- Return ONLY valid JSON.
- No markdown.
- No extra text.
- All output VALUES MUST be written ONLY in ${outLang}.
- No extra keys.
`.trim();
}

function buildLinkedinPreviewPrompt({
  cv,
  jd,
  outLang,
  liTargetRole,
  liSeniority,
  liIndustry,
  liLocation,
  liTone,
}) {
  return `
Return JSON in this exact schema:

{
  "headlines": [{"label": string, "text": string}],
  "about": { "short": string },
  "experience_fix": [{"before": string, "after": string, "why": string}],
  "skills": { "top": string[] },
  "recruiter": { "keywords": string[] }
}

RULES:
- Output VALUES must be in ${outLang}.
- headlines: exactly 1 item.
- about.short: 600–900 chars.
- experience_fix: exactly 1 item.
- "before" must be a real sentence from the resume.
- "after" must be materially stronger.
- skills.top: 7–10 items.
- recruiter.keywords: 5–8 items.
- No extra keys.

TARGETING META:
- target_role: ${liTargetRole || "(not provided)"}
- seniority: ${liSeniority}
- industry: ${liIndustry || "(not provided)"}
- location: ${liLocation || "(not provided)"}
- tone: ${liTone}

RESUME:
${cv}

TARGET ROLE / JOB (optional):
${jd || "(none)"}
`.trim();
}

function buildLinkedinFullPrompt({
  cv,
  jd,
  outLang,
  liTargetRole,
  liSeniority,
  liIndustry,
  liLocation,
  liTone,
}) {
  return `
Return JSON in this exact schema:

{
  "headlines": [{"label": string, "text": string}],
  "about": { "short": string, "normal": string, "bold": string },
  "experience_fix": [{"before": string, "after": string, "why": string}],
  "skills": { "top": string[], "tools": string[], "industry": string[] },
  "recruiter": { "keywords": string[], "boolean": string }
}

RULES:
- Output VALUES must be in ${outLang}.
- Do NOT invent employers, titles, dates, degrees, tools, or metrics.
- headlines: exactly 5 items.
- experience_fix: 4–6 items, only if genuinely stronger rewrites exist.
- Do NOT use near-duplicate rewrites.
- Return ONLY valid JSON. No extra keys.

TARGETING META:
- target_role: ${liTargetRole || "(not provided)"}
- seniority: ${liSeniority}
- industry: ${liIndustry || "(not provided)"}
- location: ${liLocation || "(not provided)"}
- tone: ${liTone}

RESUME:
${cv}

TARGET ROLE / JOB (optional):
${jd || "(none)"}
`.trim();
}

function buildAtsAnalyzeSystem(outLang) {
  return `
CRITICAL TRUTH RULES:
- Do NOT invent or assume ANY numbers, percentages, time periods, client names, revenue, KPIs, team size, budget, or results.
- Only use facts explicitly supported by the user's resume and, if present, the job description.
- Keep exact explicit facts unchanged. Example: if the resume says "6 years", keep "6 years".
- Do NOT invent employers, titles, degrees, dates, certifications, tools, platforms, channels, industries, or projects.
- Do NOT replace generic wording with a more specific platform or tool unless that exact platform/tool appears in the input.
- Example: if the resume says "social media platforms", do NOT rewrite it as "Meta" unless Meta is explicitly present.
- Do NOT upgrade proficiency levels. Example: if the resume says "basic data analysis", do NOT rewrite it as advanced expertise unless clearly supported.
- Do NOT silently turn the candidate into a more senior or more niche role than the resume supports.
- Use "led" ONLY if leadership is clearly supported by the input.

WEAK SENTENCE RULES:
- Only include truly weak sentences.
- Do NOT force padding.
- If there are fewer genuinely weak items, return fewer.
- Never include a before/after pair where the rewrite is only cosmetic.
- The rewrite must materially improve clarity, specificity, scope, action strength, business context, or recruiter readability.

SUMMARY RULES:
- The summary must reflect real strengths and weaknesses from the resume.
- The summary must explain the biggest reasons affecting the ATS score.

OUTPUT RULES:
- Return ONLY valid JSON.
- No markdown.
- No extra text.
- All output VALUES MUST be written ONLY in ${outLang}.
`.trim();
}

function buildAtsAnalyzePrompt({ cv, jd, hasJD, outLang, preview }) {
  if (hasJD) {
    return `
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

TASK:
- This is a JOB-SPECIFIC ATS MATCH because a job description is provided.
- Score the ORIGINAL resume only.
- Evaluate each component on a 0–100 scale:
  jd_keyword_match, section_completeness, bullet_strength, ats_safe_formatting, role_alignment.

REQUIREMENTS:
- missing_keywords MUST include ${
      preview ? "5–7" : "15–24"
    } genuinely missing or underrepresented terms from the JD.
- weak_sentences MUST include ${
      preview ? "up to 2" : "6–10"
    } items.
- Do NOT force the weak_sentences count if there are fewer truly weak items.
- summary MUST be ${preview ? "4–6" : "6–10"} bullet lines in ${outLang}.
- Do NOT add optimized_cv.

RESUME:
${cv}

JOB DESCRIPTION:
${jd}
`.trim();
  }

  return `
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

TASK:
- This is a GENERAL ATS REVIEW because no job description is provided.
- Score the ORIGINAL resume only.
- Evaluate each component on a 0–100 scale:
  section_completeness, clarity_readability, bullet_strength, ats_safe_formatting, core_keyword_coverage.

REQUIREMENTS:
- missing_keywords MUST include ${
    preview ? "5–7" : "15–24"
  } recommended ATS/recruiter-friendly keywords based on the candidate's apparent role and existing resume content.
- weak_sentences MUST include ${
    preview ? "up to 2" : "6–10"
  } items.
- Do NOT force the weak_sentences count if there are fewer truly weak items.
- summary MUST be ${preview ? "4–6" : "6–10"} bullet lines in ${outLang}.
- Do NOT add optimized_cv.

RESUME:
${cv}
`.trim();
}

function buildAtsOptimizeSystem(outLang) {
  return `
CRITICAL TRUTH RULES:
- Do NOT invent or assume ANY numbers, percentages, time periods, revenue, KPIs, team size, budget, clients, or results.
- Only use facts explicitly supported by the resume and, if present, the job description.
- Keep exact explicit facts intact, including years, titles, dates, employers, and education.
- Do NOT invent tools, platforms, channels, metrics, industries, or certifications.
- Do NOT replace generic wording with a specific tool/platform unless that exact term is present in the input.
- Do NOT upgrade a support task into leadership or ownership unless clearly supported.
- Do NOT upgrade "basic" skill wording into advanced expertise unless clearly supported.
- Do NOT silently rename the person's role into a stronger niche title unless the original resume already supports that exact role.

OPTIMIZATION GOAL:
- Produce a resume that is materially stronger than the original.
- Improve clarity, recruiter readability, bullet strength, section quality, ATS-safe structure, and real keyword coverage.
- If a JD exists, improve genuine JD alignment without inventing claims.
- If no JD exists, optimize the resume as a strong standalone ATS-friendly resume for the candidate's apparent role.

WRITING RULES:
- Avoid weak filler phrasing such as:
  helped, assisted, supported, contributed to, involved in, worked on, played a key role in, participated in, handled
- Prefer stronger truthful verbs such as:
  managed, executed, developed, coordinated, analyzed, optimized, collaborated, prepared, delivered, partnered
- Use "led" ONLY if leadership is clearly supported.
- Every bullet should be materially stronger than the original if a stronger truthful rewrite is possible.
- If a bullet cannot be materially improved without inventing facts, keep it clean and truthful rather than exaggerating.

OUTPUT RULES:
- Return ONLY valid JSON.
- No markdown.
- No extra text.
- All output VALUES MUST be written ONLY in ${outLang}.
`.trim();
}

function buildAtsOptimizePrompt({
  cv,
  jd,
  hasJD,
  outLang,
  originalScore,
  componentScores,
  missingKeywords,
  weakSentences,
}) {
  const focusAreas = getFocusAreas(componentScores, hasJD)
    .map((x) => `${componentLabel(x.key)}: ${x.score}`)
    .join(", ");

  const mk = uniqueStrings(missingKeywords, 15).join(" | ");
  const ws = normalizeWeakSentences(weakSentences, 8)
    .map((x) => `BEFORE: ${x.sentence}\nBETTER DIRECTION: ${x.rewrite}`)
    .join("\n\n");

  if (hasJD) {
    return `
Return JSON in this exact schema:

{
  "optimized_cv": string
}

TASK:
Rewrite the resume into a materially stronger ATS-friendly version aligned to the SAME job description.

PRIMARY TARGET:
- The optimized_cv should score meaningfully higher than the original resume when analyzed again against the same JD.
- Current original ATS score: ${originalScore}
- Lowest scoring areas to improve first: ${focusAreas}

OPTIMIZATION INPUT:
Top missing or underrepresented JD terms:
${mk || "(none)"}

Top weak sentence directions:
${ws || "(none)"}

STRICT RULES:
- Keep all claims truthful.
- Keep exact explicit facts intact.
- Do NOT invent metrics, tools, platforms, industries, or achievements.
- Do NOT add a keyword just because it appears in the JD unless it truthfully fits the candidate's real experience.
- Improve summary, bullets, and skills for stronger role alignment, cleaner ATS language, and better recruiter readability.
- Do NOT keyword-stuff.
- Do NOT output explanation.
- Output ONLY optimized_cv in ${outLang}.

RESUME:
${cv}

JOB DESCRIPTION:
${jd}
`.trim();
  }

  return `
Return JSON in this exact schema:

{
  "optimized_cv": string
}

TASK:
Rewrite the resume into a materially stronger ATS-friendly version without relying on a job description.

PRIMARY TARGET:
- The optimized_cv should score meaningfully higher than the original resume when analyzed again.
- Current original ATS score: ${originalScore}
- Lowest scoring areas to improve first: ${focusAreas}

OPTIMIZATION INPUT:
Top role-relevant missing keywords:
${mk || "(none)"}

Top weak sentence directions:
${ws || "(none)"}

STRICT RULES:
- Keep all claims truthful.
- Keep exact explicit facts intact.
- Do NOT invent metrics, tools, platforms, industries, or achievements.
- Use only skills, tools, and wording that are explicitly present or directly supported by the resume content.
- Improve summary, bullets, and skills for stronger ATS readability, better keyword coverage, and better recruiter clarity.
- Do NOT keyword-stuff.
- Do NOT output explanation.
- Output ONLY optimized_cv in ${outLang}.

RESUME:
${cv}
`.trim();
}

function buildAtsScoreSystem(outLang) {
  return `
You are a strict ATS scorer.

CRITICAL RULES:
- Score only the resume text provided.
- Be conservative and evidence-based.
- Do NOT invent facts.
- Do NOT explain anything outside JSON.
- All output VALUES MUST be written ONLY in ${outLang} except numeric values.
- Return ONLY valid JSON.
- No markdown.
- No extra text.
`.trim();
}

function buildAtsScorePrompt({ resumeText, jd, hasJD }) {
  if (hasJD) {
    return `
Return JSON in this exact schema:

{
  "component_scores": {
    "jd_keyword_match": number,
    "section_completeness": number,
    "bullet_strength": number,
    "ats_safe_formatting": number,
    "role_alignment": number
  }
}

Score the resume against the SAME job description on a 0–100 scale.

RESUME:
${resumeText}

JOB DESCRIPTION:
${jd}
`.trim();
  }

  return `
Return JSON in this exact schema:

{
  "component_scores": {
    "section_completeness": number,
    "clarity_readability": number,
    "bullet_strength": number,
    "ats_safe_formatting": number,
    "core_keyword_coverage": number
  }
}

Score the resume as a standalone ATS-friendly resume on a 0–100 scale.

RESUME:
${resumeText}
`.trim();
}

function buildAtsRepairSystem(outLang) {
  return `
CRITICAL RULES:
- Keep all facts truthful.
- Keep exact explicit facts unchanged in meaning.
- Do NOT invent metrics, tools, platforms, channels, industries, achievements, or seniority.
- Do NOT replace generic platform/channel wording with a more specific one unless explicitly present.
- Do NOT upgrade "basic" to advanced expertise unless clearly supported.
- Remove weak phrasing.
- Make the rewrite materially stronger than the original and the previous optimized version.
- Output ONLY valid JSON.
- No markdown.
- No extra text.
- All output VALUES MUST be written ONLY in ${outLang}.
`.trim();
}

function buildAtsRepairPrompt({
  cv,
  jd,
  hasJD,
  outLang,
  currentOptimizedCv,
  originalScore,
  currentScore,
  originalComponentScores,
  currentComponentScores,
  originalWeakSentences,
}) {
  const origFocus = getFocusAreas(originalComponentScores, hasJD)
    .map((x) => `${componentLabel(x.key)}: ${x.score}`)
    .join(", ");

  const currentFocus = getFocusAreas(currentComponentScores, hasJD)
    .map((x) => `${componentLabel(x.key)}: ${x.score}`)
    .join(", ");

  const ws = normalizeWeakSentences(originalWeakSentences, 8)
    .map((x) => `BEFORE: ${x.sentence}\nTARGET STYLE: ${x.rewrite}`)
    .join("\n\n");

  return `
Return JSON in this exact schema:

{
  "optimized_cv": string
}

TASK:
The previous optimized CV is still not good enough.
Rewrite it again so it becomes materially stronger, cleaner, more ATS-friendly, and more recruiter-ready.

TARGETS:
- Original score: ${originalScore}
- Current optimized score: ${currentScore}
- Original weak areas: ${origFocus || "(none)"}
- Current remaining weak areas: ${currentFocus || "(none)"}

ORIGINAL WEAK SENTENCE DIRECTION:
${ws || "(none)"}

STRICT RULES:
- Keep all facts truthful.
- Do NOT invent metrics, tools, platforms, industries, or achievements.
- Remove weak phrasing fully.
- Make bullets more specific and recruiter-ready without exaggeration.
- If a JD exists, improve real alignment without keyword stuffing.
- If no JD exists, improve standalone ATS quality without inventing role-specific claims.
- Output ONLY optimized_cv in ${outLang}.

ORIGINAL RESUME:
${cv}

${hasJD ? `JOB DESCRIPTION:\n${jd}\n` : ""}

CURRENT OPTIMIZED CV TO REWRITE:
${currentOptimizedCv}
`.trim();
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
      return res.status(500).json({
        error: "OPENAI_API_KEY is missing on Vercel",
      });
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

    const liMeta =
      linkedin_meta && typeof linkedin_meta === "object" ? linkedin_meta : {};
    const liTargetRole = String(liMeta.target_role || "").trim();
    const liSeniority = String(liMeta.seniority || "mid").trim();
    const liIndustry = String(liMeta.industry || "").trim();
    const liLocation = String(liMeta.location || "").trim();
    const liTone = String(liMeta.tone || "clean").trim();

    if (reqMode === "linkedin") {
      const system = buildLinkedinSystem(outLang);
      const userPrompt = isPreview
        ? buildLinkedinPreviewPrompt({
            cv,
            jd,
            outLang,
            liTargetRole,
            liSeniority,
            liIndustry,
            liLocation,
            liTone,
          })
        : buildLinkedinFullPrompt({
            cv,
            jd,
            outLang,
            liTargetRole,
            liSeniority,
            liIndustry,
            liLocation,
            liTone,
          });

      let data;
      try {
        data = await callOpenAIJson({
          apiKey,
          model,
          system,
          userPrompt,
          temperature: 0.1,
          maxTokens: isPreview ? 1200 : 2600,
        });
      } catch (err) {
        return res.status(err?.status || 500).json({
          error: err?.message || "OpenAI error",
          status: err?.status || 500,
          details: err?.details || String(err),
        });
      }

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

    // ATS FLOW
    const analyzeSystem = buildAtsAnalyzeSystem(outLang);

    let analysis;
    try {
      analysis = await callOpenAIJson({
        apiKey,
        model,
        system: analyzeSystem,
        userPrompt: buildAtsAnalyzePrompt({
          cv,
          jd,
          hasJD,
          outLang,
          preview: isPreview,
        }),
        temperature: 0.1,
        maxTokens: isPreview ? 1300 : 2200,
      });
    } catch (err) {
      return res.status(err?.status || 500).json({
        error: err?.message || "OpenAI error",
        status: err?.status || 500,
        details: err?.details || String(err),
      });
    }

    const originalComponentScores =
      analysis?.component_scores && typeof analysis.component_scores === "object"
        ? analysis.component_scores
        : {};

    const originalScore = computeWeightedScore(originalComponentScores, hasJD);

    const normalizedBase = {
      ats_score: originalScore,
      component_scores: originalComponentScores,
      missing_keywords: uniqueStrings(
        Array.isArray(analysis?.missing_keywords) ? analysis.missing_keywords : [],
        isPreview ? 7 : 24
      ),
      weak_sentences: normalizeWeakSentences(
        Array.isArray(analysis?.weak_sentences) ? analysis.weak_sentences : [],
        isPreview ? 2 : 10
      ),
      summary: typeof analysis?.summary === "string" ? analysis.summary.trim() : "",
    };

    if (isPreview) {
      await ensureMinDelay(startedAt, 15000);

      return res.status(200).json({
        ats_score: normalizedBase.ats_score,
        summary: normalizedBase.summary,
        missing_keywords: normalizedBase.missing_keywords.slice(0, 5),
        weak_sentences: normalizedBase.weak_sentences.slice(0, 2),
        review_mode: hasJD ? "job_specific" : "general",
      });
    }

    // FULL ATS: optimize -> rescore -> repair if needed
    let bestOptimizedCv = "";
    let bestOptimizedScore = -1;
    let bestOptimizedComponentScores = {};
    const minGain = minimumGainNeeded(originalScore, hasJD);

    try {
      const optimizeData = await callOpenAIJson({
        apiKey,
        model,
        system: buildAtsOptimizeSystem(outLang),
        userPrompt: buildAtsOptimizePrompt({
          cv,
          jd,
          hasJD,
          outLang,
          originalScore,
          componentScores: originalComponentScores,
          missingKeywords: normalizedBase.missing_keywords,
          weakSentences: normalizedBase.weak_sentences,
        }),
        temperature: 0.1,
        maxTokens: 2600,
      });

      if (typeof optimizeData?.optimized_cv === "string" && optimizeData.optimized_cv.trim()) {
        bestOptimizedCv = optimizeData.optimized_cv.trim();
      }
    } catch (err) {
      return res.status(err?.status || 500).json({
        error: err?.message || "OpenAI error",
        status: err?.status || 500,
        details: err?.details || String(err),
      });
    }

    async function scoreCandidate(resumeText) {
      const scored = await callOpenAIJson({
        apiKey,
        model,
        system: buildAtsScoreSystem(outLang),
        userPrompt: buildAtsScorePrompt({
          resumeText,
          jd,
          hasJD,
        }),
        temperature: 0.1,
        maxTokens: 800,
      });

      const componentScores =
        scored?.component_scores && typeof scored.component_scores === "object"
          ? scored.component_scores
          : {};

      return {
        componentScores,
        score: computeWeightedScore(componentScores, hasJD),
      };
    }

    if (bestOptimizedCv) {
      try {
        const firstScore = await scoreCandidate(bestOptimizedCv);
        bestOptimizedScore = firstScore.score;
        bestOptimizedComponentScores = firstScore.componentScores;
      } catch {
        bestOptimizedScore = -1;
      }
    }

    let candidateCv = bestOptimizedCv;
    let candidateScore = bestOptimizedScore;
    let candidateComponentScores = bestOptimizedComponentScores;

    let attempts = 0;
    while (
      candidateCv &&
      attempts < 2 &&
      (
        candidateScore < originalScore + minGain ||
        shouldRepairOptimizedCv(cv, candidateCv, jd || "")
      )
    ) {
      attempts += 1;

      try {
        const repaired = await callOpenAIJson({
          apiKey,
          model,
          system: buildAtsRepairSystem(outLang),
          userPrompt: buildAtsRepairPrompt({
            cv,
            jd,
            hasJD,
            outLang,
            currentOptimizedCv: candidateCv,
            originalScore,
            currentScore: candidateScore,
            originalComponentScores,
            currentComponentScores: candidateComponentScores,
            originalWeakSentences: normalizedBase.weak_sentences,
          }),
          temperature: 0.1,
          maxTokens: 2600,
        });

        const repairedCv =
          typeof repaired?.optimized_cv === "string" ? repaired.optimized_cv.trim() : "";

        if (!repairedCv) break;

        const repairedScoreData = await scoreCandidate(repairedCv);
        const repairedScore = repairedScoreData.score;

        if (repairedScore > bestOptimizedScore) {
          bestOptimizedCv = repairedCv;
          bestOptimizedScore = repairedScore;
          bestOptimizedComponentScores = repairedScoreData.componentScores;
        }

        candidateCv = repairedCv;
        candidateScore = repairedScore;
        candidateComponentScores = repairedScoreData.componentScores;
      } catch {
        break;
      }
    }

    const finalOptimizedCv = bestOptimizedCv || candidateCv || "";
    const finalOutput = {
      ats_score: normalizedBase.ats_score,
      missing_keywords: normalizedBase.missing_keywords,
      weak_sentences: normalizedBase.weak_sentences,
      optimized_cv: finalOptimizedCv,
      summary: normalizedBase.summary,
      review_mode: hasJD ? "job_specific" : "general",
    };

    return res.status(200).json(finalOutput);
  } catch (err) {
    return res.status(500).json({
      error: "Server error",
      details: err?.message || String(err),
    });
  }
}
