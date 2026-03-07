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
- Do NOT invent or assume ANY numbers, percentages, time periods, years of experience, client names, revenue, KPIs, CAC, ROAS, CPC, CPA, budgets, team size, traffic, conversions, leads, rankings, performance lift, or results.
- Only use facts that are explicitly present in the user's resume/job description input text.
- If the input says "6 years", keep "6 years". Never change it to "5+ years", "over 5 years", or any other variation unless that exact variation appears in the input.
- Do NOT invent or assume tools, platforms, channels, certifications, employers, titles, dates, locations, industries, responsibilities, ownership level, or achievements.
- If the input says "social media ads" or "social platforms", do NOT convert it into "Meta ads" unless Meta/Facebook/Instagram is explicitly mentioned.
- If the input says "supported", "assisted", or "contributed", you may strengthen phrasing ONLY within the same truth boundary. Do not convert support into ownership unless the original text clearly supports ownership.
- Never add claims like "improved customer acquisition cost", "optimized ROAS", "boosted conversions", "increased traffic", "improved brand awareness", or "drove growth" unless the input explicitly supports them.
- Never add platform names, methodologies, or skills that do not exist in the input text or job description.
- Do NOT invent leadership. Use "led" only if the original text clearly shows leadership/ownership.
- Do NOT invent strategy ownership. Use "developed strategy" only if strategy creation is explicit in the input.
- If a bullet has no measurable metric, rewrite it using: action + scope + context + professional clarity, WITHOUT adding numbers or fake outcomes.
- Prefer clearer and stronger recruiter-ready phrasing, but preserve the exact factual meaning.
- Rewrites must be materially better than the original.
- Do NOT make shallow synonym swaps or near-duplicate rewrites.
- Each rewrite must improve at least two of these: clarity, specificity, scope, action strength, recruiter readability, ATS wording.
- If a rewrite is too similar to the original, rewrite it again more clearly.
- If a sentence cannot be meaningfully improved without inventing facts, keep it close to the original and improve only clarity/grammar.
- optimized_cv MUST stay truthful, professional, ATS-friendly, and noticeably improved, but must never exaggerate.

GOOD REWRITE EXAMPLES:
- "Worked closely with sales and product teams" -> "Collaborated with sales and product teams to support campaign execution and alignment."
- "Assisted in budget planning and reporting" -> "Supported budget planning and prepared campaign reporting for ongoing marketing activities."
- "Conducted basic performance analysis and reporting" -> "Performed performance analysis and prepared reports to support campaign evaluation."

BAD REWRITE EXAMPLES:
- "Worked closely with sales and product teams" -> "Led cross-functional growth strategy with Sales and Product"
- "Supported digital marketing strategies" -> "Developed full-funnel digital growth strategies"
- "Social media campaigns" -> "Meta and LinkedIn paid media programs"
- "Improved campaign performance" -> "Drove measurable ROAS and conversion growth"

You are an ATS resume analyzer and resume rewriter.
Return ONLY valid JSON. No markdown. No extra text.
CRITICAL: All output VALUES MUST be written ONLY in ${outLang}. Do not mix languages.
This includes: missing_keywords items, weak_sentences.sentence and weak_sentences.rewrite, summary, and optimized_cv.
Do not add any extra keys except component_scores when requested.
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
- component_scores must reflect the real resume-to-job alignment.
- missing_keywords MUST include exactly 5-7 items that are genuinely missing or underrepresented from the JOB DESCRIPTION.
- missing_keywords MUST be unique, role-relevant, practical, and written in ${outLang}.

WEAK SENTENCE RULES:
- weak_sentences MUST include up to 2 items picked from real resume sentences.
- Both sentence and rewrite MUST be in ${outLang}.
- Select only sentences where a clearly stronger rewrite is possible.
- Do NOT select sentences that can only be improved with tiny synonym swaps.
- The rewrite must materially improve the original.
- Each rewrite must improve at least 2 of these: clarity, ownership, specificity, scope, action strength, business context, role relevance, professional tone.
- Do NOT use shallow synonym swaps, cosmetic rewrites, or near-duplicate rewrites.
- If BEFORE and AFTER are too similar, reject that example and choose another sentence.
- If there are not enough strong rewrite candidates, return fewer weak_sentences rather than forcing weak examples.
- Prefer recruiter-ready scoped phrasing even when no numbers are available.
- Example:
  "Worked closely with sales and product teams."
  -> "Partnered with sales and product teams to align campaign priorities, messaging, and execution with broader business goals."

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
- These are NOT job-specific missing keywords. They should be recommended ATS/recruiter-friendly resume keywords based on the candidate's apparent role and experience.
- missing_keywords MUST be unique, practical, role-relevant, and written in ${outLang}.

WEAK SENTENCE RULES:
- weak_sentences MUST include up to 2 items picked from real resume sentences.
- Both sentence and rewrite MUST be in ${outLang}.
- Select only sentences where a clearly stronger rewrite is possible.
- Do NOT select sentences that can only be improved with tiny synonym swaps.
- The rewrite must materially improve the original.
- Each rewrite must improve at least 2 of these: clarity, ownership, specificity, scope, action strength, business context, professional tone.
- Do NOT use shallow synonym swaps, cosmetic rewrites, or near-duplicate rewrites.
- If BEFORE and AFTER are too similar, reject that example and choose another sentence.
- If there are not enough strong rewrite candidates, return fewer weak_sentences rather than forcing weak examples.
- Prefer recruiter-ready scoped phrasing even when no numbers are available.
- Example:
  "Assisted in budget planning and reporting."
  -> "Supported budget planning and prepared recurring performance reports to track spend, campaign activity, and marketing performance."

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
- The optimized_cv must be rewritten to materially improve ATS alignment for THIS SAME job description.
- If this optimized_cv is analyzed again against the same JD, it should score meaningfully higher than the original resume.
- Do not merely polish wording. Improve keyword coverage, role alignment, section strength, recruiter clarity, and ATS relevance.

HARD REQUIREMENTS:
- This is a JOB-SPECIFIC ATS MATCH because a job description is provided.
- Evaluate each component score on a 0-100 scale:
  - jd_keyword_match
  - section_completeness
  - bullet_strength
  - ats_safe_formatting
  - role_alignment

SCORING LOGIC:
- jd_keyword_match should reflect whether the resume naturally includes the most important skills, tools, responsibilities, and domain terms from the job description.
- section_completeness should reflect whether the resume has strong ATS-friendly sections with useful content.
- bullet_strength should reflect whether bullets are specific, action-oriented, and recruiter-ready.
- ats_safe_formatting should reflect whether the resume uses clean ATS-readable structure and clear sectioning.
- role_alignment should reflect how clearly the candidate looks like a fit for this target role.

MISSING KEYWORDS:
- missing_keywords MUST include 25–35 items genuinely missing or underrepresented from the JOB DESCRIPTION.
- missing_keywords MUST be unique, role-relevant, and written in ${outLang}.
- Prefer the most score-impacting missing terms first.
- Include a balanced mix of:
  - hard skills
  - tools/platforms
  - channel/domain terms
  - process/responsibility terms
  - reporting/analysis terms
  - collaboration/stakeholder terms
- Do NOT include generic fluff unless it is clearly relevant in the JD.

WEAK SENTENCES:
- weak_sentences MUST include 12–18 items from the resume text, each with a materially stronger rewrite.
- Both sentence and rewrite MUST be in ${outLang}.
- Only include a weak sentence if the rewrite meaningfully improves it.
- Each rewrite must improve at least 2 of these:
  - clarity
  - ownership
  - specificity
  - scope
  - action strength
  - business context
  - role relevance
  - professional tone
- Do NOT use shallow synonym swaps, cosmetic rewrites, or near-duplicate rewrites.
- Do NOT include rewrites that only sound different without becoming stronger.
- If BEFORE and AFTER are too similar, reject that example and choose another sentence.
- If a sentence cannot be improved meaningfully, do not include it.
- If there are not enough strong rewrite candidates, return fewer weak_sentences rather than padding the list with weak examples.

OPTIMIZED_CV — MOST IMPORTANT RULES:
- optimized_cv MUST be a complete rewritten resume aligned to the job description and written in ${outLang}.
- optimized_cv MUST NOT be a lightly edited version of the original resume.
- optimized_cv MUST be optimized to materially improve the score when re-analyzed against the same job description.
- The output should feel like a stronger, more targeted, recruiter-ready version of the candidate’s resume.

OPTIMIZED_CV STRUCTURE:
- Preserve only truthful information from the input resume.
- Use clear ATS-friendly sections when supported by the input, such as:
  - PROFESSIONAL SUMMARY
  - EXPERIENCE
  - SKILLS
  - EDUCATION
- Do not invent new sections unless naturally justified by the existing input.

OPTIMIZED_CV SUMMARY RULES:
- Rewrite the summary so it clearly aligns the candidate to the target role in the JD.
- The summary must naturally include high-value JD language where truthful and relevant.
- The summary should make the candidate sound more role-aligned, focused, and recruiter-ready.
- Do not add fake achievements, fake industries, fake tools, or fake scale.

OPTIMIZED_CV EXPERIENCE RULES:
- Every bullet in optimized_cv should be rewritten with stronger, cleaner recruiter-ready phrasing.
- Do not copy original bullets unless a sentence is already highly optimized.
- Prefer direct action verbs such as:
  - managed
  - executed
  - developed
  - optimized
  - coordinated
  - analyzed
  - improved
  - delivered
  - partnered
  - collaborated
  - prepared
- Use "led" ONLY if leadership is clearly supported by the input.
- Each bullet should, where truthfully possible, reflect one or more of:
  - skill/tool relevance from the JD
  - business context
  - functional ownership
  - scope of work
  - clear purpose
  - outcome-oriented direction without invented metrics
- Weave JD-relevant terminology into bullets naturally, but only where factually supportable from the original resume.
- If the JD emphasizes specific platforms, channels, workflows, or responsibilities already compatible with the candidate’s real experience, reflect that in the bullet wording.

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

Replace these with stronger factual phrasing whenever possible, without inventing claims.

KEYWORD INSERTION RULES:
- optimized_cv should naturally absorb the most important missing keywords from the JD, but only where they fit truthfully.
- Prioritize adding JD keywords into:
  1) summary
  2) skills section
  3) experience bullets
- Do NOT keyword-stuff.
- Do NOT dump JD terms unnaturally into the text.
- The result must still read like a real resume written by a strong professional.

SKILLS SECTION RULES:
- Update the skills section to better reflect JD relevance.
- Remove obviously weak/basic wording if a stronger truthful equivalent exists.
- Prefer recruiter- and ATS-friendly phrasing.
- Include high-value relevant terms from the JD where supportable by the resume content.
- Do not invent tools or platforms the candidate never used unless the original resume strongly implies them.

STYLE RULES:
- Keep bullets concise, professional, and ATS-friendly.
- Prefer direct action + scope + business context.
- Avoid vague corporate filler.
- Avoid inflated executive language unless clearly justified.
- Avoid generic buzzwords with no real informational value.
- Do not make the candidate sound fake, exaggerated, or over-senior.

TRUTH RULES:
- Keep claims truthful.
- Do not invent employers, degrees, titles, dates, tools, certifications, projects, industries, or metrics.
- Do NOT invent or assume numbers/percentages/results.
- Use numbers ONLY if they exist in RESUME or JOB DESCRIPTION.
- If the resume has no numbers, do NOT add any numbers in rewrites.
- If a bullet has no measurable metric, strengthen it using:
  action + scope + tool/context + business purpose
  WITHOUT adding fake results.

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
- Do not merely polish wording. Improve structure, clarity, recruiter readability, keyword strength, and bullet quality.

HARD REQUIREMENTS:
- This is a GENERAL ATS REVIEW because no job description is provided.
- Evaluate each component score on a 0-100 scale:
  - section_completeness
  - clarity_readability
  - bullet_strength
  - ats_safe_formatting
  - core_keyword_coverage

SCORING LOGIC:
- section_completeness should reflect whether the resume has strong ATS-friendly sections with useful content.
- clarity_readability should reflect whether the resume is easy for recruiters to scan and understand.
- bullet_strength should reflect whether bullets are specific, action-oriented, and professionally written.
- ats_safe_formatting should reflect whether the resume uses clean ATS-readable structure and clear sectioning.
- core_keyword_coverage should reflect whether the resume includes strong recruiter-friendly terms for the candidate’s likely role.

MISSING KEYWORDS:
- missing_keywords MUST include 25–35 items.
- These are NOT job-specific missing keywords.
- They must be recommended ATS/recruiter-friendly keywords based on the candidate's likely role, seniority, and experience.
- missing_keywords MUST be unique, practical, and written in ${outLang}.
- Prefer the most resume-improving keywords first.

WEAK SENTENCES:
- weak_sentences MUST include 12–18 items from the resume text, each with a materially stronger rewrite.
- Both sentence and rewrite MUST be in ${outLang}.
- Only include a weak sentence if the rewrite meaningfully improves it.
- Each rewrite must improve at least 2 of these:
  - clarity
  - ownership
  - specificity
  - scope
  - action strength
  - business context
  - professional tone
- Do NOT use shallow synonym swaps, cosmetic rewrites, or near-duplicate rewrites.
- Do NOT include rewrites that only sound different without becoming stronger.
- If BEFORE and AFTER are too similar, reject that example and choose another sentence.
- If a sentence cannot be improved meaningfully, do not include it.
- If there are not enough strong rewrite candidates, return fewer weak_sentences rather than padding the list with weak examples.

OPTIMIZED_CV — MOST IMPORTANT RULES:
- optimized_cv MUST be a complete rewritten ATS-friendly resume in ${outLang}.
- optimized_cv MUST NOT be a lightly edited version of the original resume.
- optimized_cv should read like a stronger, cleaner, more recruiter-ready version of the candidate’s resume.
- The purpose is to maximize ATS readiness and recruiter clarity for the candidate’s apparent target role.

OPTIMIZED_CV STRUCTURE:
- Preserve only truthful information from the input resume.
- Use clear ATS-friendly sections when supported by the input, such as:
  - PROFESSIONAL SUMMARY
  - EXPERIENCE
  - SKILLS
  - EDUCATION
- Do not invent new sections unless naturally justified by the existing input.

OPTIMIZED_CV SUMMARY RULES:
- Rewrite the summary to sound more role-focused, recruiter-ready, and keyword-aware.
- Use stronger role-aligned wording based on the candidate’s apparent function and seniority.
- Do not invent achievements, tools, domain experience, or scale.

OPTIMIZED_CV EXPERIENCE RULES:
- Every bullet in optimized_cv should be rewritten with stronger, cleaner recruiter-ready phrasing.
- Do not copy original bullets unless a sentence is already highly optimized.
- Prefer direct action verbs such as:
  - managed
  - executed
  - developed
  - optimized
  - coordinated
  - analyzed
  - improved
  - delivered
  - partnered
  - collaborated
  - prepared
- Use "led" ONLY if leadership is clearly supported by the input.
- Each bullet should, where truthfully possible, reflect one or more of:
  - clearer role-specific responsibility
  - stronger action language
  - better business context
  - sharper recruiter readability
  - more ATS-friendly terminology
- If the original bullet is vague, rewrite it into a sharper achievement-oriented statement WITHOUT inventing metrics.

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

Replace these with stronger factual phrasing whenever possible, without inventing claims.

SKILLS SECTION RULES:
- Update the skills section to better reflect the candidate’s likely role.
- Remove obviously weak/basic wording if a stronger truthful equivalent exists.
- Prefer recruiter- and ATS-friendly phrasing.
- Add strong general role-relevant keywords where they are clearly compatible with the resume content.
- Do not invent tools or platforms the candidate never used unless the original resume strongly implies them.

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
- If a bullet has no measurable metric, strengthen it using:
  action + scope + tool/context + business purpose
  WITHOUT adding fake results.

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
        temperature: 0.1,
        response_format: { type: "json_object" },
        max_tokens: isPreview ? 1200 : 2800,
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

    const componentScores =
      data?.component_scores && typeof data.component_scores === "object"
        ? data.component_scores
        : {};

    const finalScore = computeWeightedScore(componentScores, hasJD);

    const normalized = {
      ats_score: finalScore,
      component_scores: componentScores,
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
      ats_score: normalized.ats_score,
      missing_keywords: normalized.missing_keywords,
      weak_sentences: normalized.weak_sentences,
      optimized_cv: normalized.optimized_cv,
      summary: normalized.summary,
      review_mode: hasJD ? "job_specific" : "general",
    });
  } catch (err) {
    return res
      .status(500)
      .json({ error: "Server error", details: err?.message || String(err) });
  }
}
