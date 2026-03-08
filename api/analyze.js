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
    .replace(/[^\p{L}\p{N}\s+%/-]/gu, " ")
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
  return String(str)
    .replace(/\r/g, "")
    .split("\n")
    .map((x) => x.trim())
    .filter((x) => /^[-•·‣▪▫◦]\s+/.test(x))
    .map((x) => x.replace(/^[-•·‣▪▫◦]\s+/, "").trim())
    .filter(Boolean);
}

function isSectionHeader(line = "") {
  return /^(PROFESSIONAL SUMMARY|SUMMARY|EXPERIENCE|WORK EXPERIENCE|SKILLS|EDUCATION|PROFESYONEL ÖZET|ÖZET|DENEYİM|İŞ DENEYİMİ|YETKİNLİKLER|BECERİLER|EĞİTİM)$/i.test(
    String(line).trim()
  );
}

function extractHeaderBlock(cv = "") {
  const lines = getNonEmptyLines(cv);
  const header = [];

  for (const line of lines) {
    if (isSectionHeader(line)) break;
    header.push(line);
  }

  return header.slice(0, 4);
}

function replaceHeaderBlock(originalCv = "", optimizedCv = "") {
  const originalHeader = extractHeaderBlock(originalCv);
  if (!originalHeader.length) return String(optimizedCv || "").trim();

  const lines = String(optimizedCv || "").replace(/\r/g, "").split("\n");
  const sectionIdx = lines.findIndex((x) => isSectionHeader(String(x).trim()));

  if (sectionIdx === -1) {
    return originalHeader.join("\n").trim();
  }

  const body = lines.slice(sectionIdx).join("\n").trim();
  return `${originalHeader.join("\n")}\n\n${body}`.trim();
}

function extractExperienceTitles(cv = "") {
  const lines = getNonEmptyLines(cv);
  const titles = [];

  for (let i = 1; i < lines.length; i++) {
    const line = lines[i];
    if (
      /\|\s*.*(\d{4}|Present|Günümüz|Current)/i.test(line) ||
      /(\d{4}).*(Present|Günümüz|Current)/i.test(line)
    ) {
      const prev = lines[i - 1];
      if (
        prev &&
        !isSectionHeader(prev) &&
        !prev.includes("@") &&
        !/^\d/.test(prev)
      ) {
        titles.push(prev);
      }
    }
  }

  return titles;
}

function restoreExperienceTitles(originalCv = "", optimizedCv = "") {
  const origTitles = extractExperienceTitles(originalCv);
  if (!origTitles.length) return String(optimizedCv || "").trim();

  const lines = String(optimizedCv || "").replace(/\r/g, "").split("\n");
  let titleIdx = 0;

  for (let i = 1; i < lines.length; i++) {
    const line = String(lines[i]).trim();
    if (
      /\|\s*.*(\d{4}|Present|Günümüz|Current)/i.test(line) ||
      /(\d{4}).*(Present|Günümüz|Current)/i.test(line)
    ) {
      let j = i - 1;
      while (j >= 0 && !String(lines[j]).trim()) j--;
      if (j >= 0 && titleIdx < origTitles.length) {
        lines[j] = origTitles[titleIdx];
        titleIdx += 1;
      }
    }
  }

  return lines.join("\n").replace(/\n{3,}/g, "\n\n").trim();
}

function experienceTitlesChanged(originalCv = "", optimizedCv = "") {
  const orig = extractExperienceTitles(originalCv).map(normalizeCompareText);
  const opt = extractExperienceTitles(optimizedCv).map(normalizeCompareText);

  if (!orig.length || !opt.length) return false;

  const n = Math.min(orig.length, opt.length);
  for (let i = 0; i < n; i++) {
    if (orig[i] !== opt[i]) return true;
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

function countWeakVerbHits(cv = "") {
  const bullets = getBulletLines(cv);
  return bullets.filter((b) =>
    /\b(helped|assisted|supported|involved in|responsible for|contributed to|worked on|played a key role in|participated in|handled|destek verdim|destek oldum|katkı sağladım|görev aldım|yardımcı oldum)\b/i.test(
      b
    )
  ).length;
}

function getNumericTokens(str = "") {
  const matches = String(str).match(/\b\d+(?:[.,]\d+)?(?:\s*[%x])?\b/g);
  return Array.from(new Set((matches || []).map((x) => x.replace(/\s+/g, ""))));
}

function hasInventedNumbers(originalCv = "", optimizedCv = "", jd = "") {
  const sourceTokens = new Set(getNumericTokens(`${originalCv}\n${jd || ""}`));
  const optimizedTokens = getNumericTokens(optimizedCv);

  for (const token of optimizedTokens) {
    if (!sourceTokens.has(token)) return true;
  }
  return false;
}

function hasBasicUpgrade(originalCv = "", optimizedCv = "") {
  const orig = normalizeCompareText(originalCv);
  const opt = normalizeCompareText(optimizedCv);

  const pairs = [
    {
      weak: ["basic data analysis", "temel veri analizi"],
      strong: ["data analysis", "veri analizi", "advanced data analysis", "ileri veri analizi"],
    },
    {
      weak: ["supported", "assisted", "contributed", "destek verdim", "katkı sağladım"],
      strong: ["led", "owned", "oversaw", "headed", "yönettim", "liderlik ettim", "sahiplendim"],
    },
  ];

  for (const pair of pairs) {
    const weakExists = pair.weak.some((w) => orig.includes(normalizeCompareText(w)));
    const strongAdded = pair.strong.some((s) => opt.includes(normalizeCompareText(s)));
    if (weakExists && strongAdded) return true;
  }

  return false;
}

function containsForbiddenNewTerms(originalCv = "", optimizedCv = "", jd = "") {
  const source = normalizeCompareText(`${originalCv}\n${jd || ""}`);
  const opt = normalizeCompareText(optimizedCv);

  const blockedTerms = [
    "meta",
    "facebook ads",
    "instagram ads",
    "linkedin ads",
    "tiktok ads",
    "ga4",
    "google analytics 4",
    "roi",
    "roas",
    "cac",
    "cro",
    "crm",
    "salesforce",
    "hubspot",
    "sql",
    "tableau",
    "power bi",
    "looker",
    "semrush",
    "ahrefs",
    "mailchimp",
    "klaviyo",
    "segment",
    "mixpanel",
  ];

  return blockedTerms.some((term) => {
    const t = normalizeCompareText(term);
    return opt.includes(t) && !source.includes(t);
  });
}

function containsSupportToOwnershipShift(originalCv = "", optimizedCv = "") {
  const origBullets = getBulletLines(originalCv);
  const optBullets = getBulletLines(optimizedCv);
  const n = Math.min(origBullets.length, optBullets.length);

  const supportRe =
    /\b(destek verdim|destek oldum|katkı sağladım|yardımcı oldum|görev aldım|assisted|supported|contributed|helped|participated)\b/i;

  const ownershipRe =
    /\b(yönettim|liderlik ettim|sahiplendim|başında yer aldım|led|owned|managed|oversaw|directed|headed|spearheaded)\b/i;

  for (let i = 0; i < n; i++) {
    if (supportRe.test(origBullets[i]) && ownershipRe.test(optBullets[i])) {
      return true;
    }
  }

  return false;
}

function shouldRepairOptimizedCv(originalCv = "", optimizedCv = "", jd = "", hasJD = false) {
  if (!optimizedCv || !String(optimizedCv).trim()) return true;

  const origNorm = normalizeCompareText(originalCv);
  const optNorm = normalizeCompareText(optimizedCv);

  if (!optNorm) return true;
  if (origNorm === optNorm) return true;

  const { same, total } = countUnchangedBullets(originalCv, optimizedCv);
  if (total > 0 && same / total >= 0.34) return true;

  const optimizedBullets = getBulletLines(optimizedCv);
  if (total > 0 && optimizedBullets.length < Math.max(2, Math.floor(total * 0.8))) {
    return true;
  }

  const weakVerbHits = optimizedBullets.filter((b) =>
    /\b(helped|assisted|supported|involved in|responsible for|contributed to|worked on|played a key role in|participated in|handled|destek oldum|destek verdim|katkı sağladım|görev aldım)\b/i.test(
      b
    )
  ).length;

  if (weakVerbHits >= 2) return true;

  const flagged = getFlaggedOptimizedBullets(originalCv, optimizedCv, jd, hasJD);
  if (flagged.length > 0) return true;

  return false;
}

function forceSafeResume(originalCv = "", optimizedCv = "") {
  let out = String(optimizedCv || "").trim();
  out = replaceHeaderBlock(originalCv, out);
  out = restoreExperienceTitles(originalCv, out);
  return out.trim();
}

function minimumGainNeeded(originalScore, hasJD) {
  if (originalScore >= 85) return 1;
  if (originalScore >= 75) return hasJD ? 2 : 2;
  return hasJD ? 3 : 2;
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

function buildAtsAnalyzeSystem(outLang) {
  return `
CRITICAL TRUTH RULES:
- Do NOT invent or assume ANY numbers, percentages, time periods, client names, revenue, KPIs, team size, budget, or results.
- Only use facts explicitly supported by the user's resume and, if present, the job description.
- If the resume states a specific duration such as "6 years", keep it exact. Do NOT convert it into "5+ years" or any other variation.
- Do NOT invent employers, titles, degrees, dates, certifications, tools, platforms, channels, acronyms, or projects.
- Do NOT replace generic wording with a specific tool/platform unless that tool/platform is explicitly present in the input.
- Example: if the resume says "social media platforms", do NOT rewrite it as "Meta" unless Meta is explicitly present.
- Do NOT upgrade proficiency levels. Example: if the resume says "basic data analysis", do NOT rewrite it as full "data analysis expertise" unless clearly supported.
- You may strengthen support-type tasks, but do NOT convert support into ownership or leadership unless clearly supported by the input.

QUALITY STANDARD:
- Rewrites must be materially better than the original.
- Do NOT make shallow synonym swaps or near-duplicate rewrites.
- Each rewrite must improve at least two of these:
  clarity, ownership, specificity, scope, action strength, business context, recruiter readability.
- If a rewrite is too similar to the original, reject it.

WEAK SENTENCE RULES:
- Prefer EXPERIENCE bullets first.
- Use summary sentences only if there are too few genuinely weak experience bullets.
- Never include a rewrite that weakens ownership, clarity, or specificity.
- Never rewrite a sentence into softer language such as turning a stronger statement into "destekledim", "katkıda bulundum", or similar weaker phrasing unless the original already says that.

OUTPUT RULES:
- Return ONLY valid JSON.
- No markdown.
- No extra text.
- All output VALUES MUST be written ONLY in ${outLang}. Do not mix languages.
- Proper nouns already present in the input may stay as-is.
`.trim();
}

function buildAtsOptimizeSystem(outLang) {
  return `
CRITICAL TRUTH RULES:
- Do NOT invent or assume ANY numbers, percentages, time periods, client names, revenue, KPIs, team size, budget, or results.
- Only use facts explicitly supported by the user's resume and, if present, the job description.
- Keep the original header identity block exactly as written: name, current title, location, email.
- Keep existing experience titles unchanged.
- Never rewrite exact year counts into approximate ranges. Example: if the resume says "6 years" or "6 yıllık", do not rewrite it as "5+ years" or "5 yılı aşkın".
- Never introduce acronyms or shorthand such as CAC, ROI, ROAS, CRO, KPI unless they are explicitly present in the resume or job description.
- Never introduce new platform names such as Meta, GA4, HubSpot, Salesforce, SQL, Tableau, Power BI, Looker unless they are explicitly present in the resume or job description.
- Do NOT invent employers, titles, degrees, dates, certifications, tools, platforms, channels, acronyms, or projects.
- If the original sentence is support-oriented, you may make it clearer, but you must keep it support-oriented and must not upgrade it into full ownership.
- Use "led" ONLY if leadership is explicitly or very clearly supported.
- If a bullet has no measurable metric, rewrite it using:
  action + scope + tools/platforms + business context + purpose/outcome wording
  WITHOUT numbers.

QUALITY STANDARD:
- The output must not feel like a lightly polished copy.
- Every experience bullet should become more specific, clearer, and more recruiter-ready.
- Do NOT make shallow synonym swaps or near-duplicate rewrites.
- Prefer direct action + scope + business context wording.
- Avoid weak filler phrases such as:
  helped, assisted, supported, involved in, responsible for, contributed to, worked on, played a key role in, participated in, handled
  and Turkish equivalents such as:
  destek verdim, destek oldum, katkı sağladım, görev aldım, yardımcı oldum
- Keep bullets concise, ATS-friendly, and truthful.

OUTPUT RULES:
- Return ONLY valid JSON.
- No markdown.
- No extra text.
- All output VALUES MUST be written ONLY in ${outLang}. Do not mix languages.
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

REQUIREMENTS:
- This is a JOB-SPECIFIC ATS MATCH because a job description is provided.
- Evaluate each component score on a 0-100 scale:
  - jd_keyword_match
  - section_completeness
  - bullet_strength
  - ats_safe_formatting
  - role_alignment
- component_scores must reflect the real resume-to-job alignment.
- missing_keywords MUST include exactly ${preview ? "5-7" : "12-20"} items that are genuinely missing or underrepresented from the JOB DESCRIPTION.
- missing_keywords MUST be unique, role-relevant, practical, and written in ${outLang}.
- weak_sentences MUST include ${preview ? "up to 2" : "4-8"} items.
- Do NOT force the count.
- If only 4, 5, or 6 truly strong rewrite candidates exist, return only those.
- Both sentence and rewrite MUST be in ${outLang}.
- Select only sentences where a clearly stronger rewrite is possible.
- Do NOT select sentences that can only be improved with tiny synonym swaps.
- The rewrite must materially improve the original.
- Each rewrite must improve at least 2 of these:
  clarity, ownership, specificity, scope, action strength, business context, role relevance, professional tone.
- Do NOT use shallow synonym swaps, cosmetic rewrites, or near-duplicate rewrites.
- If BEFORE and AFTER are too similar, reject that example and choose another sentence.
- summary MUST be ${preview ? "4-6" : "8-12"} bullet lines in ${outLang}.
- summary must focus on job fit, biggest missing keywords, ATS risks, and top improvements.
- Do NOT add optimized_cv.
- Do NOT add extra keys.

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
- Evaluate each component score on a 0-100 scale:
  - section_completeness
  - clarity_readability
  - bullet_strength
  - ats_safe_formatting
  - core_keyword_coverage
- missing_keywords MUST include exactly ${preview ? "5-7" : "12-20"} items.
- These are NOT job-specific missing keywords.
- They should be recommended ATS/recruiter-friendly resume terms based on the candidate's apparent role and existing experience.
- missing_keywords MUST be unique, practical, role-relevant, and written in ${outLang}.
- weak_sentences MUST include ${preview ? "up to 2" : "4-8"} items.
- Do NOT force the count.
- If only 4, 5, or 6 truly strong rewrite candidates exist, return only those.
- Both sentence and rewrite MUST be in ${outLang}.
- Select only sentences where a clearly stronger rewrite is possible.
- Do NOT select sentences that can only be improved with tiny synonym swaps.
- The rewrite must materially improve the original.
- Each rewrite must improve at least 2 of these:
  clarity, ownership, specificity, scope, action strength, business context, professional tone.
- Do NOT use shallow synonym swaps, cosmetic rewrites, or near-duplicate rewrites.
- If BEFORE and AFTER are too similar, reject that example and choose another sentence.
- summary MUST be ${preview ? "4-6" : "8-12"} bullet lines in ${outLang}.
- summary must focus on general ATS readiness, structure, clarity, and top improvement areas.
- Do NOT add optimized_cv.
- Do NOT add extra keys.

RESUME:
${cv}
`.trim();
}

function buildAtsOptimizePrompt({
  cv,
  jd,
  hasJD,
  outLang,
  analysisSummary,
  missingKeywords,
}) {
  const missingText = Array.isArray(missingKeywords) ? missingKeywords.join(", ") : "";

  if (hasJD) {
    return `
Return JSON in this exact schema:

{
  "optimized_cv": string
}

PRIMARY OBJECTIVE:
- Rewrite the resume into a stronger ATS-friendly version aligned to the SAME job description.
- The rewritten resume should improve keyword coverage, role alignment, clarity, and bullet quality without inventing facts.

STRICT RULES:
- Keep the header identity block exactly as written.
- Keep existing experience titles unchanged.
- Keep exact dates, employers, titles, education, and explicit years of experience unchanged.
- Do NOT invent numbers, platforms, tools, acronyms, KPIs, budgets, or results.
- Do NOT add Meta, ROI, ROAS, CAC, CRO, GA4, SQL, Tableau, Power BI, HubSpot, Salesforce, Looker, etc. unless explicitly present in the resume or JD.
- If the original says support-oriented work, keep it support-oriented.
- Do NOT copy original bullets unless a bullet is already highly optimized.
- Use stronger, cleaner, recruiter-ready bullets.
- Prefer direct action + scope + business context wording.
- Keep the resume ATS-friendly and natural.

TARGETED IMPROVEMENT FOCUS:
- Use the summary below to improve the resume:
${analysisSummary || "(none)"}

HIGH-PRIORITY MISSING / UNDERUSED TERMS:
${missingText || "(none)"}

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

PRIMARY OBJECTIVE:
- Rewrite the resume into a stronger ATS-friendly version without using a job description.
- Improve structure, clarity, recruiter readability, keyword strength, and bullet quality.

STRICT RULES:
- Keep the header identity block exactly as written.
- Keep existing experience titles unchanged.
- Keep exact dates, employers, titles, education, and explicit years of experience unchanged.
- Do NOT invent numbers, platforms, tools, acronyms, KPIs, budgets, or results.
- Do NOT add Meta, ROI, ROAS, CAC, CRO, GA4, SQL, Tableau, Power BI, HubSpot, Salesforce, Looker, etc. unless explicitly present in the resume.
- If the original says support-oriented work, keep it support-oriented.
- Do NOT copy original bullets unless a bullet is already highly optimized.
- Use stronger, cleaner, recruiter-ready bullets.
- Prefer direct action + scope + business context wording.
- Keep the resume ATS-friendly and natural.

TARGETED IMPROVEMENT FOCUS:
- Use the summary below to improve the resume:
${analysisSummary || "(none)"}

HIGH-PRIORITY MISSING / UNDERUSED TERMS:
${missingText || "(none)"}

RESUME:
${cv}
`.trim();
}

function buildAtsRepairPrompt({
  cv,
  jd,
  hasJD,
  outLang,
  currentOptimizedCv,
  analysisSummary,
  missingKeywords,
}) {
  const missingText = Array.isArray(missingKeywords) ? missingKeywords.join(", ") : "";

  return hasJD
    ? `
Return JSON in this exact schema:

{
  "optimized_cv": string
}

TASK:
The current optimized resume is still too close to the original, too weak, or contains unsupported wording.
Rewrite it again into a final stronger version.

STRICT RULES:
- Keep the header identity block exactly as written.
- Keep existing experience titles unchanged.
- Keep exact dates, employers, titles, education, and explicit years of experience unchanged.
- Do NOT invent any numbers, metrics, tools, acronyms, platforms, or achievements.
- Do NOT add Meta, ROI, ROAS, CAC, CRO, GA4, SQL, Tableau, Power BI, HubSpot, Salesforce, Looker, etc. unless explicitly present in the resume or JD.
- If the original sentence is support-oriented, keep it support-oriented.
- Every experience bullet must be materially stronger than the original bullet.
- Avoid weak phrasing such as:
  helped, assisted, supported, involved in, responsible for, contributed to, worked on, played a key role in, participated in, handled
  and Turkish equivalents such as:
  destek verdim, destek oldum, katkı sağladım, görev aldım, yardımcı oldum
- Prefer direct action + scope + business context wording.

QUALITY TARGET:
- Make the result clearly stronger and more recruiter-ready than the original resume.
- Do not return a lightly polished copy.

GUIDANCE:
${analysisSummary || "(none)"}

HIGH-PRIORITY TERMS:
${missingText || "(none)"}

ORIGINAL RESUME:
${cv}

JOB DESCRIPTION:
${jd}

CURRENT OPTIMIZED CV TO REWRITE:
${currentOptimizedCv}
`.trim()
    : `
Return JSON in this exact schema:

{
  "optimized_cv": string
}

TASK:
The current optimized resume is still too close to the original, too weak, or contains unsupported wording.
Rewrite it again into a final stronger version.

STRICT RULES:
- Keep the header identity block exactly as written.
- Keep existing experience titles unchanged.
- Keep exact dates, employers, titles, education, and explicit years of experience unchanged.
- Do NOT invent any numbers, metrics, tools, acronyms, platforms, or achievements.
- Do NOT add Meta, ROI, ROAS, CAC, CRO, GA4, SQL, Tableau, Power BI, HubSpot, Salesforce, Looker, etc. unless explicitly present in the resume.
- If the original sentence is support-oriented, keep it support-oriented.
- Every experience bullet must be materially stronger than the original bullet.
- Avoid weak phrasing such as:
  helped, assisted, supported, involved in, responsible for, contributed to, worked on, played a key role in, participated in, handled
  and Turkish equivalents such as:
  destek verdim, destek oldum, katkı sağladım, görev aldım, yardımcı oldum
- Prefer direct action + scope + business context wording.

QUALITY TARGET:
- Make the result clearly stronger and more recruiter-ready than the original resume.
- Do not return a lightly polished copy.

GUIDANCE:
${analysisSummary || "(none)"}

HIGH-PRIORITY TERMS:
${missingText || "(none)"}

ORIGINAL RESUME:
${cv}

CURRENT OPTIMIZED CV TO REWRITE:
${currentOptimizedCv}
`.trim();
}

function buildScorePrompt({ cv, jd, hasJD }) {
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

RULES:
- Score this resume against the job description.
- Use only the provided content.
- Return only valid JSON.

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
  }
}

RULES:
- Score this resume for general ATS readiness.
- Use only the provided content.
- Return only valid JSON.

RESUME:
${cv}
`.trim();
}

function buildLinkedInSystem(outLang) {
  return `
CRITICAL RULES:
- Do NOT invent or assume ANY numbers, percentages, time periods, client names, revenue, KPIs, team size, budget, or results.
- Only use facts explicitly present in the resume or optional job description.
- Keep all employers, titles, dates, degrees, and tools truthful.
- If a sentence has no metric, do not add a metric.
- Do NOT replace generic platform language with specific platforms unless explicitly present.
- Return ONLY valid JSON.
- No markdown.
- No extra text.
- All output VALUES MUST be written ONLY in ${outLang}. Do not mix languages.
`.trim();
}

function buildLinkedInPrompt({
  cv,
  jd,
  outLang,
  preview,
  targetRole,
  seniority,
  industry,
  location,
  tone,
}) {
  if (preview) {
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
- about.short: 600-900 chars, no emojis.
- experience_fix: up to 1 item and only if a truly better rewrite exists.
- skills.top: 7-10 items.
- recruiter.keywords: 5-8 items.
- No extra keys.

TARGETING META:
- target_role: ${targetRole || "(not provided)"}
- seniority: ${seniority}
- industry: ${industry || "(not provided)"}
- location: ${location || "(not provided)"}
- tone: ${tone}

RESUME:
${cv}

TARGET ROLE / JOB (optional):
${jd || "(none)"}
`.trim();
  }

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
- headlines: exactly 5 items labeled Search, Impact, Niche, Leadership, Clean.
- Headline max 220 chars each.
- about.short: 500-800 chars.
- about.normal: 900-1400 chars.
- about.bold: 900-1400 chars.
- experience_fix: 4-6 items maximum, only if real and materially stronger rewrites exist.
- skills.top: 12-18 items.
- skills.tools: 8-16 items.
- skills.industry: 12-20 items.
- recruiter.keywords: 10-20 items.
- recruiter.boolean: single boolean string.
- No extra keys.

TARGETING META:
- target_role: ${targetRole || "(not provided)"}
- seniority: ${seniority}
- industry: ${industry || "(not provided)"}
- location: ${location || "(not provided)"}
- tone: ${tone}

RESUME:
${cv}

TARGET ROLE / JOB (optional):
${jd || "(none)"}
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
      reqMode,
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
      return res
        .status(500)
        .json({ error: "OPENAI_API_KEY is missing on Vercel" });
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

    if (reqMode === "linkedin") {
      const liMeta =
        linkedin_meta && typeof linkedin_meta === "object" ? linkedin_meta : {};
      const liTargetRole = String(liMeta.target_role || "").trim();
      const liSeniority = String(liMeta.seniority || "mid").trim();
      const liIndustry = String(liMeta.industry || "").trim();
      const liLocation = String(liMeta.location || "").trim();
      const liTone = String(liMeta.tone || "clean").trim();

      let data;
      try {
        data = await callOpenAIJson({
          apiKey,
          model,
          system: buildLinkedInSystem(outLang),
          userPrompt: buildLinkedInPrompt({
            cv,
            jd,
            outLang,
            preview: isPreview,
            targetRole: liTargetRole,
            seniority: liSeniority,
            industry: liIndustry,
            location: liLocation,
            tone: liTone,
          }),
          temperature: 0.1,
          maxTokens: isPreview ? 1200 : 2400,
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

    const analyzeSystem = buildAtsAnalyzeSystem(outLang);
    const optimizeSystem = buildAtsOptimizeSystem(outLang);

    let analysisData;
    try {
      analysisData = await callOpenAIJson({
        apiKey,
        model,
        system: analyzeSystem,
        userPrompt: buildAtsAnalyzePrompt({
          cv,
          jd,
          hasJD,
          outLang,
          preview: isPreview ? true : false,
        }),
        temperature: 0.1,
        maxTokens: isPreview ? 1400 : 2400,
      });
    } catch (err) {
      return res.status(err?.status || 500).json({
        error: err?.message || "OpenAI error",
        status: err?.status || 500,
        details: err?.details || String(err),
      });
    }

    const componentScores =
      analysisData?.component_scores && typeof analysisData.component_scores === "object"
        ? analysisData.component_scores
        : {};

    const originalScore = computeWeightedScore(componentScores, hasJD);

    const normalized = {
      ats_score: originalScore,
      component_scores: componentScores,
      missing_keywords: Array.isArray(analysisData?.missing_keywords)
        ? analysisData.missing_keywords
        : [],
      weak_sentences: Array.isArray(analysisData?.weak_sentences)
        ? analysisData.weak_sentences
        : [],
      summary: typeof analysisData?.summary === "string" ? analysisData.summary : "",
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

    async function scoreCandidate(candidateCv) {
      const data = await callOpenAIJson({
        apiKey,
        model,
        system: analyzeSystem,
        userPrompt: buildScorePrompt({
          cv: candidateCv,
          jd,
          hasJD,
        }),
        temperature: 0.1,
        maxTokens: 700,
      });

      const comps =
        data?.component_scores && typeof data.component_scores === "object"
          ? data.component_scores
          : {};
      return {
        componentScores: comps,
        score: computeWeightedScore(comps, hasJD),
      };
    }

    let bestValidOptimizedCv = "";
    let bestValidOptimizedScore = -1;
    let bestValidOptimizedComponentScores = {};

    let latestCandidateCv = "";
    let latestCandidateScore = -1;
    let latestCandidateComponentScores = {};

    const minGain = minimumGainNeeded(originalScore, hasJD);

    function maybeStoreBestValidCandidate(candidateCv, scoreData) {
      const safeCv = forceSafeResume(cv, candidateCv);
      const valid = !shouldRepairOptimizedCv(cv, safeCv, jd || "");

      latestCandidateCv = safeCv;
      latestCandidateScore = scoreData.score;
      latestCandidateComponentScores = scoreData.componentScores;

      if (!valid) return;

      if (scoreData.score > bestValidOptimizedScore) {
        bestValidOptimizedCv = safeCv;
        bestValidOptimizedScore = scoreData.score;
        bestValidOptimizedComponentScores = scoreData.componentScores;
      }
    }

    let firstOptimized = "";
    try {
      const optimizeData = await callOpenAIJson({
        apiKey,
        model,
        system: optimizeSystem,
        userPrompt: buildAtsOptimizePrompt({
          cv,
          jd,
          hasJD,
          outLang,
          analysisSummary: normalized.summary,
          missingKeywords: normalized.missing_keywords,
        }),
        temperature: 0.1,
        maxTokens: 2200,
      });

      firstOptimized =
        typeof optimizeData?.optimized_cv === "string"
          ? optimizeData.optimized_cv.trim()
          : "";
    } catch (err) {
      return res.status(err?.status || 500).json({
        error: err?.message || "OpenAI error",
        status: err?.status || 500,
        details: err?.details || String(err),
      });
    }

    if (firstOptimized) {
      try {
        const safeFirstCv = forceSafeResume(cv, firstOptimized);
        const firstScore = await scoreCandidate(safeFirstCv);

        latestCandidateCv = safeFirstCv;
        latestCandidateScore = firstScore.score;
        latestCandidateComponentScores = firstScore.componentScores;

        maybeStoreBestValidCandidate(safeFirstCv, firstScore);
      } catch {
        latestCandidateCv = forceSafeResume(cv, firstOptimized);
        latestCandidateScore = -1;
        latestCandidateComponentScores = {};
      }
    }

    let candidateCv = latestCandidateCv;
    let candidateScore = latestCandidateScore;
    let candidateComponentScores = latestCandidateComponentScores;

    const needsRepair =
      !bestValidOptimizedCv ||
      shouldRepairOptimizedCv(cv, candidateCv, jd || "") ||
      (candidateScore >= 0 && candidateScore < originalScore + minGain);

    if (needsRepair) {
      let repairAttempts = 2;

      while (repairAttempts > 0) {
        repairAttempts -= 1;

        let repairedCv = "";
        try {
          const repaired = await callOpenAIJson({
            apiKey,
            model,
            system: optimizeSystem,
            userPrompt: buildAtsRepairPrompt({
              cv,
              jd,
              hasJD,
              outLang,
              currentOptimizedCv: candidateCv || firstOptimized || cv,
              analysisSummary: normalized.summary,
              missingKeywords: normalized.missing_keywords,
            }),
            temperature: 0.1,
            maxTokens: 2200,
          });

          repairedCv =
            typeof repaired?.optimized_cv === "string"
              ? repaired.optimized_cv.trim()
              : "";
        } catch {
          repairedCv = "";
        }

        if (!repairedCv) break;

        try {
          const safeRepairedCv = forceSafeResume(cv, repairedCv);
          const repairedScoreData = await scoreCandidate(safeRepairedCv);
          const repairedScore = repairedScoreData.score;

          maybeStoreBestValidCandidate(safeRepairedCv, {
            score: repairedScore,
            componentScores: repairedScoreData.componentScores,
          });

          candidateCv = safeRepairedCv;
          candidateScore = repairedScore;
          candidateComponentScores = repairedScoreData.componentScores;

          if (
            !shouldRepairOptimizedCv(cv, safeRepairedCv, jd || "") &&
            repairedScore >= originalScore + minGain
          ) {
            break;
          }
        } catch {
          // devam
        }
      }
    }

    const finalOptimizedCv =
      bestValidOptimizedCv || forceSafeResume(cv, candidateCv || firstOptimized || "");

    const finalPayload = {
      ats_score: normalized.ats_score,
      missing_keywords: normalized.missing_keywords,
      weak_sentences: normalized.weak_sentences,
      optimized_cv: finalOptimizedCv,
      summary: normalized.summary,
      review_mode: hasJD ? "job_specific" : "general",
    };

    return res.status(200).json(finalPayload);
  } catch (err) {
    return res.status(500).json({
      error: "Server error",
      details: err?.message || String(err),
    });
  }
}
