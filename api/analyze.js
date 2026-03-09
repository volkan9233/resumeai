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

function isGpt5Model(model = "") {
  return /^gpt-5/i.test(String(model).trim());
}

function buildOpenAIPayload({
  model,
  messages,
  reasoningEffort = null,
  temperature = null,
  maxCompletionTokens = 1800,
}) {
  const body = {
    model,
    response_format: { type: "json_object" },
    messages,
  };

  if (isGpt5Model(model)) {
    body.max_completion_tokens = maxCompletionTokens;
    if (reasoningEffort) body.reasoning_effort = reasoningEffort;

    // GPT-5 reasoning modlarında temperature göndermiyoruz.
    // Sadece none kullandığımız preview / fallback denemelerinde veriyoruz.
    if (reasoningEffort === "none" && typeof temperature === "number") {
      body.temperature = temperature;
    }
  } else {
    body.max_tokens = maxCompletionTokens;
    if (typeof temperature === "number") body.temperature = temperature;
  }

  return body;
}

function extractAssistantText(parsed) {
  const content = parsed?.choices?.[0]?.message?.content;

  if (typeof content === "string") return content;

  if (Array.isArray(content)) {
    return content
      .map((part) => {
        if (typeof part === "string") return part;
        if (typeof part?.text === "string") return part.text;
        if (typeof part?.content === "string") return part.content;
        return "";
      })
      .join("")
      .trim();
  }

  return "";
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
  return /^(PROFESSIONAL SUMMARY|SUMMARY|PROFILE|PROFIL|PROFİL|EXPERIENCE|WORK EXPERIENCE|SKILLS|EDUCATION|LANGUAGES|CERTIFICATIONS|PROFESYONEL ÖZET|ÖZET|DENEYİM|İŞ DENEYİMİ|YETKİNLİKLER|BECERİLER|YETENEKLER|EĞİTİM|YABANCI DİL|DİLLER|SERTİFİKALAR)$/i.test(
    String(line).trim()
  );
}

function isBodySectionHeader(line = "") {
  return /^(EXPERIENCE|WORK EXPERIENCE|SKILLS|EDUCATION|LANGUAGES|CERTIFICATIONS|DENEYİM|İŞ DENEYİMİ|YETKİNLİKLER|BECERİLER|YETENEKLER|EĞİTİM|YABANCI DİL|DİLLER|SERTİFİKALAR)$/i.test(
    String(line).trim()
  );
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

function hasSummarySection(cv = "") {
  return /^(PROFESSIONAL SUMMARY|SUMMARY|PROFILE|PROFIL|PROFİL|PROFESYONEL ÖZET|ÖZET)$/im.test(
    String(cv || "")
  );
}

function extractIdentityBlock(cv = "") {
  const lines = getNonEmptyLines(cv);
  const out = [];

  for (const line of lines) {
    if (isSectionHeader(line)) break;
    out.push(line);
    if (out.length >= 4) break;
  }

  return out;
}

function extractSummarySection(cv = "") {
  const lines = String(cv || "").replace(/\r/g, "").split("\n");
  const start = lines.findIndex((x) =>
    /^(PROFESSIONAL SUMMARY|SUMMARY|PROFILE|PROFIL|PROFİL|PROFESYONEL ÖZET|ÖZET)$/i.test(
      String(x).trim()
    )
  );

  if (start === -1) return "";

  let end = lines.length;
  for (let i = start + 1; i < lines.length; i++) {
    if (isBodySectionHeader(String(lines[i]).trim())) {
      end = i;
      break;
    }
  }

  return lines.slice(start, end).join("\n").trim();
}

function replaceIdentityBlock(originalCv = "", optimizedCv = "") {
  const identity = extractIdentityBlock(originalCv);
  if (!identity.length) return String(optimizedCv || "").trim();

  const lines = String(optimizedCv || "").replace(/\r/g, "").split("\n");
  const firstSectionIdx = lines.findIndex((x) => isSectionHeader(String(x).trim()));

  const body =
    firstSectionIdx === -1
      ? String(optimizedCv || "").trim()
      : lines.slice(firstSectionIdx).join("\n").trim();

  return `${identity.join("\n")}\n\n${body}`.trim();
}

function ensureSummarySection(originalCv = "", optimizedCv = "") {
  const out = String(optimizedCv || "").trim();
  if (!out) return out;

  if (hasSummarySection(out)) return out;

  const originalSummary = extractSummarySection(originalCv);
  if (!originalSummary) return out;

  const lines = out.replace(/\r/g, "").split("\n");
  const firstBodyIdx = lines.findIndex((x) =>
    isBodySectionHeader(String(x).trim())
  );

  if (firstBodyIdx === -1) {
    return `${out}\n\n${originalSummary}`.replace(/\n{3,}/g, "\n\n").trim();
  }

  const beforeBody = lines.slice(0, firstBodyIdx).join("\n").trim();
  const body = lines.slice(firstBodyIdx).join("\n").trim();

  return `${beforeBody}\n\n${originalSummary}\n\n${body}`
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function forceSafeResume(originalCv = "", optimizedCv = "") {
  let out = String(optimizedCv || "").trim();
  out = replaceIdentityBlock(originalCv, out);
  out = ensureSummarySection(originalCv, out);
  out = restoreExperienceTitles(originalCv, out);
  return out.trim();
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

function countMetricHits(cv = "") {
  const bullets = getBulletLines(cv);
  return bullets.filter((b) =>
    /\b\d+(?:[.,]\d+)?\s*(?:%|x|years?|year|months?|month|yıl|ay|kişi|person|users?|müşteri|clients?|TL|USD|EUR|₺|\$|€)\b/i.test(
      b
    ) || /\b\d+(?:[.,]\d+)?%\b/.test(b)
  ).length;
}

function extractJdKeywords(text = "") {
  const stop = new Set([
    "and",
    "the",
    "for",
    "with",
    "from",
    "that",
    "this",
    "your",
    "have",
    "has",
    "will",
    "our",
    "are",
    "job",
    "role",
    "team",
    "work",
    "years",
    "year",
    "plus",
    "candidate",
    "requirements",
    "preferred",
    "ability",
    "experience",
    "responsible",
    "using",
    "used",
    "must",
    "should",
    "need",
    "needs",
    "ve",
    "ile",
    "için",
    "icin",
    "üzere",
    "uzere",
    "olarak",
    "ilgili",
    "gibi",
    "olan",
    "deneyim",
    "tecrübe",
    "görev",
    "tercihen",
    "aday",
    "çalışma",
    "calisma",
    "ekip",
    "pozisyon",
  ]);

  return [
    ...new Set(
      normalizeCompareText(text)
        .split(/\s+/)
        .filter((w) => w.length >= 4 && !stop.has(w))
    ),
  ].slice(0, 60);
}

function keywordOverlapScore(cv = "", jd = "") {
  const cvText = ` ${normalizeCompareText(cv)} `;
  const keywords = extractJdKeywords(jd);
  if (!keywords.length) return 1;

  let hits = 0;
  for (const kw of keywords) {
    if (cvText.includes(` ${kw} `)) hits++;
  }

  return hits / keywords.length;
}

function computeHeuristicAtsScore(cv = "", jd = "") {
  let score = 100;

  const bullets = getBulletLines(cv);
  const weakVerbHits = countWeakVerbHits(cv);
  const metricHits = countMetricHits(cv);
  const lines = getNonEmptyLines(cv);
  const header = extractIdentityBlock(cv).join(" ");

  const hasSummary =
    /^(PROFESSIONAL SUMMARY|SUMMARY|PROFILE|PROFIL|PROFİL|PROFESYONEL ÖZET|ÖZET)$/im.test(
      cv
    );
  const hasExperience =
    /^(EXPERIENCE|WORK EXPERIENCE|DENEYİM|İŞ DENEYİMİ)$/im.test(cv);
  const hasEducation = /^(EDUCATION|EĞİTİM)$/im.test(cv);
  const hasSkills =
    /^(SKILLS|BECERİLER|YETKİNLİKLER|YETENEKLER)$/im.test(cv);

  if (!hasSummary) score -= 8;
  if (!hasExperience) score -= 25;
  if (!hasEducation) score -= 8;
  if (!hasSkills) score -= 8;

  if (bullets.length === 0) score -= 18;
  else if (bullets.length < 4) score -= 12;
  else if (bullets.length < 7) score -= 6;

  if (metricHits === 0) score -= 8;
  else if (metricHits < 2) score -= 4;

  if (weakVerbHits >= 5) score -= 12;
  else if (weakVerbHits >= 3) score -= 8;
  else if (weakVerbHits >= 1) score -= 4;

  if (lines.length < 10) score -= 10;
  else if (lines.length < 16) score -= 5;

  if (!/@/.test(header)) score -= 6;
  if (!/\+?\d[\d\s()-]{7,}/.test(header)) score -= 4;

  if (jd && jd.trim()) {
    const overlap = keywordOverlapScore(cv, jd);
    if (overlap < 0.1) score -= 18;
    else if (overlap < 0.2) score -= 12;
    else if (overlap < 0.35) score -= 6;
  }

  return clampScore(score);
}

function computeFinalAtsScore(modelScore, cv = "", jd = "") {
  const model = clampScore(modelScore);
  const heuristic = computeHeuristicAtsScore(cv, jd);

  // Heuristic biraz daha baskın
  return clampScore(Math.round(model * 0.4 + heuristic * 0.6));
}

function shouldRepairOptimizedCv(originalCv = "", optimizedCv = "") {
  if (!optimizedCv || !String(optimizedCv).trim()) return true;

  const origNorm = normalizeCompareText(originalCv);
  const optNorm = normalizeCompareText(optimizedCv);

  if (!optNorm) return true;
  if (origNorm === optNorm) return true;

  const { same, total } = countUnchangedBullets(originalCv, optimizedCv);
  if (total > 0 && same / total >= 0.65) return true;

  const optimizedBullets = getBulletLines(optimizedCv);
  if (total > 0 && optimizedBullets.length < Math.max(2, Math.floor(total * 0.6))) {
    return true;
  }

  if (countWeakVerbHits(optimizedCv) >= 4) return true;

  if (hasSummarySection(originalCv) && !hasSummarySection(optimizedCv)) {
    return true;
  }

  return false;
}

function buildAttempts({ model, isPreview, passType, maxCompletionTokens }) {
  if (!isGpt5Model(model)) {
    return [
      {
        reasoningEffort: null,
        temperature: isPreview ? 0.2 : 0.3,
        maxCompletionTokens,
      },
    ];
  }

  if (passType === "repair") {
    return [
      {
        reasoningEffort: "low",
        temperature: null,
        maxCompletionTokens: Math.max(maxCompletionTokens, 2000),
      },
    ];
  }

  if (isPreview) {
    return [
      {
        reasoningEffort: "none",
        temperature: 0.2,
        maxCompletionTokens: Math.max(maxCompletionTokens, 1200),
      },
    ];
  }

  return [
    {
      reasoningEffort: "low",
      temperature: null,
      maxCompletionTokens: Math.max(maxCompletionTokens, 1700),
    },
    {
      reasoningEffort: "none",
      temperature: 0.2,
      maxCompletionTokens: Math.max(maxCompletionTokens, 2000),
    },
  ];
}

async function callOpenAIJson({
  apiKey,
  model,
  system,
  userPrompt,
  isPreview = false,
  passType = "main",
  maxCompletionTokens = 1800,
}) {
  const attempts = buildAttempts({
    model,
    isPreview,
    passType,
    maxCompletionTokens,
  });

  let lastError = null;

  for (const attempt of attempts) {
    try {
      const openaiRes = await fetch("https://api.openai.com/v1/chat/completions", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${apiKey}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify(
          buildOpenAIPayload({
            model,
            messages: [
              { role: "system", content: system },
              { role: "user", content: userPrompt },
            ],
            reasoningEffort: attempt.reasoningEffort,
            temperature: attempt.temperature,
            maxCompletionTokens: attempt.maxCompletionTokens,
          })
        ),
      });

      const raw = await openaiRes.text();

      if (!openaiRes.ok) {
        const err = new Error("OpenAI error");
        err.status = openaiRes.status;
        err.details = raw.slice(0, 3000);
        throw err;
      }

      let parsed;
      try {
        parsed = JSON.parse(raw);
      } catch {
        const err = new Error("OpenAI returned non-JSON API payload");
        err.status = 500;
        err.details = raw.slice(0, 3000);
        throw err;
      }

      const finishReason = parsed?.choices?.[0]?.finish_reason || "";
      const text = extractAssistantText(parsed);

      if (!text || !text.trim()) {
        lastError = new Error("Model returned empty content");
        if (finishReason === "length") continue;
        continue;
      }

      let data;
      try {
        data = safeJsonParse(text);
      } catch (err) {
        lastError = err;
        continue;
      }

      if (
        data &&
        typeof data === "object" &&
        !Array.isArray(data) &&
        Object.keys(data).length === 0
      ) {
        lastError = new Error("Model returned empty JSON object");
        continue;
      }

      return data;
    } catch (err) {
      lastError = err;
      if (err?.status && err.status >= 400 && err.status < 500 && err.status !== 429) {
        throw err;
      }
    }
  }

  const err = new Error(lastError?.message || "Model did not return usable JSON");
  err.status = lastError?.status || 500;
  err.details = lastError?.details || String(lastError || "Unknown error");
  throw err;
}

function buildAtsSystem(outLang) {
  return `
CRITICAL RULES (must follow):
- Do NOT invent or assume ANY numbers, percentages, time periods, client names, revenue, KPIs, team size, budget, or results.
- Only use metrics that are explicitly present in the user's resume/job description input text.
- If a bullet has no measurable metric, rewrite it using: scope + actions + tools + context + outcome wording WITHOUT numbers.
- Never write “increased by X%”, “grew by X”, “reduced by X%”, “saved $X”, “managed $X budget”, “served X clients”, “led X people” unless those exact facts appear in the input text.
- If unsure, prefer neutral phrasing with no numbers.
- If the input contains a number, keep it exact; do not round up/down or change it.
- DO NOT invent employers, titles, degrees, dates, certifications, tools, platforms, acronyms, or projects.
- Do NOT replace generic wording with a specific tool/platform unless that tool/platform is explicitly present in the input.
- If the original text is support-oriented, you may make it clearer, but do NOT upgrade it into full ownership unless clearly supported.
- Rewrites must be materially better than the original.
- Do NOT make shallow synonym swaps or near-duplicate rewrites.
- Each rewrite must improve at least two of these: clarity, ownership, specificity, scope, action strength, business context.
- If a rewrite is too similar to the original, rewrite it again with stronger professional phrasing.
- Return ONLY valid JSON. No markdown. No extra text.
- All output VALUES MUST be written ONLY in ${outLang}. Do not mix languages.
`.trim();
}

function buildLinkedInSystem(outLang) {
  return `
CRITICAL RULES (must follow):
- Do NOT invent or assume ANY numbers, percentages, time periods, client names, revenue, KPIs, team size, budget, or results.
- Only use metrics that are explicitly present in the user's resume/job description input text.
- If a bullet has no measurable metric, rewrite it using: scope + actions + tools + context + outcome wording WITHOUT numbers.
- Never write “increased by X%”, “grew by X”, “reduced by X%”, “saved $X”, “managed $X budget”, “served X clients”, “led X people” unless those exact facts appear in the input text.
- If unsure, prefer neutral phrasing with no numbers.
- If the input contains a number, keep it exact; do not round up/down or change it.
- Do NOT invent employers, titles, degrees, dates, certifications, or metrics.
- Do NOT replace generic platform language with a specific platform unless it is explicitly present.
- Return ONLY valid JSON. No markdown. No extra text.
- All output VALUES MUST be written ONLY in ${outLang}. Do not mix languages.
`.trim();
}

function buildPreviewAtsPrompt({ cv, jd, hasJD, outLang }) {
  if (hasJD) {
    return `
Return JSON in this exact schema:

{
  "ats_score": number,
  "missing_keywords": string[],
  "weak_sentences": [{"sentence": string, "rewrite": string}],
  "summary": string
}

REQUIREMENTS:
- This is a JOB-SPECIFIC ATS MATCH because a job description is provided.
- ats_score must reflect resume-to-job alignment, not just general resume quality.
- missing_keywords MUST include 5-7 items that are genuinely missing or underrepresented from the JOB DESCRIPTION.
- missing_keywords MUST be unique, role-relevant, and written in ${outLang}.
- weak_sentences MUST include up to 2 items picked from real resume sentences.
- Do NOT force the count.
- Both sentence and rewrite MUST be in ${outLang}.
- Select only sentences where a clearly better rewrite is possible.
- Do NOT select sentences that can only be improved with tiny synonym swaps.
- Each rewrite must feel meaningfully stronger, clearer, and more professional.
- summary MUST be 4-6 bullet lines in ${outLang}.
- summary must focus on job fit, biggest missing keywords, ATS risks, and top improvements.
- Do NOT add extra keys. Do NOT add optimized_cv.

SCORING RUBRIC:
- 0-20 = very poor resume: missing core sections, weak or no bullets, little usable signal, very low ATS readiness.
- 21-35 = poor resume: generic wording, thin content, weak experience bullets, low keyword evidence, low recruiter confidence.
- 36-50 = below average: some structure exists but bullets are weak, evidence is limited, keyword coverage is modest.
- 51-65 = average: readable and usable but still has clear ATS and recruiter weaknesses.
- 66-80 = strong: clear structure, relevant keywords, solid bullet writing, generally ATS-friendly.
- 81-100 = excellent: strong, specific, well-structured, highly ATS-friendly, and well aligned.

MANDATORY PENALTIES:
- Missing clear section headers: subtract 10-15
- Very few or no experience bullets: subtract 8-15
- No concrete evidence or metrics in bullets: subtract 5-10
- Mostly weak/generic phrasing: subtract 8-15
- Poor keyword coverage for the likely role: subtract 5-15
- If unsure, score lower, not higher

IMPORTANT:
- Do not cluster weak resumes in the high 30s or 40s.
- Truly weak resumes should usually fall in the 15-35 range.

RESUME:
${cv}

JOB DESCRIPTION:
${jd}
`.trim();
  }

  return `
Return JSON in this exact schema:

{
  "ats_score": number,
  "missing_keywords": string[],
  "weak_sentences": [{"sentence": string, "rewrite": string}],
  "summary": string
}

REQUIREMENTS:
- This is a GENERAL ATS REVIEW because no job description is provided.
- ats_score must reflect general ATS readiness: structure, section completeness, clarity, bullet strength, and keyword coverage.
- missing_keywords MUST include 5-7 items.
- These are NOT job-specific missing keywords. They should be recommended ATS/recruiter-friendly resume keywords based on the candidate's apparent role and experience.
- missing_keywords MUST be unique, practical, role-relevant, and written in ${outLang}.
- weak_sentences MUST include up to 2 items picked from real resume sentences.
- Do NOT force the count.
- Both sentence and rewrite MUST be in ${outLang}.
- Select only sentences where a clearly better rewrite is possible.
- Do NOT select sentences that can only be improved with tiny synonym swaps.
- Each rewrite must feel meaningfully stronger, clearer, and more professional.
- summary MUST be 4-6 bullet lines in ${outLang}.
- summary must focus on general ATS readiness, structure, clarity, and top improvement areas.
- Do NOT add extra keys. Do NOT add optimized_cv.

SCORING RUBRIC:
- 0-20 = very poor resume: missing core sections, weak or no bullets, little usable signal, very low ATS readiness.
- 21-35 = poor resume: generic wording, thin content, weak experience bullets, low keyword evidence, low recruiter confidence.
- 36-50 = below average: some structure exists but bullets are weak, evidence is limited, keyword coverage is modest.
- 51-65 = average: readable and usable but still has clear ATS and recruiter weaknesses.
- 66-80 = strong: clear structure, relevant keywords, solid bullet writing, generally ATS-friendly.
- 81-100 = excellent: strong, specific, well-structured, highly ATS-friendly, and well aligned.

MANDATORY PENALTIES:
- Missing clear section headers: subtract 10-15
- Very few or no experience bullets: subtract 8-15
- No concrete evidence or metrics in bullets: subtract 5-10
- Mostly weak/generic phrasing: subtract 8-15
- Poor keyword coverage for the likely role: subtract 5-15
- If unsure, score lower, not higher

IMPORTANT:
- Do not cluster weak resumes in the high 30s or 40s.
- Truly weak resumes should usually fall in the 15-35 range.

RESUME:
${cv}
`.trim();
}

function buildFullAtsPrompt({ cv, jd, hasJD, outLang }) {
  if (hasJD) {
    return `
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
- ats_score must reflect resume-to-job alignment.
- missing_keywords MUST include 18-30 items genuinely missing or underrepresented from the JOB DESCRIPTION.
- missing_keywords MUST be unique, role-relevant, and written in ${outLang}.
- weak_sentences MUST include 6-10 items from the resume text.
- Do NOT force the count if there are fewer truly strong examples.
- Both sentence and rewrite MUST be in ${outLang}.
- Do NOT use shallow synonym swaps or near-duplicate rewrites.
- Each rewrite must improve at least two of these: clarity, ownership, specificity, scope, action strength, business context.
- summary MUST be detailed (8-12 bullet lines) in ${outLang} covering job fit, top missing skills/keywords, biggest ATS risks, and top rewrite themes.
- optimized_cv MUST be a complete rewritten resume aligned to the job description and written in ${outLang}.
- Keep claims truthful. Do not invent employers, degrees, titles, dates, tools, metrics, acronyms, or platforms.
- Do NOT invent or assume numbers/percentages/results. Use numbers ONLY if they exist in RESUME or JOB DESCRIPTION.
- If resume has no numbers, do NOT add any numbers in rewrites.
- Keep the header identity block and existing experience titles unchanged.
- Keep or rewrite the existing profile/summary section. Do NOT remove it.
- Do NOT remove non-empty sections such as Languages or Certifications.
- Prefer concise ATS-friendly bullets, roughly 12-24 words each.
- Avoid overly long paragraph-like bullets.
- Each bullet should be direct, keyword-relevant, and recruiter-friendly.

SCORING RUBRIC:
- 0-20 = very poor resume: missing core sections, weak or no bullets, little usable signal, very low ATS readiness.
- 21-35 = poor resume: generic wording, thin content, weak experience bullets, low keyword evidence, low recruiter confidence.
- 36-50 = below average: some structure exists but bullets are weak, evidence is limited, keyword coverage is modest.
- 51-65 = average: readable and usable but still has clear ATS and recruiter weaknesses.
- 66-80 = strong: clear structure, relevant keywords, solid bullet writing, generally ATS-friendly.
- 81-100 = excellent: strong, specific, well-structured, highly ATS-friendly, and well aligned.

MANDATORY PENALTIES:
- Missing clear section headers: subtract 10-15
- Very few or no experience bullets: subtract 8-15
- No concrete evidence or metrics in bullets: subtract 5-10
- Mostly weak/generic phrasing: subtract 8-15
- Poor keyword coverage for the likely role: subtract 5-15
- If unsure, score lower, not higher

IMPORTANT:
- Do not cluster weak resumes in the high 30s or 40s.
- Truly weak resumes should usually fall in the 15-35 range.

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
  "ats_score": number,
  "missing_keywords": string[],
  "weak_sentences": [{"sentence": string, "rewrite": string}],
  "optimized_cv": string,
  "summary": string
}

HARD REQUIREMENTS:
- This is a GENERAL ATS REVIEW because no job description is provided.
- ats_score must reflect general ATS readiness, not job match.
- missing_keywords MUST include 15-25 items.
- These are NOT job-specific missing keywords. They must be recommended ATS/recruiter-friendly resume keywords based on the candidate's likely role, seniority, and experience.
- missing_keywords MUST be unique, practical, and written in ${outLang}.
- weak_sentences MUST include 6-10 items from the resume text.
- Do NOT force the count if there are fewer truly strong examples.
- Both sentence and rewrite MUST be in ${outLang}.
- Do NOT use shallow synonym swaps or near-duplicate rewrites.
- Each rewrite must improve at least two of these: clarity, ownership, specificity, scope, action strength, business context.
- summary MUST be detailed (8-12 bullet lines) in ${outLang} covering general ATS readiness, top keyword gaps, biggest ATS risks, and top rewrite themes.
- optimized_cv MUST be a complete rewritten ATS-friendly resume in ${outLang}.
- It must improve structure, clarity, section naming, bullet writing, and recruiter readability.
- Keep claims truthful. Do not invent employers, degrees, titles, dates, tools, metrics, acronyms, or platforms.
- Do NOT invent or assume numbers/percentages/results. Use numbers ONLY if they exist in RESUME.
- If resume has no numbers, do NOT add any numbers in rewrites.
- Keep the header identity block and existing experience titles unchanged.
- Keep or rewrite the existing profile/summary section. Do NOT remove it.
- Do NOT remove non-empty sections such as Languages or Certifications.
- Prefer concise ATS-friendly bullets, roughly 12-24 words each.
- Avoid overly long paragraph-like bullets.
- Each bullet should be direct, keyword-relevant, and recruiter-friendly.

SCORING RUBRIC:
- 0-20 = very poor resume: missing core sections, weak or no bullets, little usable signal, very low ATS readiness.
- 21-35 = poor resume: generic wording, thin content, weak experience bullets, low keyword evidence, low recruiter confidence.
- 36-50 = below average: some structure exists but bullets are weak, evidence is limited, keyword coverage is modest.
- 51-65 = average: readable and usable but still has clear ATS and recruiter weaknesses.
- 66-80 = strong: clear structure, relevant keywords, solid bullet writing, generally ATS-friendly.
- 81-100 = excellent: strong, specific, well-structured, highly ATS-friendly, and well aligned.

MANDATORY PENALTIES:
- Missing clear section headers: subtract 10-15
- Very few or no experience bullets: subtract 8-15
- No concrete evidence or metrics in bullets: subtract 5-10
- Mostly weak/generic phrasing: subtract 8-15
- Poor keyword coverage for the likely role: subtract 5-15
- If unsure, score lower, not higher

IMPORTANT:
- Do not cluster weak resumes in the high 30s or 40s.
- Truly weak resumes should usually fall in the 15-35 range.

Return ONLY valid JSON.

RESUME:
${cv}
`.trim();
}

function buildRepairPrompt({ cv, jd, hasJD, currentOptimizedCv }) {
  return hasJD
    ? `
Return JSON in this exact schema:

{
  "optimized_cv": string
}

TASK:
You already generated an optimized resume, but it is still too close to the original or still contains weak phrasing.
Rewrite it again so the result is materially stronger, cleaner, more ATS-friendly, and more recruiter-ready.

STRICT RULES:
- Keep the header identity block exactly as written.
- Keep existing experience titles unchanged.
- Keep exact dates, employers, titles, degrees, and explicit years of experience unchanged.
- Do NOT invent metrics, tools, platforms, acronyms, or achievements.
- Do NOT replace generic platform language with specific platforms unless explicitly present.
- Do NOT upgrade support-oriented work into full ownership unless clearly supported.
- Every experience bullet should be materially stronger than the original resume bullet.
- Avoid these weak phrases:
  helped, assisted, supported, involved in, responsible for, contributed to, worked on, played a key role in, participated in, handled,
  destek verdim, destek oldum, katkı sağladım, görev aldım, yardımcı oldum
- Prefer direct action + scope + business context wording.
- Keep or rewrite the existing profile/summary section. Do NOT remove it.
- Do NOT remove non-empty sections such as Languages or Certifications.
- Prefer concise ATS-friendly bullets, roughly 12-24 words each.
- Avoid overly long paragraph-like bullets.
- The result must not read like a lightly polished copy.
- The result must still be a truthful ATS-friendly resume aligned to the job description.

RESUME (original):
${cv}

JOB DESCRIPTION:
${jd}

CURRENT OPTIMIZED CV (rewrite this into a stronger final version):
${currentOptimizedCv}
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
- Keep the header identity block exactly as written.
- Keep existing experience titles unchanged.
- Keep exact dates, employers, titles, degrees, and explicit years of experience unchanged.
- Do NOT invent metrics, tools, platforms, acronyms, or achievements.
- Do NOT replace generic platform language with specific platforms unless explicitly present.
- Do NOT upgrade support-oriented work into full ownership unless clearly supported.
- This is GENERAL optimization without a job description.
- Every experience bullet should be materially stronger than the original resume bullet.
- Avoid these weak phrases:
  helped, assisted, supported, involved in, responsible for, contributed to, worked on, played a key role in, participated in, handled,
  destek verdim, destek oldum, katkı sağladım, görev aldım, yardımcı oldum
- Prefer direct action + scope + business context wording.
- Keep or rewrite the existing profile/summary section. Do NOT remove it.
- Do NOT remove non-empty sections such as Languages or Certifications.
- Prefer concise ATS-friendly bullets, roughly 12-24 words each.
- Avoid overly long paragraph-like bullets.
- The result must not read like a lightly polished copy.

RESUME (original):
${cv}

CURRENT OPTIMIZED CV (rewrite this into a stronger final version):
${currentOptimizedCv}
`.trim();
}

function buildLinkedInPreviewPrompt({
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
- Output VALUES must be in ${outLang} (proper nouns/tools can stay).
- headlines: exactly 1 item.
- about.short: 250-450 chars, punchy, concise, no emojis.
- experience_fix: up to 1 item. Choose only a sentence where a clearly better rewrite is possible.
- skills.top: 5-7 items.
- recruiter.keywords: 4-6 items.
- Keep output compact and concise for preview mode.
- No extra keys. Return ONLY valid JSON.

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

function buildLinkedInFullPrompt({
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
- Do NOT invent employers, titles, dates, degrees, or metrics.
- If resume has no numbers, improve bullets without guessing numbers.
- Headline max 220 chars each. No emojis.
- about.short: 300-500 chars.
- about.normal: 600-900 chars.
- about.bold: 600-900 chars.
- headlines: exactly 5 items with labels Search, Impact, Niche, Leadership, Clean.
- experience_fix: 4-6 items maximum, only if there are real, materially stronger rewrites.
- skills.top: 10-14
- skills.tools: 6-10
- skills.industry: 8-14
- recruiter.keywords: 8-12
- recruiter.boolean: a single boolean string using OR groups + a few AND terms.
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
      return res.status(500).json({ error: "OPENAI_API_KEY is missing on Vercel" });
    }

    const previewModel = process.env.OPENAI_MODEL_PREVIEW || "gpt-5-mini";
    const fullModel = process.env.OPENAI_MODEL_FULL || "gpt-5.1";
    const model = isPreview ? previewModel : fullModel;

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
          userPrompt: isPreview
            ? buildLinkedInPreviewPrompt({
                cv,
                jd,
                outLang,
                liTargetRole,
                liSeniority,
                liIndustry,
                liLocation,
                liTone,
              })
            : buildLinkedInFullPrompt({
                cv,
                jd,
                outLang,
                liTargetRole,
                liSeniority,
                liIndustry,
                liLocation,
                liTone,
              }),
          isPreview,
          passType: "main",
          maxCompletionTokens: isPreview ? 1800 : 2200,
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

    let data;
    try {
      data = await callOpenAIJson({
        apiKey,
        model,
        system: buildAtsSystem(outLang),
        userPrompt: isPreview
          ? buildPreviewAtsPrompt({ cv, jd, hasJD, outLang })
          : buildFullAtsPrompt({ cv, jd, hasJD, outLang }),
        isPreview,
        passType: "main",
        maxCompletionTokens: isPreview ? 1200 : 1700,
      });
    } catch (err) {
      return res.status(err?.status || 500).json({
        error: err?.message || "OpenAI error",
        status: err?.status || 500,
        details: err?.details || String(err),
      });
    }

    const normalized = {
      ats_score: computeFinalAtsScore(data?.ats_score, cv, hasJD ? jd : ""),
      missing_keywords: Array.isArray(data?.missing_keywords) ? data.missing_keywords : [],
      weak_sentences: Array.isArray(data?.weak_sentences) ? data.weak_sentences : [],
      summary: typeof data?.summary === "string" ? data.summary : "",
      ...(isPreview
        ? {}
        : {
            optimized_cv: typeof data?.optimized_cv === "string" ? data.optimized_cv : "",
          }),
    };

    if (!isPreview) {
      let currentOptimized = forceSafeResume(cv, normalized.optimized_cv || "");

      if (!currentOptimized || shouldRepairOptimizedCv(cv, currentOptimized)) {
        try {
          const repaired = await callOpenAIJson({
            apiKey,
            model,
            system: buildAtsSystem(outLang),
            userPrompt: buildRepairPrompt({
              cv,
              jd,
              hasJD,
              currentOptimizedCv: currentOptimized || cv,
            }),
            isPreview: false,
            passType: "repair",
            maxCompletionTokens: 2200,
          });

          if (typeof repaired?.optimized_cv === "string" && repaired.optimized_cv.trim()) {
            currentOptimized = forceSafeResume(cv, repaired.optimized_cv.trim());
          }
        } catch {
          // İlk optimize edilmiş sürüm kullanılmaya devam eder
        }
      }

      normalized.optimized_cv = currentOptimized;
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
