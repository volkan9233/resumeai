import { Redis } from "@upstash/redis";
import { Ratelimit } from "@upstash/ratelimit";
import crypto from "crypto";

const redis = Redis.fromEnv();

const rlPreview = new Ratelimit({
  redis,
  limiter: Ratelimit.slidingWindow(3, "10 m"),
  prefix: "resumeai:rl:preview",
});

const rlFull = new Ratelimit({
  redis,
  limiter: Ratelimit.slidingWindow(3, "1 m"),
  prefix: "resumeai:rl:full",
});

function uniqueTrimmedStrings(arr = []) {
  return Array.from(
    new Set(
      (Array.isArray(arr) ? arr : [])
        .map((x) => String(x || "").trim())
        .filter(Boolean)
    )
  );
}

function escapeRegex(str = "") {
  return String(str).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function buildPhraseRegex(terms = []) {
  const safe = uniqueTrimmedStrings(terms).map(escapeRegex).filter(Boolean);
  if (!safe.length) return /$a/;
  return new RegExp(`\\b(?:${safe.join("|")})\\b`, "i");
}

function normalizeCompareText(str = "") {
  return String(str)
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[^\p{L}\p{N}\s+%/-]/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
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

function tokenizeForSimilarity(str = "") {
  return String(str)
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[^\p{L}\p{N}\s]/gu, " ")
    .split(/\s+/)
    .filter((x) => x && x.length > 1);
}

function jaccardSimilarity(a = "", b = "") {
  const aSet = new Set(tokenizeForSimilarity(a));
  const bSet = new Set(tokenizeForSimilarity(b));
  if (!aSet.size || !bSet.size) return 0;

  let intersection = 0;
  for (const token of aSet) {
    if (bSet.has(token)) intersection += 1;
  }

  const union = new Set([...aSet, ...bSet]).size;
  return union ? intersection / union : 0;
}

const ROLE_PROFILES = {
  marketing: {
    terms: [
      "google ads",
      "meta ads",
      "meta ads manager",
      "google analytics",
      "google analytics 4",
      "ga4",
      "google tag manager",
      "tag manager",
      "seo",
      "sem",
      "ppc",
      "ctr",
      "cpc",
      "cpa",
      "roas",
      "roi",
      "cro",
      "landing page",
      "landing pages",
      "a/b test",
      "ab test",
      "a/b testing",
      "ab testing",
      "search console",
      "hubspot",
      "remarketing",
      "retargeting",
      "audience segmentation",
      "lead generation",
      "email marketing",
      "campaign reporting",
      "content planning",
      "content strategy",
      "social media management",
      "paid advertising",
      "campaign optimization",
      "market research",
      "competitor analysis",
      "brand awareness",
      "campaign performance",
      "performance marketing",
      "audience targeting",
      "conversion tracking",
      "google sheets",
      "excel",
      "reporting",
      "analytics",
    ],
    hints: [
      "Keep bullets tool-aware and channel-aware.",
      "Preserve platforms, metrics, campaign context, and reporting context.",
      "Avoid vague marketing filler when real tools or channels already exist.",
    ],
  },
  customer_support: {
    terms: [
      "customer support",
      "customer service",
      "ticket handling",
      "ticket follow-up",
      "support tickets",
      "ticketing system",
      "issue resolution",
      "issue escalation",
      "customer communication",
      "live chat",
      "email support",
      "complaint handling",
      "service support",
      "service quality",
      "customer requests",
      "case follow-up",
      "customer feedback",
      "support records",
      "help desk",
      "crm",
      "zendesk",
      "freshdesk",
      "sla",
      "response time",
      "resolution time",
      "service operations",
      "customer records",
      "order-related issues",
      "account updates",
      "support summaries",
      "issue logs",
      "internal updates",
    ],
    hints: [
      "Keep support bullets realistic, concise, and service-oriented.",
      "Prefer response, resolution, escalation, follow-up, documentation, and coordination language.",
      "Avoid inflated business-outcome endings unless clearly supported.",
    ],
  },
  customer_success: {
    terms: [
      "customer success",
      "client onboarding",
      "customer onboarding",
      "onboarding",
      "account management",
      "account support",
      "customer communication",
      "client communication",
      "customer retention",
      "retention",
      "renewal",
      "renewals",
      "churn",
      "customer satisfaction",
      "client satisfaction",
      "csat",
      "nps",
      "qbr",
      "at-risk accounts",
      "customer feedback",
      "client engagement",
      "customer experience",
      "stakeholder updates",
      "success plans",
      "adoption",
      "usage reviews",
    ],
    hints: [
      "Keep customer success bullets relationship-focused and follow-up-focused.",
      "Use onboarding, adoption, retention, account support, and feedback language when supported.",
      "Do not invent renewal, churn, CSAT, or NPS results.",
    ],
  },
  operations: {
    terms: [
      "operations",
      "scheduling",
      "reporting",
      "documentation",
      "calendar management",
      "process follow-up",
      "process improvement",
      "process optimization",
      "cross-team coordination",
      "internal communication",
      "vendor communication",
      "tracking spreadsheet",
      "meeting coordination",
      "administrative support",
      "status updates",
      "workflow",
      "workflow management",
      "operations support",
      "records",
      "compliance",
      "coordination",
      "record keeping",
      "document management",
      "status tracking",
      "task tracking",
    ],
    hints: [
      "Keep operations bullets execution-focused and coordination-focused.",
      "Use documentation, scheduling, reporting, tracking, workflow, and stakeholder language naturally.",
      "Do not force strategic language when the work is clearly operational.",
    ],
  },
  sales: {
    terms: [
      "sales support",
      "lead follow-up",
      "client communication",
      "pipeline",
      "crm",
      "sales reporting",
      "account support",
      "prospect",
      "quote",
      "proposal",
      "customer follow-up",
      "sales coordination",
      "order processing",
      "client relationship",
      "deal tracking",
      "sales operations",
      "lead management",
      "prospect outreach",
      "account coordination",
      "pipeline updates",
    ],
    hints: [
      "Keep sales bullets commercial but truthful.",
      "Use lead, pipeline, proposal, follow-up, account, and coordination language when supported.",
      "Do not invent revenue, quotas, close rates, or deal impact.",
    ],
  },
  hr: {
    terms: [
      "recruitment",
      "candidate screening",
      "interview scheduling",
      "hr support",
      "employee records",
      "onboarding",
      "offboarding",
      "payroll support",
      "policy documentation",
      "training coordination",
      "hr administration",
      "talent acquisition",
      "candidate communication",
      "compliance",
      "employee documentation",
      "recruitment coordination",
      "candidate tracking",
    ],
    hints: [
      "Keep HR bullets process-focused, documentation-focused, and coordination-focused.",
      "Use candidate communication, interview scheduling, onboarding, records, and compliance language when supported.",
      "Do not invent hiring volume, retention metrics, or policy outcomes.",
    ],
  },
  finance: {
    terms: [
      "financial reporting",
      "reconciliation",
      "accounts payable",
      "accounts receivable",
      "invoice processing",
      "budget tracking",
      "expense reporting",
      "forecasting",
      "variance analysis",
      "excel",
      "financial analysis",
      "ledger",
      "audit support",
      "invoice reconciliation",
      "expense tracking",
      "forecast support",
      "financial accuracy",
    ],
    hints: [
      "Keep finance bullets accuracy-focused and reporting-focused.",
      "Use reconciliation, invoices, budgets, forecasts, audit support, and financial analysis language when supported.",
      "Do not invent savings, margins, budgets owned, or financial outcomes.",
    ],
  },
  admin: {
    terms: [
      "microsoft office",
      "excel",
      "google sheets",
      "powerpoint",
      "presentation",
      "meeting materials",
      "calendar management",
      "scheduling tasks",
      "administrative support",
      "document preparation",
      "record keeping",
      "internal reporting",
    ],
    hints: [
      "Keep admin bullets practical, organized, and support-focused.",
      "Prefer scheduling, documentation, record keeping, and meeting-preparation language.",
    ],
  },
  project: {
    terms: [
      "project coordination",
      "project management",
      "status tracking",
      "timelines",
      "deliverables",
      "meeting coordination",
      "stakeholder updates",
      "project workflows",
      "task coordination",
      "project reporting",
    ],
    hints: [
      "Keep project bullets coordination-focused and progress-focused.",
      "Use timelines, deliverables, tracking, meetings, and stakeholder updates language when supported.",
    ],
  },
  data: {
    terms: [
      "data analysis",
      "analytics",
      "dashboard",
      "looker studio",
      "data studio",
      "kpi",
      "performance metrics",
      "reporting",
      "trend analysis",
      "data tracking",
      "excel",
      "google sheets",
    ],
    hints: [
      "Keep data bullets analytical and reporting-oriented.",
      "Preserve dashboards, KPIs, reporting, tracking, and analysis language when supported.",
      "Do not invent quantified insights or business impact.",
    ],
  },
};

const ALL_ROLE_TERMS = uniqueTrimmedStrings(
  Object.values(ROLE_PROFILES).flatMap((profile) => profile.terms || [])
);

const HARD_FACT_TERMS = uniqueTrimmedStrings([
  "google ads",
  "meta ads",
  "meta ads manager",
  "linkedin ads",
  "linkedin campaign manager",
  "google analytics",
  "google analytics 4",
  "ga4",
  "google tag manager",
  "tag manager",
  "seo",
  "sem",
  "ctr",
  "cpc",
  "cpa",
  "roas",
  "roi",
  "cro",
  "conversion rate optimization",
  "landing page",
  "a/b test",
  "ab test",
  "search console",
  "hubspot",
  "salesforce",
  "crm",
  "zendesk",
  "freshdesk",
  "help desk",
  "google sheets",
  "excel",
  "powerpoint",
  "looker studio",
  "data studio",
  "dashboard",
  "remarketing",
  "retargeting",
  "audience segmentation",
  "lead generation",
  "email marketing",
  "kpi",
  "marketing automation",
  "automation",
  "sla",
  "response time",
  "resolution time",
  "ticketing system",
  "support tickets",
  "csat",
  "nps",
  "qbr",
]);

const STRONG_SPECIFIC_RE = buildPhraseRegex(ALL_ROLE_TERMS);
const SPECIFICITY_RE = buildPhraseRegex(ALL_ROLE_TERMS);

const WEAK_SENTENCE_RE =
  /\b(ilgilendim|bulundum|görev aldım|destek oldum|destek verdim|katkı sağladım|yardımcı oldum|sorumluydum|takip ettim|worked on|handled|supported|assisted|helped|was responsible for|contributed to|involved in|participated in)\b/i;

const WEAK_PHRASE_RE =
  /\b(helped|assisted|supported|involved in|responsible for|contributed to|worked on|played a key role in|participated in|handled|supported the team|took part in|ilgilendim|bulundum|baktım|yardım ettim|yardımcı oldum|destek verdim|destek oldum|katkı sağladım|görev aldım)\b/i;

const STRONG_ACTION_RE =
  /\b(yönettim|yürüttüm|koordine ettim|hazırladım|analiz ettim|raporladım|geliştirdim|oluşturdum|uyguladım|organize ettim|takip ettim|düzenledim|gerçekleştirdim|izledim|optimize ettim|tasarladım|planladım|uyarladım|sundum|segmentasyonu yaptım|managed|developed|coordinated|prepared|analyzed|reported|organized|implemented|tracked|maintained|optimized|planned|executed|designed|launched|created|responded|resolved|guided|communicated|relayed|documented|collected|scheduled|updated|monitored|processed)\b/i;

const BUSINESS_CONTEXT_RE =
  /\b(campaign|campaigns|audience|performance|report|reports|reporting|landing page|content|email marketing|email|social media|client|clients|stakeholder|stakeholders|team|teams|segmentation|remarketing|analysis|strategy|strategies|operations|workflow|calendar|calendars|materials|assets|market research|competitor analysis|lead generation|brand awareness|conversion|conversions|targeting|dashboard|documentation|presentations|customer|customers|ticket|tickets|issue|issues|service|support|case|cases|complaint|complaints|feedback|records|requests|follow-up|coordination|scheduling|vendor|process|communication|tracking|administrative|onboarding|retention|renewal|pipeline|proposal|invoice|budget|forecast|reconciliation|candidate|interview|employee)\b/i;

const EN_WEAK_REWRITE_START_RE =
  /^(?:actively\s+)?(?:helped|assisted|supported|contributed|participated|aided|facilitated)\b/i;

const EN_SOFT_FILLER_RE =
  /\b(aimed at|focused on|with a focus on|designed to|to improve|to enhance|to strengthen|to maximize|to optimize|to drive|to facilitate)\b/i;

const EN_UNSUPPORTED_IMPACT_RE =
  /\b(drive measurable results|resulting in|increased conversion rates|qualified leads|competitive positioning|data-driven decision-making|stronger market presence|better campaign outcomes|improved follow-up|deliver(?:ed|ing)? exceptional service|enhance(?:d|s|ing)? client relationships|increase(?:d|ing)? participation rates|boost(?:ed|ing)? customer loyalty)\b/i;

const ENGLISH_RISKY_RESULT_RE =
  /\b(resulting in|driving|boosting|enhancing|improving|increasing|streamlining|ensuring|maximizing|delivering|aimed at|focused on|designed to)\b/i;

const ENGLISH_WEAK_SWAP_RE =
  /\b(assisted|contributed|participated|supported|helped)\b/i;

const ENGLISH_CORPORATE_FLUFF_RE =
  /\b(dynamic|robust|seamless|impactful|high-impact|comprehensive|various|overall|strategic initiatives|in-depth data analysis|for consistency|for team accessibility|to ensure data accuracy|to ensure accuracy and relevance|to streamline communication efforts|to support informed decision-making|to support informed marketing strategies|to enhance engagement|to optimize user experience|to improve operational efficiency)\b/i;

function countTermHits(text = "", terms = []) {
  const norm = normalizeCompareText(text);
  return uniqueTrimmedStrings(terms).filter((term) =>
    norm.includes(normalizeCompareText(term))
  ).length;
}

function inferRoleProfiles(cv = "", jd = "") {
  const combined = `${cv || ""}\n${jd || ""}`;
  const scored = Object.entries(ROLE_PROFILES)
    .map(([key, profile]) => ({
      key,
      hits: countTermHits(combined, profile.terms || []),
      terms: profile.terms || [],
      hints: profile.hints || [],
    }))
    .filter((x) => x.hits > 0)
    .sort((a, b) => b.hits - a.hits);

  if (!scored.length) return [];

  const top = scored[0]?.hits || 0;

  return scored.filter((x, idx) => {
    if (idx === 0) return true;
    if (idx > 1) return false;
    return x.hits >= 2 || x.hits >= Math.max(1, top - 1);
  });
}

function buildRoleContextText(cv = "", jd = "") {
  const profiles = inferRoleProfiles(cv, jd);
  if (!profiles.length) {
    return [
      "- primary role signal: generic",
      "- guidance: keep bullets concise, truthful, execution-focused, and role-appropriate",
    ].join("\n");
  }

  return profiles
    .map((profile) => {
      const topTerms = profile.terms.slice(0, 12).join(", ");
      const hints = profile.hints.length
        ? profile.hints.map((h) => `  - ${h}`).join("\n")
        : "  - Keep the rewrite grounded and role-appropriate.";

      return [
        `- role family: ${profile.key}`,
        `  key terms: ${topTerms || "(none)"}`,
        "  writing hints:",
        hints,
      ].join("\n");
    })
    .join("\n");
}

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

function isSectionHeader(line = "") {
  return /^(PROFESSIONAL SUMMARY|SUMMARY|PROFILE|EXPERIENCE|WORK EXPERIENCE|SKILLS|EDUCATION|LANGUAGES|CERTIFICATIONS|PROJECTS|ADDITIONAL INFORMATION|PROFESYONEL ÖZET|ÖZET|PROFİL|DENEYİM|İŞ DENEYİMİ|YETKİNLİKLER|YETENEKLER|BECERİLER|EĞİTİM|DİLLER|BİLDİĞİ DİLLER|SERTİFİKALAR|PROJELER|EK BİLGİLER)$/i.test(
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
    .replace(/^YETENEKLER$/gim, "YETKİNLİKLER")
    .replace(/^BECERİLER$/gim, "YETKİNLİKLER")
    .replace(/^PROFİL$/gim, "PROFESYONEL ÖZET")
    .replace(/^İŞ DENEYİMİ$/gim, "DENEYİM")
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

function countCorporateFluffHits(cv = "") {
  return getBulletLines(cv).filter((b) => ENGLISH_CORPORATE_FLUFF_RE.test(b)).length;
}

function getOverlongBulletRatio(cv = "") {
  const bullets = getBulletLines(cv);
  if (!bullets.length) return 0;
  const overlong = bullets.filter((b) => countWords(b) >= 23).length;
  return overlong / bullets.length;
}

function countPersistingWeakSources(optimizedCv = "", weakSentences = []) {
  const lines = getNonEmptyLines(optimizedCv).map(normalizeCompareText);
  if (!lines.length) return 0;

  let hits = 0;
  for (const item of Array.isArray(weakSentences) ? weakSentences : []) {
    const source = normalizeCompareText(String(item?.sentence || ""));
    if (!source) continue;
    if (lines.some((line) => line === source)) hits += 1;
  }

  return hits;
}

function isShallowRewrite(sentence = "", rewrite = "") {
  const s = String(sentence || "").trim();
  const r = String(rewrite || "").trim();
  if (!s || !r) return true;

  const sim = jaccardSimilarity(s, r);
  if (normalizeCompareText(s) === normalizeCompareText(r)) return true;
  if (sim >= 0.86) return true;

  const sWords = countWords(s);
  const rWords = countWords(r);

  if (ENGLISH_WEAK_SWAP_RE.test(s) && ENGLISH_WEAK_SWAP_RE.test(r) && sim >= 0.55) {
    return true;
  }

  if (rWords >= sWords + 8 && sim >= 0.58) return true;
  return false;
}

function isClearlyWeakSentence(sentence = "") {
  const s = String(sentence || "").trim();
  if (!s) return false;

  if (WEAK_SENTENCE_RE.test(s)) return true;

  const hasSpecific = STRONG_SPECIFIC_RE.test(s) || BUSINESS_CONTEXT_RE.test(s);
  const wordCount = s.split(/\s+/).filter(Boolean).length;

  if (!hasSpecific && wordCount <= 8) return true;
  if (
    !hasSpecific &&
    /\b(yaptım|ettim|hazırladım|bulundum|baktım|ilgilen(dim|di)|worked on|helped with|assisted in)\b/i.test(s)
  ) {
    return true;
  }

  return false;
}

function hasUnsupportedImpactClaims(originalText = "", candidateText = "") {
  const orig = String(originalText || "");
  const opt = String(candidateText || "");
  return EN_UNSUPPORTED_IMPACT_RE.test(opt) && !EN_UNSUPPORTED_IMPACT_RE.test(orig);
}

function filterWeakSentences(items = [], outLang = "") {
  return (Array.isArray(items) ? items : [])
    .map((x) => ({
      sentence: String(x?.sentence || "").trim(),
      rewrite: String(x?.rewrite || "").trim(),
    }))
    .filter((x) => x.sentence && x.rewrite)
    .filter((x) => normalizeCompareText(x.sentence) !== normalizeCompareText(x.rewrite))
    .filter((x) => isClearlyWeakSentence(x.sentence))
    .filter((x) => !isShallowRewrite(x.sentence, x.rewrite))
    .filter((x) => {
      if (outLang !== "English") return true;
      if (EN_WEAK_REWRITE_START_RE.test(x.rewrite)) return false;
      if (ENGLISH_WEAK_SWAP_RE.test(x.rewrite)) return false;
      if (EN_SOFT_FILLER_RE.test(x.rewrite) && !EN_SOFT_FILLER_RE.test(x.sentence)) {
        return false;
      }
      if (hasUnsupportedImpactClaims(x.sentence, x.rewrite)) return false;
      return true;
    })
    .slice(0, 12);
}

function getExplicitFactTerms(text = "") {
  const norm = normalizeCompareText(text);
  return HARD_FACT_TERMS.filter((term, idx, arr) => {
    return norm.includes(normalizeCompareText(term)) && arr.indexOf(term) === idx;
  });
}

function buildAllowedTermsText(cv = "", jd = "") {
  const terms = uniqueTrimmedStrings([
    ...getExplicitFactTerms(cv),
    ...getExplicitFactTerms(jd),
  ]);
  return terms.length ? terms.join(", ") : "(none explicitly supported)";
}

function findUnsupportedTerms(originalCv = "", jd = "", optimizedCv = "") {
  const allowed = new Set(
    uniqueTrimmedStrings([
      ...getExplicitFactTerms(originalCv),
      ...getExplicitFactTerms(jd),
    ]).map(normalizeCompareText)
  );

  return uniqueTrimmedStrings(getExplicitFactTerms(optimizedCv)).filter(
    (term) => !allowed.has(normalizeCompareText(term))
  );
}

function countWeakEnglishRewriteStarts(cv = "") {
  return getBulletLines(cv).filter((b) =>
    EN_WEAK_REWRITE_START_RE.test(String(b || "").trim())
  ).length;
}

function countEnglishStyleRiskHits(originalCv = "", optimizedCv = "") {
  const origBullets = getBulletLines(originalCv);
  const optBullets = getBulletLines(optimizedCv);
  const total = Math.min(origBullets.length, optBullets.length);

  let hits = 0;

  for (let i = 0; i < total; i++) {
    const orig = String(origBullets[i] || "").trim();
    const opt = String(optBullets[i] || "").trim();

    if (!orig || !opt) continue;

    const origHasRiskyResult = ENGLISH_RISKY_RESULT_RE.test(orig);
    const optHasRiskyResult = ENGLISH_RISKY_RESULT_RE.test(opt);
    if (!origHasRiskyResult && optHasRiskyResult) hits += 1;

    const origWeak = ENGLISH_WEAK_SWAP_RE.test(orig);
    const optWeak = ENGLISH_WEAK_SWAP_RE.test(opt);
    if (origWeak && optWeak) hits += 1;

    const origSoftFiller = EN_SOFT_FILLER_RE.test(orig);
    const optSoftFiller = EN_SOFT_FILLER_RE.test(opt);
    if (!origSoftFiller && optSoftFiller) hits += 1;
  }

  return hits;
}

function computeFinalOptimizedScore(
  originalCv = "",
  optimizedCv = "",
  originalScore = 0,
  jd = ""
) {
  const base = clampScore(originalScore);
  if (!originalCv || !optimizedCv) return base;

  const origNorm = normalizeCompareText(originalCv);
  const optNorm = normalizeCompareText(optimizedCv);

  if (!optNorm || origNorm === optNorm) return base;

  const rescoredOptimized = computeDeterministicAtsScore(optimizedCv, jd);
  const rawLift = Math.max(0, rescoredOptimized - base);

  const weakBefore = countWeakVerbHits(originalCv);
  const weakAfter = countWeakVerbHits(optimizedCv);
  const weakGain = Math.max(0, weakBefore - weakAfter);

  const { same, total } = countUnchangedBullets(originalCv, optimizedCv);
  const rewriteRatio = total > 0 ? 1 - same / total : 0;

  let lift = 0;
  lift += rawLift * 0.48;
  lift += Math.min(3, weakGain) * 0.8;

  if (rewriteRatio >= 0.7) lift += 3;
  else if (rewriteRatio >= 0.5) lift += 2;
  else if (rewriteRatio >= 0.3) lift += 1;

  const meaningfulChange = rawLift > 0 || weakGain > 0 || rewriteRatio >= 0.2;
  if (!meaningfulChange) return base;

  lift = Math.round(lift);

  const cap =
    base < 40 ? 19 :
    base < 55 ? 16 :
    base < 70 ? 14 :
    base < 80 ? 10 : 6;

  lift = Math.max(3, Math.min(cap, lift));

  return clampScore(base + lift);
}

function shouldRepairOptimizedCv(
  originalCv = "",
  optimizedCv = "",
  jd = "",
  outLang = "",
  weakSentences = []
) {
  if (!optimizedCv || !String(optimizedCv).trim()) return true;

  const origNorm = normalizeCompareText(originalCv);
  const optNorm = normalizeCompareText(optimizedCv);

  if (!optNorm) return true;
  if (origNorm === optNorm) return true;

  const { same, total } = countUnchangedBullets(originalCv, optimizedCv);
  if (total > 0 && same / total >= 0.4) return true;

  const optimizedBullets = getBulletLines(optimizedCv);
  if (total > 0 && optimizedBullets.length < Math.max(2, Math.floor(total * 0.7))) {
    return true;
  }

  const weakBefore = countWeakVerbHits(originalCv);
  const weakAfter = countWeakVerbHits(optimizedCv);
  if (weakBefore > 0 && weakAfter >= weakBefore) return true;

  if (countPersistingWeakSources(optimizedCv, weakSentences) >= 2) return true;

  if (outLang === "English" && countEnglishStyleRiskHits(originalCv, optimizedCv) >= 2) {
    return true;
  }

  if (outLang === "English" && countCorporateFluffHits(optimizedCv) >= 2) {
    return true;
  }

  if (outLang === "English" && getOverlongBulletRatio(optimizedCv) > 0.35) {
    return true;
  }

  if (countWeakVerbHits(optimizedCv) >= 2) return true;
  if (countWeakEnglishRewriteStarts(optimizedCv) >= 2) return true;
  if (hasUnsupportedImpactClaims(originalCv, optimizedCv)) return true;
  if (findUnsupportedTerms(originalCv, jd, optimizedCv).length > 0) return true;

  return false;
}

function getSectionPresenceScore(cv = "") {
  const text = getNonEmptyLines(cv).join("\n");
  let score = 0;

  if (/(PROFESSIONAL SUMMARY|SUMMARY|PROFILE|PROFESYONEL ÖZET|ÖZET|PROFİL)/i.test(text)) score += 5;
  if (/(EXPERIENCE|WORK EXPERIENCE|DENEYİM|İŞ DENEYİMİ)/i.test(text)) score += 7;
  if (/(SKILLS|YETKİNLİKLER|YETENEKLER|BECERİLER)/i.test(text)) score += 4;
  if (/(EDUCATION|EĞİTİM)/i.test(text)) score += 4;
  if (/(LANGUAGES|DİLLER|BİLDİĞİ DİLLER)/i.test(text)) score += 2;
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

function getKeywordBreadthScore(cv = "", jd = "") {
  const text = normalizeCompareText(cv);
  const skills = uniqueTrimmedStrings(getSkillsLines(cv));
  const roleProfiles = inferRoleProfiles(cv, jd);

  let score = 0;
  score += Math.min(8, skills.length);

  const relevantTerms = roleProfiles.length
    ? uniqueTrimmedStrings(roleProfiles.flatMap((profile) => profile.terms || []))
    : ALL_ROLE_TERMS;

  const relevantHits = relevantTerms.filter((term) =>
    text.includes(normalizeCompareText(term))
  ).length;
  score += Math.min(4, relevantHits);

  const topHits = roleProfiles[0]?.hits || 0;
  const secondHits = roleProfiles[1]?.hits || 0;

  if (topHits >= 3) score += 1;
  if (topHits >= 5) score += 1;
  if (secondHits >= 2) score += 1;

  const businessHits = [
    "cross-functional collaboration",
    "stakeholder communication",
    "reporting",
    "documentation",
    "process improvement",
    "process optimization",
    "issue resolution",
    "account management",
    "customer feedback",
    "client communication",
  ].filter((term) => text.includes(normalizeCompareText(term))).length;

  score += Math.min(3, businessHits);

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
    if (SPECIFICITY_RE.test(bullet) || BUSINESS_CONTEXT_RE.test(bullet)) specificityCount += 1;
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
  return Math.max(0, Math.min(10, Math.round(ratio * 10)));
}

function computeDeterministicAtsScore(cv = "", jd = "") {
  const hasJD = !!String(jd || "").trim();

  const sectionScore = getSectionPresenceScore(cv);
  const bulletScore = getBulletStrengthScore(cv);
  const readabilityScore = getReadabilityScore(cv);
  const keywordScore = getKeywordBreadthScore(cv, jd);
  const jdScore = getJdAlignmentScore(cv, jd);

  let total = 0;

  if (hasJD) {
    total =
      Math.round((sectionScore / 25) * 20) +
      Math.round((bulletScore / 40) * 35) +
      Math.round((readabilityScore / 20) * 20) +
      Math.round((keywordScore / 15) * 15) +
      jdScore;
  } else {
    total =
      Math.round((sectionScore / 25) * 25) +
      Math.round((bulletScore / 40) * 40) +
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
      bullet_strength * 0.28 +
      jd_keyword_match * 0.18 +
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

function buildAttempts({ model, isPreview, passType, maxCompletionTokens }) {
  if (!isGpt5Model(model)) {
    return [
      {
        reasoningEffort: null,
        temperature: isPreview ? 0.2 : 0.25,
        maxCompletionTokens,
      },
    ];
  }

  if (passType === "optimize") {
    return [
      {
        reasoningEffort: "medium",
        temperature: null,
        maxCompletionTokens: Math.max(maxCompletionTokens, 3200),
      },
      {
        reasoningEffort: "low",
        temperature: null,
        maxCompletionTokens: Math.max(maxCompletionTokens, 4200),
      },
    ];
  }

  if (passType === "repair") {
    return [
      {
        reasoningEffort: "low",
        temperature: null,
        maxCompletionTokens: Math.max(maxCompletionTokens, 3200),
      },
      {
        reasoningEffort: "none",
        temperature: 0.2,
        maxCompletionTokens: Math.max(maxCompletionTokens, 3600),
      },
    ];
  }

  if (isPreview) {
    return [
      {
        reasoningEffort: "none",
        temperature: 0.2,
        maxCompletionTokens: Math.max(maxCompletionTokens, 1100),
      },
      {
        reasoningEffort: "none",
        temperature: 0.2,
        maxCompletionTokens: Math.max(maxCompletionTokens, 1500),
      },
    ];
  }

  return [
    {
      reasoningEffort: "low",
      temperature: null,
      maxCompletionTokens: Math.max(maxCompletionTokens, 1800),
    },
    {
      reasoningEffort: "none",
      temperature: 0.2,
      maxCompletionTokens: Math.max(maxCompletionTokens, 2200),
    },
  ];
}

async function fetchWithTimeout(url, options, timeoutMs = 65000) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  try {
    return await fetch(url, {
      ...options,
      signal: controller.signal,
    });
  } finally {
    clearTimeout(timer);
  }
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
      const openaiRes = await fetchWithTimeout(
        "https://api.openai.com/v1/chat/completions",
        {
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
        },
        passType === "optimize" || passType === "repair" ? 70000 : 60000
      );

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
      if (err?.name === "AbortError") {
        lastError = new Error("OpenAI request timed out");
        lastError.status = 504;
        lastError.details = "The upstream request exceeded the timeout window.";
      } else {
        lastError = err;
      }

      if (
        lastError?.status &&
        lastError.status >= 400 &&
        lastError.status < 500 &&
        lastError.status !== 429
      ) {
        throw lastError;
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
- Only use metrics, tools, platforms, and facts explicitly present in the resume and optional job description.
- Never turn a specific sentence into a more generic sentence.
- Never remove existing useful specificity such as tools, metrics, platforms, channels, or business context.
- If a bullet has no measurable metric, improve it using scope + action + context + purpose wording WITHOUT inventing numbers.
- If the original sentence is support-oriented, you may strengthen clarity, but do NOT upgrade it into full ownership unless clearly supported.
- Weak sentence detection must prioritize genuinely weak, vague, or support-heavy phrasing first.
- Do NOT flag already-strong sentences as weak just because they can be polished slightly.
- Sentences that already contain concrete tools, platforms, metrics, or strong action verbs should usually NOT be selected as weak.
- Rewrites must be materially better than the original.
- Do NOT make shallow synonym swaps or near-duplicate rewrites.
- Each rewrite must improve at least two of these:
  clarity, specificity, scope, action strength, business context, recruiter readability.
- If a rewrite is too similar to the original, rewrite it again more strongly.
- Keep optimized_cv ATS-friendly, clean, realistic, and parser-friendly.
- For English output, write like a strong US resume writer, not a marketing copywriter.
- Premium quality means: grounded, concise, role-appropriate, and recruiter-ready.

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

function buildEnglishStyleBlock() {
  return `
ENGLISH WRITING STYLE:
- Write like a strong US resume, not marketing copy.
- Keep bullets concise, concrete, and natural.
- Prefer 10-18 words per bullet when possible.
- Prefer one clear action + scope + context structure.
- Do NOT add filler words such as:
  impactful, dynamic, seamless, comprehensive, robust, overall, various.
- Do NOT add unsupported outcome clauses such as:
  resulting in, driving, boosting, enhancing, improving, increasing, streamlining, ensuring, maximizing, delivering
  unless the original text clearly supports that outcome.
- Do NOT turn one weak verb into another weak verb.
  Avoid swaps like:
  helped -> assisted
  supported -> contributed
  worked on -> participated in
- For support-level work, prefer honest execution language such as:
  coordinated, prepared, tracked, documented, maintained, scheduled, supported execution of, collaborated with.
- Keep already-strong bullets short and sharp.
- Do NOT over-expand bullets just to sound more professional.
`.trim();
}

function buildPreviewAtsPrompt({ cv, jd, hasJD, outLang }) {
  const englishStyleBlock = outLang === "English" ? buildEnglishStyleBlock() : "";
  const roleContextText = buildRoleContextText(cv, jd);

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
- Select only sentences that are genuinely weak, vague, generic, or support-heavy.
- Do NOT select already-strong sentences that already contain concrete tools, platforms, or metrics.
- Prefer weak experience bullets first, then summary only if necessary.
- summary MUST be 4-6 bullet lines in ${outLang}.
- summary must focus on job fit, biggest missing keywords, ATS risks, and top improvements.
- Do NOT add extra keys. Do NOT add optimized_cv.

ROLE CONTEXT:
${roleContextText}

${englishStyleBlock}

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
- Select only sentences that are genuinely weak, vague, generic, or support-heavy.
- Do NOT select already-strong sentences that already contain concrete tools, platforms, or metrics.
- Prefer weak experience bullets first, then summary only if necessary.
- summary MUST be 4-6 bullet lines in ${outLang}.
- summary must focus on general ATS readiness, structure, clarity, and top improvement areas.
- Do NOT add extra keys. Do NOT add optimized_cv.

ROLE CONTEXT:
${roleContextText}

${englishStyleBlock}

RESUME:
${cv}
`.trim();
}

function buildFullAtsAnalysisPrompt({ cv, jd, hasJD, outLang }) {
  const englishStyleBlock = outLang === "English" ? buildEnglishStyleBlock() : "";
  const roleContextText = buildRoleContextText(cv, jd);

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
- weak_sentences MUST include 7-12 items from the resume text when genuinely weak examples exist.
- Do NOT force the count if there are fewer genuinely weak examples.
- Both sentence and rewrite MUST be in ${outLang}.
- Only select genuinely weak, vague, generic, or support-heavy sentences.
- Do NOT select sentences as weak if they already contain concrete tools, platforms, or metrics unless the rewrite preserves all specificity and is clearly much stronger.
- Prefer weak experience bullets first.
- If needed, also use genuinely weak lines from summary, projects, certifications, skills descriptions, or additional information.
- Do NOT include already-strong sentences just to fill the count.
- Do NOT use shallow synonym swaps or near-duplicate rewrites.
- Each rewrite must improve at least two of these: clarity, ownership, specificity, scope, action strength, business context.
- summary MUST be detailed (8-12 bullet lines) in ${outLang}.
- Do NOT add optimized_cv.
- Keep claims truthful. Do not invent employers, degrees, titles, dates, tools, metrics, acronyms, or platforms.

ROLE CONTEXT:
${roleContextText}

${englishStyleBlock}

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
- weak_sentences MUST include 8-12 items from the resume text when genuinely weak examples exist.
- Do NOT force the count if there are fewer genuinely weak examples.
- Both sentence and rewrite MUST be in ${outLang}.
- Only select genuinely weak, vague, generic, or support-heavy sentences.
- Do NOT select sentences as weak if they already contain concrete tools, platforms, or metrics unless the rewrite preserves all specificity and is clearly much stronger.
- Prefer weak experience bullets first.
- If needed, also use genuinely weak lines from summary, projects, certifications, skills descriptions, or additional information.
- Do NOT include already-strong sentences just to fill the count.
- Do NOT use shallow synonym swaps or near-duplicate rewrites.
- Each rewrite must improve at least two of these: clarity, ownership, specificity, scope, action strength, business context.
- summary MUST be detailed (8-12 bullet lines) in ${outLang}.
- Do NOT add optimized_cv.
- Keep claims truthful. Do not invent employers, degrees, titles, dates, tools, metrics, acronyms, or platforms.

ROLE CONTEXT:
${roleContextText}

${englishStyleBlock}

RESUME:
${cv}
`.trim();
}

function buildOptimizeCvPrompt({
  cv,
  jd,
  hasJD,
  summary,
  missingKeywords,
  outLang,
}) {
  const keywordsText = Array.isArray(missingKeywords) ? missingKeywords.join(", ") : "";
  const allowedTermsText = buildAllowedTermsText(cv, jd);
  const englishStyleBlock = outLang === "English" ? buildEnglishStyleBlock() : "";
  const roleContextText = buildRoleContextText(cv, jd);

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
- Do NOT invent numbers, tools, platforms, acronyms, KPIs, budgets, achievements, channels, or software.
- Do NOT replace generic platform language with specific platforms unless explicitly present in the resume or job description.
- If the original text is support-oriented, you may make it clearer, but do NOT upgrade it into full ownership unless clearly supported.
- Use the analysis summary to improve wording truthfully.
- Missing keywords are guidance only. Do NOT add a keyword unless it is already supported by the resume or job description.
- Keep already-strong bullets unchanged or only lightly polish them.
- Focus most of the rewrite effort on the weaker summary lines and weaker/support-heavy bullets.
- Preserve the role structure and bullet structure as much as possible.
- Do NOT merge multiple bullets into one if that removes detail.
- Do NOT remove meaningful bullets unless they are duplicate or redundant.
- Use canonical section headings only.
- For English output, do NOT rewrite weak bullets into corporate-fluff language.
- Avoid rewrites that begin with: assisted, supported, contributed, participated, aided, unless no stronger truthful verb is possible.
- Prefer neutral factual verbs such as: coordinated, prepared, tracked, monitored, updated, maintained, scheduled, reported, analyzed, collaborated, responded, resolved, processed, documented.
- Do NOT add impact claims like increased conversion rates, measurable results, qualified leads, stronger market presence, better campaign outcomes, improved follow-up, or improved operational efficiency unless explicitly supported by the resume or job description.

ROLE CONTEXT:
${roleContextText}

ALLOWED EXPLICIT TOOLS / PLATFORMS / ACRONYMS:
${allowedTermsText}

HARD FACT LOCK:
- You may use only tools, platforms, acronyms, channels, and business concepts explicitly present in the resume or job description.
- If a term is not explicitly supported, do NOT add it.

${englishStyleBlock}

QUALITY TARGET:
- The optimized CV must feel clearly stronger than the original, not just lightly polished.
- Improve bullets using clarity + scope + recruiter-friendly wording + business context, without inventing facts.
- Do NOT flatten already-specific bullets into generic corporate language.
- Keep the resume realistic, premium, and ATS-friendly.

ANALYSIS SUMMARY:
${summary || "(none)"}

HIGH PRIORITY KEYWORDS / GAPS:
${keywordsText || "(none)"}

SELF-CHECK BEFORE RETURNING:
- no unsupported tools/platforms/acronyms added
- no invented achievements/results added
- no unjustified ownership escalation
- no major bullet loss
- no merged bullets that reduce clarity

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
- Do NOT invent numbers, tools, platforms, acronyms, KPIs, budgets, achievements, channels, or software.
- Do NOT replace generic platform language with specific platforms unless explicitly present in the resume.
- If the original text is support-oriented, you may make it clearer, but do NOT upgrade it into full ownership unless clearly supported.
- Use the analysis summary to improve wording truthfully.
- Missing keywords are guidance only. Do NOT add a keyword unless it is already supported by the resume.
- Keep already-strong bullets unchanged or only lightly polish them.
- Focus most of the rewrite effort on the weaker summary lines and weaker/support-heavy bullets.
- Preserve the role structure and bullet structure as much as possible.
- Do NOT merge multiple bullets into one if that removes detail.
- Do NOT remove meaningful bullets unless they are duplicate or redundant.
- Use canonical section headings only.
- For English output, do NOT rewrite weak bullets into corporate-fluff language.
- Avoid rewrites that begin with: assisted, supported, contributed, participated, aided, unless no stronger truthful verb is possible.
- Prefer neutral factual verbs such as: coordinated, prepared, tracked, monitored, updated, maintained, scheduled, reported, analyzed, collaborated, responded, resolved, processed, documented.
- Do NOT add impact claims like increased conversion rates, measurable results, qualified leads, stronger market presence, better campaign outcomes, improved follow-up, or improved operational efficiency unless explicitly supported by the resume or job description.

ROLE CONTEXT:
${roleContextText}

ALLOWED EXPLICIT TOOLS / PLATFORMS / ACRONYMS:
${allowedTermsText}

HARD FACT LOCK:
- You may use only tools, platforms, acronyms, channels, and business concepts explicitly present in the resume.
- If a term is not explicitly supported, do NOT add it.

${englishStyleBlock}

QUALITY TARGET:
- The optimized CV must feel clearly stronger than the original, not just lightly polished.
- Improve bullets using clarity + scope + recruiter-friendly wording + business context, without inventing facts.
- Do NOT flatten already-specific bullets into generic corporate language.
- Keep the resume realistic, premium, and ATS-friendly.

ANALYSIS SUMMARY:
${summary || "(none)"}

HIGH PRIORITY KEYWORDS / GAPS:
${keywordsText || "(none)"}

SELF-CHECK BEFORE RETURNING:
- no unsupported tools/platforms/acronyms added
- no invented achievements/results added
- no unjustified ownership escalation
- no major bullet loss
- no merged bullets that reduce clarity

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
  unsupportedTerms = [],
  outLang,
}) {
  const keywordsText = Array.isArray(missingKeywords) ? missingKeywords.join(", ") : "";
  const allowedTermsText = buildAllowedTermsText(cv, jd);
  const englishStyleBlock = outLang === "English" ? buildEnglishStyleBlock() : "";
  const unsupportedText =
    Array.isArray(unsupportedTerms) && unsupportedTerms.length
      ? unsupportedTerms.join(", ")
      : "(none)";
  const roleContextText = buildRoleContextText(cv, jd);

  return hasJD
    ? `
Return JSON in this exact schema:

{
  "optimized_cv": string
}

TASK:
You already generated an optimized resume, but it still needs cleanup.
Rewrite it again so the result is materially stronger, cleaner, more ATS-friendly, and more recruiter-ready.

STRICT RULES:
- Keep the header identity block exactly as written.
- Keep existing experience titles unchanged.
- Keep exact dates, employers, titles, degrees, certifications, and explicit years of experience unchanged.
- Do NOT invent metrics, tools, platforms, acronyms, channels, or achievements.
- Do NOT replace generic platform language with specific platforms unless explicitly present.
- Do NOT upgrade support-oriented work into full ownership unless clearly supported.
- Keep already-strong bullets strong.
- Focus the rewrite effort on weaker or support-heavy bullets and any awkward summary lines.
- Preserve bullet count and structure as much as possible.
- Do NOT merge multiple bullets into one if that removes detail.
- Use canonical section headings only.

ROLE CONTEXT:
${roleContextText}

ALLOWED EXPLICIT TOOLS / PLATFORMS / ACRONYMS:
${allowedTermsText}

REMOVE THESE UNSUPPORTED TERMS IF PRESENT:
${unsupportedText}

HARD FACT LOCK:
- You may use only tools, platforms, acronyms, channels, and business concepts explicitly present in the resume or job description.
- Missing keywords are guidance only. Do NOT add a keyword unless it is already supported by the resume or job description.
- If a term is not explicitly supported, remove it.

${englishStyleBlock}

QUALITY TARGET:
- The final output should feel premium and clearly stronger than the original.
- Do NOT keep weak generic bullets if they can be rewritten more clearly and specifically.
- Do NOT flatten already-good bullets.
- Keep the resume truthful, realistic, and recruiter-ready.

ANALYSIS SUMMARY:
${summary || "(none)"}

HIGH PRIORITY KEYWORDS / GAPS:
${keywordsText || "(none)"}

SELF-CHECK BEFORE RETURNING:
- unsupported terms removed
- no invented tools/platforms/acronyms
- no invented outcomes
- no unjustified ownership escalation
- no major bullet loss

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
You already generated an optimized resume, but it still needs cleanup.
Rewrite it again so the result is materially stronger, cleaner, more ATS-friendly, and more recruiter-ready.

STRICT RULES:
- Keep the header identity block exactly as written.
- Keep existing experience titles unchanged.
- Keep exact dates, employers, titles, degrees, certifications, and explicit years of experience unchanged.
- Do NOT invent metrics, tools, platforms, acronyms, channels, or achievements.
- Do NOT replace generic platform language with specific platforms unless explicitly present.
- Do NOT upgrade support-oriented work into full ownership unless clearly supported.
- Keep already-strong bullets strong.
- Focus the rewrite effort on weaker or support-heavy bullets and any awkward summary lines.
- Preserve bullet count and structure as much as possible.
- Do NOT merge multiple bullets into one if that removes detail.
- Use canonical section headings only.

ROLE CONTEXT:
${roleContextText}

ALLOWED EXPLICIT TOOLS / PLATFORMS / ACRONYMS:
${allowedTermsText}

REMOVE THESE UNSUPPORTED TERMS IF PRESENT:
${unsupportedText}

HARD FACT LOCK:
- You may use only tools, platforms, acronyms, channels, and business concepts explicitly present in the resume.
- Missing keywords are guidance only. Do NOT add a keyword unless it is already supported by the resume.
- If a term is not explicitly supported, remove it.

${englishStyleBlock}

QUALITY TARGET:
- The final output should feel premium and clearly stronger than the original.
- Do NOT keep weak generic bullets if they can be rewritten more clearly and specifically.
- Do NOT flatten already-good bullets.
- Keep the resume truthful, realistic, and recruiter-ready.

ANALYSIS SUMMARY:
${summary || "(none)"}

HIGH PRIORITY KEYWORDS / GAPS:
${keywordsText || "(none)"}

SELF-CHECK BEFORE RETURNING:
- unsupported terms removed
- no invented tools/platforms/acronyms
- no invented outcomes
- no unjustified ownership escalation
- no major bullet loss

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
- about.short: 600-900 chars, punchy, no emojis.
- experience_fix: up to 1 item.
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
- Do NOT invent employers, titles, dates, degrees, or metrics.
- If resume has no numbers, improve bullets without guessing numbers.
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
          maxCompletionTokens: isPreview ? 1100 : 2200,
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
          maxCompletionTokens: 1100,
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
          Array.isArray(previewData?.weak_sentences) ? previewData.weak_sentences : [],
          outLang
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
        maxCompletionTokens: 1800,
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
      component_scores: componentScores,
      missing_keywords: Array.isArray(analysisData?.missing_keywords)
        ? analysisData.missing_keywords
        : [],
      weak_sentences: filterWeakSentences(
        Array.isArray(analysisData?.weak_sentences) ? analysisData.weak_sentences : [],
        outLang
      ),
      summary: typeof analysisData?.summary === "string" ? analysisData.summary : "",
      optimized_cv: "",
      optimized_ats_score: mergedBaseScore,
    };

    let currentOptimized = "";
    let unsupportedTerms = [];

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
          outLang,
        }),
        isPreview: false,
        passType: "optimize",
        maxCompletionTokens: 3000,
      });

      if (typeof optimizeData?.optimized_cv === "string" && optimizeData.optimized_cv.trim()) {
        currentOptimized = forceSafeResume(cv, optimizeData.optimized_cv.trim());
        unsupportedTerms = findUnsupportedTerms(cv, jd, currentOptimized);
      }
    } catch {
      currentOptimized = "";
      unsupportedTerms = [];
    }

    if (!currentOptimized) {
      currentOptimized = forceSafeResume(cv, cv);
      unsupportedTerms = [];
    }

    if (
      shouldRepairOptimizedCv(cv, currentOptimized, jd, outLang, normalized.weak_sentences) ||
      unsupportedTerms.length > 0
    ) {
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
            summary: normalized.summary,
            missingKeywords: normalized.missing_keywords,
            unsupportedTerms,
            outLang,
          }),
          isPreview: false,
          passType: "repair",
          maxCompletionTokens: 3200,
        });

        if (typeof repaired?.optimized_cv === "string" && repaired.optimized_cv.trim()) {
          currentOptimized = forceSafeResume(cv, repaired.optimized_cv.trim());
          unsupportedTerms = findUnsupportedTerms(cv, jd, currentOptimized);
        }
      } catch {
        // keep currentOptimized
      }
    }

    normalized.optimized_cv = currentOptimized;
    normalized.optimized_ats_score = computeFinalOptimizedScore(
      cv,
      currentOptimized,
      normalized.ats_score,
      jd
    );

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
