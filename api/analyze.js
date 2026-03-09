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

const WEAK_SENTENCE_RE =
  /\b(ilgilendim|bulundum|görev aldım|destek oldum|destek verdim|katkı sağladım|yardımcı oldum|sorumluydum|takip ettim|worked on|handled|supported|assisted|helped|was responsible for|contributed to|involved in|participated in)\b/i;

const WEAK_PHRASE_RE =
  /\b(helped|assisted|supported|involved in|responsible for|contributed to|worked on|played a key role in|participated in|handled|supported the team|took part in|ilgilendim|bulundum|baktım|yardım ettim|yardımcı oldum|destek verdim|destek oldum|katkı sağladım|görev aldım)\b/i;

const SUPPORT_RE =
  /\b(destek verdim|destek oldum|katkı sağladım|yardımcı oldum|görev aldım|assisted|supported|helped|contributed|participated|involved in)\b/i;

const OWNERSHIP_RE =
  /\b(yönettim|yürüttüm|koordine ettim|sahiplendim|liderlik ettim|geliştirdim|uyguladım|optimize ettim|tasarladım|planladım|launched|managed|owned|led|headed|drove|built|executed|optimized|developed)\b/i;

const OUTCOME_RE =
  /\b(artırdım|artirdim|iyileştirdim|iyilestirdim|optimize ettim|geliştirdim|gelistirdim|verimliliği artırdım|verimliligi artirdim|increased|improved|boosted|grew|reduced|optimized)\b/i;

const STRONG_ACTION_RE =
  /\b(yönettim|yürüttüm|koordine ettim|hazırladım|analiz ettim|raporladım|geliştirdim|oluşturdum|uyguladım|organize ettim|takip ettim|düzenledim|gerçekleştirdim|izledim|optimize ettim|tasarladım|planladım|uyarladım|sundum|managed|developed|coordinated|prepared|analyzed|reported|organized|implemented|tracked|maintained|optimized|planned|executed|designed|launched|created)\b/i;

const SPECIFICITY_RE =
  /\b(google ads|meta ads|meta ads manager|facebook ads|instagram ads|linkedin ads|linkedin campaign manager|tiktok ads|google analytics|google analytics 4|ga4|google tag manager|tag manager|seo|sem|ctr|cpc|cpa|roas|roi|cro|landing page|a\/b test|ab test|search console|hubspot|excel|google sheets|remarketing|retargeting|lead generation|email marketing|içerik stratejisi|performans pazarlaması|veri analizi|raporlama|müşteri segmentasyonu|yeniden pazarlama|audience segmentation|kpi|looker studio|marketing automation)\b/i;

const TERM_GROUPS = [
  ["Google Ads"],
  ["Meta Ads", "Meta Ads Manager", "Facebook Ads", "Instagram Ads"],
  ["LinkedIn Ads", "LinkedIn Campaign Manager"],
  ["Google Analytics 4", "Google Analytics", "GA4"],
  ["Google Tag Manager", "Tag Manager"],
  ["Search Console", "Google Search Console"],
  ["HubSpot"],
  ["Looker Studio"],
  ["SQL"],
  ["Tableau"],
  ["Power BI"],
  ["Looker"],
  ["CRO", "Conversion Rate Optimization"],
  ["ROI"],
  ["ROAS"],
  ["CTR"],
  ["CPC"],
  ["CPA"],
  ["KPI"],
  ["Retargeting", "Remarketing", "Yeniden pazarlama"],
  ["Audience segmentation", "Hedef kitle segmentasyonu", "Segmentasyon"],
  ["Funnel optimization"],
  ["Marketing automation"],
  ["Email marketing", "E-posta pazarlama"],
];

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

function uniqueTrimmedStrings(arr = []) {
  return Array.from(
    new Set(
      (Array.isArray(arr) ? arr : [])
        .map((x) => String(x || "").trim())
        .filter(Boolean)
    )
  );
}

function countWords(str = "") {
  return String(str).trim().split(/\s+/).filter(Boolean).length;
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
  return /^(PROFESSIONAL SUMMARY|SUMMARY|PROFILE|EXPERIENCE|WORK EXPERIENCE|SKILLS|EDUCATION|LANGUAGES|CERTIFICATIONS|PROJECTS|ADDITIONAL INFORMATION|PROFESYONEL ÖZET|ÖZET|PROFİL|PROFIL|DENEYİM|İŞ DENEYİMİ|IS DENEYIMI|YETKİNLİKLER|YETENEKLER|BECERİLER|EĞİTİM|EGITIM|DİLLER|BİLDİĞİ DİLLER|YABANCI DİL|SERTİFİKALAR|PROJELER|EK BİLGİLER)$/i.test(
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

  return header.slice(0, 6);
}

function replaceHeaderBlock(originalCv = "", optimizedCv = "") {
  const originalHeader = extractHeaderBlock(originalCv);
  if (!originalHeader.length) return String(optimizedCv || "").trim();

  const lines = String(optimizedCv || "").replace(/\r/g, "").split("\n");
  const sectionIdx = lines.findIndex((x) => isSectionHeader(String(x).trim()));

  if (sectionIdx === -1) return String(optimizedCv || "").trim();

  const body = lines.slice(sectionIdx).join("\n").trim();
  return `${originalHeader.join("\n")}\n\n${body}`.trim();
}

function extractExperienceTitles(cv = "") {
  const lines = getNonEmptyLines(cv);
  const titles = [];

  for (let i = 1; i < lines.length; i++) {
    const line = lines[i];
    if (
      /\|\s*.*(\d{4}|Present|Günümüz|Current|Devam)/i.test(line) ||
      /(\d{4}).*(Present|Günümüz|Current|Devam)/i.test(line)
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
      /\|\s*.*(\d{4}|Present|Günümüz|Current|Devam)/i.test(line) ||
      /(\d{4}).*(Present|Günümüz|Current|Devam)/i.test(line)
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

function normalizeOptimizedHeadings(text = "") {
  return String(text || "")
    .replace(/\r/g, "")
    .replace(/^BİLDİĞİ DİLLER$/gim, "DİLLER")
    .replace(/^YABANCI DİL$/gim, "DİLLER")
    .replace(/^YETENEKLER$/gim, "YETKİNLİKLER")
    .replace(/^BECERİLER$/gim, "YETKİNLİKLER")
    .replace(/^PROFİL$/gim, "PROFESYONEL ÖZET")
    .replace(/^PROFIL$/gim, "PROFESYONEL ÖZET")
    .replace(/^İŞ DENEYİMİ$/gim, "DENEYİM")
    .replace(/^IS DENEYIMI$/gim, "DENEYİM")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function forceSafeResume(originalCv = "", optimizedCv = "") {
  let out = String(optimizedCv || "").trim();
  out = normalizeOptimizedHeadings(out);
  out = replaceHeaderBlock(originalCv, out);
  out = restoreExperienceTitles(originalCv, out);
  out = normalizeOptimizedHeadings(out);
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
  return bullets.filter((b) => WEAK_PHRASE_RE.test(b)).length;
}

function countSupportToOwnershipShifts(originalCv = "", optimizedCv = "") {
  const origBullets = getBulletLines(originalCv);
  const optBullets = getBulletLines(optimizedCv);
  const n = Math.min(origBullets.length, optBullets.length);

  let count = 0;
  for (let i = 0; i < n; i++) {
    const orig = origBullets[i];
    const opt = optBullets[i];
    if (SUPPORT_RE.test(orig) && OWNERSHIP_RE.test(opt) && !OWNERSHIP_RE.test(orig)) {
      count += 1;
    }
  }
  return count;
}

function countOutcomeEscalations(originalCv = "", optimizedCv = "") {
  const origBullets = getBulletLines(originalCv);
  const optBullets = getBulletLines(optimizedCv);
  const n = Math.min(origBullets.length, optBullets.length);

  let count = 0;
  for (let i = 0; i < n; i++) {
    const orig = origBullets[i];
    const opt = optBullets[i];
    if (!OUTCOME_RE.test(orig) && OUTCOME_RE.test(opt)) {
      count += 1;
    }
  }
  return count;
}

function findUnsupportedInsertedTerms(originalCv = "", optimizedCv = "") {
  const source = normalizeCompareText(originalCv);
  const opt = normalizeCompareText(optimizedCv);
  const unsupported = [];

  for (const group of TERM_GROUPS) {
    const hasInOriginal = group.some((term) =>
      source.includes(normalizeCompareText(term))
    );
    const hasInOptimized = group.some((term) =>
      opt.includes(normalizeCompareText(term))
    );

    if (hasInOptimized && !hasInOriginal) {
      unsupported.push(group[0]);
    }
  }

  return unsupported;
}

function isClearlyWeakSentence(sentence = "") {
  const s = String(sentence || "").trim();
  if (!s) return false;

  if (WEAK_SENTENCE_RE.test(s)) return true;

  const hasSpecific = SPECIFICITY_RE.test(s);
  const wordCount = countWords(s);

  if (!hasSpecific && wordCount <= 8) return true;
  if (!hasSpecific && /\b(yaptım|ettim|hazırladım|bulundum|baktım|ilgilendim|görüştüm|görüşmeler yaptım)\b/i.test(s)) {
    return true;
  }

  return false;
}

function filterWeakSentences(items = []) {
  return (Array.isArray(items) ? items : [])
    .filter((x) => {
      const sentence = String(x?.sentence || "").trim();
      const rewrite = String(x?.rewrite || "").trim();

      if (!sentence || !rewrite) return false;
      if (normalizeCompareText(sentence) === normalizeCompareText(rewrite)) return false;

      return isClearlyWeakSentence(sentence);
    })
    .slice(0, 8);
}

function getSectionPresenceScore(cv = "") {
  const text = getNonEmptyLines(cv).join("\n");
  let score = 0;

  if (/(PROFESSIONAL SUMMARY|SUMMARY|PROFILE|PROFESYONEL ÖZET|ÖZET|PROFİL|PROFIL)/i.test(text)) score += 5;
  if (/(EXPERIENCE|WORK EXPERIENCE|DENEYİM|İŞ DENEYİMİ|IS DENEYIMI)/i.test(text)) score += 7;
  if (/(SKILLS|YETKİNLİKLER|YETENEKLER|BECERİLER)/i.test(text)) score += 4;
  if (/(EDUCATION|EĞİTİM|EGITIM)/i.test(text)) score += 4;
  if (/(LANGUAGES|DİLLER|BİLDİĞİ DİLLER|YABANCI DİL)/i.test(text)) score += 2;
  if (/(CERTIFICATIONS|SERTİFİKALAR)/i.test(text)) score += 2;
  if (/(PROJECTS|PROJELER)/i.test(text)) score += 1;

  return Math.min(25, score);
}

function getSkillsLines(cv = "") {
  const lines = getNonEmptyLines(cv);
  const out = [];
  let inSkills = false;

  for (const line of lines) {
    if (/(SKILLS|YETKİNLİKLER|YETENEKLER|BECERİLER)/i.test(line)) {
      inSkills = true;
      continue;
    }

    if (inSkills && isSectionHeader(line)) break;
    if (inSkills) {
      out.push(line.replace(/^[-•·‣▪▫◦]\s+/, "").trim());
    }
  }

  return out.filter(Boolean);
}

function getKeywordBreadthScore(cv = "") {
  const text = normalizeCompareText(cv);
  const skills = uniqueTrimmedStrings(getSkillsLines(cv));
  let score = 0;

  score += Math.min(8, skills.length);

  const keywordHits = [
    "google ads",
    "meta ads",
    "meta ads manager",
    "google analytics",
    "google analytics 4",
    "ga4",
    "tag manager",
    "seo",
    "sem",
    "ctr",
    "cpc",
    "cpa",
    "roas",
    "landing page",
    "excel",
    "google sheets",
    "hubspot",
    "search console",
    "a b test",
    "email marketing",
    "performans pazarlamasi",
    "icerik stratejisi",
    "veri analizi",
    "raporlama",
  ].filter((term) => text.includes(normalizeCompareText(term))).length;

  score += Math.min(7, keywordHits);

  return Math.min(15, score);
}

function getReadabilityScore(cv = "") {
  const bullets = getBulletLines(cv);
  const header = extractHeaderBlock(cv);
  const lines = getNonEmptyLines(cv);

  let score = 0;

  if (header.length >= 3) score += 3;
  if (lines.length >= 12) score += 3;
  if (bullets.length >= 4) score += 6;

  const avgBulletWords =
    bullets.length > 0
      ? bullets.reduce((sum, b) => sum + countWords(b), 0) / bullets.length
      : 0;

  if (avgBulletWords >= 6 && avgBulletWords <= 20) score += 8;
  else if (avgBulletWords >= 4) score += 4;

  return Math.min(20, score);
}

function getBulletStrengthScore(cv = "") {
  const bullets = getBulletLines(cv);
  if (!bullets.length) return 0;

  let score = 8;
  let weakCount = 0;
  let strongCount = 0;
  let specificityCount = 0;
  let solidLengthCount = 0;

  for (const bullet of bullets) {
    const wc = countWords(bullet);
    if (WEAK_PHRASE_RE.test(bullet)) weakCount += 1;
    if (STRONG_ACTION_RE.test(bullet)) strongCount += 1;
    if (SPECIFICITY_RE.test(bullet)) specificityCount += 1;
    if (wc >= 5 && wc <= 24) solidLengthCount += 1;
  }

  const weakPenalty = Math.min(18, weakCount * 3);
  const strongBonus = Math.min(12, strongCount * 2);
  const specificityBonus = Math.min(10, specificityCount * 1.5);
  const lengthBonus = Math.min(10, solidLengthCount * 1.2);

  score = score + strongBonus + specificityBonus + lengthBonus - weakPenalty;

  return Math.max(0, Math.min(40, Math.round(score)));
}

function extractTopJdTerms(jd = "") {
  const stop = new Set([
    "ve", "ile", "için", "olan", "olarak", "bir", "bu", "da", "de", "en",
    "the", "and", "for", "with", "to", "of", "in", "on", "a", "an",
    "veya", "ya", "gibi", "göre", "üzere", "alanında", "alaninda",
  ]);

  return Array.from(
    new Set(
      String(jd)
        .toLowerCase()
        .replace(/[^\p{L}\p{N}\s/-]/gu, " ")
        .split(/\s+/)
        .filter((x) => x && x.length >= 4 && !stop.has(x))
    )
  ).slice(0, 40);
}

function getJdAlignmentScore(cv = "", jd = "") {
  if (!jd || !String(jd).trim()) return 0;

  const cvText = normalizeCompareText(cv);
  const terms = extractTopJdTerms(jd);
  if (!terms.length) return 0;

  let hits = 0;
  for (const term of terms) {
    if (cvText.includes(normalizeCompareText(term))) hits += 1;
  }

  const ratio = hits / terms.length;
  return Math.max(0, Math.min(12, Math.round(ratio * 12)));
}

function computeDeterministicAtsScore(cv = "", jd = "") {
  const hasJD = !!String(jd || "").trim();

  const sectionScore = getSectionPresenceScore(cv); // 0-25
  const bulletScore = getBulletStrengthScore(cv);   // 0-40
  const readabilityScore = getReadabilityScore(cv); // 0-20
  const keywordScore = getKeywordBreadthScore(cv);  // 0-15
  const jdScore = getJdAlignmentScore(cv, jd);      // 0-12

  let total = 0;

  if (hasJD) {
    total =
      Math.round((sectionScore / 25) * 18) +
      Math.round((bulletScore / 40) * 40) +
      Math.round((readabilityScore / 20) * 18) +
      Math.round((keywordScore / 15) * 12) +
      jdScore;
  } else {
    total =
      Math.round((sectionScore / 25) * 20) +
      Math.round((bulletScore / 40) * 45) +
      Math.round((readabilityScore / 20) * 20) +
      Math.round((keywordScore / 15) * 15);
  }

  return clampScore(total);
}

function computeComponentScore(componentScores = {}, hasJD = false) {
  if (hasJD) {
    const role_alignment = clampScore(componentScores?.role_alignment);
    const bullet_strength = clampScore(componentScores?.bullet_strength);
    const jd_keyword_match = clampScore(componentScores?.jd_keyword_match);
    const section_completeness = clampScore(componentScores?.section_completeness);
    const ats_safe_formatting = clampScore(componentScores?.ats_safe_formatting);

    return clampScore(
      role_alignment * 0.28 +
      bullet_strength * 0.30 +
      jd_keyword_match * 0.16 +
      section_completeness * 0.16 +
      ats_safe_formatting * 0.10
    );
  }

  const section_completeness = clampScore(componentScores?.section_completeness);
  const clarity_readability = clampScore(componentScores?.clarity_readability);
  const bullet_strength = clampScore(componentScores?.bullet_strength);
  const ats_safe_formatting = clampScore(componentScores?.ats_safe_formatting);
  const core_keyword_coverage = clampScore(componentScores?.core_keyword_coverage);

  return clampScore(
    section_completeness * 0.22 +
    clarity_readability * 0.24 +
    bullet_strength * 0.32 +
    ats_safe_formatting * 0.14 +
    core_keyword_coverage * 0.08
  );
}

function computeImprovementBonus(originalCv = "", optimizedCv = "") {
  if (!originalCv || !optimizedCv) return 0;

  const unsupportedTerms = findUnsupportedInsertedTerms(originalCv, optimizedCv);
  const supportShiftCount = countSupportToOwnershipShifts(originalCv, optimizedCv);
  const outcomeEscalations = countOutcomeEscalations(originalCv, optimizedCv);

  if (unsupportedTerms.length > 0) return 0;
  if (supportShiftCount > 1) return 0;
  if (outcomeEscalations > 1) return 0;

  const weakBefore = countWeakVerbHits(originalCv);
  const weakAfter = countWeakVerbHits(optimizedCv);
  const weakGain = Math.max(0, weakBefore - weakAfter);

  const { same, total } = countUnchangedBullets(originalCv, optimizedCv);
  const rewriteRatio = total > 0 ? 1 - same / total : 0;

  let bonus = 0;

  bonus += Math.min(4, weakGain * 1.0);

  if (rewriteRatio >= 0.55) bonus += 2;
  else if (rewriteRatio >= 0.35) bonus += 1;

  return Math.max(0, Math.min(6, bonus));
}

function computeMinimumSafeGain(originalCv = "", optimizedCv = "") {
  const unsupportedTerms = findUnsupportedInsertedTerms(originalCv, optimizedCv);
  const supportShiftCount = countSupportToOwnershipShifts(originalCv, optimizedCv);
  const outcomeEscalations = countOutcomeEscalations(originalCv, optimizedCv);

  if (unsupportedTerms.length > 0) return 0;
  if (supportShiftCount > 1) return 0;
  if (outcomeEscalations > 1) return 0;

  const weakBefore = countWeakVerbHits(originalCv);
  const weakAfter = countWeakVerbHits(optimizedCv);
  const weakGain = Math.max(0, weakBefore - weakAfter);

  const { same, total } = countUnchangedBullets(originalCv, optimizedCv);
  const rewriteRatio = total > 0 ? 1 - same / total : 0;

  let gain = 0;

  if (weakGain >= 3) gain += 4;
  else if (weakGain >= 2) gain += 3;
  else if (weakGain >= 1) gain += 1;

  if (rewriteRatio >= 0.55) gain += 2;
  else if (rewriteRatio >= 0.35) gain += 1;

  return Math.max(0, Math.min(6, gain));
}

function shouldRepairOptimizedCv(originalCv = "", optimizedCv = "") {
  if (!optimizedCv || !String(optimizedCv).trim()) return true;

  const origNorm = normalizeCompareText(originalCv);
  const optNorm = normalizeCompareText(optimizedCv);

  if (!optNorm) return true;
  if (origNorm === optNorm) return true;

  const { same, total } = countUnchangedBullets(originalCv, optimizedCv);
  if (total > 0 && same / total >= 0.45) return true;

  const optimizedBullets = getBulletLines(optimizedCv);
  if (total > 0 && optimizedBullets.length < Math.max(2, Math.floor(total * 0.75))) {
    return true;
  }

  const weakBefore = countWeakVerbHits(originalCv);
  const weakAfter = countWeakVerbHits(optimizedCv);
  if (weakAfter >= weakBefore && weakAfter >= 2) return true;

  if (findUnsupportedInsertedTerms(originalCv, optimizedCv).length > 0) return true;
  if (countSupportToOwnershipShifts(originalCv, optimizedCv) > 1) return true;
  if (countOutcomeEscalations(originalCv, optimizedCv) > 1) return true;

  return false;
}

function evaluateOptimizedCandidate(originalCv = "", optimizedCv = "", jd = "", baseScore = 0) {
  const safeCv = forceSafeResume(originalCv, optimizedCv);
  const unsupportedTerms = findUnsupportedInsertedTerms(originalCv, safeCv);
  const supportShiftCount = countSupportToOwnershipShifts(originalCv, safeCv);
  const outcomeEscalations = countOutcomeEscalations(originalCv, safeCv);
  const weakBefore = countWeakVerbHits(originalCv);
  const weakAfter = countWeakVerbHits(safeCv);
  const { same, total } = countUnchangedBullets(originalCv, safeCv);

  const deterministicOptimized = computeDeterministicAtsScore(safeCv, jd);
  const bonus = computeImprovementBonus(originalCv, safeCv);
  const minimumGain = computeMinimumSafeGain(originalCv, safeCv);

  const optimizedScore = clampScore(
    Math.max(deterministicOptimized + bonus, baseScore + minimumGain)
  );

  const safe =
    unsupportedTerms.length === 0 &&
    supportShiftCount <= 1 &&
    outcomeEscalations <= 1 &&
    !(total > 0 && same / total >= 0.55) &&
    weakAfter <= weakBefore;

  return {
    safeCv,
    unsupportedTerms,
    supportShiftCount,
    outcomeEscalations,
    weakBefore,
    weakAfter,
    same,
    total,
    deterministicOptimized,
    optimizedScore,
    safe,
  };
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

  if (passType === "optimize") {
    return [
      {
        reasoningEffort: "medium",
        temperature: null,
        maxCompletionTokens: Math.max(maxCompletionTokens, 4200),
      },
      {
        reasoningEffort: "medium",
        temperature: null,
        maxCompletionTokens: Math.max(maxCompletionTokens, 5600),
      },
      {
        reasoningEffort: "low",
        temperature: null,
        maxCompletionTokens: Math.max(maxCompletionTokens, 4400),
      },
    ];
  }

  if (passType === "repair") {
    return [
      {
        reasoningEffort: "medium",
        temperature: null,
        maxCompletionTokens: Math.max(maxCompletionTokens, 5200),
      },
      {
        reasoningEffort: "medium",
        temperature: null,
        maxCompletionTokens: Math.max(maxCompletionTokens, 6800),
      },
      {
        reasoningEffort: "low",
        temperature: null,
        maxCompletionTokens: Math.max(maxCompletionTokens, 5200),
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
      {
        reasoningEffort: "none",
        temperature: 0.2,
        maxCompletionTokens: Math.max(maxCompletionTokens, 1800),
      },
    ];
  }

  return [
    {
      reasoningEffort: "low",
      temperature: null,
      maxCompletionTokens: Math.max(maxCompletionTokens, 2200),
    },
    {
      reasoningEffort: "low",
      temperature: null,
      maxCompletionTokens: Math.max(maxCompletionTokens, 3000),
    },
    {
      reasoningEffort: "none",
      temperature: 0.2,
      maxCompletionTokens: Math.max(maxCompletionTokens, 2400),
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
        if (finishReason === "length") continue;
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
CRITICAL TRUTH RULES:
- Use ONLY facts explicitly present in the ORIGINAL resume text.
- The job description may guide emphasis, wording direction, and missing keyword analysis, but it may NOT be used as proof that the candidate has used a tool, platform, metric, channel, framework, or process.
- Never add a tool/platform/metric as candidate experience unless it already appears in the ORIGINAL resume.
- Never turn a generic or support-level sentence into a full ownership or leadership claim unless the ORIGINAL resume clearly supports that.
- Never invent or assume any numbers, percentages, budget, KPIs, team size, performance outcomes, clients, revenue, or certifications.
- Never upgrade weak evidence into strong evidence.
- Keep already-strong bullets specific. Do NOT rewrite strong bullets into more generic bullets.
- Weak sentence selection must target genuinely weak, vague, generic, or support-heavy lines first.
- Strong lines that already contain concrete tools, metrics, platforms, or clear action should usually NOT be selected as weak.
- For junior or weak resumes, improve clarity and recruiter-readability WITHOUT fabricating ownership, results, or systems used.

SAFE REWRITE EXAMPLES:
- "Sosyal medya ile ilgilendim" can become "Sosyal medya içerik ve paylaşım süreçlerinde görev aldım."
- "Rapor yaptım" can become "Temel raporlama ve veri takip çalışmalarını yürüttüm."
- But do NOT change them into claims like "marka bilinirliğini artırdım", "strateji geliştirdim", "kampanyaları yönettim" unless that level is clearly supported.

HEADING RULES:
- For Turkish optimized_cv outputs, use these exact headings when relevant:
  PROFESYONEL ÖZET
  DENEYİM
  EĞİTİM
  YETKİNLİKLER
  DİLLER
  SERTİFİKALAR
  PROJELER
  EK BİLGİLER
- Do NOT use:
  PROFİL
  BİLDİĞİ DİLLER
  YETENEKLER
  BECERİLER

OUTPUT RULES:
- Return ONLY valid JSON.
- No markdown.
- No extra text.
- All output VALUES MUST be written ONLY in ${outLang}. Do not mix languages.
`.trim();
}

function buildLinkedInSystem(outLang) {
  return `
CRITICAL RULES:
- Do NOT invent or assume any numbers, results, budgets, metrics, tools, platforms, or certifications.
- Only use facts explicitly present in the resume and optional job description.
- The job description may guide emphasis but may NOT be treated as proof of experience.
- Return ONLY valid JSON.
- No markdown.
- No extra text.
- All output VALUES MUST be written ONLY in ${outLang}. Do not mix languages.
`.trim();
}

function buildPreviewAtsPrompt({ cv, jd, hasJD, outLang }) {
  if (hasJD) {
    return `
Return JSON in this exact schema:

{
  "component_scores": {
    "role_alignment": number,
    "bullet_strength": number,
    "jd_keyword_match": number,
    "section_completeness": number,
    "ats_safe_formatting": number
  },
  "missing_keywords": string[],
  "weak_sentences": [{"sentence": string, "rewrite": string}],
  "summary": string
}

REQUIREMENTS:
- This is a JOB-SPECIFIC ATS MATCH because a job description is provided.
- component_scores must reflect resume-to-job alignment honestly.
- missing_keywords MUST include 5-7 items that are genuinely missing or underrepresented from the JOB DESCRIPTION.
- missing_keywords MUST be unique, role-relevant, and written in ${outLang}.
- weak_sentences MUST include up to 2 items picked from real resume sentences.
- Do NOT force the count.
- Both sentence and rewrite MUST be in ${outLang}.
- Select only genuinely weak, vague, generic, or support-heavy sentences.
- Do NOT select already-strong sentences that already contain concrete tools, platforms, or metrics.
- Prefer weak experience bullets first, then summary only if necessary.
- summary MUST be 4-6 bullet lines in ${outLang}.
- summary must focus on job fit, biggest missing keywords, ATS risks, and top improvements.
- Do NOT add extra keys. Do NOT add optimized_cv.

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
- component_scores must reflect general ATS readiness honestly.
- missing_keywords MUST include 5-7 items.
- These are NOT job-specific missing keywords. They should be recommended ATS/recruiter-friendly resume terms based on the candidate's apparent role and experience.
- missing_keywords MUST be unique, practical, role-relevant, and written in ${outLang}.
- weak_sentences MUST include up to 2 items picked from real resume sentences.
- Do NOT force the count.
- Both sentence and rewrite MUST be in ${outLang}.
- Select only genuinely weak, vague, generic, or support-heavy sentences.
- Do NOT select already-strong sentences that already contain concrete tools, platforms, or metrics.
- Prefer weak experience bullets first, then summary only if necessary.
- summary MUST be 4-6 bullet lines in ${outLang}.
- summary must focus on general ATS readiness, structure, clarity, and top improvement areas.
- Do NOT add extra keys. Do NOT add optimized_cv.

RESUME:
${cv}
`.trim();
}

function buildFullAtsAnalysisPrompt({ cv, jd, hasJD, outLang }) {
  if (hasJD) {
    return `
Return JSON in this exact schema:

{
  "component_scores": {
    "role_alignment": number,
    "bullet_strength": number,
    "jd_keyword_match": number,
    "section_completeness": number,
    "ats_safe_formatting": number
  },
  "missing_keywords": string[],
  "weak_sentences": [{"sentence": string, "rewrite": string}],
  "summary": string
}

HARD REQUIREMENTS:
- This is a JOB-SPECIFIC ATS MATCH because a job description is provided.
- component_scores must reflect resume-to-job alignment honestly.
- missing_keywords MUST include 12-20 items genuinely missing or underrepresented from the JOB DESCRIPTION.
- missing_keywords MUST be unique, role-relevant, and written in ${outLang}.
- weak_sentences MUST include 5-8 items from the resume text.
- Do NOT force the count if there are fewer truly strong examples.
- Both sentence and rewrite MUST be in ${outLang}.
- Only select genuinely weak, vague, generic, or support-heavy sentences.
- Do NOT select already-strong sentences if they already contain useful tools, metrics, or strong action.
- If a sentence contains strong specifics, preserve them in the rewrite or skip the sentence.
- Prefer weak experience bullets first.
- Use summary sentences only if there are not enough truly weak experience bullets.
- Do NOT use shallow synonym swaps or near-duplicate rewrites.
- Each rewrite must improve at least two of these:
  clarity, specificity, scope, action strength, business context, recruiter readability.
- summary MUST be detailed (8-12 bullet lines) in ${outLang} covering job fit, top missing skills/keywords, biggest ATS risks, and top rewrite themes.
- Do NOT add optimized_cv.
- Keep claims truthful. Do not invent employers, degrees, titles, dates, tools, metrics, acronyms, or platforms.

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

HARD REQUIREMENTS:
- This is a GENERAL ATS REVIEW because no job description is provided.
- component_scores must reflect general ATS readiness honestly.
- missing_keywords MUST include 10-18 items.
- These are NOT job-specific missing keywords. They must be recommended ATS/recruiter-friendly resume terms based on the candidate's likely role, seniority, and experience.
- missing_keywords MUST be unique, practical, and written in ${outLang}.
- weak_sentences MUST include 5-8 items from the resume text.
- Do NOT force the count if there are fewer truly strong examples.
- Both sentence and rewrite MUST be in ${outLang}.
- Only select genuinely weak, vague, generic, or support-heavy sentences.
- Do NOT select already-strong sentences if they already contain useful tools, metrics, or strong action.
- If a sentence contains strong specifics, preserve them in the rewrite or skip the sentence.
- Prefer weak experience bullets first.
- Use summary sentences only if there are not enough truly weak experience bullets.
- Do NOT use shallow synonym swaps or near-duplicate rewrites.
- Each rewrite must improve at least two of these:
  clarity, specificity, scope, action strength, business context, recruiter readability.
- summary MUST be detailed (8-12 bullet lines) in ${outLang} covering general ATS readiness, top keyword gaps, biggest ATS risks, and top rewrite themes.
- Do NOT add optimized_cv.
- Keep claims truthful. Do not invent employers, degrees, titles, dates, tools, metrics, acronyms, or platforms.

RESUME:
${cv}
`.trim();
}

function buildOptimizeCvPrompt({ cv, jd, hasJD, summary, missingKeywords }) {
  const keywordsText = Array.isArray(missingKeywords) ? missingKeywords.join(", ") : "";

  return hasJD
    ? `
Return JSON in this exact schema:

{
  "optimized_cv": string
}

TASK:
Rewrite the resume into a stronger ATS-friendly version aligned to the same job description.

STRICT RULES:
- Keep the header identity block exactly as written.
- Keep existing experience titles unchanged.
- Keep exact dates, employers, titles, education, certifications, and explicit experience durations unchanged.
- Use ONLY tools, platforms, channels, metrics, and systems already present in the ORIGINAL resume as candidate experience.
- The job description may guide emphasis, ordering, and wording, but it may NOT introduce new tools/platforms/channels as if the candidate used them.
- Example: if the job description mentions LinkedIn Ads, CRO, Looker Studio, or KPI tracking, but the original resume does not, do NOT write them as candidate experience.
- Do NOT invent numbers, KPIs, budgets, achievements, or performance outcomes.
- If the original bullet is support-oriented, keep it truthful and support-level unless the original clearly supports stronger ownership.
- For weak junior bullets, prefer safer upgrades like:
  "süreçlerine destek verdim", "takibini yürüttüm", "hazırlanmasına katkı sağladım", "temel raporlama yaptım"
  instead of unsupported ownership claims like:
  "yönettim", "artırdım", "strateji geliştirdim", "optimize ettim"
  unless clearly supported by the original resume.
- Keep already-strong bullets strong and specific. Do NOT flatten them.
- Use canonical section headings only.

QUALITY TARGET:
- The optimized CV must feel clearly stronger than the original, but still fully truthful.
- Focus rewrite effort on weak, vague, and support-heavy lines first.
- Improve clarity, scope, and recruiter readability without crossing the truth boundary.
- Never add JD-only experience as if already done by the candidate.

ANALYSIS SUMMARY:
${summary || "(none)"}

HIGH PRIORITY KEYWORDS / GAPS:
${keywordsText || "(none)"}

RESUME:
${cv}

JOB DESCRIPTION:
${jd}
`.trim()
    : `
Return JSON in this exact schema:

{
  "optimized_cv": string
}

TASK:
Rewrite the resume into a stronger ATS-friendly version.

STRICT RULES:
- Keep the header identity block exactly as written.
- Keep existing experience titles unchanged.
- Keep exact dates, employers, titles, education, certifications, and explicit experience durations unchanged.
- Use ONLY tools, platforms, channels, metrics, and systems already present in the ORIGINAL resume as candidate experience.
- Do NOT invent numbers, KPIs, budgets, achievements, or performance outcomes.
- If the original bullet is support-oriented, keep it truthful and support-level unless the original clearly supports stronger ownership.
- For weak junior bullets, prefer safer upgrades like:
  "süreçlerine destek verdim", "takibini yürüttüm", "hazırlanmasına katkı sağladım", "temel raporlama yaptım"
  instead of unsupported ownership claims like:
  "yönettim", "artırdım", "strateji geliştirdim", "optimize ettim"
  unless clearly supported by the original resume.
- Keep already-strong bullets strong and specific. Do NOT flatten them.
- Use canonical section headings only.

QUALITY TARGET:
- The optimized CV must feel clearly stronger than the original, but still fully truthful.
- Focus rewrite effort on weak, vague, and support-heavy lines first.
- Improve clarity, scope, and recruiter readability without crossing the truth boundary.

ANALYSIS SUMMARY:
${summary || "(none)"}

HIGH PRIORITY KEYWORDS / GAPS:
${keywordsText || "(none)"}

RESUME:
${cv}
`.trim();
}

function buildRepairPrompt({
  cv,
  jd,
  hasJD,
  currentOptimizedCv,
  summary,
  missingKeywords,
}) {
  const keywordsText = Array.isArray(missingKeywords) ? missingKeywords.join(", ") : "";

  return hasJD
    ? `
Return JSON in this exact schema:

{
  "optimized_cv": string
}

TASK:
You already generated an optimized resume, but it still looks too aggressive, too close to the original, or not fully truth-safe.
Rewrite it again into a safer and stronger final version.

STRICT RULES:
- Keep the header identity block exactly as written.
- Keep existing experience titles unchanged.
- Keep exact dates, employers, titles, degrees, certifications, and explicit years of experience unchanged.
- Do NOT invent metrics, tools, platforms, acronyms, systems, achievements, channels, or outcomes.
- Use ONLY tools/platforms/metrics that already exist in the ORIGINAL resume as candidate experience.
- The job description may guide emphasis but may NOT create new experience.
- If the original bullet is support-level, keep it support-level unless the original clearly proves stronger ownership.
- Never convert weak evidence into claims like:
  "yönettim", "artırdım", "strateji geliştirdim", "KPI takibi yaptım", "CRO yönettim"
  unless those are clearly supported in the ORIGINAL resume.
- Avoid these weak phrases when possible:
  helped, assisted, supported, involved in, responsible for, contributed to, worked on, played a key role in, participated in, handled,
  destek verdim, destek oldum, katkı sağladım, görev aldım, yardımcı oldum
- But if the original truly only supports support-level work, rewrite it into a cleaner support-level sentence instead of inventing ownership.
- Use canonical section headings only.

QUALITY TARGET:
- Final output should be premium, cleaner, more specific, and still fully truthful.
- Preserve strong lines.
- Rewrite weak, vague, support-heavy lines first.
- Remove JD-only tool/platform claims if they slipped in.

ANALYSIS SUMMARY:
${summary || "(none)"}

HIGH PRIORITY KEYWORDS / GAPS:
${keywordsText || "(none)"}

RESUME (original):
${cv}

JOB DESCRIPTION:
${jd}

CURRENT OPTIMIZED CV:
${currentOptimizedCv}
`.trim()
    : `
Return JSON in this exact schema:

{
  "optimized_cv": string
}

TASK:
You already generated an optimized resume, but it still looks too aggressive, too close to the original, or not fully truth-safe.
Rewrite it again into a safer and stronger final version.

STRICT RULES:
- Keep the header identity block exactly as written.
- Keep existing experience titles unchanged.
- Keep exact dates, employers, titles, degrees, certifications, and explicit years of experience unchanged.
- Do NOT invent metrics, tools, platforms, acronyms, systems, achievements, channels, or outcomes.
- Use ONLY tools/platforms/metrics that already exist in the ORIGINAL resume as candidate experience.
- If the original bullet is support-level, keep it support-level unless the original clearly proves stronger ownership.
- Never convert weak evidence into claims like:
  "yönettim", "artırdım", "strateji geliştirdim", "KPI takibi yaptım", "veri analizi yaptım"
  unless those are clearly supported in the ORIGINAL resume.
- Avoid these weak phrases when possible:
  helped, assisted, supported, involved in, responsible for, contributed to, worked on, played a key role in, participated in, handled,
  destek verdim, destek oldum, katkı sağladım, görev aldım, yardımcı oldum
- But if the original truly only supports support-level work, rewrite it into a cleaner support-level sentence instead of inventing ownership.
- Use canonical section headings only.

QUALITY TARGET:
- Final output should be premium, cleaner, more specific, and still fully truthful.
- Preserve strong lines.
- Rewrite weak, vague, support-heavy lines first.

ANALYSIS SUMMARY:
${summary || "(none)"}

HIGH PRIORITY KEYWORDS / GAPS:
${keywordsText || "(none)"}

RESUME (original):
${cv}

CURRENT OPTIMIZED CV:
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
- about.short: 600-900 chars, punchy, no emojis.
- experience_fix: up to 1 item. Choose only a sentence where a clearly better rewrite is possible.
- skills.top: 7-10 items.
- recruiter.keywords: 5-8 items.
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
- Do NOT invent employers, titles, dates, degrees, tools, or metrics.
- Headline max 220 chars each. No emojis.
- about.short: 500-800 chars.
- about.normal: 900-1400 chars.
- about.bold: 900-1400 chars.
- headlines: exactly 5 items with labels Search, Impact, Niche, Leadership, Clean.
- experience_fix: 4-6 items maximum, only if there are real, materially stronger rewrites.
- skills.top: 12-18
- skills.tools: 8-16
- skills.industry: 12-20
- recruiter.keywords: 10-20
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
          maxCompletionTokens: isPreview ? 1200 : 2400,
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

    if (isPreview) {
      let previewData;
      try {
        previewData = await callOpenAIJson({
          apiKey,
          model,
          system: buildAtsSystem(outLang),
          userPrompt: buildPreviewAtsPrompt({ cv, jd, hasJD, outLang }),
          isPreview: true,
          passType: "main",
          maxCompletionTokens: 1200,
        });
      } catch (err) {
        return res.status(err?.status || 500).json({
          error: err?.message || "OpenAI error",
          status: err?.status || 500,
          details: err?.details || String(err),
        });
      }

      const componentScores =
        previewData?.component_scores && typeof previewData.component_scores === "object"
          ? previewData.component_scores
          : {};

      const deterministicScore = computeDeterministicAtsScore(cv, jd);
      const modelComponentScore = computeComponentScore(componentScores, hasJD);
      const mergedPreviewScore = clampScore(
        Math.round(deterministicScore * 0.8 + modelComponentScore * 0.2)
      );

      const normalized = {
        ats_score: mergedPreviewScore,
        component_scores: componentScores,
        missing_keywords: Array.isArray(previewData?.missing_keywords)
          ? previewData.missing_keywords
          : [],
        weak_sentences: filterWeakSentences(
          Array.isArray(previewData?.weak_sentences) ? previewData.weak_sentences : []
        ),
        summary: typeof previewData?.summary === "string" ? previewData.summary : "",
      };

      await ensureMinDelay(startedAt, 15000);

      return res.status(200).json({
        ats_score: normalized.ats_score,
        summary: normalized.summary,
        missing_keywords: normalized.missing_keywords.slice(0, 5),
        weak_sentences: normalized.weak_sentences.slice(0, 2),
        review_mode: hasJD ? "job_specific" : "general",
      });
    }

    let analysisData;
    try {
      analysisData = await callOpenAIJson({
        apiKey,
        model,
        system: buildAtsSystem(outLang),
        userPrompt: buildFullAtsAnalysisPrompt({ cv, jd, hasJD, outLang }),
        isPreview: false,
        passType: "main",
        maxCompletionTokens: 2200,
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

    const deterministicScore = computeDeterministicAtsScore(cv, jd);
    const modelComponentScore = computeComponentScore(componentScores, hasJD);
    const mergedBaseScore = clampScore(
      Math.round(deterministicScore * 0.8 + modelComponentScore * 0.2)
    );

    const normalized = {
      ats_score: mergedBaseScore,
      optimized_ats_score: mergedBaseScore,
      component_scores: componentScores,
      missing_keywords: Array.isArray(analysisData?.missing_keywords)
        ? analysisData.missing_keywords
        : [],
      weak_sentences: filterWeakSentences(
        Array.isArray(analysisData?.weak_sentences) ? analysisData.weak_sentences : []
      ),
      summary: typeof analysisData?.summary === "string" ? analysisData.summary : "",
      optimized_cv: forceSafeResume(cv, cv),
    };

    const candidateEvaluations = [];

    try {
      const optimizeData = await callOpenAIJson({
        apiKey,
        model,
        system: buildAtsSystem(outLang),
        userPrompt: buildOptimizeCvPrompt({
          cv,
          jd,
          hasJD,
          summary: normalized.summary,
          missingKeywords: normalized.missing_keywords,
        }),
        isPreview: false,
        passType: "optimize",
        maxCompletionTokens: 3800,
      });

      if (typeof optimizeData?.optimized_cv === "string" && optimizeData.optimized_cv.trim()) {
        candidateEvaluations.push(
          evaluateOptimizedCandidate(cv, optimizeData.optimized_cv.trim(), jd, normalized.ats_score)
        );
      }
    } catch {
      // optimize başarısızsa devam
    }

    const firstCandidate = candidateEvaluations[0];
    if (!firstCandidate || shouldRepairOptimizedCv(cv, firstCandidate.safeCv)) {
      try {
        const repaired = await callOpenAIJson({
          apiKey,
          model,
          system: buildAtsSystem(outLang),
          userPrompt: buildRepairPrompt({
            cv,
            jd,
            hasJD,
            currentOptimizedCv: firstCandidate?.safeCv || cv,
            summary: normalized.summary,
            missingKeywords: normalized.missing_keywords,
          }),
          isPreview: false,
          passType: "repair",
          maxCompletionTokens: 4600,
        });

        if (typeof repaired?.optimized_cv === "string" && repaired.optimized_cv.trim()) {
          candidateEvaluations.push(
            evaluateOptimizedCandidate(cv, repaired.optimized_cv.trim(), jd, normalized.ats_score)
          );
        }
      } catch {
        // repair başarısızsa devam
      }
    }

    let selectedCandidate =
      candidateEvaluations
        .filter((c) => c.safe)
        .sort((a, b) => b.optimizedScore - a.optimizedScore)[0] ||
      candidateEvaluations
        .sort((a, b) => {
          const riskA =
            a.unsupportedTerms.length * 10 +
            a.supportShiftCount * 4 +
            a.outcomeEscalations * 4;
          const riskB =
            b.unsupportedTerms.length * 10 +
            b.supportShiftCount * 4 +
            b.outcomeEscalations * 4;
          if (riskA !== riskB) return riskA - riskB;
          return b.optimizedScore - a.optimizedScore;
        })[0];

    if (selectedCandidate) {
      normalized.optimized_cv = selectedCandidate.safeCv;
      normalized.optimized_ats_score = selectedCandidate.optimizedScore;
    } else {
      normalized.optimized_cv = forceSafeResume(cv, cv);
      normalized.optimized_ats_score = normalized.ats_score;
    }

    return res.status(200).json({
      ats_score: normalized.ats_score,
      optimized_ats_score: normalized.optimized_ats_score,
      component_scores: normalized.component_scores,
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
