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

const LANG_MAP = {
  en: "English",
  tr: "Turkish",
  es: "Spanish",
  ru: "Russian",
  fr: "French",
  ar: "Arabic",
  zh: "Chinese (Simplified)",
};

const VALID_LI_TONES = new Set(["clean", "confident", "bold"]);
const VALID_LI_SENIORITY = new Set([
  "intern",
  "junior",
  "associate",
  "mid",
  "senior",
  "lead",
  "manager",
  "director",
  "executive",
]);

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
  return String(str || "").replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function normalizeCompareText(str = "") {
  return String(str)
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[^\p{L}\p{N}\s+%/#&.-]/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function canonicalizeTerm(str = "") {
  let s = normalizeCompareText(str)
    .replace(/[\/_-]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();

  const replacements = [
    [/google analytics 4|ga 4/g, "ga4"],
    [/google tag manager|gtm/g, "gtm"],
    [/microsoft excel|ms excel/g, "excel"],
    [/microsoft office|ms office/g, "office"],
    [/looker data studio|google data studio|data studio/g, "looker studio"],
    [/structured query language/g, "sql"],
    [/react js/g, "react"],
    [/node js/g, "node.js"],
    [/amazon web services/g, "aws"],
    [/google cloud platform/g, "gcp"],
    [/quality assurance/g, "qa"],
    [/user experience/g, "ux"],
    [/user interface/g, "ui"],
    [/continuous integration continuous deployment|continuous integration continuous delivery|ci cd/g, "ci/cd"],
    [/restful api|rest apis/g, "rest api"],
    [/electronic health record/g, "ehr"],
    [/electronic medical record/g, "emr"],
    [/customer service/g, "customer support"],
    [/talent acquisition/g, "recruiting"],
  ];

  for (const [re, to] of replacements) {
    s = s.replace(re, to);
  }

  return s.replace(/\s+/g, " ").trim();
}

function uniqueByNormalizedStrings(arr = []) {
  const seen = new Set();
  const out = [];

  for (const item of Array.isArray(arr) ? arr : []) {
    const value = String(item || "").trim();
    const key = canonicalizeTerm(value);
    if (!value || !key || seen.has(key)) continue;
    seen.add(key);
    out.push(value);
  }

  return out;
}

function containsCanonicalTermInNormalizedText(normalizedText = "", term = "") {
  const termNorm = canonicalizeTerm(term);
  if (!termNorm) return false;

  if (termNorm.includes(" ")) {
    return normalizedText.includes(termNorm);
  }

  return new RegExp(`(?:^|\\s)${escapeRegex(termNorm)}(?:$|\\s)`, "i").test(normalizedText);
}

function countTermHits(text = "", terms = []) {
  const norm = canonicalizeTerm(text);
  let hits = 0;

  for (const term of uniqueTrimmedStrings(terms)) {
    if (containsCanonicalTermInNormalizedText(norm, term)) hits += 1;
  }

  return hits;
}

function countWords(str = "") {
  return String(str).trim().split(/\s+/).filter(Boolean).length;
}

function clampText(str = "", max = 1000) {
  return String(str || "").replace(/\s+/g, " ").trim().slice(0, max);
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
    .filter((x) => /^[-•·‣▪▫◦*]\s+/.test(x))
    .map((x) => x.replace(/^[-•·‣▪▫◦*]\s+/, "").trim())
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

function capitalizeFirst(str = "") {
  const s = String(str || "").trim();
  if (!s) return s;
  return s.charAt(0).toUpperCase() + s.slice(1);
}

function lowerFirst(str = "") {
  const s = String(str || "").trim();
  if (!s) return s;
  return s.charAt(0).toLowerCase() + s.slice(1);
}

function splitSentenceEnding(str = "") {
  const s = String(str || "").trim();
  const m = s.match(/[.?!]+$/);
  return {
    body: s.replace(/[.?!]+$/, "").trim(),
    ending: m ? m[0] : ".",
  };
}

function isSectionHeader(line = "") {
  return /^(PROFESSIONAL SUMMARY|SUMMARY|PROFILE|CORE SUMMARY|EXPERIENCE|WORK EXPERIENCE|PROFESSIONAL EXPERIENCE|SKILLS|CORE SKILLS|TECHNICAL SKILLS|COMPETENCIES|EDUCATION|LANGUAGES|CERTIFICATIONS|LICENSES|PROJECTS|ADDITIONAL INFORMATION|AWARDS|ACHIEVEMENTS|PROFESYONEL ÖZET|ÖZET|PROFİL|DENEYİM|İŞ DENEYİMİ|YETKİNLİKLER|YETENEKLER|BECERİLER|EĞİTİM|DİLLER|BİLDİĞİ DİLLER|SERTİFİKALAR|PROJELER|EK BİLGİLER)$/i.test(
    String(line).trim()
  );
}

function extractSummaryLines(cv = "") {
  const lines = getNonEmptyLines(cv);
  const out = [];
  let inSummary = false;

  for (const line of lines) {
    if (/^(PROFESSIONAL SUMMARY|SUMMARY|PROFILE|PROFESYONEL ÖZET|ÖZET|PROFİL)$/i.test(line)) {
      inSummary = true;
      continue;
    }
    if (inSummary && isSectionHeader(line)) break;
    if (inSummary) {
      out.push(
        ...line
          .split(/(?<=[.?!])\s+/)
          .map((x) => x.trim())
          .filter(Boolean)
      );
    }
  }

  return out;
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

function getClientIp(req) {
  const xf = req.headers["x-forwarded-for"];
  if (typeof xf === "string" && xf.length) return xf.split(",")[0].trim();
  return req.socket?.remoteAddress || "unknown";
}

async function ensureMinDelay(startedAt, minMs) {
  const elapsed = Date.now() - startedAt;
  const remain = minMs - elapsed;
  if (remain > 0) {
    await new Promise((resolve) => setTimeout(resolve, remain));
  }
}

function normalizeSeniority(s = "") {
  const value = String(s || "mid").trim().toLowerCase();
  if (VALID_LI_SENIORITY.has(value)) return value;
  if (/intern|staj/i.test(value)) return "intern";
  if (/junior|jr/i.test(value)) return "junior";
  if (/associate/i.test(value)) return "associate";
  if (/senior|sr|uzman|kıdemli|kidemli/i.test(value)) return "senior";
  if (/lead/i.test(value)) return "lead";
  if (/manager|supervisor/i.test(value)) return "manager";
  if (/director|head/i.test(value)) return "director";
  if (/executive|vp|chief|c-level/i.test(value)) return "executive";
  return "mid";
}

function normalizeTone(s = "") {
  const value = String(s || "clean").trim().toLowerCase();
  return VALID_LI_TONES.has(value) ? value : "clean";
}

const ROLE_PACKS = {
  software_engineering: {
    titles: [
      "software engineer",
      "software developer",
      "backend engineer",
      "backend developer",
      "frontend engineer",
      "frontend developer",
      "full stack developer",
      "full-stack developer",
      "web developer",
      "application developer",
      "mobile developer",
      "ios developer",
      "android developer",
      "devops engineer",
      "systems engineer",
    ],
    keywords: [
      "software development",
      "application development",
      "backend",
      "frontend",
      "full stack",
      "api integration",
      "database",
      "system design",
      "debugging",
      "deployment",
      "cloud",
      "microservices",
      "version control",
      "code review",
    ],
    strongTerms: [
      "rest api",
      "microservices",
      "sql",
      "python",
      "javascript",
      "typescript",
      "react",
      "node.js",
      "java",
      "c sharp",
      "aws",
      "azure",
      "gcp",
      "docker",
      "kubernetes",
      "git",
      "ci/cd",
      "unit testing",
    ],
    toolTerms: [
      "sql",
      "python",
      "javascript",
      "typescript",
      "react",
      "node.js",
      "java",
      "c sharp",
      "aws",
      "azure",
      "gcp",
      "docker",
      "kubernetes",
      "git",
      "postman",
    ],
    suggestedKeywords: [
      "REST APIs",
      "microservices",
      "system design",
      "unit testing",
      "integration testing",
      "cloud services",
      "database optimization",
      "CI/CD",
      "version control",
      "debugging",
      "performance tuning",
      "agile development",
    ],
  },
  qa: {
    titles: [
      "qa engineer",
      "quality assurance engineer",
      "software tester",
      "test engineer",
      "qa analyst",
      "manual tester",
      "automation tester",
      "test analyst",
    ],
    keywords: [
      "quality assurance",
      "test execution",
      "test planning",
      "bug tracking",
      "defect reporting",
      "regression testing",
      "test documentation",
      "test automation",
    ],
    strongTerms: [
      "qa",
      "test cases",
      "test scenarios",
      "regression testing",
      "selenium",
      "cypress",
      "postman",
      "jira",
      "bug tracking",
      "defect management",
      "uat",
    ],
    toolTerms: ["selenium", "cypress", "postman", "jira", "api testing", "test automation"],
    suggestedKeywords: [
      "test cases",
      "regression testing",
      "defect tracking",
      "test documentation",
      "UAT",
      "API testing",
      "automation testing",
      "quality validation",
      "release testing",
      "bug verification",
    ],
  },
  data: {
    titles: ["data analyst", "business intelligence analyst", "bi analyst", "reporting analyst", "analytics specialist", "data specialist"],
    keywords: ["data analysis", "analytics", "dashboard", "reporting", "kpi", "trend analysis", "data validation", "performance metrics"],
    strongTerms: ["sql", "python", "excel", "tableau", "power bi", "looker studio", "dashboard", "kpi", "data modeling", "etl", "reporting", "analysis"],
    toolTerms: ["sql", "python", "excel", "tableau", "power bi", "looker studio", "google sheets"],
    suggestedKeywords: ["SQL", "data visualization", "dashboard reporting", "trend analysis", "KPI tracking", "data validation", "Power BI", "Tableau", "report automation", "data modeling", "ETL", "Excel reporting"],
  },
  product: {
    titles: ["product manager", "product owner", "associate product manager", "technical product manager", "product specialist"],
    keywords: ["product roadmap", "backlog", "requirements", "user stories", "feature planning", "stakeholder alignment", "product discovery", "release planning"],
    strongTerms: ["roadmap", "backlog", "user stories", "requirements gathering", "acceptance criteria", "jira", "confluence", "agile", "scrum", "feature prioritization", "cross-functional collaboration"],
    toolTerms: ["jira", "confluence", "figma", "analytics"],
    suggestedKeywords: ["product roadmap", "backlog prioritization", "requirements gathering", "user stories", "acceptance criteria", "release planning", "stakeholder communication", "cross-functional collaboration", "Agile", "Jira"],
  },
  business_analysis: {
    titles: ["business analyst", "systems analyst", "process analyst", "operations analyst"],
    keywords: ["business requirements", "process analysis", "gap analysis", "workflow analysis", "stakeholder interviews", "documentation", "reporting"],
    strongTerms: ["requirements gathering", "process mapping", "gap analysis", "documentation", "stakeholder management", "jira", "confluence", "reporting", "excel", "sql"],
    toolTerms: ["jira", "confluence", "excel", "sql", "power bi", "visio"],
    suggestedKeywords: ["requirements gathering", "process mapping", "workflow analysis", "gap analysis", "stakeholder communication", "documentation", "UAT support", "Jira", "Confluence", "process improvement"],
  },
  finance: {
    titles: ["accountant", "financial analyst", "finance specialist", "accounts payable specialist", "accounts receivable specialist", "bookkeeper", "finance assistant"],
    keywords: ["financial reporting", "reconciliation", "accounts payable", "accounts receivable", "invoice processing", "budget tracking", "expense reporting", "forecasting", "variance analysis", "audit support", "ledger", "month-end"],
    strongTerms: ["financial reporting", "reconciliation", "accounts payable", "accounts receivable", "invoice processing", "budgeting", "forecasting", "variance analysis", "audit", "ledger", "excel", "ifrs", "gaap"],
    toolTerms: ["excel", "sap", "oracle", "quickbooks", "netsuite", "erp"],
    suggestedKeywords: ["financial reporting", "account reconciliation", "budget tracking", "variance analysis", "forecasting", "month-end close", "AP/AR", "audit support", "Excel", "ERP systems", "GAAP", "IFRS"],
  },
  hr: {
    titles: ["hr specialist", "human resources specialist", "recruiter", "talent acquisition specialist", "hr coordinator", "people operations specialist"],
    keywords: ["recruitment", "candidate screening", "interview scheduling", "employee records", "onboarding", "offboarding", "training coordination", "hr administration", "compliance", "payroll support"],
    strongTerms: ["recruiting", "candidate screening", "interview scheduling", "onboarding", "offboarding", "employee records", "talent acquisition", "compliance", "payroll support", "workday", "greenhouse", "ats"],
    toolTerms: ["workday", "greenhouse", "ats", "excel", "hris"],
    suggestedKeywords: ["talent acquisition", "candidate screening", "interview coordination", "employee onboarding", "HR administration", "policy compliance", "record management", "ATS", "Workday", "Greenhouse"],
  },
  operations: {
    titles: ["operations manager", "operations specialist", "operations coordinator", "operations analyst", "office manager"],
    keywords: ["operations", "workflow", "documentation", "reporting", "process coordination", "process improvement", "scheduling", "cross-functional coordination", "vendor communication", "record keeping"],
    strongTerms: ["operations", "workflow", "process coordination", "documentation", "reporting", "scheduling", "status updates", "vendor communication", "process improvement"],
    toolTerms: ["excel", "erp", "sap", "jira"],
    suggestedKeywords: ["process improvement", "workflow coordination", "vendor communication", "cross-functional collaboration", "status reporting", "documentation", "task prioritization", "operational tracking", "process documentation", "resource coordination"],
  },
  supply_chain: {
    titles: ["supply chain specialist", "logistics specialist", "logistics coordinator", "warehouse coordinator", "inventory specialist"],
    keywords: ["supply chain", "logistics", "inventory", "shipment coordination", "warehouse operations", "order fulfillment", "dispatch", "delivery tracking", "stock control"],
    strongTerms: ["inventory management", "warehouse management", "shipment tracking", "logistics coordination", "stock control", "order fulfillment", "vendor coordination", "transport planning", "sap", "erp"],
    toolTerms: ["sap", "erp", "excel", "warehouse management"],
    suggestedKeywords: ["inventory management", "shipment tracking", "warehouse operations", "logistics coordination", "stock control", "order fulfillment", "vendor coordination", "ERP systems", "delivery planning", "inventory reconciliation"],
  },
  procurement: {
    titles: ["procurement specialist", "purchasing specialist", "buyer", "sourcing specialist", "procurement coordinator"],
    keywords: ["procurement", "purchasing", "sourcing", "vendor management", "rfq", "purchase orders", "supplier communication", "cost comparison"],
    strongTerms: ["procurement", "sourcing", "vendor management", "supplier communication", "purchase orders", "rfq", "price comparison", "contract support", "sap", "erp"],
    toolTerms: ["sap", "erp", "excel"],
    suggestedKeywords: ["vendor management", "sourcing", "purchase orders", "supplier communication", "RFQ", "price comparison", "ERP systems", "procurement documentation", "vendor evaluation", "contract support"],
  },
  sales: {
    titles: ["sales specialist", "sales executive", "account executive", "sales coordinator", "business development executive"],
    keywords: ["sales", "lead management", "pipeline", "crm", "sales reporting", "proposal", "client communication", "deal tracking", "order processing"],
    strongTerms: ["pipeline", "crm", "lead follow-up", "account support", "sales reporting", "proposal", "deal tracking", "order processing", "salesforce", "hubspot"],
    toolTerms: ["salesforce", "hubspot", "crm", "excel"],
    suggestedKeywords: ["sales pipeline", "lead management", "CRM", "proposal preparation", "deal tracking", "account coordination", "client follow-up", "Salesforce", "HubSpot", "sales reporting"],
  },
  customer_support: {
    titles: ["customer support specialist", "customer service representative", "support specialist", "technical support specialist", "help desk specialist"],
    keywords: ["customer support", "ticket handling", "issue resolution", "live chat", "email support", "complaint handling", "service quality", "crm", "zendesk", "freshdesk", "sla", "escalation"],
    strongTerms: ["customer support", "ticket", "issue resolution", "issue escalation", "email support", "live chat", "complaint handling", "response time", "resolution time", "help desk"],
    toolTerms: ["zendesk", "freshdesk", "crm", "help desk"],
    suggestedKeywords: ["ticket management", "issue resolution", "service quality", "SLA", "escalation handling", "support documentation", "customer communication", "Zendesk", "CRM", "case follow-up"],
  },
  customer_success: {
    titles: ["customer success specialist", "customer success manager", "client success specialist", "account manager"],
    keywords: ["customer success", "onboarding", "renewal", "retention", "account management", "customer communication", "relationship management", "customer feedback", "nps", "csat", "qbr"],
    strongTerms: ["customer success", "onboarding", "account management", "renewal", "retention", "customer feedback", "relationship management", "nps", "csat", "qbr"],
    toolTerms: ["crm", "salesforce", "hubspot"],
    suggestedKeywords: ["customer onboarding", "account management", "renewal support", "customer retention", "relationship management", "CSAT", "NPS", "QBR", "client engagement", "cross-functional collaboration"],
  },
  executive_assistant: {
    titles: ["executive assistant", "personal assistant", "administrative assistant", "office assistant"],
    keywords: ["calendar management", "travel coordination", "meeting coordination", "document preparation", "executive support", "scheduling", "record keeping", "office administration"],
    strongTerms: ["calendar management", "travel coordination", "meeting coordination", "document preparation", "record keeping", "scheduling", "executive support"],
    toolTerms: ["excel", "powerpoint", "office", "google sheets"],
    suggestedKeywords: ["calendar management", "meeting coordination", "travel coordination", "document management", "record maintenance", "executive support", "office administration", "task prioritization", "time management", "stakeholder communication"],
  },
  project: {
    titles: ["project manager", "project coordinator", "program coordinator", "program manager", "pm"],
    keywords: ["project coordination", "project management", "timelines", "deliverables", "status tracking", "stakeholder updates", "milestones", "project documentation", "risk tracking"],
    strongTerms: ["project coordination", "project management", "timelines", "deliverables", "milestones", "status tracking", "risk tracking", "jira", "confluence", "agile"],
    toolTerms: ["jira", "confluence", "excel", "primavera p6", "ms project"],
    suggestedKeywords: ["timeline management", "deliverable coordination", "status reporting", "stakeholder communication", "risk tracking", "project documentation", "resource coordination", "Agile", "Jira", "milestone tracking"],
  },
  marketing: {
    titles: ["digital marketing specialist", "marketing specialist", "performance marketing specialist", "marketing executive", "content specialist", "growth marketer"],
    keywords: ["google ads", "meta ads", "google analytics", "ga4", "google tag manager", "seo", "sem", "ppc", "campaign reporting", "content marketing", "email marketing", "social media", "lead generation"],
    strongTerms: ["google ads", "meta ads", "google analytics", "ga4", "google tag manager", "seo", "sem", "ppc", "cpc", "ctr", "cpa", "roas", "roi", "a/b test", "lead generation", "campaign optimization"],
    toolTerms: ["google ads", "meta ads", "google analytics", "ga4", "google tag manager", "search console", "hubspot"],
    suggestedKeywords: ["PPC", "SEO", "SEM", "GA4", "Google Tag Manager", "audience segmentation", "A/B testing", "lead generation", "campaign optimization", "analytics reporting"],
  },
  design: {
    titles: ["designer", "graphic designer", "ui designer", "ux designer", "product designer", "visual designer"],
    keywords: ["design", "wireframes", "prototypes", "user interface", "user experience", "visual design", "brand assets", "design systems"],
    strongTerms: ["figma", "adobe creative suite", "photoshop", "illustrator", "wireframes", "prototypes", "ui", "ux", "design system", "mockups"],
    toolTerms: ["figma", "adobe creative suite", "photoshop", "illustrator", "after effects"],
    suggestedKeywords: ["Figma", "wireframing", "prototyping", "design systems", "UI design", "UX design", "user flows", "visual design", "Adobe Creative Suite", "mockups"],
  },
  education: {
    titles: ["teacher", "english teacher", "math teacher", "subject teacher", "instructor", "lecturer", "teaching assistant"],
    keywords: ["lesson planning", "classroom management", "student assessment", "curriculum", "instruction", "student support", "teaching materials"],
    strongTerms: ["lesson planning", "classroom management", "student assessment", "curriculum development", "instruction", "learning materials", "student progress"],
    toolTerms: ["excel", "powerpoint", "google classroom", "office"],
    suggestedKeywords: ["lesson planning", "classroom management", "student assessment", "curriculum development", "learning materials", "student progress tracking", "instruction", "parent communication", "education support", "academic planning"],
  },
  healthcare_admin: {
    titles: ["healthcare administrator", "medical secretary", "medical office assistant", "patient coordinator", "clinic coordinator"],
    keywords: ["patient scheduling", "medical records", "insurance verification", "ehr", "emr", "clinic operations", "appointment coordination", "hipaa"],
    strongTerms: ["patient scheduling", "medical records", "insurance verification", "ehr", "emr", "hipaa", "appointment coordination", "patient communication"],
    toolTerms: ["ehr", "emr", "excel", "office"],
    suggestedKeywords: ["patient scheduling", "medical records", "insurance verification", "EHR/EMR", "appointment coordination", "HIPAA", "patient communication", "clinic administration", "record maintenance", "front-desk coordination"],
  },
  civil_engineering: {
    titles: ["civil engineer", "site engineer", "construction engineer", "project site engineer"],
    keywords: ["civil engineering", "site supervision", "construction", "project drawings", "quantity takeoff", "boq", "technical documentation", "autocad", "revit", "primavera p6"],
    strongTerms: ["autocad", "revit", "primavera p6", "site supervision", "technical drawings", "quantity takeoff", "boq", "construction documentation", "inspection"],
    toolTerms: ["autocad", "revit", "primavera p6", "excel"],
    suggestedKeywords: ["AutoCAD", "Revit", "Primavera P6", "site supervision", "quantity takeoff", "BOQ", "technical documentation", "drawing review", "progress tracking", "construction coordination"],
  },
  mechanical_engineering: {
    titles: ["mechanical engineer", "design engineer", "maintenance engineer", "production engineer"],
    keywords: ["mechanical design", "technical drawings", "solidworks", "autocad", "equipment maintenance", "production support", "technical documentation", "quality checks"],
    strongTerms: ["solidworks", "autocad", "technical drawings", "equipment maintenance", "preventive maintenance", "production support", "quality checks", "root cause analysis"],
    toolTerms: ["solidworks", "autocad", "excel", "erp"],
    suggestedKeywords: ["SolidWorks", "AutoCAD", "technical drawings", "preventive maintenance", "equipment inspection", "production support", "quality checks", "technical documentation", "root cause analysis", "maintenance planning"],
  },
  administrative: {
    titles: ["administrative assistant", "office assistant", "admin assistant"],
    keywords: ["administrative support", "calendar management", "scheduling", "meeting coordination", "document preparation", "filing", "data entry", "record keeping", "office support"],
    strongTerms: ["calendar management", "scheduling", "meeting coordination", "document preparation", "filing", "data entry", "record keeping", "office operations"],
    toolTerms: ["office", "excel", "powerpoint", "google sheets"],
    suggestedKeywords: ["document management", "calendar coordination", "meeting scheduling", "record maintenance", "office administration", "internal communication", "task coordination", "data entry accuracy", "time management", "administrative reporting"],
  },
  generic: {
    titles: [],
    keywords: [],
    strongTerms: ["reporting", "documentation", "coordination", "analysis", "communication", "scheduling", "records", "tracking", "support"],
    toolTerms: ["excel", "office", "google sheets", "powerpoint"],
    suggestedKeywords: ["documentation", "cross-functional collaboration", "process tracking", "stakeholder communication", "task coordination", "problem-solving", "time management", "reporting", "data tracking", "record maintenance"],
  },
};

function getRolePackAllTerms(pack = {}) {
  return uniqueTrimmedStrings([
    ...(pack.titles || []),
    ...(pack.keywords || []),
    ...(pack.strongTerms || []),
    ...(pack.toolTerms || []),
    ...(pack.suggestedKeywords || []),
  ]);
}

const ALL_ROLE_TERMS = uniqueTrimmedStrings(
  Object.values(ROLE_PACKS).flatMap((p) => getRolePackAllTerms(p))
);

const HARD_FACT_TERMS = uniqueTrimmedStrings([
  "google ads", "meta ads", "google analytics", "ga4", "google tag manager", "gtm", "seo", "sem", "ppc", "hubspot", "salesforce", "crm", "zendesk", "freshdesk", "help desk", "jira", "confluence", "tableau", "power bi", "looker studio", "excel", "google sheets", "powerpoint", "sql", "python", "javascript", "typescript", "react", "node.js", "java", "c sharp", "aws", "azure", "gcp", "docker", "kubernetes", "git", "ci/cd", "rest api", "microservices", "unit testing", "integration testing", "selenium", "cypress", "postman", "figma", "adobe creative suite", "photoshop", "illustrator", "autocad", "solidworks", "revit", "primavera p6", "sap", "sap mm", "sap fico", "oracle", "quickbooks", "netsuite", "erp", "ifrs", "gaap", "accounts payable", "accounts receivable", "payroll", "forecasting", "variance analysis", "budgeting", "audit", "reconciliation", "workday", "greenhouse", "ats", "agile", "scrum", "kanban", "lean", "six sigma", "pmp", "csm", "psm", "etl", "data modeling", "ehr", "emr", "hipaa", "patient scheduling", "insurance verification", "inventory management", "warehouse management", "procurement", "sourcing", "vendor management", "csat", "nps", "qbr", "a/b test", "remarketing", "retargeting", "lead generation", "audience segmentation", "boq"
]);

const EN_WEAK_REWRITE_START_RE = /^(?:actively\s+)?(?:helped|assisted|supported|contributed|participated|aided)\b/i;
const EN_UNSUPPORTED_IMPACT_RE = /\b(drive measurable results|resulting in|increased conversion rates|qualified leads|competitive positioning|data-driven decision-making|stronger market presence|better campaign outcomes|improved follow-up|deliver(?:ed|ing)? exceptional service|enhance(?:d|s|ing)? client relationships|increase(?:d|ing)? participation rates|boost(?:ed|ing)? customer loyalty|enhance(?:d|s|ing)? service satisfaction|improve(?:d|s|ing)? operational efficiency|reduced costs|generated revenue|improved retention|optimized performance|accelerated delivery)\b/i;
const ENGLISH_CORPORATE_FLUFF_RE = /\b(dynamic|robust|seamless|impactful|high-impact|comprehensive|various|overall|strategic initiatives|in-depth data analysis|for consistency|for team accessibility|to ensure data accuracy|to ensure accuracy and relevance|to streamline communication efforts|to support informed marketing strategies|to enhance engagement|to optimize user experience|operational excellence|decision-making|stakeholder alignment|value-driven|best-in-class|synergy|world-class|transformational|game-changing|visionary)\b/i;
const FILLER_RE = /\b(dynamic|results-driven|passionate|motivated|hardworking|detail-oriented|dedicated|proactive|seamless|robust|comprehensive|impactful|strategic thinker|team player|solution-oriented|highly organized|go-getter|self-starter|learning-focused)\b/i;
const STRONG_ACTION_RE = /\b(yönettim|yürüttüm|koordine ettim|hazırladım|analiz ettim|raporladım|geliştirdim|oluşturdum|uyguladım|organize ettim|takip ettim|düzenledim|gerçekleştirdim|izledim|optimize ettim|tasarladım|planladım|uyarladım|sundum|denetledim|doğruladım|uzlaştırdım|işledim|eğitim verdim|değerlendirdim|engineered|built|developed|designed|implemented|integrated|tested|debugged|validated|automated|configured|deployed|maintained|optimized|planned|executed|created|responded|resolved|documented|scheduled|reviewed|updated|monitored|processed|reconciled|screened|analyzed|reported|tracked|managed|delivered|verified|produced|prepared|mapped|facilitated|taught|assessed|inspected|coordinated|collaborated|communicated|organized|compiled|addressed|guided)\b/i;
const WEAK_START_RE = /^(helped|helps|assisted|assists|supported|supports|worked on|contributed to|participated in|involved in|handled|tasked with|responsible for|duties included|yardımcı oldum|destek verdim|destek oldum|görev aldım|ilgilen(dim|di)|bulundum|çalıştım|yaptım)\b/i;

function inferSeniority(text = "") {
  const s = normalizeCompareText(text);

  if (/\b(chief|vp|vice president|director|head of|department head|general manager)\b/i.test(s)) {
    return "leadership";
  }
  if (/\b(principal|staff engineer|lead|manager|team lead|supervisor)\b/i.test(s)) {
    return "manager_or_lead";
  }
  if (/\b(senior|sr\.?|kidemli|uzman)\b/i.test(s)) {
    return "senior";
  }
  if (/\b(intern|stajyer|junior|jr\.?|assistant|associate|trainee|entry level)\b/i.test(s)) {
    return "junior";
  }

  return "mid";
}

function getSkillsLines(cv = "") {
  const lines = getNonEmptyLines(cv);
  const out = [];
  let inSkills = false;

  for (const line of lines) {
    if (/(SKILLS|CORE SKILLS|TECHNICAL SKILLS|COMPETENCIES|YETKİNLİKLER|YETENEKLER|BECERİLER)/i.test(line)) {
      inSkills = true;
      continue;
    }

    if (inSkills && isSectionHeader(line)) break;
    if (inSkills) {
      out.push(line.replace(/^[-•·‣▪▫◦*]\s+/, "").trim());
    }
  }

  return out.filter(Boolean);
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
      if (prev && !isSectionHeader(prev) && !prev.includes("@") && !/^\d/.test(prev)) {
        titles.push(prev);
      }
    }
  }

  return titles;
}

function inferRoleProfile(cv = "", jd = "") {
  const combined = `${cv || ""}\n${jd || ""}`;
  const combinedNorm = canonicalizeTerm(combined);
  const titleText = `${extractHeaderBlock(cv).join(" ")} ${extractExperienceTitles(cv).join(" ")}`.trim();
  const summaryText = extractSummaryLines(cv).join(" ");
  const skillsText = getSkillsLines(cv).join(" ");
  const bulletsText = getBulletLines(cv).join(" ");
  const isCvOnly = !String(jd || "").trim();

  const scored = Object.entries(ROLE_PACKS)
    .filter(([key]) => key !== "generic")
    .map(([key, pack]) => {
      const titleHits = countTermHits(titleText, pack.titles || []);
      const keywordHits = countTermHits(combinedNorm, pack.keywords || []);
      const strongHits = countTermHits(combinedNorm, pack.strongTerms || []);
      const toolHits = countTermHits(combinedNorm, pack.toolTerms || []);
      const summaryHits = countTermHits(summaryText, [...(pack.titles || []), ...(pack.keywords || []), ...(pack.strongTerms || [])]);
      const skillsHits = countTermHits(skillsText, [...(pack.toolTerms || []), ...(pack.strongTerms || [])]);
      const bulletHits = countTermHits(bulletsText, [...(pack.keywords || []), ...(pack.strongTerms || [])]);

      const score = titleHits * 8 + skillsHits * 5 + strongHits * 4 + toolHits * 4 + keywordHits * 3 + summaryHits * 3 + bulletHits * 2;

      return { key, score, titleHits, keywordHits, strongHits, toolHits, summaryHits, skillsHits, bulletHits };
    })
    .filter((x) => x.score > 0)
    .sort((a, b) => b.score - a.score);

  let roleGroups = ["generic"];

  if (scored.length) {
    const top = scored[0].score;
    roleGroups = [];

    for (const item of scored) {
      if (!roleGroups.length) {
        roleGroups.push(item.key);
        continue;
      }

      if (isCvOnly && roleGroups.length >= 2) break;
      if (!isCvOnly && roleGroups.length >= 3) break;

      const shouldInclude = isCvOnly
        ? item.score >= Math.max(10, top - 4) || item.titleHits >= 1 || item.skillsHits >= 2 || item.toolHits >= 2 || item.strongHits >= 3
        : item.score >= Math.max(8, top - 6) || item.titleHits >= 1 || item.skillsHits >= 2 || item.toolHits >= 2 || item.strongHits >= 2 || item.summaryHits >= 2;

      if (shouldInclude) roleGroups.push(item.key);
    }

    if (!roleGroups.length) roleGroups = ["generic"];
  }

  const primaryRole = roleGroups[0] || "generic";
  const seniority = inferSeniority(`${titleText}\n${combined}`);
  const selectedPacks = roleGroups.map((k) => ROLE_PACKS[k]).filter(Boolean);

  const domainSignals = uniqueTrimmedStrings(
    selectedPacks.flatMap((pack) => [
      ...(pack.strongTerms || []),
      ...(pack.toolTerms || []),
      ...(pack.keywords || []),
    ])
  )
    .filter((term) => containsCanonicalTermInNormalizedText(combinedNorm, term))
    .slice(0, 16);

  return {
    roleGroups,
    primaryRole,
    secondaryRoles: roleGroups.slice(1),
    seniority,
    domainSignals,
    scoredRoles: scored.slice(0, 6),
  };
}

function ensureRoleProfile(roleInput, cv = "", jd = "") {
  if (roleInput && typeof roleInput === "object" && !Array.isArray(roleInput) && Array.isArray(roleInput.roleGroups)) {
    return roleInput;
  }

  const roleGroups = Array.isArray(roleInput) && roleInput.length ? roleInput : inferRoleProfile(cv, jd).roleGroups;

  return {
    roleGroups,
    primaryRole: roleGroups[0] || "generic",
    secondaryRoles: roleGroups.slice(1),
    seniority: inferSeniority(`${cv}\n${jd}`),
    domainSignals: [],
    scoredRoles: [],
  };
}

function getRolePacks(roleInput = [], cv = "", jd = "") {
  const profile = ensureRoleProfile(roleInput, cv, jd);
  const packs = (profile.roleGroups || ["generic"]).map((k) => ROLE_PACKS[k]).filter(Boolean);
  return packs.length ? packs : [ROLE_PACKS.generic];
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
- Headlines must be recruiter-friendly, search-aware, and natural.
- About sections must sound premium, grounded, and LinkedIn-ready.
- Experience fixes must be materially stronger than the source, not shallow one-word swaps.
- Return ONLY valid JSON. No markdown. No extra text.
- All output VALUES MUST be written ONLY in ${outLang}. Do not mix languages.
`.trim();
}

function buildLinkedInRoleContextText({ cv = "", jd = "", targetRole = "", seniority = "mid", industry = "", location = "", tone = "clean", roleProfile }) {
  const profile = ensureRoleProfile(roleProfile, cv, jd);
  const packs = getRolePacks(profile, cv, jd);
  const titles = uniqueTrimmedStrings([
    targetRole,
    ...packs.flatMap((p) => p.titles || []),
  ]).slice(0, 8);

  const terms = uniqueTrimmedStrings([
    ...(profile.domainSignals || []),
    ...packs.flatMap((p) => [...(p.strongTerms || []), ...(p.toolTerms || []), ...(p.keywords || [])]),
  ])
    .filter((term) => containsCanonicalTermInNormalizedText(canonicalizeTerm(`${cv}\n${jd}\n${targetRole}\n${industry}`), term))
    .slice(0, 16);

  return [
    `- primary_role: ${profile.primaryRole}`,
    `- secondary_roles: ${(profile.secondaryRoles || []).join(", ") || "(none)"}`,
    `- candidate_titles: ${titles.join(", ") || "(none)"}`,
    `- seniority: ${seniority}`,
    `- target_role: ${targetRole || "(not provided)"}`,
    `- industry: ${industry || "(not provided)"}`,
    `- location: ${location || "(not provided)"}`,
    `- tone: ${tone}`,
    `- detected_terms: ${terms.join(", ") || "(none)"}`,
  ].join("\n");
}

function buildLinkedInPreviewPrompt({ cv, jd, outLang, liTargetRole, liSeniority, liIndustry, liLocation, liTone, roleProfile }) {
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
${buildLinkedInRoleContextText({
    cv,
    jd,
    targetRole: liTargetRole,
    seniority: liSeniority,
    industry: liIndustry,
    location: liLocation,
    tone: liTone,
    roleProfile,
  })}

RESUME:
${cv}

TARGET ROLE / JOB (optional):
${jd || liTargetRole || "(none)"}
`.trim();
}

function buildLinkedInFullPrompt({ cv, jd, outLang, liTargetRole, liSeniority, liIndustry, liLocation, liTone, roleProfile }) {
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
${buildLinkedInRoleContextText({
    cv,
    jd,
    targetRole: liTargetRole,
    seniority: liSeniority,
    industry: liIndustry,
    location: liLocation,
    tone: liTone,
    roleProfile,
  })}

RESUME:
${cv}

TARGET ROLE / JOB (optional):
${jd || liTargetRole || "(none)"}
`.trim();
}

function isGpt5Model(model = "") {
  return /^gpt-5/i.test(String(model).trim());
}

function buildOpenAIPayload({ model, messages, reasoningEffort = null, temperature = null, maxCompletionTokens = 1800 }) {
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

function buildAttempts({ model, isPreview, passType, maxCompletionTokens }) {
  if (!isGpt5Model(model)) {
    return [{ reasoningEffort: null, temperature: isPreview ? 0.2 : 0.25, maxCompletionTokens }];
  }

  if (passType === "repair") {
    return [
      { reasoningEffort: "low", temperature: null, maxCompletionTokens: Math.max(maxCompletionTokens, 2400) },
      { reasoningEffort: "none", temperature: 0.2, maxCompletionTokens: Math.max(maxCompletionTokens, 3000) },
    ];
  }

  if (isPreview) {
    return [
      { reasoningEffort: "none", temperature: 0.2, maxCompletionTokens: Math.max(maxCompletionTokens, 1100) },
      { reasoningEffort: "none", temperature: 0.2, maxCompletionTokens: Math.max(maxCompletionTokens, 1500) },
    ];
  }

  return [
    { reasoningEffort: "low", temperature: null, maxCompletionTokens: Math.max(maxCompletionTokens, 1800) },
    { reasoningEffort: "none", temperature: 0.2, maxCompletionTokens: Math.max(maxCompletionTokens, 2600) },
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

async function callOpenAIJson({ apiKey, model, system, userPrompt, isPreview = false, passType = "main", maxCompletionTokens = 1800 }) {
  const attempts = buildAttempts({ model, isPreview, passType, maxCompletionTokens });
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
        passType === "repair" ? 70000 : 60000
      );

      const raw = await openaiRes.text();
      if (!openaiRes.ok) {
        const err = new Error("OpenAI error");
        err.status = openaiRes.status;
        err.details = raw.slice(0, 3000);
        throw err;
      }

      const parsed = JSON.parse(raw);
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

      if (data && typeof data === "object" && !Array.isArray(data) && Object.keys(data).length === 0) {
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

      if (lastError?.status && lastError.status >= 400 && lastError.status < 500 && lastError.status !== 429) {
        throw lastError;
      }
    }
  }

  const err = new Error(lastError?.message || "Model did not return usable JSON");
  err.status = lastError?.status || 500;
  err.details = lastError?.details || String(lastError || "Unknown error");
  throw err;
}

function hasUnsupportedImpactClaims(originalText = "", candidateText = "") {
  const orig = String(originalText || "");
  const opt = String(candidateText || "");
  return EN_UNSUPPORTED_IMPACT_RE.test(opt) && !EN_UNSUPPORTED_IMPACT_RE.test(orig);
}

function scoreWeakSentence(sentence = "") {
  const s = String(sentence || "").trim();
  if (!s) return { isWeak: false, weakScore: 0, strongScore: 0 };

  let weakScore = 0;
  let strongScore = 0;

  if (WEAK_START_RE.test(s)) weakScore += 4;
  if (!STRONG_ACTION_RE.test(s)) weakScore += 1;
  if (countWords(s) <= 6) weakScore += 2;
  if (countTermHits(s, HARD_FACT_TERMS) > 0) strongScore += 2;
  if (countTermHits(s, ALL_ROLE_TERMS) > 1) strongScore += 2;
  if (/\b\d+(?:[.,]\d+)?%?\b/.test(s)) strongScore += 2;
  if (STRONG_ACTION_RE.test(s)) strongScore += 2;

  return {
    isWeak: weakScore >= 4 && strongScore <= 3,
    weakScore,
    strongScore,
  };
}

function buildLocalExperienceRewrite(source = "", roleProfile) {
  const sentence = String(source || "").trim();
  if (!sentence) return "";

  const { body, ending } = splitSentenceEnding(sentence);
  const patterns = [
    /^supported\s+/i,
    /^supports\s+/i,
    /^assisted with\s+/i,
    /^assisted\s+/i,
    /^helped with\s+/i,
    /^helped\s+/i,
    /^worked on\s+/i,
    /^responsible for\s+/i,
    /^participated in\s+/i,
    /^contributed to\s+/i,
    /^provided support for\s+/i,
    /^handled\s+/i,
  ];

  let remainder = body;
  let matched = false;
  for (const re of patterns) {
    if (re.test(remainder)) {
      remainder = remainder.replace(re, "").trim();
      matched = true;
      break;
    }
  }

  if (!matched || !remainder) return "";

  const primaryRole = ensureRoleProfile(roleProfile).primaryRole;
  let verb = "Coordinated";

  if (/(email|live chat|customer|client|request|inquir)/i.test(sentence)) verb = "Responded to";
  else if (/(report|dashboard|summary)/i.test(sentence)) verb = "Prepared";
  else if (/(schedule|calendar|meeting|travel)/i.test(sentence)) verb = "Coordinated";
  else if (/(document|record|file|log|note)/i.test(sentence)) verb = "Maintained";
  else if (/(ticket|case|issue|escalat|follow-?up)/i.test(sentence)) verb = "Coordinated";
  else if (/(analysis|audit|review|reconciliation|validation)/i.test(sentence)) verb = "Reviewed";
  else if (/(api|backend|frontend|database|feature|deployment|code)/i.test(sentence)) verb = "Implemented";
  else if (/(design|wireframe|prototype|visual)/i.test(sentence)) verb = "Designed";
  else if (/(lesson|classroom|student|curriculum)/i.test(sentence)) verb = "Delivered";
  else if (/(patient|appointment|medical|insurance)/i.test(sentence)) verb = "Coordinated";
  else if (primaryRole === "marketing") verb = "Coordinated";
  else if (primaryRole === "finance") verb = "Prepared";

  const rewrite = `${verb} ${lowerFirst(remainder)}`.replace(/\s+/g, " ").trim();
  if (!rewrite) return "";
  if (EN_WEAK_REWRITE_START_RE.test(rewrite)) return "";
  if (canonicalizeTerm(rewrite) === canonicalizeTerm(sentence)) return "";
  if (hasUnsupportedImpactClaims(sentence, rewrite)) return "";
  return `${rewrite}${ending}`;
}

function extractWeakCandidates(cv = "") {
  const bullets = getBulletLines(cv);
  return bullets
    .map((sentence) => ({ sentence, profile: scoreWeakSentence(sentence) }))
    .filter((x) => x.profile.isWeak)
    .sort((a, b) => b.profile.weakScore - a.profile.weakScore || a.profile.strongScore - b.profile.strongScore)
    .map((x) => x.sentence)
    .slice(0, 8);
}

function normalizeHeadlineLabel(label = "", index = 0, isPreview = false) {
  const labels = ["Search", "Impact", "Niche", "Leadership", "Clean"];
  const clean = String(label || "").trim();
  if (isPreview) return "Search";
  return labels.includes(clean) ? clean : labels[index] || labels[labels.length - 1];
}

function buildFallbackHeadlines({ roleProfile, targetRole = "", seniority = "mid", industry = "", location = "", isPreview = false }) {
  const profile = ensureRoleProfile(roleProfile);
  const packs = getRolePacks(profile);
  const primaryPack = packs[0] || ROLE_PACKS.generic;
  const roleTitle = targetRole || primaryPack.titles?.[0] || capitalizeFirst(profile.primaryRole.replace(/_/g, " "));
  const coreTerms = uniqueTrimmedStrings([...(primaryPack.toolTerms || []), ...(primaryPack.strongTerms || [])]).slice(0, 6);
  const seniorityText = seniority && seniority !== "mid" ? `${capitalizeFirst(seniority)} ` : "";
  const locationText = location ? ` | ${location}` : "";
  const industryText = industry ? ` | ${industry}` : "";

  const items = [
    { label: "Search", text: `${seniorityText}${capitalizeFirst(roleTitle)}${coreTerms[0] ? ` | ${coreTerms[0]}` : ""}${coreTerms[1] ? ` | ${coreTerms[1]}` : ""}`.trim() },
    { label: "Impact", text: `${capitalizeFirst(roleTitle)}${industryText}${coreTerms[2] ? ` | ${coreTerms[2]}` : ""}`.trim() },
    { label: "Niche", text: `${capitalizeFirst(roleTitle)}${coreTerms[3] ? ` | ${coreTerms[3]}` : coreTerms[0] ? ` | ${coreTerms[0]}` : ""}`.trim() },
    { label: "Leadership", text: `${capitalizeFirst(roleTitle)} | ${["lead","manager","director","executive"].includes(seniority) ? "Cross-Functional Leadership" : "Cross-Functional Collaboration"}${industryText}`.trim() },
    { label: "Clean", text: `${capitalizeFirst(roleTitle)}${industryText}${locationText}${coreTerms[4] ? ` | ${coreTerms[4]}` : ""}`.trim() },
  ];

  return isPreview ? items.slice(0, 1) : items;
}

function normalizeHeadlines(rawHeadlines, context) {
  const items = (Array.isArray(rawHeadlines) ? rawHeadlines : [])
    .map((item, idx) => ({
      label: normalizeHeadlineLabel(item?.label, idx, context.isPreview),
      text: clampText(item?.text, 220),
    }))
    .filter((item) => item.text && !ENGLISH_CORPORATE_FLUFF_RE.test(item.text));

  const out = [];
  const seenText = new Set();
  const seenLabel = new Set();

  for (const item of items) {
    const textKey = canonicalizeTerm(item.text);
    if (!textKey || seenText.has(textKey)) continue;
    if (!context.isPreview && seenLabel.has(item.label)) continue;
    seenText.add(textKey);
    seenLabel.add(item.label);
    out.push(item);
  }

  const fallback = buildFallbackHeadlines(context);
  for (const item of fallback) {
    if (out.length >= (context.isPreview ? 1 : 5)) break;
    const textKey = canonicalizeTerm(item.text);
    if (seenText.has(textKey)) continue;
    if (!context.isPreview && seenLabel.has(item.label)) continue;
    seenText.add(textKey);
    seenLabel.add(item.label);
    out.push(item);
  }

  return out.slice(0, context.isPreview ? 1 : 5);
}

function buildFallbackAbout(context) {
  const profile = ensureRoleProfile(context.roleProfile, context.cv, context.jd);
  const packs = getRolePacks(profile, context.cv, context.jd);
  const primaryPack = packs[0] || ROLE_PACKS.generic;
  const roleTitle = context.targetRole || primaryPack.titles?.[0] || capitalizeFirst(profile.primaryRole.replace(/_/g, " "));
  const terms = uniqueTrimmedStrings([...(profile.domainSignals || []), ...(primaryPack.strongTerms || []), ...(primaryPack.toolTerms || [])]).slice(0, 8);
  const summaryLine = extractSummaryLines(context.cv)[0] || "";

  if (context.languageLabel === "Turkish") {
    const base = `Ben ${roleTitle} odağında çalışan bir profesyonelim. Deneyimim ${terms.slice(0, 3).join(", ") || "iş süreçleri, koordinasyon ve uygulama"} alanlarında şekilleniyor. ${summaryLine ? `${clampText(summaryLine, 180)} ` : ""}Profilimde gerçek deneyimi daha net, daha güçlü ve recruiter dostu bir dille anlatmayı hedefliyorum.`;
    const normal = `${base} Çalışma tarzım düzenli takip, role uygun terminoloji ve profesyonel iletişim üzerine kuruludur. ${terms.slice(3, 6).length ? `Öne çıkan alanlarım arasında ${terms.slice(3, 6).join(", ")} bulunuyor. ` : ""}`.trim();
    const bold = `${normal} Amacım deneyimi abartmadan, daha görünür, daha seçici ve daha ikna edici bir profesyonel profil sunmaktır.`.trim();
    return { short: clampText(base, 850), normal: clampText(normal, 1400), bold: clampText(bold, 1400) };
  }

  const intro = `I am a ${context.seniority !== "mid" ? `${context.seniority} ` : ""}${roleTitle} focused on ${terms.slice(0, 3).join(", ") || "clear execution, structured communication, and role-relevant delivery"}.`;
  const toneLine = context.tone === "bold"
    ? "I position my work with stronger emphasis while keeping the language factual and grounded."
    : context.tone === "confident"
    ? "I use confident positioning while keeping the language professional and fully truthful."
    : "I use clean, recruiter-safe language that reflects the real scope of my work.";
  const short = `${intro} ${summaryLine ? `${clampText(summaryLine, 180)} ` : ""}${toneLine}`.replace(/\s+/g, " ").trim();
  const normal = `${short} On LinkedIn, I aim to present experience in a way that is search-aware, role-specific, and easy for recruiters to understand quickly. I focus on strong wording, clear context, and grounded positioning without exaggerating ownership, results, or scale.`.replace(/\s+/g, " ").trim();
  const bold = `${normal} The goal is not to sound louder than the work itself, but to make the work more visible, more readable, and more compelling to the right audience.`.replace(/\s+/g, " ").trim();
  return { short: clampText(short, 850), normal: clampText(normal, 1400), bold: clampText(bold, 1400) };
}

function normalizeAbout(rawAbout, context) {
  const fallback = buildFallbackAbout(context);
  let short = clampText(rawAbout?.short, 900) || fallback.short;
  let normal = context.isPreview ? "" : clampText(rawAbout?.normal, 1500) || fallback.normal;
  let bold = context.isPreview ? "" : clampText(rawAbout?.bold, 1500) || fallback.bold;

  if (ENGLISH_CORPORATE_FLUFF_RE.test(short)) short = fallback.short;
  if (!context.isPreview) {
    if (ENGLISH_CORPORATE_FLUFF_RE.test(normal)) normal = fallback.normal;
    if (ENGLISH_CORPORATE_FLUFF_RE.test(bold)) bold = fallback.bold;
  }

  return { short, normal, bold };
}

function closestSourceLine(candidate = "", sourceLines = []) {
  const key = canonicalizeTerm(candidate);
  if (!key) return "";

  for (const source of sourceLines) {
    if (canonicalizeTerm(source) === key) return source;
  }

  let best = "";
  let bestScore = 0;
  for (const source of sourceLines) {
    const score = jaccardSimilarity(source, candidate);
    if (score > bestScore) {
      bestScore = score;
      best = source;
    }
  }

  return bestScore >= 0.72 ? best : "";
}

function isValidExperienceFix(item, context) {
  const before = String(item?.before || "").trim();
  const after = String(item?.after || "").trim();
  const why = String(item?.why || "").trim();
  if (!before || !after) return false;
  if (canonicalizeTerm(before) === canonicalizeTerm(after)) return false;
  if (EN_WEAK_REWRITE_START_RE.test(after)) return false;
  if (jaccardSimilarity(before, after) >= 0.9) return false;
  if (hasUnsupportedImpactClaims(before, after)) return false;
  if (ENGLISH_CORPORATE_FLUFF_RE.test(after) && !ENGLISH_CORPORATE_FLUFF_RE.test(before)) return false;
  if (countWords(why) < 3) return false;
  return true;
}

function normalizeExperienceFixes(rawFixes, context) {
  const sourceLines = uniqueByNormalizedStrings([...extractWeakCandidates(context.cv), ...getBulletLines(context.cv)]);
  const out = [];
  const seen = new Set();

  for (const item of Array.isArray(rawFixes) ? rawFixes : []) {
    const candidateBefore = clampText(item?.before, 280);
    const before = closestSourceLine(candidateBefore, sourceLines) || candidateBefore;
    const after = clampText(item?.after, 280);
    const why = clampText(item?.why, 160) || "Stronger action, clearer scope, and better recruiter readability.";
    const key = `${canonicalizeTerm(before)}__${canonicalizeTerm(after)}`;
    if (!before || !after || seen.has(key)) continue;
    const entry = { before, after, why };
    if (!isValidExperienceFix(entry, context)) continue;
    seen.add(key);
    out.push(entry);
  }

  const weakCandidates = extractWeakCandidates(context.cv);
  const needed = context.isPreview ? 1 : Math.min(6, Math.max(4, weakCandidates.length >= 4 ? 4 : weakCandidates.length));
  if (out.length < needed) {
    for (const source of weakCandidates) {
      const after = buildLocalExperienceRewrite(source, context.roleProfile);
      const entry = {
        before: source,
        after,
        why: "Stronger action, clearer scope, and better recruiter readability.",
      };
      const key = `${canonicalizeTerm(entry.before)}__${canonicalizeTerm(entry.after)}`;
      if (!entry.after || seen.has(key)) continue;
      if (!isValidExperienceFix(entry, context)) continue;
      seen.add(key);
      out.push(entry);
      if (out.length >= (context.isPreview ? 2 : 6)) break;
    }
  }

  return out.slice(0, context.isPreview ? 2 : 6);
}

function buildFallbackSkills(context) {
  const profile = ensureRoleProfile(context.roleProfile, context.cv, context.jd);
  const packs = getRolePacks(profile, context.cv, context.jd);
  const primaryPack = packs[0] || ROLE_PACKS.generic;
  const detected = uniqueTrimmedStrings([...(profile.domainSignals || []), ...getSkillsLines(context.cv), ...extractHeaderBlock(context.cv)]);

  const tools = uniqueByNormalizedStrings([
    ...detected.filter((term) => HARD_FACT_TERMS.some((x) => canonicalizeTerm(x) === canonicalizeTerm(term)) || (primaryPack.toolTerms || []).some((x) => canonicalizeTerm(x) === canonicalizeTerm(term))),
    ...(primaryPack.toolTerms || []),
  ]).slice(0, context.isPreview ? 5 : 14);

  const industry = uniqueByNormalizedStrings([
    ...detected.filter((term) => (primaryPack.keywords || []).some((x) => canonicalizeTerm(x) === canonicalizeTerm(term)) || (primaryPack.strongTerms || []).some((x) => canonicalizeTerm(x) === canonicalizeTerm(term))),
    ...(primaryPack.keywords || []),
    ...(primaryPack.strongTerms || []),
  ]).slice(0, context.isPreview ? 5 : 16);

  const top = uniqueByNormalizedStrings([
    ...detected,
    ...(primaryPack.suggestedKeywords || []),
    ...industry,
  ]).slice(0, context.isPreview ? 8 : 16);

  return { top, tools, industry };
}

function normalizeSkillArray(arr = [], maxItems = 12) {
  return uniqueByNormalizedStrings((Array.isArray(arr) ? arr : []).map((x) => clampText(x, 80)).filter(Boolean)).slice(0, maxItems);
}

function normalizeSkills(rawSkills, context) {
  const fallback = buildFallbackSkills(context);
  const top = uniqueByNormalizedStrings([
    ...normalizeSkillArray(rawSkills?.top, context.isPreview ? 8 : 16),
    ...fallback.top,
  ]).slice(0, context.isPreview ? 8 : 16);

  const tools = uniqueByNormalizedStrings([
    ...normalizeSkillArray(rawSkills?.tools, context.isPreview ? 5 : 14),
    ...fallback.tools,
  ]).slice(0, context.isPreview ? 5 : 14);

  const industry = uniqueByNormalizedStrings([
    ...normalizeSkillArray(rawSkills?.industry, context.isPreview ? 5 : 16),
    ...fallback.industry,
  ]).slice(0, context.isPreview ? 5 : 16);

  return { top, tools, industry };
}

function buildBooleanString({ roleProfile, targetRole = "", location = "", skills }) {
  const profile = ensureRoleProfile(roleProfile);
  const packs = getRolePacks(profile);
  const primaryPack = packs[0] || ROLE_PACKS.generic;
  const titles = uniqueTrimmedStrings([targetRole, ...(primaryPack.titles || [])]).slice(0, 4).map((x) => `"${x}"`);
  const terms = uniqueTrimmedStrings([...(skills?.top || []), ...(primaryPack.suggestedKeywords || []), ...(profile.domainSignals || [])]).slice(0, 5).map((x) => (x.includes(" ") ? `"${x}"` : x));
  const tools = uniqueTrimmedStrings([...(skills?.tools || []), ...(primaryPack.toolTerms || [])]).slice(0, 4).map((x) => (x.includes(" ") ? `"${x}"` : x));

  const groups = [];
  if (titles.length) groups.push(`(${titles.join(" OR ")})`);
  if (terms.length) groups.push(`(${terms.join(" OR ")})`);
  if (tools.length) groups.push(`(${tools.join(" OR ")})`);

  let out = groups.join(" AND ");
  if (location) out += out ? ` AND ("${location}")` : `("${location}")`;
  return clampText(out, 320);
}

function normalizeRecruiter(rawRecruiter, context, skills) {
  const profile = ensureRoleProfile(context.roleProfile, context.cv, context.jd);
  const packs = getRolePacks(profile, context.cv, context.jd);
  const primaryPack = packs[0] || ROLE_PACKS.generic;

  const keywords = uniqueByNormalizedStrings([
    ...normalizeSkillArray(rawRecruiter?.keywords, context.isPreview ? 6 : 16),
    ...(skills?.top || []),
    ...(skills?.tools || []),
    ...(primaryPack.suggestedKeywords || []),
    ...(profile.domainSignals || []),
  ]).slice(0, context.isPreview ? 6 : 16);

  let booleanSearch = clampText(rawRecruiter?.boolean, 360);
  if (!booleanSearch || booleanSearch.length < 20 || ENGLISH_CORPORATE_FLUFF_RE.test(booleanSearch)) {
    booleanSearch = buildBooleanString({
      roleProfile: profile,
      targetRole: context.targetRole,
      location: context.location,
      skills,
    });
  }

  return {
    keywords,
    boolean: booleanSearch,
  };
}

function normalizeLinkedInOutput(raw, context) {
  const headlines = normalizeHeadlines(raw?.headlines, context);
  const about = normalizeAbout(raw?.about || {}, context);
  const experience_fix = normalizeExperienceFixes(raw?.experience_fix, context);
  const skills = normalizeSkills(raw?.skills || {}, context);
  const recruiter = normalizeRecruiter(raw?.recruiter || {}, context, skills);
  return { headlines, about, experience_fix, skills, recruiter };
}

function detectLinkedInIssues(output, context) {
  const issues = [];
  if (!Array.isArray(output.headlines) || !output.headlines.length) issues.push("No usable headlines were generated.");
  if (!context.isPreview && output.headlines.length < 5) issues.push("Fewer than 5 headline options were generated.");
  if (!output.about?.short) issues.push("Short About section is missing.");
  if (!context.isPreview && (!output.about?.normal || !output.about?.bold)) issues.push("Full About section set is incomplete.");
  if (extractWeakCandidates(context.cv).length >= 2 && (!Array.isArray(output.experience_fix) || !output.experience_fix.length)) issues.push("Experience fixes are missing despite clear rewrite opportunities.");
  if (!Array.isArray(output.skills?.top) || !output.skills.top.length) issues.push("Top skills output is too thin.");
  if (!Array.isArray(output.recruiter?.keywords) || !output.recruiter.keywords.length) issues.push("Recruiter keywords are missing.");
  if (!context.isPreview && (!output.recruiter?.boolean || output.recruiter.boolean.length < 20)) issues.push("Recruiter boolean search is weak or missing.");
  return issues;
}

function buildLinkedInRepairPrompt({ currentOutput, issues, cv, jd, outLang, liTargetRole, liSeniority, liIndustry, liLocation, liTone, roleProfile }) {
  return `
Return JSON in this exact schema:

{
  "headlines": [{"label": string, "text": string}],
  "about": { "short": string, "normal": string, "bold": string },
  "experience_fix": [{"before": string, "after": string, "why": string}],
  "skills": { "top": string[], "tools": string[], "industry": string[] },
  "recruiter": { "keywords": string[], "boolean": string }
}

TASK:
Repair the LinkedIn optimization output so it becomes cleaner, stronger, more recruiter-ready, and fully truthful.

ISSUES TO FIX:
${issues.map((issue, idx) => `${idx + 1}. ${issue}`).join("\n")}

RULES:
- Keep all output values in ${outLang}.
- Do NOT invent metrics, tools, outcomes, certifications, leadership ownership, or business impact.
- Replace weak or shallow experience rewrites with materially stronger ones.
- Remove artificial headline or About wording.
- Keep the boolean string realistic and readable.

TARGETING META:
${buildLinkedInRoleContextText({
    cv,
    jd,
    targetRole: liTargetRole,
    seniority: liSeniority,
    industry: liIndustry,
    location: liLocation,
    tone: liTone,
    roleProfile,
  })}

CURRENT OUTPUT TO REPAIR:
${JSON.stringify(currentOutput)}

RESUME:
${cv}

TARGET ROLE / JOB (optional):
${jd || liTargetRole || "(none)"}
`.trim();
}

function buildFinalLinkedInResponse(normalized, isPreview) {
  if (!isPreview) return normalized;

  return {
    headlines: normalized.headlines.slice(0, 1),
    about: { short: String(normalized.about?.short || "") },
    experience_fix: Array.isArray(normalized.experience_fix) ? normalized.experience_fix.slice(0, 1) : [],
    skills: {
      top: Array.isArray(normalized.skills?.top) ? normalized.skills.top.slice(0, 10) : [],
    },
    recruiter: {
      keywords: Array.isArray(normalized.recruiter?.keywords) ? normalized.recruiter.keywords.slice(0, 8) : [],
    },
  };
}

export default async function handler(req, res) {
  const startedAt = Date.now();

  try {
    if (req.method !== "POST") {
      return res.status(405).json({ error: "POST required" });
    }

    const body = req.body && typeof req.body === "object" ? req.body : {};
    const { cv, jd, preview, lang, linkedin_meta } = body;

    const sessionOk = verifySession(req);
    const requestedPreview = !!preview;
    const isPreview = requestedPreview || !sessionOk;

    console.log("LINKEDIN DEBUG", {
  host: req.headers.host,
  hasCookie: /resumeai_session=/.test(req.headers.cookie || ""),
  cookieRaw: req.headers.cookie || "",
  requestedPreview: !!preview,
  sessionOk,
  isPreview
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

    const model = process.env.OPENAI_LINKEDIN_MODEL || process.env.OPENAI_MODEL || "gpt-4o-mini";
    const langCode = typeof lang === "string" && lang.trim() ? lang.trim().toLowerCase() : "en";
    const outLang = LANG_MAP[langCode] || "English";
    const liMeta = linkedin_meta && typeof linkedin_meta === "object" ? linkedin_meta : {};
    const liTargetRole = String(liMeta.target_role || "").trim();
    const liSeniority = normalizeSeniority(liMeta.seniority || "mid");
    const liIndustry = String(liMeta.industry || "").trim();
    const liLocation = String(liMeta.location || "").trim();
    const liTone = normalizeTone(liMeta.tone || "clean");
    const roleProfile = inferRoleProfile(String(cv || ""), String(jd || ""));

    let raw;
    try {
      raw = await callOpenAIJson({
        apiKey,
        model,
        system: buildLinkedInSystem(outLang),
        userPrompt: isPreview
          ? buildLinkedInPreviewPrompt({
              cv: String(cv || ""),
              jd: String(jd || ""),
              outLang,
              liTargetRole,
              liSeniority,
              liIndustry,
              liLocation,
              liTone,
              roleProfile,
            })
          : buildLinkedInFullPrompt({
              cv: String(cv || ""),
              jd: String(jd || ""),
              outLang,
              liTargetRole,
              liSeniority,
              liIndustry,
              liLocation,
              liTone,
              roleProfile,
            }),
        isPreview,
        passType: "main",
        maxCompletionTokens: isPreview ? 1300 : 2400,
      });
    } catch (err) {
      return res.status(err?.status || 500).json({
        error: err?.message || "OpenAI error",
        status: err?.status || 500,
        details: err?.details || String(err),
      });
    }

    const context = {
      cv: String(cv || ""),
      jd: String(jd || ""),
      isPreview,
      languageLabel: outLang,
      roleProfile,
      targetRole: liTargetRole,
      seniority: liSeniority,
      industry: liIndustry,
      location: liLocation,
      tone: liTone,
    };

    let normalized = normalizeLinkedInOutput(raw, context);
    let issues = detectLinkedInIssues(normalized, context);

    if (issues.length) {
      try {
        const repaired = await callOpenAIJson({
          apiKey,
          model,
          system: buildLinkedInSystem(outLang),
          userPrompt: buildLinkedInRepairPrompt({
            currentOutput: normalized,
            issues,
            cv: String(cv || ""),
            jd: String(jd || ""),
            outLang,
            liTargetRole,
            liSeniority,
            liIndustry,
            liLocation,
            liTone,
            roleProfile,
          }),
          isPreview,
          passType: "repair",
          maxCompletionTokens: isPreview ? 1500 : 2600,
        });

        normalized = normalizeLinkedInOutput(repaired, context);
      } catch {
        // keep normalized main output if repair fails
      }
    }

    if (isPreview) {
      await ensureMinDelay(startedAt, 15000);
    }

    return res.status(200).json(buildFinalLinkedInResponse(normalized, isPreview));
  } catch (err) {
    return res.status(500).json({
      error: "Server error",
      details: err?.message || String(err),
    });
  }
}
