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

const LANG_MAP = {
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

const GENERIC_SUMMARY_RE = /^(experienced|results[- ]driven|motivated|detail[- ]oriented|hardworking|dedicated|dynamic|versatile|organized|responsible|experienced professional|deneyimli|sonuç odaklı|motivasyonu yüksek|detay odaklı|çalışkan|disiplinli|öğrenmeye açık|sorumluluk sahibi)\b/i;
const WEAK_VERB_RE = /\b(helped|helps|assisted|assists|supported|supports|worked on|responsible for|contributed to|participated in|involved in|handled|tasked with|duties included|provided support|yardımcı oldum|destek oldum|destek verdim|görev aldım|ilgilen(dim|di)|çalıştım|yaptım|sorumluydum|takip ettim|katıldım)\b/i;
const WEAK_START_RE = /^(helped|helps|assisted|assists|supported|supports|worked on|responsible for|contributed to|participated in|involved in|handled|tasked with|duties included|provided support|yardımcı oldum|destek oldum|destek verdim|görev aldım|ilgilen(dim|di)|çalıştım|yaptım|sorumluydum)\b/i;
const STRONG_ACTION_RE = /\b(built|developed|designed|implemented|integrated|tested|debugged|optimized|deployed|maintained|automated|configured|analyzed|reported|tracked|prepared|reviewed|reconciled|processed|scheduled|coordinated|organized|documented|validated|monitored|delivered|created|managed|planned|mapped|executed|screened|taught|assessed|inspected|responded|resolved|guided|engineered|modeled|implemented|yönettim|koordine ettim|hazırladım|analiz ettim|raporladım|geliştirdim|oluşturdum|uyguladım|organize ettim|izledim|optimize ettim|tasarladım|planladım|sundum|denetledim|doğruladım|uzlaştırdım|işledim|değerlendirdim)\b/i;
const LOW_VALUE_KEYWORD_RE = /\b(communication|teamwork|hardworking|motivated|detail[- ]oriented|problem solving|leadership|microsoft office|ms office|computer skills|organizasyon|iletişim|takım çalışması|motivasyon|çözüm odaklı|detay odaklı|uyumlu|çalışkan|analysis|support|management|beceri|yetenek|deneyim)\b/i;
const JD_CUE_RE = /\b(requirements|required|must have|nice to have|preferred|responsibilities|qualification|qualifications|experience with|knowledge of|proficient in|aranan nitelikler|gerekli|tercihen|yetkinlikler|sorumluluklar|beklentiler)\b/i;
const ACRONYM_RE = /\b[A-Z]{2,}(?:\/[A-Z]{2,})?\b/;
const CERTIFICATION_RE = /\b(pmp|csm|psm|scrum master|cpa|cfa|acca|ifrs|gaap|lean six sigma|six sigma|itil|hipaa|aws certified|azure fundamentals|google ads certification)\b/i;
const ENGLISH_FLUFF_RE = /\b(dynamic|robust|seamless|impactful|high-impact|comprehensive|various|overall|best-in-class|value-driven|strategic initiatives|operational excellence)\b/i;
const ENGLISH_RISKY_OUTCOME_RE = /\b(resulting in|driving|boosting|enhancing|improving|increasing|streamlining|maximizing|delivering)\b/i;
const WEAK_REWRITE_RESIDUAL_RE = /\b(helped|helps|assisted|assists|supported|supports|contributed to|participated in|involved in|worked on|responsible for|provided support|helped with|assisted with|destek oldum|destek verdim|yardımcı oldum|görev aldım|katkı sağladım|katıldım|çalıştım|yaptım|sorumluydum)\b/i;
const WEAK_REWRITE_START_RE = /^(helped|helps|assisted|assists|supported|supports|contributed to|participated in|involved in|worked on|responsible for|provided support|helped with|assisted with|handled|destek oldum|destek verdim|yardımcı oldum|görev aldım|katkı sağladım|katıldım|çalıştım|yaptım|sorumluydum)\b/i;
const SOFT_ACTION_START_RE = /^(prepared|maintained|coordinated|tracked|updated|processed|documented|communicated|organized|reviewed|monitored|followed up on|responded to|scheduled|compiled|recorded|handled)\b/i;
const GENERIC_TASK_RE = /\b(daily tasks?|routine tasks?|general support|various tasks?|team support|support activities|campaign tasks?|backend improvements?|customer requests?|internal service updates?|documentation tasks?|administrative tasks?|follow-?up tasks?|service tasks?|general coordination|basic reporting|report preparation|operations tasks?|record keeping|data entry|office tasks?)\b/i;
const SCOPE_CONTEXT_RE = /\b(using|with|for|across|through|via|by|on|under|according to|per|regarding|including|covering|handling|tracking|supporting|kullanarak|ile|için|kapsamında|üzerinde|aracılığıyla|konusunda)\b/i;

const ROLE_TAXONOMY = {
  software_engineering: {
    titles: [
      "software engineer", "software developer", "backend engineer", "backend developer", "frontend engineer", "frontend developer",
      "full stack developer", "full-stack developer", "web developer", "application developer", "mobile developer", "ios developer",
      "android developer", "devops engineer", "site reliability engineer", "systems engineer",
    ],
    signals: [
      "software development", "backend", "frontend", "full stack", "api integration", "database", "system design", "debugging",
      "deployment", "cloud", "microservices", "version control", "code review", "rest api", "ci/cd", "unit testing",
      "integration testing", "performance optimization", "docker", "kubernetes", "aws", "azure", "gcp", "react", "node.js",
      "javascript", "typescript", "python", "java", "c#", "sql",
    ],
    keywords: [
      "REST APIs", "microservices", "system design", "unit testing", "integration testing", "cloud services", "database optimization",
      "CI/CD", "version control", "debugging", "performance tuning", "agile development",
    ],
    verbs: ["built", "developed", "implemented", "integrated", "tested", "debugged", "deployed", "optimized", "maintained"],
    safeSupportVerbs: ["maintained", "tested", "documented", "collaborated with", "integrated with"],
  },
  qa: {
    titles: ["qa engineer", "quality assurance engineer", "software tester", "test engineer", "qa analyst", "automation tester", "manual tester"],
    signals: ["quality assurance", "test cases", "test scenarios", "regression testing", "smoke testing", "uat", "selenium", "cypress", "postman", "jira", "bug tracking", "defect management", "test automation"],
    keywords: ["test cases", "regression testing", "defect tracking", "test documentation", "UAT", "API testing", "automation testing", "quality validation"],
    verbs: ["tested", "validated", "documented", "reported", "tracked", "verified", "executed", "automated"],
    safeSupportVerbs: ["documented", "tracked", "verified", "executed"],
  },
  data_analytics: {
    titles: ["data analyst", "business intelligence analyst", "bi analyst", "analytics specialist", "reporting analyst", "data specialist"],
    signals: ["data analysis", "analytics", "dashboard", "reporting", "kpi", "trend analysis", "data validation", "power bi", "tableau", "looker studio", "etl", "data modeling", "sql", "python", "excel"],
    keywords: ["SQL", "data visualization", "dashboard reporting", "trend analysis", "KPI tracking", "data validation", "Power BI", "Tableau", "report automation", "data modeling", "ETL"],
    verbs: ["analyzed", "reported", "tracked", "validated", "prepared", "reviewed", "modeled"],
    safeSupportVerbs: ["reported", "tracked", "validated", "prepared", "maintained"],
  },
  product_project: {
    titles: ["product manager", "product owner", "associate product manager", "technical product manager", "project manager", "project coordinator", "program manager", "project coordinator"],
    signals: ["roadmap", "backlog", "user stories", "requirements gathering", "acceptance criteria", "stakeholder communication", "release planning", "jira", "confluence", "agile", "scrum", "timeline", "deliverables", "milestones", "risk tracking"],
    keywords: ["product roadmap", "backlog prioritization", "requirements gathering", "user stories", "acceptance criteria", "release planning", "stakeholder communication", "timeline management", "deliverable coordination", "risk tracking"],
    verbs: ["defined", "prioritized", "coordinated", "planned", "aligned", "tracked", "facilitated", "documented"],
    safeSupportVerbs: ["coordinated", "tracked", "scheduled", "documented", "aligned with"],
  },
  sales: {
    titles: ["sales specialist", "sales executive", "account executive", "sales coordinator", "business development executive", "account manager"],
    signals: ["sales", "pipeline", "crm", "lead follow-up", "proposal", "deal tracking", "sales reporting", "salesforce", "hubspot", "client communication", "order processing"],
    keywords: ["sales pipeline", "lead management", "CRM", "proposal preparation", "deal tracking", "account coordination", "client follow-up", "Salesforce", "HubSpot"],
    verbs: ["managed", "followed up", "coordinated", "prepared", "updated", "processed", "documented"],
    safeSupportVerbs: ["followed up on", "coordinated", "prepared", "updated", "processed"],
  },
  marketing: {
    titles: ["digital marketing specialist", "marketing specialist", "performance marketing specialist", "marketing executive", "growth marketer", "content specialist"],
    signals: ["google ads", "meta ads", "google analytics", "ga4", "google tag manager", "seo", "sem", "ppc", "campaign reporting", "content marketing", "email marketing", "social media", "lead generation", "a/b test"],
    keywords: ["PPC", "SEO", "SEM", "GA4", "Google Tag Manager", "audience segmentation", "A/B testing", "lead generation", "campaign optimization", "analytics reporting"],
    verbs: ["managed", "optimized", "analyzed", "tracked", "reported", "executed", "launched", "monitored"],
    safeSupportVerbs: ["coordinated", "prepared", "tracked", "updated", "monitored"],
  },
  finance_accounting: {
    titles: ["accountant", "financial analyst", "finance specialist", "accounts payable specialist", "accounts receivable specialist", "bookkeeper", "finance assistant"],
    signals: ["financial reporting", "reconciliation", "accounts payable", "accounts receivable", "invoice processing", "budget tracking", "expense reporting", "forecasting", "variance analysis", "audit support", "ledger", "month-end", "sap", "oracle", "erp", "ifrs", "gaap"],
    keywords: ["financial reporting", "account reconciliation", "budget tracking", "variance analysis", "forecasting", "month-end close", "AP/AR", "audit support", "ERP systems", "GAAP", "IFRS"],
    verbs: ["prepared", "reconciled", "processed", "reviewed", "tracked", "reported", "maintained"],
    safeSupportVerbs: ["prepared", "reconciled", "processed", "reviewed", "tracked"],
  },
  hr_recruiting: {
    titles: ["hr specialist", "human resources specialist", "recruiter", "talent acquisition specialist", "hr coordinator", "people operations specialist"],
    signals: ["recruiting", "candidate screening", "interview scheduling", "employee records", "onboarding", "offboarding", "training coordination", "hr administration", "compliance", "payroll support", "workday", "greenhouse", "ats", "hris"],
    keywords: ["talent acquisition", "candidate screening", "interview coordination", "employee onboarding", "HR administration", "policy compliance", "record management", "ATS", "Workday", "Greenhouse"],
    verbs: ["screened", "scheduled", "coordinated", "maintained", "prepared", "documented", "updated"],
    safeSupportVerbs: ["scheduled", "coordinated", "maintained", "documented", "updated"],
  },
  operations: {
    titles: ["operations manager", "operations specialist", "operations coordinator", "operations analyst", "office manager"],
    signals: ["operations", "workflow", "documentation", "reporting", "process coordination", "process improvement", "scheduling", "cross-functional coordination", "vendor communication", "record keeping", "status reporting"],
    keywords: ["process improvement", "workflow coordination", "vendor communication", "cross-functional collaboration", "status reporting", "documentation", "task prioritization", "operational tracking"],
    verbs: ["coordinated", "tracked", "organized", "maintained", "documented", "scheduled", "reported", "monitored"],
    safeSupportVerbs: ["coordinated", "tracked", "organized", "maintained", "documented"],
  },
  procurement_supply_chain: {
    titles: ["procurement specialist", "purchasing specialist", "buyer", "sourcing specialist", "logistics specialist", "logistics coordinator", "inventory specialist", "warehouse coordinator"],
    signals: ["procurement", "purchasing", "sourcing", "vendor management", "purchase orders", "rfq", "supplier communication", "cost comparison", "inventory management", "shipment tracking", "warehouse operations", "logistics coordination", "stock control", "order fulfillment", "sap", "erp"],
    keywords: ["vendor management", "sourcing", "purchase orders", "supplier communication", "RFQ", "inventory management", "shipment tracking", "warehouse operations", "ERP systems", "order fulfillment"],
    verbs: ["sourced", "processed", "coordinated", "reviewed", "tracked", "documented", "communicated"],
    safeSupportVerbs: ["processed", "coordinated", "reviewed", "tracked", "documented"],
  },
  customer_support: {
    titles: ["customer support specialist", "customer service representative", "support specialist", "technical support specialist", "help desk specialist", "customer success specialist", "customer success manager"],
    signals: ["customer support", "ticket handling", "issue resolution", "live chat", "email support", "complaint handling", "service quality", "crm", "zendesk", "freshdesk", "sla", "escalation", "onboarding", "renewal", "retention", "csat", "nps", "qbr"],
    keywords: ["ticket management", "issue resolution", "service quality", "SLA", "escalation handling", "support documentation", "customer communication", "Zendesk", "CRM", "case follow-up", "customer onboarding", "account management"],
    verbs: ["responded", "resolved", "escalated", "documented", "maintained", "communicated", "processed", "tracked", "guided"],
    safeSupportVerbs: ["responded to", "followed up on", "documented", "maintained", "updated", "communicated with"],
  },
  administration: {
    titles: ["executive assistant", "personal assistant", "administrative assistant", "office assistant", "admin assistant", "executive coordinator"],
    signals: ["calendar management", "travel coordination", "meeting coordination", "document preparation", "executive support", "scheduling", "record keeping", "office administration", "filing", "data entry"],
    keywords: ["calendar management", "meeting coordination", "travel coordination", "document management", "record maintenance", "executive support", "office administration", "task prioritization", "time management"],
    verbs: ["managed", "organized", "scheduled", "prepared", "maintained", "coordinated", "documented"],
    safeSupportVerbs: ["organized", "scheduled", "prepared", "maintained", "coordinated"],
  },
  education: {
    titles: ["teacher", "instructor", "lecturer", "teaching assistant", "english teacher", "math teacher"],
    signals: ["lesson planning", "classroom management", "student assessment", "curriculum", "instruction", "student support", "learning materials", "student progress", "parent communication"],
    keywords: ["lesson planning", "classroom management", "student assessment", "curriculum development", "learning materials", "student progress tracking", "instruction"],
    verbs: ["planned", "delivered", "prepared", "assessed", "supported", "tracked", "organized", "taught"],
    safeSupportVerbs: ["prepared", "tracked", "organized", "communicated with"],
  },
  healthcare_administration: {
    titles: ["healthcare administrator", "medical secretary", "medical office assistant", "patient coordinator", "clinic coordinator"],
    signals: ["patient scheduling", "medical records", "insurance verification", "ehr", "emr", "clinic operations", "appointment coordination", "hipaa", "patient communication", "patient intake"],
    keywords: ["patient scheduling", "medical records", "insurance verification", "EHR/EMR", "appointment coordination", "HIPAA", "patient communication", "clinic administration"],
    verbs: ["scheduled", "coordinated", "updated", "maintained", "verified", "documented", "communicated"],
    safeSupportVerbs: ["scheduled", "updated", "maintained", "verified", "documented"],
  },
  design: {
    titles: ["designer", "graphic designer", "ui designer", "ux designer", "product designer", "visual designer"],
    signals: ["figma", "adobe creative suite", "photoshop", "illustrator", "wireframes", "prototypes", "ui", "ux", "design system", "mockups", "visual design", "brand assets"],
    keywords: ["Figma", "wireframing", "prototyping", "design systems", "UI design", "UX design", "user flows", "visual design", "Adobe Creative Suite", "mockups"],
    verbs: ["designed", "created", "developed", "prepared", "produced", "refined", "updated"],
    safeSupportVerbs: ["prepared", "produced", "updated", "collaborated with"],
  },
  engineering_construction: {
    titles: ["civil engineer", "site engineer", "construction engineer", "mechanical engineer", "design engineer", "maintenance engineer", "production engineer", "industrial engineer"],
    signals: ["autocad", "revit", "primavera p6", "site supervision", "technical drawings", "quantity takeoff", "boq", "construction documentation", "inspection", "solidworks", "equipment maintenance", "preventive maintenance", "root cause analysis", "production support", "quality checks"],
    keywords: ["AutoCAD", "Revit", "Primavera P6", "site supervision", "quantity takeoff", "BOQ", "technical documentation", "SolidWorks", "preventive maintenance", "equipment inspection", "quality checks"],
    verbs: ["reviewed", "prepared", "coordinated", "tracked", "inspected", "documented", "supported", "designed"],
    safeSupportVerbs: ["reviewed", "prepared", "coordinated", "tracked", "documented"],
  },
  legal_support: {
    titles: ["legal assistant", "paralegal", "legal secretary", "compliance assistant"],
    signals: ["legal documentation", "contract review", "case files", "compliance", "regulatory", "document management", "filing", "research", "case support"],
    keywords: ["legal documentation", "contract support", "case file management", "compliance documentation", "regulatory support", "document review"],
    verbs: ["prepared", "reviewed", "organized", "maintained", "documented", "coordinated"],
    safeSupportVerbs: ["prepared", "reviewed", "organized", "maintained", "documented"],
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
  "google ads", "meta ads", "google analytics", "ga4", "google tag manager", "seo", "sem", "ppc", "hubspot", "salesforce", "crm",
  "zendesk", "freshdesk", "jira", "confluence", "tableau", "power bi", "looker studio", "excel", "google sheets", "powerpoint",
  "sql", "python", "javascript", "typescript", "react", "node.js", "java", "c#", "aws", "azure", "gcp", "docker", "kubernetes",
  "git", "ci/cd", "rest api", "microservices", "unit testing", "integration testing", "selenium", "cypress", "postman", "figma",
  "adobe creative suite", "photoshop", "illustrator", "autocad", "solidworks", "revit", "primavera p6", "sap", "oracle", "quickbooks",
  "netsuite", "erp", "ifrs", "gaap", "accounts payable", "accounts receivable", "payroll", "forecasting", "variance analysis", "budgeting",
  "audit", "reconciliation", "workday", "greenhouse", "ats", "agile", "scrum", "kanban", "lean", "six sigma", "pmp", "csm", "psm",
  "etl", "data modeling", "ehr", "emr", "hipaa", "inventory management", "warehouse management", "procurement", "sourcing", "vendor management",
  "csat", "nps", "qbr", "a/b test", "remarketing", "retargeting", "lead generation", "boq",
]);

const BRAND_TERMS = new Set([
  "google ads", "meta ads", "google analytics", "ga4", "google tag manager", "hubspot", "salesforce", "zendesk", "freshdesk",
  "jira", "confluence", "tableau", "power bi", "looker studio", "react", "node.js", "aws", "azure", "gcp", "docker", "kubernetes",
  "selenium", "cypress", "postman", "figma", "adobe creative suite", "photoshop", "illustrator", "autocad", "solidworks", "revit",
  "primavera p6", "sap", "oracle", "quickbooks", "netsuite", "workday", "greenhouse",
].map(canonicalizeTerm));

const ALL_ROLE_TERMS = uniqueTrimmedStrings(
  Object.values(ROLE_TAXONOMY).flatMap((role) => [...(role.titles || []), ...(role.signals || []), ...(role.keywords || [])])
);

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
  let s = normalizeCompareText(str)
    .replace(/[\/_-]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();

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
  return uniqueTrimmedStrings(terms).reduce((sum, term) => {
    return sum + (containsCanonicalTermInText(hay, term) ? 1 : 0);
  }, 0);
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
  return normalizeSpace(str)
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);
}

function getBulletLines(str = "") {
  return normalizeSpace(str)
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => BULLET_RE.test(line))
    .map((line) => line.replace(BULLET_RE, "").trim())
    .filter(Boolean);
}

function tokenizeForSimilarity(str = "") {
  return canonicalizeTerm(str)
    .split(/\s+/)
    .map((x) => x.trim())
    .filter((x) => x.length > 1);
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
  return s ? s.charAt(0).toUpperCase() + s.slice(1) : s;
}

function lowerFirst(str = "") {
  const s = String(str || "").trim();
  return s ? s.charAt(0).toLowerCase() + s.slice(1) : s;
}

function isSectionHeader(line = "") {
  return HEADER_SECTION_RE.test(String(line || "").trim());
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

  return {
    experienceBullets,
    summaryLines: extractSummaryLines(cv),
    otherBullets,
  };
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
      if (prev && !isSectionHeader(prev) && !prev.includes("@") && !/^\d/.test(prev)) {
        titles.push(prev);
      }
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
  const body = lines.slice(sectionIdx).join("\n").trim();
  return `${originalHeader.join("\n")}\n\n${body}`.trim();
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
  for (const item of orig) {
    if (optSet.has(item)) same += 1;
  }
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
  return String(term || "")
    .replace(/\r/g, " ")
    .replace(/^[-•·‣▪▫◦*0-9.)\s]+/, "")
    .replace(/\s+/g, " ")
    .replace(/^[,;:]+|[,;:]+$/g, "")
    .trim();
}

function isLowValueKeyword(term = "") {
  const cleaned = cleanKeywordCandidate(term);
  if (!cleaned) return true;
  const norm = canonicalizeTerm(cleaned);
  const wc = countWords(cleaned);
  if (wc === 1 && norm.length < 4 && !looksLikeAcronym(cleaned)) return true;
  if (LOW_VALUE_KEYWORD_RE.test(cleaned) && wc <= 3) return true;
  if (/^(experience|knowledge|skills|skill|management|analysis|support|reporting|communication|documentation|tecrube|deneyim|beceri|yetenek|analiz|destek|raporlama)$/i.test(norm)) return true;
  return false;
}

function extractExplicitFactTerms(text = "") {
  const hay = canonicalizeTerm(text);
  return HARD_FACT_TERMS.filter((term, idx, arr) => arr.indexOf(term) === idx && containsCanonicalTermInText(hay, term));
}

function inferSeniority(text = "") {
  const norm = normalizeCompareText(text);
  if (/\b(chief|vp|vice president|director|head of|department head|general manager)\b/i.test(norm)) return "leadership";
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
      return { key, score, titleHits, skillHits, signalHits, keywordHits, summaryHits, bulletHits };
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
  const domainSignals = uniqueTrimmedStrings(
    packs.flatMap((role) => [...(role.signals || []), ...(role.keywords || [])])
  ).filter((term) => containsCanonicalTermInText(combined, term)).slice(0, 18);

  return {
    roleGroups: finalGroups,
    primaryRole: finalGroups[0] || "generic",
    secondaryRoles: finalGroups.slice(1),
    seniority: inferSeniority(`${titleText}\n${combined}`),
    domainSignals,
    scoredRoles: scored.slice(0, 6),
  };
}

function ensureRoleProfile(roleInput, cv = "", jd = "") {
  if (roleInput && typeof roleInput === "object" && Array.isArray(roleInput.roleGroups)) {
    return roleInput;
  }
  return inferRoleProfile(cv, jd);
}

function getRolePacks(roleInput, cv = "", jd = "") {
  const profile = ensureRoleProfile(roleInput, cv, jd);
  const packs = (profile.roleGroups || ["generic"]).map((key) => ROLE_TAXONOMY[key]).filter(Boolean);
  return packs.length ? packs : [ROLE_TAXONOMY.generic];
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

function getRoleSuggestedKeywords(roleInput, cv = "", jd = "") {
  const profile = ensureRoleProfile(roleInput, cv, jd);
  const packs = getRolePacks(profile);
  let out = uniqueTrimmedStrings(packs.flatMap((role) => role.keywords || []));
  if (profile.seniority === "manager_or_lead" || profile.seniority === "leadership") {
    out = uniqueTrimmedStrings(["stakeholder communication", "cross-functional collaboration", "process improvement", ...out]);
  }
  if (profile.seniority === "junior") {
    out = uniqueTrimmedStrings([...out, "documentation", "process adherence", "task coordination", "quality checks"]);
  }
  return out;
}

function buildRoleContextText(roleInput, cv = "", jd = "") {
  const profile = ensureRoleProfile(roleInput, cv, jd);
  const packs = getRolePacks(profile);
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
  const packs = getRolePacks(profile);
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

function looksLikeToolOrMethod(term = "", roleInput, cv = "", jd = "") {
  const profile = ensureRoleProfile(roleInput, cv, jd);
  const packs = getRolePacks(profile);
  const pool = uniqueTrimmedStrings([
    ...HARD_FACT_TERMS,
    ...packs.flatMap((role) => [...(role.signals || []), ...(role.keywords || [])]),
  ]);
  const norm = canonicalizeTerm(term);
  return pool.some((item) => canonicalizeTerm(item) === norm);
}

function isSafeCvOnlySuggestedTerm(term = "", roleInput, cv = "") {
  const profile = ensureRoleProfile(roleInput, cv, "");
  const norm = canonicalizeTerm(term);
  if (!norm || isLowValueKeyword(term)) return false;
  if (containsCanonicalTermInText(cv, norm)) return false;
  if (isBrandedOrVendorSpecific(term)) return false;
  const roleThemes = getRoleSuggestedKeywords(profile, cv, "");
  return roleThemes.some((item) => canonicalizeTerm(item) === norm || canonicalizeTerm(item).includes(norm) || norm.includes(canonicalizeTerm(item))) || looksLikeCertification(term);
}

function extractAcronymLikeTerms(text = "") {
  return uniqueTrimmedStrings((String(text || "").match(/\b[A-Z]{2,}(?:\/[A-Z]{2,})?\b/g) || []).map((x) => x.trim()).filter((x) => x.length <= 12));
}

function extractSkillLikeNgrams(text = "") {
  const clauses = normalizeSpace(text)
    .split(/[\n;•]/)
    .map((x) => x.trim())
    .filter(Boolean)
    .slice(0, 160);

  const hints = uniqueTrimmedStrings([
    "analysis", "analytics", "dashboard", "reporting", "forecasting", "budgeting", "reconciliation", "audit", "payable", "receivable",
    "payroll", "recruiting", "screening", "onboarding", "offboarding", "procurement", "sourcing", "vendor", "inventory", "warehouse",
    "logistics", "shipment", "support", "success", "retention", "renewal", "curriculum", "classroom", "assessment", "instruction",
    "patient", "insurance", "ehr", "emr", "testing", "automation", "qa", "quality", "sql", "python", "javascript", "typescript",
    "react", "node", "api", "microservices", "cloud", "docker", "kubernetes", "roadmap", "backlog", "stakeholder", "scrum", "agile",
    "design", "wireframe", "prototype", "figma", "autocad", "revit", "solidworks", "primavera", "civil", "mechanical", "legal", "compliance",
    "risk", "release", "deployment", "lesson", "schedule", "coordination", "documentation", "integration", "etl", "data modeling", "boq",
  ]);

  const out = [];
  for (const clause of clauses) {
    const tokens = clause
      .replace(/[^\p{L}\p{N}\s/#&+.-]/gu, " ")
      .split(/\s+/)
      .map((x) => x.trim())
      .filter(Boolean);

    for (let n = 4; n >= 1; n -= 1) {
      for (let i = 0; i <= tokens.length - n; i += 1) {
        const phrase = tokens.slice(i, i + n).join(" ").trim();
        const norm = canonicalizeTerm(phrase);
        if (!norm) continue;
        const wc = countWords(phrase);
        if (wc < 1 || wc > 4) continue;
        if (isLowValueKeyword(phrase)) continue;
        const hasHint = hints.some((hint) => containsCanonicalTermInText(norm, hint));
        if (hasHint || looksLikeAcronym(phrase) || looksLikeCertification(phrase)) {
          out.push(phrase);
        }
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
  if (!String(jd || "").trim()) {
    return { ranked: [], tools: [], methodologies: [], certifications: [], responsibilities: [], domains: [], senioritySignals: [] };
  }
  const profile = ensureRoleProfile(roleInput, cv, jd);
  const packs = getRolePacks(profile, cv, jd);
  const lexicon = uniqueTrimmedStrings([
    ...HARD_FACT_TERMS,
    ...packs.flatMap((role) => [...(role.signals || []), ...(role.keywords || []), ...(role.titles || [])]),
  ]);
  const directMatches = lexicon.filter((term) => containsCanonicalTermInText(jd, term));
  const ngrams = extractSkillLikeNgrams(jd);
  const acronyms = extractAcronymLikeTerms(jd);
  const candidates = uniqueByNormalizedStrings([...directMatches, ...ngrams, ...acronyms]);
  const ranked = candidates
    .map((term) => ({
      term,
      category: classifyTermCategory(term, profile, cv, jd),
      score: scoreExtractedTerm(term, jd, profile, cv, jd),
    }))
    .filter((item) => item.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, 40);
  return {
    ranked,
    tools: ranked.filter((item) => item.category === "tool").slice(0, 10).map((item) => item.term),
    methodologies: ranked.filter((item) => item.category === "methodology").slice(0, 10).map((item) => item.term),
    certifications: ranked.filter((item) => item.category === "certification").slice(0, 8).map((item) => item.term),
    responsibilities: ranked.filter((item) => item.category === "responsibility").slice(0, 10).map((item) => item.term),
    domains: ranked.filter((item) => item.category === "domain").slice(0, 10).map((item) => item.term),
    senioritySignals: ranked.filter((item) => item.category === "seniority").slice(0, 6).map((item) => item.term),
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
  const terms = uniqueTrimmedStrings([...extractExplicitFactTerms(cv), ...extractExplicitFactTerms(jd)]);
  return terms.length ? terms.join(", ") : "(none explicitly supported)";
}

function findUnsupportedTerms(originalCv = "", jd = "", optimizedCv = "") {
  const allowed = new Set(uniqueTrimmedStrings([...extractExplicitFactTerms(originalCv), ...extractExplicitFactTerms(jd)]).map(canonicalizeTerm));
  return uniqueTrimmedStrings(extractExplicitFactTerms(optimizedCv)).filter((term) => !allowed.has(canonicalizeTerm(term)));
}

function finalizeMissingKeywords(rawKeywords = [], { cv = "", jd = "", roleInput, outLang = "English", hasJD = false, limit = 12 } = {}) {
  const profile = ensureRoleProfile(roleInput, cv, jd);
  const cvNorm = canonicalizeTerm(cv);
  const modelTerms = uniqueByNormalizedStrings((Array.isArray(rawKeywords) ? rawKeywords : []).map(cleanKeywordCandidate).filter(Boolean));
  let pool = [...modelTerms];

  if (hasJD) {
    const jdTerms = extractJdSignalProfile(jd, profile, cv).ranked.map((item) => item.term);
    pool = uniqueByNormalizedStrings([...pool, ...jdTerms]);
  } else {
    pool = uniqueByNormalizedStrings([...pool, ...getRoleSuggestedKeywords(profile, cv, jd)]).filter((term) => isSafeCvOnlySuggestedTerm(term, profile, cv));
  }

  const scored = uniqueByNormalizedStrings(pool)
    .map((term) => {
      const norm = canonicalizeTerm(term);
      let score = 0;
      if (containsCanonicalTermInText(cvNorm, norm)) score -= hasJD ? 12 : 10;
      else score += 7;
      if (hasJD && containsCanonicalTermInText(jd, norm)) score += 10;
      if (!hasJD && !isSafeCvOnlySuggestedTerm(term, profile, cv)) score -= 20;
      if (HARD_FACT_TERMS.some((item) => canonicalizeTerm(item) === norm)) score += 6;
      if (looksLikeCertification(term)) score += 5;
      if (looksLikeToolOrMethod(term, profile, cv, jd)) score += 4;
      const wc = countWords(term);
      if (wc >= 2 && wc <= 4) score += 3;
      if (looksLikeAcronym(term)) score += 2;
      if (isLowValueKeyword(term)) score -= 14;
      if (!hasJD && isBrandedOrVendorSpecific(term)) score -= 20;
      return { term, score };
    })
    .filter((item) => item.score > -2)
    .sort((a, b) => b.score - a.score || countWords(b.term) - countWords(a.term));

  return scored.map((item) => item.term).slice(0, limit);
}

function getSentenceSignalProfile(sentence = "", roleInput, cv = "", jd = "") {
  const s = String(sentence || "").trim();
  const profile = ensureRoleProfile(roleInput, cv, jd);
  const packs = getRolePacks(profile, cv, jd);
  const roleTerms = uniqueTrimmedStrings(packs.flatMap((role) => [...(role.signals || []), ...(role.keywords || [])]));
  if (!s) {
    return {
      isWeakCandidate: false,
      clearWeak: false,
      moderatelyWeak: false,
      candidateTier: "none",
      weakScore: 0,
      strongScore: 0,
      improvementPotential: 0,
      hasSpecific: false,
      startsWeak: false,
      hasWeakPhrase: false,
      strongAction: false,
      hasScopeSignal: false,
      genericTask: false,
      softActionStart: false,
      roleHits: 0,
      explicitFactsCount: 0,
      wordCount: 0,
      hasConcreteRoleDetail: false,
      hasProtectedSpecificity: false,
      isReasonablyStrong: false,
    };
  }

  const wc = countWords(s);
  const explicitFacts = extractExplicitFactTerms(s);
  const acronymHits = extractAcronymLikeTerms(s).length;
  const roleHits = countTermHits(s, roleTerms);
  const hasNumber = /\b\d+(?:[.,]\d+)?%?\b/.test(s);
  const strongAction = STRONG_ACTION_RE.test(s);
  const startsWeak = WEAK_START_RE.test(s);
  const hasWeakPhrase = WEAK_VERB_RE.test(s);
  const genericSummary = GENERIC_SUMMARY_RE.test(s);
  const hasScopeSignal = SCOPE_CONTEXT_RE.test(s);
  const genericTask = GENERIC_TASK_RE.test(s);
  const softActionStart = SOFT_ACTION_START_RE.test(s);

  const explicitSpecificity = explicitFacts.length + acronymHits + (hasNumber ? 1 : 0);
  const hasConcreteRoleDetail = explicitSpecificity >= 1 || roleHits >= 2;
  const hasProtectedSpecificity = explicitSpecificity >= 2 || roleHits >= 3 || (roleHits >= 2 && hasScopeSignal);
  const hasMeaningfulContext = hasConcreteRoleDetail || hasScopeSignal;
  const hasSpecific = hasConcreteRoleDetail || (strongAction && roleHits >= 1 && hasScopeSignal);

  let strongScore = 0;
  let weakScore = 0;

  if (strongAction) strongScore += 3;
  if (hasNumber) strongScore += 2;
  if (explicitFacts.length > 0) strongScore += Math.min(3, explicitFacts.length);
  if (acronymHits > 0) strongScore += Math.min(2, acronymHits);
  if (roleHits > 0) strongScore += Math.min(4, roleHits);
  if (hasScopeSignal) strongScore += 1;
  if (wc >= 6 && wc <= 22) strongScore += 1;

  if (startsWeak) weakScore += hasConcreteRoleDetail ? 2 : 4;
  if (hasWeakPhrase) weakScore += hasConcreteRoleDetail ? 1 : 3;
  if (genericSummary) weakScore += 3;
  if (!hasSpecific) weakScore += 2;
  if (!strongAction) weakScore += 1;
  if (genericTask) weakScore += hasConcreteRoleDetail ? 1 : 2;
  if (softActionStart && !hasConcreteRoleDetail && !hasScopeSignal) weakScore += 2;
  else if (softActionStart && !hasMeaningfulContext) weakScore += 1;
  if (roleHits === 1 && !hasScopeSignal && explicitFacts.length === 0 && !strongAction) weakScore += 1;
  if (wc <= 5) weakScore += 2;
  else if (wc <= 8 && !hasSpecific) weakScore += 1;
  if (wc > 28) weakScore += 1;

  if (hasProtectedSpecificity && strongAction && !genericTask) weakScore -= 3;
  if (hasConcreteRoleDetail && hasScopeSignal) weakScore -= 2;
  if (explicitSpecificity > 0 && strongAction) weakScore -= 1;
  if (startsWeak && hasProtectedSpecificity && hasScopeSignal) weakScore -= 1;
  if (genericTask && strongAction && hasConcreteRoleDetail && hasScopeSignal) weakScore -= 1;

  const clearWeak =
    weakScore >= 8 ||
    (startsWeak && !hasConcreteRoleDetail && (strongScore <= 5 || genericTask)) ||
    (genericSummary && !hasSpecific) ||
    (hasWeakPhrase && genericTask && !hasConcreteRoleDetail && strongScore <= 5);

  const moderatelyWeak =
    !clearWeak &&
    (
      (weakScore >= 6 && strongScore <= 6) ||
      (
        weakScore >= 5 &&
        (startsWeak || hasWeakPhrase || genericTask || !hasMeaningfulContext || softActionStart) &&
        strongScore <= 7
      ) ||
      (
        weakScore >= 4 &&
        (startsWeak || genericTask || softActionStart) &&
        !hasProtectedSpecificity &&
        strongScore <= 6
      )
    );

  const isWeakCandidate = clearWeak || moderatelyWeak;
  const candidateTier = clearWeak ? "clear" : moderatelyWeak ? "moderate" : "none";
  const improvementPotential =
    Math.max(0, weakScore - Math.floor(strongScore / 2)) +
    (startsWeak ? 2 : 0) +
    (genericTask ? 2 : 0) +
    (!hasMeaningfulContext ? 1 : 0) +
    (softActionStart && !hasConcreteRoleDetail ? 1 : 0);

  const isReasonablyStrong =
    strongScore >= 6 &&
    hasSpecific &&
    !startsWeak &&
    !hasWeakPhrase &&
    !genericTask &&
    wc >= 6 &&
    wc <= 24;

  return {
    isWeakCandidate,
    clearWeak,
    moderatelyWeak,
    candidateTier,
    weakScore,
    strongScore,
    improvementPotential,
    hasSpecific,
    startsWeak,
    hasWeakPhrase,
    strongAction,
    hasScopeSignal,
    genericTask,
    softActionStart,
    roleHits,
    explicitFactsCount: explicitSpecificity,
    wordCount: wc,
    hasConcreteRoleDetail,
    hasProtectedSpecificity,
    hasMeaningfulContext,
    isReasonablyStrong,
  };
}

function detectWeakSentenceCandidates(cv = "", roleInput, minCount = 6, maxCount = 12) {
  const pools = extractWeakCandidatePools(cv);
  const candidates = [
    ...pools.experienceBullets.map((sentence) => ({ sentence, sourceType: "experience_bullet", sectionPriority: 4 })),
    ...pools.summaryLines.map((sentence) => ({ sentence, sourceType: "summary_line", sectionPriority: 2 })),
    ...pools.otherBullets.map((sentence) => ({ sentence, sourceType: "other_bullet", sectionPriority: 0 })),
  ];

  const ranked = candidates
    .map((item) => {
      const profile = getSentenceSignalProfile(item.sentence, roleInput, cv, "");
      const tierBoost = profile.candidateTier === "clear" ? 54 : profile.candidateTier === "moderate" ? 32 : 0;
      let rank =
        item.sectionPriority * 100 +
        tierBoost +
        profile.improvementPotential * 3 +
        (profile.startsWeak ? 8 : 0) +
        (profile.hasWeakPhrase ? 6 : 0) +
        (!profile.hasMeaningfulContext ? 5 : 0) +
        (profile.genericTask ? 5 : 0) -
        profile.strongScore * 2;

      if (/\b(team|support staff|internal service updates|daily tasks|routine communication|general support|various tasks|basic reporting)\b/i.test(item.sentence)) {
        rank += 4;
      }

      if (profile.hasProtectedSpecificity && profile.strongAction && !profile.genericTask) {
        rank -= 10;
      }

      return { ...item, profile, rank };
    })
    .filter((item) => {
      if (item.profile.isReasonablyStrong) return false;
      if (item.profile.hasProtectedSpecificity && item.profile.strongScore >= 6 && !item.profile.genericTask) return false;
      if (item.profile.clearWeak || item.profile.moderatelyWeak) return true;

      if (item.sourceType === "experience_bullet") {
        return (
          item.profile.weakScore >= 4 &&
          (
            (item.profile.startsWeak && !item.profile.hasProtectedSpecificity) ||
            item.profile.genericTask ||
            (item.profile.softActionStart && !item.profile.hasConcreteRoleDetail) ||
            (!item.profile.hasSpecific && !item.profile.strongAction)
          )
        );
      }

      if (item.sourceType === "summary_line") {
        return (
          item.profile.weakScore >= 4 &&
          (GENERIC_SUMMARY_RE.test(item.sentence) || item.profile.startsWeak || item.profile.genericTask || !item.profile.hasSpecific)
        );
      }

      return (
        item.profile.weakScore >= 5 &&
        (item.profile.startsWeak || item.profile.genericTask || !item.profile.hasSpecific)
      );
    })
    .sort((a, b) => {
      const tierOrder = { clear: 2, moderate: 1, none: 0 };
      return (
        b.rank - a.rank ||
        tierOrder[b.profile.candidateTier] - tierOrder[a.profile.candidateTier] ||
        b.profile.improvementPotential - a.profile.improvementPotential ||
        b.profile.weakScore - a.profile.weakScore ||
        a.profile.strongScore - b.profile.strongScore
      );
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
  const patterns = [
    /^helped with\s+/i,
    /^helped to\s+/i,
    /^helped\s+/i,
    /^assisted with\s+/i,
    /^assisted\s+/i,
    /^supported with\s+/i,
    /^supported\s+/i,
    /^supports\s+/i,
    /^worked on\s+/i,
    /^responsible for\s+/i,
    /^contributed to\s+/i,
    /^participated in\s+/i,
    /^involved in\s+/i,
    /^provided support for\s+/i,
    /^provided support to\s+/i,
    /^provided support\s+/i,
    /^handled\s+/i,
    /^tasked with\s+/i,
    /^duties included\s+/i,
    /^yardımcı oldum\s+/i,
    /^destek oldum\s+/i,
    /^destek verdim\s+/i,
    /^görev aldım\s+/i,
    /^katkı sağladım\s+/i,
    /^katıldım\s+/i,
    /^çalıştım\s+/i,
    /^yaptım\s+/i,
    /^sorumluydum\s+/i,
  ];

  let out = s;
  for (const re of patterns) {
    if (re.test(out)) {
      out = out.replace(re, "").trim();
      break;
    }
  }
  return out;
}

function getTokenDeltaMetrics(source = "", rewrite = "") {
  const sourceSet = new Set(tokenizeForSimilarity(source));
  const rewriteSet = new Set(tokenizeForSimilarity(rewrite));
  const added = [...rewriteSet].filter((token) => !sourceSet.has(token));
  const removed = [...sourceSet].filter((token) => !rewriteSet.has(token));

  return {
    added,
    removed,
    addedCount: added.length,
    removedCount: removed.length,
    totalDelta: added.length + removed.length,
  };
}

function hasUnsupportedSpecificityInWeakRewrite(source = "", rewrite = "", cv = "", jd = "") {
  const sourceHasNumber = /\b\d+(?:[.,]\d+)?%?\b/.test(source);
  const rewriteHasNumber = /\b\d+(?:[.,]\d+)?%?\b/.test(rewrite);
  if (rewriteHasNumber && !sourceHasNumber) return true;

  const allowed = new Set(
    uniqueTrimmedStrings([
      ...extractExplicitFactTerms(source),
      ...extractExplicitFactTerms(cv),
      ...extractExplicitFactTerms(jd),
      ...extractAcronymLikeTerms(source),
      ...extractAcronymLikeTerms(cv),
      ...extractAcronymLikeTerms(jd),
    ]).map(canonicalizeTerm)
  );

  const rewriteTerms = uniqueTrimmedStrings([
    ...extractExplicitFactTerms(rewrite),
    ...extractAcronymLikeTerms(rewrite),
  ]);

  return rewriteTerms.some((term) => !allowed.has(canonicalizeTerm(term)));
}

function losesImportantRoleDetail(source = "", rewrite = "", roleInput, cv = "", jd = "") {
  const sourceExplicit = new Set(uniqueTrimmedStrings([
    ...extractExplicitFactTerms(source),
    ...extractAcronymLikeTerms(source),
  ]).map(canonicalizeTerm));
  const rewriteExplicit = new Set(uniqueTrimmedStrings([
    ...extractExplicitFactTerms(rewrite),
    ...extractAcronymLikeTerms(rewrite),
  ]).map(canonicalizeTerm));

  for (const term of sourceExplicit) {
    if (!rewriteExplicit.has(term)) return true;
  }

  const packs = getRolePacks(roleInput, cv, jd);
  const roleTerms = uniqueTrimmedStrings(packs.flatMap((role) => [...(role.signals || []), ...(role.keywords || [])]));
  const sourceRoleTerms = roleTerms.filter((term) => containsCanonicalTermInText(source, term)).map(canonicalizeTerm);
  const rewriteRoleTerms = roleTerms.filter((term) => containsCanonicalTermInText(rewrite, term)).map(canonicalizeTerm);

  if (sourceRoleTerms.length >= 2 && rewriteRoleTerms.length + 1 < sourceRoleTerms.length) {
    return true;
  }

  return false;
}

function countMeaningfulRewriteImprovements(source = "", rewrite = "", roleInput, cv = "", jd = "") {
  const sourceProfile = getSentenceSignalProfile(source, roleInput, cv, jd);
  const rewriteProfile = getSentenceSignalProfile(rewrite, roleInput, cv, jd);
  const delta = getTokenDeltaMetrics(source, rewrite);

  let improvements = 0;

  if (
    !rewriteProfile.startsWeak &&
    !WEAK_REWRITE_RESIDUAL_RE.test(rewrite) &&
    (sourceProfile.startsWeak || sourceProfile.hasWeakPhrase)
  ) {
    improvements += 1;
  }

  if (
    rewriteProfile.strongScore >= sourceProfile.strongScore + 2 ||
    (rewriteProfile.strongAction && !sourceProfile.strongAction)
  ) {
    improvements += 1;
  }

  if (
    (rewriteProfile.hasScopeSignal && !sourceProfile.hasScopeSignal) ||
    rewriteProfile.roleHits > sourceProfile.roleHits ||
    rewriteProfile.explicitFactsCount > sourceProfile.explicitFactsCount
  ) {
    improvements += 1;
  }

  if (
    rewriteProfile.weakScore <= sourceProfile.weakScore - 2 &&
    rewriteProfile.wordCount >= 5 &&
    rewriteProfile.wordCount <= 22
  ) {
    improvements += 1;
  }

  if (
    delta.totalDelta >= 3 &&
    jaccardSimilarity(stripLeadingWeakPhrase(source), stripLeadingWeakPhrase(rewrite)) <= 0.88
  ) {
    improvements += 1;
  }

  return improvements;
}

function rewriteStillFeelsWeak(rewrite = "", roleInput, cv = "", jd = "") {
  const profile = getSentenceSignalProfile(rewrite, roleInput, cv, jd);

  if (WEAK_REWRITE_START_RE.test(rewrite)) return true;
  if (WEAK_REWRITE_RESIDUAL_RE.test(rewrite)) return true;
  if (profile.startsWeak || profile.hasWeakPhrase) return true;
  if (profile.isWeakCandidate && profile.weakScore >= 4) return true;
  if (profile.genericTask && !profile.hasSpecific && !profile.hasScopeSignal) return true;
  if (profile.softActionStart && !profile.hasConcreteRoleDetail && !profile.hasScopeSignal) return true;
  if (ENGLISH_FLUFF_RE.test(rewrite)) return true;

  return false;
}

function pickRoleAwareRewriteVerb(sentence = "", roleInput, cv = "", jd = "") {
  const packs = getRolePacks(roleInput, cv, jd);
  if (/(email|live chat|inquir|customer emails?|chat channels?)/i.test(sentence)) return "Responded to";
  if (/(ticket|case|issue|escalat|follow-?up|status)/i.test(sentence)) return "Coordinated";
  if (/(records?|documentation|logs?|notes?)/i.test(sentence)) return "Maintained";
  if (/(reports?|summary|summaries|dashboard)/i.test(sentence)) return "Prepared";
  if (/(schedule|calendar|meeting|travel|communication)/i.test(sentence)) return "Coordinated";
  if (/(invoice|order|request|processing|account updates?)/i.test(sentence)) return "Processed";
  if (/(analysis|reconciliation|audit|review|validation)/i.test(sentence)) return "Reviewed";
  if (/(testing|qa|defect|bug|test cases?)/i.test(sentence)) return "Executed";
  if (/(backend|api|integration|feature|code|application|system)/i.test(sentence)) return "Implemented";

  const verbs = uniqueTrimmedStrings(
    packs.flatMap((role) => [...(role.safeSupportVerbs || []), ...(role.verbs || [])])
  ).filter((verb) => !/^(supported|assisted|helped|contributed|participated|aided)$/i.test(verb));

  return capitalizeFirst(verbs[0] || "Coordinated");
}

function buildLocalWeakRewrite(sentence = "", roleInput, outLang = "English", cv = "", jd = "") {
  if (outLang !== "English") return "";

  const source = String(sentence || "").trim();
  if (!source) return "";

  const sourceProfile = getSentenceSignalProfile(source, roleInput, cv, jd);
  if (!(sourceProfile.isWeakCandidate || sourceProfile.weakScore >= 4 || sourceProfile.moderatelyWeak)) return "";

  const { body, ending } = splitSentenceEnding(source);

  const specials = [
    {
      re: /^supported daily communication with customers regarding (.+)$/i,
      fn: (m) => `Coordinated daily customer communication regarding ${m[1]} and followed up on related requests`,
    },
    {
      re: /^supported routine communication between (.+)$/i,
      fn: (m) => `Coordinated routine communication between ${m[1]}`,
    },
    {
      re: /^supported daily customer service tasks with the team$/i,
      fn: () => "Coordinated daily customer service tasks and followed up on open customer requests",
    },
    {
      re: /^assisted with customer requests and internal service updates$/i,
      fn: () => "Coordinated customer requests and internal service updates across ongoing service workflows",
    },
    {
      re: /^prepared weekly support summaries for the team$/i,
      fn: () => "Prepared weekly support summaries for internal review and case follow-up tracking",
    },
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
  if (GENERIC_TASK_RE.test(stripped) && sourceProfile.roleHits <= 1 && sourceProfile.explicitFactsCount === 0 && !SCOPE_CONTEXT_RE.test(stripped)) return "";

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
    if (!SCOPE_CONTEXT_RE.test(stripped) && sourceProfile.roleHits <= 1 && sourceProfile.explicitFactsCount === 0 && countWords(stripped) <= 3) {
      return "";
    }
    rewrite = `${lead} ${lowerFirst(stripped)}`.replace(/\s+/g, " ").trim();
  }

  rewrite = rewrite
    .replace(/\bprepare prepared\b/i, "Prepared")
    .replace(/\bmaintain maintained\b/i, "Maintained")
    .replace(/\bcoordinate coordinated\b/i, "Coordinated")
    .replace(/\btrack tracked\b/i, "Tracked")
    .replace(/\bupdate updated\b/i, "Updated")
    .replace(/\bprocess processed\b/i, "Processed")
    .replace(/\breview reviewed\b/i, "Reviewed")
    .replace(/\bmonitor monitored\b/i, "Monitored")
    .replace(/\bdocument documented\b/i, "Documented")
    .replace(/\borganize organized\b/i, "Organized")
    .replace(/\bschedule scheduled\b/i, "Scheduled")
    .replace(/\s+/g, " ")
    .trim();

  if (!rewrite) return "";

  const filtered = filterWeakSentences([{ sentence: source, rewrite: `${rewrite}${ending}` }], {
    outLang,
    roleInput,
    cv,
    jd,
  });

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
  const sourceTokens = tokenizeForSimilarity(s);
  const rewriteTokens = tokenizeForSimilarity(r);

  if (sim >= 0.9) return true;
  if (WEAK_REWRITE_RESIDUAL_RE.test(r) && WEAK_VERB_RE.test(s)) return true;
  if (delta.totalDelta <= 1) return true;
  if (delta.totalDelta <= 2 && !rewriteHasScope && rewriteSpecificity <= sourceSpecificity) return true;

  if (
    sourceTokens.length === rewriteTokens.length &&
    sourceTokens.length >= 3 &&
    sourceTokens.slice(1).join(" ") === rewriteTokens.slice(1).join(" ") &&
    rewriteSpecificity <= sourceSpecificity &&
    !rewriteHasScope
  ) {
    return true;
  }

  if (
    sourceCore &&
    rewriteCore &&
    canonicalizeTerm(sourceCore) === canonicalizeTerm(rewriteCore) &&
    rewriteSpecificity <= sourceSpecificity &&
    !rewriteHasScope
  ) {
    return true;
  }

  if (
    sourceCore &&
    rewriteCore &&
    jaccardSimilarity(sourceCore, rewriteCore) >= 0.9 &&
    delta.totalDelta <= 4 &&
    rewriteSpecificity <= sourceSpecificity &&
    !rewriteHasScope
  ) {
    return true;
  }

  if (
    SOFT_ACTION_START_RE.test(r) &&
    WEAK_START_RE.test(s) &&
    delta.totalDelta <= 3 &&
    !rewriteHasScope &&
    rewriteSpecificity <= sourceSpecificity
  ) {
    return true;
  }

  return false;
}

function hasUnsupportedImpactClaims(originalText = "", candidateText = "") {
  const orig = String(originalText || "");
  const next = String(candidateText || "");
  return ENGLISH_RISKY_OUTCOME_RE.test(next) && !ENGLISH_RISKY_OUTCOME_RE.test(orig);
}

function filterWeakSentences(items = [], { outLang = "English", roleInput, cv = "", jd = "" } = {}) {
  return (Array.isArray(items) ? items : [])
    .map((item) => ({
      sentence: String(item?.sentence || item?.source || "").trim(),
      rewrite: String(item?.rewrite || item?.after || "").trim(),
    }))
    .filter((item) => item.sentence && item.rewrite)
    .filter((item) => canonicalizeTerm(item.sentence) !== canonicalizeTerm(item.rewrite))
    .map((item) => {
      const sourceProfile = getSentenceSignalProfile(item.sentence, roleInput, cv, jd);
      const rewriteProfile = getSentenceSignalProfile(item.rewrite, roleInput, cv, jd);
      const improvements = countMeaningfulRewriteImprovements(item.sentence, item.rewrite, roleInput, cv, jd);
      return { ...item, sourceProfile, rewriteProfile, improvements };
    })
    .filter((item) => {
      if (item.sourceProfile.isReasonablyStrong) return false;
      if (item.sourceProfile.hasProtectedSpecificity && item.sourceProfile.strongScore >= 6 && !item.sourceProfile.genericTask) return false;
      return (
        item.sourceProfile.clearWeak ||
        item.sourceProfile.moderatelyWeak ||
        (
          item.sourceProfile.weakScore >= 4 &&
          (item.sourceProfile.startsWeak || item.sourceProfile.hasWeakPhrase || item.sourceProfile.genericTask || !item.sourceProfile.hasSpecific)
        )
      );
    })
    .filter((item) => !isShallowRewrite(item.sentence, item.rewrite))
    .filter((item) => item.improvements >= 2)
    .filter((item) => item.rewriteProfile.weakScore <= item.sourceProfile.weakScore - 1 || item.rewriteProfile.strongScore >= item.sourceProfile.strongScore + 2)
    .filter((item) => !rewriteStillFeelsWeak(item.rewrite, roleInput, cv, jd))
    .filter((item) => !hasUnsupportedSpecificityInWeakRewrite(item.sentence, item.rewrite, cv, jd))
    .filter((item) => !losesImportantRoleDetail(item.sentence, item.rewrite, roleInput, cv, jd))
    .filter((item) => {
      if (outLang !== "English") return true;
      if (ENGLISH_FLUFF_RE.test(item.rewrite) && !ENGLISH_FLUFF_RE.test(item.sentence)) return false;
      if (hasUnsupportedImpactClaims(item.sentence, item.rewrite)) return false;
      return true;
    })
    .sort((a, b) => {
      const tierOrder = { clear: 2, moderate: 1, none: 0 };
      return (
        tierOrder[b.sourceProfile.candidateTier] - tierOrder[a.sourceProfile.candidateTier] ||
        b.improvements - a.improvements ||
        b.sourceProfile.weakScore - a.sourceProfile.weakScore ||
        b.sourceProfile.improvementPotential - a.sourceProfile.improvementPotential ||
        a.rewriteProfile.weakScore - b.rewriteProfile.weakScore
      );
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
    if (!source || !rewrite) continue;

    const sourceProfile = getSentenceSignalProfile(source, roleInput, cv, jd);
    const rewriteProfile = getSentenceSignalProfile(rewrite, roleInput, cv, jd);
    const improvements = countMeaningfulRewriteImprovements(source, rewrite, roleInput, cv, jd);

    if (sourceProfile.isReasonablyStrong) continue;
    if (sourceProfile.hasProtectedSpecificity && sourceProfile.strongScore >= 6 && !sourceProfile.genericTask) continue;
    if (!(sourceProfile.clearWeak || sourceProfile.moderatelyWeak || (sourceProfile.weakScore >= 4 && (sourceProfile.startsWeak || sourceProfile.hasWeakPhrase || sourceProfile.genericTask || !sourceProfile.hasSpecific)))) continue;
    if (isShallowRewrite(source, rewrite)) continue;
    if (improvements < 2) continue;
    if (!(rewriteProfile.weakScore <= sourceProfile.weakScore - 1 || rewriteProfile.strongScore >= sourceProfile.strongScore + 2)) continue;
    if (rewriteStillFeelsWeak(rewrite, roleInput, cv, jd)) continue;
    if (hasUnsupportedSpecificityInWeakRewrite(source, rewrite, cv, jd)) continue;
    if (losesImportantRoleDetail(source, rewrite, roleInput, cv, jd)) continue;
    if (outLang === "English" && (hasUnsupportedImpactClaims(source, rewrite) || (ENGLISH_FLUFF_RE.test(rewrite) && !ENGLISH_FLUFF_RE.test(source)))) continue;

    const key = `${canonicalizeTerm(source)}__${canonicalizeTerm(rewrite)}`;
    if (seen.has(key)) continue;
    seen.add(key);

    out.push({ source, rewrite, reason, sourceProfile, rewriteProfile, improvements });
  }

  return out
    .sort((a, b) => {
      const tierOrder = { clear: 2, moderate: 1, none: 0 };
      return (
        tierOrder[b.sourceProfile.candidateTier] - tierOrder[a.sourceProfile.candidateTier] ||
        b.improvements - a.improvements ||
        b.sourceProfile.weakScore - a.sourceProfile.weakScore ||
        b.sourceProfile.improvementPotential - a.sourceProfile.improvementPotential ||
        a.rewriteProfile.weakScore - b.rewriteProfile.weakScore
      );
    })
    .slice(0, 8)
    .map(({ source, rewrite, reason }) => ({ source, rewrite, reason }));
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
  if (!base) return "";
  if (!Array.isArray(bulletUpgrades) || !bulletUpgrades.length) return base;
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
    let value = 4;
    value += profile.strongScore * 1.5;
    value -= profile.weakScore * 1.3;
    if (profile.hasSpecific) value += 1;
    sum += Math.max(0, Math.min(12, value));
  }
  const avg = sum / bullets.length;
  return Math.max(0, Math.min(40, Math.round((avg / 12) * 40)));
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
    total = Math.round((sectionScore / 25) * 20) + Math.round((bulletScore / 40) * 35) + Math.round((readabilityScore / 20) * 20) + Math.round((keywordScore / 15) * 15) + jdScore;
  } else {
    total = Math.round((sectionScore / 25) * 25) + Math.round((bulletScore / 40) * 40) + Math.round((readabilityScore / 20) * 20) + Math.round((keywordScore / 15) * 15);
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
    return clampScore(roleAlignment * 0.28 + bulletStrength * 0.28 + jdKeywordMatch * 0.18 + sectionCompleteness * 0.16 + atsSafeFormatting * 0.10);
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

  let lift = 0;
  lift += rawLift * 0.48;
  lift += Math.min(5, weakGain) * 1.0;
  if (rewriteRatio >= 0.7) lift += 3;
  else if (rewriteRatio >= 0.5) lift += 2;
  else if (rewriteRatio >= 0.3) lift += 1;

  const meaningfulChange = rawLift > 0 || weakGain > 0 || rewriteRatio >= 0.2;
  if (!meaningfulChange) return base;

  lift = Math.round(lift);
  const cap = base < 40 ? 19 : base < 55 ? 16 : base < 70 ? 14 : base < 80 ? 10 : 6;
  lift = Math.max(3, Math.min(cap, lift));
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
  const profile = ensureRoleProfile(roleInput, originalCv, jd);
  const hasJD = !!String(jd || "").trim();
  if (!optimizedCv || !String(optimizedCv).trim()) return true;
  const origNorm = canonicalizeTerm(originalCv);
  const optNorm = canonicalizeTerm(optimizedCv);
  if (!optNorm || origNorm === optNorm) return true;
  const { same, total } = countUnchangedBullets(originalCv, optimizedCv);
  if (total > 0 && same / total >= (hasJD ? 0.42 : 0.34)) return true;
  if (total > 0 && getBulletLines(optimizedCv).length < Math.max(2, Math.floor(total * 0.7))) return true;
  const weakBefore = detectWeakSentenceCandidates(originalCv, profile, 0, 20).length;
  const weakAfter = detectWeakSentenceCandidates(optimizedCv, profile, 0, 20).length;
  if (weakBefore > 0 && weakAfter >= weakBefore) return true;
  if (countPersistingWeakSources(optimizedCv, weakSentences) >= (hasJD ? 2 : 1)) return true;
  if (outLang === "English" && countCorporateFluffHits(optimizedCv) >= 2) return true;
  if (outLang === "English" && getOverlongBulletRatio(optimizedCv) > 0.35) return true;
  if (countWeakEnglishRewriteStarts(optimizedCv) >= 2) return true;
  if (findUnsupportedTerms(originalCv, jd, optimizedCv).length > 0) return true;
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
    const payloadJson = Buffer.from(data, "base64url").toString("utf8");
    const payload = JSON.parse(payloadJson);
    return !!payload?.exp && Date.now() <= payload.exp;
  } catch {
    return false;
  }
}

function isGpt5Model(model = "") {
  return /^gpt-5/i.test(String(model || "").trim());
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
    if (reasoningEffort === "none" && typeof temperature === "number") body.temperature = temperature;
  } else {
    body.max_tokens = maxCompletionTokens;
    if (typeof temperature === "number") body.temperature = temperature;
  }
  return body;
}

function buildAttempts({ model, passType = "main", isPreview = false, maxCompletionTokens = 1800 }) {
  if (!isGpt5Model(model)) {
    return [{ reasoningEffort: null, temperature: isPreview ? 0.2 : 0.25, maxCompletionTokens }];
  }
  if (passType === "optimize") {
    return [
      { reasoningEffort: "medium", temperature: null, maxCompletionTokens: Math.max(maxCompletionTokens, 3600) },
      { reasoningEffort: "low", temperature: null, maxCompletionTokens: Math.max(maxCompletionTokens, 4400) },
    ];
  }
  if (passType === "repair") {
    return [
      { reasoningEffort: "low", temperature: null, maxCompletionTokens: Math.max(maxCompletionTokens, 3600) },
      { reasoningEffort: "none", temperature: 0.2, maxCompletionTokens: Math.max(maxCompletionTokens, 4200) },
    ];
  }
  if (passType === "bullet") {
    return [
      { reasoningEffort: "low", temperature: null, maxCompletionTokens: Math.max(maxCompletionTokens, 1600) },
      { reasoningEffort: "none", temperature: 0.2, maxCompletionTokens: Math.max(maxCompletionTokens, 2200) },
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
    { reasoningEffort: "none", temperature: 0.2, maxCompletionTokens: Math.max(maxCompletionTokens, 2400) },
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
  if (Array.isArray(content)) {
    return content.map((part) => {
      if (typeof part === "string") return part;
      if (typeof part?.text === "string") return part.text;
      if (typeof part?.content === "string") return part.content;
      return "";
    }).join("").trim();
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
    "- Keep optimized_cv ATS-safe, clean, and parser-friendly.",
    "- Return only valid JSON. No markdown. No extra text.",
    `- All output values must be written only in ${outLang}. Do not mix languages.`,
  ].join("\n");
}

function buildEnglishStyleBlock(roleInput, cv = "", jd = "") {
  return [
    "ENGLISH WRITING STYLE:",
    "- Write like a strong US resume writer, not marketing copy.",
    "- Prefer concise recruiter-friendly bullets, usually around 9-18 words when possible.",
    "- Prefer: action + scope + tool/channel/context + neutral purpose.",
    "- Do not add corporate fluff, vague value statements, or unsupported outcome clauses.",
    "- Avoid shallow verb swaps such as helped -> assisted or supported -> contributed.",
    "- Keep already-strong bullets sharp and short.",
    buildRoleWritingBlock(roleInput, cv, jd),
  ].join("\n");
}

function buildAnalysisPrompt({ cv, jd, hasJD, outLang, roleProfile, isPreview }) {
  const roleContextText = buildRoleContextText(roleProfile, cv, jd);
  const englishStyleBlock = outLang === "English" ? buildEnglishStyleBlock(roleProfile, cv, jd) : "";
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
    ? [
        "- Return up to 2 weak_sentences.",
        "- Do not force the count.",
      ].join("\n")
    : hasJD
    ? [
        "- Return 7-12 weak_sentences when genuinely weak examples exist.",
        "- Prefer weak experience bullets first, then other genuinely weak lines.",
      ].join("\n")
    : [
        "- Return 8-12 weak_sentences when genuinely weak examples exist.",
        "- If the resume clearly contains many weak or moderately weak bullets, return at least 6 items.",
      ].join("\n");

  const missingRules = hasJD
    ? isPreview
      ? "- missing_keywords must contain 5-7 genuinely missing or underrepresented JD-relevant items."
      : "- missing_keywords must contain 12-20 genuinely missing or underrepresented JD-relevant items."
    : isPreview
    ? "- missing_keywords must contain 5-7 role-aware ATS-relevant suggestions based on the resume alone."
    : "- missing_keywords must contain 10-18 role-aware ATS-relevant suggestions based on the resume alone.";

  const summaryRule = isPreview
    ? "- summary must be 4-6 compact bullet-style lines."
    : "- summary must be 8-12 detailed bullet-style lines.";

  return [
    `Return JSON in this exact schema:\n\n${baseSchema}`,
    hasJD ? "\nTASK: Perform a job-specific ATS review." : "\nTASK: Perform a general ATS review with no job description.",
    "\nSTRICT REQUIREMENTS:",
    hasJD
      ? "- Score the resume against the job description without inventing alignment."
      : "- Infer likely role family, seniority, and recruiter-facing terminology from the resume itself.",
    missingRules,
    "- Prioritize tools, platforms, methods, certifications, domain phrases, responsibility patterns, and seniority signals over filler.",
    weakRules,
    "- Only select lines that are genuinely vague, generic, duty-only, shallow, or support-heavy.",
    "- Do not flag already-strong technical or functional bullets that already contain concrete tools, platforms, process detail, or domain terminology unless the rewrite is clearly and materially stronger.",
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
  const englishStyleBlock = outLang === "English" ? buildEnglishStyleBlock(roleProfile, cv, jd) : "";
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
    `- Output values only in ${outLang}.`,
    hasJD ? "- Return 6-12 items when possible." : "- Return 6-12 items when possible.",
    `\nROLE CONTEXT:\n${roleContextText}`,
    englishStyleBlock ? `\n${englishStyleBlock}` : "",
    `\nWEAK CANDIDATES:\n${candidateText || "(none)"}`,
    `\nRESUME:\n${cv}`,
    hasJD ? `\nJOB DESCRIPTION:\n${jd}` : "",
  ].filter(Boolean).join("\n");
}

function buildTargetedBulletUpgradePrompt({ cv, jd, hasJD, weakSentences, outLang, roleProfile }) {
  const roleContextText = buildRoleContextText(roleProfile, cv, jd);
  const englishStyleBlock = outLang === "English" ? buildEnglishStyleBlock(roleProfile, cv, jd) : "";
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
  const englishStyleBlock = outLang === "English" ? buildEnglishStyleBlock(roleProfile, cv, jd) : "";
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
  const englishStyleBlock = outLang === "English" ? buildEnglishStyleBlock(roleProfile, cv, jd) : "";
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

export default async function handler(req, res) {
  try {
    if (req.method !== "POST") {
      return res.status(405).json({ error: "POST required" });
    }

    const body = req.body && typeof req.body === "object" ? req.body : {};
    const cv = sanitizeStringInput(body.cv || "", 50000);
    const jd = sanitizeStringInput(body.jd || "", 30000);
    const previewRequested = !!body.preview;
    const langCode = typeof body.lang === "string" && body.lang.trim() ? body.lang.trim().toLowerCase() : "en";
    const outLang = LANG_MAP[langCode] || "English";

    if (!cv) {
      return res.status(400).json({ error: "cv is required" });
    }

    const apiKey = process.env.OPENAI_API_KEY;
    if (!apiKey) {
      return res.status(500).json({ error: "OPENAI_API_KEY is missing on Vercel" });
    }

    const model = process.env.OPENAI_MODEL || "gpt-4.1-mini";
    const hasJD = !!jd;
    const sessionOk = verifySession(req);
    const isPreview = previewRequested || !sessionOk;

    const ip = getClientIp(req);
    const limiter = isPreview ? rlPreview : rlFull;
    const { success, reset } = await limiter.limit(ip);
    if (!success) {
      const retrySec = Math.max(1, Math.ceil((reset - Date.now()) / 1000));
      return res.status(429).json({ error: "Too many requests", retry_after_seconds: retrySec });
    }

    const roleProfile = inferRoleProfile(cv, jd);
    const systemPrompt = buildAtsSystem(outLang);

    let analysisData;
    try {
      analysisData = await callOpenAIJson({
        apiKey,
        model,
        system: systemPrompt,
        userPrompt: buildAnalysisPrompt({ cv, jd, hasJD, outLang, roleProfile, isPreview }),
        isPreview,
        passType: "main",
        maxCompletionTokens: isPreview ? 1200 : 2200,
      });
    } catch (err) {
      return res.status(err?.status || 500).json({
        error: err?.message || "OpenAI error",
        status: err?.status || 500,
        details: err?.details || String(err),
      });
    }

    const componentScores = analysisData?.component_scores && typeof analysisData.component_scores === "object" ? analysisData.component_scores : {};
    const deterministicScore = computeDeterministicAtsScore(cv, jd, roleProfile);
    const modelComponentScore = computeComponentScore(componentScores, hasJD);
    const mergedBaseScore = clampScore(Math.round(deterministicScore * 0.8 + modelComponentScore * 0.2));

    let weakSentences = filterWeakSentences(
      Array.isArray(analysisData?.weak_sentences) ? analysisData.weak_sentences : [],
      { outLang, roleInput: roleProfile, cv, jd }
    );

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
        weakSentences = mergeWeakSentenceSets(
          weakSentences,
          Array.isArray(fallbackWeakData?.weak_sentences) ? fallbackWeakData.weak_sentences : [],
          roleProfile,
          outLang,
          cv,
          jd,
          isPreview ? 4 : 12
        );
      } catch {
        // keep existing weakSentences
      }
    }

    if (weakSentences.length < Math.min(isPreview ? 2 : desiredWeakCount, detectedWeakCandidates.length)) {
      const localWeak = buildLocalWeakSentenceSet(detectedWeakCandidates, roleProfile, outLang, cv, jd, isPreview ? 4 : 12);
      weakSentences = mergeWeakSentenceSets(weakSentences, localWeak, roleProfile, outLang, cv, jd, isPreview ? 4 : 12);
    }

    const normalized = {
      ats_score: mergedBaseScore,
      component_scores: componentScores,
      missing_keywords: finalizeMissingKeywords(
        ensureArrayStrings(analysisData?.missing_keywords, hasJD ? 20 : 18),
        { cv, jd, roleInput: roleProfile, outLang, hasJD, limit: isPreview ? 7 : hasJD ? 20 : 18 }
      ),
      weak_sentences: weakSentences,
      summary: typeof analysisData?.summary === "string" ? normalizeSpace(analysisData.summary) : "",
      optimized_cv: "",
      optimized_ats_score: mergedBaseScore,
    };

    if (isPreview) {
      return res.status(200).json(buildPreviewResponse({ normalized, hasJD }));
    }

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
          maxCompletionTokens: 1700,
        });
        bulletUpgrades = normalizeBulletUpgrades(Array.isArray(bulletData?.bullet_upgrades) ? bulletData.bullet_upgrades : [], outLang, roleProfile, cv, jd);
      } catch {
        bulletUpgrades = [];
      }
    }

    if (!bulletUpgrades.length && normalized.weak_sentences.length > 0) {
      bulletUpgrades = normalizeBulletUpgrades(buildLocalBulletUpgradeFallback(normalized.weak_sentences), outLang, roleProfile, cv, jd);
    }

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
        maxCompletionTokens: 3600,
      });

      if (typeof optimizeData?.optimized_cv === "string" && optimizeData.optimized_cv.trim()) {
        currentOptimized = forceSafeResume(cv, optimizeData.optimized_cv.trim(), outLang);
        if (bulletUpgrades.length) {
          currentOptimized = applyBulletUpgradesToCv(cv, currentOptimized, bulletUpgrades, outLang);
        }
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
          maxCompletionTokens: 3800,
        });

        if (typeof repaired?.optimized_cv === "string" && repaired.optimized_cv.trim()) {
          currentOptimized = forceSafeResume(cv, repaired.optimized_cv.trim(), outLang);
          if (bulletUpgrades.length) {
            currentOptimized = applyBulletUpgradesToCv(cv, currentOptimized, bulletUpgrades, outLang);
          }
          unsupportedTerms = findUnsupportedTerms(cv, jd, currentOptimized);
        }
      } catch {
        // keep currentOptimized
      }
    }

    if (unsupportedTerms.length > 0) {
      try {
        const cleaned = await callOpenAIJson({
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
          maxCompletionTokens: 3800,
        });

        if (typeof cleaned?.optimized_cv === "string" && cleaned.optimized_cv.trim()) {
          currentOptimized = forceSafeResume(cv, cleaned.optimized_cv.trim(), outLang);
          if (bulletUpgrades.length) {
            currentOptimized = applyBulletUpgradesToCv(cv, currentOptimized, bulletUpgrades, outLang);
          }
        }
      } catch {
        // keep currentOptimized
      }
    }

    normalized.optimized_cv = currentOptimized;
    normalized.optimized_ats_score = computeFinalOptimizedScore(cv, currentOptimized, normalized.ats_score, jd);

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
