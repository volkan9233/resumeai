
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

export const LANG_MAP = {
  en: "English",
  tr: "Turkish",
  es: "Spanish",
  ru: "Russian",
  fr: "French",
  ar: "Arabic",
  zh: "Chinese (Simplified)",
};

const HEADING_SETS = {
  English: {
    summary: "PROFESSIONAL SUMMARY",
    experience: "EXPERIENCE",
    skills: "SKILLS",
    education: "EDUCATION",
    languages: "LANGUAGES",
    certifications: "CERTIFICATIONS",
    projects: "PROJECTS",
    additional: "ADDITIONAL INFORMATION",
  },
  Turkish: {
    summary: "PROFESYONEL ÖZET",
    experience: "DENEYİM",
    skills: "YETKİNLİKLER",
    education: "EĞİTİM",
    languages: "DİLLER",
    certifications: "SERTİFİKALAR",
    projects: "PROJELER",
    additional: "EK BİLGİLER",
  },
};

const HEADER_SECTION_RE = /^(PROFESSIONAL SUMMARY|SUMMARY|PROFILE|CORE SUMMARY|EXPERIENCE|WORK EXPERIENCE|PROFESSIONAL EXPERIENCE|SKILLS|CORE SKILLS|TECHNICAL SKILLS|COMPETENCIES|EDUCATION|LANGUAGES|CERTIFICATIONS|LICENSES|PROJECTS|ADDITIONAL INFORMATION|AWARDS|ACHIEVEMENTS|PROFESYONEL ÖZET|ÖZET|PROFİL|DENEYİM|İŞ DENEYİMİ|YETKİNLİKLER|YETENEKLER|BECERİLER|EĞİTİM|DİLLER|BİLDİĞİ DİLLER|SERTİFİKALAR|PROJELER|EK BİLGİLER)$/i;
const BULLET_RE = /^[-•·‣▪▫◦*]\s+/;
const WEAK_VERB_RE = /\b(helped|assisted|supported|worked on|responsible for|contributed to|participated in|involved in|provided support|yardımcı oldum|destek verdim|görev aldım|çalıştım|yaptım|sorumluydum)\b/i;
const WEAK_START_RE = /^(helped|assisted|supported|worked on|responsible for|contributed to|participated in|involved in|provided support|yardımcı oldum|destek verdim|görev aldım|çalıştım|yaptım|sorumluydum)\b/i;
const STRONG_ACTION_RE = /\b(built|developed|designed|implemented|integrated|tested|debugged|optimized|deployed|maintained|automated|configured|analyzed|reported|tracked|prepared|reviewed|reconciled|processed|scheduled|coordinated|organized|documented|validated|monitored|delivered|created|managed|planned|executed|screened|assessed|inspected|responded|resolved|guided|engineered|modeled|hazırladım|analiz ettim|raporladım|geliştirdim|oluşturdum|uyguladım|organize ettim|izledim|tasarladım|planladım|denetledim|doğruladım|işledim|değerlendirdim)\b/i;
const LOW_VALUE_KEYWORD_RE = /\b(communication|teamwork|hardworking|motivated|detail[- ]oriented|problem solving|leadership|microsoft office|ms office|computer skills|organizasyon|iletişim|takım çalışması|motivasyon|çözüm odaklı|detay odaklı|uyumlu|çalışkan|analysis|support|management|beceri|yetenek|deneyim)\b/i;
const JD_CUE_RE = /\b(requirements|required|must have|nice to have|preferred|responsibilities|qualification|qualifications|experience with|knowledge of|proficient in|aranan nitelikler|gerekli|tercihen|yetkinlikler|sorumluluklar|beklentiler)\b/i;
const ACRONYM_RE = /\b[A-Z]{2,}(?:\/[A-Z]{2,})?\b/;
const CERTIFICATION_RE = /\b(pmp|csm|psm|scrum master|cpa|cfa|acca|ifrs|gaap|lean six sigma|six sigma|itil|hipaa|aws certified|azure fundamentals|google ads certification)\b/i;
const ENGLISH_FLUFF_RE = /\b(dynamic|robust|seamless|impactful|high-impact|comprehensive|various|overall|best-in-class|value-driven|strategic initiatives|operational excellence)\b/i;
const ENGLISH_RISKY_OUTCOME_RE = /\b(resulting in|driving|boosting|enhancing|improving|increasing|streamlining|maximizing|delivering)\b/i;
const SCOPE_CONTEXT_RE = /\b(using|with|for|across|through|via|by|on|under|according to|per|regarding|including|covering|handling|tracking|supporting|kullanarak|ile|için|kapsamında|üzerinde|aracılığıyla|konusunda)\b/i;
const GENERIC_TASK_RE = /\b(daily tasks?|routine tasks?|general support|various tasks?|team support|support activities|administrative tasks?|service tasks?|general coordination|basic reporting|operations tasks?|record keeping|data entry|office tasks?)\b/i;

const ROLE_TAXONOMY = {
  software_engineering: {
    titles: ["software engineer", "software developer", "backend engineer", "frontend engineer", "full stack developer", "web developer", "devops engineer"],
    signals: ["backend", "frontend", "api", "database", "system design", "debugging", "deployment", "cloud", "microservices", "ci/cd", "unit testing", "integration testing", "react", "node.js", "javascript", "typescript", "python", "java", "c#", "sql"],
    keywords: ["REST APIs", "microservices", "system design", "unit testing", "integration testing", "cloud services", "CI/CD", "version control", "debugging", "performance tuning"],
    verbs: ["built", "developed", "implemented", "integrated", "tested", "debugged", "deployed", "optimized", "maintained"],
    safeSupportVerbs: ["maintained", "tested", "documented", "integrated with"],
  },
  data_analytics: {
    titles: ["data analyst", "analytics specialist", "reporting analyst", "bi analyst"],
    signals: ["analytics", "dashboard", "reporting", "kpi", "power bi", "tableau", "looker studio", "sql", "python", "excel", "etl", "data modeling"],
    keywords: ["SQL", "data visualization", "dashboard reporting", "trend analysis", "KPI tracking", "data validation", "Power BI", "Tableau", "report automation", "ETL"],
    verbs: ["analyzed", "reported", "tracked", "validated", "prepared", "reviewed", "modeled"],
    safeSupportVerbs: ["reported", "tracked", "validated", "prepared"],
  },
  product_project: {
    titles: ["product manager", "product owner", "project manager", "project coordinator", "program manager"],
    signals: ["roadmap", "backlog", "user stories", "requirements gathering", "acceptance criteria", "release planning", "jira", "confluence", "agile", "scrum", "timeline", "deliverables", "risk tracking"],
    keywords: ["product roadmap", "backlog prioritization", "requirements gathering", "user stories", "acceptance criteria", "release planning", "stakeholder communication", "timeline management", "deliverable coordination", "risk tracking"],
    verbs: ["defined", "prioritized", "coordinated", "planned", "aligned", "tracked", "facilitated", "documented"],
    safeSupportVerbs: ["coordinated", "tracked", "scheduled", "documented"],
  },
  sales: {
    titles: ["sales specialist", "sales executive", "account executive", "sales coordinator", "business development", "account manager"],
    signals: ["sales", "pipeline", "crm", "lead follow-up", "proposal", "deal tracking", "salesforce", "hubspot", "client communication", "order processing"],
    keywords: ["sales pipeline", "lead management", "CRM", "proposal preparation", "deal tracking", "account coordination", "client follow-up"],
    verbs: ["managed", "followed up", "coordinated", "prepared", "updated", "processed", "documented"],
    safeSupportVerbs: ["followed up on", "coordinated", "prepared", "updated", "processed"],
  },
  marketing: {
    titles: ["digital marketing specialist", "marketing specialist", "performance marketing", "growth marketer", "content specialist"],
    signals: ["google ads", "meta ads", "google analytics", "ga4", "google tag manager", "seo", "sem", "ppc", "campaign reporting", "content marketing", "email marketing", "social media", "lead generation", "a/b test"],
    keywords: ["PPC", "SEO", "SEM", "GA4", "Google Tag Manager", "audience segmentation", "A/B testing", "lead generation", "campaign optimization", "analytics reporting"],
    verbs: ["managed", "optimized", "analyzed", "tracked", "reported", "executed", "launched", "monitored"],
    safeSupportVerbs: ["coordinated", "prepared", "tracked", "updated", "monitored"],
  },
  finance_accounting: {
    titles: ["accountant", "financial analyst", "finance specialist", "accounts payable", "accounts receivable", "bookkeeper", "finance assistant"],
    signals: ["financial reporting", "reconciliation", "accounts payable", "accounts receivable", "invoice processing", "budget tracking", "forecasting", "variance analysis", "audit", "ledger", "month-end", "sap", "oracle", "erp", "ifrs", "gaap"],
    keywords: ["financial reporting", "account reconciliation", "budget tracking", "variance analysis", "forecasting", "month-end close", "AP/AR", "audit support", "ERP systems", "GAAP", "IFRS"],
    verbs: ["prepared", "reconciled", "processed", "reviewed", "tracked", "reported", "maintained"],
    safeSupportVerbs: ["prepared", "reconciled", "processed", "reviewed", "tracked"],
  },
  hr_recruiting: {
    titles: ["hr specialist", "human resources specialist", "recruiter", "talent acquisition specialist", "hr coordinator", "people operations"],
    signals: ["recruiting", "candidate screening", "interview scheduling", "employee records", "onboarding", "offboarding", "training coordination", "hr administration", "compliance", "payroll support", "workday", "greenhouse", "ats", "hris"],
    keywords: ["talent acquisition", "candidate screening", "interview coordination", "employee onboarding", "HR administration", "policy compliance", "record management", "ATS", "Workday", "Greenhouse"],
    verbs: ["screened", "scheduled", "coordinated", "maintained", "prepared", "documented", "updated"],
    safeSupportVerbs: ["scheduled", "coordinated", "maintained", "documented", "updated"],
  },
  procurement_supply_chain: {
    titles: ["procurement specialist", "purchasing specialist", "buyer", "sourcing specialist", "logistics specialist", "inventory specialist", "warehouse coordinator", "warehouse assistant", "storekeeper"],
    signals: ["procurement", "purchasing", "sourcing", "vendor", "supplier", "purchase orders", "rfq", "quotation", "cost comparison", "inventory", "shipment", "warehouse", "stock control", "order fulfillment", "sap", "erp", "dispatch", "receiving"],
    keywords: ["vendor management", "sourcing", "purchase orders", "supplier communication", "RFQ", "inventory management", "shipment tracking", "warehouse operations", "ERP systems", "order fulfillment"],
    verbs: ["sourced", "processed", "coordinated", "reviewed", "tracked", "documented", "communicated"],
    safeSupportVerbs: ["processed", "coordinated", "reviewed", "tracked", "documented"],
  },
  customer_support: {
    titles: ["customer support specialist", "customer service representative", "support specialist", "help desk specialist", "customer success specialist", "customer success manager", "client support coordinator"],
    signals: ["customer support", "ticket", "issue resolution", "live chat", "email support", "service quality", "crm", "zendesk", "freshdesk", "sla", "escalation", "onboarding", "renewal", "retention", "csat", "nps", "qbr", "support cases", "service requests"],
    keywords: ["ticket management", "issue resolution", "service quality", "SLA", "escalation handling", "support documentation", "customer communication", "Zendesk", "CRM", "case follow-up", "customer onboarding", "account management"],
    verbs: ["responded", "resolved", "escalated", "documented", "maintained", "communicated", "processed", "tracked", "guided"],
    safeSupportVerbs: ["responded to", "followed up on", "documented", "maintained", "updated", "communicated with"],
  },
  administration: {
    titles: ["executive assistant", "personal assistant", "administrative assistant", "office assistant", "admin assistant"],
    signals: ["calendar management", "travel coordination", "meeting coordination", "document preparation", "executive support", "scheduling", "record keeping", "office administration", "filing", "data entry"],
    keywords: ["calendar management", "meeting coordination", "travel coordination", "document management", "record maintenance", "executive support", "office administration", "task prioritization"],
    verbs: ["managed", "organized", "scheduled", "prepared", "maintained", "coordinated", "documented"],
    safeSupportVerbs: ["organized", "scheduled", "prepared", "maintained", "coordinated"],
  },
  education: {
    titles: ["teacher", "instructor", "lecturer", "teaching assistant"],
    signals: ["lesson planning", "classroom management", "student assessment", "curriculum", "instruction", "learning materials", "student progress", "parent communication"],
    keywords: ["lesson planning", "classroom management", "student assessment", "curriculum development", "learning materials", "student progress tracking", "instruction"],
    verbs: ["planned", "delivered", "prepared", "assessed", "tracked", "organized", "taught"],
    safeSupportVerbs: ["prepared", "tracked", "organized", "communicated with"],
  },
  healthcare_administration: {
    titles: ["healthcare administrator", "medical secretary", "medical office assistant", "patient coordinator", "clinic coordinator", "patient services coordinator"],
    signals: ["patient scheduling", "medical records", "insurance verification", "ehr", "emr", "clinic operations", "appointment coordination", "hipaa", "patient communication", "patient intake", "patient registration", "medical office"],
    keywords: ["patient scheduling", "medical records", "insurance verification", "EHR/EMR", "appointment coordination", "HIPAA", "patient communication", "clinic administration"],
    verbs: ["scheduled", "coordinated", "updated", "maintained", "verified", "documented", "communicated"],
    safeSupportVerbs: ["scheduled", "updated", "maintained", "verified", "documented"],
  },
  design: {
    titles: ["designer", "graphic designer", "ui designer", "ux designer", "product designer", "visual designer", "junior graphic designer"],
    signals: ["figma", "photoshop", "illustrator", "wireframes", "prototypes", "ui", "ux", "design system", "mockups", "visual design", "brand assets", "social media design", "print materials", "canva", "brochure", "banner"],
    keywords: ["Figma", "wireframing", "prototyping", "design systems", "UI design", "UX design", "user flows", "visual design", "Adobe Creative Suite", "mockups"],
    verbs: ["designed", "created", "developed", "prepared", "produced", "refined", "updated"],
    safeSupportVerbs: ["prepared", "produced", "updated", "collaborated with"],
  },
  engineering_construction: {
    titles: ["civil engineer", "site engineer", "construction engineer", "mechanical engineer", "design engineer", "maintenance engineer", "production engineer", "industrial engineer"],
    signals: ["autocad", "revit", "primavera p6", "site supervision", "technical drawings", "quantity takeoff", "boq", "construction documentation", "inspection", "solidworks", "preventive maintenance", "root cause analysis", "quality checks"],
    keywords: ["AutoCAD", "Revit", "Primavera P6", "site supervision", "quantity takeoff", "BOQ", "technical documentation", "SolidWorks", "preventive maintenance", "equipment inspection"],
    verbs: ["reviewed", "prepared", "coordinated", "tracked", "inspected", "documented", "designed"],
    safeSupportVerbs: ["reviewed", "prepared", "coordinated", "tracked", "documented"],
  },
  generic: {
    titles: [],
    signals: ["documentation", "reporting", "coordination", "analysis", "communication", "scheduling", "tracking", "records", "support"],
    keywords: ["documentation", "cross-functional collaboration", "process tracking", "stakeholder communication", "task coordination", "time management", "reporting", "record maintenance"],
    verbs: ["coordinated", "prepared", "tracked", "maintained", "documented", "updated", "organized"],
    safeSupportVerbs: ["coordinated", "prepared", "tracked", "maintained", "documented"],
  },
};

const HARD_FACT_TERMS = uniqueTrimmedStrings([
  "google ads","meta ads","google analytics","ga4","google tag manager","seo","sem","ppc","hubspot","salesforce","crm","zendesk","freshdesk","jira","confluence","tableau","power bi","looker studio","excel","google sheets","sql","python","javascript","typescript","react","node.js","java","c#","aws","azure","gcp","docker","kubernetes","git","ci/cd","rest api","microservices","unit testing","integration testing","selenium","cypress","postman","figma","photoshop","illustrator","autocad","solidworks","revit","primavera p6","sap","oracle","quickbooks","netsuite","erp","ifrs","gaap","accounts payable","accounts receivable","payroll","forecasting","variance analysis","budgeting","audit","reconciliation","workday","greenhouse","ats","agile","scrum","kanban","lean","six sigma","pmp","csm","psm","etl","data modeling","ehr","emr","hipaa","inventory management","warehouse operations","procurement","sourcing","vendor management","csat","nps","qbr","a/b test","lead generation","boq","rfq"
]);

const BRAND_TERMS = new Set([
  "google ads","meta ads","google analytics","ga4","google tag manager","hubspot","salesforce","zendesk","freshdesk","jira","confluence","tableau","power bi","looker studio","react","node.js","aws","azure","gcp","docker","kubernetes","selenium","cypress","postman","figma","photoshop","illustrator","autocad","solidworks","revit","primavera p6","sap","oracle","quickbooks","netsuite","workday","greenhouse"
].map(canonicalizeTerm));

const TERM_DISPLAY_MAP = new Map([
  ["rfq", "RFQ"],
  ["ga4", "GA4"],
  ["ci/cd", "CI/CD"],
  ["ehr", "EHR"],
  ["emr", "EMR"],
  ["hipaa", "HIPAA"],
  ["sql", "SQL"],
  ["ui design", "UI design"],
  ["ux design", "UX design"],
  ["request for quotation", "RFQ"],
  ["purchase order", "purchase orders"],
  ["purchase orders", "purchase orders"],
  ["purchase order processing", "purchase orders"],
]);

const JD_FREE_BLOCKLIST = {
  customer_support: new Set(["sales pipeline","proposal preparation","deal tracking","crm segmentation","sla"]),
  design: new Set(["ui design","ux design","design systems","user flows","wireframing","prototyping","mockups"]),
  healthcare_administration: new Set(["hipaa","ehr","emr","insurance verification","meeting coordination","travel coordination","clinical documentation"]),
};

const TERM_EVIDENCE_RULES = {
  procurement_supply_chain: {
    "rfq": ["rfq","quotation","quote","request for quotation"],
    "shipment tracking": ["shipment","delivery","dispatch","carrier","tracking"],
    "purchase orders": ["purchase order","purchase orders","order confirmations","po"],
    "erp systems": ["erp","sap","oracle","netsuite"],
    "sourcing": ["sourcing","source","supplier","vendor","quote","quotation"],
  },
  customer_support: {
    "sla": ["sla"],
    "sales pipeline": ["pipeline","sales","lead","opportunity"],
    "proposal preparation": ["proposal","quote","quotation"],
    "deal tracking": ["deal","opportunity","proposal","quote"],
    "crm segmentation": ["segment","segmentation"],
    "account management": ["assigned customer accounts","customer accounts","account managers"],
    "customer onboarding": ["onboarding","setup","checklist"],
    "case follow-up": ["case","ticket","follow-up","follow up","issue status"],
  },
  design: {
    "ui design": ["ui","user interface"],
    "ux design": ["ux","user experience"],
    "design systems": ["design system","component library"],
    "user flows": ["user flow","user flows"],
    "wireframing": ["wireframe","wireframing"],
    "prototyping": ["prototype","prototyping"],
    "mockups": ["mockup","mockups"],
  },
  healthcare_administration: {
    "hipaa": ["hipaa"],
    "ehr": ["ehr"],
    "emr": ["emr"],
    "insurance verification": ["insurance","verification"],
    "clinical documentation": ["clinical","patient records","medical records"],
    "patient scheduling": ["appointment","scheduling","booking","rescheduling"],
  },
};

const ROLE_FORBIDDEN_PATTERNS = {
  customer_support: [/\bsales pipeline\b/i, /\bproposal preparation\b/i, /\bdeal tracking\b/i, /\bcrm segmentation\b/i, /\bduring first touchpoints\b/i, /\benable initial usage\b/i, /\bcommunicated standard product workflows\b/i],
  design: [/\bui design\b/i, /\bux design\b/i, /\bdesign systems\b/i, /\buser flows\b/i, /\bwireframing\b/i, /\bprototyping\b/i, /\bmockups\b/i, /\bmarketing channels\b/i],
  healthcare_administration: [/\bhipaa\b/i, /\behr\b/i, /\bemr\b/i, /\binsurance verification\b/i, /\bclinic intake\b/i, /\bregistration verification\b/i, /^scheduled the administrative team\b/i],
};

function escapeRegex(str = "") {
  return String(str).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function normalizeSpace(str = "") {
  return String(str || "")
    .replace(/\r/g, "")
    .replace(/\u00A0/g, " ")
    .replace(/[\t\f\v]+/g, " ")
    .replace(/[ ]{2,}/g, " ")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function normalizeCompareText(str = "") {
  return String(str || "")
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[“”‘’]/g, "'")
    .replace(/[—–]/g, "-")
    .replace(/[^\p{L}\p{N}\s+%/#&.,()'’/-]/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function canonicalizeTerm(str = "") {
  let s = normalizeCompareText(str).replace(/[\/_-]+/g, " ").replace(/\s+/g, " ").trim();
  const replacements = [
    [/google analytics 4|ga 4/g, "ga4"],
    [/google tag manager|gtm/g, "google tag manager"],
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
    [/customer service/g, "customer support"],
    [/talent acquisition/g, "recruiting"],
    [/electronic health record/g, "ehr"],
    [/electronic medical record/g, "emr"],
    [/c sharp/g, "c#"],
    [/request for quotation(?:s)?/g, "rfq"],
    [/quotation requests?/g, "rfq"],
    [/purchase order(?:s)?(?: po)? processing/g, "purchase orders"],
    [/\bpo\b/g, "purchase orders"],
  ];
  for (const [re, to] of replacements) s = s.replace(re, to);
  return s.replace(/\s+/g, " ").trim();
}

function formatDisplayTerm(term = "") {
  const cleaned = String(term || "").trim();
  const canonical = canonicalizeTerm(cleaned);
  return TERM_DISPLAY_MAP.get(canonical) || cleaned;
}

function uniqueByNormalizedStrings(arr = []) {
  const seen = new Set();
  const out = [];
  for (const item of Array.isArray(arr) ? arr : []) {
    const value = formatDisplayTerm(String(item || "").trim());
    const norm = canonicalizeTerm(value);
    if (!value || !norm || seen.has(norm)) continue;
    seen.add(norm);
    out.push(value);
  }
  return out;
}

function containsCanonicalTermInText(text = "", term = "") {
  const hay = canonicalizeTerm(text);
  const needle = canonicalizeTerm(term);
  if (!hay || !needle) return false;
  if (needle.includes(" ")) return hay.includes(needle);
  return new RegExp(`(?:^|\\s)${escapeRegex(needle)}(?:$|\\s)`, "i").test(hay);
}

function countTermHits(text = "", terms = []) {
  const hay = canonicalizeTerm(text);
  return uniqueTrimmedStrings(terms).reduce((sum, term) => sum + (containsCanonicalTermInText(hay, term) ? 1 : 0), 0);
}

function countOccurrencesNormalized(text = "", term = "") {
  const hay = canonicalizeTerm(text);
  const needle = canonicalizeTerm(term);
  if (!hay || !needle) return 0;
  if (needle.includes(" ")) {
    let idx = 0;
    let count = 0;
    while ((idx = hay.indexOf(needle, idx)) !== -1) {
      count += 1;
      idx += needle.length;
    }
    return count;
  }
  const matches = hay.match(new RegExp(`(?:^|\\s)${escapeRegex(needle)}(?:$|\\s)`, "gi"));
  return Array.isArray(matches) ? matches.length : 0;
}

function countWords(str = "") {
  return String(str || "").trim().split(/\s+/).filter(Boolean).length;
}

function clampScore(n) {
  const x = Number(n);
  if (!Number.isFinite(x)) return 0;
  return Math.max(0, Math.min(100, Math.round(x)));
}

function getNonEmptyLines(str = "") {
  return normalizeSpace(str).split("\n").map((line) => line.trim()).filter(Boolean);
}

function getBulletLines(str = "") {
  return normalizeSpace(str).split("\n").map((line) => line.trim()).filter((line) => BULLET_RE.test(line)).map((line) => line.replace(BULLET_RE, "").trim()).filter(Boolean);
}

function tokenizeForSimilarity(str = "") {
  return canonicalizeTerm(str).split(/\s+/).map((x) => x.trim()).filter((x) => x.length > 1);
}

function jaccardSimilarity(a = "", b = "") {
  const aSet = new Set(tokenizeForSimilarity(a));
  const bSet = new Set(tokenizeForSimilarity(b));
  if (!aSet.size || !bSet.size) return 0;
  let intersection = 0;
  for (const token of aSet) if (bSet.has(token)) intersection += 1;
  const union = new Set([...aSet, ...bSet]).size;
  return union ? intersection / union : 0;
}

function capitalizeFirst(str = "") {
  const s = String(str || "").trim();
  return s ? s.charAt(0).toUpperCase() + s.slice(1) : s;
}

function lowerFirst(str = "") {
  const s = String(str || "").trim();
  return s ? s.charAt(0).toLowerCase() + s.slice(1) : s;
}

function isSectionHeader(line = "") {
  return HEADER_SECTION_RE.test(String(line || "").trim());
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
    if (inSkills) out.push(line.replace(BULLET_RE, "").trim());
  }
  return out.filter(Boolean);
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
    if (inSummary) out.push(...line.split(/(?<=[.?!])\s+/).map((x) => x.trim()).filter(Boolean));
  }
  return out;
}

function extractWeakCandidatePools(cv = "") {
  const lines = getNonEmptyLines(cv);
  const experienceBullets = [];
  const otherBullets = [];
  let section = "header";
  for (const line of lines) {
    if (isSectionHeader(line)) {
      if (/^(EXPERIENCE|WORK EXPERIENCE|PROFESSIONAL EXPERIENCE|DENEYİM|İŞ DENEYİMİ)$/i.test(line)) section = "experience";
      else if (/^(PROFESSIONAL SUMMARY|SUMMARY|PROFILE|PROFESYONEL ÖZET|ÖZET|PROFİL)$/i.test(line)) section = "summary";
      else section = "other";
      continue;
    }
    if (!BULLET_RE.test(line)) continue;
    const bullet = line.replace(BULLET_RE, "").trim();
    if (!bullet) continue;
    if (section === "experience") experienceBullets.push(bullet);
    else otherBullets.push(bullet);
  }
  return { experienceBullets, summaryLines: extractSummaryLines(cv), otherBullets };
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

function extractExperienceTitles(cv = "") {
  const lines = getNonEmptyLines(cv);
  const titles = [];
  for (let i = 1; i < lines.length; i += 1) {
    const line = lines[i];
    if (/\|\s*.*(\d{4}|Present|Current|Günümüz|Devam)/i.test(line) || /(\d{4}).*(Present|Current|Günümüz|Devam)/i.test(line)) {
      const prev = lines[i - 1];
      if (prev && !isSectionHeader(prev) && !prev.includes("@") && !/^\d/.test(prev)) titles.push(prev);
    }
  }
  return titles;
}

function normalizeOptimizedHeadings(text = "", outLang = "English") {
  const headings = HEADING_SETS[outLang] || HEADING_SETS.English;
  return normalizeSpace(String(text || ""))
    .replace(/^PROFILE$/gim, headings.summary)
    .replace(/^CORE SUMMARY$/gim, headings.summary)
    .replace(/^SUMMARY$/gim, headings.summary)
    .replace(/^WORK EXPERIENCE$/gim, headings.experience)
    .replace(/^PROFESSIONAL EXPERIENCE$/gim, headings.experience)
    .replace(/^(CORE SKILLS|TECHNICAL SKILLS|COMPETENCIES)$/gim, headings.skills)
    .replace(/^LICENSES$/gim, headings.certifications)
    .replace(/^BİLDİĞİ DİLLER$/gim, headings.languages)
    .replace(/^YETENEKLER$/gim, headings.skills)
    .replace(/^BECERİLER$/gim, headings.skills)
    .replace(/^PROFİL$/gim, headings.summary)
    .replace(/^İŞ DENEYİMİ$/gim, headings.experience)
    .trim();
}

function replaceHeaderBlock(originalCv = "", optimizedCv = "") {
  const originalHeader = extractHeaderBlock(originalCv);
  if (!originalHeader.length) return normalizeSpace(optimizedCv);
  const lines = normalizeSpace(optimizedCv).split("\n");
  const sectionIdx = lines.findIndex((line) => isSectionHeader(line));
  if (sectionIdx === -1) return normalizeSpace(optimizedCv);
  return `${originalHeader.join("\n")}\n\n${lines.slice(sectionIdx).join("\n").trim()}`.trim();
}

function restoreExperienceTitles(originalCv = "", optimizedCv = "") {
  const originalTitles = extractExperienceTitles(originalCv);
  if (!originalTitles.length) return normalizeSpace(optimizedCv);
  const lines = normalizeSpace(optimizedCv).split("\n");
  let titleIndex = 0;
  for (let i = 1; i < lines.length; i += 1) {
    const line = String(lines[i] || "").trim();
    if (/\|\s*.*(\d{4}|Present|Current|Günümüz|Devam)/i.test(line) || /(\d{4}).*(Present|Current|Günümüz|Devam)/i.test(line)) {
      let j = i - 1;
      while (j >= 0 && !String(lines[j] || "").trim()) j -= 1;
      if (j >= 0 && titleIndex < originalTitles.length) {
        lines[j] = originalTitles[titleIndex];
        titleIndex += 1;
      }
    }
  }
  return lines.join("\n").replace(/\n{3,}/g, "\n\n").trim();
}

function forceSafeResume(originalCv = "", optimizedCv = "", outLang = "English") {
  let out = normalizeOptimizedHeadings(optimizedCv, outLang);
  out = replaceHeaderBlock(originalCv, out);
  out = restoreExperienceTitles(originalCv, out);
  out = normalizeOptimizedHeadings(out, outLang);
  return out.trim();
}

function countUnchangedBullets(originalCv = "", optimizedCv = "") {
  const orig = getBulletLines(originalCv).map(canonicalizeTerm).filter(Boolean);
  const optSet = new Set(getBulletLines(optimizedCv).map(canonicalizeTerm).filter(Boolean));
  let same = 0;
  for (const item of orig) if (optSet.has(item)) same += 1;
  return { same, total: orig.length };
}

function looksLikeAcronym(term = "") {
  const s = String(term || "").trim();
  return ACRONYM_RE.test(s) || /^[A-Z0-9/+.#-]{2,12}$/.test(s);
}

function looksLikeCertification(term = "") {
  return CERTIFICATION_RE.test(String(term || "").trim());
}

function isBrandedOrVendorSpecific(term = "") {
  return BRAND_TERMS.has(canonicalizeTerm(term));
}

function cleanKeywordCandidate(term = "") {
  return String(term || "").replace(/\r/g, " ").replace(/^[-•·‣▪▫◦*0-9.)\s]+/, "").replace(/\s+/g, " ").replace(/^[,;:]+|[,;:]+$/g, "").trim();
}

function isLowValueKeyword(term = "") {
  const cleaned = cleanKeywordCandidate(term);
  if (!cleaned) return true;
  const norm = canonicalizeTerm(cleaned);
  const wc = countWords(cleaned);
  if (wc === 1 && norm.length < 4 && !looksLikeAcronym(cleaned)) return true;
  if (LOW_VALUE_KEYWORD_RE.test(cleaned) && wc <= 3) return true;
  return /^(experience|knowledge|skills|skill|management|analysis|support|reporting|communication|documentation|tecrube|deneyim|beceri|yetenek|analiz|destek|raporlama)$/i.test(norm);
}

function looksLikeSkillFragment(sentence = "") {
  const s = String(sentence || "").trim();
  if (!s) return false;
  const wc = countWords(s);
  if (wc > 4) return false;
  if (/[.?!,:;]/.test(s)) return false;
  if (WEAK_VERB_RE.test(s) || STRONG_ACTION_RE.test(s)) return false;
  const canonical = canonicalizeTerm(s);
  if (/^(record keeping|team coordination|supplier communication|customer communication|time management|problem solving|leadership|attention to detail|microsoft office|basic microsoft office|responsibility|organization|organizational skills?)$/.test(canonical)) return true;
  return s.split(/\s+/).every((token) => /^[A-ZÇĞİÖŞÜa-zçğıöşü][A-Za-zÇĞİÖŞÜa-zçğıöşü-]*$/.test(token));
}

function extractExplicitFactTerms(text = "") {
  const hay = canonicalizeTerm(text);
  return HARD_FACT_TERMS.filter((term, idx, arr) => arr.indexOf(term) === idx && containsCanonicalTermInText(hay, term));
}

function inferSeniority(text = "") {
  const norm = normalizeCompareText(text);
  if (/\b(chief|vp|vice president|director|head of|general manager)\b/i.test(norm)) return "leadership";
  if (/\b(principal|staff engineer|lead|manager|team lead|supervisor)\b/i.test(norm)) return "manager_or_lead";
  if (/\b(senior|sr\.?|kidemli|uzman)\b/i.test(norm)) return "senior";
  if (/\b(intern|stajyer|junior|jr\.?|assistant|associate|trainee|entry level)\b/i.test(norm)) return "junior";
  return "mid";
}

function inferRoleProfile(cv = "", jd = "") {
  const combined = `${cv || ""}\n${jd || ""}`;
  const titleText = `${extractHeaderBlock(cv).join(" ")} ${extractExperienceTitles(cv).join(" ")}`.trim();
  const skillsText = getSkillsLines(cv).join(" ");
  const summaryText = extractSummaryLines(cv).join(" ");
  const bulletText = getBulletLines(cv).join(" ");
  const scored = Object.entries(ROLE_TAXONOMY)
    .filter(([key]) => key !== "generic")
    .map(([key, role]) => {
      const titleHits = countTermHits(titleText, role.titles || []);
      const signalHits = countTermHits(combined, role.signals || []);
      const keywordHits = countTermHits(combined, role.keywords || []);
      const skillHits = countTermHits(skillsText, [...(role.signals || []), ...(role.keywords || [])]);
      const summaryHits = countTermHits(summaryText, [...(role.titles || []), ...(role.signals || []), ...(role.keywords || [])]);
      const bulletHits = countTermHits(bulletText, role.signals || []);
      const score = titleHits * 9 + skillHits * 5 + signalHits * 4 + keywordHits * 3 + summaryHits * 3 + bulletHits * 2;
      return { key, score, titleHits, skillHits, signalHits };
    })
    .filter((item) => item.score > 0)
    .sort((a, b) => b.score - a.score);

  const top = scored[0]?.score || 0;
  const roleGroups = scored
    .filter((item, idx) => idx === 0 || item.score >= Math.max(8, top - 6) || item.titleHits >= 1 || item.skillHits >= 2 || item.signalHits >= 3)
    .slice(0, jd ? 3 : 2)
    .map((item) => item.key);

  const finalGroups = roleGroups.length ? roleGroups : ["generic"];
  const packs = finalGroups.map((key) => ROLE_TAXONOMY[key]).filter(Boolean);
  const domainSignals = uniqueTrimmedStrings(packs.flatMap((role) => [...(role.signals || []), ...(role.keywords || [])])).filter((term) => containsCanonicalTermInText(combined, term)).slice(0, 18);

  return {
    roleGroups: finalGroups,
    primaryRole: finalGroups[0] || "generic",
    secondaryRoles: finalGroups.slice(1),
    seniority: inferSeniority(`${titleText}\n${combined}`),
    domainSignals,
  };
}

function ensureRoleProfile(roleInput, cv = "", jd = "") {
  if (roleInput && typeof roleInput === "object" && Array.isArray(roleInput.roleGroups)) return roleInput;
  return inferRoleProfile(cv, jd);
}

function getRolePacks(roleInput, cv = "", jd = "") {
  const profile = ensureRoleProfile(roleInput, cv, jd);
  const packs = (profile.roleGroups || ["generic"]).map((key) => ROLE_TAXONOMY[key]).filter(Boolean);
  return packs.length ? packs : [ROLE_TAXONOMY.generic];
}

function getRoleSuggestedKeywords(roleInput, cv = "", jd = "") {
  const profile = ensureRoleProfile(roleInput, cv, jd);
  const packs = getRolePacks(profile, cv, jd);
  let out = uniqueTrimmedStrings(packs.flatMap((role) => role.keywords || []));
  if (profile.seniority === "manager_or_lead" || profile.seniority === "leadership") out = uniqueTrimmedStrings(["stakeholder communication", "cross-functional collaboration", "process improvement", ...out]);
  if (profile.seniority === "junior") out = uniqueTrimmedStrings([...out, "documentation", "process adherence", "task coordination", "quality checks"]);
  return out;
}

function hasEvidenceForTerm(term = "", roleProfile, cv = "", jd = "") {
  const profile = ensureRoleProfile(roleProfile, cv, jd);
  const canonical = canonicalizeTerm(term);
  if (containsCanonicalTermInText(cv, canonical) || containsCanonicalTermInText(jd, canonical)) return true;
  const rules = TERM_EVIDENCE_RULES[profile.primaryRole] || {};
  const evidence = rules[canonical];
  if (!evidence) return false;
  const combined = `${cv}\n${jd}`;
  return evidence.every((signal) => containsCanonicalTermInText(combined, signal));
}

function shouldBlockCvOnlySuggestion(term = "", roleProfile, cv = "") {
  const profile = ensureRoleProfile(roleProfile, cv, "");
  const set = JD_FREE_BLOCKLIST[profile.primaryRole];
  return !!set && set.has(canonicalizeTerm(term)) && !hasEvidenceForTerm(term, profile, cv, "");
}

function buildRoleContextText(roleInput, cv = "", jd = "") {
  const profile = ensureRoleProfile(roleInput, cv, jd);
  const packs = getRolePacks(profile, cv, jd);
  const suggested = getRoleSuggestedKeywords(profile, cv, jd).slice(0, 12);
  const verbs = uniqueTrimmedStrings(packs.flatMap((role) => [...(role.verbs || []), ...(role.safeSupportVerbs || [])])).slice(0, 12);
  return [
    `- primary_role: ${profile.primaryRole}`,
    `- secondary_roles: ${(profile.secondaryRoles || []).join(", ") || "(none)"}`,
    `- seniority_signal: ${profile.seniority || "mid"}`,
    `- detected_role_signals: ${(profile.domainSignals || []).join(", ") || "(none)"}`,
    `- likely_keyword_themes: ${suggested.join(", ") || "(none)"}`,
    `- preferred_truthful_verbs: ${verbs.join(", ") || "coordinated, prepared, tracked, maintained"}`,
  ].join("\n");
}

function buildRoleWritingBlock(roleInput, cv = "", jd = "") {
  const profile = ensureRoleProfile(roleInput, cv, jd);
  const packs = getRolePacks(profile, cv, jd);
  const verbs = uniqueTrimmedStrings(packs.flatMap((role) => [...(role.verbs || []), ...(role.safeSupportVerbs || [])])).slice(0, 20);
  return [
    "ROLE WRITING RULES:",
    `- Primary role family: ${profile.primaryRole}`,
    `- Seniority signal: ${profile.seniority}`,
    `- Prefer truthful verbs such as: ${verbs.join(", ") || "coordinated, prepared, tracked, maintained"}`,
    "- Preserve the native terminology of the profession.",
    "- Do not convert technical, finance, healthcare, education, legal, or engineering bullets into generic business language.",
    "- If the original is support-level work, keep it support-level but sharper and more specific.",
    "- Do not invent leadership, ownership, tools, metrics, scale, or business outcomes.",
  ].join("\n");
}

function buildRoleGuardrails(roleInput, cv = "", jd = "", hasJD = false) {
  const profile = ensureRoleProfile(roleInput, cv, jd);
  const lines = [
    "ROLE-SPECIFIC GUARDRAILS:",
    "- Short noun fragments such as skill labels are not weak sentences and must not appear in weak phrase output.",
    "- Do not invent adjacent-field keywords just because they are commonly related to the role.",
  ];
  if (profile.primaryRole === "customer_support") {
    lines.push("- For customer support / customer success, do not drift into sales/account executive language such as sales pipeline, proposal preparation, or deal tracking unless explicitly supported.");
    lines.push("- Do not add SLA or CRM segmentation unless those concepts already exist in the resume or JD.");
    lines.push("- Avoid awkward phrases like 'during first touchpoints' or 'enable initial usage'.");
  }
  if (profile.primaryRole === "design") {
    lines.push("- For graphic/visual design resumes, do not add UI/UX/product design terms such as UI design, UX design, design systems, user flows, wireframing, prototyping, or mockups unless explicitly supported.");
    lines.push("- Do not inject marketing-channel context or tool-specific phrasing into a bullet unless the original bullet directly supports it.");
  }
  if (profile.primaryRole === "healthcare_administration") {
    lines.push("- For healthcare admin / patient coordinator resumes, do not add HIPAA, EHR/EMR, insurance verification, clinic intake, or registration verification unless explicitly supported.");
    lines.push("- Do not turn generic office/team support into unnatural verbs such as 'Scheduled the administrative team...'.");
  }
  if (profile.primaryRole === "procurement_supply_chain") {
    lines.push("- Deduplicate RFQ and Request for Quotation into a single keyword.");
    lines.push("- Do not treat short fragments such as Record Keeping, Team Coordination, or Supplier Communication as weak phrases.");
  }
  if (!hasJD) lines.push("- In JD-free mode, be conservative: only suggest absent keywords that are strongly implied by the actual resume evidence.");
  return lines.join("\n");
}

function looksLikeToolOrMethod(term = "", roleInput, cv = "", jd = "") {
  const profile = ensureRoleProfile(roleInput, cv, jd);
  const packs = getRolePacks(profile, cv, jd);
  const pool = uniqueTrimmedStrings([...HARD_FACT_TERMS, ...packs.flatMap((role) => [...(role.signals || []), ...(role.keywords || [])])]);
  const norm = canonicalizeTerm(term);
  return pool.some((item) => canonicalizeTerm(item) === norm);
}

function isSafeCvOnlySuggestedTerm(term = "", roleInput, cv = "") {
  const profile = ensureRoleProfile(roleInput, cv, "");
  const norm = canonicalizeTerm(term);
  if (!norm || isLowValueKeyword(term)) return false;
  if (containsCanonicalTermInText(cv, norm)) return false;
  if (isBrandedOrVendorSpecific(term)) return false;
  if (shouldBlockCvOnlySuggestion(norm, profile, cv)) return false;
  const roleThemes = getRoleSuggestedKeywords(profile, cv, "");
  const themeMatch = roleThemes.some((item) => canonicalizeTerm(item) === norm || canonicalizeTerm(item).includes(norm) || norm.includes(canonicalizeTerm(item)));
  const evidence = hasEvidenceForTerm(norm, profile, cv, "");
  if (looksLikeCertification(term)) return evidence || themeMatch;
  return evidence || (themeMatch && countTermHits(cv, profile.domainSignals || []) >= 2);
}

function extractAcronymLikeTerms(text = "") {
  return uniqueTrimmedStrings((String(text || "").match(/\b[A-Z]{2,}(?:\/[A-Z]{2,})?\b/g) || []).map((x) => x.trim()).filter((x) => x.length <= 12));
}

function extractSkillLikeNgrams(text = "") {
  const clauses = normalizeSpace(text).split(/[\n;•]/).map((x) => x.trim()).filter(Boolean).slice(0, 160);
  const hints = uniqueTrimmedStrings(["analysis","analytics","dashboard","reporting","forecasting","budgeting","reconciliation","audit","payable","receivable","payroll","recruiting","screening","onboarding","procurement","sourcing","vendor","inventory","warehouse","logistics","shipment","support","retention","renewal","patient","insurance","ehr","emr","testing","qa","quality","sql","python","javascript","typescript","react","node","api","microservices","cloud","docker","kubernetes","roadmap","backlog","stakeholder","scrum","agile","design","wireframe","prototype","figma","autocad","revit","solidworks","primavera","compliance","risk","release","deployment","schedule","coordination","documentation","etl","boq","rfq"]);
  const out = [];
  for (const clause of clauses) {
    const tokens = clause.replace(/[^\p{L}\p{N}\s/#&+.-]/gu, " ").split(/\s+/).map((x) => x.trim()).filter(Boolean);
    for (let n = 4; n >= 1; n -= 1) {
      for (let i = 0; i <= tokens.length - n; i += 1) {
        const phrase = tokens.slice(i, i + n).join(" ").trim();
        const norm = canonicalizeTerm(phrase);
        if (!norm) continue;
        const wc = countWords(phrase);
        if (wc < 1 || wc > 4) continue;
        if (isLowValueKeyword(phrase)) continue;
        const hasHint = hints.some((hint) => containsCanonicalTermInText(norm, hint));
        if (hasHint || looksLikeAcronym(phrase) || looksLikeCertification(phrase)) out.push(phrase);
      }
    }
  }
  return uniqueByNormalizedStrings(out).slice(0, 100);
}

function classifyTermCategory(term = "", roleInput, cv = "", jd = "") {
  const profile = ensureRoleProfile(roleInput, cv, jd);
  const norm = canonicalizeTerm(term);
  if (looksLikeCertification(term)) return "certification";
  if (HARD_FACT_TERMS.some((item) => canonicalizeTerm(item) === norm)) return "tool";
  const roleThemes = getRoleSuggestedKeywords(profile, cv, jd);
  if (roleThemes.some((item) => canonicalizeTerm(item) === norm)) return "domain";
  if (/\b(senior|lead|manager|director|principal|junior|associate|intern|uzman|kidemli|stajyer)\b/i.test(term)) return "seniority";
  return looksLikeToolOrMethod(term, profile, cv, jd) ? "methodology" : "responsibility";
}

function scoreExtractedTerm(term = "", text = "", roleInput, cv = "", jd = "") {
  const cleaned = cleanKeywordCandidate(term);
  if (!cleaned) return 0;
  let score = 0;
  const wc = countWords(cleaned);
  const norm = canonicalizeTerm(cleaned);
  if (isLowValueKeyword(cleaned)) score -= 12;
  if (wc >= 2 && wc <= 4) score += 4;
  else if (looksLikeAcronym(cleaned)) score += 3;
  if (looksLikeCertification(cleaned)) score += 5;
  if (HARD_FACT_TERMS.some((item) => canonicalizeTerm(item) === norm)) score += 6;
  if (countOccurrencesNormalized(text, cleaned) > 1) score += Math.min(4, countOccurrencesNormalized(text, cleaned) - 1);
  const cueBefore = new RegExp(`${JD_CUE_RE.source}[\\s\\S]{0,80}${escapeRegex(cleaned)}`, "i").test(String(text || ""));
  const cueAfter = new RegExp(`${escapeRegex(cleaned)}[\\s\\S]{0,40}${JD_CUE_RE.source}`, "i").test(String(text || ""));
  if (cueBefore || cueAfter) score += 3;
  return score;
}

function extractJdSignalProfile(jd = "", roleInput, cv = "") {
  if (!String(jd || "").trim()) return { ranked: [], tools: [], methodologies: [], certifications: [], responsibilities: [], domains: [], senioritySignals: [] };
  const profile = ensureRoleProfile(roleInput, cv, jd);
  const packs = getRolePacks(profile, cv, jd);
  const lexicon = uniqueTrimmedStrings([...HARD_FACT_TERMS, ...packs.flatMap((role) => [...(role.signals || []), ...(role.keywords || []), ...(role.titles || [])])]);
  const directMatches = lexicon.filter((term) => containsCanonicalTermInText(jd, term));
  const candidates = uniqueByNormalizedStrings([...directMatches, ...extractSkillLikeNgrams(jd), ...extractAcronymLikeTerms(jd)]);
  const ranked = candidates.map((term) => ({
    term: formatDisplayTerm(term),
    category: classifyTermCategory(term, profile, cv, jd),
    score: scoreExtractedTerm(term, jd, profile, cv, jd),
  })).filter((item) => item.score > 0).sort((a, b) => b.score - a.score).slice(0, 40);
  return {
    ranked,
    tools: ranked.filter((x) => x.category === "tool").slice(0, 10).map((x) => x.term),
    methodologies: ranked.filter((x) => x.category === "methodology").slice(0, 10).map((x) => x.term),
    certifications: ranked.filter((x) => x.category === "certification").slice(0, 8).map((x) => x.term),
    responsibilities: ranked.filter((x) => x.category === "responsibility").slice(0, 10).map((x) => x.term),
    domains: ranked.filter((x) => x.category === "domain").slice(0, 10).map((x) => x.term),
    senioritySignals: ranked.filter((x) => x.category === "seniority").slice(0, 6).map((x) => x.term),
  };
}

function buildJdSignalText(jd = "", roleInput, cv = "") {
  const sig = extractJdSignalProfile(jd, roleInput, cv);
  return [
    `- tools_platforms: ${sig.tools.join(", ") || "(none)"}`,
    `- methodologies_process: ${sig.methodologies.join(", ") || "(none)"}`,
    `- certifications_compliance: ${sig.certifications.join(", ") || "(none)"}`,
    `- responsibility_patterns: ${sig.responsibilities.join(", ") || "(none)"}`,
    `- domain_terms: ${sig.domains.join(", ") || "(none)"}`,
    `- seniority_signals: ${sig.senioritySignals.join(", ") || "(none)"}`,
  ].join("\n");
}

function buildAllowedTermsText(cv = "", jd = "") {
  const terms = uniqueByNormalizedStrings([...extractExplicitFactTerms(cv), ...extractExplicitFactTerms(jd)]);
  return terms.length ? terms.join(", ") : "(none explicitly supported)";
}

function findUnsupportedTerms(originalCv = "", jd = "", optimizedCv = "") {
  const allowed = new Set(uniqueByNormalizedStrings([...extractExplicitFactTerms(originalCv), ...extractExplicitFactTerms(jd)]).map(canonicalizeTerm));
  return uniqueByNormalizedStrings(extractExplicitFactTerms(optimizedCv)).filter((term) => !allowed.has(canonicalizeTerm(term)));
}

function finalizeMissingKeywords(rawKeywords = [], { cv = "", jd = "", roleInput, hasJD = false, limit = 12 } = {}) {
  const profile = ensureRoleProfile(roleInput, cv, jd);
  const cvNorm = canonicalizeTerm(cv);
  const modelTerms = uniqueByNormalizedStrings((Array.isArray(rawKeywords) ? rawKeywords : []).map(cleanKeywordCandidate).filter(Boolean));
  let pool = [...modelTerms];
  if (hasJD) {
    pool = uniqueByNormalizedStrings([...pool, ...extractJdSignalProfile(jd, profile, cv).ranked.map((item) => item.term)]);
  } else {
    pool = uniqueByNormalizedStrings([...pool, ...getRoleSuggestedKeywords(profile, cv, jd)]).filter((term) => isSafeCvOnlySuggestedTerm(term, profile, cv));
  }
  const scored = uniqueByNormalizedStrings(pool).map((term) => {
    const display = formatDisplayTerm(term);
    const norm = canonicalizeTerm(display);
    let score = 0;
    if (containsCanonicalTermInText(cvNorm, norm)) score -= hasJD ? 12 : 10; else score += 7;
    if (hasJD && containsCanonicalTermInText(jd, norm)) score += 10;
    if (!hasJD && !isSafeCvOnlySuggestedTerm(display, profile, cv)) score -= 20;
    if (HARD_FACT_TERMS.some((item) => canonicalizeTerm(item) === norm)) score += 6;
    if (looksLikeCertification(display)) score += 5;
    if (looksLikeToolOrMethod(display, profile, cv, jd)) score += 4;
    if (countWords(display) >= 2 && countWords(display) <= 4) score += 3;
    if (looksLikeAcronym(display)) score += 2;
    if (isLowValueKeyword(display)) score -= 14;
    if (!hasJD && isBrandedOrVendorSpecific(display)) score -= 20;
    if (!hasJD && shouldBlockCvOnlySuggestion(display, profile, cv)) score -= 25;
    return { term: display, score };
  }).filter((item) => item.score > -2).sort((a, b) => b.score - a.score || countWords(b.term) - countWords(a.term));
  return uniqueByNormalizedStrings(scored.map((item) => item.term)).slice(0, limit);
}

function getSentenceSignalProfile(sentence = "", roleInput, cv = "", jd = "") {
  const s = String(sentence || "").trim();
  if (!s || looksLikeSkillFragment(s)) return {
    isWeakCandidate: false, clearWeak: false, moderatelyWeak: false, candidateTier: "none",
    weakScore: 0, strongScore: 0, improvementPotential: 0, hasSpecific: false, startsWeak: false,
    hasWeakPhrase: false, strongAction: false, hasScopeSignal: false, genericTask: false,
    softActionStart: false, roleHits: 0, explicitFactsCount: 0, wordCount: countWords(s), isReasonablyStrong: false, genericSummary: false,
  };
  const profile = ensureRoleProfile(roleInput, cv, jd);
  const roleTerms = uniqueTrimmedStrings(getRolePacks(profile, cv, jd).flatMap((role) => [...(role.signals || []), ...(role.keywords || [])]));
  const wc = countWords(s);
  const explicitFacts = extractExplicitFactTerms(s);
  const acronymHits = extractAcronymLikeTerms(s).length;
  const roleHits = countTermHits(s, roleTerms);
  const hasNumber = /\b\d+(?:[.,]\d+)?%?\b/.test(s);
  const strongAction = STRONG_ACTION_RE.test(s);
  const startsWeak = WEAK_START_RE.test(s);
  const hasWeakPhrase = WEAK_VERB_RE.test(s);
  const genericSummary = /^(experienced|results[- ]driven|motivated|detail[- ]oriented|hardworking|dedicated|dynamic|versatile|organized|responsible|experienced professional|deneyimli|sonuç odaklı|motivasyonu yüksek|detay odaklı|çalışkan|disiplinli|öğrenmeye açık|sorumluluk sahibi)\b/i.test(s);
  const hasScopeSignal = SCOPE_CONTEXT_RE.test(s);
  const genericTask = GENERIC_TASK_RE.test(s);
  const softActionStart = /^(prepared|maintained|coordinated|tracked|updated|processed|documented|communicated|organized|reviewed|monitored|followed up on|responded to|scheduled|compiled|recorded|handled)\b/i.test(s);

  const explicitSpecificity = explicitFacts.length + acronymHits + (hasNumber ? 1 : 0);
  const hasSpecific = explicitSpecificity > 0 || roleHits >= 2 || (strongAction && roleHits >= 1 && hasScopeSignal);

  let strongScore = 0;
  let weakScore = 0;
  if (strongAction) strongScore += 3;
  if (hasNumber) strongScore += 2;
  if (explicitFacts.length > 0) strongScore += Math.min(3, explicitFacts.length);
  if (acronymHits > 0) strongScore += Math.min(2, acronymHits);
  if (roleHits > 0) strongScore += Math.min(4, roleHits);
  if (hasScopeSignal) strongScore += 1;
  if (wc >= 6 && wc <= 22) strongScore += 1;

  if (startsWeak) weakScore += 4;
  if (hasWeakPhrase) weakScore += 3;
  if (genericSummary) weakScore += 3;
  if (!hasSpecific) weakScore += 2;
  if (!strongAction) weakScore += 1;
  if (genericTask && !hasSpecific) weakScore += 2;
  if (softActionStart && !hasSpecific && roleHits <= 1) weakScore += 1;
  if (roleHits === 1 && !hasScopeSignal && explicitFacts.length === 0 && !hasNumber) weakScore += 1;
  if (wc <= 5) weakScore += 2; else if (wc <= 8 && !hasSpecific) weakScore += 1;
  if (wc > 28) weakScore += 1;

  if (hasSpecific && strongAction) weakScore -= 3;
  if (roleHits >= 2 && hasScopeSignal) weakScore -= 2;
  if (explicitFacts.length > 0) weakScore -= 1;
  if (genericTask && strongAction && roleHits >= 1 && hasScopeSignal) weakScore -= 1;

  const clearWeak = weakScore >= 8 || (startsWeak && (!hasSpecific || strongScore <= 4)) || (genericSummary && !hasSpecific) || (hasWeakPhrase && genericTask && strongScore <= 4);
  const moderatelyWeak = !clearWeak && (weakScore >= 5 || (weakScore >= 4 && (startsWeak || hasWeakPhrase || genericTask || !hasSpecific || softActionStart) && strongScore <= 6) || (softActionStart && !hasSpecific && roleHits <= 1 && wc <= 16));
  const isWeakCandidate = clearWeak || moderatelyWeak;
  const candidateTier = clearWeak ? "clear" : moderatelyWeak ? "moderate" : "none";
  const improvementPotential = Math.max(0, weakScore - Math.floor(strongScore / 2)) + (startsWeak ? 2 : 0) + (genericTask ? 1 : 0) + (!hasSpecific ? 1 : 0);
  const isReasonablyStrong = strongScore >= 6 && hasSpecific && !startsWeak && !hasWeakPhrase && !genericTask && wc >= 6 && wc <= 22;

  return { isWeakCandidate, clearWeak, moderatelyWeak, candidateTier, weakScore, strongScore, improvementPotential, hasSpecific, startsWeak, hasWeakPhrase, strongAction, hasScopeSignal, genericTask, softActionStart, roleHits, explicitFactsCount: explicitSpecificity, wordCount: wc, isReasonablyStrong, genericSummary };
}

function detectWeakSentenceCandidates(cv = "", roleInput, minCount = 6, maxCount = 12) {
  const pools = extractWeakCandidatePools(cv);
  const candidates = [
    ...pools.experienceBullets.map((sentence) => ({ sentence, sourceType: "experience_bullet", sectionPriority: 4 })),
    ...pools.summaryLines.map((sentence) => ({ sentence, sourceType: "summary_line", sectionPriority: 2 })),
    ...pools.otherBullets.map((sentence) => ({ sentence, sourceType: "other_bullet", sectionPriority: 0 })),
  ].filter((item) => !looksLikeSkillFragment(item.sentence));

  const ranked = candidates.map((item) => {
    const profile = getSentenceSignalProfile(item.sentence, roleInput, cv, "");
    const tierBoost = profile.candidateTier === "clear" ? 50 : profile.candidateTier === "moderate" ? 30 : 0;
    let rank = item.sectionPriority * 100 + tierBoost + profile.improvementPotential * 3 + (profile.startsWeak ? 8 : 0) + (profile.hasWeakPhrase ? 6 : 0) + (!profile.hasSpecific ? 4 : 0) + (profile.genericTask ? 5 : 0) - profile.strongScore * 2;
    if (/\b(team|support staff|internal service updates|daily tasks|routine communication|general support|various tasks|basic reporting)\b/i.test(item.sentence)) rank += 4;
    return { ...item, profile, rank };
  }).filter((item) => {
    if (item.profile.isReasonablyStrong) return false;
    if (item.profile.clearWeak || item.profile.moderatelyWeak) return true;
    if (item.sourceType === "experience_bullet") return item.profile.weakScore >= 3 && (item.profile.startsWeak || item.profile.hasWeakPhrase || item.profile.genericTask || !item.profile.hasSpecific);
    if (item.sourceType === "summary_line") return item.profile.weakScore >= 4 || (item.profile.genericTask && !item.profile.hasSpecific);
    return item.profile.weakScore >= 5;
  }).sort((a, b) => {
    const tierOrder = { clear: 2, moderate: 1, none: 0 };
    return b.rank - a.rank || tierOrder[b.profile.candidateTier] - tierOrder[a.profile.candidateTier] || b.profile.improvementPotential - a.profile.improvementPotential || b.profile.weakScore - a.profile.weakScore || a.profile.strongScore - b.profile.strongScore;
  });

  const out = [];
  const seen = new Set();
  for (const item of ranked) {
    const key = canonicalizeTerm(item.sentence);
    if (!key || seen.has(key)) continue;
    seen.add(key);
    out.push(item.sentence);
    if (out.length >= maxCount) break;
  }
  return out.length >= minCount ? out : out.slice(0, maxCount);
}

function splitSentenceEnding(str = "") {
  const s = String(str || "").trim();
  const m = s.match(/[.?!]+$/);
  return { body: s.replace(/[.?!]+$/, "").trim(), ending: m ? m[0] : "." };
}

function stripLeadingWeakPhrase(text = "") {
  const s = String(text || "").trim();
  const patterns = [/^helped with\s+/i,/^helped to\s+/i,/^helped\s+/i,/^assisted with\s+/i,/^assisted\s+/i,/^supported with\s+/i,/^supported\s+/i,/^worked on\s+/i,/^responsible for\s+/i,/^contributed to\s+/i,/^participated in\s+/i,/^involved in\s+/i,/^provided support for\s+/i,/^provided support to\s+/i,/^provided support\s+/i,/^handled\s+/i,/^tasked with\s+/i,/^duties included\s+/i,/^yardımcı oldum\s+/i,/^destek verdim\s+/i,/^görev aldım\s+/i,/^çalıştım\s+/i,/^yaptım\s+/i,/^sorumluydum\s+/i];
  let out = s;
  for (const re of patterns) { if (re.test(out)) { out = out.replace(re, "").trim(); break; } }
  return out;
}

function getTokenDeltaMetrics(source = "", rewrite = "") {
  const sourceSet = new Set(tokenizeForSimilarity(source));
  const rewriteSet = new Set(tokenizeForSimilarity(rewrite));
  const added = [...rewriteSet].filter((token) => !sourceSet.has(token));
  const removed = [...sourceSet].filter((token) => !rewriteSet.has(token));
  return { added, removed, addedCount: added.length, removedCount: removed.length, totalDelta: added.length + removed.length };
}

function hasUnsupportedSpecificityInWeakRewrite(source = "", rewrite = "", cv = "", jd = "") {
  const sourceHasNumber = /\b\d+(?:[.,]\d+)?%?\b/.test(source);
  const rewriteHasNumber = /\b\d+(?:[.,]\d+)?%?\b/.test(rewrite);
  if (rewriteHasNumber && !sourceHasNumber) return true;
  const allowed = new Set(uniqueTrimmedStrings([...extractExplicitFactTerms(source), ...extractExplicitFactTerms(cv), ...extractExplicitFactTerms(jd), ...extractAcronymLikeTerms(source), ...extractAcronymLikeTerms(cv), ...extractAcronymLikeTerms(jd)]).map(canonicalizeTerm));
  const rewriteTerms = uniqueTrimmedStrings([...extractExplicitFactTerms(rewrite), ...extractAcronymLikeTerms(rewrite)]);
  return rewriteTerms.some((term) => !allowed.has(canonicalizeTerm(term)));
}

function countMeaningfulRewriteImprovements(source = "", rewrite = "", roleInput, cv = "", jd = "") {
  const sourceProfile = getSentenceSignalProfile(source, roleInput, cv, jd);
  const rewriteProfile = getSentenceSignalProfile(rewrite, roleInput, cv, jd);
  let improvements = 0;
  if (!rewriteProfile.startsWeak && sourceProfile.startsWeak) improvements += 1;
  if (rewriteProfile.strongScore >= sourceProfile.strongScore + 2 || (rewriteProfile.strongAction && (sourceProfile.startsWeak || sourceProfile.hasWeakPhrase || !sourceProfile.strongAction))) improvements += 1;
  if ((rewriteProfile.hasSpecific && !sourceProfile.hasSpecific) || rewriteProfile.roleHits > sourceProfile.roleHits || rewriteProfile.explicitFactsCount > sourceProfile.explicitFactsCount) improvements += 1;
  if ((rewriteProfile.hasScopeSignal && !sourceProfile.hasScopeSignal) || (rewriteProfile.wordCount >= 6 && rewriteProfile.wordCount <= 20 && (sourceProfile.wordCount < 6 || sourceProfile.wordCount > 22))) improvements += 1;
  if (rewriteProfile.weakScore <= sourceProfile.weakScore - 2) improvements += 1;
  return improvements;
}

function containsRoleUnsafeRewritePhrase(rewrite = "", roleInput, source = "", cv = "", jd = "") {
  const profile = ensureRoleProfile(roleInput, cv, jd);
  const patterns = ROLE_FORBIDDEN_PATTERNS[profile.primaryRole] || [];
  return patterns.some((re) => {
    if (!re.test(rewrite)) return false;
    const raw = re.source.replace(/\\b/g, "").replace(/[()^$?+:|\\]/g, " ").trim();
    return !(raw && (containsCanonicalTermInText(source, raw) || containsCanonicalTermInText(cv, raw) || containsCanonicalTermInText(jd, raw)));
  });
}

function rewriteStillFeelsWeak(rewrite = "", roleInput, cv = "", jd = "", source = "") {
  const profile = getSentenceSignalProfile(rewrite, roleInput, cv, jd);
  if (WEAK_START_RE.test(rewrite) || WEAK_VERB_RE.test(rewrite)) return true;
  if (profile.startsWeak || profile.hasWeakPhrase) return true;
  if (profile.isWeakCandidate && profile.weakScore >= 5) return true;
  if (looksLikeSkillFragment(rewrite)) return true;
  if (containsRoleUnsafeRewritePhrase(rewrite, roleInput, source, cv, jd)) return true;
  return false;
}

function pickRoleAwareRewriteVerb(sentence = "", roleInput, cv = "", jd = "") {
  const packs = getRolePacks(roleInput, cv, jd);
  if (/\b(team|teams?)\b.*\b(task|tasks|workflow|operations|periods)\b/i.test(sentence) || /\boperational tasks?\b/i.test(sentence) || /\boffice coordination\b/i.test(sentence)) return "Coordinated";
  if (/(appointment|schedule|calendar|meeting|travel|interview scheduling)/i.test(sentence)) return "Scheduled";
  if (/(email|live chat|inquir|customer emails?|chat channels?)/i.test(sentence)) return "Responded to";
  if (/(ticket|case|issue|escalat|follow-?up|status)/i.test(sentence)) return "Coordinated";
  if (/(records?|documentation|logs?|notes?|files?|paperwork)/i.test(sentence)) return "Maintained";
  if (/(reports?|summary|summaries|dashboard)/i.test(sentence)) return "Prepared";
  if (/(communication)/i.test(sentence)) return "Coordinated";
  if (/(invoice|order|request|processing|account updates?)/i.test(sentence)) return "Processed";
  if (/(analysis|reconciliation|audit|review|validation)/i.test(sentence)) return "Reviewed";
  if (/(testing|qa|defect|bug|test cases?)/i.test(sentence)) return "Executed";
  if (/(backend|api|integration|feature|code|application|system)/i.test(sentence)) return "Implemented";
  const verbs = uniqueTrimmedStrings(packs.flatMap((role) => [...(role.safeSupportVerbs || []), ...(role.verbs || [])])).filter((verb) => !/^(supported|assisted|helped|contributed|participated|aided)$/i.test(verb));
  return capitalizeFirst(verbs[0] || "Coordinated");
}

function buildLocalWeakRewrite(sentence = "", roleInput, outLang = "English", cv = "", jd = "") {
  if (outLang !== "English") return "";
  const source = String(sentence || "").trim();
  if (!source || looksLikeSkillFragment(source)) return "";
  const sourceProfile = getSentenceSignalProfile(source, roleInput, cv, jd);
  if (!(sourceProfile.isWeakCandidate || sourceProfile.weakScore >= 4 || sourceProfile.moderatelyWeak)) return "";
  const { body, ending } = splitSentenceEnding(source);

  const specials = [
    { re: /^supported the team during (busy|peak) periods$/i, fn: (m) => `Coordinated with team members during ${m[1].toLowerCase()} periods to maintain workflow continuity` },
    { re: /^assisted the (.+?) team with daily operational tasks$/i, fn: (m) => `Coordinated daily operational tasks with the ${m[1]} team` },
    { re: /^supported daily communication with customers regarding (.+)$/i, fn: (m) => `Coordinated daily customer communication regarding ${m[1]} and followed up on related requests` },
    { re: /^supported routine communication between (.+)$/i, fn: (m) => `Coordinated routine communication between ${m[1]}` },
    { re: /^supported daily customer service tasks with the team$/i, fn: () => "Coordinated daily customer service tasks and followed up on open customer requests" },
    { re: /^assisted with customer requests and internal service updates$/i, fn: () => "Coordinated customer requests and internal service updates across ongoing service workflows" },
    { re: /^prepared weekly support summaries for the team$/i, fn: () => "Prepared weekly support summaries for internal review and case follow-up tracking" },
  ];

  for (const item of specials) {
    const match = body.match(item.re);
    if (match) {
      const rewrite = `${item.fn(match)}${ending}`;
      const filtered = filterWeakSentences([{ sentence: source, rewrite }], { outLang, roleInput, cv, jd });
      if (filtered.length) return filtered[0].rewrite;
    }
  }

  const stripped = stripLeadingWeakPhrase(body);
  if (!stripped || countWords(stripped) < 2) return "";

  const directVerbMaps = [
    [/^prepare\s+(.+)$/i, (m) => `Prepared ${m[1]}`],
    [/^maintain\s+(.+)$/i, (m) => `Maintained ${m[1]}`],
    [/^coordinate\s+(.+)$/i, (m) => `Coordinated ${m[1]}`],
    [/^track\s+(.+)$/i, (m) => `Tracked ${m[1]}`],
    [/^update\s+(.+)$/i, (m) => `Updated ${m[1]}`],
    [/^process\s+(.+)$/i, (m) => `Processed ${m[1]}`],
    [/^review\s+(.+)$/i, (m) => `Reviewed ${m[1]}`],
    [/^monitor\s+(.+)$/i, (m) => `Monitored ${m[1]}`],
    [/^document\s+(.+)$/i, (m) => `Documented ${m[1]}`],
    [/^organize\s+(.+)$/i, (m) => `Organized ${m[1]}`],
    [/^schedule\s+(.+)$/i, (m) => `Scheduled ${m[1]}`],
    [/^respond to\s+(.+)$/i, (m) => `Responded to ${m[1]}`],
    [/^follow(?:ed)? up on\s+(.+)$/i, (m) => `Followed up on ${m[1]}`],
    [/^analy[sz]e\s+(.+)$/i, (m) => `Analyzed ${m[1]}`],
    [/^report on\s+(.+)$/i, (m) => `Reported on ${m[1]}`],
    [/^resolve\s+(.+)$/i, (m) => `Resolved ${m[1]}`],
  ];

  let rewrite = "";
  for (const [re, mapper] of directVerbMaps) {
    const match = stripped.match(re);
    if (match) {
      rewrite = mapper(match);
      break;
    }
  }

  if (!rewrite) {
    const lead = pickRoleAwareRewriteVerb(source, roleInput, cv, jd);
    if (!SCOPE_CONTEXT_RE.test(stripped) && sourceProfile.roleHits <= 1 && sourceProfile.explicitFactsCount === 0 && countWords(stripped) <= 3) return "";
    rewrite = `${lead} ${lowerFirst(stripped)}`.replace(/\s+/g, " ").trim();
  }

  const filtered = filterWeakSentences([{ sentence: source, rewrite: `${rewrite}${ending}` }], { outLang, roleInput, cv, jd });
  return filtered.length ? filtered[0].rewrite : "";
}

function isShallowRewrite(sentence = "", rewrite = "") {
  const s = String(sentence || "").trim();
  const r = String(rewrite || "").trim();
  if (!s || !r) return true;
  if (canonicalizeTerm(s) === canonicalizeTerm(r)) return true;
  const sim = jaccardSimilarity(s, r);
  const delta = getTokenDeltaMetrics(s, r);
  const sourceCore = stripLeadingWeakPhrase(s);
  const rewriteCore = stripLeadingWeakPhrase(r);
  const sourceSpecificity = extractExplicitFactTerms(s).length + extractAcronymLikeTerms(s).length;
  const rewriteSpecificity = extractExplicitFactTerms(r).length + extractAcronymLikeTerms(r).length;
  const rewriteHasScope = SCOPE_CONTEXT_RE.test(r);
  if (sim >= 0.9) return true;
  if (WEAK_VERB_RE.test(r) && WEAK_VERB_RE.test(s)) return true;
  if (delta.totalDelta <= 1) return true;
  if (delta.totalDelta <= 2 && !rewriteHasScope && rewriteSpecificity <= sourceSpecificity) return true;
  if (sourceCore && rewriteCore && jaccardSimilarity(sourceCore, rewriteCore) >= 0.88 && delta.totalDelta <= 3 && !rewriteHasScope && rewriteSpecificity <= sourceSpecificity) return true;
  return false;
}

function hasUnsupportedImpactClaims(originalText = "", candidateText = "") {
  return ENGLISH_RISKY_OUTCOME_RE.test(String(candidateText || "")) && !ENGLISH_RISKY_OUTCOME_RE.test(String(originalText || ""));
}

function filterWeakSentences(items = [], { outLang = "English", roleInput, cv = "", jd = "" } = {}) {
  return (Array.isArray(items) ? items : [])
    .map((item) => ({ sentence: String(item?.sentence || item?.source || "").trim(), rewrite: String(item?.rewrite || item?.after || "").trim() }))
    .filter((item) => item.sentence && item.rewrite && !looksLikeSkillFragment(item.sentence))
    .filter((item) => canonicalizeTerm(item.sentence) !== canonicalizeTerm(item.rewrite))
    .map((item) => {
      const sourceProfile = getSentenceSignalProfile(item.sentence, roleInput, cv, jd);
      const rewriteProfile = getSentenceSignalProfile(item.rewrite, roleInput, cv, jd);
      const improvements = countMeaningfulRewriteImprovements(item.sentence, item.rewrite, roleInput, cv, jd);
      return { ...item, sourceProfile, rewriteProfile, improvements };
    })
    .filter((item) => !item.sourceProfile.isReasonablyStrong && (item.sourceProfile.isWeakCandidate || item.sourceProfile.weakScore >= 4 || (item.sourceProfile.weakScore >= 3 && (item.sourceProfile.startsWeak || item.sourceProfile.hasWeakPhrase || item.sourceProfile.genericTask || !item.sourceProfile.hasSpecific))))
    .filter((item) => !isShallowRewrite(item.sentence, item.rewrite))
    .filter((item) => item.improvements >= 2)
    .filter((item) => !rewriteStillFeelsWeak(item.rewrite, roleInput, cv, jd, item.sentence))
    .filter((item) => !hasUnsupportedSpecificityInWeakRewrite(item.sentence, item.rewrite, cv, jd))
    .filter((item) => outLang !== "English" || (!(ENGLISH_FLUFF_RE.test(item.rewrite) && !ENGLISH_FLUFF_RE.test(item.sentence)) && !hasUnsupportedImpactClaims(item.sentence, item.rewrite)))
    .sort((a, b) => {
      const tierOrder = { clear: 2, moderate: 1, none: 0 };
      return tierOrder[b.sourceProfile.candidateTier] - tierOrder[a.sourceProfile.candidateTier] || b.improvements - a.improvements || b.sourceProfile.weakScore - a.sourceProfile.weakScore || b.sourceProfile.improvementPotential - a.sourceProfile.improvementPotential || a.rewriteProfile.weakScore - b.rewriteProfile.weakScore;
    })
    .slice(0, 12)
    .map(({ sentence, rewrite }) => ({ sentence, rewrite }));
}

function mergeWeakSentenceSets(primary = [], secondary = [], roleInput, outLang = "English", cv = "", jd = "", maxCount = 12) {
  const combined = [...(Array.isArray(primary) ? primary : []), ...(Array.isArray(secondary) ? secondary : [])];
  const seen = new Set();
  const out = [];
  for (const item of combined) {
    const sentence = String(item?.sentence || "").trim();
    const rewrite = String(item?.rewrite || "").trim();
    if (!sentence || !rewrite) continue;
    const key = canonicalizeTerm(sentence);
    if (!key || seen.has(key)) continue;
    seen.add(key);
    const filtered = filterWeakSentences([{ sentence, rewrite }], { outLang, roleInput, cv, jd });
    if (filtered.length) out.push(filtered[0]);
    if (out.length >= maxCount) break;
  }
  return out;
}

function buildLocalWeakSentenceSet(candidates = [], roleInput, outLang = "English", cv = "", jd = "", maxCount = 12) {
  const raw = [];
  for (const sentence of Array.isArray(candidates) ? candidates : []) {
    const rewrite = buildLocalWeakRewrite(sentence, roleInput, outLang, cv, jd);
    if (!rewrite) continue;
    raw.push({ sentence, rewrite });
    if (raw.length >= maxCount) break;
  }
  return filterWeakSentences(raw, { outLang, roleInput, cv, jd }).slice(0, maxCount);
}

function normalizeBulletUpgrades(items = [], outLang = "English", roleInput, cv = "", jd = "") {
  const seen = new Set();
  const out = [];
  for (const item of Array.isArray(items) ? items : []) {
    const source = String(item?.source || item?.sentence || "").trim();
    const rewrite = String(item?.rewrite || item?.after || "").trim();
    const reason = String(item?.reason || "").trim();
    if (!source || !rewrite || looksLikeSkillFragment(source)) continue;
    const sourceProfile = getSentenceSignalProfile(source, roleInput, cv, jd);
    const rewriteProfile = getSentenceSignalProfile(rewrite, roleInput, cv, jd);
    const improvements = countMeaningfulRewriteImprovements(source, rewrite, roleInput, cv, jd);
    if (sourceProfile.isReasonablyStrong) continue;
    if (!(sourceProfile.isWeakCandidate || sourceProfile.weakScore >= 4 || (sourceProfile.weakScore >= 3 && (sourceProfile.startsWeak || sourceProfile.hasWeakPhrase || sourceProfile.genericTask)))) continue;
    if (isShallowRewrite(source, rewrite)) continue;
    if (improvements < 2) continue;
    if (rewriteStillFeelsWeak(rewrite, roleInput, cv, jd, source)) continue;
    if (hasUnsupportedSpecificityInWeakRewrite(source, rewrite, cv, jd)) continue;
    if (outLang === "English" && (hasUnsupportedImpactClaims(source, rewrite) || (ENGLISH_FLUFF_RE.test(rewrite) && !ENGLISH_FLUFF_RE.test(source)))) continue;
    const key = `${canonicalizeTerm(source)}__${canonicalizeTerm(rewrite)}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({ source, rewrite, reason, sourceProfile, rewriteProfile, improvements });
  }
  return out.sort((a, b) => {
    const tierOrder = { clear: 2, moderate: 1, none: 0 };
    return tierOrder[b.sourceProfile.candidateTier] - tierOrder[a.sourceProfile.candidateTier] || b.improvements - a.improvements || b.sourceProfile.weakScore - a.sourceProfile.weakScore || a.rewriteProfile.weakScore - b.rewriteProfile.weakScore;
  }).slice(0, 8).map(({ source, rewrite, reason }) => ({ source, rewrite, reason }));
}

function buildPriorityRewriteText(bulletUpgrades = []) {
  const items = Array.isArray(bulletUpgrades) ? bulletUpgrades : [];
  if (!items.length) return "(none)";
  return items.map((item, idx) => `${idx + 1}. source: ${item.source}\n  stronger rewrite target: ${item.rewrite}${item.reason ? `\n  why: ${item.reason}` : ""}`).join("\n\n");
}

function buildLocalBulletUpgradeFallback(weakSentences = []) {
  return (Array.isArray(weakSentences) ? weakSentences : []).map((item) => ({ source: item.sentence, rewrite: item.rewrite, reason: "Stronger action, clearer scope, and better ATS phrasing." })).slice(0, 8);
}

function applyBulletUpgradesToText(text = "", bulletUpgrades = []) {
  const sourceMap = new Map();
  for (const item of Array.isArray(bulletUpgrades) ? bulletUpgrades : []) {
    const source = String(item?.source || "").trim();
    const rewrite = String(item?.rewrite || "").trim();
    if (source && rewrite) sourceMap.set(canonicalizeTerm(source), rewrite);
  }
  if (!sourceMap.size) return normalizeSpace(text);
  const lines = normalizeSpace(text).split("\n");
  const replaced = lines.map((line) => {
    const bulletMatch = line.match(/^(\s*[-•·‣▪▫◦*]\s+)(.*)$/);
    if (bulletMatch) {
      const content = String(bulletMatch[2] || "").trim();
      const rewrite = sourceMap.get(canonicalizeTerm(content));
      return rewrite ? `${bulletMatch[1]}${rewrite}` : line;
    }
    const trimmed = String(line || "").trim();
    const rewrite = sourceMap.get(canonicalizeTerm(trimmed));
    if (!rewrite) return line;
    const idx = line.indexOf(trimmed);
    return idx >= 0 ? `${line.slice(0, idx)}${rewrite}${line.slice(idx + trimmed.length)}` : rewrite;
  });
  return replaced.join("\n").replace(/\n{3,}/g, "\n\n").trim();
}

function applyBulletUpgradesToCv(originalCv = "", optimizedCv = "", bulletUpgrades = [], outLang = "English") {
  const base = String(optimizedCv || originalCv || "").trim();
  if (!base || !Array.isArray(bulletUpgrades) || !bulletUpgrades.length) return base;
  return forceSafeResume(originalCv, applyBulletUpgradesToText(base, bulletUpgrades), outLang);
}

function getDesiredWeakCount(hasJD = false, candidateCount = 0) {
  if (candidateCount <= 0) return 0;
  return hasJD ? Math.min(10, Math.max(5, Math.min(8, candidateCount))) : Math.min(12, Math.max(6, Math.min(10, candidateCount)));
}

function getSectionPresenceScore(cv = "") {
  const text = getNonEmptyLines(cv).join("\n");
  let score = 0;
  if (/(PROFESSIONAL SUMMARY|SUMMARY|PROFILE|PROFESYONEL ÖZET|ÖZET|PROFİL)/i.test(text)) score += 5;
  if (/(EXPERIENCE|WORK EXPERIENCE|PROFESSIONAL EXPERIENCE|DENEYİM|İŞ DENEYİMİ)/i.test(text)) score += 7;
  if (/(SKILLS|CORE SKILLS|TECHNICAL SKILLS|COMPETENCIES|YETKİNLİKLER|YETENEKLER|BECERİLER)/i.test(text)) score += 4;
  if (/(EDUCATION|EĞİTİM)/i.test(text)) score += 4;
  if (/(LANGUAGES|DİLLER|BİLDİĞİ DİLLER)/i.test(text)) score += 2;
  if (/(CERTIFICATIONS|LICENSES|SERTİFİKALAR)/i.test(text)) score += 2;
  if (/(PROJECTS|PROJELER)/i.test(text)) score += 1;
  return Math.min(25, score);
}

function getReadabilityScore(cv = "") {
  const bullets = getBulletLines(cv);
  const header = extractHeaderBlock(cv);
  const lines = getNonEmptyLines(cv);
  let score = 0;
  if (header.length >= 3) score += 3;
  if (lines.length >= 12) score += 3;
  if (bullets.length >= 4) score += 6;
  const avgBulletWords = bullets.length ? bullets.reduce((sum, item) => sum + countWords(item), 0) / bullets.length : 0;
  if (avgBulletWords >= 6 && avgBulletWords <= 20) score += 8;
  else if (avgBulletWords >= 4) score += 4;
  return Math.min(20, score);
}

function getBulletStrengthScore(cv = "", roleInput, jd = "") {
  const bullets = getBulletLines(cv);
  if (!bullets.length) return 0;
  let sum = 0;
  for (const bullet of bullets) {
    const profile = getSentenceSignalProfile(bullet, roleInput, cv, jd);
    const wc = countWords(bullet);
    let value = 3.5;
    value += profile.strongScore * 1.8;
    value -= profile.weakScore * 0.95;
    if (profile.hasSpecific) value += 1.4;
    if (profile.hasScopeSignal) value += 0.8;
    if (profile.roleHits > 0) value += Math.min(1.8, profile.roleHits * 0.6);
    if (profile.explicitFactsCount > 0) value += Math.min(1.8, profile.explicitFactsCount * 0.6);
    if (/\b(prepared|processed|reviewed|tracked|updated|recorded|documented|coordinated|monitored|validated|maintained|resolved|responded|scheduled|organized|assembled|verified|collected|delivered|implemented|debugged|tested|integrated|deployed|optimized|analyzed|reconciled|inspected|packed|labeled|picked|received|counted|staged|shipped|follow(?:ed)?\s?up)\b/i.test(bullet)) value += 1.2;
    if (/\b(order|shipment|delivery|inventory|stock|warehouse|invoice|report|budget|forecast|variance|account|ledger|reconciliation|documentation|record|customer|ticket|case|schedule|calendar|api|backend|database|query|endpoint|deployment|bug|test|feature|workflow|process|finance|operations|support|service|patient|design|campaign|supplier|quotation|appointment)\b/i.test(bullet)) value += 1;
    if (wc >= 5 && wc <= 22) value += 0.8; else if (wc >= 4 && wc <= 28) value += 0.4;
    if (profile.startsWeak) value -= 1.2;
    if (profile.genericTask && !profile.hasSpecific) value -= 1;
    if (profile.genericSummary) value -= 0.8;
    if (looksLikeSkillFragment(bullet)) value -= 2;
    sum += Math.max(0, Math.min(14, value));
  }
  const avg = sum / bullets.length;
  return Math.max(0, Math.min(40, Math.round((avg / 14) * 40)));
}

function getKeywordBreadthScore(cv = "", roleInput, jd = "") {
  const profile = ensureRoleProfile(roleInput, cv, jd);
  const packs = getRolePacks(profile, cv, jd);
  const skills = uniqueTrimmedStrings(getSkillsLines(cv));
  const norm = canonicalizeTerm(cv);
  let score = 0;
  score += Math.min(8, skills.length);
  const hardHits = HARD_FACT_TERMS.filter((term) => containsCanonicalTermInText(norm, term)).length;
  score += Math.min(4, hardHits);
  const relevantPool = uniqueTrimmedStrings(packs.flatMap((role) => [...(role.signals || []), ...(role.keywords || [])]));
  const relevantHits = relevantPool.filter((term) => containsCanonicalTermInText(norm, term)).length;
  score += Math.min(5, relevantHits);
  return Math.min(15, score);
}

function getJdAlignmentScore(cv = "", jd = "", roleInput) {
  if (!String(jd || "").trim()) return 0;
  const cvNorm = canonicalizeTerm(cv);
  const signals = extractJdSignalProfile(jd, roleInput, cv).ranked;
  if (!signals.length) return 0;
  let totalWeight = 0;
  let hitWeight = 0;
  for (const item of signals.slice(0, 24)) {
    let weight = 1;
    if (item.category === "tool" || item.category === "certification") weight = 1.35;
    else if (item.category === "methodology") weight = 1.2;
    else if (item.category === "seniority") weight = 0.8;
    totalWeight += weight;
    if (containsCanonicalTermInText(cvNorm, item.term)) hitWeight += weight;
  }
  const ratio = totalWeight > 0 ? hitWeight / totalWeight : 0;
  return Math.max(0, Math.min(10, Math.round(ratio * 10)));
}

function computeDeterministicAtsScore(cv = "", jd = "", roleInput) {
  const hasJD = !!String(jd || "").trim();
  const sectionScore = getSectionPresenceScore(cv);
  const bulletScore = getBulletStrengthScore(cv, roleInput, jd);
  const readabilityScore = getReadabilityScore(cv);
  const keywordScore = getKeywordBreadthScore(cv, roleInput, jd);
  const jdScore = getJdAlignmentScore(cv, jd, roleInput);
  let total = 0;
  if (hasJD) {
    total = Math.round((sectionScore / 25) * 16) + Math.round((bulletScore / 40) * 38) + Math.round((readabilityScore / 20) * 18) + Math.round((keywordScore / 15) * 10) + Math.round((jdScore / 10) * 18);
  } else {
    total = Math.round((sectionScore / 25) * 20) + Math.round((bulletScore / 40) * 42) + Math.round((readabilityScore / 20) * 22) + Math.round((keywordScore / 15) * 16);
  }
  return clampScore(total);
}

function computeComponentScore(componentScores = {}, hasJD = false) {
  if (hasJD) {
    const roleAlignment = clampScore(componentScores?.role_alignment);
    const bulletStrength = clampScore(componentScores?.bullet_strength);
    const jdKeywordMatch = clampScore(componentScores?.jd_keyword_match);
    const sectionCompleteness = clampScore(componentScores?.section_completeness);
    const atsSafeFormatting = clampScore(componentScores?.ats_safe_formatting);
    return clampScore(roleAlignment * 0.28 + bulletStrength * 0.28 + jdKeywordMatch * 0.18 + sectionCompleteness * 0.16 + atsSafeFormatting * 0.1);
  }
  const sectionCompleteness = clampScore(componentScores?.section_completeness);
  const clarityReadability = clampScore(componentScores?.clarity_readability);
  const bulletStrength = clampScore(componentScores?.bullet_strength);
  const atsSafeFormatting = clampScore(componentScores?.ats_safe_formatting);
  const coreKeywordCoverage = clampScore(componentScores?.core_keyword_coverage);
  return clampScore(sectionCompleteness * 0.22 + clarityReadability * 0.24 + bulletStrength * 0.32 + atsSafeFormatting * 0.14 + coreKeywordCoverage * 0.08);
}

function computeFinalOptimizedScore(originalCv = "", optimizedCv = "", originalScore = 0, jd = "") {
  const base = clampScore(originalScore);
  if (!originalCv || !optimizedCv) return base;
  const origNorm = canonicalizeTerm(originalCv);
  const optNorm = canonicalizeTerm(optimizedCv);
  if (!optNorm || origNorm === optNorm) return base;
  const roleProfile = inferRoleProfile(originalCv, jd);
  const rescoredOptimized = computeDeterministicAtsScore(optimizedCv, jd, roleProfile);
  const rawLift = Math.max(0, rescoredOptimized - base);
  const weakBefore = detectWeakSentenceCandidates(originalCv, roleProfile, 0, 20).length;
  const weakAfter = detectWeakSentenceCandidates(optimizedCv, roleProfile, 0, 20).length;
  const weakGain = Math.max(0, weakBefore - weakAfter);
  const { same, total } = countUnchangedBullets(originalCv, optimizedCv);
  const rewriteRatio = total > 0 ? 1 - same / total : 0;
  const bulletBefore = getBulletStrengthScore(originalCv, roleProfile, jd);
  const bulletAfter = getBulletStrengthScore(optimizedCv, roleProfile, jd);
  const bulletGain = Math.max(0, bulletAfter - bulletBefore);
  const readabilityBefore = getReadabilityScore(originalCv);
  const readabilityAfter = getReadabilityScore(optimizedCv);
  const readabilityGain = Math.max(0, readabilityAfter - readabilityBefore);

  let lift = 0;
  lift += rawLift * 0.72;
  lift += Math.min(6, weakGain) * 1.35;
  lift += Math.min(4, bulletGain * 0.28);
  lift += Math.min(2, readabilityGain * 0.2);

  if (rewriteRatio >= 0.7) lift += 4;
  else if (rewriteRatio >= 0.5) lift += 3;
  else if (rewriteRatio >= 0.3) lift += 2;
  else if (rewriteRatio >= 0.18) lift += 1;

  const meaningfulChange = rawLift > 1 || weakGain > 0 || rewriteRatio >= 0.18 || bulletGain >= 3 || readabilityGain >= 2;
  if (!meaningfulChange) return base;

  lift = Math.round(lift);
  const cap = base < 40 ? 22 : base < 55 ? 18 : base < 70 ? 15 : base < 80 ? 12 : 8;
  lift = Math.max(5, Math.min(cap, lift));
  return clampScore(base + lift);
}

function countCorporateFluffHits(cv = "") {
  return getBulletLines(cv).filter((item) => ENGLISH_FLUFF_RE.test(item)).length;
}

function countWeakEnglishRewriteStarts(cv = "") {
  return getBulletLines(cv).filter((item) => /^(helped|assisted|supported|contributed|participated|aided)\b/i.test(item)).length;
}

function getOverlongBulletRatio(cv = "") {
  const bullets = getBulletLines(cv);
  if (!bullets.length) return 0;
  return bullets.filter((item) => countWords(item) >= 23).length / bullets.length;
}

function countPersistingWeakSources(optimizedCv = "", weakSentences = []) {
  const lines = getNonEmptyLines(optimizedCv).map(canonicalizeTerm);
  let hits = 0;
  for (const item of Array.isArray(weakSentences) ? weakSentences : []) {
    const source = canonicalizeTerm(String(item?.sentence || ""));
    if (!source) continue;
    if (lines.some((line) => line === source)) hits += 1;
  }
  return hits;
}

function shouldRepairOptimizedCv(originalCv = "", optimizedCv = "", jd = "", outLang = "English", weakSentences = [], roleInput) {
  const hasJD = !!String(jd || "").trim();
  if (!optimizedCv || !String(optimizedCv).trim()) return true;
  const origNorm = canonicalizeTerm(originalCv);
  const optNorm = canonicalizeTerm(optimizedCv);
  if (!optNorm || origNorm === optNorm) return true;
  const { same, total } = countUnchangedBullets(originalCv, optimizedCv);
  if (total > 0 && same / total >= (hasJD ? 0.42 : 0.34)) return true;
  if (total > 0 && getBulletLines(optimizedCv).length < Math.max(2, Math.floor(total * 0.7))) return true;
  if (countPersistingWeakSources(optimizedCv, weakSentences) >= (hasJD ? 2 : 1)) return true;
  if (outLang === "English" && countCorporateFluffHits(optimizedCv) >= 2) return true;
  if (outLang === "English" && getOverlongBulletRatio(optimizedCv) > 0.35) return true;
  if (countWeakEnglishRewriteStarts(optimizedCv) >= 2) return true;
  if (findUnsupportedTerms(originalCv, jd, optimizedCv).length > 0) return true;
  if (containsRoleUnsafeRewritePhrase(optimizedCv, roleInput, originalCv, originalCv, jd)) return true;
  return false;
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
  const match = cookie.match(/(?:^|;\s*)resumeai_session=([^;]+)/);
  if (!match) return false;
  const token = decodeURIComponent(match[1]);
  const parts = token.split(".");
  if (parts.length !== 2) return false;
  const [data, sig] = parts;
  const expected = crypto.createHmac("sha256", appSecret).update(data).digest("base64url");
  if (sig !== expected) return false;
  try {
    const payload = JSON.parse(Buffer.from(data, "base64url").toString("utf8"));
    return !!payload?.exp && Date.now() <= payload.exp;
  } catch {
    return false;
  }
}

function isGpt5Model(model = "") {
  return /^gpt-5/i.test(String(model || "").trim());
}

function buildOpenAIPayload({ model, messages, reasoningEffort = null, temperature = null, maxCompletionTokens = 1800 }) {
  const body = { model, response_format: { type: "json_object" }, messages };
  if (isGpt5Model(model)) {
    body.max_completion_tokens = maxCompletionTokens;
    if (reasoningEffort) body.reasoning_effort = reasoningEffort;
  } else {
    body.max_tokens = maxCompletionTokens;
    if (typeof temperature === "number") body.temperature = temperature;
  }
  return body;
}

function buildAttempts({ model, passType = "main", isPreview = false, maxCompletionTokens = 1800 }) {
  if (!isGpt5Model(model)) return [{ reasoningEffort: null, temperature: isPreview ? 0.2 : 0.25, maxCompletionTokens }];
  if (passType === "optimize") return [
    { reasoningEffort: "medium", temperature: null, maxCompletionTokens: Math.max(maxCompletionTokens, 3600) },
    { reasoningEffort: "low", temperature: null, maxCompletionTokens: Math.max(maxCompletionTokens, 4400) },
  ];
  if (passType === "repair") return [
    { reasoningEffort: "low", temperature: null, maxCompletionTokens: Math.max(maxCompletionTokens, 3600) },
    { reasoningEffort: "minimal", temperature: null, maxCompletionTokens: Math.max(maxCompletionTokens, 4200) },
  ];
  if (passType === "bullet") return [
    { reasoningEffort: "low", temperature: null, maxCompletionTokens: Math.max(maxCompletionTokens, 1600) },
    { reasoningEffort: "minimal", temperature: null, maxCompletionTokens: Math.max(maxCompletionTokens, 2200) },
  ];
  if (isPreview) return [
    { reasoningEffort: "minimal", temperature: null, maxCompletionTokens: Math.max(maxCompletionTokens, 1100) },
    { reasoningEffort: "minimal", temperature: null, maxCompletionTokens: Math.max(maxCompletionTokens, 1500) },
  ];
  return [
    { reasoningEffort: "low", temperature: null, maxCompletionTokens: Math.max(maxCompletionTokens, 1800) },
    { reasoningEffort: "minimal", temperature: null, maxCompletionTokens: Math.max(maxCompletionTokens, 2400) },
  ];
}

async function fetchWithTimeout(url, options, timeoutMs = 65000) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { ...options, signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
}

function extractAssistantText(parsed) {
  const content = parsed?.choices?.[0]?.message?.content;
  if (typeof content === "string") return content;
  if (Array.isArray(content)) return content.map((part) => typeof part === "string" ? part : typeof part?.text === "string" ? part.text : typeof part?.content === "string" ? part.content : "").join("").trim();
  return "";
}

function safeJsonParse(text) {
  try {
    return JSON.parse(text);
  } catch {
    const s = String(text || "");
    const start = s.indexOf("{");
    const end = s.lastIndexOf("}");
    if (start !== -1 && end !== -1 && end > start) return JSON.parse(s.slice(start, end + 1));
    throw new Error("Model did not return valid JSON");
  }
}

async function callOpenAIJson({ apiKey, model, system, userPrompt, isPreview = false, passType = "main", maxCompletionTokens = 1800 }) {
  const attempts = buildAttempts({ model, passType, isPreview, maxCompletionTokens });
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
          body: JSON.stringify(buildOpenAIPayload({
            model,
            messages: [
              { role: "system", content: system },
              { role: "user", content: userPrompt },
            ],
            reasoningEffort: attempt.reasoningEffort,
            temperature: attempt.temperature,
            maxCompletionTokens: attempt.maxCompletionTokens,
          })),
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
      if (lastError?.status && lastError.status >= 400 && lastError.status < 500 && lastError.status !== 429) throw lastError;
    }
  }
  const err = new Error(lastError?.message || "Model did not return usable JSON");
  err.status = lastError?.status || 500;
  err.details = lastError?.details || String(lastError || "Unknown error");
  throw err;
}

function buildAtsSystem(outLang = "English") {
  return [
    "CRITICAL RULES (must follow):",
    "- Do NOT invent or assume any numbers, percentages, dates, KPIs, budgets, clients, team size, revenue, ownership level, or outcomes.",
    "- Only use facts, tools, platforms, processes, and terminology explicitly supported by the resume and optional job description.",
    "- Weak sentence detection must be selective. Do NOT flag strong lines just because they could be polished.",
    "- Only flag lines that are genuinely vague, generic, duty-only, support-heavy, shallow, or low-signal.",
    "- Do NOT produce trivial rewrites where only one word changes.",
    "- Rewrites must materially improve at least two of these: clarity, specificity, action strength, scope, business context, recruiter readability.",
    "- If the original sentence is support-level work, keep it truthful and support-level. Do NOT escalate it into leadership or full ownership.",
    "- Preserve profession-native terminology across technical, operational, finance, healthcare, education, legal, design, and engineering resumes.",
    "- missing_keywords must prioritize realistic role-relevant tools, methods, certifications, domain phrases, and responsibility patterns.",
    "- Avoid random filler keywords and soft-skill spam.",
    "- Do not treat short noun fragments or skill labels as weak sentences.",
    "- Do not surface adjacent-field keywords unless the resume or JD explicitly supports them.",
    "- Keep optimized_cv ATS-safe, clean, and parser-friendly.",
    "- Return only valid JSON. No markdown. No extra text.",
    `- All output values must be written only in ${outLang}. Do not mix languages.`,
  ].join("\n");
}

function buildEnglishStyleBlock(roleInput, cv = "", jd = "", hasJD = false) {
  return [
    "ENGLISH WRITING STYLE:",
    "- Write like a strong US resume writer, not marketing copy.",
    "- Prefer concise recruiter-friendly bullets, usually around 9-18 words when possible.",
    "- Prefer: action + scope + tool/channel/context + neutral purpose.",
    "- Do not add corporate fluff, vague value statements, or unsupported outcome clauses.",
    "- Avoid shallow verb swaps such as helped -> assisted or supported -> contributed.",
    "- Keep already-strong bullets sharp and short.",
    buildRoleWritingBlock(roleInput, cv, jd),
    buildRoleGuardrails(roleInput, cv, jd, hasJD),
  ].join("\n");
}

function buildAnalysisPrompt({ cv, jd, hasJD, outLang, roleProfile, isPreview }) {
  const roleContextText = buildRoleContextText(roleProfile, cv, jd);
  const englishStyleBlock = outLang === "English" ? buildEnglishStyleBlock(roleProfile, cv, jd, hasJD) : "";
  const baseSchema = hasJD
    ? `{
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
}`
    : `{
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
}`;
  const weakRules = isPreview
    ? "- Return up to 2 weak_sentences. Do not force the count."
    : hasJD
    ? "- Return 7-12 weak_sentences when genuinely weak examples exist. Prefer weak experience bullets first."
    : "- Return 8-12 weak_sentences when genuinely weak examples exist. If the resume clearly contains many weak or moderately weak bullets, return at least 6 items.";
  const missingRules = hasJD
    ? isPreview
      ? "- missing_keywords must contain 5-7 genuinely missing or underrepresented JD-relevant items."
      : "- missing_keywords must contain 12-20 genuinely missing or underrepresented JD-relevant items."
    : isPreview
    ? "- missing_keywords must contain 5-7 role-aware ATS-relevant suggestions based on the resume alone."
    : "- missing_keywords must contain 10-18 role-aware ATS-relevant suggestions based on the resume alone.";
  const summaryRule = isPreview ? "- summary must be 4-6 compact bullet-style lines." : "- summary must be 8-12 detailed bullet-style lines.";
  return [
    `Return JSON in this exact schema:\n\n${baseSchema}`,
    hasJD ? "\nTASK: Perform a job-specific ATS review." : "\nTASK: Perform a general ATS review with no job description.",
    "\nSTRICT REQUIREMENTS:",
    hasJD ? "- Score the resume against the job description without inventing alignment." : "- Infer likely role family, seniority, and recruiter-facing terminology from the resume itself.",
    missingRules,
    "- Prioritize tools, platforms, methods, certifications, domain phrases, responsibility patterns, and seniority signals over filler.",
    weakRules,
    "- Only select lines that are genuinely vague, generic, duty-only, shallow, or support-heavy.",
    "- Do not flag already-strong technical or functional bullets that already contain concrete tools, platforms, process detail, or domain terminology unless the rewrite is clearly and materially stronger.",
    "- Never include short skill labels or noun fragments such as Record Keeping, Team Coordination, or Supplier Communication in weak_sentences.",
    "- Both sentence and rewrite must stay truthful and materially better.",
    summaryRule,
    "- Do not add extra keys. Do not add optimized_cv.",
    "\nROLE CONTEXT:",
    roleContextText,
    hasJD ? `\nRANKED JD SIGNALS:\n${buildJdSignalText(jd, roleProfile, cv)}` : "",
    englishStyleBlock ? `\n${englishStyleBlock}` : "",
    `\nRESUME:\n${cv}`,
    hasJD ? `\nJOB DESCRIPTION:\n${jd}` : "",
  ].filter(Boolean).join("\n");
}

function buildWeakRewriteFallbackPrompt({ cv, jd, hasJD, candidates, outLang, roleProfile }) {
  const roleContextText = buildRoleContextText(roleProfile, cv, jd);
  const englishStyleBlock = outLang === "English" ? buildEnglishStyleBlock(roleProfile, cv, jd, hasJD) : "";
  const candidateText = (Array.isArray(candidates) ? candidates : []).map((item, idx) => `${idx + 1}. ${item}`).join("\n");
  return [
    `Return JSON in this exact schema:\n\n{\n  "weak_sentences": [{"sentence": string, "rewrite": string}]\n}`,
    "\nTASK:",
    "Rewrite only the listed weak resume lines into materially stronger ATS-friendly versions.",
    "\nSTRICT RULES:",
    "- Rewrite only the provided sentences.",
    "- Keep all facts truthful.",
    "- Do not invent tools, metrics, results, ownership, platforms, or outcomes.",
    "- Preserve profession-native wording.",
    "- Avoid shallow synonym swaps.",
    "- Do not turn short noun fragments into rewrite cards.",
    `- Output values only in ${outLang}.`,
    "- Return 6-12 items when possible.",
    `\nROLE CONTEXT:\n${roleContextText}`,
    englishStyleBlock ? `\n${englishStyleBlock}` : "",
    `\nWEAK CANDIDATES:\n${candidateText || "(none)"}`,
    `\nRESUME:\n${cv}`,
    hasJD ? `\nJOB DESCRIPTION:\n${jd}` : "",
  ].filter(Boolean).join("\n");
}

function buildTargetedBulletUpgradePrompt({ cv, jd, hasJD, weakSentences, outLang, roleProfile }) {
  const roleContextText = buildRoleContextText(roleProfile, cv, jd);
  const englishStyleBlock = outLang === "English" ? buildEnglishStyleBlock(roleProfile, cv, jd, hasJD) : "";
  const weakText = (Array.isArray(weakSentences) ? weakSentences : []).map((item, idx) => `${idx + 1}. ${String(item?.sentence || "").trim()}`).filter(Boolean).join("\n");
  return [
    `Return JSON in this exact schema:\n\n{\n  "bullet_upgrades": [{ "source": string, "rewrite": string, "reason": string }]\n}`,
    "\nTASK:",
    "Create premium-quality bullet rewrites only for the provided weak resume sentences.",
    "\nSTRICT RULES:",
    "- Rewrite only the listed source sentences.",
    "- Keep each rewrite truthful, ATS-friendly, and recruiter-ready.",
    "- Do not invent numbers, results, tools, platforms, budgets, clients, ownership, or impact.",
    "- If the original is support-level work, keep it support-level but sharper and more specific.",
    "- Each rewrite must be materially stronger than the source, not a synonym swap.",
    "- reason must be short and explain what improved.",
    `- Output values only in ${outLang}.`,
    "- Return 3-8 items depending on real quality opportunities.",
    `\nROLE CONTEXT:\n${roleContextText}`,
    englishStyleBlock ? `\n${englishStyleBlock}` : "",
    `\nWEAK SOURCE SENTENCES:\n${weakText || "(none)"}`,
    `\nRESUME:\n${cv}`,
    hasJD ? `\nJOB DESCRIPTION:\n${jd}` : "",
  ].filter(Boolean).join("\n");
}

function buildOptimizePrompt({ cv, jd, hasJD, summary, missingKeywords, bulletUpgrades, outLang, roleProfile }) {
  const keywordsText = Array.isArray(missingKeywords) ? missingKeywords.join(", ") : "";
  const allowedTermsText = buildAllowedTermsText(cv, jd);
  const roleContextText = buildRoleContextText(roleProfile, cv, jd);
  const englishStyleBlock = outLang === "English" ? buildEnglishStyleBlock(roleProfile, cv, jd, hasJD) : "";
  const priorityRewriteText = buildPriorityRewriteText(bulletUpgrades);
  return [
    `Return JSON in this exact schema:\n\n{\n  "optimized_cv": string\n}`,
    "\nTASK:",
    hasJD ? "Rewrite the resume into a materially stronger ATS-friendly version aligned to the job description." : "Rewrite the resume into a materially stronger ATS-friendly version.",
    "\nSTRICT RULES:",
    "- Keep the header identity block exactly as written.",
    "- Keep existing experience titles unchanged.",
    "- Keep exact dates, employers, titles, education, certifications, and explicit experience durations unchanged.",
    "- Do not invent numbers, tools, platforms, acronyms, KPIs, budgets, achievements, ownership, or outcomes.",
    "- Do not replace generic platform language with specific platforms unless explicitly present in the resume.",
    "- Treat missing keywords as context only. Never force keywords into the resume unless the underlying work is already supported by the original resume text.",
    "- Keep already-strong bullets unchanged or only lightly polished.",
    "- Focus most rewrite effort on weaker summary lines and weaker or support-heavy bullets.",
    "- If 4 or more weak bullets were identified, materially improve at least 4 of them in the final optimized_cv.",
    "- Preserve structure and bullet count as much as possible.",
    "- Do not merge multiple bullets into one if that removes detail.",
    "- Use canonical section headings only.",
    `\nROLE CONTEXT:\n${roleContextText}`,
    hasJD ? `\nRANKED JD SIGNALS:\n${buildJdSignalText(jd, roleProfile, cv)}` : "",
    `\nALLOWED EXPLICIT TOOLS / PLATFORMS / ACRONYMS:\n${allowedTermsText}`,
    `\nPRIORITY REWRITE TARGETS:\n${priorityRewriteText}`,
    englishStyleBlock ? `\n${englishStyleBlock}` : "",
    `\nANALYSIS SUMMARY:\n${summary || "(none)"}`,
    `\nHIGH PRIORITY KEYWORD GAPS (context only, do not force):\n${keywordsText || "(none)"}`,
    "\nSELF-CHECK BEFORE RETURNING:",
    "- no unsupported tools/platforms/acronyms added",
    "- no invented achievements/results/ownership added",
    "- no unjustified leadership escalation",
    "- no major bullet loss",
    "- weak bullets materially improved, not cosmetically polished",
    `\nRESUME:\n${cv}`,
    hasJD ? `\nJOB DESCRIPTION:\n${jd}` : "",
  ].filter(Boolean).join("\n");
}

function buildRepairPrompt({ cv, jd, hasJD, currentOptimizedCv, summary, missingKeywords, bulletUpgrades, unsupportedTerms = [], outLang, roleProfile }) {
  const keywordsText = Array.isArray(missingKeywords) ? missingKeywords.join(", ") : "";
  const allowedTermsText = buildAllowedTermsText(cv, jd);
  const unsupportedText = Array.isArray(unsupportedTerms) && unsupportedTerms.length ? unsupportedTerms.join(", ") : "(none)";
  const roleContextText = buildRoleContextText(roleProfile, cv, jd);
  const englishStyleBlock = outLang === "English" ? buildEnglishStyleBlock(roleProfile, cv, jd, hasJD) : "";
  const priorityRewriteText = buildPriorityRewriteText(bulletUpgrades);
  return [
    `Return JSON in this exact schema:\n\n{\n  "optimized_cv": string\n}`,
    "\nTASK:",
    "Rewrite the current optimized resume into a stronger and cleaner final version.",
    "\nSTRICT RULES:",
    "- Keep the header identity block exactly as written.",
    "- Keep existing experience titles unchanged.",
    "- Keep exact dates, employers, titles, degrees, certifications, and explicit years of experience unchanged.",
    "- Do not invent tools, platforms, acronyms, channels, achievements, ownership, or impact.",
    "- Remove unsupported additions.",
    "- Preserve bullet count and structure as much as possible.",
    "- Use canonical section headings only.",
    `\nROLE CONTEXT:\n${roleContextText}`,
    hasJD ? `\nRANKED JD SIGNALS:\n${buildJdSignalText(jd, roleProfile, cv)}` : "",
    `\nALLOWED EXPLICIT TOOLS / PLATFORMS / ACRONYMS:\n${allowedTermsText}`,
    `\nREMOVE THESE UNSUPPORTED TERMS IF PRESENT:\n${unsupportedText}`,
    `\nPRIORITY REWRITE TARGETS:\n${priorityRewriteText}`,
    englishStyleBlock ? `\n${englishStyleBlock}` : "",
    `\nANALYSIS SUMMARY:\n${summary || "(none)"}`,
    `\nHIGH PRIORITY KEYWORD GAPS (context only, do not force):\n${keywordsText || "(none)"}`,
    "\nSELF-CHECK BEFORE RETURNING:",
    "- unsupported terms removed",
    "- no invented tools/platforms/acronyms",
    "- no invented outcomes or ownership",
    "- no unjustified leadership escalation",
    "- no major bullet loss",
    `\nRESUME (original):\n${cv}`,
    hasJD ? `\nJOB DESCRIPTION:\n${jd}` : "",
    `\nCURRENT OPTIMIZED CV (rewrite this into a stronger final version):\n${currentOptimizedCv}`,
  ].filter(Boolean).join("\n");
}

function sanitizeStringInput(value = "", maxChars = 40000) {
  return normalizeSpace(String(value || "").slice(0, maxChars));
}

function ensureArrayStrings(value, maxItems = 20, maxChars = 120) {
  return uniqueByNormalizedStrings((Array.isArray(value) ? value : []).map((item) => cleanKeywordCandidate(String(item || "").slice(0, maxChars))).filter(Boolean)).slice(0, maxItems);
}

function buildPreviewResponse({ normalized, hasJD }) {
  return {
    ats_score: normalized.ats_score,
    summary: normalized.summary,
    missing_keywords: normalized.missing_keywords.slice(0, 5),
    weak_sentences: normalized.weak_sentences.slice(0, 2),
    review_mode: hasJD ? "job_specific" : "general",
  };
}

function initEventStream(res) {
  res.writeHead(200, {
    "Content-Type": "text/event-stream; charset=utf-8",
    "Cache-Control": "no-cache, no-transform",
    Connection: "keep-alive",
    "X-Accel-Buffering": "no",
  });
  res.flushHeaders?.();
}

function sendEvent(res, event, data) {
  res.write(`event: ${event}\n`);
  res.write(`data: ${JSON.stringify(data)}\n\n`);
}

function createProgressSender(res) {
  let lastPercent = 0;
  return (percent, label) => {
    const safePercent = Math.max(lastPercent, Math.min(100, Number(percent) || 0));
    lastPercent = safePercent;
    sendEvent(res, "progress", { percent: safePercent, label: String(label || "") });
  };
}

function sendStreamError(res, message, extra = {}) {
  sendEvent(res, "error", { message: message || "Server error", ...extra });
  sendEvent(res, "done", { ok: false });
  res.end();
}

async function executeAnalysis({ req, progress = () => {} }) {
  const body = req.body && typeof req.body === "object" ? req.body : {};
  const cv = sanitizeStringInput(body.cv || "", 50000);
  const jd = sanitizeStringInput(body.jd || "", 30000);
  const previewRequested = !!body.preview;
  const langCode = typeof body.lang === "string" && body.lang.trim() ? body.lang.trim().toLowerCase() : "en";
  const outLang = LANG_MAP[langCode] || "English";

  if (!cv) {
    const err = new Error("cv is required");
    err.status = 400;
    throw err;
  }

  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    const err = new Error("OPENAI_API_KEY is missing on Vercel");
    err.status = 500;
    throw err;
  }

  progress(10, "Checking access and limits...");

  const hasJD = !!jd;
  const sessionOk = verifySession(req);
  const isPreview = previewRequested || !sessionOk;

  const previewModel = process.env.OPENAI_MODEL_PREVIEW || process.env.OPENAI_MODEL || "gpt-5-mini";
  const fullModel = process.env.OPENAI_MODEL_FULL || process.env.OPENAI_MODEL || "gpt-5-mini";
  const model = isPreview ? previewModel : fullModel;

  const ip = getClientIp(req);
  const limiter = isPreview ? rlPreview : rlFull;
  const { success, reset } = await limiter.limit(ip);
  if (!success) {
    const err = new Error("Too many requests");
    err.status = 429;
    err.retry_after_seconds = Math.max(1, Math.ceil((reset - Date.now()) / 1000));
    throw err;
  }

  progress(18, "Detecting role profile...");

  const roleProfile = inferRoleProfile(cv, jd);
  const systemPrompt = buildAtsSystem(outLang);

  progress(30, "Analyzing ATS score and structure...");

  const analysisData = await callOpenAIJson({
    apiKey,
    model,
    system: systemPrompt,
    userPrompt: buildAnalysisPrompt({ cv, jd, hasJD, outLang, roleProfile, isPreview }),
    isPreview,
    passType: "main",
    maxCompletionTokens: isPreview ? 1000 : 1800,
  });

  progress(45, "Reviewing weak phrases...");

  const componentScores = analysisData?.component_scores && typeof analysisData.component_scores === "object" ? analysisData.component_scores : {};
  const deterministicScore = computeDeterministicAtsScore(cv, jd, roleProfile);
  const modelComponentScore = computeComponentScore(componentScores, hasJD);
  const mergedBaseScore = clampScore(Math.round(deterministicScore * 0.8 + modelComponentScore * 0.2));

  let weakSentences = filterWeakSentences(Array.isArray(analysisData?.weak_sentences) ? analysisData.weak_sentences : [], { outLang, roleInput: roleProfile, cv, jd });

  const detectedWeakCandidates = detectWeakSentenceCandidates(cv, roleProfile, isPreview ? 2 : 6, 12);
  const desiredWeakCount = getDesiredWeakCount(hasJD, detectedWeakCandidates.length);

  if (weakSentences.length < Math.min(isPreview ? 2 : desiredWeakCount, detectedWeakCandidates.length)) {
    try {
      const fallbackWeakData = await callOpenAIJson({
        apiKey,
        model,
        system: systemPrompt,
        userPrompt: buildWeakRewriteFallbackPrompt({ cv, jd, hasJD, candidates: detectedWeakCandidates, outLang, roleProfile }),
        isPreview,
        passType: "bullet",
        maxCompletionTokens: isPreview ? 1200 : 1800,
      });
      weakSentences = mergeWeakSentenceSets(weakSentences, Array.isArray(fallbackWeakData?.weak_sentences) ? fallbackWeakData.weak_sentences : [], roleProfile, outLang, cv, jd, isPreview ? 4 : 12);
    } catch {}
  }

  if (weakSentences.length < Math.min(isPreview ? 2 : desiredWeakCount, detectedWeakCandidates.length)) {
    weakSentences = mergeWeakSentenceSets(weakSentences, buildLocalWeakSentenceSet(detectedWeakCandidates, roleProfile, outLang, cv, jd, isPreview ? 4 : 12), roleProfile, outLang, cv, jd, isPreview ? 4 : 12);
  }

  progress(58, "Building keyword suggestions...");

  const normalized = {
    ats_score: mergedBaseScore,
    component_scores: componentScores,
    missing_keywords: finalizeMissingKeywords(ensureArrayStrings(analysisData?.missing_keywords, hasJD ? 20 : 18), { cv, jd, roleInput: roleProfile, hasJD, limit: isPreview ? 7 : hasJD ? 20 : 18 }),
    weak_sentences: weakSentences,
    summary: typeof analysisData?.summary === "string" ? normalizeSpace(analysisData.summary) : "",
    optimized_cv: "",
    optimized_ats_score: mergedBaseScore,
  };

  if (isPreview) {
    return { hasJD, result: buildPreviewResponse({ normalized, hasJD }) };
  }

  progress(68, "Generating stronger bullet rewrites...");

  let bulletUpgrades = [];
  if (normalized.weak_sentences.length > 0) {
    try {
      const bulletData = await callOpenAIJson({
        apiKey,
        model,
        system: systemPrompt,
        userPrompt: buildTargetedBulletUpgradePrompt({ cv, jd, hasJD, weakSentences: normalized.weak_sentences, outLang, roleProfile }),
        isPreview: false,
        passType: "bullet",
        maxCompletionTokens: 1400,
      });
      bulletUpgrades = normalizeBulletUpgrades(Array.isArray(bulletData?.bullet_upgrades) ? bulletData.bullet_upgrades : [], outLang, roleProfile, cv, jd);
    } catch {
      bulletUpgrades = [];
    }
  }

  if (!bulletUpgrades.length && normalized.weak_sentences.length > 0) {
    bulletUpgrades = normalizeBulletUpgrades(buildLocalBulletUpgradeFallback(normalized.weak_sentences), outLang, roleProfile, cv, jd);
  }

  progress(80, "Generating optimized resume...");

  let currentOptimized = "";
  let unsupportedTerms = [];

  try {
    const optimizeData = await callOpenAIJson({
      apiKey,
      model,
      system: systemPrompt,
      userPrompt: buildOptimizePrompt({
        cv,
        jd,
        hasJD,
        summary: normalized.summary,
        missingKeywords: normalized.missing_keywords,
        bulletUpgrades,
        outLang,
        roleProfile,
      }),
      isPreview: false,
      passType: "optimize",
      maxCompletionTokens: 3000,
    });

    if (typeof optimizeData?.optimized_cv === "string" && optimizeData.optimized_cv.trim()) {
      currentOptimized = forceSafeResume(cv, optimizeData.optimized_cv.trim(), outLang);
      if (bulletUpgrades.length) currentOptimized = applyBulletUpgradesToCv(cv, currentOptimized, bulletUpgrades, outLang);
      unsupportedTerms = findUnsupportedTerms(cv, jd, currentOptimized);
    }
  } catch {
    currentOptimized = "";
    unsupportedTerms = [];
  }

  if (!currentOptimized) {
    currentOptimized = bulletUpgrades.length ? applyBulletUpgradesToCv(cv, cv, bulletUpgrades, outLang) : forceSafeResume(cv, cv, outLang);
    unsupportedTerms = findUnsupportedTerms(cv, jd, currentOptimized);
  }

  progress(92, "Running final quality checks...");

  if (shouldRepairOptimizedCv(cv, currentOptimized, jd, outLang, normalized.weak_sentences, roleProfile) || unsupportedTerms.length > 0) {
    try {
      const repaired = await callOpenAIJson({
        apiKey,
        model,
        system: systemPrompt,
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
          roleProfile,
        }),
        isPreview: false,
        passType: "repair",
        maxCompletionTokens: 3000,
      });
      if (typeof repaired?.optimized_cv === "string" && repaired.optimized_cv.trim()) {
        currentOptimized = forceSafeResume(cv, repaired.optimized_cv.trim(), outLang);
        if (bulletUpgrades.length) currentOptimized = applyBulletUpgradesToCv(cv, currentOptimized, bulletUpgrades, outLang);
        unsupportedTerms = findUnsupportedTerms(cv, jd, currentOptimized);
      }
    } catch {}
  }

  normalized.optimized_cv = currentOptimized;
  normalized.optimized_ats_score = computeFinalOptimizedScore(cv, currentOptimized, normalized.ats_score, jd);

  return {
    hasJD,
    result: {
      ats_score: normalized.ats_score,
      optimized_ats_score: normalized.optimized_ats_score,
      component_scores: normalized.component_scores,
      missing_keywords: normalized.missing_keywords,
      weak_sentences: normalized.weak_sentences,
      optimized_cv: normalized.optimized_cv,
      summary: normalized.summary,
      review_mode: hasJD ? "job_specific" : "general",
    },
  };
}

export async function analyzeHandler(req, res) {
  try {
    if (req.method !== "POST") return res.status(405).json({ error: "POST required" });
    const { result } = await executeAnalysis({ req, progress: () => {} });
    return res.status(200).json(result);
  } catch (err) {
    const status = err?.status || 500;
    const payload = { error: err?.message || "Server error" };
    if (err?.retry_after_seconds) payload.retry_after_seconds = err.retry_after_seconds;
    if (err?.details) payload.details = err.details;
    return res.status(status).json(payload);
  }
}

export async function analyzeProgressHandler(req, res) {
  if (req.method !== "POST") return res.status(405).json({ error: "POST required" });
  initEventStream(res);
  const progress = createProgressSender(res);
  try {
    progress(4, "Reading resume...");
    const { result } = await executeAnalysis({ req, progress });
    progress(100, "Completed.");
    sendEvent(res, "result", result);
    sendEvent(res, "done", { ok: true });
    return res.end();
  } catch (err) {
    const extra = {};
    if (err?.retry_after_seconds) extra.retry_after_seconds = err.retry_after_seconds;
    if (err?.status) extra.status = err.status;
    if (err?.details) extra.details = err.details;
    return sendStreamError(res, err?.message || "Server error", extra);
  }
}
