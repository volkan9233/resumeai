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

function getNonEmptyLines(str = "") {
  return String(str)
    .replace(/\r/g, "")
    .split("\n")
    .map((x) => x.trim())
    .filter(Boolean);
}

function getBulletLines(str = "") {
  return getNonEmptyLines(str)
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
    /\b(helped|assisted|supported|involved in|responsible for|contributed to|worked on|played a key role in|participated in|handled)\b/i.test(
      b
    )
  ).length;
}

function hasBasicToExpertUpgrade(original = "", optimized = "") {
  const basicRe =
    /\b(basic|temel|beginner|entry-level|introductory|foundation)\b/i;
  const expertRe =
    /\b(expert|advanced|uzman|expertise|ileri|specialist-level|mastery)\b/i;

  return basicRe.test(original) && expertRe.test(optimized) && !expertRe.test(original);
}

function shouldRepairOptimizedCv(originalCv = "", optimizedCv = "", jd = "") {
  if (!optimizedCv || !String(optimizedCv).trim()) return true;

  const origNorm = normalizeCompareText(originalCv);
  const optNorm = normalizeCompareText(optimizedCv);

  if (!optNorm) return true;
  if (origNorm === optNorm) return true;
  if (hasInventedNumbers(originalCv, optimizedCv, jd)) return true;
  if (hasBasicToExpertUpgrade(originalCv, optimizedCv)) return true;

  const { same, total } = countUnchangedBullets(originalCv, optimizedCv);
  if (total > 0 && same / total >= 0.25) return true;

  const optimizedBullets = getBulletLines(optimizedCv);
  if (total > 0 && optimizedBullets.length < Math.max(2, Math.floor(total * 0.8))) {
    return true;
  }

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

    const pairKey = `${normalizeCompareText(sentence)}__${normalizeCompareText(rewrite)}`;
    if (seen.has(pairKey)) continue;

    seen.add(pairKey);
    out.push({ sentence, rewrite });

    if (out.length >= limit) break;
  }

  return out;
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

function buildAtsSystem(outLang) {
  return `
CRITICAL TRUTH RULES:
- Do NOT invent or assume ANY numbers, percentages, time periods, client names, revenue, KPIs, team size, budget, or results.
- Only use facts explicitly supported by the user's resume and, if present, the job description.
- If the resume states a specific duration such as "6 years", keep it exact. Do NOT convert it into "5+ years" or any other variation.
- Do NOT invent employers, titles, degrees, dates, certifications, tools, platforms, channels, projects, responsibilities, or industries.
- Do NOT replace generic wording with a more specific tool/platform/channel unless that exact tool/platform/channel is explicitly present in the input.
- Example: if the resume says "social media platforms", do NOT rewrite it as "Meta" unless Meta is explicitly present.
- Do NOT upgrade proficiency levels. Example: if the resume says "basic data analysis", do NOT rewrite it as "advanced data analysis" or "data analysis expertise" unless clearly supported.
- You may strengthen support-type tasks, but do NOT convert support into ownership, management, or leadership unless clearly supported by the input.
- Use "led" ONLY if leadership is explicitly or very clearly supported by the input.
- Keep the candidate's real role/title truthful. Do NOT silently change the person into a more senior, more niche, or different specialist role unless that shift is clearly supported by the resume itself.
- If a bullet has no measurable metric, rewrite it using:
  action + scope + tools/platforms/channels already present + business context + purpose/outcome wording
  WITHOUT numbers.

QUALITY STANDARD:
- Rewrites must be materially better than the original.
- Do NOT make shallow synonym swaps or near-duplicate rewrites.
- Each rewrite must improve at least two of these:
  clarity, ownership, specificity, scope, action strength, business context, recruiter readability.
- If a rewrite is too similar to the original, rewrite it again more strongly.
- Prefer direct, recruiter-ready phrasing over vague corporate language.
- Avoid generic filler phrasing such as:
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
- Replace weak verbs with stronger truth-preserving verbs whenever justified by the original text, such as:
  managed, executed, developed, coordinated, delivered, analyzed, optimized, partnered, prepared, collaborated, oversaw.
- Do not use inflated language that invents seniority, scope, ownership, or measurable impact.

OPTIMIZED CV RULES:
- optimized_cv MUST NOT feel like a lightly polished copy of the original resume.
- Every experience bullet in optimized_cv should be rewritten to sound more specific, action-oriented, recruiter-ready, and ATS-friendly while staying factually faithful.
- Do not preserve weak wording when a stronger truthful rewrite is possible.
- Prefer this pattern when no metrics exist:
  action verb + what was handled + tool/channel/context already present + business purpose
- Even without numbers, bullets should sound concrete and professionally scoped.
- Avoid copying original bullets unless they are already highly optimized.
- Keep bullets concise, clean, and recruiter-friendly.
- The optimized_cv must improve ATS performance on:
  section completeness, clarity/readability, bullet strength, ATS-safe formatting, and role relevance.
- If a job description exists, optimized_cv must also improve genuine alignment to that job description without inventing claims.
- If no job description exists, optimize the resume as a strong standalone ATS-friendly resume for the candidate's apparent role based only on the resume's own content.

SUMMARY RULES:
- The summary must reflect real strengths and weaknesses from the resume.
- The summary must explain the biggest reasons affecting the ATS score.

OUTPUT RULES:
- You are an ATS resume analyzer and resume rewriter.
- Return ONLY valid JSON.
- No markdown.
- No extra text.
- All output VALUES MUST be written ONLY in ${outLang}. Do not mix languages.
- This includes:
  missing_keywords items,
  weak_sentences.sentence,
  weak_sentences.rewrite,
  summary,
  optimized_cv.
- Do not add any extra keys except component_scores when requested.
`.trim();
}

function buildLinkedinSystem(outLang) {
  return `
CRITICAL RULES:
- Do NOT invent or assume ANY numbers, percentages, time periods, client names, revenue, KPIs, team size, budget, or results.
- Only use metrics explicitly present in the user's resume/job description input text.
- If a bullet has no measurable metric, rewrite it using:
  scope + actions + tools/platforms already present + context + outcome wording
  WITHOUT numbers.
- Never write “increased by X%”, “grew by X”, “reduced by X%”, “saved $X”, “managed $X budget”, “served X clients”, “led X people” unless those exact facts appear in the input text.
- If unsure, prefer truthful neutral phrasing with no numbers.
- If the input contains a number, keep it exact; do not round up/down or change it.
- Do NOT invent employers, titles, degrees, dates, certifications, or metrics.
- Do NOT replace generic platform language with a specific platform unless it is explicitly present.
- Do NOT upgrade support-level work into leadership unless clearly supported.

FOR BEFORE -> AFTER REWRITES:
- AFTER must preserve factual truth.
- It can improve clarity and strength but must not add new facts.
- If BEFORE has no metric, AFTER must not contain any metric.

QUALITY STANDARD:
- Rewrites must be materially better than the original.
- Do NOT make shallow synonym swaps or near-duplicate rewrites.
- Each rewrite must improve at least two of these:
  clarity, ownership, specificity, scope, action strength, business context.
- If a rewrite is too similar to the original, rewrite it again with stronger professional phrasing.

You are a LinkedIn profile optimization expert.
Return ONLY valid JSON.
No markdown.
No extra text.
CRITICAL: All output VALUES MUST be written ONLY in ${outLang}. Do not mix languages.
No extra keys.
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
- Output VALUES must be in ${outLang}. Proper nouns/tools may stay as-is.
- headlines: exactly 1 item.
- about.short: 600–900 chars, punchy, no emojis.
- experience_fix: exactly 1 item.
- "before" must be a real bullet/sentence from the resume.
- "after" must be materially stronger than "before", not a light synonym swap.
- Choose only a sentence where a clearly better rewrite is possible.
- If the rewrite is too similar to the original, choose another sentence.
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
- If target_role is provided, tailor every output to that role and seniority.
- Prefer role-specific keywords and phrasing only when truthfully supported.

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

QUALITY RULES:
- Output VALUES must be in ${outLang}. Do not mix languages.
- Do NOT invent employers, titles, dates, degrees, tools, or metrics.
- If resume has no numbers, improve bullets using scope + tools already present + outcome wording WITHOUT guessing numbers.
- Headline max 220 chars each. No emojis.
- About:
  - short: 500–800 chars
  - normal: 900–1400 chars
  - bold: 900–1400 chars, more confident but still truthful
- headlines: exactly 5 items with labels:
  1) "Search"
  2) "Impact"
  3) "Niche"
  4) "Leadership"
  5) "Clean"
- experience_fix: exactly 5–6 items.
- Each "before" must be from the resume text.
- Each "after" must be LinkedIn-ready and materially stronger.
- "why" must explain clarity/impact/scope/keywords.
- Do NOT use shallow synonym swaps or near-duplicate rewrites.
- Each "after" must improve at least two of these:
  clarity, ownership, specificity, scope, action strength, business context.
- If a sentence cannot be improved meaningfully, do not include it.
- skills.top: 12–18
- skills.tools: 8–16
- skills.industry: 12–20
- recruiter.keywords: 10–20
- recruiter.boolean: a single boolean string using OR groups + a few AND terms, ready to paste in LinkedIn Recruiter.
- Return ONLY valid JSON. No extra keys.

TARGETING META:
- target_role: ${liTargetRole || "(not provided)"}
- seniority: ${liSeniority}
- industry: ${liIndustry || "(not provided)"}
- location: ${liLocation || "(not provided)"}
- tone: ${liTone}

HARD RULE:
- If target_role is provided, every headline + about + skills + recruiter keywords MUST align to target_role + seniority.
- Only use role-specific phrasing where truthfully supported by the resume.

RESUME:
${cv}

TARGET ROLE / JOB (optional):
${jd || "(none)"}
`.trim();
}

function buildAtsPreviewPrompt({ cv, jd, hasJD, outLang }) {
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

REQUIREMENTS:
- This is a JOB-SPECIFIC ATS MATCH because a job description is provided.
- Evaluate each component score on a 0–100 scale:
  jd_keyword_match, section_completeness, bullet_strength, ats_safe_formatting, role_alignment.
- component_scores must reflect real resume-to-job alignment.
- missing_keywords MUST include exactly 5–7 items genuinely missing or underrepresented from the JOB DESCRIPTION.
- missing_keywords MUST be unique, role-relevant, practical, and written in ${outLang}.

WEAK SENTENCE RULES:
- weak_sentences MUST include up to 2 items picked from real resume sentences.
- Both sentence and rewrite MUST be in ${outLang}.
- Select only sentences where a clearly stronger rewrite is possible.
- Do NOT select sentences that can only be improved with tiny synonym swaps.
- The rewrite must materially improve the original.
- Each rewrite must improve at least 2 of these:
  clarity, ownership, specificity, scope, action strength, business context, role relevance, professional tone.
- Do NOT use shallow synonym swaps, cosmetic rewrites, or near-duplicate rewrites.
- If BEFORE and AFTER are too similar, reject that example and choose another sentence.
- If there are not enough strong rewrite candidates, return fewer weak_sentences rather than forcing weak examples.

SUMMARY RULES:
- summary MUST be 4–6 bullet lines in ${outLang}.
- summary must focus on job fit, biggest missing keywords, ATS risks, and top improvements.
- summary should reflect the scoring logic.
- Do NOT add optimized_cv.
- Do NOT mix languages.
- Proper nouns / technical terms may stay as-is.

Return ONLY valid JSON.

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

REQUIREMENTS:
- This is a GENERAL ATS REVIEW because no job description is provided.
- Evaluate each component score on a 0–100 scale:
  section_completeness, clarity_readability, bullet_strength, ats_safe_formatting, core_keyword_coverage.
- missing_keywords MUST include exactly 5–7 items.
- These are NOT job-specific missing keywords.
- They should be recommended ATS/recruiter-friendly resume terms based on the candidate's apparent role and existing experience already visible in the resume.
- missing_keywords MUST be unique, practical, role-relevant, and written in ${outLang}.

WEAK SENTENCE RULES:
- weak_sentences MUST include up to 2 items picked from real resume sentences.
- Both sentence and rewrite MUST be in ${outLang}.
- Select only sentences where a clearly stronger rewrite is possible.
- Do NOT select sentences that can only be improved with tiny synonym swaps.
- The rewrite must materially improve the original.
- Each rewrite must improve at least 2 of these:
  clarity, ownership, specificity, scope, action strength, business context, professional tone.
- Do NOT use shallow synonym swaps, cosmetic rewrites, or near-duplicate rewrites.
- If BEFORE and AFTER are too similar, reject that example and choose another sentence.
- If there are not enough strong rewrite candidates, return fewer weak_sentences rather than forcing weak examples.

SUMMARY RULES:
- summary MUST be 4–6 bullet lines in ${outLang}.
- summary must focus on general ATS readiness, structure, clarity, and top improvement areas.
- summary should reflect the scoring logic.
- Do NOT add optimized_cv.
- Do NOT mix languages.
- Proper nouns / technical terms may stay as-is.

Return ONLY valid JSON.

RESUME:
${cv}
`.trim();
}

function buildAtsFullPrompt({ cv, jd, hasJD, outLang }) {
  if (hasJD) {
    return `
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
- Do not merely polish wording. Improve real keyword coverage, role alignment, section strength, recruiter clarity, and ATS relevance.

HARD REQUIREMENTS:
- This is a JOB-SPECIFIC ATS MATCH because a job description is provided.
- Evaluate each component score on a 0–100 scale:
  jd_keyword_match, section_completeness, bullet_strength, ats_safe_formatting, role_alignment.

SCORING LOGIC:
- jd_keyword_match should reflect whether the resume naturally includes the most important skills, responsibilities, workflows, and domain terms from the job description.
- section_completeness should reflect whether the resume has strong ATS-friendly sections with useful content.
- bullet_strength should reflect whether bullets are specific, action-oriented, and recruiter-ready.
- ats_safe_formatting should reflect whether the resume uses clean ATS-readable structure and clear sectioning.
- role_alignment should reflect how clearly the candidate looks like a fit for this target role.

MISSING KEYWORDS:
- missing_keywords MUST include 25–35 items genuinely missing or underrepresented from the JOB DESCRIPTION.
- missing_keywords MUST be unique, role-relevant, and written in ${outLang}.
- Prefer the most score-impacting missing terms first.
- Include a balanced mix of hard skills, tools already compatible with the role, process terms, responsibility terms, analysis/reporting terms, and stakeholder terms.
- Do NOT include generic fluff unless it is clearly relevant in the JD.

WEAK SENTENCES:
- weak_sentences MUST include 12–18 items from the resume text, each with a materially stronger rewrite.
- Both sentence and rewrite MUST be in ${outLang}.
- Only include a weak sentence if the rewrite meaningfully improves it.
- Each rewrite must improve at least 2 of these:
  clarity, ownership, specificity, scope, action strength, business context, role relevance, professional tone.
- Do NOT use shallow synonym swaps, cosmetic rewrites, or near-duplicate rewrites.
- If BEFORE and AFTER are too similar, reject that example and choose another sentence.
- If a sentence cannot be improved meaningfully, do not include it.
- If there are not enough strong rewrite candidates, return fewer weak_sentences rather than padding the list.

OPTIMIZED_CV — MOST IMPORTANT RULES:
- optimized_cv MUST be a complete rewritten resume aligned to the job description and written in ${outLang}.
- optimized_cv MUST NOT be a lightly edited version of the original resume.
- The output should feel like a stronger, more targeted, recruiter-ready version of the candidate’s real resume.
- Preserve only truthful information from the input resume.
- Use clean ATS-friendly structure.
- Rewrite the summary so it clearly aligns the candidate to the target role in the JD.
- The summary must naturally include high-value JD language where truthful and relevant.
- Do not add fake achievements, fake platforms, fake tools, fake industries, fake scale, or fake seniority.

OPTIMIZED_CV EXPERIENCE RULES:
- Every bullet in optimized_cv should be rewritten with stronger, cleaner recruiter-ready phrasing.
- Do not copy original bullets unless a sentence is already highly optimized.
- Prefer direct action verbs such as:
  managed, executed, developed, optimized, coordinated, analyzed, improved, delivered, partnered, collaborated, prepared.
- Use "led" ONLY if leadership is clearly supported by the input.
- Each bullet should, where truthfully possible, reflect one or more of:
  JD relevance, business context, functional ownership, scope of work, clear purpose, outcome-oriented direction without invented metrics.
- Weave JD-relevant terminology into bullets naturally, but only where factually supportable from the original resume.
- Do NOT replace a generic platform/channel with a specific one unless explicitly present in the input.

BANNED WEAK PHRASING IN optimized_cv:
- helped
- assisted
- supported
- involved in
- responsible for
- contributed to
- worked on
- played a key role in
- participated in
- handled

KEYWORD INSERTION RULES:
- optimized_cv should naturally absorb the most important missing keywords from the JD, but only where they fit truthfully.
- Prioritize adding JD keywords into:
  1) summary
  2) skills section
  3) the most relevant experience bullets
- Do NOT keyword-stuff.
- Do NOT dump JD terms unnaturally into the text.
- The result must still read like a real resume written by a strong professional.

SKILLS SECTION RULES:
- Update the skills section to better reflect JD relevance.
- Remove obviously weak/basic wording only if a stronger truthful equivalent exists.
- Prefer recruiter- and ATS-friendly phrasing.
- Include high-value relevant terms from the JD only where supportable by the resume content.
- Do not invent tools or platforms the candidate never used.

STYLE RULES:
- Keep bullets concise, professional, and ATS-friendly.
- Prefer direct action + scope + business context.
- Avoid vague filler language.
- Avoid inflated executive wording unless clearly justified.
- Avoid generic buzzwords with no real informational value.

TRUTH RULES:
- Keep claims truthful.
- Do not invent employers, degrees, titles, dates, tools, certifications, projects, industries, or metrics.
- Do NOT invent or assume numbers/percentages/results.
- Use numbers ONLY if they exist in RESUME or JOB DESCRIPTION.
- If the resume has no numbers, do NOT add any numbers in rewrites.

SUMMARY OUTPUT RULES:
- summary MUST be detailed (8–14 bullet lines) in ${outLang} covering:
  1) overall job-fit diagnosis
  2) top missing skills/keywords to add
  3) biggest ATS/format risks
  4) top rewrite themes
  5) why the optimized version should score better
- The summary should clearly reflect the weighted scoring logic.

JSON STRICTNESS:
- KEYS must remain exactly: component_scores, missing_keywords, weak_sentences, optimized_cv, summary.
- Do NOT translate keys.
- No extra keys.
- No comments.
- No markdown.
- No code fences.

Return ONLY valid JSON.

RESUME:
${cv}

JOB DESCRIPTION:
${jd}
`.trim();
  }

  return `
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
- Improve structure, clarity, recruiter readability, keyword strength, bullet quality, and overall role fit based only on the resume’s own content.

HARD REQUIREMENTS:
- This is a GENERAL ATS REVIEW because no job description is provided.
- Evaluate each component score on a 0–100 scale:
  section_completeness, clarity_readability, bullet_strength, ats_safe_formatting, core_keyword_coverage.

SCORING LOGIC:
- section_completeness should reflect whether the resume has strong ATS-friendly sections with useful content.
- clarity_readability should reflect whether the resume is easy for recruiters to scan and understand.
- bullet_strength should reflect whether bullets are specific, action-oriented, and professionally written.
- ats_safe_formatting should reflect whether the resume uses clean ATS-readable structure and clear sectioning.
- core_keyword_coverage should reflect whether the resume includes strong recruiter-friendly terms for the candidate’s apparent role.

MISSING KEYWORDS:
- missing_keywords MUST include 25–35 items.
- These are NOT job-specific missing keywords.
- They must be recommended ATS/recruiter-friendly keywords based on the candidate’s likely role, seniority, and experience already visible in the resume.
- missing_keywords MUST be unique, practical, and written in ${outLang}.
- Prefer the most resume-improving terms first.

WEAK SENTENCES:
- weak_sentences MUST include 12–18 items from the resume text, each with a materially stronger rewrite.
- Both sentence and rewrite MUST be in ${outLang}.
- Only include a weak sentence if the rewrite meaningfully improves it.
- Each rewrite must improve at least 2 of these:
  clarity, ownership, specificity, scope, action strength, business context, professional tone.
- Do NOT use shallow synonym swaps, cosmetic rewrites, or near-duplicate rewrites.
- If BEFORE and AFTER are too similar, reject that example and choose another sentence.
- If a sentence cannot be improved meaningfully, do not include it.
- If there are not enough strong rewrite candidates, return fewer weak_sentences rather than padding the list.

OPTIMIZED_CV — MOST IMPORTANT RULES:
- optimized_cv MUST be a complete rewritten ATS-friendly resume in ${outLang}.
- optimized_cv MUST NOT be a lightly edited version of the original resume.
- optimized_cv should read like a stronger, cleaner, more recruiter-ready version of the candidate’s real resume.
- The purpose is to maximize ATS readiness and recruiter clarity for the candidate’s apparent role without depending on a job description.

OPTIMIZED_CV STRUCTURE:
- Preserve only truthful information from the input resume.
- Use clear ATS-friendly sections when supported by the input, such as:
  PROFESSIONAL SUMMARY, EXPERIENCE, SKILLS, EDUCATION.
- Do not invent new sections unless naturally justified by the existing input.

OPTIMIZED_CV SUMMARY RULES:
- Rewrite the summary to sound more role-focused, recruiter-ready, and keyword-aware.
- Use stronger role-aligned wording based on the candidate’s apparent function and seniority.
- Do not invent achievements, tools, domain experience, or scale.
- Keep exact explicit facts intact. Example: if the resume says "6 years", keep "6 years".

OPTIMIZED_CV EXPERIENCE RULES:
- Every bullet in optimized_cv should be rewritten with stronger, cleaner recruiter-ready phrasing.
- Do not copy original bullets unless a sentence is already highly optimized.
- Prefer direct action verbs such as:
  managed, executed, developed, optimized, coordinated, analyzed, improved, delivered, partnered, collaborated, prepared.
- Use "led" ONLY if leadership is clearly supported by the input.
- Each bullet should, where truthfully possible, reflect one or more of:
  clearer role-specific responsibility, stronger action language, better business context, sharper recruiter readability, more ATS-friendly terminology.
- If the original bullet is vague, rewrite it into a sharper professional statement WITHOUT inventing metrics.
- Do NOT replace a generic platform/channel with a more specific one unless explicitly present in the input.
- Do NOT upgrade a "basic" skill level into an advanced one unless clearly supported.

BANNED WEAK PHRASING IN optimized_cv:
- helped
- assisted
- supported
- involved in
- responsible for
- contributed to
- worked on
- played a key role in
- participated in
- handled

SKILLS SECTION RULES:
- Update the skills section to better reflect the candidate’s likely role.
- Remove obviously weak/basic wording only if a stronger truthful equivalent exists.
- Prefer recruiter- and ATS-friendly phrasing.
- Add strong general role-relevant terms only where they are clearly compatible with the resume content.
- Do not invent tools or platforms the candidate never used.

STYLE RULES:
- Keep bullets concise, professional, and ATS-friendly.
- Prefer direct action + scope + business context.
- Avoid vague filler language.
- Avoid inflated wording not supported by the resume.
- Avoid generic buzzwords with no informational value.

TRUTH RULES:
- Keep claims truthful.
- Do not invent employers, degrees, titles, dates, tools, certifications, projects, industries, or metrics.
- Do NOT invent or assume numbers/percentages/results.
- Use numbers ONLY if they exist in RESUME.
- If the resume has no numbers, do NOT add any numbers in rewrites.

SUMMARY OUTPUT RULES:
- summary MUST be detailed (8–14 bullet lines) in ${outLang} covering:
  1) general ATS readiness diagnosis
  2) top keyword gaps to improve
  3) biggest ATS/format risks
  4) top rewrite themes
  5) why the optimized version is stronger
- The summary should clearly reflect the weighted scoring logic and explain the biggest factors affecting the score.

JSON STRICTNESS:
- KEYS must remain exactly: component_scores, missing_keywords, weak_sentences, optimized_cv, summary.
- Do NOT translate keys.
- No extra keys.
- No comments.
- No markdown.
- No code fences.

Return ONLY valid JSON.

RESUME:
${cv}
`.trim();
}

function buildRepairPrompt({
  cv,
  jd,
  currentOptimizedCv,
  hasJD,
  outLang,
  level = 1,
}) {
  const stricter =
    level >= 2
      ? `
EXTRA STRICT REQUIREMENTS:
- Rewrite more aggressively than before.
- Any bullet that remains too close to the original must be rewritten again.
- Remove weak phrasing completely.
- Preserve exact truth, but maximize bullet strength, scope clarity, and recruiter readability.
- Keep explicit facts exact, including explicit years such as "6 years".
- Do NOT introduce any new number not present in the original resume or job description.
`
      : "";

  if (hasJD) {
    return `
Return JSON in this exact schema:

{
  "optimized_cv": string
}

TASK:
You already generated an optimized resume, but it is still too close to the original or still contains weak phrasing.
Rewrite it again so the result is materially stronger, cleaner, more ATS-friendly, and more recruiter-ready.

STRICT RULES:
- Keep all facts truthful.
- Keep exact dates, employers, titles, degrees, and explicit years of experience unchanged in meaning.
- Do NOT invent metrics, tools, platforms, channels, achievements, or industries.
- Do NOT replace generic platform/channel language with specific platforms unless explicitly present.
- Do NOT upgrade "basic" skills to advanced proficiency unless clearly supported.
- Every experience bullet should be materially stronger than the original resume bullet.
- Avoid these weak phrases:
  helped, assisted, supported, involved in, responsible for, contributed to, worked on, played a key role in, participated in, handled
- Prefer direct action + scope + business context wording.
- The result must not read like a lightly polished copy.
- The result must still be a truthful ATS-friendly resume aligned to the job description.
${stricter}
OUTPUT RULES:
- Write the optimized_cv fully in ${outLang}.
- No markdown. No extra keys. No extra text.

RESUME (original):
${cv}

JOB DESCRIPTION:
${jd}

CURRENT OPTIMIZED CV (rewrite this into a stronger final version):
${currentOptimizedCv}
`.trim();
  }

  return `
Return JSON in this exact schema:

{
  "optimized_cv": string
}

TASK:
You already generated an optimized resume, but it is still too close to the original or still contains weak phrasing.
Rewrite it again so the result is materially stronger, cleaner, more ATS-friendly, and more recruiter-ready.

STRICT RULES:
- Keep all facts truthful.
- Keep exact dates, employers, titles, degrees, and explicit years of experience unchanged in meaning.
- Do NOT invent metrics, tools, platforms, channels, achievements, or industries.
- Do NOT replace generic platform/channel language with specific platforms unless explicitly present.
- Do NOT upgrade "basic" skills to advanced proficiency unless clearly supported.
- This is GENERAL optimization without a job description.
- Optimize for ATS readiness and recruiter clarity based on the resume’s own content and apparent role.
- Every experience bullet should be materially stronger than the original resume bullet.
- Avoid these weak phrases:
  helped, assisted, supported, involved in, responsible for, contributed to, worked on, played a key role in, participated in, handled
- Prefer direct action + scope + business context wording.
- The result must not read like a lightly polished copy.
${stricter}
OUTPUT RULES:
- Write the optimized_cv fully in ${outLang}.
- No markdown. No extra keys. No extra text.

RESUME (original):
${cv}

CURRENT OPTIMIZED CV (rewrite this into a stronger final version):
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

    const atsSystem = buildAtsSystem(outLang);
    const linkedinSystem = buildLinkedinSystem(outLang);

    let userPrompt;
    let chosenSystem;

    if (reqMode === "linkedin") {
      chosenSystem = linkedinSystem;
      userPrompt = isPreview
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
    } else {
      chosenSystem = atsSystem;
      userPrompt = isPreview
        ? buildAtsPreviewPrompt({ cv, jd, hasJD, outLang })
        : buildAtsFullPrompt({ cv, jd, hasJD, outLang });
    }

    let data;
    try {
      data = await callOpenAIJson({
        apiKey,
        model,
        system: chosenSystem,
        userPrompt,
        temperature: 0.1,
        maxTokens: reqMode === "linkedin" ? (isPreview ? 1200 : 2800) : (isPreview ? 1300 : 3200),
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

    const hasComponentScores = Object.keys(componentScores).length > 0;
    const finalScore = hasComponentScores
      ? computeWeightedScore(componentScores, hasJD)
      : clampScore(data?.ats_score);

    const normalized = {
      ats_score: finalScore,
      component_scores: componentScores,
      missing_keywords: uniqueStrings(
        Array.isArray(data?.missing_keywords) ? data.missing_keywords : [],
        isPreview ? 7 : 35
      ),
      weak_sentences: normalizeWeakSentences(
        Array.isArray(data?.weak_sentences) ? data.weak_sentences : [],
        isPreview ? 2 : 18
      ),
      summary: typeof data?.summary === "string" ? data.summary.trim() : "",
      ...(isPreview
        ? {}
        : {
            optimized_cv:
              typeof data?.optimized_cv === "string" ? data.optimized_cv.trim() : "",
          }),
    };

    if (!isPreview && normalized.optimized_cv) {
      let repairLevel = 0;

      while (
        repairLevel < 2 &&
        shouldRepairOptimizedCv(cv, normalized.optimized_cv, jd || "")
      ) {
        repairLevel += 1;

        try {
          const repaired = await callOpenAIJson({
            apiKey,
            model,
            system: atsSystem,
            userPrompt: buildRepairPrompt({
              cv,
              jd,
              currentOptimizedCv: normalized.optimized_cv,
              hasJD,
              outLang,
              level: repairLevel,
            }),
            temperature: 0.1,
            maxTokens: 2600,
          });

          if (
            repaired &&
            typeof repaired.optimized_cv === "string" &&
            repaired.optimized_cv.trim()
          ) {
            normalized.optimized_cv = repaired.optimized_cv.trim();
          } else {
            break;
          }
        } catch {
          break;
        }
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
