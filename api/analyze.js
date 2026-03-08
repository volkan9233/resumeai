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
      bullet_strength * 0.20 +
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
    clarity_readability * 0.20 +
    bullet_strength * 0.20 +
    ats_safe_formatting * 0.20 +
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
      try {
        return JSON.parse(s.slice(start, end + 1));
      } catch (e) {
        console.error("JSON PARSE FAILED:", s.slice(0, 4000));
        throw e;
      }
    }

    console.error("MODEL RETURNED NON-JSON:", s.slice(0, 4000));
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
  if (total > 0 && same / total >= 0.34) return true;

  const optimizedBullets = getBulletLines(optimizedCv);
  if (total > 0 && optimizedBullets.length < Math.max(2, Math.floor(total * 0.8))) {
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

function isGpt5Model(model = "") {
  return /^gpt-5/i.test(String(model).trim());
}

function buildOpenAIRequestBody({
  model,
  system,
  userPrompt,
  isPreview,
}) {
  const isGpt5 = isGpt5Model(model);

  const body = {
    model,
    response_format: { type: "json_object" },
    max_completion_tokens: isPreview ? 1800 : 4200,
    messages: [
      { role: "system", content: system },
      { role: "user", content: userPrompt },
    ],
  };

  if (isGpt5) {
    body.reasoning_effort = isPreview ? "medium" : "high";
  } else {
    body.temperature = 0.1;
  }

  return body;
}

async function callOpenAIJson({
  apiKey,
  model,
  system,
  userPrompt,
  isPreview,
  timeoutMs = 95000,
}) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const body = buildOpenAIRequestBody({
      model,
      system,
      userPrompt,
      isPreview,
    });

    console.log("OPENAI REQUEST CONFIG:", {
      model,
      isPreview,
      usesGpt5Rules: isGpt5Model(model),
      max_completion_tokens: body.max_completion_tokens,
      reasoning_effort: body.reasoning_effort || null,
      has_temperature: Object.prototype.hasOwnProperty.call(body, "temperature"),
    });

    const openaiRes = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(body),
      signal: controller.signal,
    });

    const raw = await openaiRes.text();

    if (!openaiRes.ok) {
      const err = new Error("OpenAI error");
      err.status = openaiRes.status;
      err.details = raw.slice(0, 4000);

      console.error("OPENAI HTTP ERROR:", {
        status: openaiRes.status,
        body: raw.slice(0, 4000),
      });

      throw err;
    }

    const parsed = JSON.parse(raw);
    const text = parsed?.choices?.[0]?.message?.content || "{}";

    console.log("OPENAI RAW SUCCESS PREVIEW:", String(text).slice(0, 600));

    return safeJsonParse(text);
  } catch (err) {
    if (err?.name === "AbortError") {
      const timeoutErr = new Error("OpenAI request timed out");
      timeoutErr.status = 504;
      timeoutErr.details = `Timeout after ${timeoutMs} ms`;
      console.error("OPENAI TIMEOUT:", {
        model,
        timeoutMs,
        isPreview,
      });
      throw timeoutErr;
    }
    throw err;
  } finally {
    clearTimeout(timeout);
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

    if (!cv || !String(cv).trim()) {
      return res.status(400).json({ error: "cv is required" });
    }

    const apiKey = process.env.OPENAI_API_KEY;
    if (!apiKey) {
      return res.status(500).json({ error: "OPENAI_API_KEY is missing on Vercel" });
    }

    const model = process.env.OPENAI_MODEL || "gpt-4.1";

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
CRITICAL TRUTH RULES:
- Do NOT invent or assume ANY numbers, percentages, time periods, client names, revenue, KPIs, team size, budget, or results.
- Only use facts explicitly supported by the user's resume and, if present, the job description.
- If the resume states a specific duration such as "6 years", keep it exact. Do NOT convert it into "5+ years" or any other variation.
- Do NOT invent employers, titles, degrees, dates, certifications, tools, platforms, channels, or projects.
- Do NOT replace generic wording with a specific tool or platform unless that tool or platform is explicitly present in the input.
- Example: if the resume says "social media platforms", do NOT rewrite it as "Meta" unless Meta is explicitly present.
- Do NOT upgrade skill levels. Example: if the resume says "basic data analysis", do NOT rewrite it as advanced expertise unless clearly supported.
- You may strengthen support-type tasks, but do NOT convert support into ownership or leadership unless clearly supported by the input.
- Use "led" ONLY if leadership is explicitly or very clearly supported.
- If a bullet has no measurable metric, rewrite it using:
  action + scope + context + business purpose
  WITHOUT numbers.

QUALITY RULES:
- Rewrites must be materially better than the original.
- Do NOT make shallow synonym swaps or near-duplicate rewrites.
- Each rewrite must improve at least two of these:
  clarity, specificity, action strength, business context, recruiter readability, ATS readability.
- If a rewrite is too similar to the original, rewrite it again more strongly.
- Prefer direct recruiter-ready phrasing over vague corporate language.
- Avoid filler phrasing such as:
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

OPTIMIZED CV RULES:
- optimized_cv MUST NOT feel like a lightly polished copy of the original resume.
- Every experience bullet in optimized_cv should be rewritten to sound more specific, recruiter-ready, and ATS-friendly while staying factually faithful.
- Even without numbers, bullets should sound concrete and professionally scoped.
- Avoid copying original bullets unless they are already highly optimized.
- Keep bullets concise, clean, and recruiter-friendly.

WEAK SENTENCE RULES:
- Only include a weak sentence if the rewrite is clearly better.
- If not enough strong candidates exist, return fewer items.
- Never force low-quality before/after pairs.

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
- Do NOT invent or assume numbers, percentages, clients, KPIs, revenue, time periods, budgets, or results.
- Only use facts explicitly present in the resume and optional job description.
- If a sentence has no metrics, improve it using scope + action + context WITHOUT adding numbers.
- Do NOT invent employers, titles, degrees, dates, certifications, tools, or platforms.
- Do NOT replace generic platform language with a specific platform unless explicitly present.
- Rewrites must be materially better, not light synonym swaps.
- If a rewrite is too similar to the original, rewrite it again.
- All output VALUES must be written only in ${outLang}.

Return ONLY valid JSON.
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
- about.short: 500-900 chars.
- experience_fix: exactly 1 item.
- "before" must be a real resume sentence.
- "after" must be materially stronger, not a near-copy.
- skills.top: 7-10 items.
- recruiter.keywords: 5-8 items.
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

    const linkedinFullUser = `
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
- headlines: exactly 5 items with labels:
  1) "Search"
  2) "Impact"
  3) "Niche"
  4) "Leadership"
  5) "Clean"
- Headline max 220 chars each.
- about.short: 500-800 chars
- about.normal: 900-1400 chars
- about.bold: 900-1400 chars
- experience_fix: 4-6 items, fewer is allowed only if stronger items are not available.
- Each "before" must come from the resume.
- Each "after" must be materially stronger.
- skills.top: 10-18
- skills.tools: 6-16
- skills.industry: 8-20
- recruiter.keywords: 10-20
- recruiter.boolean: a usable boolean search string.
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

RULES:
- This is a JOB-SPECIFIC ATS MATCH.
- Score each component from 0 to 100:
  - jd_keyword_match
  - section_completeness
  - bullet_strength
  - ats_safe_formatting
  - role_alignment
- missing_keywords: exactly 5-7 genuine missing or underrepresented JD terms.
- missing_keywords must be unique and role-relevant.
- weak_sentences: up to 2 items from real resume sentences.
- Only include weak_sentences if the rewrite is clearly stronger.
- summary: 4-6 bullet-style lines focused on job fit, missing keywords, ATS risks, and best improvements.
- Do NOT add optimized_cv.

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

RULES:
- This is a GENERAL ATS REVIEW with no job description.
- Score each component from 0 to 100:
  - section_completeness
  - clarity_readability
  - bullet_strength
  - ats_safe_formatting
  - core_keyword_coverage
- missing_keywords: exactly 5-7 recommended ATS-friendly keywords based on the candidate's likely role.
- weak_sentences: up to 2 items from real resume sentences.
- Only include weak_sentences if the rewrite is clearly stronger.
- summary: 4-6 bullet-style lines focused on ATS readiness, clarity, structure, and top improvement areas.
- Do NOT add optimized_cv.

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
- It should score meaningfully higher if re-analyzed against the same JD.
- Improve keyword coverage, role alignment, section strength, recruiter clarity, and ATS relevance.
- Keep every claim truthful.

RULES:
- This is a JOB-SPECIFIC ATS MATCH.
- Score each component from 0 to 100.
- missing_keywords: 18-30 genuine missing or underrepresented JD terms.
- weak_sentences: 6-12 items from real resume text.
- Return fewer weak_sentences if stronger examples are limited.
- optimized_cv must be a full rewritten resume aligned to the JD.
- Do NOT invent numbers, tools, platforms, results, or achievements.
- Do NOT replace a generic platform with a specific one unless explicitly present.
- Keep exact explicit facts intact, including years, employers, titles, degrees, and dates.
- summary: 8-12 bullet-style lines covering job fit, missing keywords, ATS risks, rewrite themes, and why the optimized version should score better.

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
- Improve structure, clarity, recruiter readability, keyword strength, bullet quality, and overall role fit based on the resume's own content.

RULES:
- This is a GENERAL ATS REVIEW.
- Score each component from 0 to 100.
- missing_keywords: 18-30 ATS-friendly keywords based on the candidate's likely role and existing experience.
- weak_sentences: 6-12 items from real resume text.
- Return fewer weak_sentences if stronger examples are limited.
- optimized_cv must be a complete rewritten ATS-friendly resume.
- Keep exact explicit facts intact, including years, employers, titles, degrees, and dates.
- Do NOT invent numbers, tools, platforms, or achievements.
- Do NOT upgrade basic skill levels unless clearly supported.
- summary: 8-12 bullet-style lines covering ATS readiness, keyword gaps, format risks, rewrite themes, and why the optimized version is stronger.

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
        isPreview,
      });
    } catch (err) {
      console.error("OPENAI CALL FAILED:", {
        message: err?.message,
        status: err?.status,
        details: err?.details,
        stack: err?.stack,
      });

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
              typeof data?.optimized_cv === "string" ? data.optimized_cv : "",
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
- Keep exact dates, employers, titles, degrees, and explicit years of experience unchanged.
- Do NOT invent metrics, tools, platforms, or achievements.
- Do NOT replace generic platform language with specific platforms unless explicitly present.
- Do NOT upgrade basic skills to advanced proficiency unless clearly supported.
- Every experience bullet should be materially stronger than the original resume bullet.
- Avoid weak phrases such as:
  helped, assisted, supported, involved in, responsible for, contributed to, worked on, played a key role in, participated in, handled
- Prefer direct action + scope + business context wording.
- The result must not read like a lightly polished copy.
- The result must still be a truthful ATS-friendly resume aligned to the job description.

RESUME (original):
${cv}

JOB DESCRIPTION:
${jd}

CURRENT OPTIMIZED CV:
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
- Keep exact dates, employers, titles, degrees, and explicit years of experience unchanged.
- Do NOT invent metrics, tools, platforms, or achievements.
- Do NOT replace generic platform language with specific platforms unless explicitly present.
- Do NOT upgrade basic skills to advanced proficiency unless clearly supported.
- This is GENERAL optimization without a job description.
- Optimize for ATS readiness and recruiter clarity based on the resume's own content and apparent role.
- Every experience bullet should be materially stronger than the original resume bullet.
- Avoid weak phrases such as:
  helped, assisted, supported, involved in, responsible for, contributed to, worked on, played a key role in, participated in, handled
- Prefer direct action + scope + business context wording.
- The result must not read like a lightly polished copy.

RESUME (original):
${cv}

CURRENT OPTIMIZED CV:
${normalized.optimized_cv}
`.trim();

      try {
        const repaired = await callOpenAIJson({
          apiKey,
          model,
          system,
          userPrompt: repairPrompt,
          isPreview: false,
        });

        if (typeof repaired?.optimized_cv === "string" && repaired.optimized_cv.trim()) {
          normalized.optimized_cv = repaired.optimized_cv.trim();
        }
      } catch (repairErr) {
        console.error("OPTIMIZED CV REPAIR FAILED:", {
          message: repairErr?.message,
          status: repairErr?.status,
          details: repairErr?.details,
        });
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
    console.error("ANALYZE FATAL ERROR:", {
      message: err?.message,
      stack: err?.stack,
      status: err?.status,
      details: err?.details,
      name: err?.name,
    });

    return res.status(500).json({
      error: "Server error",
      details: err?.message || String(err),
    });
  }
}
