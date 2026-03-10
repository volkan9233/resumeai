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
  const safe = uniqueTrimmedStrings(terms)
    .map(escapeRegex)
    .filter(Boolean)
    .sort((a, b) => b.length - a.length);

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

const ROLE_PACKS = {
  marketing: {
    keywords: [
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
      "cpc",
      "ctr",
      "cpa",
      "roas",
      "roi",
      "landing page",
      "a/b test",
      "ab test",
      "remarketing",
      "retargeting",
      "audience segmentation",
      "lead generation",
      "email marketing",
      "content planning",
      "content marketing",
      "social media",
      "campaign reporting",
      "campaign optimization",
      "paid advertising",
      "performance marketing",
      "search console",
    ],
    strongTerms: [
      "google ads",
      "meta ads",
      "google analytics",
      "ga4",
      "google tag manager",
      "seo",
      "sem",
      "ppc",
      "cpc",
      "ctr",
      "cpa",
      "roas",
      "roi",
      "landing page",
      "a/b test",
      "ab test",
      "remarketing",
      "retargeting",
      "audience segmentation",
      "lead generation",
      "email marketing",
      "campaign",
      "analytics",
      "reporting",
      "content planning",
    ],
    businessContextTerms: [
      "campaign",
      "campaigns",
      "performance",
      "audience",
      "targeting",
      "lead generation",
      "brand awareness",
      "social media",
      "email",
      "landing page",
      "content",
      "reporting",
      "analysis",
      "optimization",
      "ad performance",
      "channel performance",
    ],
    suggestedKeywords: [
      "PPC",
      "digital strategy",
      "content marketing",
      "social media strategy",
      "email campaigns",
      "lead generation",
      "market analysis",
      "performance metrics",
      "brand management",
      "customer engagement",
      "data analysis",
      "campaign optimization",
      "search engine marketing",
      "analytics reporting",
    ],
    preferredVerbs: [
      "managed",
      "optimized",
      "analyzed",
      "tracked",
      "reported",
      "coordinated",
      "monitored",
      "prepared",
      "executed",
      "launched",
      "updated",
      "collaborated",
    ],
    safeSupportVerbs: [
      "coordinated",
      "prepared",
      "tracked",
      "supported execution of",
      "updated",
      "monitored",
      "collaborated with",
      "maintained",
    ],
    keepRules: [
      "Preserve platforms, metrics, channels, and campaign context.",
      "Keep tools like Google Ads, Meta Ads, GA4, GTM, SEO/SEM, CPC, CTR, A/B testing when present.",
      "Keep marketing bullets tool-aware and channel-aware.",
    ],
    avoidRules: [
      "Do not replace tool-specific bullets with vague strategy language.",
      "Do not invent conversions, lead volume, ROI lift, revenue impact, or performance improvements.",
      "Do not add fluffy endings like improve engagement unless clearly supported.",
    ],
    styleHints: [
      "Marketing bullets should stay specific, factual, and performance-aware.",
      "Protect channel names, tools, metrics, and campaign context.",
    ],
  },

  customer_support: {
    keywords: [
      "customer support",
      "customer service",
      "ticket",
      "tickets",
      "ticket handling",
      "ticket follow-up",
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
      "crm",
      "zendesk",
      "freshdesk",
      "help desk",
      "sla",
      "response time",
      "resolution time",
      "escalation",
      "service operations",
    ],
    strongTerms: [
      "customer support",
      "customer service",
      "ticket",
      "issue resolution",
      "issue escalation",
      "email support",
      "live chat",
      "complaint handling",
      "support records",
      "case follow-up",
      "response time",
      "resolution",
      "service quality",
      "customer requests",
      "feedback",
      "help desk",
    ],
    businessContextTerms: [
      "customer",
      "customers",
      "ticket",
      "tickets",
      "case",
      "cases",
      "issue",
      "issues",
      "service",
      "support",
      "follow-up",
      "requests",
      "feedback",
      "complaints",
      "records",
      "response",
      "escalation",
      "inquiries",
      "account updates",
      "order-related issues",
    ],
    suggestedKeywords: [
      "customer satisfaction",
      "problem-solving",
      "CRM software",
      "customer retention",
      "service improvement",
      "performance metrics",
      "conflict resolution",
      "customer engagement",
      "multitasking",
      "time management",
      "feedback analysis",
      "process optimization",
      "technical support",
      "ticket management",
    ],
    preferredVerbs: [
      "responded",
      "resolved",
      "followed up",
      "escalated",
      "documented",
      "maintained",
      "coordinated",
      "communicated",
      "updated",
      "processed",
      "monitored",
      "tracked",
    ],
    safeSupportVerbs: [
      "responded to",
      "followed up on",
      "documented",
      "maintained",
      "updated",
      "processed",
      "coordinated",
      "communicated with",
    ],
    keepRules: [
      "Preserve tickets, escalation, follow-up, email/live chat, records, and issue-resolution context.",
      "Keep support bullets realistic, concise, and service-oriented.",
    ],
    avoidRules: [
      "Do not turn support work into customer success strategy language.",
      "Do not add fake business impact or inflated service outcomes.",
      "Do not add phrases like enhanced satisfaction unless clearly supported.",
    ],
    styleHints: [
      "Support bullets should focus on issue handling, response, escalation, documentation, and coordination.",
    ],
  },

  customer_success: {
    keywords: [
      "customer success",
      "client success",
      "onboarding",
      "customer onboarding",
      "client onboarding",
      "account management",
      "account support",
      "renewal",
      "renewals",
      "retention",
      "customer retention",
      "client communication",
      "customer communication",
      "relationship management",
      "customer feedback",
      "churn",
      "csat",
      "nps",
      "qbr",
      "client engagement",
      "customer experience",
    ],
    strongTerms: [
      "customer success",
      "onboarding",
      "account management",
      "renewal",
      "retention",
      "customer feedback",
      "relationship management",
      "csat",
      "nps",
      "qbr",
      "customer experience",
    ],
    businessContextTerms: [
      "client",
      "clients",
      "account",
      "accounts",
      "onboarding",
      "renewal",
      "retention",
      "feedback",
      "engagement",
      "relationship",
      "customer journey",
      "client communication",
    ],
    suggestedKeywords: [
      "customer onboarding",
      "account management",
      "relationship management",
      "customer retention",
      "renewal support",
      "CSAT",
      "NPS",
      "customer lifecycle",
      "client engagement",
      "stakeholder communication",
      "feedback analysis",
      "cross-functional collaboration",
    ],
    preferredVerbs: [
      "managed",
      "supported",
      "guided",
      "coordinated",
      "monitored",
      "maintained",
      "followed up",
      "documented",
      "communicated",
    ],
    safeSupportVerbs: [
      "supported",
      "coordinated",
      "followed up on",
      "maintained",
      "documented",
      "communicated with",
    ],
    keepRules: [
      "Preserve onboarding, retention, account support, and client communication context.",
    ],
    avoidRules: [
      "Do not invent renewals, churn reduction, CSAT improvement, or account growth.",
    ],
    styleHints: [
      "Customer success bullets should sound relationship-focused but factual.",
    ],
  },

  operations: {
    keywords: [
      "operations",
      "operations coordinator",
      "workflow",
      "workflow support",
      "workflow tracking",
      "documentation",
      "reporting",
      "process coordination",
      "process follow-up",
      "process improvement",
      "process optimization",
      "scheduling",
      "calendar management",
      "internal communication",
      "cross-functional coordination",
      "status updates",
      "record keeping",
      "meeting coordination",
      "administrative support",
      "operational tracking",
      "vendor communication",
    ],
    strongTerms: [
      "operations",
      "workflow",
      "documentation",
      "reporting",
      "scheduling",
      "calendar management",
      "process coordination",
      "record keeping",
      "meeting coordination",
      "status updates",
      "workflow tracking",
    ],
    businessContextTerms: [
      "workflow",
      "operations",
      "process",
      "documentation",
      "records",
      "reporting",
      "schedules",
      "meetings",
      "calendars",
      "coordination",
      "status updates",
      "follow-up",
      "administrative",
      "internal communication",
      "team calendars",
    ],
    suggestedKeywords: [
      "process improvement",
      "vendor communication",
      "task prioritization",
      "project management",
      "stakeholder engagement",
      "meeting facilitation",
      "data analysis",
      "time management",
      "team collaboration",
      "performance tracking",
      "resource allocation",
      "strategic planning",
      "budget management",
    ],
    preferredVerbs: [
      "coordinated",
      "prepared",
      "tracked",
      "maintained",
      "scheduled",
      "monitored",
      "organized",
      "updated",
      "reported",
      "documented",
    ],
    safeSupportVerbs: [
      "coordinated",
      "prepared",
      "tracked",
      "maintained",
      "scheduled",
      "monitored",
      "organized",
      "updated",
    ],
    keepRules: [
      "Preserve scheduling, reporting, workflow, coordination, and documentation language.",
      "Keep operations bullets execution-focused and coordination-focused.",
    ],
    avoidRules: [
      "Do not invent leadership, transformation, or strategic ownership.",
      "Do not add fake efficiency, decision-making, or performance impact claims.",
    ],
    styleHints: [
      "Operations bullets should sound organized, execution-focused, and process-aware.",
    ],
  },

  administrative: {
    keywords: [
      "administrative support",
      "administrative assistant",
      "calendar management",
      "scheduling",
      "meeting coordination",
      "document preparation",
      "filing",
      "data entry",
      "office support",
      "record keeping",
      "internal records",
      "reporting documents",
      "office operations",
      "meeting materials",
      "appointments",
    ],
    strongTerms: [
      "calendar management",
      "scheduling",
      "meeting coordination",
      "document preparation",
      "filing",
      "data entry",
      "record keeping",
      "office operations",
      "appointments",
      "administrative support",
    ],
    businessContextTerms: [
      "calendar",
      "calendars",
      "appointments",
      "schedules",
      "documents",
      "records",
      "filing",
      "data entry",
      "meeting materials",
      "administrative",
      "office support",
    ],
    suggestedKeywords: [
      "document management",
      "calendar coordination",
      "meeting scheduling",
      "administrative reporting",
      "record maintenance",
      "internal communication",
      "task coordination",
      "office operations",
      "time management",
      "accuracy",
    ],
    preferredVerbs: [
      "organized",
      "prepared",
      "scheduled",
      "maintained",
      "updated",
      "documented",
      "coordinated",
      "tracked",
      "managed",
    ],
    safeSupportVerbs: [
      "organized",
      "prepared",
      "scheduled",
      "maintained",
      "updated",
      "documented",
      "coordinated",
    ],
    keepRules: [
      "Preserve administrative, scheduling, meeting, document, and record-management context.",
    ],
    avoidRules: [
      "Do not turn admin work into project leadership or business strategy.",
    ],
    styleHints: [
      "Administrative bullets should sound accurate, organized, and execution-oriented.",
    ],
  },

  sales: {
    keywords: [
      "sales",
      "sales support",
      "lead follow-up",
      "lead management",
      "client communication",
      "pipeline",
      "crm",
      "sales reporting",
      "account support",
      "prospect",
      "quote",
      "proposal",
      "deal tracking",
      "order processing",
      "sales coordination",
      "client relationship",
      "sales operations",
    ],
    strongTerms: [
      "sales support",
      "lead follow-up",
      "pipeline",
      "crm",
      "sales reporting",
      "account support",
      "proposal",
      "deal tracking",
      "order processing",
      "sales coordination",
    ],
    businessContextTerms: [
      "sales",
      "lead",
      "leads",
      "pipeline",
      "crm",
      "proposal",
      "quote",
      "client",
      "clients",
      "deal",
      "deals",
      "orders",
      "follow-up",
      "account",
      "accounts",
    ],
    suggestedKeywords: [
      "sales pipeline",
      "lead management",
      "client relationship management",
      "sales reporting",
      "CRM software",
      "deal tracking",
      "account coordination",
      "prospect outreach",
      "sales operations",
      "follow-up management",
    ],
    preferredVerbs: [
      "supported",
      "followed up",
      "maintained",
      "coordinated",
      "prepared",
      "documented",
      "updated",
      "communicated",
      "processed",
    ],
    safeSupportVerbs: [
      "followed up on",
      "maintained",
      "coordinated",
      "prepared",
      "documented",
      "updated",
      "processed",
    ],
    keepRules: [
      "Preserve lead, pipeline, proposal, follow-up, CRM, and account-support context.",
    ],
    avoidRules: [
      "Do not invent revenue, quota attainment, deal closure, or conversion outcomes.",
    ],
    styleHints: [
      "Sales support bullets should stay commercial but factual.",
    ],
  },

  hr: {
    keywords: [
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
    ],
    strongTerms: [
      "recruitment",
      "candidate screening",
      "interview scheduling",
      "employee records",
      "onboarding",
      "offboarding",
      "training coordination",
      "hr administration",
      "compliance",
    ],
    businessContextTerms: [
      "candidate",
      "candidates",
      "interviews",
      "employee",
      "employees",
      "onboarding",
      "policy",
      "training",
      "records",
      "compliance",
      "payroll",
      "hr",
    ],
    suggestedKeywords: [
      "talent acquisition",
      "employee onboarding",
      "HR administration",
      "candidate coordination",
      "interview scheduling",
      "employee documentation",
      "policy compliance",
      "training support",
      "stakeholder communication",
      "record management",
    ],
    preferredVerbs: [
      "screened",
      "scheduled",
      "coordinated",
      "maintained",
      "prepared",
      "documented",
      "supported",
      "updated",
    ],
    safeSupportVerbs: [
      "scheduled",
      "coordinated",
      "maintained",
      "prepared",
      "documented",
      "updated",
      "supported",
    ],
    keepRules: [
      "Preserve screening, scheduling, onboarding, documentation, and compliance context.",
    ],
    avoidRules: [
      "Do not invent hiring outcomes, retention impact, or people leadership.",
    ],
    styleHints: [
      "HR bullets should sound process-focused, documentation-focused, and compliant.",
    ],
  },

  finance: {
    keywords: [
      "financial reporting",
      "reconciliation",
      "accounts payable",
      "accounts receivable",
      "invoice processing",
      "budget tracking",
      "expense reporting",
      "forecasting",
      "variance analysis",
      "financial analysis",
      "ledger",
      "audit support",
      "excel",
    ],
    strongTerms: [
      "financial reporting",
      "reconciliation",
      "accounts payable",
      "accounts receivable",
      "invoice processing",
      "budget tracking",
      "variance analysis",
      "audit support",
      "ledger",
      "financial analysis",
    ],
    businessContextTerms: [
      "invoice",
      "invoices",
      "reconciliation",
      "budget",
      "expense",
      "forecast",
      "variance",
      "audit",
      "ledger",
      "financial reporting",
      "accounts payable",
      "accounts receivable",
    ],
    suggestedKeywords: [
      "financial analysis",
      "budget management",
      "invoice reconciliation",
      "expense tracking",
      "variance reporting",
      "audit preparation",
      "accounts management",
      "forecast support",
      "financial accuracy",
      "Excel reporting",
    ],
    preferredVerbs: [
      "prepared",
      "reconciled",
      "processed",
      "tracked",
      "maintained",
      "documented",
      "reported",
      "reviewed",
    ],
    safeSupportVerbs: [
      "prepared",
      "reconciled",
      "processed",
      "tracked",
      "maintained",
      "documented",
      "reported",
    ],
    keepRules: [
      "Preserve invoices, reconciliation, reporting, budget tracking, and audit context.",
    ],
    avoidRules: [
      "Do not invent savings, margin impact, financial results, or budget ownership.",
    ],
    styleHints: [
      "Finance bullets should sound accurate, controlled, and reporting-focused.",
    ],
  },

  project: {
    keywords: [
      "project coordination",
      "project management",
      "timelines",
      "deliverables",
      "status tracking",
      "meeting coordination",
      "stakeholder updates",
      "project support",
      "milestones",
      "project documentation",
    ],
    strongTerms: [
      "project coordination",
      "project management",
      "timelines",
      "deliverables",
      "status tracking",
      "milestones",
      "project documentation",
    ],
    businessContextTerms: [
      "project",
      "projects",
      "timelines",
      "deliverables",
      "milestones",
      "status updates",
      "stakeholders",
      "project support",
      "coordination",
    ],
    suggestedKeywords: [
      "stakeholder communication",
      "project tracking",
      "timeline management",
      "deliverable coordination",
      "status reporting",
      "cross-functional support",
      "risk tracking",
      "resource coordination",
      "meeting facilitation",
      "documentation management",
    ],
    preferredVerbs: [
      "coordinated",
      "tracked",
      "prepared",
      "updated",
      "documented",
      "scheduled",
      "monitored",
      "maintained",
    ],
    safeSupportVerbs: [
      "coordinated",
      "tracked",
      "prepared",
      "updated",
      "documented",
      "scheduled",
    ],
    keepRules: [
      "Preserve timeline, deliverable, status-tracking, and stakeholder-update context.",
    ],
    avoidRules: [
      "Do not invent ownership, delivery success, risk reduction, or project leadership.",
    ],
    styleHints: [
      "Project support bullets should stay coordination-heavy and timeline-aware.",
    ],
  },

  data: {
    keywords: [
      "data analysis",
      "analytics",
      "dashboard",
      "reporting",
      "looker studio",
      "data studio",
      "kpi",
      "performance metrics",
      "analysis",
      "report generation",
      "trend analysis",
    ],
    strongTerms: [
      "data analysis",
      "analytics",
      "dashboard",
      "reporting",
      "kpi",
      "performance metrics",
      "trend analysis",
      "data studio",
      "looker studio",
    ],
    businessContextTerms: [
      "data",
      "analytics",
      "dashboard",
      "reporting",
      "metrics",
      "kpi",
      "analysis",
      "trends",
      "performance",
    ],
    suggestedKeywords: [
      "data analysis",
      "analytics reporting",
      "dashboard maintenance",
      "trend analysis",
      "KPI tracking",
      "Excel reporting",
      "data accuracy",
      "performance analysis",
      "report generation",
      "insight development",
    ],
    preferredVerbs: [
      "analyzed",
      "tracked",
      "reported",
      "prepared",
      "maintained",
      "reviewed",
      "monitored",
      "documented",
    ],
    safeSupportVerbs: [
      "analyzed",
      "tracked",
      "reported",
      "prepared",
      "maintained",
      "reviewed",
    ],
    keepRules: [
      "Preserve analytics, dashboard, reporting, metrics, and trend-analysis context.",
    ],
    avoidRules: [
      "Do not invent insights, business impact, performance lift, or KPI improvements.",
    ],
    styleHints: [
      "Data bullets should sound measurable and reporting-aware without inventing results.",
    ],
  },

  generic: {
    keywords: [],
    strongTerms: [
      "reporting",
      "documentation",
      "coordination",
      "analysis",
      "communication",
      "scheduling",
      "records",
      "tracking",
      "support",
    ],
    businessContextTerms: [
      "reporting",
      "documentation",
      "coordination",
      "analysis",
      "communication",
      "scheduling",
      "records",
      "tracking",
      "support",
    ],
    suggestedKeywords: [
      "reporting",
      "documentation",
      "cross-functional collaboration",
      "process improvement",
      "stakeholder communication",
      "data tracking",
      "problem-solving",
      "time management",
      "team coordination",
      "task management",
    ],
    preferredVerbs: [
      "coordinated",
      "prepared",
      "tracked",
      "maintained",
      "documented",
      "updated",
      "monitored",
      "organized",
    ],
    safeSupportVerbs: [
      "coordinated",
      "prepared",
      "tracked",
      "maintained",
      "documented",
      "updated",
    ],
    keepRules: [
      "Keep bullets concise, truthful, and execution-focused.",
    ],
    avoidRules: [
      "Do not force role-specific jargon unless clearly supported by the resume.",
    ],
    styleHints: [
      "Prefer grounded recruiter language over corporate fluff.",
    ],
  },
};

const ALL_ROLE_TERMS = uniqueTrimmedStrings(
  Object.values(ROLE_PACKS).flatMap((p) => [...(p.keywords || []), ...(p.strongTerms || [])])
);

const ALL_BUSINESS_CONTEXT_TERMS = uniqueTrimmedStrings(
  Object.values(ROLE_PACKS).flatMap((p) => p.businessContextTerms || [])
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
  "ppc",
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
  "csat",
  "nps",
  "qbr",
  "excel",
  "google sheets",
  "powerpoint",
  "accounts payable",
  "accounts receivable",
  "invoice processing",
  "variance analysis",
  "audit support",
]);

const GLOBAL_STRONG_SPECIFIC_RE = buildPhraseRegex([...ALL_ROLE_TERMS, ...HARD_FACT_TERMS]);
const GLOBAL_BUSINESS_CONTEXT_RE = buildPhraseRegex(ALL_BUSINESS_CONTEXT_TERMS);

const WEAK_SENTENCE_RE =
  /\b(ilgilendim|bulundum|görev aldım|destek oldum|destek verdim|katkı sağladım|yardımcı oldum|sorumluydum|takip ettim|worked on|handled|supported|assisted|helped|was responsible for|contributed to|involved in|participated in)\b/i;

const WEAK_START_RE =
  /^(helped|assisted|supported|worked on|contributed to|participated in|involved in|handled|yardımcı oldum|destek verdim|destek oldum|görev aldım|ilgilen(dim|di)|bulundum)\b/i;

const WEAK_PHRASE_RE =
  /\b(helped|assisted|supported|involved in|responsible for|contributed to|worked on|played a key role in|participated in|handled|supported the team|took part in|ilgilendim|bulundum|baktım|yardım ettim|yardımcı oldum|destek verdim|destek oldum|katkı sağladım|görev aldım)\b/i;

const STRONG_ACTION_RE =
  /\b(yönettim|yürüttüm|koordine ettim|hazırladım|analiz ettim|raporladım|geliştirdim|oluşturdum|uyguladım|organize ettim|takip ettim|düzenledim|gerçekleştirdim|izledim|optimize ettim|tasarladım|planladım|uyarladım|sundum|segmentasyonu yaptım|managed|developed|coordinated|prepared|analyzed|reported|organized|implemented|tracked|maintained|optimized|planned|executed|designed|launched|created|responded|resolved|documented|scheduled|reviewed|updated|monitored|processed|reconciled|screened)\b/i;

const EN_WEAK_REWRITE_START_RE =
  /^(?:actively\s+)?(?:helped|assisted|supported|contributed|participated|aided|facilitated)\b/i;

const EN_SOFT_FILLER_RE =
  /\b(aimed at|focused on|with a focus on|designed to|to improve|to enhance|to strengthen|to maximize|to optimize|to drive|to facilitate|to promote|to ensure|to support decision-making|to improve service quality|to enhance engagement)\b/i;

const EN_UNSUPPORTED_IMPACT_RE =
  /\b(drive measurable results|resulting in|increased conversion rates|qualified leads|competitive positioning|data-driven decision-making|stronger market presence|better campaign outcomes|improved follow-up|deliver(?:ed|ing)? exceptional service|enhance(?:d|s|ing)? client relationships|increase(?:d|ing)? participation rates|boost(?:ed|ing)? customer loyalty|enhance(?:d|s|ing)? service satisfaction|improve(?:d|s|ing)? operational efficiency)\b/i;

const ENGLISH_RISKY_RESULT_RE =
  /\b(resulting in|driving|boosting|enhancing|improving|increasing|streamlining|ensuring|maximizing|delivering|aimed at|focused on|designed to)\b/i;

const ENGLISH_WEAK_SWAP_RE =
  /\b(assisted|contributed|participated|supported|helped)\b/i;

const ENGLISH_CORPORATE_FLUFF_RE =
  /\b(dynamic|robust|seamless|impactful|high-impact|comprehensive|various|overall|strategic initiatives|in-depth data analysis|for consistency|for team accessibility|to ensure data accuracy|to ensure accuracy and relevance|to streamline communication efforts|to support informed marketing strategies|to enhance engagement|to optimize user experience|operational excellence|decision-making|stakeholder alignment)\b/i;

function countTermHits(text = "", terms = []) {
  const norm = normalizeCompareText(text);
  return uniqueTrimmedStrings(terms).filter((term) =>
    norm.includes(normalizeCompareText(term))
  ).length;
}

function inferRoleGroups(cv = "", jd = "") {
  const combined = `${cv || ""}\n${jd || ""}`;
  const scored = Object.entries(ROLE_PACKS)
    .filter(([key]) => key !== "generic")
    .map(([key, pack]) => {
      const keywordHits = countTermHits(combined, pack.keywords || []);
      const strongHits = countTermHits(combined, pack.strongTerms || []);
      const businessHits = countTermHits(combined, pack.businessContextTerms || []);
      const score = keywordHits * 3 + strongHits * 3 + Math.min(4, businessHits);
      return { key, score, keywordHits, strongHits, businessHits };
    })
    .filter((x) => x.score > 0)
    .sort((a, b) => b.score - a.score);

  if (!scored.length) return ["generic"];

  const selected = [];
  const top = scored[0].score;

  for (const item of scored) {
    if (!selected.length) {
      selected.push(item.key);
      continue;
    }

    if (selected.length >= 3) break;
    if (item.score >= Math.max(5, top - 3) || item.keywordHits >= 2 || item.strongHits >= 2) {
      selected.push(item.key);
    }
  }

  return selected.length ? selected : ["generic"];
}

function getPrimaryRoleKey(roleGroups = []) {
  const arr = Array.isArray(roleGroups) && roleGroups.length ? roleGroups : ["generic"];
  return arr[0] || "generic";
}

function getRolePacks(roleGroups = []) {
  const keys = Array.isArray(roleGroups) && roleGroups.length ? roleGroups : ["generic"];
  const packs = keys
    .map((k) => ROLE_PACKS[k])
    .filter(Boolean);

  return packs.length ? packs : [ROLE_PACKS.generic];
}

function getRoleSpecificityRegex(roleGroups = []) {
  const terms = uniqueTrimmedStrings(
    getRolePacks(roleGroups).flatMap((p) => [...(p.keywords || []), ...(p.strongTerms || [])])
  );
  return buildPhraseRegex(terms);
}

function getRoleBusinessContextRegex(roleGroups = []) {
  const terms = uniqueTrimmedStrings(
    getRolePacks(roleGroups).flatMap((p) => p.businessContextTerms || [])
  );
  return buildPhraseRegex(terms);
}

function getSuggestedKeywords(roleGroups = []) {
  const terms = uniqueTrimmedStrings(
    getRolePacks(roleGroups).flatMap((p) => p.suggestedKeywords || [])
  );
  return terms.slice(0, 20);
}

function buildRoleContextText(roleGroups = []) {
  const keys = Array.isArray(roleGroups) && roleGroups.length ? roleGroups : ["generic"];
  return keys
    .map((key, idx) => {
      const pack = ROLE_PACKS[key] || ROLE_PACKS.generic;
      const label = idx === 0 ? "primary_role" : `secondary_role_${idx}`;
      const sample = uniqueTrimmedStrings([
        ...(pack.strongTerms || []),
        ...(pack.businessContextTerms || []),
      ]).slice(0, 10);
      return `- ${label}: ${key}\n  role signals: ${sample.join(", ") || "(none)"}`;
    })
    .join("\n");
}

function buildRoleWritingBlock(roleGroups = []) {
  const primaryKey = getPrimaryRoleKey(roleGroups);
  const packs = getRolePacks(roleGroups);

  const preferredVerbs = uniqueTrimmedStrings(
    packs.flatMap((p) => [...(p.preferredVerbs || []), ...(p.safeSupportVerbs || [])])
  ).slice(0, 20);

  const keepRules = uniqueTrimmedStrings(
    packs.flatMap((p) => p.keepRules || [])
  ).slice(0, 8);

  const avoidRules = uniqueTrimmedStrings(
    packs.flatMap((p) => p.avoidRules || [])
  ).slice(0, 8);

  const styleHints = uniqueTrimmedStrings(
    packs.flatMap((p) => p.styleHints || [])
  ).slice(0, 8);

  return `
ROLE WRITING RULES:
- Primary role family: ${primaryKey}
- Preserve these role signals when present:
${keepRules.length ? keepRules.map((x) => `  - ${x}`).join("\n") : "  - (none)"}
- Prefer truthful verbs such as:
  ${preferredVerbs.join(", ") || "coordinated, prepared, tracked, maintained"}
- Avoid these rewrite patterns:
${avoidRules.length ? avoidRules.map((x) => `  - ${x}`).join("\n") : "  - (none)"}
- Additional role guidance:
${styleHints.length ? styleHints.map((x) => `  - ${x}`).join("\n") : "  - Keep the writing grounded and recruiter-friendly."}
`.trim();
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

  if (rWords >= sWords + 10 && sim >= 0.58) return true;
  return false;
}

function isClearlyWeakSentence(sentence = "", roleGroups = []) {
  const s = String(sentence || "").trim();
  if (!s) return false;

  const roleSpecificRe = getRoleSpecificityRegex(roleGroups);
  const roleBusinessRe = getRoleBusinessContextRegex(roleGroups);

  const hasSpecific =
    GLOBAL_STRONG_SPECIFIC_RE.test(s) ||
    roleSpecificRe.test(s) ||
    roleBusinessRe.test(s) ||
    GLOBAL_BUSINESS_CONTEXT_RE.test(s);

  const startsWeak = WEAK_START_RE.test(s);
  const wordCount = s.split(/\s+/).filter(Boolean).length;

  if (startsWeak && !hasSpecific) return true;
  if (startsWeak && hasSpecific) return true;
  if (WEAK_SENTENCE_RE.test(s) && !hasSpecific) return true;
  if (!hasSpecific && wordCount <= 8) return true;

  if (
    !hasSpecific &&
    /\b(yaptım|ettim|hazırladım|bulundum|baktım|ilgilen(dim|di)|worked on|helped with|assisted in)\b/i.test(s)
  ) {
    return true;
  }

  return false;
}

function filterWeakSentences(items = [], { outLang = "", roleGroups = [] } = {}) {
  return (Array.isArray(items) ? items : [])
    .map((x) => ({
      sentence: String(x?.sentence || "").trim(),
      rewrite: String(x?.rewrite || "").trim(),
    }))
    .filter((x) => x.sentence && x.rewrite)
    .filter((x) => normalizeCompareText(x.sentence) !== normalizeCompareText(x.rewrite))
    .filter((x) => isClearlyWeakSentence(x.sentence, roleGroups))
    .filter((x) => !isShallowRewrite(x.sentence, x.rewrite))
    .filter((x) => {
      if (outLang !== "English") return true;

      if (EN_WEAK_REWRITE_START_RE.test(x.rewrite)) return false;
      if (ENGLISH_WEAK_SWAP_RE.test(x.rewrite)) return false;
      if (hasUnsupportedImpactClaims(x.sentence, x.rewrite)) return false;
      if (ENGLISH_CORPORATE_FLUFF_RE.test(x.rewrite) && !ENGLISH_CORPORATE_FLUFF_RE.test(x.sentence)) {
        return false;
      }
      if (EN_SOFT_FILLER_RE.test(x.rewrite) && !EN_SOFT_FILLER_RE.test(x.sentence)) {
        return false;
      }

      return true;
    })
    .slice(0, 12);
}

function normalizeBulletUpgrades(items = [], outLang = "") {
  const seen = new Set();
  const out = [];

  for (const item of Array.isArray(items) ? items : []) {
    const source = String(item?.source || item?.sentence || "").trim();
    const rewrite = String(item?.rewrite || item?.after || "").trim();
    const reason = String(item?.reason || "").trim();

    if (!source || !rewrite) continue;
    if (isShallowRewrite(source, rewrite)) continue;

    if (outLang === "English") {
      if (EN_WEAK_REWRITE_START_RE.test(rewrite)) continue;
      if (ENGLISH_WEAK_SWAP_RE.test(rewrite)) continue;
      if (hasUnsupportedImpactClaims(source, rewrite)) continue;
      if (ENGLISH_CORPORATE_FLUFF_RE.test(rewrite) && !ENGLISH_CORPORATE_FLUFF_RE.test(source)) continue;
      if (EN_SOFT_FILLER_RE.test(rewrite) && !EN_SOFT_FILLER_RE.test(source)) continue;
    }

    const key = `${normalizeCompareText(source)}__${normalizeCompareText(rewrite)}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({ source, rewrite, reason });
  }

  return out.slice(0, 8);
}

function buildPriorityRewriteText(bulletUpgrades = []) {
  const items = Array.isArray(bulletUpgrades) ? bulletUpgrades : [];
  if (!items.length) return "(none)";

  return items
    .map((item, idx) => {
      const reasonLine = item.reason ? `\n  why: ${item.reason}` : "";
      return `${idx + 1}. source: ${item.source}\n  stronger rewrite target: ${item.rewrite}${reasonLine}`;
    })
    .join("\n\n");
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

function hasUnsupportedImpactClaims(originalText = "", candidateText = "") {
  const orig = String(originalText || "");
  const opt = String(candidateText || "");
  return EN_UNSUPPORTED_IMPACT_RE.test(opt) && !EN_UNSUPPORTED_IMPACT_RE.test(orig);
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

    const origSoft = EN_SOFT_FILLER_RE.test(orig);
    const optSoft = EN_SOFT_FILLER_RE.test(opt);
    if (!origSoft && optSoft) hits += 1;
  }

  return hits;
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

function getKeywordBreadthScore(cv = "", jd = "", roleGroups = []) {
  const text = normalizeCompareText(cv);
  const skills = uniqueTrimmedStrings(getSkillsLines(cv));
  const packs = getRolePacks(roleGroups);

  let score = 0;
  score += Math.min(8, skills.length);

  const relevantTerms = uniqueTrimmedStrings(
    packs.flatMap((p) => [...(p.strongTerms || []), ...(p.businessContextTerms || [])])
  );

  const relevantHits = relevantTerms.filter((term) =>
    text.includes(normalizeCompareText(term))
  ).length;
  score += Math.min(5, relevantHits);

  const keywordHints = getSuggestedKeywords(roleGroups);
  const hintHits = keywordHints.filter((term) =>
    text.includes(normalizeCompareText(term))
  ).length;
  score += Math.min(2, hintHits);

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

function getBulletStrengthScore(cv = "", roleGroups = []) {
  const bullets = getBulletLines(cv);
  if (!bullets.length) return 0;

  const roleSpecificRe = getRoleSpecificityRegex(roleGroups);
  const roleBusinessRe = getRoleBusinessContextRegex(roleGroups);

  let score = 8;
  let weakCount = 0;
  let strongCount = 0;
  let specificityCount = 0;
  let solidLengthCount = 0;

  for (const bullet of bullets) {
    const wc = countWords(bullet);

    if (WEAK_PHRASE_RE.test(bullet)) weakCount += 1;
    if (STRONG_ACTION_RE.test(bullet)) strongCount += 1;
    if (
      GLOBAL_STRONG_SPECIFIC_RE.test(bullet) ||
      roleSpecificRe.test(bullet) ||
      roleBusinessRe.test(bullet) ||
      GLOBAL_BUSINESS_CONTEXT_RE.test(bullet)
    ) {
      specificityCount += 1;
    }
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

function computeDeterministicAtsScore(cv = "", jd = "", roleGroups = []) {
  const hasJD = !!String(jd || "").trim();

  const sectionScore = getSectionPresenceScore(cv);
  const bulletScore = getBulletStrengthScore(cv, roleGroups);
  const readabilityScore = getReadabilityScore(cv);
  const keywordScore = getKeywordBreadthScore(cv, jd, roleGroups);
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

  const roleGroups = inferRoleGroups(originalCv, jd);
  const rescoredOptimized = computeDeterministicAtsScore(optimizedCv, jd, roleGroups);
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
  weakSentences = [],
  roleGroups = []
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

  const roleSpecificRe = getRoleSpecificityRegex(roleGroups);
  const origSpecific = getBulletLines(originalCv).filter((b) => roleSpecificRe.test(b)).length;
  const optSpecific = getBulletLines(optimizedCv).filter((b) => roleSpecificRe.test(b)).length;

  if (origSpecific > 0 && optSpecific + 1 < origSpecific) return true;

  return false;
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
        maxCompletionTokens: Math.max(maxCompletionTokens, 3600),
      },
      {
        reasoningEffort: "low",
        temperature: null,
        maxCompletionTokens: Math.max(maxCompletionTokens, 4600),
      },
    ];
  }

  if (passType === "repair") {
    return [
      {
        reasoningEffort: "low",
        temperature: null,
        maxCompletionTokens: Math.max(maxCompletionTokens, 3800),
      },
      {
        reasoningEffort: "none",
        temperature: 0.2,
        maxCompletionTokens: Math.max(maxCompletionTokens, 4400),
      },
    ];
  }

  if (passType === "bullet") {
    return [
      {
        reasoningEffort: "low",
        temperature: null,
        maxCompletionTokens: Math.max(maxCompletionTokens, 1600),
      },
      {
        reasoningEffort: "none",
        temperature: 0.2,
        maxCompletionTokens: Math.max(maxCompletionTokens, 2200),
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
      maxCompletionTokens: Math.max(maxCompletionTokens, 2400),
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
- Do NOT invent or assume ANY numbers, percentages, time periods, client names, revenue, KPIs, team size, budget, results, ownership level, or business impact.
- Only use metrics, tools, platforms, and facts explicitly present in the resume and optional job description.
- Never turn a specific sentence into a more generic sentence.
- Never remove useful specificity such as tools, metrics, platforms, channels, business context, or process context.
- If a bullet has no measurable metric, improve it using scope + action + context + purpose wording WITHOUT inventing numbers.
- If the original sentence is support-oriented, you may strengthen clarity, but do NOT upgrade it into leadership or full ownership unless clearly supported.
- Weak sentence detection must prioritize genuinely weak, vague, generic, or support-heavy phrasing.
- Do NOT flag already-strong sentences as weak just because they can be polished slightly.
- Sentences that already contain concrete tools, platforms, metrics, or strong action verbs should usually NOT be selected as weak unless they are still clearly support-heavy and can be improved without losing specificity.
- Rewrites must be materially better than the original.
- Do NOT make shallow synonym swaps or near-duplicate rewrites.
- Each rewrite must improve at least two of these:
  clarity, specificity, scope, action strength, business context, recruiter readability.
- If a rewrite is too similar to the original, rewrite it again more strongly.
- Keep optimized_cv ATS-friendly, clean, realistic, and parser-friendly.
- For English output, write like a strong US resume writer, not a marketing copywriter.
- Premium quality means: grounded, concise, specific, and recruiter-ready.

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
- Only use metrics, tools, platforms, and facts explicitly present in the resume and optional job description.
- If a bullet has no measurable metric, rewrite it using: scope + actions + tools + context + neutral outcome wording WITHOUT numbers.
- Never write “increased by X%”, “grew by X”, “reduced by X%”, “saved $X”, “managed $X budget”, “served X clients”, “led X people” unless those exact facts appear in the input text.
- If unsure, prefer neutral phrasing with no numbers.
- If the input contains a number, keep it exact; do not round up/down or change it.
- Do NOT invent employers, titles, degrees, dates, certifications, or metrics.
- Do NOT replace generic platform language with a specific platform unless it is explicitly present.
- Return ONLY valid JSON. No markdown. No extra text.
- All output VALUES MUST be written ONLY in ${outLang}. Do not mix languages.
`.trim();
}

function buildEnglishStyleBlock(roleGroups = []) {
  const roleWritingBlock = buildRoleWritingBlock(roleGroups);
  return `
ENGLISH WRITING STYLE:
- Write like a strong US resume, not marketing copy.
- Keep bullets concise, concrete, and natural.
- Prefer 9-18 words per bullet when possible.
- Prefer one clear pattern: action + scope + tool/channel/context + purpose.
- If no tool is present, use action + task scope + business/process context.
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
  coordinated, prepared, tracked, documented, maintained, scheduled, monitored, updated, processed, collaborated with.
- Keep already-strong bullets short and sharp.
- Do NOT over-expand bullets just to sound more professional.
- Avoid corporate fluff and vague business-impact endings.

${roleWritingBlock}
`.trim();
}

function buildPreviewAtsPrompt({ cv, jd, hasJD, outLang, roleGroups }) {
  const englishStyleBlock = outLang === "English" ? buildEnglishStyleBlock(roleGroups) : "";
  const roleContextText = buildRoleContextText(roleGroups);

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
- Do NOT select already-strong sentences that already contain concrete tools, platforms, or metrics unless the sentence is still clearly support-heavy and can be improved without losing specificity.
- Prefer weak experience bullets first, then summary only if necessary.
- Rewrites must be clearly stronger, not cosmetic.
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
- Do NOT select already-strong sentences that already contain concrete tools, platforms, or metrics unless the sentence is still clearly support-heavy and can be improved without losing specificity.
- Prefer weak experience bullets first, then summary only if necessary.
- Rewrites must be clearly stronger, not cosmetic.
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

function buildFullAtsAnalysisPrompt({ cv, jd, hasJD, outLang, roleGroups }) {
  const englishStyleBlock = outLang === "English" ? buildEnglishStyleBlock(roleGroups) : "";
  const roleContextText = buildRoleContextText(roleGroups);

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
- Keep claims truthful. Do not invent employers, degrees, titles, dates, tools, metrics, acronyms, platforms, or unsupported outcomes.

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
- Keep claims truthful. Do not invent employers, degrees, titles, dates, tools, metrics, acronyms, platforms, or unsupported outcomes.

ROLE CONTEXT:
${roleContextText}

${englishStyleBlock}

RESUME:
${cv}
`.trim();
}

function buildTargetedBulletUpgradePrompt({
  cv,
  jd,
  hasJD,
  weakSentences,
  outLang,
  roleGroups,
}) {
  const englishStyleBlock = outLang === "English" ? buildEnglishStyleBlock(roleGroups) : "";
  const roleContextText = buildRoleContextText(roleGroups);
  const weakText = (Array.isArray(weakSentences) ? weakSentences : [])
    .map((item, idx) => `${idx + 1}. ${String(item?.sentence || "").trim()}`)
    .filter(Boolean)
    .join("\n");

  return hasJD
    ? `
Return JSON in this exact schema:

{
  "bullet_upgrades": [
    { "source": string, "rewrite": string, "reason": string }
  ]
}

TASK:
Create premium-quality bullet rewrites ONLY for the provided weak resume sentences.

STRICT RULES:
- Rewrite ONLY the listed source sentences.
- Keep each rewrite truthful, ATS-friendly, and recruiter-ready.
- Do NOT invent numbers, results, tools, platforms, budgets, clients, ownership, or business impact.
- If the original is support-level work, keep it support-level but make it sharper and more specific.
- Each rewrite must be materially stronger than the source, not a synonym swap.
- For English output, target roughly 9-18 words when possible.
- Prefer this structure when truthful:
  action + task scope + tool/channel/context + purpose
- reason must be short and explain what improved.
- Output VALUES only in ${outLang}.
- Return 3-8 items depending on real quality opportunities.
- No extra keys.

ROLE CONTEXT:
${roleContextText}

${englishStyleBlock}

WEAK SOURCE SENTENCES:
${weakText || "(none)"}

RESUME:
${cv}

JOB DESCRIPTION:
${jd}
`.trim()
    : `
Return JSON in this exact schema:

{
  "bullet_upgrades": [
    { "source": string, "rewrite": string, "reason": string }
  ]
}

TASK:
Create premium-quality bullet rewrites ONLY for the provided weak resume sentences.

STRICT RULES:
- Rewrite ONLY the listed source sentences.
- Keep each rewrite truthful, ATS-friendly, and recruiter-ready.
- Do NOT invent numbers, results, tools, platforms, budgets, clients, ownership, or business impact.
- If the original is support-level work, keep it support-level but make it sharper and more specific.
- Each rewrite must be materially stronger than the source, not a synonym swap.
- For English output, target roughly 9-18 words when possible.
- Prefer this structure when truthful:
  action + task scope + tool/channel/context + purpose
- reason must be short and explain what improved.
- Output VALUES only in ${outLang}.
- Return 3-8 items depending on real quality opportunities.
- No extra keys.

ROLE CONTEXT:
${roleContextText}

${englishStyleBlock}

WEAK SOURCE SENTENCES:
${weakText || "(none)"}

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
  bulletUpgrades,
  outLang,
  roleGroups,
}) {
  const keywordsText = Array.isArray(missingKeywords) ? missingKeywords.join(", ") : "";
  const allowedTermsText = buildAllowedTermsText(cv, jd);
  const englishStyleBlock = outLang === "English" ? buildEnglishStyleBlock(roleGroups) : "";
  const roleContextText = buildRoleContextText(roleGroups);
  const priorityRewriteText = buildPriorityRewriteText(bulletUpgrades);

  return hasJD
    ? `
Return JSON in this exact schema:

{
  "optimized_cv": string
}

TASK:
Rewrite the resume into a materially stronger ATS-friendly version aligned to the same job description.

STRICT RULES:
- Keep the header identity block exactly as written.
- Keep existing experience titles unchanged.
- Keep exact dates, employers, titles, education, certifications, and explicit experience durations unchanged.
- Do NOT invent numbers, tools, platforms, acronyms, KPIs, budgets, achievements, channels, software, ownership, or outcomes.
- Do NOT replace generic platform language with specific platforms unless explicitly present in the resume.
- If the original text is support-oriented, you may make it clearer and sharper, but do NOT upgrade it into full ownership unless clearly supported.
- Use the analysis summary to improve wording truthfully.
- Treat missing keywords as context only. NEVER force JD keywords into the resume unless the underlying work is already supported by the original resume text.
- Keep already-strong bullets unchanged or only lightly polish them.
- Focus most of the rewrite effort on weaker summary lines and weaker/support-heavy bullets.
- Preserve the role structure and bullet structure as much as possible.
- Do NOT merge multiple bullets into one if that removes detail.
- Do NOT remove meaningful bullets unless they are duplicate or clearly redundant.
- Use canonical section headings only.
- The final resume should feel premium: concise, grounded, specific, and clearly stronger than the original.

ROLE CONTEXT:
${roleContextText}

ALLOWED EXPLICIT TOOLS / PLATFORMS / ACRONYMS:
${allowedTermsText}

HARD FACT LOCK:
- You may use only tools, platforms, acronyms, channels, and business concepts explicitly present in the resume.
- JD context can guide emphasis, but it cannot introduce new work history facts.
- If a term is not explicitly supported by the original resume, do NOT add it.
- This includes unsupported additions like new platforms, new tools, new KPIs, new results, new ownership, or new business impact claims.

PRIORITY REWRITE TARGETS:
${priorityRewriteText}

HOW TO USE THE PRIORITY REWRITE TARGETS:
- Treat each rewrite target as the minimum quality bar for that source sentence.
- You may adapt wording to fit the full resume, but the final bullet should be at least as strong, specific, and truthful.
- Do NOT copy low-quality original wording when a stronger target is provided.

${englishStyleBlock}

QUALITY TARGET:
- Upgrade weak bullets using clarity + scope + business/process context.
- Preserve specific tools, metrics, and channels already present.
- Avoid bloated endings, corporate fluff, and fake impact wording.
- Keep the resume realistic, premium, and ATS-friendly.

ANALYSIS SUMMARY:
${summary || "(none)"}

HIGH PRIORITY KEYWORD GAPS (context only, do not force):
${keywordsText || "(none)"}

SELF-CHECK BEFORE RETURNING:
- no unsupported tools/platforms/acronyms added
- no invented achievements/results/ownership added
- no unjustified leadership escalation
- no major bullet loss
- no merged bullets that reduce clarity
- weak bullets materially improved, not cosmetically polished

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
Rewrite the resume into a materially stronger ATS-friendly version.

STRICT RULES:
- Keep the header identity block exactly as written.
- Keep existing experience titles unchanged.
- Keep exact dates, employers, titles, education, certifications, and explicit experience durations unchanged.
- Do NOT invent numbers, tools, platforms, acronyms, KPIs, budgets, achievements, channels, software, ownership, or outcomes.
- Do NOT replace generic platform language with specific platforms unless explicitly present in the resume.
- If the original text is support-oriented, you may make it clearer and sharper, but do NOT upgrade it into full ownership unless clearly supported.
- Use the analysis summary to improve wording truthfully.
- Treat missing keywords as context only. Do NOT force keywords into the resume unless the underlying work is already supported by the original resume text.
- Keep already-strong bullets unchanged or only lightly polish them.
- Focus most of the rewrite effort on weaker summary lines and weaker/support-heavy bullets.
- Preserve the role structure and bullet structure as much as possible.
- Do NOT merge multiple bullets into one if that removes detail.
- Do NOT remove meaningful bullets unless they are duplicate or clearly redundant.
- Use canonical section headings only.
- The final resume should feel premium: concise, grounded, specific, and clearly stronger than the original.

ROLE CONTEXT:
${roleContextText}

ALLOWED EXPLICIT TOOLS / PLATFORMS / ACRONYMS:
${allowedTermsText}

HARD FACT LOCK:
- You may use only tools, platforms, acronyms, channels, and business concepts explicitly present in the resume.
- If a term is not explicitly supported by the original resume, do NOT add it.
- This includes unsupported additions like new platforms, new tools, new KPIs, new results, new ownership, or new business impact claims.

PRIORITY REWRITE TARGETS:
${priorityRewriteText}

HOW TO USE THE PRIORITY REWRITE TARGETS:
- Treat each rewrite target as the minimum quality bar for that source sentence.
- You may adapt wording to fit the full resume, but the final bullet should be at least as strong, specific, and truthful.
- Do NOT copy low-quality original wording when a stronger target is provided.

${englishStyleBlock}

QUALITY TARGET:
- Upgrade weak bullets using clarity + scope + business/process context.
- Preserve specific tools, metrics, and channels already present.
- Avoid bloated endings, corporate fluff, and fake impact wording.
- Keep the resume realistic, premium, and ATS-friendly.

ANALYSIS SUMMARY:
${summary || "(none)"}

HIGH PRIORITY KEYWORD GAPS (context only, do not force):
${keywordsText || "(none)"}

SELF-CHECK BEFORE RETURNING:
- no unsupported tools/platforms/acronyms added
- no invented achievements/results/ownership added
- no unjustified leadership escalation
- no major bullet loss
- no merged bullets that reduce clarity
- weak bullets materially improved, not cosmetically polished

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
  bulletUpgrades,
  unsupportedTerms = [],
  outLang,
  roleGroups,
}) {
  const keywordsText = Array.isArray(missingKeywords) ? missingKeywords.join(", ") : "";
  const allowedTermsText = buildAllowedTermsText(cv, jd);
  const englishStyleBlock = outLang === "English" ? buildEnglishStyleBlock(roleGroups) : "";
  const unsupportedText =
    Array.isArray(unsupportedTerms) && unsupportedTerms.length
      ? unsupportedTerms.join(", ")
      : "(none)";
  const roleContextText = buildRoleContextText(roleGroups);
  const priorityRewriteText = buildPriorityRewriteText(bulletUpgrades);

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
- Do NOT invent metrics, tools, platforms, acronyms, channels, achievements, ownership, or business impact.
- Do NOT replace generic platform language with specific platforms unless explicitly present in the original resume.
- Do NOT upgrade support-oriented work into full ownership unless clearly supported.
- Keep already-strong bullets strong.
- Focus the rewrite effort on weaker/support-heavy bullets and awkward summary lines.
- Preserve bullet count and structure as much as possible.
- Do NOT merge multiple bullets into one if that removes detail.
- Use canonical section headings only.

ROLE CONTEXT:
${roleContextText}

ALLOWED EXPLICIT TOOLS / PLATFORMS / ACRONYMS:
${allowedTermsText}

REMOVE THESE UNSUPPORTED TERMS IF PRESENT:
${unsupportedText}

PRIORITY REWRITE TARGETS:
${priorityRewriteText}

HARD FACT LOCK:
- You may use only tools, platforms, acronyms, channels, and business concepts explicitly present in the original resume.
- JD context can guide emphasis, but it cannot introduce new work history facts.
- Missing keywords are context only. Do NOT add a keyword unless the work is already supported by the original resume.
- If a term is not explicitly supported, remove it.

${englishStyleBlock}

QUALITY TARGET:
- The final output should feel premium and clearly stronger than the original.
- Do NOT keep weak generic bullets if they can be rewritten more clearly and specifically.
- Do NOT flatten already-good bullets.
- Avoid bloated endings, corporate fluff, and unsupported impact language.
- Keep the resume truthful, realistic, and recruiter-ready.

ANALYSIS SUMMARY:
${summary || "(none)"}

HIGH PRIORITY KEYWORD GAPS (context only, do not force):
${keywordsText || "(none)"}

SELF-CHECK BEFORE RETURNING:
- unsupported terms removed
- no invented tools/platforms/acronyms
- no invented outcomes or ownership
- no unjustified leadership escalation
- no major bullet loss
- priority rewrite targets reflected where useful

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
- Do NOT invent metrics, tools, platforms, acronyms, channels, achievements, ownership, or business impact.
- Do NOT replace generic platform language with specific platforms unless explicitly present in the original resume.
- Do NOT upgrade support-oriented work into full ownership unless clearly supported.
- Keep already-strong bullets strong.
- Focus the rewrite effort on weaker/support-heavy bullets and awkward summary lines.
- Preserve bullet count and structure as much as possible.
- Do NOT merge multiple bullets into one if that removes detail.
- Use canonical section headings only.

ROLE CONTEXT:
${roleContextText}

ALLOWED EXPLICIT TOOLS / PLATFORMS / ACRONYMS:
${allowedTermsText}

REMOVE THESE UNSUPPORTED TERMS IF PRESENT:
${unsupportedText}

PRIORITY REWRITE TARGETS:
${priorityRewriteText}

HARD FACT LOCK:
- You may use only tools, platforms, acronyms, channels, and business concepts explicitly present in the original resume.
- Missing keywords are context only. Do NOT add a keyword unless the work is already supported by the original resume.
- If a term is not explicitly supported, remove it.

${englishStyleBlock}

QUALITY TARGET:
- The final output should feel premium and clearly stronger than the original.
- Do NOT keep weak generic bullets if they can be rewritten more clearly and specifically.
- Do NOT flatten already-good bullets.
- Avoid bloated endings, corporate fluff, and unsupported impact language.
- Keep the resume truthful, realistic, and recruiter-ready.

ANALYSIS SUMMARY:
${summary || "(none)"}

HIGH PRIORITY KEYWORD GAPS (context only, do not force):
${keywordsText || "(none)"}

SELF-CHECK BEFORE RETURNING:
- unsupported terms removed
- no invented tools/platforms/acronyms
- no invented outcomes or ownership
- no unjustified leadership escalation
- no major bullet loss
- priority rewrite targets reflected where useful

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
    const roleGroups = inferRoleGroups(cv, jd);

    console.log("ROLE GROUPS", roleGroups);

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
          userPrompt: buildPreviewAtsPrompt({
            cv,
            jd,
            hasJD,
            outLang,
            roleGroups,
          }),
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

      const deterministicScore = computeDeterministicAtsScore(cv, jd, roleGroups);
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
          { outLang, roleGroups }
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
        userPrompt: buildFullAtsAnalysisPrompt({
          cv,
          jd,
          hasJD,
          outLang,
          roleGroups,
        }),
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

    const deterministicScore = computeDeterministicAtsScore(cv, jd, roleGroups);
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
        { outLang, roleGroups }
      ),
      summary: typeof analysisData?.summary === "string" ? analysisData.summary : "",
      optimized_cv: "",
      optimized_ats_score: mergedBaseScore,
    };

    let bulletUpgrades = [];
    if (normalized.weak_sentences.length > 0) {
      try {
        const bulletData = await callOpenAIJson({
          apiKey,
          model,
          system: buildAtsSystem(outLang),
          userPrompt: buildTargetedBulletUpgradePrompt({
            cv,
            jd,
            hasJD,
            weakSentences: normalized.weak_sentences,
            outLang,
            roleGroups,
          }),
          isPreview: false,
          passType: "bullet",
          maxCompletionTokens: 1600,
        });

        bulletUpgrades = normalizeBulletUpgrades(
          Array.isArray(bulletData?.bullet_upgrades) ? bulletData.bullet_upgrades : [],
          outLang
        );
      } catch {
        bulletUpgrades = [];
      }
    }

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
          bulletUpgrades,
          outLang,
          roleGroups,
        }),
        isPreview: false,
        passType: "optimize",
        maxCompletionTokens: 3400,
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
      shouldRepairOptimizedCv(
        cv,
        currentOptimized,
        jd,
        outLang,
        normalized.weak_sentences,
        roleGroups
      ) || unsupportedTerms.length > 0
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
            bulletUpgrades,
            unsupportedTerms,
            outLang,
            roleGroups,
          }),
          isPreview: false,
          passType: "repair",
          maxCompletionTokens: 3800,
        });

        if (typeof repaired?.optimized_cv === "string" && repaired.optimized_cv.trim()) {
          currentOptimized = forceSafeResume(cv, repaired.optimized_cv.trim());
          unsupportedTerms = findUnsupportedTerms(cv, jd, currentOptimized);
        }
      } catch {
        // mevcut optimize sürüm kalsın
      }
    }

    if (unsupportedTerms.length > 0) {
      try {
        const cleaned = await callOpenAIJson({
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
            bulletUpgrades,
            unsupportedTerms,
            outLang,
            roleGroups,
          }),
          isPreview: false,
          passType: "repair",
          maxCompletionTokens: 3800,
        });

        if (typeof cleaned?.optimized_cv === "string" && cleaned.optimized_cv.trim()) {
          currentOptimized = forceSafeResume(cv, cleaned.optimized_cv.trim());
        }
      } catch {
        // mevcut optimize sürüm kalsın
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
