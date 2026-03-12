const LANG_MAP = {
  en: "English",
  tr: "Turkish",
  es: "Spanish",
  fr: "French",
  de: "German",
  it: "Italian",
  pt: "Portuguese",
  ru: "Russian",
  ar: "Arabic",
  zh: "Chinese (Simplified)",
};

const DEFAULT_TONE = "clean";
const VALID_TONES = new Set(["clean", "confident", "bold"]);
const VALID_SENIORITY = new Set([
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

const MAX_CV_CHARS = 24000;
const MAX_JD_CHARS = 16000;
const MAX_TARGET_ROLE_CHARS = 180;
const MAX_INDUSTRY_CHARS = 120;
const MAX_LOCATION_CHARS = 120;
const MAX_TONE_CHARS = 40;

const ROLE_FAMILIES = {
  software_engineering: {
    label: "Software Engineering",
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
      "platform engineer",
    ],
    keywords: [
      "software development",
      "api integration",
      "system design",
      "backend",
      "frontend",
      "full stack",
      "deployment",
      "database",
      "cloud",
      "microservices",
      "code review",
      "debugging",
      "release",
      "architecture",
    ],
    tools: [
      "javascript",
      "typescript",
      "node.js",
      "react",
      "python",
      "java",
      "c#",
      "sql",
      "aws",
      "azure",
      "gcp",
      "docker",
      "kubernetes",
      "git",
      "rest api",
      "graphql",
      "ci/cd",
      "unit testing",
      "integration testing",
      "postgresql",
      "mongodb",
    ],
    industry: [
      "backend services",
      "frontend applications",
      "cloud infrastructure",
      "web platforms",
      "application architecture",
      "software delivery",
    ],
  },
  qa: {
    label: "Quality Assurance",
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
      "release validation",
      "uat",
    ],
    tools: [
      "selenium",
      "cypress",
      "postman",
      "jira",
      "api testing",
      "test automation",
      "regression testing",
      "smoke testing",
      "manual testing",
      "uat",
    ],
    industry: [
      "quality validation",
      "release readiness",
      "defect management",
      "test coverage",
      "software quality",
    ],
  },
  data: {
    label: "Data / Analytics",
    titles: [
      "data analyst",
      "business intelligence analyst",
      "bi analyst",
      "reporting analyst",
      "analytics specialist",
      "data specialist",
      "business analyst",
    ],
    keywords: [
      "data analysis",
      "dashboard reporting",
      "reporting",
      "kpi tracking",
      "trend analysis",
      "data validation",
      "data modeling",
      "etl",
      "business intelligence",
      "insights",
    ],
    tools: [
      "sql",
      "python",
      "excel",
      "power bi",
      "tableau",
      "looker studio",
      "google sheets",
      "etl",
      "data modeling",
      "dashboard",
    ],
    industry: [
      "performance reporting",
      "analytics reporting",
      "data visualization",
      "business insights",
      "kpi analysis",
    ],
  },
  product: {
    label: "Product",
    titles: [
      "product manager",
      "product owner",
      "associate product manager",
      "technical product manager",
      "product specialist",
    ],
    keywords: [
      "product roadmap",
      "backlog prioritization",
      "requirements gathering",
      "user stories",
      "feature planning",
      "release planning",
      "stakeholder alignment",
      "acceptance criteria",
      "product discovery",
    ],
    tools: ["jira", "confluence", "figma", "analytics", "agile", "scrum"],
    industry: [
      "feature delivery",
      "product requirements",
      "roadmap planning",
      "cross-functional collaboration",
      "product operations",
    ],
  },
  business_analysis: {
    label: "Business Analysis",
    titles: [
      "business analyst",
      "systems analyst",
      "process analyst",
      "operations analyst",
    ],
    keywords: [
      "requirements gathering",
      "process mapping",
      "workflow analysis",
      "gap analysis",
      "documentation",
      "stakeholder communication",
      "reporting",
      "uat support",
    ],
    tools: ["jira", "confluence", "excel", "sql", "power bi", "visio"],
    industry: [
      "process improvement",
      "requirements documentation",
      "workflow design",
      "business process analysis",
    ],
  },
  finance: {
    label: "Finance / Accounting",
    titles: [
      "accountant",
      "financial analyst",
      "finance specialist",
      "accounts payable specialist",
      "accounts receivable specialist",
      "bookkeeper",
      "finance assistant",
    ],
    keywords: [
      "financial reporting",
      "reconciliation",
      "accounts payable",
      "accounts receivable",
      "invoice processing",
      "budget tracking",
      "forecasting",
      "variance analysis",
      "audit support",
      "month-end close",
      "ledger",
    ],
    tools: ["excel", "sap", "oracle", "quickbooks", "netsuite", "erp", "gaap", "ifrs"],
    industry: [
      "financial operations",
      "account reconciliation",
      "month-end reporting",
      "budget support",
      "audit readiness",
    ],
  },
  hr: {
    label: "HR / Recruiting",
    titles: [
      "hr specialist",
      "human resources specialist",
      "recruiter",
      "talent acquisition specialist",
      "hr coordinator",
      "people operations specialist",
    ],
    keywords: [
      "recruiting",
      "candidate screening",
      "interview coordination",
      "employee onboarding",
      "offboarding",
      "hr administration",
      "policy compliance",
      "employee records",
      "payroll support",
      "training coordination",
    ],
    tools: ["workday", "greenhouse", "ats", "hris", "excel"],
    industry: [
      "talent acquisition",
      "people operations",
      "employee lifecycle support",
      "hr compliance",
    ],
  },
  operations: {
    label: "Operations",
    titles: [
      "operations manager",
      "operations specialist",
      "operations coordinator",
      "operations analyst",
      "office manager",
    ],
    keywords: [
      "operations",
      "workflow coordination",
      "process improvement",
      "status reporting",
      "documentation",
      "scheduling",
      "vendor communication",
      "cross-functional coordination",
      "record keeping",
    ],
    tools: ["excel", "erp", "sap", "jira"],
    industry: [
      "operational tracking",
      "workflow management",
      "process coordination",
      "internal operations",
    ],
  },
  supply_chain: {
    label: "Supply Chain / Logistics",
    titles: [
      "supply chain specialist",
      "logistics specialist",
      "logistics coordinator",
      "warehouse coordinator",
      "inventory specialist",
    ],
    keywords: [
      "inventory management",
      "shipment tracking",
      "warehouse operations",
      "delivery planning",
      "order fulfillment",
      "stock control",
      "vendor coordination",
      "dispatch",
      "transport planning",
    ],
    tools: ["sap", "erp", "excel", "warehouse management"],
    industry: [
      "logistics coordination",
      "inventory control",
      "warehouse support",
      "shipment operations",
    ],
  },
  procurement: {
    label: "Procurement",
    titles: [
      "procurement specialist",
      "purchasing specialist",
      "buyer",
      "sourcing specialist",
      "procurement coordinator",
    ],
    keywords: [
      "procurement",
      "sourcing",
      "vendor management",
      "supplier communication",
      "purchase orders",
      "rfq",
      "price comparison",
      "contract support",
    ],
    tools: ["sap", "erp", "excel"],
    industry: [
      "supplier operations",
      "procurement support",
      "sourcing coordination",
      "purchasing administration",
    ],
  },
  sales: {
    label: "Sales",
    titles: [
      "sales specialist",
      "sales executive",
      "account executive",
      "sales coordinator",
      "business development executive",
    ],
    keywords: [
      "sales pipeline",
      "lead management",
      "crm",
      "deal tracking",
      "proposal preparation",
      "client follow-up",
      "sales reporting",
      "account coordination",
      "order processing",
    ],
    tools: ["salesforce", "hubspot", "crm", "excel"],
    industry: [
      "business development",
      "pipeline management",
      "client communication",
      "sales operations",
    ],
  },
  customer_support: {
    label: "Customer Support",
    titles: [
      "customer support specialist",
      "customer service representative",
      "support specialist",
      "technical support specialist",
      "help desk specialist",
    ],
    keywords: [
      "ticket management",
      "issue resolution",
      "email support",
      "live chat",
      "escalation handling",
      "support documentation",
      "sla",
      "case follow-up",
      "service quality",
      "customer communication",
    ],
    tools: ["zendesk", "freshdesk", "crm", "help desk", "sla"],
    industry: [
      "customer service operations",
      "case handling",
      "support workflows",
      "issue management",
    ],
  },
  customer_success: {
    label: "Customer Success",
    titles: [
      "customer success specialist",
      "customer success manager",
      "client success specialist",
      "account manager",
    ],
    keywords: [
      "customer onboarding",
      "account management",
      "renewal support",
      "customer retention",
      "relationship management",
      "customer feedback",
      "csat",
      "nps",
      "qbr",
    ],
    tools: ["crm", "salesforce", "hubspot", "csat", "nps"],
    industry: [
      "customer lifecycle management",
      "client engagement",
      "renewal support",
      "account health",
    ],
  },
  executive_assistant: {
    label: "Executive Assistant / Administrative",
    titles: [
      "executive assistant",
      "personal assistant",
      "administrative assistant",
      "office assistant",
      "admin assistant",
    ],
    keywords: [
      "calendar management",
      "meeting coordination",
      "travel coordination",
      "document preparation",
      "executive support",
      "office administration",
      "record maintenance",
      "scheduling",
    ],
    tools: ["excel", "powerpoint", "office", "google sheets"],
    industry: [
      "executive support",
      "administrative operations",
      "calendar coordination",
      "office workflows",
    ],
  },
  project: {
    label: "Project / Program Management",
    titles: [
      "project manager",
      "project coordinator",
      "program coordinator",
      "program manager",
      "pm",
    ],
    keywords: [
      "project coordination",
      "timeline management",
      "deliverable coordination",
      "status reporting",
      "stakeholder communication",
      "risk tracking",
      "milestone tracking",
      "project documentation",
    ],
    tools: ["jira", "confluence", "excel", "primavera p6", "ms project", "agile", "scrum"],
    industry: [
      "project delivery",
      "program coordination",
      "timeline planning",
      "cross-functional delivery",
    ],
  },
  marketing: {
    label: "Marketing",
    titles: [
      "digital marketing specialist",
      "marketing specialist",
      "performance marketing specialist",
      "marketing executive",
      "content specialist",
      "growth marketer",
    ],
    keywords: [
      "google ads",
      "meta ads",
      "ga4",
      "google analytics",
      "google tag manager",
      "seo",
      "sem",
      "ppc",
      "campaign reporting",
      "lead generation",
      "audience segmentation",
      "email marketing",
      "social media",
    ],
    tools: [
      "google ads",
      "meta ads",
      "google analytics",
      "ga4",
      "google tag manager",
      "search console",
      "hubspot",
      "seo",
      "sem",
      "ppc",
    ],
    industry: [
      "campaign optimization",
      "performance marketing",
      "analytics reporting",
      "channel management",
      "demand generation",
    ],
  },
  design: {
    label: "Design",
    titles: [
      "designer",
      "graphic designer",
      "ui designer",
      "ux designer",
      "product designer",
      "visual designer",
    ],
    keywords: [
      "ui design",
      "ux design",
      "wireframing",
      "prototyping",
      "design systems",
      "visual design",
      "brand assets",
      "mockups",
      "user flows",
    ],
    tools: ["figma", "adobe creative suite", "photoshop", "illustrator", "after effects"],
    industry: [
      "product design",
      "interface design",
      "visual communication",
      "digital design",
    ],
  },
  education: {
    label: "Education",
    titles: [
      "teacher",
      "english teacher",
      "math teacher",
      "subject teacher",
      "instructor",
      "lecturer",
      "teaching assistant",
    ],
    keywords: [
      "lesson planning",
      "classroom management",
      "student assessment",
      "curriculum development",
      "instruction",
      "learning materials",
      "student progress",
      "parent communication",
    ],
    tools: ["google classroom", "excel", "powerpoint", "office"],
    industry: [
      "instructional delivery",
      "academic support",
      "student development",
      "curriculum support",
    ],
  },
  healthcare_admin: {
    label: "Healthcare Administration",
    titles: [
      "healthcare administrator",
      "medical secretary",
      "medical office assistant",
      "patient coordinator",
      "clinic coordinator",
    ],
    keywords: [
      "patient scheduling",
      "medical records",
      "insurance verification",
      "ehr",
      "emr",
      "hipaa",
      "appointment coordination",
      "patient communication",
      "clinic administration",
    ],
    tools: ["ehr", "emr", "office", "excel", "hipaa"],
    industry: [
      "patient support",
      "clinic operations",
      "medical administration",
      "records coordination",
    ],
  },
  civil_engineering: {
    label: "Civil Engineering",
    titles: [
      "civil engineer",
      "site engineer",
      "construction engineer",
      "project site engineer",
    ],
    keywords: [
      "site supervision",
      "technical drawings",
      "quantity takeoff",
      "boq",
      "construction documentation",
      "inspection",
      "drawing review",
      "project coordination",
    ],
    tools: ["autocad", "revit", "primavera p6", "excel", "boq"],
    industry: [
      "construction coordination",
      "site operations",
      "technical documentation",
      "project execution",
    ],
  },
  mechanical_engineering: {
    label: "Mechanical Engineering",
    titles: [
      "mechanical engineer",
      "design engineer",
      "maintenance engineer",
      "production engineer",
    ],
    keywords: [
      "mechanical design",
      "technical drawings",
      "preventive maintenance",
      "equipment inspection",
      "production support",
      "quality checks",
      "root cause analysis",
      "technical documentation",
    ],
    tools: ["solidworks", "autocad", "excel", "erp"],
    industry: [
      "equipment support",
      "production operations",
      "maintenance planning",
      "technical design",
    ],
  },
  generic: {
    label: "Professional",
    titles: [],
    keywords: [
      "documentation",
      "reporting",
      "coordination",
      "analysis",
      "communication",
      "tracking",
      "process support",
      "stakeholder communication",
    ],
    tools: ["excel", "office", "google sheets", "powerpoint"],
    industry: [
      "cross-functional collaboration",
      "process coordination",
      "operational support",
      "documentation",
    ],
  },
};

const WEAK_START_RE = /^(helped|assisted|supported|worked on|participated in|contributed to|involved in|responsible for|handled|provided support|aided|took part in|yard[iı]m(?:cı)? oldum|destek oldum|destek verdim|g[oö]rev ald[ıi]m|ilgilen(?:dim|di)|sorumlu oldum|katk[ıi] sa[ğg]lad[ıi]m)\b/i;
const WEAK_ANY_RE = /\b(helped|assisted|supported|worked on|participated in|contributed to|involved in|responsible for|handled|provided support|aided|took part in|yard[iı]m(?:cı)? oldum|destek oldum|destek verdim|g[oö]rev ald[ıi]m|ilgilen(?:dim|di)|sorumlu oldum|katk[ıi] sa[ğg]lad[ıi]m)\b/i;
const STRONG_ACTION_RE = /\b(built|developed|implemented|designed|created|led|managed|coordinated|analyzed|reviewed|prepared|executed|delivered|resolved|maintained|monitored|documented|scheduled|validated|tested|debugged|deployed|optimized|configured|reconciled|tracked|reported|planned|organized|produced|screened|verified|taught|assessed|inspected|drafted|mapped|refined|launched|engineered|y[oö]nettim|koordine ettim|haz[ıi]rlad[ıi]m|analiz ettim|raporlad[ıi]m|geliştirdim|oluşturdum|uygulad[ıi]m|düzenledim|takip ettim|izledim|de[ğg]erlendirdim|test ettim|do[ğg]rulad[ıi]m|uyarlad[ıi]m|sundum|planlad[ıi]m)\b/i;
const FILLER_RE = /\b(dynamic|results-driven|passionate|motivated|hardworking|detail-oriented|dedicated|proactive|seamless|robust|comprehensive|impactful|strategic thinker|team player|solution-oriented|highly organized|go-getter|self-starter|learning-focused)\b/i;
const FAKE_IMPACT_RE = /\b(increased|boosted|improved|optimized|reduced|accelerated|strengthened|maximized|drove|generated|delivered measurable|achieved significant|resulting in|led to|improve efficiency|drive results|increase performance|enhance outcomes)\b/i;
const CORPORATE_FLUFF_RE = /\b(best-in-class|world-class|synergy|thought leadership|transformational|game-changing|innovative leader|visionary|high-impact|value-driven|operational excellence|results-oriented)\b/i;
const LINKEDIN_LABELS = ["Search", "Impact", "Niche", "Leadership", "Clean"];

function uniqueStrings(arr = []) {
  const seen = new Set();
  const out = [];
  for (const item of Array.isArray(arr) ? arr : []) {
    const value = String(item || "").trim();
    if (!value) continue;
    const key = value.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(value);
  }
  return out;
}

function uniqueByNormalized(arr = []) {
  const seen = new Set();
  const out = [];
  for (const item of Array.isArray(arr) ? arr : []) {
    const value = String(item || "").trim();
    const key = canonicalize(value);
    if (!value || !key || seen.has(key)) continue;
    seen.add(key);
    out.push(value);
  }
  return out;
}

function canonicalize(str = "") {
  return String(str || "")
    .normalize("NFKD")
    .toLowerCase()
    .replace(/[“”"'`´]/g, " ")
    .replace(/[^\p{L}\p{N}\s+#&./-]/gu, " ")
    .replace(/[_]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function countWords(str = "") {
  return String(str || "")
    .trim()
    .split(/\s+/)
    .filter(Boolean).length;
}

function escapeRegex(str = "") {
  return String(str || "").replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function containsTerm(text = "", term = "") {
  const t = canonicalize(text);
  const q = canonicalize(term);
  if (!t || !q) return false;
  if (q.includes(" ")) return t.includes(q);
  return new RegExp(`(?:^|\\s)${escapeRegex(q)}(?:$|\\s)`, "i").test(t);
}

function termCount(text = "", terms = []) {
  let hits = 0;
  for (const term of uniqueStrings(terms)) {
    if (containsTerm(text, term)) hits += 1;
  }
  return hits;
}

function truncate(str = "", max = 1000) {
  const s = String(str || "").trim();
  return s.length > max ? s.slice(0, max).trim() : s;
}

function clampText(str = "", max = 1000) {
  return truncate(String(str || "").replace(/\s+/g, " "), max);
}

function splitLines(text = "") {
  return String(text || "")
    .replace(/\r/g, "")
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);
}

function isHeading(line = "") {
  return /^(summary|professional summary|profile|about|experience|work experience|professional experience|skills|technical skills|core skills|competencies|education|languages|certifications|projects|additional information|profi(l|le)|özet|profesyonel özet|deneyim|iş deneyimi|yetenekler|yetkinlikler|beceriler|eğitim|diller|sertifikalar|projeler)$/i.test(String(line || "").trim());
}

function extractHeaderLines(cv = "") {
  const lines = splitLines(cv);
  const out = [];
  for (const line of lines) {
    if (isHeading(line)) break;
    out.push(line);
    if (out.length >= 6) break;
  }
  return out;
}

function extractBulletLines(cv = "") {
  return String(cv || "")
    .replace(/\r/g, "")
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => /^[-•·‣▪▫◦*]\s+/.test(line))
    .map((line) => line.replace(/^[-•·‣▪▫◦*]\s+/, "").trim())
    .filter(Boolean);
}

function extractSummaryLines(cv = "") {
  const lines = splitLines(cv);
  const out = [];
  let inSummary = false;
  for (const line of lines) {
    if (/^(summary|professional summary|profile|about|özet|profesyonel özet|profil)$/i.test(line)) {
      inSummary = true;
      continue;
    }
    if (inSummary && isHeading(line)) break;
    if (inSummary) {
      const parts = line
        .split(/(?<=[.!?])\s+/)
        .map((part) => part.trim())
        .filter(Boolean);
      out.push(...parts);
    }
  }
  return out;
}

function extractSkillsLines(cv = "") {
  const lines = splitLines(cv);
  const out = [];
  let inSkills = false;
  for (const line of lines) {
    if (/^(skills|technical skills|core skills|competencies|yetenekler|yetkinlikler|beceriler)$/i.test(line)) {
      inSkills = true;
      continue;
    }
    if (inSkills && isHeading(line)) break;
    if (inSkills) out.push(line.replace(/^[-•·‣▪▫◦*]\s+/, "").trim());
  }
  return out.filter(Boolean);
}

function tokenize(str = "") {
  return canonicalize(str)
    .split(/\s+/)
    .filter((token) => token && token.length > 1);
}

function jaccardSimilarity(a = "", b = "") {
  const aSet = new Set(tokenize(a));
  const bSet = new Set(tokenize(b));
  if (!aSet.size || !bSet.size) return 0;
  let intersection = 0;
  for (const item of aSet) {
    if (bSet.has(item)) intersection += 1;
  }
  const union = new Set([...aSet, ...bSet]).size;
  return union ? intersection / union : 0;
}

function sentenceEndParts(str = "") {
  const s = String(str || "").trim();
  const match = s.match(/[.!?]+$/);
  return {
    body: s.replace(/[.!?]+$/, "").trim(),
    end: match ? match[0] : ".",
  };
}

function lowerFirst(str = "") {
  const s = String(str || "").trim();
  if (!s) return s;
  return s.charAt(0).toLowerCase() + s.slice(1);
}

function upperFirst(str = "") {
  const s = String(str || "").trim();
  if (!s) return s;
  return s.charAt(0).toUpperCase() + s.slice(1);
}

function safeArray(value) {
  return Array.isArray(value) ? value : [];
}

function cleanInputText(value, maxChars) {
  return String(value || "")
    .replace(/\u0000/g, " ")
    .replace(/\t/g, " ")
    .replace(/\r/g, "")
    .replace(/\s+$/gm, "")
    .trim()
    .slice(0, maxChars);
}

function normalizeLanguage(lang) {
  const code = String(lang || "en").trim().toLowerCase();
  return {
    code,
    label: LANG_MAP[code] || "English",
  };
}

function normalizeTone(tone) {
  const value = String(tone || DEFAULT_TONE).trim().toLowerCase();
  return VALID_TONES.has(value) ? value : DEFAULT_TONE;
}

function normalizeSeniority(seniority) {
  const value = String(seniority || "").trim().toLowerCase();
  if (VALID_SENIORITY.has(value)) return value;
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

function getAllRoleTerms() {
  const terms = [];
  for (const pack of Object.values(ROLE_FAMILIES)) {
    terms.push(...safeArray(pack.titles), ...safeArray(pack.keywords), ...safeArray(pack.tools), ...safeArray(pack.industry));
  }
  return uniqueByNormalized(terms);
}

const ALL_ROLE_TERMS = getAllRoleTerms();
const ALL_TOOL_TERMS = uniqueByNormalized(
  Object.values(ROLE_FAMILIES).flatMap((pack) => safeArray(pack.tools))
);
const ALL_TITLE_TERMS = uniqueByNormalized(
  Object.values(ROLE_FAMILIES).flatMap((pack) => safeArray(pack.titles))
);

function inferRoleProfile({ cv = "", jd = "", targetRole = "", industry = "", seniority = "mid" } = {}) {
  const combined = [cv, jd, targetRole, industry].filter(Boolean).join("\n");
  const header = extractHeaderLines(cv).join(" ");
  const summary = extractSummaryLines(cv).join(" ");
  const skills = extractSkillsLines(cv).join(" ");
  const bullets = extractBulletLines(cv).join(" ");
  const scored = Object.entries(ROLE_FAMILIES)
    .filter(([key]) => key !== "generic")
    .map(([key, pack]) => {
      const titleHits = termCount(`${targetRole} ${header}`, pack.titles);
      const keywordHits = termCount(combined, pack.keywords);
      const toolHits = termCount(`${combined} ${skills}`, pack.tools);
      const industryHits = termCount(`${combined} ${summary} ${bullets}`, pack.industry);
      const summaryHits = termCount(summary, [...pack.titles, ...pack.keywords, ...pack.industry]);
      const bulletHits = termCount(bullets, [...pack.keywords, ...pack.industry]);
      const score = titleHits * 8 + toolHits * 5 + keywordHits * 4 + industryHits * 3 + summaryHits * 2 + bulletHits * 2;
      return { key, score, titleHits, toolHits, keywordHits, industryHits };
    })
    .filter((item) => item.score > 0)
    .sort((a, b) => b.score - a.score);

  const roleGroups = scored.length
    ? scored
        .filter((item, idx) => idx === 0 || item.score >= Math.max(8, scored[0].score - 5) || item.titleHits > 0 || item.toolHits >= 2)
        .slice(0, 3)
        .map((item) => item.key)
    : ["generic"];

  const primary = roleGroups[0] || "generic";
  const packs = roleGroups.map((key) => ROLE_FAMILIES[key]).filter(Boolean);

  const detectedTerms = uniqueByNormalized(
    packs.flatMap((pack) => [...safeArray(pack.keywords), ...safeArray(pack.tools), ...safeArray(pack.industry)])
  )
    .filter((term) => containsTerm(combined, term))
    .slice(0, 18);

  return {
    primary,
    secondary: roleGroups.slice(1),
    roleGroups,
    seniority,
    label: ROLE_FAMILIES[primary]?.label || ROLE_FAMILIES.generic.label,
    packs,
    detectedTerms,
  };
}

function buildSupportedTermSet({ cv = "", jd = "", targetRole = "", industry = "" } = {}) {
  const source = [cv, jd, targetRole, industry].filter(Boolean).join("\n");
  const set = new Set();
  for (const term of ALL_ROLE_TERMS) {
    if (containsTerm(source, term)) set.add(canonicalize(term));
  }
  const acronyms = String(source).match(/\b[A-Z]{2,}(?:\/[A-Z]{2,})?\b/g) || [];
  for (const token of acronyms) set.add(canonicalize(token));
  return set;
}

function extractExplicitTerms(text = "") {
  return ALL_ROLE_TERMS.filter((term) => containsTerm(text, term));
}

function getRoleSpecificTerms(roleProfile) {
  const packs = safeArray(roleProfile?.packs);
  return uniqueByNormalized(
    packs.flatMap((pack) => [...safeArray(pack.titles), ...safeArray(pack.keywords), ...safeArray(pack.tools), ...safeArray(pack.industry)])
  );
}

function getRoleTitles(roleProfile, targetRole = "") {
  const pack = ROLE_FAMILIES[roleProfile?.primary] || ROLE_FAMILIES.generic;
  const titles = uniqueByNormalized([targetRole, ...safeArray(pack.titles)]).filter(Boolean);
  return titles.slice(0, 6);
}

function scoreWeakCandidate(line = "", roleProfile) {
  const text = String(line || "").trim();
  const roleTerms = getRoleSpecificTerms(roleProfile);
  const wordCount = countWords(text);
  const weakStart = WEAK_START_RE.test(text);
  const weakAny = WEAK_ANY_RE.test(text);
  const strongAction = STRONG_ACTION_RE.test(text);
  const hasNumber = /\b\d+(?:[.,]\d+)?%?\b/.test(text);
  const toolHits = termCount(text, ALL_TOOL_TERMS);
  const roleHits = termCount(text, roleTerms);
  const hasAcronym = /\b[A-Z]{2,}(?:\/[A-Z]{2,})?\b/.test(text);
  const hasContextPhrase = /\b(using|with|for|across|through|via|within|under|on|by|regarding|handling|tracking|supporting|maintaining|processing|documenting|kullanarak|ile|için|kapsamında|aracılığıyla)\b/i.test(text);
  const filler = FILLER_RE.test(text);
  const explicitTerms = extractExplicitTerms(text);
  const specificityScore = (hasNumber ? 2 : 0) + Math.min(3, toolHits) + Math.min(3, roleHits) + (hasAcronym ? 1 : 0) + Math.min(2, explicitTerms.length) + (hasContextPhrase ? 1 : 0);

  let weakScore = 0;
  if (weakStart) weakScore += 4;
  if (weakAny) weakScore += 2;
  if (!strongAction) weakScore += 1;
  if (wordCount <= 5) weakScore += 3;
  else if (wordCount <= 8) weakScore += 2;
  if (!hasContextPhrase) weakScore += 1;
  if (filler) weakScore += 2;
  if (/\b(daily tasks?|routine tasks?|support tasks?|various tasks?|general tasks?|team support|customer requests?|reports?|documents?)\b/i.test(text)) weakScore += 2;
  if (/\b(responsible for|duties included|tasked with|worked closely with|provided support for)\b/i.test(text)) weakScore += 2;
  if (/\b(maintained|prepared|coordinated|tracked|updated|processed|documented|reviewed|handled)\b/i.test(text) && specificityScore <= 2) weakScore += 1;

  let protectScore = 0;
  if (strongAction) protectScore += 2;
  if (specificityScore >= 4) protectScore += 4;
  else if (specificityScore >= 2) protectScore += 2;
  if (wordCount >= 8 && wordCount <= 22) protectScore += 1;

  const net = weakScore - protectScore;
  const clearlyWeak = net >= 3 || (weakStart && specificityScore <= 2) || (weakAny && !strongAction && specificityScore <= 3);
  const moderatelyWeak = net >= 1 && specificityScore <= 3 && (!strongAction || weakAny);
  const isWeak = clearlyWeak || moderatelyWeak;

  return {
    text,
    wordCount,
    weakStart,
    weakAny,
    strongAction,
    hasNumber,
    toolHits,
    roleHits,
    specificityScore,
    weakScore,
    protectScore,
    net,
    clearlyWeak,
    moderatelyWeak,
    isWeak,
  };
}

function extractWeakCandidates(cv = "", roleProfile) {
  const bullets = extractBulletLines(cv).map((text) => ({ text, sourceType: "experience" }));
  const summary = extractSummaryLines(cv).map((text) => ({ text, sourceType: "summary" }));
  const combined = [...bullets, ...summary]
    .map((item) => {
      const profile = scoreWeakCandidate(item.text, roleProfile);
      let priority = profile.net * 3;
      if (item.sourceType === "experience") priority += 4;
      if (profile.weakStart) priority += 4;
      if (profile.clearlyWeak) priority += 3;
      if (profile.moderatelyWeak) priority += 1;
      if (profile.specificityScore >= 4 && !profile.weakStart) priority -= 6;
      if (profile.strongAction && profile.specificityScore >= 3) priority -= 4;
      return { ...item, profile, priority };
    })
    .filter((item) => item.profile.isWeak)
    .sort((a, b) => b.priority - a.priority || b.profile.weakScore - a.profile.weakScore || a.profile.specificityScore - b.profile.specificityScore);

  const out = [];
  const seen = new Set();
  for (const item of combined) {
    const key = canonicalize(item.text);
    if (!key || seen.has(key)) continue;
    seen.add(key);
    out.push(item.text);
    if (out.length >= 12) break;
  }
  return out;
}

function startsWithWeakVerb(str = "") {
  return WEAK_START_RE.test(String(str || "").trim());
}

function hasUnsupportedNumber(before = "", after = "") {
  const beforeNums = String(before || "").match(/\b\d+(?:[.,]\d+)?%?\b/g) || [];
  const afterNums = String(after || "").match(/\b\d+(?:[.,]\d+)?%?\b/g) || [];
  const set = new Set(beforeNums);
  return afterNums.some((n) => !set.has(n));
}

function extractKnownTermsPresent(text = "") {
  return uniqueByNormalized(ALL_ROLE_TERMS.filter((term) => containsTerm(text, term)));
}

function hasUnsupportedTerms(after = "", supportedTermSet = new Set()) {
  for (const term of extractKnownTermsPresent(after)) {
    if (!supportedTermSet.has(canonicalize(term))) return true;
  }
  return false;
}

function losesRoleSpecificDetail(before = "", after = "", roleProfile) {
  const roleTerms = getRoleSpecificTerms(roleProfile).filter((term) => containsTerm(before, term));
  if (!roleTerms.length) return false;
  const afterNorm = canonicalize(after);
  const missing = roleTerms.filter((term) => !afterNorm.includes(canonicalize(term)));
  return missing.length >= Math.min(2, roleTerms.length);
}

function moreGenericThanSource(before = "", after = "", roleProfile) {
  const beforeProfile = scoreWeakCandidate(before, roleProfile);
  const afterProfile = scoreWeakCandidate(after, roleProfile);
  return afterProfile.specificityScore + 1 < beforeProfile.specificityScore;
}

function shallowSwapOnly(before = "", after = "") {
  const sim = jaccardSimilarity(before, after);
  const beforeBody = canonicalize(sentenceEndParts(before).body);
  const afterBody = canonicalize(sentenceEndParts(after).body);
  if (!beforeBody || !afterBody) return true;
  if (beforeBody === afterBody) return true;
  if (sim >= 0.88) return true;
  const beforeTokens = tokenize(before);
  const afterTokens = tokenize(after);
  const changes = afterTokens.filter((token) => !beforeTokens.includes(token)).length + beforeTokens.filter((token) => !afterTokens.includes(token)).length;
  if (changes <= 2 && sim >= 0.72) return true;
  return false;
}

function rewriteImprovementDimensions(before = "", after = "", roleProfile) {
  const beforeProfile = scoreWeakCandidate(before, roleProfile);
  const afterProfile = scoreWeakCandidate(after, roleProfile);
  const dims = [];

  if (beforeProfile.weakStart && !afterProfile.weakStart && afterProfile.strongAction) dims.push("action_strength");
  if (afterProfile.specificityScore > beforeProfile.specificityScore) dims.push("specificity");
  if (afterProfile.wordCount >= 7 && afterProfile.wordCount <= 20 && (beforeProfile.wordCount < 6 || beforeProfile.wordCount > 22)) dims.push("clarity");
  if (afterProfile.weakScore + 2 <= beforeProfile.weakScore) dims.push("recruiter_readability");
  if (afterProfile.specificityScore >= beforeProfile.specificityScore && /\b(with|using|for|across|through|via|within|regarding|by|kullanarak|ile|için|kapsamında)\b/i.test(after) && !/\b(with|using|for|across|through|via|within|regarding|by|kullanarak|ile|için|kapsamında)\b/i.test(before)) dims.push("business_context");
  if (countWords(after) > countWords(before) + 2 && afterProfile.specificityScore >= beforeProfile.specificityScore) dims.push("scope");

  return uniqueStrings(dims);
}

function isValidExperienceRewrite({ before = "", after = "", why = "", roleProfile, supportedTermSet, languageLabel = "English" }) {
  const source = String(before || "").trim();
  const rewrite = String(after || "").trim();
  const explanation = String(why || "").trim();
  if (!source || !rewrite) return false;
  if (canonicalize(source) === canonicalize(rewrite)) return false;
  if (startsWithWeakVerb(rewrite)) return false;
  if (shallowSwapOnly(source, rewrite)) return false;
  if (hasUnsupportedNumber(source, rewrite)) return false;
  if (hasUnsupportedTerms(rewrite, supportedTermSet)) return false;
  if (losesRoleSpecificDetail(source, rewrite, roleProfile)) return false;
  if (moreGenericThanSource(source, rewrite, roleProfile)) return false;
  if (FAKE_IMPACT_RE.test(rewrite) && !FAKE_IMPACT_RE.test(source)) return false;
  if (CORPORATE_FLUFF_RE.test(rewrite) && !CORPORATE_FLUFF_RE.test(source)) return false;
  if (/\b(contributed to|assisted with|supported|participated in|involved in|helped with|worked on)\b/i.test(rewrite)) return false;
  if (languageLabel === "English" && rewrite.length > 260) return false;

  const dims = rewriteImprovementDimensions(source, rewrite, roleProfile);
  if (dims.length < 2) return false;
  if (!explanation) return false;
  if (countWords(explanation) < 3) return false;
  return true;
}

function mapWhyText(before = "", after = "", roleProfile, languageLabel = "English") {
  const dims = rewriteImprovementDimensions(before, after, roleProfile);
  const map = {
    clarity: languageLabel === "Turkish" ? "İfadeyi daha net hale getiriyor" : "Makes the line clearer",
    specificity: languageLabel === "Turkish" ? "Görevi daha somut gösteriyor" : "Adds more concrete task detail",
    action_strength: languageLabel === "Turkish" ? "Daha güçlü ve doğrudan aksiyon dili kullanıyor" : "Uses stronger, more direct action language",
    scope: languageLabel === "Turkish" ? "Kapsamı daha iyi çerçeveliyor" : "Frames the scope more clearly",
    business_context: languageLabel === "Turkish" ? "İş ve süreç bağlamını güçlendiriyor" : "Adds better process or business context",
    recruiter_readability: languageLabel === "Turkish" ? "Recruiter için daha okunur hale getiriyor" : "Reads more cleanly for recruiters",
  };
  const parts = dims.slice(0, 2).map((dim) => map[dim]).filter(Boolean);
  if (!parts.length) {
    return languageLabel === "Turkish"
      ? "İfadeyi daha net ve profesyonel hale getiriyor"
      : "Makes the line sharper and more recruiter-ready";
  }
  return parts.join(languageLabel === "Turkish" ? " ve " : " and ");
}

function preferredRewriteVerb(source = "", roleProfile) {
  const text = canonicalize(source);
  if (/ticket|case|issue|escalat|follow up|follow-up/.test(text)) return "Coordinated";
  if (/email|live chat|customer|service request|inquiry/.test(text)) return "Responded to";
  if (/report|dashboard|summary/.test(text)) return "Prepared";
  if (/record|documentation|file|log|note/.test(text)) return "Maintained";
  if (/schedule|calendar|meeting|travel/.test(text)) return "Coordinated";
  if (/invoice|order|request|processing|account/.test(text)) return "Processed";
  if (/analysis|audit|review|reconciliation|validation/.test(text)) return "Reviewed";
  if (/test|bug|defect|qa/.test(text)) return "Executed";
  if (/design|wireframe|prototype|visual/.test(text)) return "Designed";
  if (/lesson|classroom|student|curriculum/.test(text)) return "Delivered";
  if (/patient|appointment|medical record|insurance/.test(text)) return "Coordinated";
  if (/code|api|backend|frontend|database|feature|deployment/.test(text)) return "Implemented";
  const pack = ROLE_FAMILIES[roleProfile?.primary] || ROLE_FAMILIES.generic;
  const preferred = safeArray(pack.keywords)[0];
  if (/software|engineer|developer/.test(canonicalize(preferred))) return "Implemented";
  return "Coordinated";
}

function buildLocalRewriteEnglish(source = "", roleProfile) {
  const sentence = String(source || "").trim();
  if (!sentence) return "";
  const { body, end } = sentenceEndParts(sentence);
  let remainder = body;

  const patterns = [
    [/^helped with\s+/i, true],
    [/^assisted with\s+/i, true],
    [/^assisted\s+/i, true],
    [/^supported\s+/i, true],
    [/^worked on\s+/i, true],
    [/^participated in\s+/i, true],
    [/^contributed to\s+/i, true],
    [/^involved in\s+/i, true],
    [/^responsible for\s+/i, true],
    [/^handled\s+/i, true],
    [/^provided support for\s+/i, true],
    [/^took part in\s+/i, true],
  ];

  let matched = false;
  for (const [re] of patterns) {
    if (re.test(remainder)) {
      remainder = remainder.replace(re, "").trim();
      matched = true;
      break;
    }
  }

  if (!matched) return "";
  remainder = remainder
    .replace(/\bthe team\b/gi, "team operations")
    .replace(/\bdaily tasks\b/gi, "day-to-day workflows")
    .replace(/\broutine tasks\b/gi, "routine workflows")
    .replace(/\bvarious tasks\b/gi, "assigned workflows")
    .replace(/\brelated to\b/gi, "for")
    .replace(/\s+/g, " ")
    .trim();

  if (!remainder || countWords(remainder) < 2) return "";

  const verb = preferredRewriteVerb(sentence, roleProfile);
  let rewrite = `${verb} ${lowerFirst(remainder)}`.replace(/\s+/g, " ").trim();

  if (!/\b(with|for|across|using|through|via|within|regarding|including)\b/i.test(rewrite)) {
    if (/customer|client|ticket|case|issue|request|report|document|record|schedule|invoice|order|campaign|dashboard|data|feature|testing|lesson|student|patient|appointment/.test(canonicalize(rewrite))) {
      rewrite = rewrite.replace(/\s+$/, "");
    }
  }

  if (startsWithWeakVerb(rewrite)) return "";
  if (shallowSwapOnly(sentence, rewrite)) return "";
  return `${rewrite}${end}`;
}

function buildLocalExperienceFixes(candidates = [], roleProfile, languageLabel = "English", maxItems = 5) {
  if (languageLabel !== "English") return [];
  const out = [];
  for (const source of safeArray(candidates)) {
    const after = buildLocalRewriteEnglish(source, roleProfile);
    if (!after) continue;
    out.push({
      before: source,
      after,
      why: mapWhyText(source, after, roleProfile, languageLabel),
    });
    if (out.length >= maxItems) break;
  }
  return out;
}

function safeJsonParse(text = "") {
  try {
    return JSON.parse(text);
  } catch {
    const str = String(text || "");
    const start = str.indexOf("{");
    const end = str.lastIndexOf("}");
    if (start !== -1 && end !== -1 && end > start) {
      return JSON.parse(str.slice(start, end + 1));
    }
    throw new Error("Model did not return valid JSON");
  }
}

function extractModelContent(parsed) {
  const content = parsed?.choices?.[0]?.message?.content;
  if (typeof content === "string") return content;
  if (Array.isArray(content)) {
    return content
      .map((part) => {
        if (typeof part === "string") return part;
        if (typeof part?.text === "string") return part.text;
        return "";
      })
      .join("")
      .trim();
  }
  return "";
}

function isGpt5(model = "") {
  return /^gpt-5/i.test(String(model || "").trim());
}

function buildOpenAIPayload({ model, messages, maxOutputTokens = 2200, reasoningEffort = null, temperature = null }) {
  const payload = {
    model,
    response_format: { type: "json_object" },
    messages,
  };
  if (isGpt5(model)) {
    payload.max_completion_tokens = maxOutputTokens;
    if (reasoningEffort) payload.reasoning_effort = reasoningEffort;
    if (reasoningEffort === "none" && typeof temperature === "number") payload.temperature = temperature;
  } else {
    payload.max_tokens = maxOutputTokens;
    if (typeof temperature === "number") payload.temperature = temperature;
  }
  return payload;
}

async function fetchWithTimeout(url, options, timeoutMs = 60000) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { ...options, signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
}

async function callOpenAIJson({ apiKey, model, system, userPrompt, pass = "main", preview = false, maxOutputTokens = 2400 }) {
  const attempts = isGpt5(model)
    ? pass === "repair"
      ? [
          { reasoningEffort: "low", temperature: null, maxOutputTokens: Math.max(2200, maxOutputTokens) },
          { reasoningEffort: "none", temperature: 0.2, maxOutputTokens: Math.max(2600, maxOutputTokens) },
        ]
      : [
          { reasoningEffort: preview ? "none" : "low", temperature: preview ? 0.2 : null, maxOutputTokens },
          { reasoningEffort: "none", temperature: 0.2, maxOutputTokens: Math.max(maxOutputTokens, 2600) },
        ]
    : [
        { reasoningEffort: null, temperature: preview ? 0.2 : 0.25, maxOutputTokens },
        { reasoningEffort: null, temperature: 0.2, maxOutputTokens: Math.max(maxOutputTokens, 2600) },
      ];

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
              maxOutputTokens: attempt.maxOutputTokens,
              reasoningEffort: attempt.reasoningEffort,
              temperature: attempt.temperature,
            })
          ),
        },
        pass === "repair" ? 70000 : 65000
      );

      const raw = await response.text();
      if (!response.ok) {
        const err = new Error("OpenAI error");
        err.status = response.status;
        err.details = raw.slice(0, 3000);
        throw err;
      }

      const parsed = JSON.parse(raw);
      const content = extractModelContent(parsed);
      if (!content) {
        const err = new Error("Model returned empty content");
        err.status = 502;
        throw err;
      }

      const data = safeJsonParse(content);
      if (!data || typeof data !== "object" || Array.isArray(data)) {
        const err = new Error("Model did not return a JSON object");
        err.status = 502;
        throw err;
      }
      return data;
    } catch (err) {
      if (err?.name === "AbortError") {
        lastError = new Error("OpenAI request timed out");
        lastError.status = 504;
      } else {
        lastError = err;
      }
      if (lastError?.status && lastError.status >= 400 && lastError.status < 500 && lastError.status !== 429) {
        throw lastError;
      }
    }
  }

  const error = new Error(lastError?.message || "Unable to generate LinkedIn optimization output");
  error.status = lastError?.status || 500;
  error.details = lastError?.details || String(lastError || "Unknown error");
  throw error;
}

function toneInstruction(tone = DEFAULT_TONE) {
  if (tone === "bold") {
    return "Use the strongest positioning that still feels truthful, premium, and recruiter-safe. Avoid exaggeration.";
  }
  if (tone === "confident") {
    return "Use confident, polished positioning with sharper phrasing, while staying factual and natural.";
  }
  return "Use clean, recruiter-safe, professional positioning with grounded language.";
}

function buildSystemPrompt(languageLabel = "English") {
  return `
You are an elite LinkedIn profile optimization writer and recruiter-facing profile strategist.

CORE RULES:
- Return ONLY valid JSON.
- All output values must be written only in ${languageLabel}.
- Never invent metrics, percentages, KPIs, budgets, revenue, team size, results, clients, leadership ownership, tools, certifications, platforms, or business impact.
- Use only facts that are explicitly present in the resume/CV and optional target role/job description metadata.
- Keep profession-specific language native to the actual role family.
- Technical profiles must stay technical.
- Finance profiles must stay finance-specific.
- HR profiles must stay HR-specific.
- Marketing profiles must stay tool/channel aware.
- Support profiles must stay service-oriented.
- Avoid corporate fluff, motivational language, cringe self-branding, and fake impact phrasing.
- Headlines must be natural, recruiter-friendly, and search-aware.
- About sections must sound premium, natural, and LinkedIn-ready.
- Experience fixes must materially improve weak lines. Reject shallow synonym swaps.
- Do not use weak rewrites such as supported -> assisted, helped -> contributed, worked on -> participated in.
- If a bullet is support-level work, keep it truthful and support-level.
- Do not invent leadership, strategy, or measurable outcomes.
- Boolean search output must be realistic, readable, and useful.
`.trim();
}

function buildRoleContextText({ roleProfile, targetRole = "", industry = "", seniority = "mid", location = "", tone = DEFAULT_TONE, cv = "", jd = "" }) {
  const titles = getRoleTitles(roleProfile, targetRole).join(", ") || "(none)";
  const terms = uniqueByNormalized([...safeArray(roleProfile?.detectedTerms), ...extractExplicitTerms(cv), ...extractExplicitTerms(jd)]).slice(0, 16).join(", ") || "(none)";
  return [
    `- inferred_primary_role: ${roleProfile?.primary || "generic"}`,
    `- inferred_role_label: ${roleProfile?.label || "Professional"}`,
    `- candidate_titles: ${titles}`,
    `- seniority_signal: ${seniority}`,
    `- target_role: ${targetRole || "(not provided)"}`,
    `- industry: ${industry || "(not provided)"}`,
    `- location: ${location || "(not provided)"}`,
    `- tone: ${tone}`,
    `- detected_terms: ${terms}`,
  ].join("\n");
}

function buildMainPrompt({ cv, jd, targetRole, seniority, industry, location, tone, preview, languageLabel, roleProfile, weakCandidates }) {
  const roleContext = buildRoleContextText({ roleProfile, targetRole, seniority, industry, location, tone, cv, jd });
  const weakList = safeArray(weakCandidates)
    .slice(0, 10)
    .map((item, idx) => `${idx + 1}. ${item}`)
    .join("\n") || "(none)";

  if (preview) {
    return `
Return JSON in this exact schema:
{
  "headlines": [{"label": string, "text": string}],
  "about": {"short": string, "normal": string, "bold": string},
  "experience_fix": [{"before": string, "after": string, "why": string}],
  "skills": {"top": string[], "tools": string[], "industry": string[]},
  "recruiter": {"keywords": string[], "boolean": string}
}

TASK:
Generate a limited LinkedIn optimization preview.

PREVIEW RULES:
- headlines: return exactly 1 strong option.
- about.short: return 1 compact version.
- about.normal and about.bold: return empty strings.
- experience_fix: return 1-2 items max.
- skills.top: 5-8 items.
- skills.tools: 3-5 items.
- skills.industry: 3-5 items.
- recruiter.keywords: 4-6 items.
- recruiter.boolean: may be shorter, but still useful.

QUALITY RULES:
- ${toneInstruction(tone)}
- Keep wording premium, concise, recruiter-friendly, and truthful.
- Experience fixes must be materially better than the source.
- Do not return shallow rewrites or fake positioning.
- Use the weak candidate list as a priority source for before/after fixes, but only if the rewrite is genuinely strong.

ROLE CONTEXT:
${roleContext}

PRIORITY WEAK EXPERIENCE CANDIDATES:
${weakList}

RESUME / CV:
${cv}

TARGET ROLE / JD:
${jd || targetRole || "(none)"}
`.trim();
  }

  return `
Return JSON in this exact schema:
{
  "headlines": [{"label": string, "text": string}],
  "about": {"short": string, "normal": string, "bold": string},
  "experience_fix": [{"before": string, "after": string, "why": string}],
  "skills": {"top": string[], "tools": string[], "industry": string[]},
  "recruiter": {"keywords": string[], "boolean": string}
}

TASK:
Generate full LinkedIn optimization output from the resume/CV and targeting context.

FULL OUTPUT RULES:
- headlines: return exactly 5 clearly distinct headline options using labels Search, Impact, Niche, Leadership, Clean.
- about.short: 500-850 characters.
- about.normal: 850-1400 characters.
- about.bold: 850-1400 characters.
- experience_fix: return 4-6 items when enough real opportunities exist; otherwise return fewer naturally.
- skills.top: 10-16 items.
- skills.tools: 6-14 items.
- skills.industry: 8-16 items.
- recruiter.keywords: 8-16 items.
- recruiter.boolean: one realistic recruiter search string.

QUALITY RULES:
- ${toneInstruction(tone)}
- Headline options must feel premium, recruiter-ready, and search-aware.
- About sections must read like strong US LinkedIn writing, not marketing copy.
- Experience fixes must materially improve clarity, specificity, action strength, scope, business/process context, or recruiter readability.
- Reject cosmetic edits and one-word swaps.
- If the source is support-level work, keep it truthful and support-level.
- Do not fabricate results, leadership, or scale.
- Keep role-specific terminology intact.
- Use the weak candidate list as a priority source for before/after fixes, but only when the after version is genuinely stronger.

ROLE CONTEXT:
${roleContext}

PRIORITY WEAK EXPERIENCE CANDIDATES:
${weakList}

RESUME / CV:
${cv}

TARGET ROLE / JD:
${jd || targetRole || "(none)"}
`.trim();
}

function buildRepairPrompt({ currentOutput, issues, cv, jd, targetRole, seniority, industry, location, tone, languageLabel, roleProfile, weakCandidates }) {
  const roleContext = buildRoleContextText({ roleProfile, targetRole, seniority, industry, location, tone, cv, jd });
  const weakList = safeArray(weakCandidates)
    .slice(0, 10)
    .map((item, idx) => `${idx + 1}. ${item}`)
    .join("\n") || "(none)";

  return `
Return JSON in this exact schema:
{
  "headlines": [{"label": string, "text": string}],
  "about": {"short": string, "normal": string, "bold": string},
  "experience_fix": [{"before": string, "after": string, "why": string}],
  "skills": {"top": string[], "tools": string[], "industry": string[]},
  "recruiter": {"keywords": string[], "boolean": string}
}

TASK:
Repair the LinkedIn optimization output so it becomes clean, premium, truthful, and recruiter-ready.

ISSUES TO FIX:
${issues.map((issue, idx) => `${idx + 1}. ${issue}`).join("\n")}

HARD RULES:
- Keep all output values in ${languageLabel}.
- Do not invent metrics, tools, outcomes, certifications, leadership ownership, or business impact.
- Preserve profession-specific terminology.
- Replace weak, generic, or shallow experience rewrites with materially stronger ones.
- Remove fluffy or fake headline/about wording.
- Keep Boolean output realistic and readable.

ROLE CONTEXT:
${roleContext}

PRIORITY WEAK EXPERIENCE CANDIDATES:
${weakList}

CURRENT OUTPUT TO REPAIR:
${JSON.stringify(currentOutput)}

RESUME / CV:
${cv}

TARGET ROLE / JD:
${jd || targetRole || "(none)"}
`.trim();
}

function normalizeLabel(label = "", index = 0, preview = false) {
  const cleaned = String(label || "").trim();
  if (preview) return "Search";
  if (LINKEDIN_LABELS.includes(cleaned)) return cleaned;
  return LINKEDIN_LABELS[index] || LINKEDIN_LABELS[LINKEDIN_LABELS.length - 1];
}

function buildFallbackHeadlines({ roleProfile, targetRole = "", seniority = "mid", industry = "", location = "", preview = false }) {
  const pack = ROLE_FAMILIES[roleProfile?.primary] || ROLE_FAMILIES.generic;
  const roleTitle = targetRole || safeArray(pack.titles)[0] || roleProfile?.label || "Professional";
  const keyTerms = uniqueByNormalized([...safeArray(pack.tools), ...safeArray(pack.keywords), ...safeArray(pack.industry)]).slice(0, 6);
  const coreA = keyTerms.slice(0, 2).join(" | ");
  const coreB = keyTerms.slice(2, 4).join(" | ");
  const coreC = keyTerms.slice(4, 6).join(" | ");
  const seniorityText = seniority && seniority !== "mid" ? upperFirst(seniority) : "";
  const locationText = location ? ` | ${location}` : "";
  const industryText = industry ? ` | ${industry}` : "";

  const items = [
    { label: "Search", text: `${seniorityText ? `${seniorityText} ` : ""}${upperFirst(roleTitle)}${coreA ? ` | ${coreA}` : ""}`.trim() },
    { label: "Impact", text: `${upperFirst(roleTitle)}${coreB ? ` | ${coreB}` : ""}${industryText}`.trim() },
    { label: "Niche", text: `${upperFirst(roleTitle)}${coreC ? ` | ${coreC}` : coreA ? ` | ${coreA}` : ""}`.trim() },
    { label: "Leadership", text: `${upperFirst(roleTitle)} | ${seniority === "lead" || seniority === "manager" || seniority === "director" || seniority === "executive" ? "Team Collaboration" : "Cross-Functional Delivery"}${industryText}`.trim() },
    { label: "Clean", text: `${upperFirst(roleTitle)}${industryText}${locationText}${coreA ? ` | ${coreA}` : ""}`.trim() },
  ];

  return preview ? items.slice(0, 1) : items;
}

function normalizeHeadlines(rawHeadlines, context) {
  const items = safeArray(rawHeadlines)
    .map((item) => ({
      label: normalizeLabel(item?.label, 0, context.preview),
      text: clampText(item?.text, 220),
    }))
    .filter((item) => item.text)
    .map((item, idx) => ({ ...item, label: normalizeLabel(item.label, idx, context.preview) }));

  const deduped = [];
  const seenText = new Set();
  const seenLabel = new Set();
  for (const item of items) {
    const textKey = canonicalize(item.text);
    if (!textKey || seenText.has(textKey)) continue;
    if (!context.preview && seenLabel.has(item.label)) continue;
    seenText.add(textKey);
    seenLabel.add(item.label);
    deduped.push(item);
  }

  const needed = context.preview ? 1 : 5;
  const fallback = buildFallbackHeadlines(context);
  for (const item of fallback) {
    if (deduped.length >= needed) break;
    const key = canonicalize(item.text);
    if (seenText.has(key)) continue;
    if (!context.preview && seenLabel.has(item.label)) continue;
    seenText.add(key);
    seenLabel.add(item.label);
    deduped.push(item);
  }

  return deduped.slice(0, needed);
}

function buildFallbackAbout({ roleProfile, targetRole = "", seniority = "mid", tone = DEFAULT_TONE, cv = "", languageLabel = "English" }) {
  const roleTitle = targetRole || safeArray((ROLE_FAMILIES[roleProfile?.primary] || ROLE_FAMILIES.generic).titles)[0] || roleProfile?.label || "professional";
  const terms = uniqueByNormalized([...safeArray(roleProfile?.detectedTerms), ...extractExplicitTerms(cv)]).slice(0, 8);
  const themeA = terms.slice(0, 3).join(", ");
  const themeB = terms.slice(3, 6).join(", ");
  const summaryLine = extractSummaryLines(cv)[0] || "";
  if (languageLabel === "Turkish") {
    const base = `Ben ${roleTitle} odağında çalışan bir profesyonelim. Deneyimim ${themeA || "iş süreçleri, koordinasyon ve iş takibi"} alanlarında şekilleniyor. ${summaryLine ? `${truncate(summaryLine, 180)} ` : ""}Çalışma tarzım net iletişim, düzenli takip ve role uygun profesyonel dil üzerine kuruludur.`;
    const normal = `${base} Özgeçmişimde yer alan deneyimleri LinkedIn için daha güçlü, daha net ve recruiter dostu bir dille sunmayı hedefliyorum. ${themeB ? `Öne çıkan çalışma alanlarım arasında ${themeB} bulunuyor. ` : ""}${tone === "bold" ? "Profil metninde daha güçlü bir konumlandırma tercih ederim, ancak bunu her zaman gerçek deneyim çerçevesinde yaparım." : tone === "confident" ? "Profil metninde daha kendinden emin bir ton kullanırım, ancak gerçek kapsamın dışına çıkmam." : "Profil metninde temiz, güvenilir ve profesyonel bir anlatım tercih ederim."}`;
    const bold = `${normal} LinkedIn tarafında amacım; deneyimi abartmadan, güçlü yönleri daha net, daha seçici ve recruiter açısından daha okunur bir yapıda göstermektir.`;
    return { short: truncate(base, 850), normal: truncate(normal, 1400), bold: truncate(bold, 1400) };
  }

  const intro = `I am a ${seniority !== "mid" ? `${seniority} ` : ""}${roleTitle} focused on ${themeA || "clear execution, structured communication, and role-relevant delivery"}.`;
  const toneLine =
    tone === "bold"
      ? "I position my work with stronger emphasis, but I keep the language factual and grounded."
      : tone === "confident"
      ? "I use confident positioning while keeping the language professional and fully truthful."
      : "I use clean, recruiter-safe language that reflects the real scope of my work.";
  const summaryPart = summaryLine ? `${truncate(summaryLine, 180)} ` : "";
  const short = `${intro} ${summaryPart}${themeB ? `My background also includes ${themeB}. ` : ""}${toneLine}`.replace(/\s+/g, " ").trim();
  const normal = `${short} On LinkedIn, I aim to present experience in a way that is clear, role-aware, and easy for recruiters to understand at a glance. I focus on strong wording, practical context, and professional positioning without exaggerating ownership, results, or scale.`;
  const bold = `${normal} The goal is not to sound louder than the work itself, but to express the work with sharper structure, better visibility, and stronger recruiter readability.`;
  return {
    short: truncate(short, 850),
    normal: truncate(normal, 1400),
    bold: truncate(bold, 1400),
  };
}

function normalizeAbout(rawAbout, context) {
  const fallback = buildFallbackAbout(context);
  let short = clampText(rawAbout?.short, 900) || fallback.short;
  let normal = clampText(rawAbout?.normal, 1500) || (context.preview ? "" : fallback.normal);
  let bold = clampText(rawAbout?.bold, 1500) || (context.preview ? "" : fallback.bold);

  if (CORPORATE_FLUFF_RE.test(short)) short = fallback.short;
  if (!context.preview) {
    if (CORPORATE_FLUFF_RE.test(normal)) normal = fallback.normal;
    if (CORPORATE_FLUFF_RE.test(bold)) bold = fallback.bold;
  } else {
    normal = "";
    bold = "";
  }

  return {
    short,
    normal,
    bold,
  };
}

function findClosestSourceLine(line = "", sourceLines = []) {
  const target = canonicalize(line);
  if (!target) return "";
  for (const source of safeArray(sourceLines)) {
    if (canonicalize(source) === target) return source;
  }
  let best = "";
  let bestScore = 0;
  for (const source of safeArray(sourceLines)) {
    const score = jaccardSimilarity(source, line);
    if (score > bestScore) {
      bestScore = score;
      best = source;
    }
  }
  return bestScore >= 0.7 ? best : "";
}

function normalizeExperienceFixes(rawFixes, context) {
  const sourceLines = uniqueByNormalized([...extractWeakCandidates(context.cv, context.roleProfile), ...extractBulletLines(context.cv)]);
  const out = [];
  const seen = new Set();

  for (const item of safeArray(rawFixes)) {
    const candidateBefore = clampText(item?.before, 280);
    const before = findClosestSourceLine(candidateBefore, sourceLines) || candidateBefore;
    const after = clampText(item?.after, 280);
    const why = clampText(item?.why, 160);
    const key = `${canonicalize(before)}__${canonicalize(after)}`;
    if (!before || !after || seen.has(key)) continue;
    const entry = { before, after, why: why || mapWhyText(before, after, context.roleProfile, context.languageLabel) };
    if (!isValidExperienceRewrite({ ...entry, roleProfile: context.roleProfile, supportedTermSet: context.supportedTermSet, languageLabel: context.languageLabel })) {
      continue;
    }
    seen.add(key);
    out.push(entry);
  }

  const desiredMin = context.preview ? 1 : Math.min(6, Math.max(4, context.weakCandidates.length >= 4 ? 4 : context.weakCandidates.length));
  if (out.length < desiredMin) {
    const local = buildLocalExperienceFixes(context.weakCandidates, context.roleProfile, context.languageLabel, context.preview ? 2 : 5);
    for (const item of local) {
      const key = `${canonicalize(item.before)}__${canonicalize(item.after)}`;
      if (seen.has(key)) continue;
      if (!isValidExperienceRewrite({ ...item, roleProfile: context.roleProfile, supportedTermSet: context.supportedTermSet, languageLabel: context.languageLabel })) continue;
      seen.add(key);
      out.push(item);
      if (out.length >= (context.preview ? 2 : 6)) break;
    }
  }

  return out.slice(0, context.preview ? 2 : 6);
}

function classifyTerm(term = "", roleProfile) {
  const norm = canonicalize(term);
  if (!norm) return "top";
  if (ALL_TOOL_TERMS.some((item) => canonicalize(item) === norm)) return "tools";
  const pack = ROLE_FAMILIES[roleProfile?.primary] || ROLE_FAMILIES.generic;
  if (safeArray(pack.industry).some((item) => canonicalize(item) === norm)) return "industry";
  return "top";
}

function buildFallbackSkills(context) {
  const pack = ROLE_FAMILIES[context.roleProfile?.primary] || ROLE_FAMILIES.generic;
  const detected = uniqueByNormalized([...extractExplicitTerms(context.cv), ...safeArray(context.roleProfile?.detectedTerms)]);
  const tools = uniqueByNormalized([...detected.filter((term) => ALL_TOOL_TERMS.some((item) => canonicalize(item) === canonicalize(term))), ...safeArray(pack.tools)]).slice(0, context.preview ? 5 : 12);
  const industry = uniqueByNormalized([...detected.filter((term) => safeArray(pack.industry).some((item) => canonicalize(item) === canonicalize(term))), ...safeArray(pack.industry)]).slice(0, context.preview ? 5 : 12);
  const top = uniqueByNormalized([...detected.filter((term) => !tools.some((item) => canonicalize(item) === canonicalize(term))), ...safeArray(pack.keywords), ...industry]).slice(0, context.preview ? 8 : 14);
  return { top, tools, industry };
}

function normalizeSkillList(list = [], category, context, maxItems) {
  const out = [];
  const seen = new Set();
  const rolePack = ROLE_FAMILIES[context.roleProfile?.primary] || ROLE_FAMILIES.generic;
  const rolePool = uniqueByNormalized([...safeArray(rolePack.keywords), ...safeArray(rolePack.tools), ...safeArray(rolePack.industry), ...safeArray(context.roleProfile?.detectedTerms)]);

  for (const item of safeArray(list)) {
    const value = clampText(item, 80);
    const key = canonicalize(value);
    if (!value || !key || seen.has(key)) continue;
    if (FILLER_RE.test(value)) continue;
    if (category === "tools" && !ALL_TOOL_TERMS.some((term) => canonicalize(term) === key) && !context.supportedTermSet.has(key)) continue;
    if (category === "industry" && !rolePool.some((term) => canonicalize(term) === key) && !containsTerm(context.cv + "\n" + context.jd, value)) continue;
    if (!context.supportedTermSet.has(key) && !rolePool.some((term) => canonicalize(term) === key)) continue;
    seen.add(key);
    out.push(value);
    if (out.length >= maxItems) break;
  }

  return out;
}

function normalizeSkills(rawSkills, context) {
  const fallback = buildFallbackSkills(context);
  const top = normalizeSkillList(rawSkills?.top, "top", context, context.preview ? 8 : 16);
  const tools = normalizeSkillList(rawSkills?.tools, "tools", context, context.preview ? 5 : 14);
  const industry = normalizeSkillList(rawSkills?.industry, "industry", context, context.preview ? 5 : 16);

  return {
    top: uniqueByNormalized([...top, ...fallback.top]).slice(0, context.preview ? 8 : 16),
    tools: uniqueByNormalized([...tools, ...fallback.tools]).slice(0, context.preview ? 5 : 14),
    industry: uniqueByNormalized([...industry, ...fallback.industry]).slice(0, context.preview ? 5 : 16),
  };
}

function buildBooleanString({ titles = [], terms = [], tools = [], location = "" }) {
  const cleanTitles = uniqueByNormalized(titles).slice(0, 4).map((item) => `"${item}"`);
  const cleanTerms = uniqueByNormalized(terms).slice(0, 5).map((item) => (item.includes(" ") ? `"${item}"` : item));
  const cleanTools = uniqueByNormalized(tools).slice(0, 4).map((item) => (item.includes(" ") ? `"${item}"` : item));
  const groups = [];
  if (cleanTitles.length) groups.push(`(${cleanTitles.join(" OR ")})`);
  if (cleanTerms.length) groups.push(`(${cleanTerms.join(" OR ")})`);
  if (cleanTools.length) groups.push(`(${cleanTools.join(" OR ")})`);
  let booleanText = groups.join(" AND ");
  if (location) {
    booleanText += booleanText ? ` AND ("${location}")` : `("${location}")`;
  }
  return clampText(booleanText, 320);
}

function normalizeRecruiter(rawRecruiter, context, skills, headlines) {
  const pack = ROLE_FAMILIES[context.roleProfile?.primary] || ROLE_FAMILIES.generic;
  const headlineTerms = headlines.flatMap((item) => tokenize(item.text)).slice(0, 8);
  const roleTerms = uniqueByNormalized([...safeArray(pack.titles), ...safeArray(pack.keywords), ...safeArray(pack.industry), ...skills.top, ...skills.tools, ...skills.industry, ...headlineTerms]);
  const keywords = uniqueByNormalized([
    ...normalizeSkillList(rawRecruiter?.keywords, "top", context, context.preview ? 6 : 16),
    ...roleTerms,
  ]).slice(0, context.preview ? 6 : 16);

  let booleanText = clampText(rawRecruiter?.boolean, 360);
  if (!booleanText || booleanText.length < 20 || /best-in-class|synergy|visionary/i.test(booleanText)) {
    booleanText = buildBooleanString({
      titles: getRoleTitles(context.roleProfile, context.targetRole),
      terms: keywords.slice(0, 6),
      tools: skills.tools.slice(0, 4),
      location: context.location,
    });
  }

  return { keywords, boolean: booleanText };
}

function detectOutputIssues(output, context) {
  const issues = [];
  if (!safeArray(output.headlines).length) issues.push("No usable headlines were generated.");
  if (!context.preview && safeArray(output.headlines).length < 5) issues.push("Fewer than 5 distinct headline options were generated.");
  if (!output.about?.short) issues.push("The short About section is missing.");
  if (!context.preview && (!output.about?.normal || !output.about?.bold)) issues.push("The full About section set is incomplete.");
  if (!safeArray(output.experience_fix).length && context.weakCandidates.length >= 2) issues.push("Experience fix output is missing despite clear rewrite opportunities.");
  if (safeArray(output.experience_fix).some((item) => shallowSwapOnly(item.before, item.after))) issues.push("At least one experience fix is too similar to its source.");
  if (safeArray(output.experience_fix).some((item) => hasUnsupportedTerms(item.after, context.supportedTermSet))) issues.push("At least one experience fix introduces unsupported terminology.");
  if (safeArray(output.experience_fix).some((item) => startsWithWeakVerb(item.after))) issues.push("At least one experience fix still starts with a weak support verb.");
  if (!safeArray(output.skills?.top).length) issues.push("Top skills output is too thin.");
  if (!safeArray(output.recruiter?.keywords).length) issues.push("Recruiter keywords are missing.");
  if (!output.recruiter?.boolean || output.recruiter.boolean.length < 20) issues.push("Boolean search output is too weak or missing.");
  if (safeArray(output.headlines).some((item) => CORPORATE_FLUFF_RE.test(item.text))) issues.push("Headline wording is too fluffy or artificial.");
  if (CORPORATE_FLUFF_RE.test(output.about?.short || "") || CORPORATE_FLUFF_RE.test(output.about?.normal || "") || CORPORATE_FLUFF_RE.test(output.about?.bold || "")) {
    issues.push("About text contains corporate fluff or fake positioning.");
  }
  return issues;
}

function normalizeModelOutput(raw, context) {
  const headlines = normalizeHeadlines(raw?.headlines, context);
  const about = normalizeAbout(raw?.about || {}, context);
  const experience_fix = normalizeExperienceFixes(raw?.experience_fix, context);
  const skills = normalizeSkills(raw?.skills || {}, context);
  const recruiter = normalizeRecruiter(raw?.recruiter || {}, context, skills, headlines);
  return { headlines, about, experience_fix, skills, recruiter };
}

function buildContext({ cv, jd, preview, languageLabel, roleProfile, targetRole, seniority, industry, location, tone }) {
  const supportedTermSet = buildSupportedTermSet({ cv, jd, targetRole, industry });
  const weakCandidates = extractWeakCandidates(cv, roleProfile);
  return {
    cv,
    jd,
    preview,
    languageLabel,
    roleProfile,
    targetRole,
    seniority,
    industry,
    location,
    tone,
    supportedTermSet,
    weakCandidates,
  };
}

function buildFinalResponse(normalized, preview) {
  if (!preview) return normalized;
  return {
    headlines: normalized.headlines.slice(0, 1),
    about: {
      short: normalized.about.short,
      normal: "",
      bold: "",
    },
    experience_fix: normalized.experience_fix.slice(0, 2),
    skills: {
      top: normalized.skills.top.slice(0, 8),
      tools: normalized.skills.tools.slice(0, 5),
      industry: normalized.skills.industry.slice(0, 5),
    },
    recruiter: {
      keywords: normalized.recruiter.keywords.slice(0, 6),
      boolean: truncate(normalized.recruiter.boolean, 220),
    },
  };
}

export default async function handler(req, res) {
  try {
    if (req.method !== "POST") {
      return res.status(405).json({ error: "POST required" });
    }

    const body = req.body && typeof req.body === "object" ? req.body : {};
    const cv = cleanInputText(body.cv, MAX_CV_CHARS);
    const jd = cleanInputText(body.jd, MAX_JD_CHARS);
    const preview = !!body.preview;
    const mode = String(body.mode || "linkedin").trim().toLowerCase() || "linkedin";
    const language = normalizeLanguage(body.lang);
    const meta = body.linkedin_meta && typeof body.linkedin_meta === "object" ? body.linkedin_meta : {};
    const targetRole = cleanInputText(meta.target_role, MAX_TARGET_ROLE_CHARS);
    const seniority = normalizeSeniority(meta.seniority);
    const industry = cleanInputText(meta.industry, MAX_INDUSTRY_CHARS);
    const location = cleanInputText(meta.location, MAX_LOCATION_CHARS);
    const tone = normalizeTone(String(meta.tone || "").slice(0, MAX_TONE_CHARS));

    if (!cv) {
      return res.status(400).json({ error: "cv is required" });
    }

    if (mode !== "linkedin") {
      return res.status(400).json({ error: "mode must be linkedin" });
    }

    const apiKey = process.env.OPENAI_API_KEY;
    if (!apiKey) {
      return res.status(500).json({ error: "OPENAI_API_KEY is missing on Vercel" });
    }

    const model = process.env.OPENAI_LINKEDIN_MODEL || process.env.OPENAI_MODEL || "gpt-4o-mini";
    const roleProfile = inferRoleProfile({ cv, jd, targetRole, industry, seniority });
    const context = buildContext({
      cv,
      jd,
      preview,
      languageLabel: language.label,
      roleProfile,
      targetRole,
      seniority,
      industry,
      location,
      tone,
    });

    const system = buildSystemPrompt(language.label);
    const mainPrompt = buildMainPrompt({
      cv,
      jd,
      targetRole,
      seniority,
      industry,
      location,
      tone,
      preview,
      languageLabel: language.label,
      roleProfile,
      weakCandidates: context.weakCandidates,
    });

    let raw;
    try {
      raw = await callOpenAIJson({
        apiKey,
        model,
        system,
        userPrompt: mainPrompt,
        pass: "main",
        preview,
        maxOutputTokens: preview ? 1800 : 3400,
      });
    } catch (err) {
      return res.status(err?.status || 500).json({
        error: err?.message || "OpenAI error",
        status: err?.status || 500,
        details: err?.details || String(err),
      });
    }

    let normalized = normalizeModelOutput(raw, context);
    let issues = detectOutputIssues(normalized, context);

    if (issues.length) {
      try {
        const repaired = await callOpenAIJson({
          apiKey,
          model,
          system,
          userPrompt: buildRepairPrompt({
            currentOutput: normalized,
            issues,
            cv,
            jd,
            targetRole,
            seniority,
            industry,
            location,
            tone,
            languageLabel: language.label,
            roleProfile,
            weakCandidates: context.weakCandidates,
          }),
          pass: "repair",
          preview,
          maxOutputTokens: preview ? 2000 : 3600,
        });
        normalized = normalizeModelOutput(repaired, context);
        issues = detectOutputIssues(normalized, context);
      } catch {
        // Keep the normalized main output if repair fails.
      }
    }

    const finalResponse = buildFinalResponse(normalized, preview);
    return res.status(200).json(finalResponse);
  } catch (err) {
    return res.status(500).json({
      error: "Server error",
      details: err?.message || String(err),
    });
  }
}
