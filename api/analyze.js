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

const DEFAULT_MODEL = "gpt-5-mini";

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
    projects: "PROJECTS",
    certifications: "CERTIFICATIONS",
    languages: "LANGUAGES",
    additional: "ADDITIONAL INFORMATION",
  },
  Turkish: {
    summary: "PROFESYONEL ÖZET",
    experience: "DENEYİM",
    skills: "YETKİNLİKLER",
    education: "EĞİTİM",
    projects: "PROJELER",
    certifications: "SERTİFİKALAR",
    languages: "DİLLER",
    additional: "EK BİLGİLER",
  },
};

const SECTION_HEADING_PATTERNS = {
  summary: /^(professional summary|summary|profile|about|career summary|executive summary|personal profile|objective|career objective|özet|profesyonel özet|profil|kariyer özeti|amaç)$/i,
  experience: /^(experience|work experience|professional experience|employment history|career history|relevant experience|deneyim|iş deneyimi|profesyonel deneyim)$/i,
  skills: /^(skills|core skills|technical skills|key skills|competencies|competences|tool stack|stack|yetkinlikler|yetenekler|beceriler|teknik beceriler)$/i,
  education: /^(education|academic background|qualifications|eğitim|öğrenim)$/i,
  projects: /^(projects|selected projects|project experience|projeler)$/i,
  certifications: /^(certifications|licenses|licences|courses|training|sertifikalar|sertifika|lisanslar|eğitimler)$/i,
  languages: /^(languages|language skills|diller|yabancı diller)$/i,
  additional: /^(additional information|additional|other information|interests|awards|achievements|references|ek bilgiler|ek bilgi|ilave bilgiler)$/i,
};

const ALL_SECTION_HEADER_RE = new RegExp(
  Object.values(SECTION_HEADING_PATTERNS)
    .map((re) => re.source.replace(/^\^|\$$/g, ""))
    .join("|"),
  "i"
);

const BULLET_RE = /^[-•·‣▪▫◦*]\s+/;
const DATE_RE = /\b(?:19|20)\d{2}\b/;
const PRESENT_RE = /\b(?:present|current|ongoing|günümüz|devam)\b/i;
const ACRONYM_RE = /\b[A-Z]{2,}(?:\/[A-Z]{2,})?\b/;
const EMAIL_RE = /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i;

const WEAK_OPENING_RE = /^(helped|helping|assisted|assisting|supported|supporting|responsible for|worked on|contributed to|participated in|involved in|provided support|handled|tasked with|duties included|yardımcı oldum|destek verdim|destek oldum|görev aldım|çalıştım|yaptım|sorumluydum|katıldım)\b/i;
const WEAK_ANYWHERE_RE = /\b(helped|assisted|supported|responsible for|worked on|contributed to|participated in|involved in|provided support|yardımcı oldum|destek verdim|destek oldum|görev aldım|çalıştım|sorumluydum|katıldım)\b/i;
const STRONG_ACTION_RE = /\b(built|developed|implemented|integrated|designed|engineered|optimized|automated|deployed|debugged|tested|validated|analyzed|reviewed|prepared|reconciled|processed|tracked|scheduled|coordinated|organized|maintained|documented|managed|planned|executed|resolved|responded|created|produced|delivered|taught|assessed|inspected|mapped|configured|migrated|supported implementation of|yönettim|geliştirdim|uyguladım|entegrasyonunu yaptım|optimize ettim|analiz ettim|hazırladım|uzlaştırdım|işledim|takip ettim|koordine ettim|planladım|organize ettim|dokümante ettim|sürdürdüm|yanıtladım|çözdüm|öğrettim|değerlendirdim|denetledim)\b/i;
const SOFT_TASK_RE = /\b(daily tasks?|routine tasks?|general support|various tasks?|administrative tasks?|office tasks?|support activities|basic reporting|record keeping|data entry|team support|general coordination|daily operations|customer requests?|internal updates?|service tasks?|follow[- ]?up tasks?)\b/i;
const SCOPE_RE = /\b(using|with|for|across|through|via|by|within|on|under|across|throughout|according to|per|including|covering|handling|tracking|supporting|kullanarak|ile|için|kapsamında|üzerinden|aracılığıyla|konusunda)\b/i;
const GENERIC_SUMMARY_RE = /^(experienced|results[- ]driven|motivated|detail[- ]oriented|dynamic|hardworking|responsible|organized|dedicated|proven|deneyimli|sonuç odaklı|motivasyonu yüksek|detay odaklı|çalışkan|sorumluluk sahibi)\b/i;
const LOW_VALUE_TERM_RE = /\b(communication|teamwork|hardworking|motivated|detail oriented|problem solving|leadership|computer skills|microsoft office|ms office|organizasyon|iletişim|takım çalışması|motivasyon|çözüm odaklı|detay odaklı|uyumlu|çalışkan|analysis|support|management|beceri|yetenek|deneyim)\b/i;
const JD_CUE_RE = /\b(requirements?|required|must have|nice to have|preferred|responsibilities|qualifications?|experience with|knowledge of|proficient in|seeking|looking for|ideal candidate|aranan nitelikler|gerekli|tercihen|yetkinlikler|sorumluluklar|beklentiler)\b/i;
const FLUFF_RE = /\b(impactful|robust|comprehensive|best-in-class|high-impact|value-driven|seamless|strategic initiatives|operational excellence|world-class|dynamic environment)\b/i;
const RISKY_OUTCOME_RE = /\b(resulting in|driving|boosting|increasing|maximizing|enhancing|delivering measurable|significantly improved|substantially reduced)\b/i;

const ROLE_TAXONOMY = {
  software_engineering: {
    titles: [
      "software engineer", "software developer", "backend engineer", "backend developer", "frontend engineer",
      "frontend developer", "full stack developer", "full-stack developer", "web developer", "application developer",
      "mobile developer", "ios developer", "android developer", "devops engineer", "site reliability engineer",
      "sre", "platform engineer", "systems engineer", "backend software engineer",
    ],
    signals: [
      "backend", "frontend", "full stack", "api", "rest api", "graphql", "microservices", "database", "sql", "nosql",
      "system design", "unit testing", "integration testing", "deployment", "ci/cd", "docker", "kubernetes",
      "aws", "azure", "gcp", "node.js", "react", "typescript", "javascript", "python", "java", "c#", "debugging",
      "performance optimization", "authentication", "authorization",
    ],
    keywords: [
      "REST APIs", "microservices", "system design", "unit testing", "integration testing", "database optimization",
      "CI/CD", "cloud services", "debugging", "performance tuning", "code review", "version control",
    ],
    verbs: ["built", "developed", "implemented", "integrated", "optimized", "tested", "deployed", "maintained"],
    blockers: ["seo", "campaign optimization", "accounts payable", "lesson planning", "patient scheduling", "warehouse operations"],
  },
  qa: {
    titles: ["qa engineer", "quality assurance engineer", "software tester", "test engineer", "qa analyst", "automation tester", "manual tester"],
    signals: ["test cases", "test scenarios", "regression testing", "smoke testing", "uat", "selenium", "cypress", "postman", "jira", "bug tracking", "defect management", "test automation", "api testing"],
    keywords: ["test cases", "regression testing", "defect tracking", "test documentation", "UAT", "API testing", "automation testing", "quality validation"],
    verbs: ["tested", "validated", "documented", "tracked", "verified", "executed", "automated"],
    blockers: ["sales pipeline", "budget tracking", "patient intake", "warehouse operations"],
  },
  data_analytics: {
    titles: ["data analyst", "business intelligence analyst", "bi analyst", "analytics specialist", "reporting analyst", "data specialist"],
    signals: ["analytics", "dashboard", "reporting", "kpi", "trend analysis", "data validation", "power bi", "tableau", "looker studio", "etl", "data modeling", "sql", "python", "excel"],
    keywords: ["SQL", "data visualization", "dashboard reporting", "trend analysis", "KPI tracking", "data validation", "Power BI", "Tableau", "report automation", "ETL"],
    verbs: ["analyzed", "reported", "tracked", "validated", "prepared", "modeled"],
    blockers: ["insurance verification", "lesson planning", "sales pipeline", "shipment tracking"],
  },
  product_project: {
    titles: ["product manager", "product owner", "associate product manager", "technical product manager", "project manager", "project coordinator", "program manager"],
    signals: ["roadmap", "backlog", "user stories", "requirements gathering", "acceptance criteria", "stakeholder communication", "release planning", "jira", "confluence", "agile", "scrum", "timeline", "deliverables", "milestones", "risk tracking"],
    keywords: ["product roadmap", "backlog prioritization", "requirements gathering", "user stories", "acceptance criteria", "release planning", "stakeholder communication", "timeline management", "deliverable coordination", "risk tracking"],
    verbs: ["defined", "prioritized", "coordinated", "planned", "aligned", "tracked", "facilitated", "documented"],
    blockers: ["insurance verification", "warehouse operations", "classroom management"],
  },
  finance_accounting: {
    titles: ["accountant", "financial analyst", "finance specialist", "accounts payable specialist", "accounts receivable specialist", "bookkeeper", "finance assistant"],
    signals: ["financial reporting", "reconciliation", "accounts payable", "accounts receivable", "invoice processing", "budget tracking", "expense reporting", "forecasting", "variance analysis", "audit support", "ledger", "month-end", "sap", "oracle", "erp", "ifrs", "gaap"],
    keywords: ["financial reporting", "account reconciliation", "budget tracking", "variance analysis", "forecasting", "month-end close", "AP/AR", "audit support", "ERP systems", "GAAP", "IFRS"],
    verbs: ["prepared", "reconciled", "processed", "reviewed", "tracked", "reported", "maintained"],
    blockers: ["lesson planning", "wireframing", "patient scheduling", "shipment tracking"],
  },
  marketing: {
    titles: ["digital marketing specialist", "marketing specialist", "performance marketing specialist", "marketing executive", "growth marketer", "content specialist", "social media specialist"],
    signals: ["google ads", "meta ads", "google analytics", "ga4", "google tag manager", "seo", "sem", "ppc", "campaign reporting", "content marketing", "email marketing", "social media", "lead generation", "a/b testing", "remarketing"],
    keywords: ["PPC", "SEO", "SEM", "GA4", "Google Tag Manager", "audience segmentation", "A/B testing", "lead generation", "campaign optimization", "analytics reporting"],
    verbs: ["managed", "optimized", "analyzed", "tracked", "reported", "executed", "launched", "monitored"],
    blockers: ["microservices", "month-end close", "patient scheduling", "warehouse operations"],
  },
  sales: {
    titles: ["sales specialist", "sales executive", "account executive", "sales coordinator", "business development executive", "account manager"],
    signals: ["sales", "pipeline", "crm", "lead follow-up", "proposal", "deal tracking", "sales reporting", "salesforce", "hubspot", "client communication", "order processing", "renewal"],
    keywords: ["sales pipeline", "lead management", "CRM", "proposal preparation", "deal tracking", "account coordination", "client follow-up", "Salesforce", "HubSpot"],
    verbs: ["managed", "followed up on", "coordinated", "prepared", "updated", "processed", "documented"],
    blockers: ["hipaa", "ehr", "boq", "unit testing", "warehouse operations"],
  },
  customer_support: {
    titles: ["customer support specialist", "customer service representative", "support specialist", "technical support specialist", "help desk specialist", "customer success specialist", "customer success manager"],
    signals: ["customer support", "ticket handling", "issue resolution", "live chat", "email support", "complaint handling", "service quality", "crm", "zendesk", "freshdesk", "escalation", "onboarding", "retention", "csat", "nps", "sla"],
    keywords: ["ticket management", "issue resolution", "service quality", "escalation handling", "support documentation", "customer communication", "Zendesk", "CRM", "case follow-up", "customer onboarding"],
    verbs: ["responded to", "resolved", "escalated", "documented", "maintained", "communicated with", "tracked", "guided"],
    blockers: ["sales pipeline", "proposal preparation", "deal tracking", "hipaa", "warehouse operations", "design systems"],
  },
  procurement_supply_chain: {
    titles: ["procurement specialist", "purchasing specialist", "buyer", "sourcing specialist", "logistics specialist", "logistics coordinator", "inventory specialist", "warehouse coordinator", "warehouse associate"],
    signals: ["procurement", "purchasing", "sourcing", "vendor management", "purchase orders", "rfq", "supplier communication", "cost comparison", "inventory management", "shipment tracking", "warehouse operations", "logistics coordination", "stock control", "order fulfillment", "sap", "erp"],
    keywords: ["vendor management", "sourcing", "purchase orders", "supplier communication", "RFQ", "inventory management", "shipment tracking", "warehouse operations", "ERP systems", "order fulfillment"],
    verbs: ["sourced", "processed", "coordinated", "reviewed", "tracked", "documented", "communicated"],
    blockers: ["hipaa", "ehr", "wireframing", "lesson planning", "microservices"],
  },
  administration: {
    titles: ["executive assistant", "personal assistant", "administrative assistant", "office assistant", "admin assistant", "executive coordinator", "office manager"],
    signals: ["calendar management", "travel coordination", "meeting coordination", "document preparation", "executive support", "scheduling", "record keeping", "office administration", "filing", "data entry"],
    keywords: ["calendar management", "meeting coordination", "travel coordination", "document management", "record maintenance", "executive support", "office administration", "task prioritization"],
    verbs: ["managed", "organized", "scheduled", "prepared", "maintained", "coordinated", "documented"],
    blockers: ["project roadmap", "program management", "hipaa", "ehr", "design systems", "microservices"],
  },
  hr_recruiting: {
    titles: ["hr specialist", "human resources specialist", "recruiter", "talent acquisition specialist", "hr coordinator", "people operations specialist"],
    signals: ["recruiting", "candidate screening", "interview scheduling", "employee records", "onboarding", "offboarding", "training coordination", "hr administration", "compliance", "payroll support", "workday", "greenhouse", "ats", "hris"],
    keywords: ["talent acquisition", "candidate screening", "interview coordination", "employee onboarding", "HR administration", "policy compliance", "record management", "ATS", "Workday", "Greenhouse"],
    verbs: ["screened", "scheduled", "coordinated", "maintained", "prepared", "documented", "updated"],
    blockers: ["ehr", "warehouse operations", "wireframing", "microservices"],
  },
  education: {
    titles: ["teacher", "instructor", "lecturer", "teaching assistant", "english teacher", "math teacher", "classroom teacher"],
    signals: ["lesson planning", "classroom management", "student assessment", "curriculum", "instruction", "learning materials", "student progress", "parent communication", "exam preparation"],
    keywords: ["lesson planning", "classroom management", "student assessment", "curriculum development", "learning materials", "student progress tracking", "instruction"],
    verbs: ["planned", "delivered", "prepared", "assessed", "tracked", "organized", "taught"],
    blockers: ["sales pipeline", "hipaa", "design systems", "microservices", "warehouse operations"],
  },
  healthcare_administration: {
    titles: ["healthcare administrator", "medical secretary", "medical office assistant", "patient coordinator", "clinic coordinator", "medical receptionist"],
    signals: ["patient scheduling", "medical records", "appointment coordination", "patient communication", "clinic operations", "front desk", "registration", "referral", "medical office"],
    keywords: ["patient scheduling", "medical records", "appointment coordination", "patient communication", "clinic administration", "front desk operations", "record updates"],
    verbs: ["scheduled", "coordinated", "updated", "maintained", "documented", "communicated with"],
    blockers: ["hipaa", "ehr", "emr", "insurance verification"],
    requiresEvidenceFor: ["hipaa", "ehr", "emr", "insurance verification", "eligibility verification", "patient intake"],
  },
  design: {
    titles: ["designer", "graphic designer", "visual designer", "brand designer", "art director", "ui designer", "ux designer", "product designer"],
    signals: ["figma", "adobe creative suite", "photoshop", "illustrator", "indesign", "visual design", "brand assets", "layout design", "social media creatives", "print design", "wireframes", "prototypes", "design system"],
    keywords: ["visual design", "Adobe Creative Suite", "Figma", "layout design", "brand assets", "print design", "social media creatives", "wireframing", "prototyping", "design systems"],
    verbs: ["designed", "created", "developed", "prepared", "produced", "refined", "updated"],
    blockers: ["ui design", "ux design", "design systems", "user flows", "wireframing", "prototyping", "mockups"],
    graphicOnlySignals: ["graphic designer", "visual designer", "brand designer", "photoshop", "illustrator", "indesign", "print design", "social media creatives"],
  },
  engineering_construction: {
    titles: ["civil engineer", "site engineer", "construction engineer", "mechanical engineer", "design engineer", "maintenance engineer", "production engineer", "industrial engineer"],
    signals: ["autocad", "revit", "primavera p6", "site supervision", "technical drawings", "quantity takeoff", "boq", "inspection", "solidworks", "equipment maintenance", "preventive maintenance", "root cause analysis", "quality checks"],
    keywords: ["AutoCAD", "Revit", "Primavera P6", "site supervision", "quantity takeoff", "BOQ", "technical documentation", "SolidWorks", "preventive maintenance", "equipment inspection", "quality checks"],
    verbs: ["reviewed", "prepared", "coordinated", "tracked", "inspected", "documented", "designed"],
    blockers: ["hipaa", "lesson planning", "sales pipeline", "design systems"],
  },
  legal_support: {
    titles: ["legal assistant", "paralegal", "legal secretary", "compliance assistant"],
    signals: ["legal documentation", "contract review", "case files", "compliance", "regulatory", "document management", "filing", "research", "case support"],
    keywords: ["legal documentation", "contract support", "case file management", "compliance documentation", "regulatory support", "document review"],
    verbs: ["prepared", "reviewed", "organized", "maintained", "documented", "coordinated"],
    blockers: ["warehouse operations", "microservices", "hipaa", "design systems"],
  },
  generic: {
    titles: [],
    signals: ["documentation", "reporting", "coordination", "analysis", "communication", "scheduling", "tracking", "records", "support"],
    keywords: ["documentation", "process tracking", "stakeholder communication", "task coordination", "time management", "reporting", "record maintenance"],
    verbs: ["coordinated", "prepared", "tracked", "maintained", "documented", "updated", "organized"],
    blockers: [],
  },
};

const HARD_FACT_TERMS = uniqueTrimmedStrings([
  "google ads", "meta ads", "google analytics", "ga4", "google tag manager", "seo", "sem", "ppc", "hubspot", "salesforce",
  "crm", "zendesk", "freshdesk", "jira", "confluence", "tableau", "power bi", "looker studio", "excel", "google sheets",
  "powerpoint", "sql", "python", "javascript", "typescript", "react", "node.js", "java", "c#", "aws", "azure", "gcp", "docker",
  "kubernetes", "git", "ci/cd", "rest api", "graphql", "microservices", "unit testing", "integration testing", "selenium",
  "cypress", "postman", "figma", "adobe creative suite", "photoshop", "illustrator", "indesign", "autocad", "solidworks", "revit",
  "primavera p6", "sap", "oracle", "quickbooks", "netsuite", "erp", "ifrs", "gaap", "accounts payable", "accounts receivable",
  "payroll", "forecasting", "variance analysis", "budgeting", "audit", "reconciliation", "workday", "greenhouse", "ats",
  "agile", "scrum", "kanban", "lean", "six sigma", "pmp", "csm", "psm", "etl", "data modeling", "inventory management",
  "warehouse management", "procurement", "sourcing", "vendor management", "shipment tracking", "rfq", "purchase orders",
  "csat", "nps", "qbr", "a/b testing", "remarketing", "retargeting", "lead generation", "boq", "api testing",
]);

const CANONICAL_REPLACEMENTS = [
  [/google analytics 4|google analytics4|ga 4/g, "ga4"],
  [/google tag manager|gtm/g, "google tag manager"],
  [/microsoft excel|ms excel/g, "excel"],
  [/microsoft office|ms office/g, "office"],
  [/looker data studio|google data studio|data studio/g, "looker studio"],
  [/structured query language/g, "sql"],
  [/react js|reactjs/g, "react"],
  [/node js|nodejs/g, "node.js"],
  [/amazon web services/g, "aws"],
  [/google cloud platform/g, "gcp"],
  [/quality assurance/g, "qa"],
  [/user experience/g, "ux"],
  [/user interface/g, "ui"],
  [/continuous integration continuous deployment|continuous integration continuous delivery|ci cd/g, "ci/cd"],
  [/restful api|rest apis/g, "rest api"],
  [/customer service/g, "customer support"],
  [/electronic health record/g, "ehr"],
  [/electronic medical record/g, "emr"],
  [/c sharp/g, "c#"],
  [/search engine optimization/g, "seo"],
  [/search engine marketing/g, "sem"],
  [/pay per click/g, "ppc"],
];

const BRAND_TERMS = new Set([
  "google ads", "meta ads", "google analytics", "ga4", "google tag manager", "hubspot", "salesforce", "zendesk", "freshdesk",
  "jira", "confluence", "tableau", "power bi", "looker studio", "react", "node.js", "aws", "azure", "gcp", "docker", "kubernetes",
  "selenium", "cypress", "postman", "figma", "adobe creative suite", "photoshop", "illustrator", "indesign", "autocad",
  "solidworks", "revit", "primavera p6", "sap", "oracle", "quickbooks", "netsuite", "workday", "greenhouse",
].map(canonicalizeTerm));

const ADJACENT_ROLE_BLOCKERS = {
  customer_support: ["sales pipeline", "proposal preparation", "deal tracking", "account executive", "crm segmentation", "qbr"],
  design_graphic: ["ui design", "ux design", "design systems", "user flows", "wireframing", "prototyping", "mockups"],
  healthcare_admin: ["hipaa", "ehr", "emr", "insurance verification", "eligibility verification", "travel coordination", "meeting coordination"],
  general_admin: ["program management", "project management", "operations management"],
  software_engineering: ["budget tracking", "campaign optimization", "patient scheduling"],
};

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
    .normalize("NFKD")
    .replace(/[“”‘’]/g, "'")
    .replace(/[—–]/g, "-")
    .replace(/[^\p{L}\p{N}\s+#/%&.,()'’/-]/gu, " ")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
}

function canonicalizeTerm(str = "") {
  let s = normalizeCompareText(str)
    .replace(/[\/_-]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();

  for (const [re, to] of CANONICAL_REPLACEMENTS) {
    s = s.replace(re, to);
  }

  return s.replace(/\s+/g, " ").trim();
}

function cleanKeywordCandidate(term = "") {
  return String(term || "")
    .replace(/\r/g, " ")
    .replace(/^[-•·‣▪▫◦*0-9.)\s]+/, "")
    .replace(/\s+/g, " ")
    .replace(/^[,;:]+|[,;:]+$/g, "")
    .trim();
}

function uniqueByCanonical(arr = []) {
  const seen = new Set();
  const out = [];
  for (const raw of Array.isArray(arr) ? arr : []) {
    const value = String(raw || "").trim();
    const key = canonicalizeTerm(value);
    if (!value || !key || seen.has(key)) continue;
    seen.add(key);
    out.push(value);
  }
  return out;
}

function countWords(str = "") {
  return String(str || "")
    .trim()
    .split(/\s+/)
    .filter(Boolean)
    .length;
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

function isSectionHeader(line = "") {
  const s = String(line || "").trim();
  return !!s && ALL_SECTION_HEADER_RE.test(s);
}

function detectSectionKey(line = "") {
  const s = String(line || "").trim();
  for (const [key, re] of Object.entries(SECTION_HEADING_PATTERNS)) {
    if (re.test(s)) return key;
  }
  return null;
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
  let inter = 0;
  for (const t of aSet) if (bSet.has(t)) inter += 1;
  const union = new Set([...aSet, ...bSet]).size;
  return union ? inter / union : 0;
}

function containsCanonicalTermInText(text = "", term = "") {
  const hay = canonicalizeTerm(text);
  const needle = canonicalizeTerm(term);
  if (!hay || !needle) return false;
  if (needle.includes(" ")) return hay.includes(needle);
  return new RegExp(`(?:^|\\s)${escapeRegex(needle)}(?:$|\\s)`, "i").test(hay);
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

function countTermHits(text = "", terms = []) {
  return uniqueTrimmedStrings(terms).reduce((sum, term) => {
    return sum + (containsCanonicalTermInText(text, term) ? 1 : 0);
  }, 0);
}

function isLikelyTitleLine(line = "") {
  const s = String(line || "").trim();
  if (!s || isSectionHeader(s)) return false;
  if (BULLET_RE.test(s)) return false;
  if (EMAIL_RE.test(s)) return false;
  if (s.length > 90) return false;
  if (/^[\d/ -]+$/.test(s)) return false;
  if (DATE_RE.test(s) && s.split(/\s+/).length <= 3) return false;
  return true;
}

function extractHeaderBlock(cv = "") {
  const lines = getNonEmptyLines(cv);
  const out = [];
  for (const line of lines) {
    if (isSectionHeader(line)) break;
    out.push(line);
  }
  return out.slice(0, 8);
}

function parseResumeSections(cv = "") {
  const lines = getNonEmptyLines(cv);
  const sections = [];
  const header = [];
  let current = null;

  for (const line of lines) {
    const key = detectSectionKey(line);
    if (key) {
      if (current) sections.push(current);
      current = { key, heading: line.trim(), lines: [] };
      continue;
    }
    if (!current) header.push(line);
    else current.lines.push(line);
  }

  if (current) sections.push(current);

  return {
    header,
    sections,
    sectionMap: sections.reduce((acc, section) => {
      acc[section.key] = section;
      return acc;
    }, {}),
  };
}

function getBulletLines(cv = "") {
  return getNonEmptyLines(cv)
    .filter((line) => BULLET_RE.test(line))
    .map((line) => line.replace(BULLET_RE, "").trim())
    .filter(Boolean);
}

function extractSummaryLines(cv = "") {
  const parsed = parseResumeSections(cv);
  const lines = parsed.sectionMap.summary?.lines || [];
  return lines
    .flatMap((line) => line.split(/(?<=[.?!])\s+/))
    .map((line) => line.trim())
    .filter(Boolean);
}

function extractSkillsLines(cv = "") {
  const parsed = parseResumeSections(cv);
  return (parsed.sectionMap.skills?.lines || [])
    .map((line) => line.replace(BULLET_RE, "").trim())
    .filter(Boolean);
}

function extractExperienceTitles(cv = "") {
  const lines = getNonEmptyLines(cv);
  const titles = [];
  for (let i = 1; i < lines.length; i += 1) {
    const line = lines[i];
    const prev = lines[i - 1];
    if (!prev || isSectionHeader(prev) || !isLikelyTitleLine(prev)) continue;
    if ((DATE_RE.test(line) && /[-–|]/.test(line)) || (DATE_RE.test(line) && PRESENT_RE.test(line))) {
      titles.push(prev.trim());
    }
  }
  return uniqueByCanonical(titles).slice(0, 20);
}

function extractExperienceBullets(cv = "") {
  const parsed = parseResumeSections(cv);
  const lines = parsed.sectionMap.experience?.lines || [];
  return lines
    .filter((line) => BULLET_RE.test(line))
    .map((line) => line.replace(BULLET_RE, "").trim())
    .filter(Boolean);
}

function extractOtherBullets(cv = "") {
  const parsed = parseResumeSections(cv);
  return parsed.sections
    .filter((section) => section.key !== "experience")
    .flatMap((section) => section.lines)
    .filter((line) => BULLET_RE.test(line))
    .map((line) => line.replace(BULLET_RE, "").trim())
    .filter(Boolean);
}

function extractWeakCandidatePools(cv = "") {
  return {
    experienceBullets: extractExperienceBullets(cv),
    summaryLines: extractSummaryLines(cv),
    otherBullets: extractOtherBullets(cv),
  };
}

function normalizeHeadingLine(line = "", outLang = "English") {
  const set = HEADING_SETS[outLang] || HEADING_SETS.English;
  const key = detectSectionKey(line);
  if (!key) return String(line || "").trim();
  return set[key] || String(line || "").trim();
}

function normalizeOptimizedHeadings(text = "", outLang = "English") {
  const lines = normalizeSpace(text).split("\n");
  return lines.map((line) => (isSectionHeader(line) ? normalizeHeadingLine(line, outLang) : line)).join("\n");
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
    const prev = String(lines[i - 1] || "").trim();
    if (!prev || isSectionHeader(prev) || !isLikelyTitleLine(prev)) continue;
    if ((DATE_RE.test(line) && /[-–|]/.test(line)) || (DATE_RE.test(line) && PRESENT_RE.test(line))) {
      if (titleIndex < originalTitles.length) {
        lines[i - 1] = originalTitles[titleIndex];
        titleIndex += 1;
      }
    }
  }

  return lines.join("\n").replace(/\n{3,}/g, "\n\n").trim();
}

function countUnchangedBullets(originalCv = "", optimizedCv = "") {
  const original = getBulletLines(originalCv).map(canonicalizeTerm);
  const optimized = new Set(getBulletLines(optimizedCv).map(canonicalizeTerm));
  let same = 0;
  for (const item of original) {
    if (optimized.has(item)) same += 1;
  }
  return { same, total: original.length };
}

function forceSafeResume(originalCv = "", optimizedCv = "", outLang = "English") {
  let out = normalizeOptimizedHeadings(optimizedCv, outLang);
  out = replaceHeaderBlock(originalCv, out);
  out = restoreExperienceTitles(originalCv, out);
  out = normalizeOptimizedHeadings(out, outLang);
  return out.trim();
}

function looksLikeAcronym(term = "") {
  const s = String(term || "").trim();
  return ACRONYM_RE.test(s) || /^[A-Z0-9/+.#-]{2,12}$/.test(s);
}

function looksLikeCertification(term = "") {
  return /\b(pmp|csm|psm|scrum master|cpa|cfa|acca|ifrs|gaap|lean six sigma|six sigma|itil|aws certified|azure fundamentals|google ads certification)\b/i.test(String(term || ""));
}

function isBrandedOrVendorSpecific(term = "") {
  return BRAND_TERMS.has(canonicalizeTerm(term));
}

function isLowValueKeyword(term = "") {
  const cleaned = cleanKeywordCandidate(term);
  if (!cleaned) return true;
  const norm = canonicalizeTerm(cleaned);
  const wc = countWords(cleaned);
  if (wc === 1 && norm.length < 4 && !looksLikeAcronym(cleaned)) return true;
  if (LOW_VALUE_TERM_RE.test(norm) && wc <= 3) return true;
  if (/^(experience|knowledge|skills|skill|management|analysis|support|reporting|communication|documentation|tecrube|deneyim|beceri|yetenek|analiz|destek|raporlama)$/i.test(norm)) return true;
  return false;
}

function extractExplicitFactTerms(text = "") {
  return HARD_FACT_TERMS.filter((term, idx, arr) => arr.indexOf(term) === idx && containsCanonicalTermInText(text, term));
}

function extractAcronymLikeTerms(text = "") {
  return uniqueTrimmedStrings(
    (String(text || "").match(/\b[A-Z]{2,}(?:\/[A-Z]{2,})?\b/g) || [])
      .map((x) => x.trim())
      .filter((x) => x.length <= 12)
  );
}

function extractSkillLikeNgrams(text = "") {
  const clauses = normalizeSpace(text)
    .split(/[\n;•]/)
    .map((x) => x.trim())
    .filter(Boolean)
    .slice(0, 180);

  const hints = uniqueTrimmedStrings([
    "analysis", "analytics", "dashboard", "reporting", "forecasting", "budgeting", "reconciliation", "audit", "payable", "receivable",
    "payroll", "recruiting", "screening", "onboarding", "procurement", "sourcing", "vendor", "inventory", "warehouse", "logistics",
    "shipment", "support", "customer", "ticket", "renewal", "retention", "curriculum", "classroom", "assessment", "instruction",
    "patient", "clinic", "testing", "automation", "qa", "quality", "sql", "python", "javascript", "typescript", "react", "node",
    "api", "microservices", "cloud", "docker", "kubernetes", "roadmap", "backlog", "stakeholder", "scrum", "agile", "design",
    "figma", "autocad", "revit", "solidworks", "primavera", "legal", "compliance", "risk", "deployment", "etl", "data modeling", "boq",
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
        if (hasHint || looksLikeAcronym(phrase) || looksLikeCertification(phrase)) out.push(phrase);
      }
    }
  }

  return uniqueByCanonical(out).slice(0, 120);
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
  const headerText = extractHeaderBlock(cv).join(" ");
  const titlesText = extractExperienceTitles(cv).join(" ");
  const skillsText = extractSkillsLines(cv).join(" ");
  const summaryText = extractSummaryLines(cv).join(" ");
  const bulletText = getBulletLines(cv).join(" ");
  const jdText = String(jd || "");
  const allText = [headerText, titlesText, skillsText, summaryText, bulletText, jdText].join("\n");

  const scored = Object.entries(ROLE_TAXONOMY)
    .filter(([key]) => key !== "generic")
    .map(([key, role]) => {
      const titleHits = countTermHits(`${headerText} ${titlesText}`, role.titles || []);
      const skillHits = countTermHits(skillsText, [...(role.signals || []), ...(role.keywords || [])]);
      const summaryHits = countTermHits(summaryText, [...(role.titles || []), ...(role.signals || []), ...(role.keywords || [])]);
      const bulletHits = countTermHits(bulletText, [...(role.signals || []), ...(role.keywords || [])]);
      const jdHits = countTermHits(jdText, [...(role.signals || []), ...(role.keywords || []), ...(role.titles || [])]);
      const exactFactHits = extractExplicitFactTerms(allText).filter((term) => (role.signals || []).some((item) => canonicalizeTerm(item) === canonicalizeTerm(term))).length;
      const blockerHits = countTermHits(allText, role.blockers || []);
      const score = titleHits * 10 + skillHits * 6 + summaryHits * 4 + bulletHits * 3 + jdHits * 2 + exactFactHits * 2 - blockerHits * 4;
      return { key, score, titleHits, skillHits, summaryHits, bulletHits, jdHits, blockerHits };
    })
    .filter((item) => item.score > 0)
    .sort((a, b) => b.score - a.score);

  const primary = scored[0]?.key || "generic";
  const topScore = scored[0]?.score || 0;
  const roleGroups = scored
    .filter((item, idx) => idx === 0 || item.score >= Math.max(8, topScore - 8) || item.titleHits >= 1 || item.skillHits >= 2)
    .slice(0, jd ? 3 : 2)
    .map((item) => item.key);

  const groups = roleGroups.length ? roleGroups : ["generic"];
  const domainSignals = uniqueTrimmedStrings(
    groups.flatMap((key) => [...(ROLE_TAXONOMY[key]?.signals || []), ...(ROLE_TAXONOMY[key]?.keywords || [])])
  ).filter((term) => containsCanonicalTermInText(allText, term)).slice(0, 20);

  const designGraphicOnly =
    groups.includes("design") &&
    countTermHits(allText, ROLE_TAXONOMY.design.graphicOnlySignals || []) >= 2 &&
    countTermHits(allText, ["ui designer", "ux designer", "product designer", "wireframes", "prototypes", "user flows", "design system"]) === 0;

  const generalAdmin =
    groups.includes("administration") &&
    countTermHits(allText, ["program manager", "project manager", "operations manager", "roadmap", "risk tracking"]) === 0;

  const healthcareLimited =
    groups.includes("healthcare_administration") &&
    countTermHits(allText, ROLE_TAXONOMY.healthcare_administration.requiresEvidenceFor || []) === 0;

  return {
    roleGroups: groups,
    primaryRole: primary,
    secondaryRoles: groups.slice(1),
    seniority: inferSeniority(`${headerText} ${titlesText} ${jdText}`),
    domainSignals,
    designGraphicOnly,
    generalAdmin,
    healthcareLimited,
    scoredRoles: scored.slice(0, 6),
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
  let out = uniqueTrimmedStrings(
    getRolePacks(profile, cv, jd).flatMap((role) => role.keywords || [])
  );

  if (profile.seniority === "manager_or_lead" || profile.seniority === "leadership") {
    out = uniqueTrimmedStrings(["stakeholder communication", "cross-functional collaboration", "process improvement", ...out]);
  }

  if (profile.seniority === "junior") {
    out = uniqueTrimmedStrings([...out, "documentation", "process adherence", "task coordination", "quality checks"]);
  }

  if (profile.primaryRole === "design" && profile.designGraphicOnly) {
    out = out.filter((term) => !["UI design", "UX design", "wireframing", "prototyping", "design systems", "user flows", "mockups"].some((blocked) => canonicalizeTerm(blocked) === canonicalizeTerm(term)));
    out = uniqueTrimmedStrings([...out, "visual design", "layout design", "brand assets", "print design"]);
  }

  if (profile.primaryRole === "healthcare_administration" && profile.healthcareLimited) {
    out = out.filter((term) => !["HIPAA", "EHR/EMR", "insurance verification"].some((blocked) => canonicalizeTerm(blocked) === canonicalizeTerm(term)));
  }

  if (profile.primaryRole === "administration" && profile.generalAdmin) {
    out = out.filter((term) => !["program management", "project management", "operations management"].some((blocked) => canonicalizeTerm(blocked) === canonicalizeTerm(term)));
  }

  return uniqueTrimmedStrings(out);
}

function buildRoleContextText(roleInput, cv = "", jd = "") {
  const profile = ensureRoleProfile(roleInput, cv, jd);
  const packs = getRolePacks(profile, cv, jd);
  const verbs = uniqueTrimmedStrings(packs.flatMap((role) => role.verbs || [])).slice(0, 18);
  const keywords = getRoleSuggestedKeywords(profile, cv, jd).slice(0, 14);
  return [
    `- primary_role: ${profile.primaryRole}`,
    `- secondary_roles: ${(profile.secondaryRoles || []).join(", ") || "(none)"}`,
    `- seniority_signal: ${profile.seniority || "mid"}`,
    `- detected_role_signals: ${(profile.domainSignals || []).join(", ") || "(none)"}`,
    `- likely_keyword_themes: ${keywords.join(", ") || "(none)"}`,
    `- preferred_truthful_verbs: ${verbs.join(", ") || "coordinated, prepared, tracked, maintained"}`,
    profile.designGraphicOnly ? "- design_guardrail: graphic/visual design only; avoid unsupported UI/UX/product design drift" : "",
    profile.healthcareLimited ? "- healthcare_guardrail: do not assume HIPAA/EHR/EMR/insurance verification without explicit evidence" : "",
    profile.generalAdmin ? "- admin_guardrail: do not drift into operations/program/project management without evidence" : "",
  ].filter(Boolean).join("\n");
}

function buildRoleWritingBlock(roleInput, cv = "", jd = "") {
  const profile = ensureRoleProfile(roleInput, cv, jd);
  const packs = getRolePacks(profile, cv, jd);
  const verbs = uniqueTrimmedStrings(packs.flatMap((role) => role.verbs || [])).slice(0, 20);
  return [
    "ROLE WRITING RULES:",
    `- Primary role family: ${profile.primaryRole}`,
    `- Seniority signal: ${profile.seniority}`,
    `- Prefer truthful verbs such as: ${verbs.join(", ") || "coordinated, prepared, tracked, maintained"}`,
    "- Preserve profession-native terminology.",
    "- Keep support-level work support-level unless the source clearly shows ownership.",
    "- Do not invent leadership, metrics, scale, budgets, clients, tools, or outcomes.",
    profile.designGraphicOnly ? "- For this profile, avoid adding UI/UX/product design terminology unless explicitly present." : "",
    profile.healthcareLimited ? "- For this profile, avoid HIPAA, EHR/EMR, and insurance verification unless explicitly present." : "",
    profile.generalAdmin ? "- For this profile, avoid drifting into operations/project/program management language unless explicitly present." : "",
  ].filter(Boolean).join("\n");
}

function classifyTermCategory(term = "", roleInput, cv = "", jd = "") {
  const profile = ensureRoleProfile(roleInput, cv, jd);
  const norm = canonicalizeTerm(term);
  if (looksLikeCertification(term)) return "certification";
  if (HARD_FACT_TERMS.some((item) => canonicalizeTerm(item) === norm)) return "tool";
  const roleThemes = getRoleSuggestedKeywords(profile, cv, jd);
  if (roleThemes.some((item) => canonicalizeTerm(item) === norm)) return "domain";
  if (/\b(senior|lead|manager|director|principal|junior|associate|intern|uzman|kidemli|stajyer)\b/i.test(term)) return "seniority";
  return "responsibility";
}

function scoreExtractedTerm(term = "", sourceText = "", roleInput, cv = "", jd = "") {
  const cleaned = cleanKeywordCandidate(term);
  if (!cleaned) return 0;
  let score = 0;
  const wc = countWords(cleaned);
  const norm = canonicalizeTerm(cleaned);
  if (isLowValueKeyword(cleaned)) score -= 15;
  if (wc >= 2 && wc <= 4) score += 4;
  else if (looksLikeAcronym(cleaned)) score += 3;
  if (looksLikeCertification(cleaned)) score += 5;
  if (HARD_FACT_TERMS.some((item) => canonicalizeTerm(item) === norm)) score += 7;
  const occ = countOccurrencesNormalized(sourceText, cleaned);
  if (occ > 1) score += Math.min(4, occ - 1);
  if (new RegExp(`${JD_CUE_RE.source}[\\s\\S]{0,90}${escapeRegex(cleaned)}`, "i").test(sourceText)) score += 3;
  if (new RegExp(`${escapeRegex(cleaned)}[\\s\\S]{0,45}${JD_CUE_RE.source}`, "i").test(sourceText)) score += 2;
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
  const candidates = uniqueByCanonical([...directMatches, ...ngrams, ...acronyms]);

  const ranked = candidates
    .map((term) => ({
      term,
      category: classifyTermCategory(term, profile, cv, jd),
      score: scoreExtractedTerm(term, jd, profile, cv, jd),
    }))
    .filter((item) => item.score > 0)
    .sort((a, b) => b.score - a.score || countWords(b.term) - countWords(a.term))
    .slice(0, 48);

  return {
    ranked,
    tools: ranked.filter((x) => x.category === "tool").slice(0, 12).map((x) => x.term),
    methodologies: ranked.filter((x) => x.category === "domain").slice(0, 12).map((x) => x.term),
    certifications: ranked.filter((x) => x.category === "certification").slice(0, 8).map((x) => x.term),
    responsibilities: ranked.filter((x) => x.category === "responsibility").slice(0, 12).map((x) => x.term),
    domains: ranked.filter((x) => x.category === "domain").slice(0, 12).map((x) => x.term),
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
  const terms = uniqueTrimmedStrings([
    ...extractExplicitFactTerms(cv),
    ...extractExplicitFactTerms(jd),
    ...extractAcronymLikeTerms(cv),
    ...extractAcronymLikeTerms(jd),
  ]);
  return terms.length ? terms.join(", ") : "(none explicitly supported)";
}

function findUnsupportedTerms(originalCv = "", jd = "", optimizedCv = "") {
  const allowed = new Set(
    uniqueTrimmedStrings([
      ...extractExplicitFactTerms(originalCv),
      ...extractExplicitFactTerms(jd),
      ...extractAcronymLikeTerms(originalCv),
      ...extractAcronymLikeTerms(jd),
    ]).map(canonicalizeTerm)
  );

  const optimizedTerms = uniqueTrimmedStrings([
    ...extractExplicitFactTerms(optimizedCv),
    ...extractAcronymLikeTerms(optimizedCv),
  ]);

  return optimizedTerms.filter((term) => {
    const key = canonicalizeTerm(term);
    return key && !allowed.has(key);
  });
}

function roleDriftBlockers(roleProfile, cv = "", jd = "", hasJD = false) {
  const blockers = new Set();

  if (!hasJD && roleProfile.primaryRole === "customer_support") {
    for (const term of ADJACENT_ROLE_BLOCKERS.customer_support) blockers.add(canonicalizeTerm(term));
  }
  if (!hasJD && roleProfile.primaryRole === "design" && roleProfile.designGraphicOnly) {
    for (const term of ADJACENT_ROLE_BLOCKERS.design_graphic) blockers.add(canonicalizeTerm(term));
  }
  if (!hasJD && roleProfile.primaryRole === "healthcare_administration" && roleProfile.healthcareLimited) {
    for (const term of ADJACENT_ROLE_BLOCKERS.healthcare_admin) blockers.add(canonicalizeTerm(term));
  }
  if (!hasJD && roleProfile.primaryRole === "administration" && roleProfile.generalAdmin) {
    for (const term of ADJACENT_ROLE_BLOCKERS.general_admin) blockers.add(canonicalizeTerm(term));
  }
  if (!hasJD && roleProfile.primaryRole === "software_engineering") {
    for (const term of ADJACENT_ROLE_BLOCKERS.software_engineering) blockers.add(canonicalizeTerm(term));
  }

  if (!hasJD) {
    getRolePacks(roleProfile, cv, jd).forEach((role) => {
      (role.blockers || []).forEach((term) => blockers.add(canonicalizeTerm(term)));
    });
  }

  return blockers;
}

function isSafeCvOnlySuggestedTerm(term = "", roleInput, cv = "") {
  const profile = ensureRoleProfile(roleInput, cv, "");
  const norm = canonicalizeTerm(term);
  if (!norm || isLowValueKeyword(term)) return false;
  if (containsCanonicalTermInText(cv, norm)) return false;
  if (isBrandedOrVendorSpecific(term)) return false;

  const blockers = roleDriftBlockers(profile, cv, "", false);
  if (blockers.has(norm)) return false;

  const roleThemes = getRoleSuggestedKeywords(profile, cv, "");
  const allowed = roleThemes.some((item) => {
    const key = canonicalizeTerm(item);
    return key === norm || key.includes(norm) || norm.includes(key);
  });

  if (!allowed && !looksLikeCertification(term)) return false;

  if (profile.primaryRole === "healthcare_administration" && profile.healthcareLimited) {
    if (["hipaa", "ehr emr", "insurance verification", "ehr", "emr"].includes(norm)) return false;
  }

  if (profile.primaryRole === "design" && profile.designGraphicOnly) {
    if (["ui design", "ux design", "design systems", "user flows", "wireframing", "prototyping", "mockups"].includes(norm)) return false;
  }

  return true;
}

function finalizeMissingKeywords(rawKeywords = [], { cv = "", jd = "", roleInput, hasJD = false, limit = 12 } = {}) {
  const profile = ensureRoleProfile(roleInput, cv, jd);
  const cvNorm = canonicalizeTerm(cv);
  const modelTerms = uniqueByCanonical((Array.isArray(rawKeywords) ? rawKeywords : []).map(cleanKeywordCandidate).filter(Boolean));
  const blockers = roleDriftBlockers(profile, cv, jd, hasJD);
  const jdSignals = hasJD ? extractJdSignalProfile(jd, profile, cv).ranked.map((item) => item.term) : [];
  let pool = hasJD
    ? uniqueByCanonical([...modelTerms, ...jdSignals])
    : uniqueByCanonical([...modelTerms, ...getRoleSuggestedKeywords(profile, cv, jd)]);

  const scored = [];

  for (const term of pool) {
    const cleaned = cleanKeywordCandidate(term);
    const norm = canonicalizeTerm(cleaned);
    if (!cleaned || !norm) continue;
    if (blockers.has(norm)) continue;
    if (isLowValueKeyword(cleaned)) continue;

    const presentCount = countOccurrencesNormalized(cvNorm, norm);
    if (presentCount >= 2) continue;

    if (!hasJD && !isSafeCvOnlySuggestedTerm(cleaned, profile, cv)) continue;

    let score = 0;

    if (hasJD) {
      if (containsCanonicalTermInText(jd, norm) && presentCount === 0) score += 16;
      else if (containsCanonicalTermInText(jd, norm) && presentCount === 1) score += 9;
      else if (!containsCanonicalTermInText(jd, norm)) score -= 3;
    } else {
      score += 8;
    }

    if (presentCount === 0) score += 6;
    else if (presentCount === 1) score += 2;

    if (HARD_FACT_TERMS.some((item) => canonicalizeTerm(item) === norm)) score += hasJD ? 6 : 2;
    if (looksLikeCertification(cleaned)) score += 5;

    const wc = countWords(cleaned);
    if (wc >= 2 && wc <= 4) score += 3;
    else if (looksLikeAcronym(cleaned)) score += 2;

    if (!hasJD && isBrandedOrVendorSpecific(cleaned)) score -= 20;

    if (profile.primaryRole === "customer_support" && /sales pipeline|proposal preparation|deal tracking|account executive|crm segmentation/i.test(cleaned)) score -= 30;
    if (profile.primaryRole === "design" && profile.designGraphicOnly && /ui design|ux design|wireframing|prototyping|design systems|user flows|mockups/i.test(cleaned)) score -= 30;
    if (profile.primaryRole === "healthcare_administration" && profile.healthcareLimited && /hipaa|ehr|emr|insurance verification/i.test(cleaned)) score -= 30;
    if (profile.primaryRole === "administration" && profile.generalAdmin && /operations management|project management|program management/i.test(cleaned)) score -= 24;

    if (score <= 0) continue;
    scored.push({ term: cleaned, score });
  }

  return scored
    .sort((a, b) => b.score - a.score || countWords(b.term) - countWords(a.term))
    .map((item) => item.term)
    .slice(0, limit);
}

function getSentenceSignalProfile(sentence = "", roleInput, cv = "", jd = "") {
  const s = String(sentence || "").trim();
  const profile = ensureRoleProfile(roleInput, cv, jd);
  const packs = getRolePacks(profile, cv, jd);
  const roleTerms = uniqueTrimmedStrings(packs.flatMap((role) => [...(role.signals || []), ...(role.keywords || [])]));
  if (!s) {
    return {
      isWeakCandidate: false,
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
      roleHits: 0,
      explicitFactsCount: 0,
      wordCount: 0,
      isReasonablyStrong: false,
      genericSummary: false,
    };
  }

  const wc = countWords(s);
  const explicitFacts = extractExplicitFactTerms(s);
  const acronyms = extractAcronymLikeTerms(s);
  const roleHits = countTermHits(s, roleTerms);
  const hasNumber = /\b\d+(?:[.,]\d+)?%?\b/.test(s);
  const strongAction = STRONG_ACTION_RE.test(s);
  const startsWeak = WEAK_OPENING_RE.test(s);
  const hasWeakPhrase = WEAK_ANYWHERE_RE.test(s);
  const hasScopeSignal = SCOPE_RE.test(s);
  const genericTask = SOFT_TASK_RE.test(s);
  const genericSummary = GENERIC_SUMMARY_RE.test(s);

  const explicitSpecificity = explicitFacts.length + acronyms.length + (hasNumber ? 1 : 0);
  const hasSpecific = explicitSpecificity > 0 || roleHits >= 2 || (strongAction && roleHits >= 1 && hasScopeSignal);

  let strongScore = 0;
  let weakScore = 0;

  if (strongAction) strongScore += 3;
  if (hasNumber) strongScore += 2;
  if (explicitFacts.length) strongScore += Math.min(3, explicitFacts.length);
  if (acronyms.length) strongScore += Math.min(2, acronyms.length);
  if (roleHits) strongScore += Math.min(4, roleHits);
  if (hasScopeSignal) strongScore += 1;
  if (wc >= 6 && wc <= 22) strongScore += 1;

  if (startsWeak) weakScore += 4;
  if (hasWeakPhrase) weakScore += 2;
  if (genericSummary) weakScore += 3;
  if (!hasSpecific) weakScore += 2;
  if (!strongAction) weakScore += 1;
  if (genericTask && !hasSpecific) weakScore += 2;
  if (wc <= 5) weakScore += 2;
  else if (wc <= 8 && !hasSpecific) weakScore += 1;
  if (wc > 28) weakScore += 1;

  if (hasSpecific && strongAction) weakScore -= 3;
  if (roleHits >= 2 && hasScopeSignal) weakScore -= 2;
  if (explicitFacts.length > 0) weakScore -= 1;

  const clearWeak =
    weakScore >= 8 ||
    (startsWeak && (!hasSpecific || strongScore <= 4)) ||
    (genericSummary && !hasSpecific) ||
    (hasWeakPhrase && genericTask && strongScore <= 4);

  const moderatelyWeak =
    !clearWeak &&
    (weakScore >= 5 ||
      (weakScore >= 4 && (startsWeak || hasWeakPhrase || genericTask || !hasSpecific) && strongScore <= 6));

  const candidateTier = clearWeak ? "clear" : moderatelyWeak ? "moderate" : "none";
  const improvementPotential = Math.max(0, weakScore - Math.floor(strongScore / 2)) + (startsWeak ? 2 : 0) + (genericTask ? 1 : 0) + (!hasSpecific ? 1 : 0);

  const isReasonablyStrong =
    strongScore >= 6 &&
    hasSpecific &&
    !startsWeak &&
    !hasWeakPhrase &&
    !genericTask &&
    wc >= 6 &&
    wc <= 22;

  return {
    isWeakCandidate: clearWeak || moderatelyWeak,
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
    roleHits,
    explicitFactsCount: explicitSpecificity,
    wordCount: wc,
    isReasonablyStrong,
    genericSummary,
  };
}

function detectWeakSentenceCandidates(cv = "", roleInput, minCount = 6, maxCount = 12) {
  const pools = extractWeakCandidatePools(cv);
  const candidates = [
    ...pools.experienceBullets.map((sentence) => ({ sentence, sourceType: "experience_bullet", sectionPriority: 4 })),
    ...pools.summaryLines.map((sentence) => ({ sentence, sourceType: "summary_line", sectionPriority: 2 })),
    ...pools.otherBullets.map((sentence) => ({ sentence, sourceType: "other_bullet", sectionPriority: 1 })),
  ];

  const ranked = candidates
    .map((item) => {
      const profile = getSentenceSignalProfile(item.sentence, roleInput, cv, "");
      const rank =
        item.sectionPriority * 100 +
        (profile.candidateTier === "clear" ? 40 : profile.candidateTier === "moderate" ? 20 : 0) +
        profile.improvementPotential * 3 +
        (profile.startsWeak ? 10 : 0) +
        (profile.hasWeakPhrase ? 6 : 0) +
        (!profile.hasSpecific ? 5 : 0) +
        (profile.genericTask ? 5 : 0) -
        profile.strongScore * 2;
      return { ...item, profile, rank };
    })
    .filter((item) => {
      if (item.profile.isReasonablyStrong) return false;
      if (item.profile.candidateTier !== "none") return true;
      if (item.sourceType === "experience_bullet") {
        return item.profile.weakScore >= 4 && (item.profile.startsWeak || item.profile.hasWeakPhrase || item.profile.genericTask || !item.profile.hasSpecific);
      }
      if (item.sourceType === "summary_line") {
        return item.profile.weakScore >= 5;
      }
      return item.profile.weakScore >= 6;
    })
    .sort((a, b) => b.rank - a.rank || b.profile.weakScore - a.profile.weakScore);

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
  let out = String(text || "").trim();
  const patterns = [
    /^helped with\s+/i,
    /^helped to\s+/i,
    /^helped\s+/i,
    /^assisted with\s+/i,
    /^assisted\s+/i,
    /^supported with\s+/i,
    /^supported\s+/i,
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
    /^destek verdim\s+/i,
    /^destek oldum\s+/i,
    /^görev aldım\s+/i,
    /^çalıştım\s+/i,
    /^yaptım\s+/i,
    /^sorumluydum\s+/i,
    /^katıldım\s+/i,
  ];
  for (const re of patterns) {
    if (re.test(out)) {
      out = out.replace(re, "").trim();
      break;
    }
  }
  return out;
}

function pickRoleAwareRewriteVerb(sentence = "", roleInput, cv = "", jd = "") {
  const packs = getRolePacks(roleInput, cv, jd);
  if (/(email|live chat|inquir|customer emails?|chat channels?)/i.test(sentence)) return "Responded to";
  if (/(ticket|case|issue|escalat|follow-?up|status)/i.test(sentence)) return "Tracked";
  if (/(records?|documentation|logs?|notes?)/i.test(sentence)) return "Maintained";
  if (/(reports?|summary|summaries|dashboard)/i.test(sentence)) return "Prepared";
  if (/(schedule|calendar|meeting|travel|communication)/i.test(sentence)) return "Coordinated";
  if (/(invoice|order|request|processing|account updates?)/i.test(sentence)) return "Processed";
  if (/(analysis|reconciliation|audit|review|validation)/i.test(sentence)) return "Reviewed";
  if (/(testing|qa|defect|bug|test cases?)/i.test(sentence)) return "Executed";
  if (/(backend|api|integration|feature|code|application|system)/i.test(sentence)) return "Implemented";

  const verbs = uniqueTrimmedStrings(packs.flatMap((role) => role.verbs || []))
    .filter((verb) => !/^(supported|assisted|helped|contributed|participated)$/i.test(verb))
    .map((verb) => capitalizeFirst(verb));

  return verbs[0] || "Coordinated";
}

function capitalizeFirst(str = "") {
  const s = String(str || "").trim();
  return s ? s.charAt(0).toUpperCase() + s.slice(1) : s;
}

function lowerFirst(str = "") {
  const s = String(str || "").trim();
  return s ? s.charAt(0).toLowerCase() + s.slice(1) : s;
}

function getTokenDeltaMetrics(source = "", rewrite = "") {
  const sourceSet = new Set(tokenizeForSimilarity(source));
  const rewriteSet = new Set(tokenizeForSimilarity(rewrite));
  const added = [...rewriteSet].filter((token) => !sourceSet.has(token));
  const removed = [...sourceSet].filter((token) => !rewriteSet.has(token));
  return {
    added,
    removed,
    totalDelta: added.length + removed.length,
  };
}

function hasUnsupportedSpecificityInRewrite(source = "", rewrite = "", cv = "", jd = "") {
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

function countMeaningfulRewriteImprovements(source = "", rewrite = "", roleInput, cv = "", jd = "") {
  const before = getSentenceSignalProfile(source, roleInput, cv, jd);
  const after = getSentenceSignalProfile(rewrite, roleInput, cv, jd);

  let improvements = 0;
  if (before.startsWeak && !after.startsWeak) improvements += 1;
  if ((after.strongScore >= before.strongScore + 2) || (after.strongAction && !before.strongAction)) improvements += 1;
  if ((after.hasSpecific && !before.hasSpecific) || after.roleHits > before.roleHits || after.explicitFactsCount > before.explicitFactsCount) improvements += 1;
  if ((after.hasScopeSignal && !before.hasScopeSignal) || (after.wordCount >= 6 && after.wordCount <= 20 && (before.wordCount < 6 || before.wordCount > 22))) improvements += 1;
  if (after.weakScore <= before.weakScore - 2) improvements += 1;
  return improvements;
}

function rewriteStillFeelsWeak(rewrite = "", roleInput, cv = "", jd = "") {
  const profile = getSentenceSignalProfile(rewrite, roleInput, cv, jd);
  if (WEAK_OPENING_RE.test(rewrite)) return true;
  if (WEAK_ANYWHERE_RE.test(rewrite)) return true;
  if (profile.isWeakCandidate && profile.weakScore >= 5) return true;
  return false;
}

function isShallowRewrite(sentence = "", rewrite = "") {
  const s = String(sentence || "").trim();
  const r = String(rewrite || "").trim();
  if (!s || !r) return true;
  if (canonicalizeTerm(s) === canonicalizeTerm(r)) return true;
  const sim = jaccardSimilarity(s, r);
  const delta = getTokenDeltaMetrics(s, r);
  const sourceFacts = extractExplicitFactTerms(s).length + extractAcronymLikeTerms(s).length;
  const rewriteFacts = extractExplicitFactTerms(r).length + extractAcronymLikeTerms(r).length;
  const scopeGain = SCOPE_RE.test(r) && !SCOPE_RE.test(s);
  if (sim >= 0.9) return true;
  if (delta.totalDelta <= 1) return true;
  if (delta.totalDelta <= 2 && !scopeGain && rewriteFacts <= sourceFacts) return true;
  return false;
}

function hasUnsupportedImpactClaims(source = "", rewrite = "") {
  return RISKY_OUTCOME_RE.test(rewrite) && !RISKY_OUTCOME_RE.test(source);
}

function buildLocalWeakRewrite(sentence = "", roleInput, outLang = "English", cv = "", jd = "") {
  if (outLang !== "English") return "";
  const source = String(sentence || "").trim();
  if (!source) return "";
  const profile = getSentenceSignalProfile(source, roleInput, cv, jd);
  if (!(profile.isWeakCandidate || profile.weakScore >= 4)) return "";
  const { body, ending } = splitSentenceEnding(source);
  const stripped = stripLeadingWeakPhrase(body);
  if (!stripped || countWords(stripped) < 2) return "";

  const templates = [
    [/^daily communication with customers regarding (.+)$/i, (m) => `Coordinated daily customer communication regarding ${m[1]} and tracked related follow-up items`],
    [/^customer requests and internal service updates$/i, () => "Coordinated customer requests and internal service updates across ongoing service workflows"],
    [/^weekly support summaries for the team$/i, () => "Prepared weekly support summaries for internal review and case follow-up tracking"],
    [/^records and documentation$/i, () => "Maintained records and documentation to support accurate follow-up and internal reference"],
    [/^meeting schedules and travel arrangements$/i, () => "Coordinated meeting schedules and travel arrangements to keep executive calendars organized"],
  ];

  for (const [re, mapper] of templates) {
    const match = stripped.match(re);
    if (match) {
      return `${mapper(match)}${ending}`;
    }
  }

  const lead = pickRoleAwareRewriteVerb(source, roleInput, cv, jd);
  let rewrite = `${lead} ${lowerFirst(stripped)}`.replace(/\s+/g, " ").trim();

  rewrite = rewrite
    .replace(/\bprepare prepared\b/i, "Prepared")
    .replace(/\bmaintain maintained\b/i, "Maintained")
    .replace(/\bcoordinate coordinated\b/i, "Coordinated")
    .replace(/\btrack tracked\b/i, "Tracked")
    .replace(/\bupdate updated\b/i, "Updated")
    .replace(/\bprocess processed\b/i, "Processed")
    .replace(/\breview reviewed\b/i, "Reviewed")
    .replace(/\bdocument documented\b/i, "Documented")
    .replace(/\borganize organized\b/i, "Organized")
    .replace(/\bschedule scheduled\b/i, "Scheduled")
    .trim();

  return `${rewrite}${ending}`;
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
      return item.sourceProfile.isWeakCandidate || item.sourceProfile.weakScore >= 4;
    })
    .filter((item) => !isShallowRewrite(item.sentence, item.rewrite))
    .filter((item) => item.improvements >= 2)
    .filter((item) => !rewriteStillFeelsWeak(item.rewrite, roleInput, cv, jd))
    .filter((item) => !hasUnsupportedSpecificityInRewrite(item.sentence, item.rewrite, cv, jd))
    .filter((item) => {
      if (outLang !== "English") return true;
      if (FLUFF_RE.test(item.rewrite) && !FLUFF_RE.test(item.sentence)) return false;
      if (hasUnsupportedImpactClaims(item.sentence, item.rewrite)) return false;
      return true;
    })
    .sort((a, b) => {
      const tierOrder = { clear: 2, moderate: 1, none: 0 };
      return (
        tierOrder[b.sourceProfile.candidateTier] - tierOrder[a.sourceProfile.candidateTier] ||
        b.improvements - a.improvements ||
        b.sourceProfile.weakScore - a.sourceProfile.weakScore ||
        a.rewriteProfile.weakScore - b.rewriteProfile.weakScore
      );
    })
    .slice(0, 12)
    .map(({ sentence, rewrite }) => ({ sentence, rewrite }));
}

function mergeWeakSentenceSets(primary = [], secondary = [], roleInput, outLang = "English", cv = "", jd = "", maxCount = 12) {
  const combined = [...(Array.isArray(primary) ? primary : []), ...(Array.isArray(secondary) ? secondary : [])];
  const out = [];
  const seen = new Set();

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
  const normalized = (Array.isArray(items) ? items : [])
    .map((item) => ({
      source: String(item?.source || item?.sentence || "").trim(),
      rewrite: String(item?.rewrite || item?.after || "").trim(),
      reason: String(item?.reason || "").trim(),
    }))
    .filter((item) => item.source && item.rewrite);

  const filtered = [];
  const seen = new Set();

  for (const item of normalized) {
    const key = `${canonicalizeTerm(item.source)}__${canonicalizeTerm(item.rewrite)}`;
    if (!key || seen.has(key)) continue;
    seen.add(key);

    const sourceProfile = getSentenceSignalProfile(item.source, roleInput, cv, jd);
    if (sourceProfile.isReasonablyStrong) continue;
    if (!(sourceProfile.isWeakCandidate || sourceProfile.weakScore >= 4)) continue;
    if (isShallowRewrite(item.source, item.rewrite)) continue;
    if (countMeaningfulRewriteImprovements(item.source, item.rewrite, roleInput, cv, jd) < 2) continue;
    if (rewriteStillFeelsWeak(item.rewrite, roleInput, cv, jd)) continue;
    if (hasUnsupportedSpecificityInRewrite(item.source, item.rewrite, cv, jd)) continue;
    if (outLang === "English" && (hasUnsupportedImpactClaims(item.source, item.rewrite) || (FLUFF_RE.test(item.rewrite) && !FLUFF_RE.test(item.source)))) continue;

    filtered.push(item);
  }

  return filtered.slice(0, 8);
}

function buildPriorityRewriteText(bulletUpgrades = []) {
  if (!Array.isArray(bulletUpgrades) || !bulletUpgrades.length) return "(none)";
  return bulletUpgrades
    .map((item, idx) => `${idx + 1}. source: ${item.source}\n  stronger rewrite target: ${item.rewrite}${item.reason ? `\n  why: ${item.reason}` : ""}`)
    .join("\n\n");
}

function buildLocalBulletUpgradeFallback(weakSentences = []) {
  return (Array.isArray(weakSentences) ? weakSentences : [])
    .map((item) => ({
      source: item.sentence,
      rewrite: item.rewrite,
      reason: "Stronger action, clearer scope, and better ATS phrasing.",
    }))
    .slice(0, 8);
}

function applyBulletUpgradesToText(text = "", bulletUpgrades = []) {
  const map = new Map();
  for (const item of Array.isArray(bulletUpgrades) ? bulletUpgrades : []) {
    const source = String(item?.source || "").trim();
    const rewrite = String(item?.rewrite || "").trim();
    if (source && rewrite) map.set(canonicalizeTerm(source), rewrite);
  }
  if (!map.size) return normalizeSpace(text);

  return normalizeSpace(text)
    .split("\n")
    .map((line) => {
      const bulletMatch = line.match(/^(\s*[-•·‣▪▫◦*]\s+)(.*)$/);
      if (bulletMatch) {
        const content = String(bulletMatch[2] || "").trim();
        const replacement = map.get(canonicalizeTerm(content));
        if (replacement) return `${bulletMatch[1]}${replacement}`;
      } else {
        const trimmed = line.trim();
        const replacement = map.get(canonicalizeTerm(trimmed));
        if (replacement) return replacement;
      }
      return line;
    })
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
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
  const parsed = parseResumeSections(cv);
  let score = 0;
  if (parsed.header.length >= 2) score += 4;
  if (parsed.sectionMap.summary) score += 4;
  if (parsed.sectionMap.experience) score += 8;
  if (parsed.sectionMap.skills) score += 4;
  if (parsed.sectionMap.education) score += 4;
  if (parsed.sectionMap.languages) score += 2;
  if (parsed.sectionMap.certifications) score += 2;
  if (parsed.sectionMap.projects) score += 1;
  return Math.min(25, score);
}

function getReadabilityScore(cv = "") {
  const bullets = getBulletLines(cv);
  const lines = getNonEmptyLines(cv);
  let score = 0;
  if (extractHeaderBlock(cv).length >= 3) score += 3;
  if (lines.length >= 10) score += 3;
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
    if (wc >= 5 && wc <= 22) value += 0.8;
    else if (wc >= 4 && wc <= 28) value += 0.4;
    if (profile.startsWeak) value -= 1.2;
    if (profile.genericTask && !profile.hasSpecific) value -= 1.0;
    if (profile.genericSummary) value -= 0.8;
    sum += Math.max(0, Math.min(14, value));
  }

  const avg = sum / bullets.length;
  return Math.max(0, Math.min(40, Math.round((avg / 14) * 40)));
}

function getKeywordBreadthScore(cv = "", roleInput, jd = "") {
  const profile = ensureRoleProfile(roleInput, cv, jd);
  const skills = uniqueTrimmedStrings(extractSkillsLines(cv));
  let score = 0;
  score += Math.min(8, skills.length);
  const hardHits = extractExplicitFactTerms(cv).length;
  score += Math.min(4, hardHits);
  const relevantPool = uniqueTrimmedStrings(getRolePacks(profile, cv, jd).flatMap((role) => [...(role.signals || []), ...(role.keywords || [])]));
  const relevantHits = relevantPool.filter((term) => containsCanonicalTermInText(cv, term)).length;
  score += Math.min(5, relevantHits);
  return Math.min(15, score);
}

function getJdAlignmentScore(cv = "", jd = "", roleInput) {
  if (!String(jd || "").trim()) return 0;
  const signals = extractJdSignalProfile(jd, roleInput, cv).ranked;
  if (!signals.length) return 0;
  let totalWeight = 0;
  let hitWeight = 0;
  for (const item of signals.slice(0, 24)) {
    let weight = 1;
    if (item.category === "tool" || item.category === "certification") weight = 1.35;
    else if (item.category === "domain") weight = 1.2;
    else if (item.category === "seniority") weight = 0.8;
    totalWeight += weight;
    if (containsCanonicalTermInText(cv, item.term)) hitWeight += weight;
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
    total =
      Math.round((sectionScore / 25) * 16) +
      Math.round((bulletScore / 40) * 38) +
      Math.round((readabilityScore / 20) * 18) +
      Math.round((keywordScore / 15) * 10) +
      Math.round((jdScore / 10) * 18);
  } else {
    total =
      Math.round((sectionScore / 25) * 20) +
      Math.round((bulletScore / 40) * 42) +
      Math.round((readabilityScore / 20) * 22) +
      Math.round((keywordScore / 15) * 16);
  }

  return clampScore(total);
}

function deterministicComponentScores(cv = "", jd = "", roleProfile) {
  const hasJD = !!String(jd || "").trim();
  const sectionCompleteness = clampScore(Math.round((getSectionPresenceScore(cv) / 25) * 100));
  const bulletStrength = clampScore(Math.round((getBulletStrengthScore(cv, roleProfile, jd) / 40) * 100));
  const readability = clampScore(Math.round((getReadabilityScore(cv) / 20) * 100));
  const keywordBreadth = clampScore(Math.round((getKeywordBreadthScore(cv, roleProfile, jd) / 15) * 100));
  const jdMatch = clampScore(Math.round((getJdAlignmentScore(cv, jd, roleProfile) / 10) * 100));

  if (hasJD) {
    return {
      role_alignment: clampScore(Math.round((bulletStrength * 0.55) + (jdMatch * 0.45))),
      bullet_strength: bulletStrength,
      jd_keyword_match: jdMatch,
      section_completeness: sectionCompleteness,
      ats_safe_formatting: readability,
    };
  }

  return {
    section_completeness: sectionCompleteness,
    clarity_readability: readability,
    bullet_strength: bulletStrength,
    ats_safe_formatting: readability,
    core_keyword_coverage: keywordBreadth,
  };
}

function mergeComponentScores(modelScores = {}, deterministicScores = {}, hasJD = false) {
  const out = {};
  const keys = hasJD
    ? ["role_alignment", "bullet_strength", "jd_keyword_match", "section_completeness", "ats_safe_formatting"]
    : ["section_completeness", "clarity_readability", "bullet_strength", "ats_safe_formatting", "core_keyword_coverage"];

  for (const key of keys) {
    const modelValue = clampScore(modelScores?.[key]);
    const detValue = clampScore(deterministicScores?.[key]);
    if (modelValue && detValue) out[key] = clampScore(Math.round(detValue * 0.72 + modelValue * 0.28));
    else out[key] = modelValue || detValue || 0;
  }

  return out;
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
  const rescored = computeDeterministicAtsScore(optimizedCv, jd, roleProfile);
  const rawLift = Math.max(0, rescored - base);

  const weakBefore = detectWeakSentenceCandidates(originalCv, roleProfile, 0, 20).length;
  const weakAfter = detectWeakSentenceCandidates(optimizedCv, roleProfile, 0, 20).length;
  const weakGain = Math.max(0, weakBefore - weakAfter);

  const { same, total } = countUnchangedBullets(originalCv, optimizedCv);
  const rewriteRatio = total > 0 ? 1 - (same / total) : 0;

  const bulletBefore = getBulletStrengthScore(originalCv, roleProfile, jd);
  const bulletAfter = getBulletStrengthScore(optimizedCv, roleProfile, jd);
  const bulletGain = Math.max(0, bulletAfter - bulletBefore);

  let lift = 0;
  lift += rawLift * 0.72;
  lift += Math.min(6, weakGain) * 1.3;
  lift += Math.min(4, bulletGain * 0.28);

  if (rewriteRatio >= 0.7) lift += 4;
  else if (rewriteRatio >= 0.5) lift += 3;
  else if (rewriteRatio >= 0.3) lift += 2;
  else if (rewriteRatio >= 0.18) lift += 1;

  const meaningful =
    rawLift > 1 || weakGain > 0 || rewriteRatio >= 0.18 || bulletGain >= 3;

  if (!meaningful) return base;

  const cap =
    base < 40 ? 22 :
    base < 55 ? 18 :
    base < 70 ? 15 :
    base < 80 ? 12 : 8;

  lift = Math.round(Math.max(5, Math.min(cap, lift)));
  return clampScore(base + lift);
}

function countCorporateFluffHits(cv = "") {
  return getBulletLines(cv).filter((item) => FLUFF_RE.test(item)).length;
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
    if (source && lines.includes(source)) hits += 1;
  }
  return hits;
}

function shouldRepairOptimizedCv(originalCv = "", optimizedCv = "", jd = "", outLang = "English", weakSentences = [], roleInput) {
  const profile = ensureRoleProfile(roleInput, originalCv, jd);
  const hasJD = !!String(jd || "").trim();
  if (!optimizedCv || !String(optimizedCv).trim()) return true;
  if (canonicalizeTerm(originalCv) === canonicalizeTerm(optimizedCv)) return true;

  const { same, total } = countUnchangedBullets(originalCv, optimizedCv);
  if (total > 0 && same / total >= (hasJD ? 0.42 : 0.36)) return true;
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

function buildDeterministicSummary(cv = "", jd = "", roleProfile, hasJD = false, outLang = "English") {
  const bullets = [];
  const profile = ensureRoleProfile(roleProfile, cv, jd);
  const bulletCount = getBulletLines(cv).length;
  const weakCount = detectWeakSentenceCandidates(cv, profile, 0, 20).length;
  const explicitFacts = extractExplicitFactTerms(cv).slice(0, 8);
  const keywords = getRoleSuggestedKeywords(profile, cv, jd).slice(0, 6);

  if (outLang === "English") {
    bullets.push(`Primary role signal: ${profile.primaryRole.replace(/_/g, " ")} with ${profile.seniority} seniority cues.`);
    bullets.push(`Structure quality is ${getSectionPresenceScore(cv) >= 18 ? "solid" : "partial"} based on section coverage and resume organization.`);
    bullets.push(`Bullet quality is ${weakCount <= 2 ? "fairly strong" : weakCount <= 5 ? "mixed" : "uneven"}, with ${weakCount} lines needing stronger wording or clearer context.`);
    if (explicitFacts.length) bullets.push(`Detected resume evidence includes: ${explicitFacts.join(", ")}.`);
    if (hasJD) {
      const jdSignals = extractJdSignalProfile(jd, profile, cv).ranked.slice(0, 5).map((x) => x.term);
      if (jdSignals.length) bullets.push(`Top JD signals include: ${jdSignals.join(", ")}.`);
      bullets.push(`Alignment should improve by tightening role-relevant language and filling the most important missing or underrepresented JD terms.`);
    } else if (keywords.length) {
      bullets.push(`Useful ATS coverage opportunities include: ${keywords.join(", ")}.`);
    }
    bullets.push(`Current resume has ${bulletCount} bullet lines, so improvements should focus on the weakest lines rather than rewriting everything.`);
  } else {
    bullets.push(`Birincil rol sinyali: ${profile.primaryRole.replace(/_/g, " ")} ve ${profile.seniority} kıdem işaretleri.`);
    bullets.push(`Yapı kalitesi bölüm kapsamı ve düzen açısından ${getSectionPresenceScore(cv) >= 18 ? "iyi" : "kısmi"} görünüyor.`);
    bullets.push(`Madde kalitesi ${weakCount <= 2 ? "nispeten güçlü" : weakCount <= 5 ? "karışık" : "düzensiz"}; daha güçlü anlatım gerektiren ${weakCount} satır var.`);
    if (explicitFacts.length) bullets.push(`Öne çıkan açık kanıtlar: ${explicitFacts.join(", ")}.`);
    if (hasJD) bullets.push(`Eşleşmeyi artırmak için rol ile ilgili dili güçlendirmek ve en önemli eksik/az temsil edilen JD terimlerini ele almak gerekir.`);
    else if (keywords.length) bullets.push(`Faydalı ATS kapsam fırsatları: ${keywords.join(", ")}.`);
    bullets.push(`Mevcut özgeçmişte ${bulletCount} madde satırı var; bu nedenle tüm metni yeniden yazmak yerine en zayıf satırlara odaklanılmalı.`);
  }

  return bullets.map((line) => `- ${line}`).join("\n");
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

function buildOpenAIPayload({ model, messages, reasoningEffort = null, maxCompletionTokens = 1800 }) {
  const body = {
    model,
    response_format: { type: "json_object" },
    messages,
  };

  if (isGpt5Model(model)) {
    body.max_completion_tokens = maxCompletionTokens;
    if (reasoningEffort) body.reasoning_effort = reasoningEffort;
  } else {
    body.max_tokens = maxCompletionTokens;
    body.temperature = 0.2;
  }

  return body;
}

function buildAttempts({ model, passType = "analysis", isPreview = false, maxCompletionTokens = 1800 }) {
  if (!isGpt5Model(model)) {
    return [{ reasoningEffort: null, maxCompletionTokens }];
  }

  if (passType === "optimize") {
    return [
      { reasoningEffort: "medium", maxCompletionTokens: Math.max(maxCompletionTokens, 3400) },
      { reasoningEffort: "low", maxCompletionTokens: Math.max(maxCompletionTokens, 4200) },
    ];
  }

  if (passType === "repair") {
    return [
      { reasoningEffort: "low", maxCompletionTokens: Math.max(maxCompletionTokens, 3200) },
      { reasoningEffort: "minimal", maxCompletionTokens: Math.max(maxCompletionTokens, 4000) },
    ];
  }

  if (passType === "bullet") {
    return [
      { reasoningEffort: "low", maxCompletionTokens: Math.max(maxCompletionTokens, 1600) },
      { reasoningEffort: "minimal", maxCompletionTokens: Math.max(maxCompletionTokens, 2200) },
    ];
  }

  if (isPreview) {
    return [
      { reasoningEffort: "minimal", maxCompletionTokens: Math.max(maxCompletionTokens, 1000) },
      { reasoningEffort: "minimal", maxCompletionTokens: Math.max(maxCompletionTokens, 1400) },
    ];
  }

  return [
    { reasoningEffort: "low", maxCompletionTokens: Math.max(maxCompletionTokens, 1800) },
    { reasoningEffort: "minimal", maxCompletionTokens: Math.max(maxCompletionTokens, 2400) },
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
    if (start !== -1 && end !== -1 && end > start) return JSON.parse(s.slice(start, end + 1));
    throw new Error("Model did not return valid JSON");
  }
}

async function callOpenAIJson({ apiKey, model, system, userPrompt, isPreview = false, passType = "analysis", maxCompletionTokens = 1800 }) {
  const attempts = buildAttempts({ model, passType, isPreview, maxCompletionTokens });
  let lastError = null;

  for (const attempt of attempts) {
    try {
      const response = await fetchWithTimeout(
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
              maxCompletionTokens: attempt.maxCompletionTokens,
            })
          ),
        },
        passType === "optimize" || passType === "repair" ? 70000 : 60000
      );

      const raw = await response.text();
      if (!response.ok) {
        const err = new Error("OpenAI error");
        err.status = response.status;
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
    "You are an expert recruiter-grade ATS resume analyst and resume rewriting engine.",
    "CRITICAL RULES:",
    "- Return valid JSON only.",
    "- Never invent or assume numbers, KPIs, budgets, clients, team size, revenue, ownership level, achievements, dates, tools, certifications, platforms, or outcomes.",
    "- Never add fake leadership or strategy ownership.",
    "- If a bullet is support-level, keep it support-level but improve wording.",
    "- Weak sentence detection must be selective and strict.",
    "- Do not flag already-strong lines just because they could be polished.",
    "- Do not return shallow rewrites that only swap one weak verb for another.",
    "- Missing keywords must be realistic, role-aware, and conservative.",
    "- Avoid adjacent-role drift and generic soft-skill spam.",
    "- Optimized resume output must stay ATS-safe, believable, and clean.",
    `- All output values must be written only in ${outLang}. Do not mix languages.`,
  ].join("\n");
}

function buildEnglishStyleBlock(roleInput, cv = "", jd = "") {
  return [
    "ENGLISH WRITING STYLE:",
    "- Write like a strong recruiter-facing resume writer, not marketing copy.",
    "- Prefer concise bullets, usually around 9-18 words when possible.",
    "- Use action + scope + tool/channel/context when evidence exists.",
    "- Do not add fluffy business language or unsupported outcomes.",
    buildRoleWritingBlock(roleInput, cv, jd),
  ].join("\n");
}

function buildAnalysisPrompt({ cv, jd, hasJD, outLang, roleProfile, isPreview }) {
  const schema = hasJD
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

  const weakRule = isPreview
    ? "- Return up to 2 weak_sentences."
    : hasJD
      ? "- Return 7-12 weak_sentences when genuinely weak examples exist."
      : "- Return 8-12 weak_sentences when genuinely weak examples exist. If the resume contains many weak or moderate bullets, return at least 6.";

  const keywordRule = hasJD
    ? (isPreview ? "- Return 5-7 genuinely missing or underrepresented JD-relevant keywords." : "- Return 12-20 genuinely missing or underrepresented JD-relevant keywords.")
    : (isPreview ? "- Return 5-7 conservative role-aware ATS keywords based on the resume alone." : "- Return 10-18 conservative role-aware ATS keywords based on the resume alone.");

  return [
    `Return JSON in this exact schema:\n${schema}`,
    hasJD ? "TASK: Perform a job-specific ATS review." : "TASK: Perform a general ATS review without a job description.",
    "STRICT REQUIREMENTS:",
    "- Use the resume as the source of truth.",
    hasJD ? "- Score alignment against the JD without inventing fit." : "- Infer likely role family and ATS language from the resume itself.",
    keywordRule,
    "- Prioritize tools, platforms, methods, certifications, domain phrases, responsibility patterns, and seniority signals over filler.",
    weakRule,
    "- Only select lines that are genuinely vague, generic, duty-only, shallow, support-heavy, or low-information.",
    "- Do not select lines that already contain clear tools, processes, or concrete role detail unless the rewrite is materially stronger.",
    "- Every rewrite must be materially stronger in at least two of: clarity, specificity, action strength, scope, recruiter readability, ATS phrasing.",
    isPreview ? "- summary must be 4-6 concise bullet-style lines." : "- summary must be 8-12 bullet-style lines.",
    "ROLE CONTEXT:",
    buildRoleContextText(roleProfile, cv, jd),
    hasJD ? `RANKED JD SIGNALS:\n${buildJdSignalText(jd, roleProfile, cv)}` : "",
    outLang === "English" ? buildEnglishStyleBlock(roleProfile, cv, jd) : "",
    `RESUME:\n${cv}`,
    hasJD ? `JOB DESCRIPTION:\n${jd}` : "",
  ].filter(Boolean).join("\n\n");
}

function buildWeakRewriteFallbackPrompt({ cv, jd, hasJD, candidates, outLang, roleProfile }) {
  return [
    `Return JSON in this exact schema:\n{\n  "weak_sentences": [{"sentence": string, "rewrite": string}]\n}`,
    "TASK:",
    "Rewrite only the listed weak resume lines into materially stronger ATS-friendly versions.",
    "STRICT RULES:",
    "- Rewrite only the provided sentences.",
    "- Keep all facts truthful.",
    "- Do not invent tools, metrics, outcomes, ownership, platforms, or scope.",
    "- Avoid shallow synonym swaps.",
    "- Keep support-level work support-level.",
    `- Output values only in ${outLang}.`,
    "ROLE CONTEXT:",
    buildRoleContextText(roleProfile, cv, jd),
    outLang === "English" ? buildEnglishStyleBlock(roleProfile, cv, jd) : "",
    `WEAK CANDIDATES:\n${(Array.isArray(candidates) ? candidates : []).map((x, i) => `${i + 1}. ${x}`).join("\n") || "(none)"}`,
    `RESUME:\n${cv}`,
    hasJD ? `JOB DESCRIPTION:\n${jd}` : "",
  ].filter(Boolean).join("\n\n");
}

function buildTargetedBulletUpgradePrompt({ cv, jd, hasJD, weakSentences, outLang, roleProfile }) {
  return [
    `Return JSON in this exact schema:\n{\n  "bullet_upgrades": [{ "source": string, "rewrite": string, "reason": string }]\n}`,
    "TASK:",
    "Create premium-quality bullet rewrites only for the provided weak resume sentences.",
    "STRICT RULES:",
    "- Rewrite only the listed source sentences.",
    "- Keep each rewrite truthful, ATS-friendly, concise, and recruiter-ready.",
    "- Do not invent numbers, results, tools, budgets, clients, ownership, or impact.",
    "- reason must briefly explain what improved.",
    `- Output values only in ${outLang}.`,
    "ROLE CONTEXT:",
    buildRoleContextText(roleProfile, cv, jd),
    outLang === "English" ? buildEnglishStyleBlock(roleProfile, cv, jd) : "",
    `WEAK SOURCE SENTENCES:\n${(Array.isArray(weakSentences) ? weakSentences : []).map((item, i) => `${i + 1}. ${String(item?.sentence || "").trim()}`).join("\n") || "(none)"}`,
    `RESUME:\n${cv}`,
    hasJD ? `JOB DESCRIPTION:\n${jd}` : "",
  ].filter(Boolean).join("\n\n");
}

function buildOptimizePrompt({ cv, jd, hasJD, summary, missingKeywords, bulletUpgrades, outLang, roleProfile }) {
  return [
    `Return JSON in this exact schema:\n{\n  "optimized_cv": string\n}`,
    "TASK:",
    hasJD ? "Rewrite the resume into a materially stronger ATS-friendly version aligned to the job description." : "Rewrite the resume into a materially stronger ATS-friendly version.",
    "STRICT RULES:",
    "- Keep the header identity block exactly as written.",
    "- Keep existing experience titles unchanged.",
    "- Keep exact dates, employers, titles, education, certifications, and hard facts unchanged.",
    "- Do not invent numbers, tools, platforms, acronyms, KPIs, achievements, ownership, or outcomes.",
    "- Do not force missing keywords into the resume unless the original resume clearly supports them.",
    "- Keep already-strong bullets mostly intact.",
    "- Focus changes on weaker summary lines and weaker bullets.",
    "- Preserve overall structure and bullet count as much as possible.",
    "- Use clean standard section headings only.",
    "ROLE CONTEXT:",
    buildRoleContextText(roleProfile, cv, jd),
    hasJD ? `RANKED JD SIGNALS:\n${buildJdSignalText(jd, roleProfile, cv)}` : "",
    `ALLOWED EXPLICIT TERMS:\n${buildAllowedTermsText(cv, jd)}`,
    `PRIORITY REWRITE TARGETS:\n${buildPriorityRewriteText(bulletUpgrades)}`,
    outLang === "English" ? buildEnglishStyleBlock(roleProfile, cv, jd) : "",
    `ANALYSIS SUMMARY:\n${summary || "(none)"}`,
    `HIGH PRIORITY KEYWORD GAPS (context only, do not force):\n${Array.isArray(missingKeywords) ? missingKeywords.join(", ") : "(none)"}`,
    "SELF-CHECK BEFORE RETURNING:",
    "- no unsupported additions",
    "- no invented achievements or leadership",
    "- weak bullets materially improved",
    "- same person, same experience, better writing",
    `RESUME:\n${cv}`,
    hasJD ? `JOB DESCRIPTION:\n${jd}` : "",
  ].filter(Boolean).join("\n\n");
}

function buildRepairPrompt({ cv, jd, hasJD, currentOptimizedCv, summary, missingKeywords, bulletUpgrades, unsupportedTerms = [], outLang, roleProfile }) {
  return [
    `Return JSON in this exact schema:\n{\n  "optimized_cv": string\n}`,
    "TASK:",
    "Repair the current optimized resume into a cleaner, safer, stronger final version.",
    "STRICT RULES:",
    "- Keep the header identity block exactly as written.",
    "- Keep titles, dates, employers, education, and certifications unchanged.",
    "- Remove unsupported additions.",
    "- Preserve bullet count and structure as much as possible.",
    "- Do not invent tools, platforms, outcomes, or ownership.",
    "ROLE CONTEXT:",
    buildRoleContextText(roleProfile, cv, jd),
    hasJD ? `RANKED JD SIGNALS:\n${buildJdSignalText(jd, roleProfile, cv)}` : "",
    `ALLOWED EXPLICIT TERMS:\n${buildAllowedTermsText(cv, jd)}`,
    `REMOVE THESE UNSUPPORTED TERMS IF PRESENT:\n${(unsupportedTerms || []).join(", ") || "(none)"}`,
    `PRIORITY REWRITE TARGETS:\n${buildPriorityRewriteText(bulletUpgrades)}`,
    outLang === "English" ? buildEnglishStyleBlock(roleProfile, cv, jd) : "",
    `ANALYSIS SUMMARY:\n${summary || "(none)"}`,
    `HIGH PRIORITY KEYWORD GAPS (context only, do not force):\n${Array.isArray(missingKeywords) ? missingKeywords.join(", ") : "(none)"}`,
    `RESUME (original):\n${cv}`,
    hasJD ? `JOB DESCRIPTION:\n${jd}` : "",
    `CURRENT OPTIMIZED CV (repair this):\n${currentOptimizedCv}`,
  ].filter(Boolean).join("\n\n");
}

function sanitizeStringInput(value = "", maxChars = 40000) {
  return normalizeSpace(String(value || "").slice(0, maxChars));
}

function ensureArrayStrings(value, maxItems = 20, maxChars = 120) {
  return uniqueByCanonical(
    (Array.isArray(value) ? value : [])
      .map((item) => cleanKeywordCandidate(String(item || "").slice(0, maxChars)))
      .filter(Boolean)
  ).slice(0, maxItems);
}

function normalizeSummary(summary = "", fallback = "") {
  const text = normalizeSpace(String(summary || "").trim());
  return text || fallback || "";
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

    const hasJD = !!jd;
    const sessionOk = verifySession(req);
    const isPreview = previewRequested || !sessionOk;

    const previewModel = process.env.OPENAI_MODEL_PREVIEW || process.env.OPENAI_MODEL || DEFAULT_MODEL;
    const fullModel = process.env.OPENAI_MODEL_FULL || process.env.OPENAI_MODEL || DEFAULT_MODEL;
    const model = isPreview ? previewModel : fullModel;

    const ip = getClientIp(req);
    const limiter = isPreview ? rlPreview : rlFull;
    const { success, reset } = await limiter.limit(ip);
    if (!success) {
      const retrySec = Math.max(1, Math.ceil((reset - Date.now()) / 1000));
      return res.status(429).json({ error: "Too many requests", retry_after_seconds: retrySec });
    }

    const roleProfile = inferRoleProfile(cv, jd);
    const systemPrompt = buildAtsSystem(outLang);
    const deterministicScores = deterministicComponentScores(cv, jd, roleProfile);
    const deterministicBase = computeDeterministicAtsScore(cv, jd, roleProfile);

    let analysisData = {};
    try {
      analysisData = await callOpenAIJson({
        apiKey,
        model,
        system: systemPrompt,
        userPrompt: buildAnalysisPrompt({ cv, jd, hasJD, outLang, roleProfile, isPreview }),
        isPreview,
        passType: "analysis",
        maxCompletionTokens: isPreview ? 1000 : 1800,
      });
    } catch (err) {
      return res.status(err?.status || 500).json({
        error: err?.message || "OpenAI error",
        status: err?.status || 500,
        details: err?.details || String(err),
      });
    }

    const mergedComponentScores = mergeComponentScores(
      analysisData?.component_scores && typeof analysisData.component_scores === "object" ? analysisData.component_scores : {},
      deterministicScores,
      hasJD
    );

    const modelComponentScore = computeComponentScore(mergedComponentScores, hasJD);
    const mergedBaseScore = clampScore(Math.round(deterministicBase * 0.78 + modelComponentScore * 0.22));

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
        // noop
      }
    }

    if (weakSentences.length < Math.min(isPreview ? 2 : desiredWeakCount, detectedWeakCandidates.length)) {
      const localWeak = buildLocalWeakSentenceSet(detectedWeakCandidates, roleProfile, outLang, cv, jd, isPreview ? 4 : 12);
      weakSentences = mergeWeakSentenceSets(weakSentences, localWeak, roleProfile, outLang, cv, jd, isPreview ? 4 : 12);
    }

    const missingKeywords = finalizeMissingKeywords(
      ensureArrayStrings(analysisData?.missing_keywords, hasJD ? 20 : 18),
      { cv, jd, roleInput: roleProfile, hasJD, limit: isPreview ? 7 : hasJD ? 20 : 18 }
    );

    const summaryFallback = buildDeterministicSummary(cv, jd, roleProfile, hasJD, outLang);
    const summary = normalizeSummary(analysisData?.summary, summaryFallback);

    const normalized = {
      ats_score: mergedBaseScore,
      optimized_ats_score: mergedBaseScore,
      component_scores: mergedComponentScores,
      missing_keywords: missingKeywords,
      weak_sentences: weakSentences,
      optimized_cv: "",
      summary,
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
          maxCompletionTokens: 1400,
        });
        bulletUpgrades = normalizeBulletUpgrades(
          Array.isArray(bulletData?.bullet_upgrades) ? bulletData.bullet_upgrades : [],
          outLang,
          roleProfile,
          cv,
          jd
        );
      } catch {
        bulletUpgrades = [];
      }
    }

    if (!bulletUpgrades.length && normalized.weak_sentences.length > 0) {
      bulletUpgrades = normalizeBulletUpgrades(
        buildLocalBulletUpgradeFallback(normalized.weak_sentences),
        outLang,
        roleProfile,
        cv,
        jd
      );
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
      currentOptimized = bulletUpgrades.length
        ? applyBulletUpgradesToCv(cv, cv, bulletUpgrades, outLang)
        : forceSafeResume(cv, cv, outLang);
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
          maxCompletionTokens: 3000,
        });

        if (typeof repaired?.optimized_cv === "string" && repaired.optimized_cv.trim()) {
          currentOptimized = forceSafeResume(cv, repaired.optimized_cv.trim(), outLang);
          if (bulletUpgrades.length) currentOptimized = applyBulletUpgradesToCv(cv, currentOptimized, bulletUpgrades, outLang);
          unsupportedTerms = findUnsupportedTerms(cv, jd, currentOptimized);
        }
      } catch {
        // noop
      }
    }

    if (unsupportedTerms.length > 0) {
      currentOptimized = bulletUpgrades.length
        ? applyBulletUpgradesToCv(cv, cv, bulletUpgrades, outLang)
        : forceSafeResume(cv, cv, outLang);
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
