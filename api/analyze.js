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
    [
      /continuous integration continuous deployment|continuous integration continuous delivery|ci cd/g,
      "ci/cd",
    ],
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

  return new RegExp(`(?:^|\\s)${escapeRegex(termNorm)}(?:$|\\s)`, "i").test(
    normalizedText
  );
}

function countTermHits(text = "", terms = []) {
  const norm = canonicalizeTerm(text);
  let hits = 0;

  for (const term of uniqueTrimmedStrings(terms)) {
    if (containsCanonicalTermInNormalizedText(norm, term)) hits += 1;
  }

  return hits;
}

function countOccurrencesNormalized(text = "", term = "") {
  const textNorm = canonicalizeTerm(text);
  const termNorm = canonicalizeTerm(term);
  if (!textNorm || !termNorm) return 0;

  if (termNorm.includes(" ")) {
    let idx = 0;
    let count = 0;
    while ((idx = textNorm.indexOf(termNorm, idx)) !== -1) {
      count += 1;
      idx += termNorm.length;
    }
    return count;
  }

  const m = textNorm.match(
    new RegExp(`(?:^|\\s)${escapeRegex(termNorm)}(?:$|\\s)`, "gi")
  );
  return Array.isArray(m) ? m.length : 0;
}

function countWords(str = "") {
  return String(str).trim().split(/\s+/).filter(Boolean).length;
}

function capitalizeFirst(str = "") {
  const s = String(str || "").trim();
  return s ? s.charAt(0).toUpperCase() + s.slice(1) : "";
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
    methodologyTerms: [
      "agile",
      "scrum",
      "kanban",
      "ci/cd",
      "unit testing",
      "integration testing",
      "code review",
      "version control",
    ],
    responsibilityTerms: [
      "feature development",
      "api integration",
      "bug fixing",
      "production support",
      "performance optimization",
      "database design",
      "release deployment",
      "system maintenance",
    ],
    businessContextTerms: [
      "application",
      "system",
      "service",
      "api",
      "database",
      "feature",
      "release",
      "production",
      "codebase",
      "integration",
      "platform",
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
    preferredVerbs: [
      "built",
      "developed",
      "implemented",
      "designed",
      "integrated",
      "tested",
      "debugged",
      "maintained",
      "deployed",
      "optimized",
      "automated",
      "configured",
    ],
    safeSupportVerbs: [
      "maintained",
      "tested",
      "debugged",
      "documented",
      "supported",
      "collaborated with",
      "integrated with",
    ],
    keepRules: [
      "Preserve languages, frameworks, APIs, cloud, database, testing, and deployment context when present.",
      "Keep technical bullets technical; do not rewrite them into generic business coordination language.",
    ],
    avoidRules: [
      "Do not invent architecture ownership, scale, performance gains, cloud migrations, or leadership impact.",
      "Do not replace explicit technical detail with vague product or strategy wording.",
    ],
    styleHints: [
      "Engineering bullets should emphasize implementation scope, technical context, and truthful execution.",
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
    toolTerms: [
      "selenium",
      "cypress",
      "postman",
      "jira",
      "api testing",
      "test automation",
    ],
    methodologyTerms: [
      "regression testing",
      "smoke testing",
      "uat",
      "test automation",
      "manual testing",
      "agile",
      "scrum",
    ],
    responsibilityTerms: [
      "test case creation",
      "defect reporting",
      "test execution",
      "bug verification",
      "quality validation",
    ],
    businessContextTerms: [
      "testing",
      "test case",
      "defect",
      "bug",
      "validation",
      "release",
      "quality",
      "uat",
    ],
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
    preferredVerbs: [
      "tested",
      "validated",
      "documented",
      "reported",
      "tracked",
      "verified",
      "executed",
      "reviewed",
      "automated",
    ],
    safeSupportVerbs: [
      "documented",
      "tracked",
      "verified",
      "executed",
      "reviewed",
      "supported",
    ],
    keepRules: [
      "Preserve testing scope, defect handling, release context, and tools when present.",
    ],
    avoidRules: [
      "Do not invent automation ownership, release quality improvement, or defect reduction results.",
    ],
    styleHints: [
      "QA bullets should sound methodical, evidence-based, and release-aware.",
    ],
  },

  data: {
    titles: [
      "data analyst",
      "business intelligence analyst",
      "bi analyst",
      "reporting analyst",
      "analytics specialist",
      "data specialist",
    ],
    keywords: [
      "data analysis",
      "analytics",
      "dashboard",
      "reporting",
      "kpi",
      "trend analysis",
      "data validation",
      "performance metrics",
    ],
    strongTerms: [
      "sql",
      "python",
      "excel",
      "tableau",
      "power bi",
      "looker studio",
      "dashboard",
      "kpi",
      "data modeling",
      "etl",
      "reporting",
      "analysis",
    ],
    toolTerms: [
      "sql",
      "python",
      "excel",
      "tableau",
      "power bi",
      "looker studio",
      "google sheets",
    ],
    methodologyTerms: [
      "etl",
      "data modeling",
      "trend analysis",
      "kpi tracking",
      "report automation",
      "data validation",
    ],
    responsibilityTerms: [
      "dashboard creation",
      "report generation",
      "trend analysis",
      "performance reporting",
      "data validation",
    ],
    businessContextTerms: [
      "data",
      "analytics",
      "dashboard",
      "reporting",
      "metrics",
      "kpi",
      "insights",
      "trends",
      "performance",
    ],
    suggestedKeywords: [
      "SQL",
      "data visualization",
      "dashboard reporting",
      "trend analysis",
      "KPI tracking",
      "data validation",
      "Power BI",
      "Tableau",
      "report automation",
      "data modeling",
      "ETL",
      "Excel reporting",
    ],
    preferredVerbs: [
      "analyzed",
      "reported",
      "tracked",
      "validated",
      "prepared",
      "reviewed",
      "maintained",
      "documented",
      "modeled",
    ],
    safeSupportVerbs: [
      "reported",
      "tracked",
      "validated",
      "prepared",
      "maintained",
      "documented",
    ],
    keepRules: [
      "Preserve dashboards, reporting cadence, KPIs, tools, and dataset context.",
    ],
    avoidRules: [
      "Do not invent business impact, forecast accuracy gains, or advanced modeling experience.",
    ],
    styleHints: [
      "Data bullets should stay analytical, specific, and tool-aware.",
    ],
  },

  product: {
    titles: [
      "product manager",
      "product owner",
      "associate product manager",
      "technical product manager",
      "product specialist",
    ],
    keywords: [
      "product roadmap",
      "backlog",
      "requirements",
      "user stories",
      "feature planning",
      "stakeholder alignment",
      "product discovery",
      "release planning",
    ],
    strongTerms: [
      "roadmap",
      "backlog",
      "user stories",
      "requirements gathering",
      "acceptance criteria",
      "jira",
      "confluence",
      "agile",
      "scrum",
      "feature prioritization",
      "cross-functional collaboration",
    ],
    toolTerms: ["jira", "confluence", "figma", "analytics"],
    methodologyTerms: [
      "agile",
      "scrum",
      "user stories",
      "backlog prioritization",
      "release planning",
      "product discovery",
    ],
    responsibilityTerms: [
      "requirements definition",
      "feature prioritization",
      "stakeholder communication",
      "roadmap planning",
      "release coordination",
    ],
    businessContextTerms: [
      "product",
      "feature",
      "roadmap",
      "backlog",
      "requirements",
      "stakeholders",
      "release",
      "user stories",
    ],
    suggestedKeywords: [
      "product roadmap",
      "backlog prioritization",
      "requirements gathering",
      "user stories",
      "acceptance criteria",
      "release planning",
      "stakeholder communication",
      "cross-functional collaboration",
      "Agile",
      "Jira",
    ],
    preferredVerbs: [
      "defined",
      "prioritized",
      "coordinated",
      "documented",
      "planned",
      "aligned",
      "reviewed",
      "tracked",
    ],
    safeSupportVerbs: [
      "coordinated",
      "documented",
      "tracked",
      "reviewed",
      "supported",
      "aligned with",
    ],
    keepRules: [
      "Preserve roadmap, backlog, requirements, stakeholder, and release language.",
    ],
    avoidRules: [
      "Do not invent product strategy ownership, revenue outcomes, or market impact.",
    ],
    styleHints: [
      "Product bullets should stay requirements- and delivery-oriented unless leadership is clearly supported.",
    ],
  },

  business_analysis: {
    titles: [
      "business analyst",
      "systems analyst",
      "process analyst",
      "operations analyst",
    ],
    keywords: [
      "business requirements",
      "process analysis",
      "gap analysis",
      "workflow analysis",
      "stakeholder interviews",
      "documentation",
      "reporting",
    ],
    strongTerms: [
      "requirements gathering",
      "process mapping",
      "gap analysis",
      "documentation",
      "stakeholder management",
      "jira",
      "confluence",
      "reporting",
      "excel",
      "sql",
    ],
    toolTerms: ["jira", "confluence", "excel", "sql", "power bi", "visio"],
    methodologyTerms: [
      "requirements gathering",
      "process mapping",
      "gap analysis",
      "workflow analysis",
      "uat",
      "agile",
      "scrum",
    ],
    responsibilityTerms: [
      "requirements documentation",
      "stakeholder communication",
      "process improvement",
      "workflow analysis",
      "test support",
    ],
    businessContextTerms: [
      "requirements",
      "process",
      "stakeholder",
      "workflow",
      "analysis",
      "documentation",
      "reporting",
      "uat",
    ],
    suggestedKeywords: [
      "requirements gathering",
      "process mapping",
      "workflow analysis",
      "gap analysis",
      "stakeholder communication",
      "documentation",
      "UAT support",
      "Jira",
      "Confluence",
      "process improvement",
    ],
    preferredVerbs: [
      "analyzed",
      "documented",
      "mapped",
      "coordinated",
      "reviewed",
      "tracked",
      "supported",
    ],
    safeSupportVerbs: [
      "documented",
      "coordinated",
      "tracked",
      "supported",
      "reviewed",
    ],
    keepRules: [
      "Preserve requirements, workflow, stakeholder, documentation, and analysis context.",
    ],
    avoidRules: [
      "Do not invent transformation leadership or quantified efficiency gains.",
    ],
    styleHints: [
      "Business analysis bullets should sound structured, evidence-based, and process-aware.",
    ],
  },

  finance: {
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
      "expense reporting",
      "forecasting",
      "variance analysis",
      "audit support",
      "ledger",
      "month-end",
    ],
    strongTerms: [
      "financial reporting",
      "reconciliation",
      "accounts payable",
      "accounts receivable",
      "invoice processing",
      "budgeting",
      "forecasting",
      "variance analysis",
      "audit",
      "ledger",
      "excel",
      "ifrs",
      "gaap",
    ],
    toolTerms: ["excel", "sap", "oracle", "quickbooks", "netsuite", "erp"],
    methodologyTerms: [
      "month-end close",
      "reconciliation",
      "variance analysis",
      "budget tracking",
      "forecasting",
      "audit support",
    ],
    responsibilityTerms: [
      "invoice review",
      "ledger maintenance",
      "financial reporting",
      "expense tracking",
      "account reconciliation",
    ],
    businessContextTerms: [
      "invoice",
      "reconciliation",
      "budget",
      "expense",
      "forecast",
      "variance",
      "audit",
      "ledger",
      "payable",
      "receivable",
      "month-end",
    ],
    suggestedKeywords: [
      "financial reporting",
      "account reconciliation",
      "budget tracking",
      "variance analysis",
      "forecasting",
      "month-end close",
      "AP/AR",
      "audit support",
      "Excel",
      "ERP systems",
      "GAAP",
      "IFRS",
    ],
    preferredVerbs: [
      "prepared",
      "reconciled",
      "processed",
      "reviewed",
      "tracked",
      "reported",
      "maintained",
      "documented",
    ],
    safeSupportVerbs: [
      "prepared",
      "reconciled",
      "processed",
      "reviewed",
      "tracked",
      "maintained",
    ],
    keepRules: [
      "Preserve finance and accounting controls, reporting, reconciliation, and close-process context.",
    ],
    avoidRules: [
      "Do not invent savings, margin impact, budget ownership, or financial leadership.",
    ],
    styleHints: [
      "Finance bullets should sound controlled, accurate, and compliance-aware.",
    ],
  },

  hr: {
    titles: [
      "hr specialist",
      "human resources specialist",
      "recruiter",
      "talent acquisition specialist",
      "hr coordinator",
      "people operations specialist",
    ],
    keywords: [
      "recruitment",
      "candidate screening",
      "interview scheduling",
      "employee records",
      "onboarding",
      "offboarding",
      "training coordination",
      "hr administration",
      "compliance",
      "payroll support",
    ],
    strongTerms: [
      "recruiting",
      "candidate screening",
      "interview scheduling",
      "onboarding",
      "offboarding",
      "employee records",
      "talent acquisition",
      "compliance",
      "payroll support",
      "workday",
      "greenhouse",
      "ats",
    ],
    toolTerms: ["workday", "greenhouse", "ats", "excel", "hris"],
    methodologyTerms: [
      "candidate screening",
      "interview coordination",
      "onboarding",
      "offboarding",
      "policy compliance",
    ],
    responsibilityTerms: [
      "candidate communication",
      "interview scheduling",
      "employee documentation",
      "training coordination",
      "record maintenance",
    ],
    businessContextTerms: [
      "candidate",
      "interview",
      "employee",
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
      "candidate screening",
      "interview coordination",
      "employee onboarding",
      "HR administration",
      "policy compliance",
      "record management",
      "ATS",
      "Workday",
      "Greenhouse",
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
      "documented",
      "supported",
      "updated",
    ],
    keepRules: [
      "Preserve recruiting, onboarding, records, scheduling, and compliance context.",
    ],
    avoidRules: [
      "Do not invent hiring success rates, retention impact, or people leadership.",
    ],
    styleHints: [
      "HR bullets should stay process-driven, accurate, and policy-aware.",
    ],
  },

  operations: {
    titles: [
      "operations manager",
      "operations specialist",
      "operations coordinator",
      "operations analyst",
      "office manager",
    ],
    keywords: [
      "operations",
      "workflow",
      "documentation",
      "reporting",
      "process coordination",
      "process improvement",
      "scheduling",
      "cross-functional coordination",
      "vendor communication",
      "record keeping",
    ],
    strongTerms: [
      "operations",
      "workflow",
      "process coordination",
      "documentation",
      "reporting",
      "scheduling",
      "status updates",
      "vendor communication",
      "process improvement",
    ],
    toolTerms: ["excel", "erp", "sap", "jira"],
    methodologyTerms: [
      "process improvement",
      "workflow tracking",
      "status reporting",
    ],
    responsibilityTerms: [
      "process coordination",
      "record maintenance",
      "status tracking",
      "meeting coordination",
      "vendor communication",
    ],
    businessContextTerms: [
      "workflow",
      "operations",
      "process",
      "documentation",
      "records",
      "reporting",
      "coordination",
      "follow-up",
      "vendor",
      "status updates",
    ],
    suggestedKeywords: [
      "process improvement",
      "workflow coordination",
      "vendor communication",
      "cross-functional collaboration",
      "status reporting",
      "documentation",
      "task prioritization",
      "operational tracking",
      "process documentation",
      "resource coordination",
    ],
    preferredVerbs: [
      "coordinated",
      "tracked",
      "organized",
      "maintained",
      "documented",
      "scheduled",
      "reported",
      "monitored",
    ],
    safeSupportVerbs: [
      "coordinated",
      "tracked",
      "organized",
      "maintained",
      "documented",
      "scheduled",
      "monitored",
    ],
    keepRules: [
      "Preserve workflow, reporting, coordination, scheduling, and process language.",
    ],
    avoidRules: [
      "Do not invent transformation leadership, strategic ownership, or quantified efficiency gains.",
    ],
    styleHints: [
      "Operations bullets should sound structured, execution-focused, and process-aware.",
    ],
  },

  supply_chain: {
    titles: [
      "supply chain specialist",
      "logistics specialist",
      "logistics coordinator",
      "warehouse coordinator",
      "inventory specialist",
    ],
    keywords: [
      "supply chain",
      "logistics",
      "inventory",
      "shipment coordination",
      "warehouse operations",
      "order fulfillment",
      "dispatch",
      "delivery tracking",
      "stock control",
    ],
    strongTerms: [
      "inventory management",
      "warehouse management",
      "shipment tracking",
      "logistics coordination",
      "stock control",
      "order fulfillment",
      "vendor coordination",
      "transport planning",
      "sap",
      "erp",
    ],
    toolTerms: ["sap", "erp", "excel", "warehouse management"],
    methodologyTerms: [
      "inventory control",
      "shipment tracking",
      "warehouse operations",
      "logistics planning",
    ],
    responsibilityTerms: [
      "delivery tracking",
      "inventory reconciliation",
      "order coordination",
      "stock monitoring",
      "vendor follow-up",
    ],
    businessContextTerms: [
      "inventory",
      "warehouse",
      "shipment",
      "logistics",
      "delivery",
      "order",
      "stock",
      "vendor",
      "dispatch",
      "transport",
    ],
    suggestedKeywords: [
      "inventory management",
      "shipment tracking",
      "warehouse operations",
      "logistics coordination",
      "stock control",
      "order fulfillment",
      "vendor coordination",
      "ERP systems",
      "delivery planning",
      "inventory reconciliation",
    ],
    preferredVerbs: [
      "coordinated",
      "tracked",
      "monitored",
      "processed",
      "maintained",
      "scheduled",
      "verified",
    ],
    safeSupportVerbs: [
      "coordinated",
      "tracked",
      "monitored",
      "processed",
      "maintained",
      "verified",
    ],
    keepRules: [
      "Preserve inventory, shipment, warehouse, order, and vendor context.",
    ],
    avoidRules: [
      "Do not invent cost savings, route optimization results, or supply chain ownership.",
    ],
    styleHints: [
      "Supply chain bullets should be operational, factual, and process-specific.",
    ],
  },

  procurement: {
    titles: [
      "procurement specialist",
      "purchasing specialist",
      "buyer",
      "sourcing specialist",
      "procurement coordinator",
    ],
    keywords: [
      "procurement",
      "purchasing",
      "sourcing",
      "vendor management",
      "rfq",
      "purchase orders",
      "supplier communication",
      "cost comparison",
    ],
    strongTerms: [
      "procurement",
      "sourcing",
      "vendor management",
      "supplier communication",
      "purchase orders",
      "rfq",
      "price comparison",
      "contract support",
      "sap",
      "erp",
    ],
    toolTerms: ["sap", "erp", "excel"],
    methodologyTerms: [
      "vendor evaluation",
      "sourcing",
      "purchase order processing",
      "rfq handling",
    ],
    responsibilityTerms: [
      "supplier follow-up",
      "purchase order processing",
      "vendor communication",
      "price comparison",
      "documentation",
    ],
    businessContextTerms: [
      "procurement",
      "purchasing",
      "sourcing",
      "vendor",
      "supplier",
      "purchase order",
      "rfq",
      "contract",
    ],
    suggestedKeywords: [
      "vendor management",
      "sourcing",
      "purchase orders",
      "supplier communication",
      "RFQ",
      "price comparison",
      "ERP systems",
      "procurement documentation",
      "vendor evaluation",
      "contract support",
    ],
    preferredVerbs: [
      "sourced",
      "processed",
      "coordinated",
      "reviewed",
      "tracked",
      "documented",
      "communicated",
    ],
    safeSupportVerbs: [
      "processed",
      "coordinated",
      "reviewed",
      "tracked",
      "documented",
      "communicated with",
    ],
    keepRules: [
      "Preserve sourcing, vendor, PO, RFQ, and procurement administration context.",
    ],
    avoidRules: [
      "Do not invent negotiated savings, contract wins, or spend ownership.",
    ],
    styleHints: [
      "Procurement bullets should stay commercially aware but strictly factual.",
    ],
  },

  sales: {
    titles: [
      "sales specialist",
      "sales executive",
      "account executive",
      "sales coordinator",
      "business development executive",
    ],
    keywords: [
      "sales",
      "lead management",
      "pipeline",
      "crm",
      "sales reporting",
      "proposal",
      "client communication",
      "deal tracking",
      "order processing",
    ],
    strongTerms: [
      "pipeline",
      "crm",
      "lead follow-up",
      "account support",
      "sales reporting",
      "proposal",
      "deal tracking",
      "order processing",
      "salesforce",
      "hubspot",
    ],
    toolTerms: ["salesforce", "hubspot", "crm", "excel"],
    methodologyTerms: ["pipeline management", "lead follow-up", "account coordination"],
    responsibilityTerms: [
      "client communication",
      "proposal preparation",
      "deal tracking",
      "order processing",
      "follow-up management",
    ],
    businessContextTerms: [
      "sales",
      "lead",
      "pipeline",
      "crm",
      "proposal",
      "quote",
      "client",
      "deal",
      "orders",
      "account",
    ],
    suggestedKeywords: [
      "sales pipeline",
      "lead management",
      "CRM",
      "proposal preparation",
      "deal tracking",
      "account coordination",
      "client follow-up",
      "Salesforce",
      "HubSpot",
      "sales reporting",
    ],
    preferredVerbs: [
      "managed",
      "followed up",
      "coordinated",
      "prepared",
      "updated",
      "processed",
      "documented",
      "communicated",
    ],
    safeSupportVerbs: [
      "followed up on",
      "coordinated",
      "prepared",
      "updated",
      "processed",
      "documented",
    ],
    keepRules: [
      "Preserve pipeline, proposal, deal, CRM, and client follow-up context.",
    ],
    avoidRules: [
      "Do not invent revenue, quota, close rate, or conversion performance.",
    ],
    styleHints: [
      "Sales bullets should sound commercially relevant but never overclaim results.",
    ],
  },

  customer_support: {
    titles: [
      "customer support specialist",
      "customer service representative",
      "support specialist",
      "technical support specialist",
      "help desk specialist",
    ],
    keywords: [
      "customer support",
      "ticket handling",
      "issue resolution",
      "live chat",
      "email support",
      "complaint handling",
      "service quality",
      "crm",
      "zendesk",
      "freshdesk",
      "sla",
      "escalation",
    ],
    strongTerms: [
      "customer support",
      "ticket",
      "issue resolution",
      "issue escalation",
      "email support",
      "live chat",
      "complaint handling",
      "response time",
      "resolution time",
      "help desk",
    ],
    toolTerms: ["zendesk", "freshdesk", "crm", "help desk"],
    methodologyTerms: ["ticket management", "issue escalation", "sla", "case follow-up"],
    responsibilityTerms: [
      "customer communication",
      "case follow-up",
      "support documentation",
      "issue escalation",
      "service records",
    ],
    businessContextTerms: [
      "customer",
      "ticket",
      "case",
      "issue",
      "service",
      "support",
      "follow-up",
      "requests",
      "feedback",
      "complaints",
      "response",
    ],
    suggestedKeywords: [
      "ticket management",
      "issue resolution",
      "service quality",
      "SLA",
      "escalation handling",
      "support documentation",
      "customer communication",
      "Zendesk",
      "CRM",
      "case follow-up",
    ],
    preferredVerbs: [
      "responded",
      "resolved",
      "escalated",
      "documented",
      "maintained",
      "communicated",
      "processed",
      "tracked",
    ],
    safeSupportVerbs: [
      "responded to",
      "followed up on",
      "documented",
      "maintained",
      "updated",
      "processed",
      "communicated with",
    ],
    keepRules: [
      "Preserve issue handling, escalation, response, documentation, and support-channel context.",
    ],
    avoidRules: [
      "Do not turn support work into customer success strategy or add fake service outcomes.",
    ],
    styleHints: [
      "Support bullets should be service-oriented, concise, and evidence-based.",
    ],
  },

  customer_success: {
    titles: [
      "customer success specialist",
      "customer success manager",
      "client success specialist",
      "account manager",
    ],
    keywords: [
      "customer success",
      "onboarding",
      "renewal",
      "retention",
      "account management",
      "customer communication",
      "relationship management",
      "customer feedback",
      "nps",
      "csat",
      "qbr",
    ],
    strongTerms: [
      "customer success",
      "onboarding",
      "account management",
      "renewal",
      "retention",
      "customer feedback",
      "relationship management",
      "nps",
      "csat",
      "qbr",
    ],
    toolTerms: ["crm", "salesforce", "hubspot"],
    methodologyTerms: ["customer onboarding", "renewal support", "account management", "qbr"],
    responsibilityTerms: [
      "client communication",
      "renewal follow-up",
      "onboarding coordination",
      "relationship management",
    ],
    businessContextTerms: [
      "client",
      "account",
      "onboarding",
      "renewal",
      "retention",
      "feedback",
      "engagement",
      "relationship",
      "customer journey",
    ],
    suggestedKeywords: [
      "customer onboarding",
      "account management",
      "renewal support",
      "customer retention",
      "relationship management",
      "CSAT",
      "NPS",
      "QBR",
      "client engagement",
      "cross-functional collaboration",
    ],
    preferredVerbs: [
      "managed",
      "guided",
      "coordinated",
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
      "Preserve onboarding, renewal, retention support, and account-context language.",
    ],
    avoidRules: [
      "Do not invent renewals closed, churn reduction, or account growth.",
    ],
    styleHints: [
      "Customer success bullets should sound relationship-aware but fully factual.",
    ],
  },

  executive_assistant: {
    titles: [
      "executive assistant",
      "personal assistant",
      "administrative assistant",
      "office assistant",
    ],
    keywords: [
      "calendar management",
      "travel coordination",
      "meeting coordination",
      "document preparation",
      "executive support",
      "scheduling",
      "record keeping",
      "office administration",
    ],
    strongTerms: [
      "calendar management",
      "travel coordination",
      "meeting coordination",
      "document preparation",
      "record keeping",
      "scheduling",
      "executive support",
    ],
    toolTerms: ["excel", "powerpoint", "office", "google sheets"],
    methodologyTerms: ["calendar coordination", "meeting scheduling", "document management"],
    responsibilityTerms: [
      "appointment scheduling",
      "travel arrangements",
      "meeting preparation",
      "document management",
      "record maintenance",
    ],
    businessContextTerms: [
      "calendar",
      "appointments",
      "schedules",
      "documents",
      "records",
      "meeting materials",
      "administrative",
      "executive",
    ],
    suggestedKeywords: [
      "calendar management",
      "meeting coordination",
      "travel coordination",
      "document management",
      "record maintenance",
      "executive support",
      "office administration",
      "task prioritization",
      "time management",
      "stakeholder communication",
    ],
    preferredVerbs: [
      "managed",
      "organized",
      "scheduled",
      "prepared",
      "maintained",
      "coordinated",
      "documented",
    ],
    safeSupportVerbs: [
      "organized",
      "scheduled",
      "prepared",
      "maintained",
      "coordinated",
      "documented",
    ],
    keepRules: [
      "Preserve scheduling, executive support, meeting, travel, and document-management context.",
    ],
    avoidRules: [
      "Do not rewrite admin support into project leadership or strategic ownership.",
    ],
    styleHints: [
      "Executive assistant bullets should be sharp, organized, and logistics-aware.",
    ],
  },

  project: {
    titles: [
      "project manager",
      "project coordinator",
      "program coordinator",
      "program manager",
      "pm",
    ],
    keywords: [
      "project coordination",
      "project management",
      "timelines",
      "deliverables",
      "status tracking",
      "stakeholder updates",
      "milestones",
      "project documentation",
      "risk tracking",
    ],
    strongTerms: [
      "project coordination",
      "project management",
      "timelines",
      "deliverables",
      "milestones",
      "status tracking",
      "risk tracking",
      "jira",
      "confluence",
      "agile",
    ],
    toolTerms: ["jira", "confluence", "excel", "primavera p6", "ms project"],
    methodologyTerms: [
      "agile",
      "scrum",
      "waterfall",
      "risk tracking",
      "timeline management",
      "deliverable coordination",
    ],
    responsibilityTerms: [
      "stakeholder updates",
      "status reporting",
      "meeting facilitation",
      "project documentation",
      "timeline tracking",
    ],
    businessContextTerms: [
      "project",
      "timeline",
      "deliverable",
      "milestone",
      "status update",
      "stakeholder",
      "coordination",
      "risk",
    ],
    suggestedKeywords: [
      "timeline management",
      "deliverable coordination",
      "status reporting",
      "stakeholder communication",
      "risk tracking",
      "project documentation",
      "resource coordination",
      "Agile",
      "Jira",
      "milestone tracking",
    ],
    preferredVerbs: [
      "coordinated",
      "tracked",
      "scheduled",
      "updated",
      "documented",
      "monitored",
      "facilitated",
    ],
    safeSupportVerbs: [
      "coordinated",
      "tracked",
      "scheduled",
      "updated",
      "documented",
      "supported",
    ],
    keepRules: [
      "Preserve timeline, milestone, deliverable, risk, and stakeholder-update context.",
    ],
    avoidRules: [
      "Do not invent delivery ownership, budget control, or transformation leadership.",
    ],
    styleHints: [
      "Project bullets should stay coordination-heavy unless clear ownership is supported.",
    ],
  },

  marketing: {
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
      "google analytics",
      "ga4",
      "google tag manager",
      "seo",
      "sem",
      "ppc",
      "campaign reporting",
      "content marketing",
      "email marketing",
      "social media",
      "lead generation",
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
      "a/b test",
      "lead generation",
      "campaign optimization",
    ],
    toolTerms: [
      "google ads",
      "meta ads",
      "google analytics",
      "ga4",
      "google tag manager",
      "search console",
      "hubspot",
    ],
    methodologyTerms: [
      "a/b test",
      "remarketing",
      "retargeting",
      "audience segmentation",
      "campaign optimization",
    ],
    responsibilityTerms: [
      "campaign reporting",
      "content planning",
      "lead generation",
      "channel performance",
      "landing page updates",
    ],
    businessContextTerms: [
      "campaign",
      "performance",
      "audience",
      "targeting",
      "brand awareness",
      "social media",
      "email",
      "landing page",
      "content",
      "reporting",
      "optimization",
    ],
    suggestedKeywords: [
      "PPC",
      "SEO",
      "SEM",
      "GA4",
      "Google Tag Manager",
      "audience segmentation",
      "A/B testing",
      "lead generation",
      "campaign optimization",
      "analytics reporting",
    ],
    preferredVerbs: [
      "managed",
      "optimized",
      "analyzed",
      "tracked",
      "reported",
      "executed",
      "launched",
      "monitored",
      "coordinated",
    ],
    safeSupportVerbs: [
      "coordinated",
      "prepared",
      "tracked",
      "updated",
      "monitored",
      "collaborated with",
    ],
    keepRules: [
      "Preserve tools, channels, metrics, platform names, and campaign context.",
    ],
    avoidRules: [
      "Do not invent performance lift, lead volume, revenue, or ROI improvements.",
    ],
    styleHints: [
      "Marketing bullets should stay channel-specific, tool-aware, and factual.",
    ],
  },

  design: {
    titles: [
      "designer",
      "graphic designer",
      "ui designer",
      "ux designer",
      "product designer",
      "visual designer",
    ],
    keywords: [
      "design",
      "wireframes",
      "prototypes",
      "user interface",
      "user experience",
      "visual design",
      "brand assets",
      "design systems",
    ],
    strongTerms: [
      "figma",
      "adobe creative suite",
      "photoshop",
      "illustrator",
      "wireframes",
      "prototypes",
      "ui",
      "ux",
      "design system",
      "mockups",
    ],
    toolTerms: [
      "figma",
      "adobe creative suite",
      "photoshop",
      "illustrator",
      "after effects",
    ],
    methodologyTerms: [
      "wireframing",
      "prototyping",
      "design systems",
      "user flows",
      "usability testing",
    ],
    responsibilityTerms: [
      "asset creation",
      "interface design",
      "visual design",
      "brand consistency",
      "prototype creation",
    ],
    businessContextTerms: [
      "design",
      "wireframe",
      "prototype",
      "interface",
      "visual",
      "brand",
      "layout",
      "assets",
      "user flow",
    ],
    suggestedKeywords: [
      "Figma",
      "wireframing",
      "prototyping",
      "design systems",
      "UI design",
      "UX design",
      "user flows",
      "visual design",
      "Adobe Creative Suite",
      "mockups",
    ],
    preferredVerbs: [
      "designed",
      "created",
      "developed",
      "prepared",
      "produced",
      "refined",
      "updated",
    ],
    safeSupportVerbs: [
      "prepared",
      "produced",
      "updated",
      "collaborated with",
      "supported",
    ],
    keepRules: [
      "Preserve design tools, deliverables, and interface/visual terminology.",
    ],
    avoidRules: [
      "Do not invent user research depth, conversion gains, or brand strategy ownership.",
    ],
    styleHints: [
      "Design bullets should stay artifact-focused, tool-aware, and portfolio-relevant.",
    ],
  },

  education: {
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
      "curriculum",
      "instruction",
      "student support",
      "teaching materials",
    ],
    strongTerms: [
      "lesson planning",
      "classroom management",
      "student assessment",
      "curriculum development",
      "instruction",
      "learning materials",
      "student progress",
    ],
    toolTerms: ["excel", "powerpoint", "google classroom", "office"],
    methodologyTerms: [
      "lesson planning",
      "curriculum development",
      "classroom management",
      "student assessment",
    ],
    responsibilityTerms: [
      "lesson delivery",
      "assessment preparation",
      "student progress tracking",
      "classroom support",
    ],
    businessContextTerms: [
      "classroom",
      "student",
      "curriculum",
      "lesson",
      "assessment",
      "instruction",
      "learning",
    ],
    suggestedKeywords: [
      "lesson planning",
      "classroom management",
      "student assessment",
      "curriculum development",
      "learning materials",
      "student progress tracking",
      "instruction",
      "parent communication",
      "education support",
      "academic planning",
    ],
    preferredVerbs: [
      "planned",
      "delivered",
      "prepared",
      "assessed",
      "supported",
      "tracked",
      "organized",
    ],
    safeSupportVerbs: [
      "prepared",
      "supported",
      "tracked",
      "organized",
      "communicated with",
    ],
    keepRules: [
      "Preserve lesson planning, instruction, curriculum, and assessment context.",
    ],
    avoidRules: [
      "Do not invent achievement gains, curriculum ownership, or student outcome data.",
    ],
    styleHints: [
      "Education bullets should sound instructional, structured, and student-aware.",
    ],
  },

  healthcare_admin: {
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
      "clinic operations",
      "appointment coordination",
      "hipaa",
    ],
    strongTerms: [
      "patient scheduling",
      "medical records",
      "insurance verification",
      "ehr",
      "emr",
      "hipaa",
      "appointment coordination",
      "patient communication",
    ],
    toolTerms: ["ehr", "emr", "excel", "office"],
    methodologyTerms: [
      "patient intake",
      "insurance verification",
      "record maintenance",
      "appointment scheduling",
    ],
    responsibilityTerms: [
      "patient communication",
      "appointment scheduling",
      "medical record updates",
      "insurance follow-up",
    ],
    businessContextTerms: [
      "patient",
      "appointment",
      "clinic",
      "medical records",
      "insurance",
      "scheduling",
      "ehr",
      "emr",
    ],
    suggestedKeywords: [
      "patient scheduling",
      "medical records",
      "insurance verification",
      "EHR/EMR",
      "appointment coordination",
      "HIPAA",
      "patient communication",
      "clinic administration",
      "record maintenance",
      "front-desk coordination",
    ],
    preferredVerbs: [
      "scheduled",
      "coordinated",
      "updated",
      "maintained",
      "verified",
      "documented",
      "communicated",
    ],
    safeSupportVerbs: [
      "scheduled",
      "updated",
      "maintained",
      "verified",
      "documented",
      "communicated with",
    ],
    keepRules: [
      "Preserve patient, scheduling, records, insurance, and compliance context.",
    ],
    avoidRules: [
      "Do not invent clinical work, patient outcomes, or operational leadership.",
    ],
    styleHints: [
      "Healthcare admin bullets should remain accurate, compliant, and records-aware.",
    ],
  },

  civil_engineering: {
    titles: [
      "civil engineer",
      "site engineer",
      "construction engineer",
      "project site engineer",
    ],
    keywords: [
      "civil engineering",
      "site supervision",
      "construction",
      "project drawings",
      "quantity takeoff",
      "boq",
      "technical documentation",
      "autocad",
      "revit",
      "primavera p6",
    ],
    strongTerms: [
      "autocad",
      "revit",
      "primavera p6",
      "site supervision",
      "technical drawings",
      "quantity takeoff",
      "boq",
      "construction documentation",
      "inspection",
    ],
    toolTerms: ["autocad", "revit", "primavera p6", "excel"],
    methodologyTerms: [
      "site inspection",
      "quantity takeoff",
      "project documentation",
      "schedule tracking",
    ],
    responsibilityTerms: [
      "drawing review",
      "site coordination",
      "technical documentation",
      "progress tracking",
      "contractor coordination",
    ],
    businessContextTerms: [
      "construction",
      "site",
      "drawing",
      "inspection",
      "boq",
      "quantity",
      "schedule",
      "technical",
    ],
    suggestedKeywords: [
      "AutoCAD",
      "Revit",
      "Primavera P6",
      "site supervision",
      "quantity takeoff",
      "BOQ",
      "technical documentation",
      "drawing review",
      "progress tracking",
      "construction coordination",
    ],
    preferredVerbs: [
      "reviewed",
      "prepared",
      "coordinated",
      "tracked",
      "inspected",
      "documented",
      "supported",
    ],
    safeSupportVerbs: [
      "reviewed",
      "prepared",
      "coordinated",
      "tracked",
      "documented",
      "supported",
    ],
    keepRules: [
      "Preserve engineering tools, drawings, site, inspection, and project-documentation context.",
    ],
    avoidRules: [
      "Do not invent design authority, PE-level ownership, or quantified project outcomes.",
    ],
    styleHints: [
      "Civil engineering bullets should stay technical, site-aware, and documentation-based.",
    ],
  },

  mechanical_engineering: {
    titles: [
      "mechanical engineer",
      "design engineer",
      "maintenance engineer",
      "production engineer",
    ],
    keywords: [
      "mechanical design",
      "technical drawings",
      "solidworks",
      "autocad",
      "equipment maintenance",
      "production support",
      "technical documentation",
      "quality checks",
    ],
    strongTerms: [
      "solidworks",
      "autocad",
      "technical drawings",
      "equipment maintenance",
      "preventive maintenance",
      "production support",
      "quality checks",
      "root cause analysis",
    ],
    toolTerms: [
      "solidworks",
      "autocad",
      "excel",
      "erp",
    ],
    methodologyTerms: [
      "preventive maintenance",
      "quality checks",
      "technical documentation",
      "root cause analysis",
    ],
    responsibilityTerms: [
      "drawing preparation",
      "equipment inspection",
      "maintenance planning",
      "technical support",
      "production coordination",
    ],
    businessContextTerms: [
      "mechanical",
      "equipment",
      "maintenance",
      "drawing",
      "production",
      "quality",
      "inspection",
      "technical",
    ],
    suggestedKeywords: [
      "SolidWorks",
      "AutoCAD",
      "technical drawings",
      "preventive maintenance",
      "equipment inspection",
      "production support",
      "quality checks",
      "technical documentation",
      "root cause analysis",
      "maintenance planning",
    ],
    preferredVerbs: [
      "designed",
      "prepared",
      "inspected",
      "tracked",
      "maintained",
      "documented",
      "supported",
    ],
    safeSupportVerbs: [
      "prepared",
      "inspected",
      "tracked",
      "maintained",
      "documented",
      "supported",
    ],
    keepRules: [
      "Preserve mechanical tools, equipment, drawings, maintenance, and quality context.",
    ],
    avoidRules: [
      "Do not invent design authority, production improvements, or technical leadership.",
    ],
    styleHints: [
      "Mechanical engineering bullets should stay technical, equipment-focused, and factual.",
    ],
  },

  administrative: {
    titles: [
      "administrative assistant",
      "office assistant",
      "admin assistant",
    ],
    keywords: [
      "administrative support",
      "calendar management",
      "scheduling",
      "meeting coordination",
      "document preparation",
      "filing",
      "data entry",
      "record keeping",
      "office support",
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
    ],
    toolTerms: [
      "office",
      "excel",
      "powerpoint",
      "google sheets",
    ],
    methodologyTerms: [
      "document management",
      "calendar coordination",
      "meeting scheduling",
      "record maintenance",
    ],
    responsibilityTerms: [
      "document preparation",
      "record maintenance",
      "appointment scheduling",
      "office support",
    ],
    businessContextTerms: [
      "calendar",
      "appointments",
      "documents",
      "records",
      "filing",
      "data entry",
      "administrative",
      "office support",
    ],
    suggestedKeywords: [
      "document management",
      "calendar coordination",
      "meeting scheduling",
      "record maintenance",
      "office administration",
      "internal communication",
      "task coordination",
      "data entry accuracy",
      "time management",
      "administrative reporting",
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
      "Preserve administrative, scheduling, document, and records context.",
    ],
    avoidRules: [
      "Do not turn admin work into project leadership or strategic planning.",
    ],
    styleHints: [
      "Administrative bullets should sound organized, reliable, and execution-focused.",
    ],
  },

  generic: {
    titles: [],
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
    toolTerms: [
      "excel",
      "office",
      "google sheets",
      "powerpoint",
    ],
    methodologyTerms: [
      "documentation",
      "tracking",
      "coordination",
      "reporting",
    ],
    responsibilityTerms: [
      "task coordination",
      "record maintenance",
      "follow-up",
      "reporting support",
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
      "documentation",
      "cross-functional collaboration",
      "process tracking",
      "stakeholder communication",
      "task coordination",
      "problem-solving",
      "time management",
      "reporting",
      "data tracking",
      "record maintenance",
    ],
    preferredVerbs: [
      "coordinated",
      "prepared",
      "tracked",
      "maintained",
      "documented",
      "updated",
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
      "Keep bullets concise, truthful, and role-grounded.",
    ],
    avoidRules: [
      "Do not force jargon or inflate scope when the source text is simple.",
    ],
    styleHints: [
      "Prefer grounded recruiter language over generic corporate fluff.",
    ],
  },
};

function getRolePackAllTerms(pack = {}) {
  return uniqueTrimmedStrings([
    ...(pack.titles || []),
    ...(pack.keywords || []),
    ...(pack.strongTerms || []),
    ...(pack.toolTerms || []),
    ...(pack.methodologyTerms || []),
    ...(pack.certificationTerms || []),
    ...(pack.responsibilityTerms || []),
  ]);
}

const ALL_ROLE_TERMS = uniqueTrimmedStrings(
  Object.values(ROLE_PACKS).flatMap((p) => getRolePackAllTerms(p))
);

const ALL_BUSINESS_CONTEXT_TERMS = uniqueTrimmedStrings(
  Object.values(ROLE_PACKS).flatMap((p) => p.businessContextTerms || [])
);

const HARD_FACT_TERMS = uniqueTrimmedStrings([
  "google ads",
  "meta ads",
  "google analytics",
  "ga4",
  "google tag manager",
  "gtm",
  "seo",
  "sem",
  "ppc",
  "hubspot",
  "salesforce",
  "crm",
  "zendesk",
  "freshdesk",
  "help desk",
  "jira",
  "confluence",
  "tableau",
  "power bi",
  "looker studio",
  "excel",
  "google sheets",
  "powerpoint",
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
  "rest api",
  "microservices",
  "unit testing",
  "integration testing",
  "selenium",
  "cypress",
  "postman",
  "figma",
  "adobe creative suite",
  "photoshop",
  "illustrator",
  "autocad",
  "solidworks",
  "revit",
  "primavera p6",
  "sap",
  "sap mm",
  "sap fico",
  "oracle",
  "quickbooks",
  "netsuite",
  "erp",
  "ifrs",
  "gaap",
  "accounts payable",
  "accounts receivable",
  "payroll",
  "forecasting",
  "variance analysis",
  "budgeting",
  "audit",
  "reconciliation",
  "workday",
  "greenhouse",
  "ats",
  "agile",
  "scrum",
  "kanban",
  "lean",
  "six sigma",
  "pmp",
  "csm",
  "psm",
  "etl",
  "data modeling",
  "ehr",
  "emr",
  "hipaa",
  "patient scheduling",
  "insurance verification",
  "inventory management",
  "warehouse management",
  "procurement",
  "sourcing",
  "vendor management",
  "csat",
  "nps",
  "qbr",
  "a/b test",
  "remarketing",
  "retargeting",
  "lead generation",
  "audience segmentation",
  "boq",
]);

const GLOBAL_STRONG_SPECIFIC_RE = buildPhraseRegex([...ALL_ROLE_TERMS, ...HARD_FACT_TERMS]);
const GLOBAL_BUSINESS_CONTEXT_RE = buildPhraseRegex(ALL_BUSINESS_CONTEXT_TERMS);

const CERTIFICATION_RE =
  /\b(pmp|csm|psm|scrum master|cpa|cfa|acca|ifrs|gaap|lean six sigma|six sigma|itil|hipaa)\b/i;

const ACRONYM_RE = /\b[A-Z]{2,}(?:\/[A-Z]{2,})?\b/;

const GENERIC_SUMMARY_RE =
  /^(experienced|results[- ]driven|motivated|detail[- ]oriented|hardworking|dedicated|dynamic|responsible|organized|versatile|experienced professional|deneyimli|sonuç odaklı|motivasyonu yüksek|detay odaklı|çalışkan|disiplinli|öğrenmeye açık|sorumluluk sahibi)\b/i;

const DUTIES_ONLY_RE =
  /\b(duties included|responsible for|tasked with|worked on|supported|assisted|helped|contributed to|participated in|involved in|görevlerim arasında|sorumlu olduğum|ilgili süreçlerde|görev aldım|destek oldum|yardımcı oldum|ilgilen(dim|di))\b/i;

const WEAK_SENTENCE_RE =
  /\b(ilgilendim|bulundum|görev aldım|destek oldum|destek verdim|yardımcı oldum|sorumluydum|takip ettim|katıldım|çalıştım|yaptım|worked on|handled|supported|assisted|helped|was responsible for|responsible for|contributed to|involved in|participated in|tasked with|duties included|worked closely with|provided support)\b/i;

const WEAK_START_RE =
  /^(helped|assisted|supported|worked on|contributed to|participated in|involved in|handled|tasked with|responsible for|duties included|yardımcı oldum|destek verdim|destek oldum|görev aldım|ilgilen(dim|di)|bulundum|çalıştım|yaptım)\b/i;

const WEAK_PHRASE_RE =
  /\b(helped|assisted|supported|involved in|responsible for|contributed to|worked on|played a key role in|participated in|handled|supported the team|took part in|provided support|ilgilendim|bulundum|baktım|yardım ettim|yardımcı oldum|destek verdim|destek oldum|katkı sağladım|görev aldım|sorumlu oldum)\b/i;

const STRONG_ACTION_RE =
  /\b(yönettim|yürüttüm|koordine ettim|hazırladım|analiz ettim|raporladım|geliştirdim|oluşturdum|uyguladım|organize ettim|takip ettim|düzenledim|gerçekleştirdim|izledim|optimize ettim|tasarladım|planladım|uyarladım|sundum|denetledim|doğruladım|uzlaştırdım|işledim|eğitim verdim|değerlendirdim|engineered|built|developed|designed|implemented|integrated|tested|debugged|validated|automated|configured|deployed|maintained|optimized|planned|executed|created|responded|resolved|documented|scheduled|reviewed|updated|monitored|processed|reconciled|screened|analyzed|reported|tracked|managed|delivered|verified|produced|prepared|mapped|facilitated|taught|assessed|inspected)\b/i;

const EN_WEAK_REWRITE_START_RE =
  /^(?:actively\s+)?(?:helped|assisted|supported|contributed|participated|aided|facilitated)\b/i;

const EN_SOFT_FILLER_RE =
  /\b(aimed at|focused on|with a focus on|designed to|to improve|to enhance|to strengthen|to maximize|to optimize|to drive|to facilitate|to promote|to ensure|to support decision-making|to improve service quality|to enhance engagement)\b/i;

const EN_UNSUPPORTED_IMPACT_RE =
  /\b(drive measurable results|resulting in|increased conversion rates|qualified leads|competitive positioning|data-driven decision-making|stronger market presence|better campaign outcomes|improved follow-up|deliver(?:ed|ing)? exceptional service|enhance(?:d|s|ing)? client relationships|increase(?:d|ing)? participation rates|boost(?:ed|ing)? customer loyalty|enhance(?:d|s|ing)? service satisfaction|improve(?:d|s|ing)? operational efficiency|reduced costs|generated revenue|improved retention|optimized performance|accelerated delivery)\b/i;

const ENGLISH_RISKY_RESULT_RE =
  /\b(resulting in|driving|boosting|enhancing|improving|increasing|streamlining|ensuring|maximizing|delivering|aimed at|focused on|designed to)\b/i;

const ENGLISH_WEAK_SWAP_RE =
  /\b(assisted|contributed|participated|supported|helped)\b/i;

const ENGLISH_CORPORATE_FLUFF_RE =
  /\b(dynamic|robust|seamless|impactful|high-impact|comprehensive|various|overall|strategic initiatives|in-depth data analysis|for consistency|for team accessibility|to ensure data accuracy|to ensure accuracy and relevance|to streamline communication efforts|to support informed marketing strategies|to enhance engagement|to optimize user experience|operational excellence|decision-making|stakeholder alignment|value-driven|best-in-class)\b/i;

const LOW_VALUE_KEYWORD_RE =
  /\b(communication|teamwork|hardworking|motivated|detail[- ]oriented|problem solving|leadership|microsoft office|ms office|computer skills|organizasyon|iletişim|takım çalışması|motivasyon|çözüm odaklı|detay odaklı|uyumlu|çalışkan|analiz|analysis|support|reporting|management|beceri|yetenek|deneyim)\b/i;

const JD_CUE_RE =
  /\b(required|requirements|must have|preferred|experience with|knowledge of|proficient in|responsible for|responsibilities|qualification|qualifications|nice to have|should have|aranan nitelikler|gerekli|tercihen|deneyim|sorumluluklar|yetkinlikler|beklentiler)\b/i;

const SKILL_NGRAM_HINTS = uniqueTrimmedStrings([
  "analysis",
  "analyst",
  "analytics",
  "dashboard",
  "reporting",
  "forecasting",
  "budgeting",
  "reconciliation",
  "audit",
  "payable",
  "receivable",
  "payroll",
  "recruiting",
  "screening",
  "onboarding",
  "offboarding",
  "procurement",
  "sourcing",
  "vendor",
  "inventory",
  "warehouse",
  "logistics",
  "shipment",
  "support",
  "success",
  "retention",
  "renewal",
  "curriculum",
  "classroom",
  "assessment",
  "instruction",
  "patient",
  "insurance",
  "ehr",
  "emr",
  "testing",
  "automation",
  "qa",
  "quality",
  "sql",
  "python",
  "javascript",
  "typescript",
  "react",
  "node",
  "api",
  "microservices",
  "cloud",
  "docker",
  "kubernetes",
  "roadmap",
  "backlog",
  "stakeholder",
  "scrum",
  "agile",
  "design",
  "wireframe",
  "prototype",
  "figma",
  "autocad",
  "revit",
  "solidworks",
  "primavera",
  "civil",
  "mechanical",
  "safety",
  "compliance",
  "risk",
  "release",
  "deployment",
  "lesson",
  "schedule",
  "coordination",
  "documentation",
  "integration",
  "data modeling",
  "etl",
  "boq",
]);

function inferSeniority(text = "") {
  const s = normalizeCompareText(text);

  if (
    /\b(chief|vp|vice president|director|head of|department head|general manager)\b/i.test(s)
  ) {
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

function inferFunctionalFocus(text = "", roleGroups = []) {
  const norm = canonicalizeTerm(text);
  const candidates = [
    {
      key: "technical_execution",
      score: countTermHits(norm, [
        "software",
        "api",
        "database",
        "testing",
        "deployment",
        "debugging",
        "engineering",
      ]),
    },
    {
      key: "analysis_reporting",
      score: countTermHits(norm, [
        "analysis",
        "analytics",
        "dashboard",
        "reporting",
        "kpi",
        "forecasting",
        "reconciliation",
      ]),
    },
    {
      key: "process_operations",
      score: countTermHits(norm, [
        "operations",
        "workflow",
        "process",
        "coordination",
        "tracking",
        "logistics",
        "inventory",
      ]),
    },
    {
      key: "client_customer",
      score: countTermHits(norm, [
        "customer",
        "client",
        "support",
        "onboarding",
        "renewal",
        "service",
        "ticket",
      ]),
    },
    {
      key: "product_project",
      score: countTermHits(norm, [
        "product",
        "roadmap",
        "backlog",
        "project",
        "timeline",
        "deliverable",
        "stakeholder",
      ]),
    },
    {
      key: "people_admin",
      score: countTermHits(norm, [
        "candidate",
        "employee",
        "interview",
        "onboarding",
        "calendar",
        "meeting",
        "documentation",
      ]),
    },
    {
      key: "design_creative",
      score: countTermHits(norm, [
        "design",
        "wireframe",
        "prototype",
        "visual",
        "ui",
        "ux",
        "figma",
      ]),
    },
    {
      key: "regulated_records",
      score: countTermHits(norm, [
        "audit",
        "compliance",
        "hipaa",
        "medical records",
        "ifrs",
        "gaap",
      ]),
    },
  ];

  const top = candidates
    .filter((x) => x.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, 3)
    .map((x) => x.key);

  if (top.length) return top;

  const primary = Array.isArray(roleGroups) && roleGroups[0] ? roleGroups[0] : "generic";
  if (primary === "generic") return ["general_execution"];
  return [primary];
}

function inferRoleProfile(cv = "", jd = "") {
  const combined = `${cv || ""}\n${jd || ""}`;
  const combinedNorm = canonicalizeTerm(combined);
  const titleText = `${extractHeaderBlock(cv).join(" ")} ${extractExperienceTitles(cv).join(" ")}`.trim();

  const scored = Object.entries(ROLE_PACKS)
    .filter(([key]) => key !== "generic")
    .map(([key, pack]) => {
      const titleHits = countTermHits(titleText, pack.titles || []);
      const keywordHits = countTermHits(combinedNorm, pack.keywords || []);
      const strongHits = countTermHits(combinedNorm, pack.strongTerms || []);
      const toolHits = countTermHits(combinedNorm, pack.toolTerms || []);
      const methodologyHits = countTermHits(combinedNorm, pack.methodologyTerms || []);
      const responsibilityHits = countTermHits(combinedNorm, pack.responsibilityTerms || []);
      const businessHits = countTermHits(combinedNorm, pack.businessContextTerms || []);

      const score =
        titleHits * 6 +
        toolHits * 5 +
        strongHits * 4 +
        keywordHits * 3 +
        methodologyHits * 3 +
        responsibilityHits * 2 +
        Math.min(5, businessHits);

      return {
        key,
        score,
        titleHits,
        keywordHits,
        strongHits,
        toolHits,
        methodologyHits,
        responsibilityHits,
        businessHits,
      };
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

      if (roleGroups.length >= 3) break;

      if (
        item.score >= Math.max(7, top - 5) ||
        item.titleHits >= 1 ||
        item.toolHits >= 2 ||
        item.strongHits >= 2
      ) {
        roleGroups.push(item.key);
      }
    }

    if (!roleGroups.length) roleGroups = ["generic"];
  }

  const primaryRole = roleGroups[0] || "generic";
  const seniority = inferSeniority(`${titleText}\n${combined}`);
  const focusAreas = inferFunctionalFocus(combined, roleGroups);
  const primaryPack = ROLE_PACKS[primaryRole] || ROLE_PACKS.generic;

  const domainSignals = uniqueTrimmedStrings([
    ...(primaryPack.strongTerms || []),
    ...(primaryPack.toolTerms || []),
    ...(primaryPack.methodologyTerms || []),
    ...(primaryPack.responsibilityTerms || []),
  ])
    .filter((term) => containsCanonicalTermInNormalizedText(combinedNorm, term))
    .slice(0, 12);

  return {
    roleGroups,
    primaryRole,
    secondaryRoles: roleGroups.slice(1),
    seniority,
    focusAreas,
    domainSignals,
    scoredRoles: scored.slice(0, 6),
  };
}

function ensureRoleProfile(roleInput, cv = "", jd = "") {
  if (
    roleInput &&
    typeof roleInput === "object" &&
    !Array.isArray(roleInput) &&
    Array.isArray(roleInput.roleGroups)
  ) {
    return roleInput;
  }

  const roleGroups =
    Array.isArray(roleInput) && roleInput.length ? roleInput : inferRoleProfile(cv, jd).roleGroups;

  return {
    roleGroups,
    primaryRole: roleGroups[0] || "generic",
    secondaryRoles: roleGroups.slice(1),
    seniority: inferSeniority(`${cv}\n${jd}`),
    focusAreas: [],
    domainSignals: [],
    scoredRoles: [],
  };
}

function inferRoleGroups(cv = "", jd = "") {
  return inferRoleProfile(cv, jd).roleGroups;
}

function getPrimaryRoleKey(roleInput = []) {
  const profile = ensureRoleProfile(roleInput);
  return profile.primaryRole || "generic";
}

function getRolePacks(roleInput = []) {
  const profile = ensureRoleProfile(roleInput);
  const packs = (profile.roleGroups || ["generic"])
    .map((k) => ROLE_PACKS[k])
    .filter(Boolean);

  return packs.length ? packs : [ROLE_PACKS.generic];
}

function getRoleSpecificityRegex(roleInput = []) {
  const terms = uniqueTrimmedStrings(
    getRolePacks(roleInput).flatMap((p) => getRolePackAllTerms(p))
  );
  return buildPhraseRegex(terms);
}

function getRoleBusinessContextRegex(roleInput = []) {
  const terms = uniqueTrimmedStrings(
    getRolePacks(roleInput).flatMap((p) => p.businessContextTerms || [])
  );
  return buildPhraseRegex(terms);
}

function getSuggestedKeywords(roleInput = []) {
  const profile = ensureRoleProfile(roleInput);
  const packs = getRolePacks(profile);
  const seniority = profile.seniority || "mid";

  let out = uniqueTrimmedStrings(
    packs.flatMap((p) => p.suggestedKeywords || [])
  );

  if (seniority === "manager_or_lead" || seniority === "leadership") {
    const leaderTerms = uniqueTrimmedStrings([
      "stakeholder communication",
      "cross-functional collaboration",
      "roadmap planning",
      "risk tracking",
      "process improvement",
      "team coordination",
      "reporting cadence",
    ]);
    out = uniqueTrimmedStrings([...leaderTerms, ...out]);
  }

  if (seniority === "junior") {
    const juniorTerms = uniqueTrimmedStrings([
      "documentation",
      "process adherence",
      "task coordination",
      "record maintenance",
      "quality checks",
      "reporting support",
    ]);
    out = uniqueTrimmedStrings([...out, ...juniorTerms]);
  }

  return out.slice(0, 24);
}

function buildRoleContextText(roleInput = []) {
  const profile = ensureRoleProfile(roleInput);
  const packs = getRolePacks(profile);

  const roleSignals = uniqueTrimmedStrings(
    packs.flatMap((p) => [
      ...(p.strongTerms || []),
      ...(p.toolTerms || []),
      ...(p.methodologyTerms || []),
      ...(p.responsibilityTerms || []),
    ])
  ).slice(0, 14);

  const likelyThemes = getSuggestedKeywords(profile).slice(0, 12);

  return [
    `- primary_role: ${profile.primaryRole}`,
    `- secondary_roles: ${(profile.secondaryRoles || []).join(", ") || "(none)"}`,
    `- seniority_signal: ${profile.seniority || "mid"}`,
    `- functional_focus: ${(profile.focusAreas || []).join(", ") || "(none)"}`,
    `- detected_role_signals: ${roleSignals.join(", ") || "(none)"}`,
    `- likely_ats_themes: ${likelyThemes.join(", ") || "(none)"}`,
  ].join("\n");
}

function buildRoleWritingBlock(roleInput = []) {
  const profile = ensureRoleProfile(roleInput);
  const packs = getRolePacks(profile);

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
- Primary role family: ${profile.primaryRole}
- Seniority signal: ${profile.seniority}
- Functional focus: ${(profile.focusAreas || []).join(", ") || "(none)"}
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

function buildLikelyKeywordThemeText(roleInput = []) {
  const profile = ensureRoleProfile(roleInput);
  const themes = getSuggestedKeywords(profile).slice(0, 12);

  return [
    `- likely_role_family: ${profile.primaryRole}`,
    `- likely_seniority: ${profile.seniority}`,
    `- likely_keyword_themes: ${themes.join(", ") || "(none)"}`,
  ].join("\n");
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
  return /^(PROFESSIONAL SUMMARY|SUMMARY|PROFILE|CORE SUMMARY|EXPERIENCE|WORK EXPERIENCE|PROFESSIONAL EXPERIENCE|SKILLS|CORE SKILLS|TECHNICAL SKILLS|COMPETENCIES|EDUCATION|LANGUAGES|CERTIFICATIONS|LICENSES|PROJECTS|ADDITIONAL INFORMATION|AWARDS|ACHIEVEMENTS|PROFESYONEL ÖZET|ÖZET|PROFİL|DENEYİM|İŞ DENEYİMİ|YETKİNLİKLER|YETENEKLER|BECERİLER|EĞİTİM|DİLLER|BİLDİĞİ DİLLER|SERTİFİKALAR|PROJELER|EK BİLGİLER)$/i.test(
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
    .replace(/^PROFILE$/gim, "PROFESSIONAL SUMMARY")
    .replace(/^CORE SUMMARY$/gim, "PROFESSIONAL SUMMARY")
    .replace(/^WORK EXPERIENCE$/gim, "EXPERIENCE")
    .replace(/^PROFESSIONAL EXPERIENCE$/gim, "EXPERIENCE")
    .replace(/^(CORE SKILLS|TECHNICAL SKILLS|COMPETENCIES)$/gim, "SKILLS")
    .replace(/^LICENSES$/gim, "CERTIFICATIONS")
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
  const orig = getBulletLines(originalCv).map(canonicalizeTerm).filter(Boolean);
  const optSet = new Set(
    getBulletLines(optimizedCv).map(canonicalizeTerm).filter(Boolean)
  );

  let same = 0;
  for (const line of orig) {
    if (optSet.has(line)) same++;
  }

  return { same, total: orig.length };
}

function looksLikeCertification(term = "") {
  return CERTIFICATION_RE.test(String(term || "").trim());
}

function looksLikeAcronym(term = "") {
  const raw = String(term || "").trim();
  return ACRONYM_RE.test(raw) || /^[A-Z0-9/+.-]{2,10}$/.test(raw);
}

function looksLikeToolOrMethod(term = "", roleInput = []) {
  const profile = ensureRoleProfile(roleInput);
  const packs = getRolePacks(profile);
  const all = uniqueTrimmedStrings([
    ...HARD_FACT_TERMS,
    ...packs.flatMap((p) => [...(p.toolTerms || []), ...(p.methodologyTerms || [])]),
  ]);

  return all.some((x) => canonicalizeTerm(x) === canonicalizeTerm(term));
}

function getExplicitFactTerms(text = "") {
  const norm = canonicalizeTerm(text);
  return HARD_FACT_TERMS.filter((term, idx, arr) => {
    return containsCanonicalTermInNormalizedText(norm, term) && arr.indexOf(term) === idx;
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
    ]).map(canonicalizeTerm)
  );

  return uniqueTrimmedStrings(getExplicitFactTerms(optimizedCv)).filter(
    (term) => !allowed.has(canonicalizeTerm(term))
  );
}

function getSentenceSignalProfile(sentence = "", roleInput = []) {
  const s = String(sentence || "").trim();
  const profile = ensureRoleProfile(roleInput);
  const roleSpecificRe = getRoleSpecificityRegex(profile);
  const roleBusinessRe = getRoleBusinessContextRegex(profile);
  const packs = getRolePacks(profile);

  if (!s) {
    return {
      isWeakCandidate: false,
      weakScore: 0,
      strongScore: 0,
      hasSpecific: false,
      startsWeak: false,
      hasWeakPhrase: false,
    };
  }

  const wc = countWords(s);
  const explicitFacts = getExplicitFactTerms(s);
  const packSpecificTerms = uniqueTrimmedStrings(
    packs.flatMap((p) => [
      ...(p.strongTerms || []),
      ...(p.toolTerms || []),
      ...(p.methodologyTerms || []),
      ...(p.responsibilityTerms || []),
    ])
  );

  const roleSpecificHits = countTermHits(s, packSpecificTerms);
  const businessHits = countTermHits(
    s,
    uniqueTrimmedStrings(
      packs.flatMap((p) => p.businessContextTerms || [])
    )
  );

  const hasNumber = /\b\d+(?:[.,]\d+)?%?\b/.test(s);
  const hasAcronym = looksLikeAcronym(s);
  const strongAction = STRONG_ACTION_RE.test(s);
  const startsWeak = WEAK_START_RE.test(s);
  const hasWeakPhrase = WEAK_PHRASE_RE.test(s) || WEAK_SENTENCE_RE.test(s);
  const genericSummary = GENERIC_SUMMARY_RE.test(s);
  const dutiesOnly = DUTIES_ONLY_RE.test(s);
  const hasScopeSignal =
    /\b(using|with|for|across|through|via|by|on|under|according to|per|kullanarak|ile|için|kapsamında|üzerinde|aracılığıyla)\b/i.test(
      s
    );

  const hasSpecific =
    hasNumber ||
    explicitFacts.length > 0 ||
    roleSpecificHits > 0 ||
    roleSpecificRe.test(s) ||
    (businessHits >= 2 && strongAction) ||
    (roleBusinessRe.test(s) && strongAction) ||
    GLOBAL_STRONG_SPECIFIC_RE.test(s) ||
    (hasAcronym && wc <= 18);

  let strongScore = 0;
  let weakScore = 0;

  if (strongAction) strongScore += 3;
  if (hasNumber) strongScore += 2;
  if (explicitFacts.length > 0) strongScore += Math.min(3, explicitFacts.length);
  if (roleSpecificHits > 0) strongScore += Math.min(4, roleSpecificHits);
  if (businessHits > 0) strongScore += Math.min(2, businessHits);
  if (hasScopeSignal) strongScore += 1;
  if (wc >= 6 && wc <= 22) strongScore += 1;

  if (startsWeak) weakScore += 4;
  if (hasWeakPhrase) weakScore += 3;
  if (genericSummary) weakScore += 3;
  if (dutiesOnly) weakScore += 2;
  if (!hasSpecific) weakScore += 2;
  if (!strongAction) weakScore += 1;
  if (wc <= 5) weakScore += 3;
  else if (wc <= 8 && !hasSpecific) weakScore += 2;
  if (wc > 28) weakScore += 1;

  if (hasSpecific && strongAction) weakScore -= 3;
  if (hasNumber && explicitFacts.length > 0) weakScore -= 1;

  const isWeakCandidate =
    (weakScore >= 5 && strongScore <= 6) ||
    (startsWeak && strongScore < 7) ||
    (genericSummary && !hasSpecific);

  return {
    isWeakCandidate,
    weakScore,
    strongScore,
    hasSpecific,
    startsWeak,
    hasWeakPhrase,
    strongAction,
    wordCount: wc,
  };
}

function countWeakVerbHits(cv = "", roleInput = []) {
  const bullets = getBulletLines(cv);
  return bullets.filter((b) => getSentenceSignalProfile(b, roleInput).isWeakCandidate).length;
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
  const lines = getNonEmptyLines(optimizedCv).map(canonicalizeTerm);
  if (!lines.length) return 0;

  let hits = 0;
  for (const item of Array.isArray(weakSentences) ? weakSentences : []) {
    const source = canonicalizeTerm(String(item?.sentence || ""));
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
  if (canonicalizeTerm(s) === canonicalizeTerm(r)) return true;
  if (sim >= 0.86) return true;

  const sWords = countWords(s);
  const rWords = countWords(r);

  if (ENGLISH_WEAK_SWAP_RE.test(s) && ENGLISH_WEAK_SWAP_RE.test(r) && sim >= 0.55) {
    return true;
  }

  if (rWords >= sWords + 10 && sim >= 0.58) return true;
  return false;
}

function hasUnsupportedImpactClaims(originalText = "", candidateText = "") {
  const orig = String(originalText || "");
  const opt = String(candidateText || "");
  return EN_UNSUPPORTED_IMPACT_RE.test(opt) && !EN_UNSUPPORTED_IMPACT_RE.test(orig);
}

function isClearlyWeakSentence(sentence = "", roleInput = []) {
  return getSentenceSignalProfile(sentence, roleInput).isWeakCandidate;
}

function filterWeakSentences(items = [], { outLang = "", roleInput = [] } = {}) {
  return (Array.isArray(items) ? items : [])
    .map((x) => ({
      sentence: String(x?.sentence || "").trim(),
      rewrite: String(x?.rewrite || "").trim(),
    }))
    .filter((x) => x.sentence && x.rewrite)
    .filter((x) => canonicalizeTerm(x.sentence) !== canonicalizeTerm(x.rewrite))
    .map((x) => {
      const sourceProfile = getSentenceSignalProfile(x.sentence, roleInput);
      const rewriteProfile = getSentenceSignalProfile(x.rewrite, roleInput);
      return { ...x, sourceProfile, rewriteProfile };
    })
    .filter((x) => x.sourceProfile.isWeakCandidate)
    .filter((x) => !isShallowRewrite(x.sentence, x.rewrite))
    .filter((x) => x.rewriteProfile.strongScore >= x.sourceProfile.strongScore)
    .filter((x) => x.rewriteProfile.weakScore <= x.sourceProfile.weakScore + 1)
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
    .sort((a, b) => {
      const aDelta = a.sourceProfile.weakScore - a.rewriteProfile.weakScore;
      const bDelta = b.sourceProfile.weakScore - b.rewriteProfile.weakScore;
      return (
        b.sourceProfile.weakScore - a.sourceProfile.weakScore ||
        bDelta - aDelta ||
        a.sourceProfile.strongScore - b.sourceProfile.strongScore
      );
    })
    .slice(0, 12)
    .map(({ sentence, rewrite }) => ({ sentence, rewrite }));
}

function normalizeBulletUpgrades(items = [], outLang = "", roleInput = []) {
  const seen = new Set();
  const out = [];

  for (const item of Array.isArray(items) ? items : []) {
    const source = String(item?.source || item?.sentence || "").trim();
    const rewrite = String(item?.rewrite || item?.after || "").trim();
    const reason = String(item?.reason || "").trim();

    if (!source || !rewrite) continue;
    if (!isClearlyWeakSentence(source, roleInput)) continue;
    if (isShallowRewrite(source, rewrite)) continue;

    const sourceProfile = getSentenceSignalProfile(source, roleInput);
    const rewriteProfile = getSentenceSignalProfile(rewrite, roleInput);

    if (rewriteProfile.strongScore < sourceProfile.strongScore) continue;
    if (rewriteProfile.weakScore > sourceProfile.weakScore + 1) continue;

    if (outLang === "English") {
      if (EN_WEAK_REWRITE_START_RE.test(rewrite)) continue;
      if (ENGLISH_WEAK_SWAP_RE.test(rewrite)) continue;
      if (hasUnsupportedImpactClaims(source, rewrite)) continue;
      if (ENGLISH_CORPORATE_FLUFF_RE.test(rewrite) && !ENGLISH_CORPORATE_FLUFF_RE.test(source)) continue;
      if (EN_SOFT_FILLER_RE.test(rewrite) && !EN_SOFT_FILLER_RE.test(source)) continue;
    }

    const key = `${canonicalizeTerm(source)}__${canonicalizeTerm(rewrite)}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({ source, rewrite, reason, sourceProfile, rewriteProfile });
  }

  return out
    .sort((a, b) => {
      const aDelta = a.sourceProfile.weakScore - a.rewriteProfile.weakScore;
      const bDelta = b.sourceProfile.weakScore - b.rewriteProfile.weakScore;
      return (
        b.sourceProfile.weakScore - a.sourceProfile.weakScore ||
        bDelta - aDelta ||
        b.rewriteProfile.strongScore - a.rewriteProfile.strongScore
      );
    })
    .slice(0, 8)
    .map(({ source, rewrite, reason }) => ({ source, rewrite, reason }));
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

    const origSoft = EN_SOFT_FILLER_RE.test(orig);
    const optSoft = EN_SOFT_FILLER_RE.test(opt);
    if (!origSoft && optSoft) hits += 1;
  }

  return hits;
}

function cleanKeywordCandidate(term = "") {
  return String(term || "")
    .replace(/\r/g, " ")
    .replace(/^[-•·‣▪▫◦0-9.)\s]+/, "")
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
  if (/^(experience|knowledge|skills|skill|management|analysis|support|reporting|communication|documentation|tecrube|deneyim|beceri|yetenek|analiz|destek|raporlama)$/i.test(norm)) {
    return true;
  }

  return false;
}

function extractAcronymLikeTerms(text = "") {
  return uniqueTrimmedStrings(
    (String(text || "").match(/\b[A-Z]{2,}(?:\/[A-Z]{2,})?\b/g) || [])
      .map((x) => String(x || "").trim())
      .filter((x) => x.length <= 12)
  );
}

function extractSkillLikeNgrams(text = "") {
  const clauses = String(text || "")
    .replace(/\r/g, "\n")
    .split(/[\n;•]/)
    .map((x) => x.trim())
    .filter(Boolean)
    .slice(0, 120);

  const out = [];

  for (const clause of clauses) {
    const tokens = clause
      .replace(/[^\p{L}\p{N}\s/#&+.-]/gu, " ")
      .split(/\s+/)
      .map((x) => x.trim())
      .filter(Boolean);

    for (let n = 4; n >= 1; n--) {
      for (let i = 0; i <= tokens.length - n; i++) {
        const phrase = tokens.slice(i, i + n).join(" ").trim();
        const norm = canonicalizeTerm(phrase);
        const wc = countWords(phrase);
        if (!norm || wc < 1 || wc > 4) continue;
        if (isLowValueKeyword(phrase)) continue;

        const hasHint = SKILL_NGRAM_HINTS.some((hint) =>
          containsCanonicalTermInNormalizedText(norm, hint)
        );

        if (hasHint || looksLikeAcronym(phrase) || looksLikeCertification(phrase)) {
          out.push(phrase);
        }
      }
    }
  }

  return uniqueByNormalizedStrings(out).slice(0, 80);
}

function classifyTermCategory(term = "", roleInput = []) {
  const profile = ensureRoleProfile(roleInput);
  const packs = getRolePacks(profile);
  const packToolTerms = uniqueTrimmedStrings(packs.flatMap((p) => p.toolTerms || []));
  const packMethodologyTerms = uniqueTrimmedStrings(packs.flatMap((p) => p.methodologyTerms || []));
  const packResponsibilityTerms = uniqueTrimmedStrings(packs.flatMap((p) => p.responsibilityTerms || []));

  if (looksLikeCertification(term)) return "certification";
  if (
    packToolTerms.some((x) => canonicalizeTerm(x) === canonicalizeTerm(term)) ||
    HARD_FACT_TERMS.some((x) => canonicalizeTerm(x) === canonicalizeTerm(term))
  ) {
    return "tool";
  }
  if (packMethodologyTerms.some((x) => canonicalizeTerm(x) === canonicalizeTerm(term))) {
    return "methodology";
  }
  if (
    /\b(senior|lead|manager|director|principal|junior|associate|intern|uzman|kidemli|stajyer)\b/i.test(
      term
    )
  ) {
    return "seniority";
  }
  if (packResponsibilityTerms.some((x) => canonicalizeTerm(x) === canonicalizeTerm(term))) {
    return "responsibility";
  }
  return "domain";
}

function scoreExtractedTerm(term = "", text = "", roleInput = []) {
  const profile = ensureRoleProfile(roleInput);
  const packs = getRolePacks(profile);
  const cleaned = cleanKeywordCandidate(term);
  if (!cleaned) return 0;

  let score = 0;
  const wc = countWords(cleaned);
  const norm = canonicalizeTerm(cleaned);

  if (isLowValueKeyword(cleaned)) score -= 10;
  if (wc >= 2 && wc <= 4) score += 4;
  else if (looksLikeAcronym(cleaned)) score += 3;

  if (looksLikeCertification(cleaned)) score += 5;

  const packSpecificTerms = uniqueTrimmedStrings(
    packs.flatMap((p) => getRolePackAllTerms(p))
  );

  if (packSpecificTerms.some((x) => canonicalizeTerm(x) === norm)) score += 5;
  if (HARD_FACT_TERMS.some((x) => canonicalizeTerm(x) === norm)) score += 6;

  const occurrences = countOccurrencesNormalized(text, cleaned);
  score += Math.min(4, Math.max(0, occurrences - 1));

  const exactCueBefore = new RegExp(
    `${JD_CUE_RE.source}[\\s\\S]{0,80}${escapeRegex(cleaned)}`,
    "i"
  ).test(String(text || ""));
  const exactCueAfter = new RegExp(
    `${escapeRegex(cleaned)}[\\s\\S]{0,40}${JD_CUE_RE.source}`,
    "i"
  ).test(String(text || ""));

  if (exactCueBefore || exactCueAfter) score += 3;

  return score;
}

function extractJdSignalProfile(jd = "", roleInput = []) {
  if (!String(jd || "").trim()) {
    return {
      ranked: [],
      tools: [],
      methodologies: [],
      certifications: [],
      responsibilities: [],
      domains: [],
      senioritySignals: [],
    };
  }

  const profile = ensureRoleProfile(roleInput);
  const packs = getRolePacks(profile);

  const lexiconTerms = uniqueTrimmedStrings([
    ...HARD_FACT_TERMS,
    ...packs.flatMap((p) => getRolePackAllTerms(p)),
    ...packs.flatMap((p) => p.suggestedKeywords || []),
  ]);

  const jdNorm = canonicalizeTerm(jd);

  const directMatches = lexiconTerms.filter((term) =>
    containsCanonicalTermInNormalizedText(jdNorm, term)
  );

  const ngrams = extractSkillLikeNgrams(jd);
  const acronyms = extractAcronymLikeTerms(jd);

  const candidates = uniqueByNormalizedStrings([...directMatches, ...ngrams, ...acronyms]);

  const ranked = candidates
    .map((term) => ({
      term,
      category: classifyTermCategory(term, profile),
      score: scoreExtractedTerm(term, jd, profile),
    }))
    .filter((x) => x.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, 40);

  return {
    ranked,
    tools: ranked.filter((x) => x.category === "tool").slice(0, 10).map((x) => x.term),
    methodologies: ranked
      .filter((x) => x.category === "methodology")
      .slice(0, 10)
      .map((x) => x.term),
    certifications: ranked
      .filter((x) => x.category === "certification")
      .slice(0, 8)
      .map((x) => x.term),
    responsibilities: ranked
      .filter((x) => x.category === "responsibility")
      .slice(0, 10)
      .map((x) => x.term),
    domains: ranked
      .filter((x) => x.category === "domain")
      .slice(0, 10)
      .map((x) => x.term),
    senioritySignals: ranked
      .filter((x) => x.category === "seniority")
      .slice(0, 6)
      .map((x) => x.term),
  };
}

function buildJdSignalText(jd = "", roleInput = []) {
  const sig = extractJdSignalProfile(jd, roleInput);
  return [
    `- tools_platforms: ${sig.tools.join(", ") || "(none)"}`,
    `- methodologies_process: ${sig.methodologies.join(", ") || "(none)"}`,
    `- certifications_compliance: ${sig.certifications.join(", ") || "(none)"}`,
    `- responsibility_patterns: ${sig.responsibilities.join(", ") || "(none)"}`,
    `- domain_terms: ${sig.domains.join(", ") || "(none)"}`,
    `- seniority_signals: ${sig.senioritySignals.join(", ") || "(none)"}`,
  ].join("\n");
}

function extractTopJdTerms(jd = "", roleInput = []) {
  return extractJdSignalProfile(jd, roleInput).ranked.map((x) => x.term).slice(0, 40);
}

function finalizeMissingKeywords(
  rawKeywords = [],
  { cv = "", jd = "", roleInput = [], outLang = "English", hasJD = false, limit = 12 } = {}
) {
  const profile = ensureRoleProfile(roleInput, cv, jd);
  const cvNorm = canonicalizeTerm(cv);

  const modelTerms = uniqueByNormalizedStrings(
    (Array.isArray(rawKeywords) ? rawKeywords : [])
      .map(cleanKeywordCandidate)
      .filter(Boolean)
  );

  let pool = [...modelTerms];

  if (outLang === "English") {
    if (hasJD) {
      const jdTerms = extractJdSignalProfile(jd, profile).ranked.map((x) => x.term);
      pool = uniqueByNormalizedStrings([...pool, ...jdTerms]);
    } else {
      pool = uniqueByNormalizedStrings([...pool, ...getSuggestedKeywords(profile)]);
    }
  }

  const packs = getRolePacks(profile);
  const roleSignals = uniqueTrimmedStrings([
    ...getSuggestedKeywords(profile),
    ...packs.flatMap((p) => getRolePackAllTerms(p)),
  ]);

  const scored = uniqueByNormalizedStrings(pool)
    .map((term) => {
      const norm = canonicalizeTerm(term);
      let score = 0;

      if (containsCanonicalTermInNormalizedText(cvNorm, norm)) {
        score -= hasJD ? 12 : 10;
      } else {
        score += 6;
      }

      if (hasJD && String(jd || "").trim()) {
        if (containsCanonicalTermInNormalizedText(canonicalizeTerm(jd), norm)) score += 10;
      } else {
        if (
          roleSignals.some(
            (x) =>
              canonicalizeTerm(x) === norm ||
              canonicalizeTerm(x).includes(norm) ||
              norm.includes(canonicalizeTerm(x))
          )
        ) {
          score += 5;
        }
      }

      if (HARD_FACT_TERMS.some((x) => canonicalizeTerm(x) === norm)) score += 6;
      if (looksLikeCertification(term)) score += 5;
      if (looksLikeToolOrMethod(term, profile)) score += 4;

      const wc = countWords(term);
      if (wc >= 2 && wc <= 4) score += 3;
      if (looksLikeAcronym(term)) score += 2;
      if (isLowValueKeyword(term)) score -= 12;

      return { term, score };
    })
    .filter((x) => x.score > -2)
    .sort((a, b) => b.score - a.score || countWords(b.term) - countWords(a.term));

  return scored.map((x) => x.term).slice(0, limit);
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
      out.push(line.replace(/^[-•·‣▪▫◦]\s+/, "").trim());
    }
  }

  return out.filter(Boolean);
}

function getKeywordBreadthScore(cv = "", jd = "", roleInput = []) {
  const profile = ensureRoleProfile(roleInput, cv, jd);
  const textNorm = canonicalizeTerm(cv);
  const skills = uniqueTrimmedStrings(getSkillsLines(cv));
  const packs = getRolePacks(profile);

  let score = 0;
  score += Math.min(8, skills.length);

  const hardHits = HARD_FACT_TERMS.filter((term) =>
    containsCanonicalTermInNormalizedText(textNorm, term)
  ).length;
  score += Math.min(4, hardHits);

  const roleRelevantTerms = uniqueTrimmedStrings(
    packs.flatMap((p) => [
      ...(p.strongTerms || []),
      ...(p.toolTerms || []),
      ...(p.methodologyTerms || []),
      ...(p.responsibilityTerms || []),
    ])
  );

  const relevantHits = roleRelevantTerms.filter((term) =>
    containsCanonicalTermInNormalizedText(textNorm, term)
  ).length;
  score += Math.min(5, relevantHits);

  const titleHits = countTermHits(
    `${extractHeaderBlock(cv).join(" ")} ${extractExperienceTitles(cv).join(" ")}`,
    packs.flatMap((p) => p.titles || [])
  );
  score += Math.min(2, titleHits);

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

function getBulletStrengthScore(cv = "", roleInput = []) {
  const bullets = getBulletLines(cv);
  if (!bullets.length) return 0;

  let sum = 0;

  for (const bullet of bullets) {
    const p = getSentenceSignalProfile(bullet, roleInput);
    let value = 4;
    value += p.strongScore * 1.5;
    value -= p.weakScore * 1.3;
    if (p.hasSpecific) value += 1;
    sum += Math.max(0, Math.min(12, value));
  }

  const avg = sum / bullets.length;
  return Math.max(0, Math.min(40, Math.round((avg / 12) * 40)));
}

function getJdAlignmentScore(cv = "", jd = "", roleInput = []) {
  if (!jd || !String(jd).trim()) return 0;

  const cvText = canonicalizeTerm(cv);
  const signals = extractJdSignalProfile(jd, roleInput).ranked;
  if (!signals.length) return 0;

  let totalWeight = 0;
  let hitWeight = 0;

  for (const item of signals.slice(0, 24)) {
    let w = 1;
    if (item.category === "tool" || item.category === "certification") w = 1.35;
    else if (item.category === "methodology") w = 1.2;
    else if (item.category === "seniority") w = 0.8;

    totalWeight += w;
    if (containsCanonicalTermInNormalizedText(cvText, item.term)) {
      hitWeight += w;
    }
  }

  const ratio = totalWeight > 0 ? hitWeight / totalWeight : 0;
  return Math.max(0, Math.min(10, Math.round(ratio * 10)));
}

function computeDeterministicAtsScore(cv = "", jd = "", roleInput = []) {
  const hasJD = !!String(jd || "").trim();
  const profile = ensureRoleProfile(roleInput, cv, jd);

  const sectionScore = getSectionPresenceScore(cv);
  const bulletScore = getBulletStrengthScore(cv, profile);
  const readabilityScore = getReadabilityScore(cv);
  const keywordScore = getKeywordBreadthScore(cv, jd, profile);
  const jdScore = getJdAlignmentScore(cv, jd, profile);

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
        ats_safe_formatting * 0.1
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

  const origNorm = canonicalizeTerm(originalCv);
  const optNorm = canonicalizeTerm(optimizedCv);

  if (!optNorm || origNorm === optNorm) return base;

  const roleProfile = inferRoleProfile(originalCv, jd);
  const rescoredOptimized = computeDeterministicAtsScore(optimizedCv, jd, roleProfile);
  const rawLift = Math.max(0, rescoredOptimized - base);

  const weakBefore = countWeakVerbHits(originalCv, roleProfile);
  const weakAfter = countWeakVerbHits(optimizedCv, roleProfile);
  const weakGain = Math.max(0, weakBefore - weakAfter);

  const { same, total } = countUnchangedBullets(originalCv, optimizedCv);
  const rewriteRatio = total > 0 ? 1 - same / total : 0;

  let lift = 0;
  lift += rawLift * 0.48;
  lift += Math.min(4, weakGain) * 0.9;

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
  roleInput = []
) {
  const roleProfile = ensureRoleProfile(roleInput, originalCv, jd);

  if (!optimizedCv || !String(optimizedCv).trim()) return true;

  const origNorm = canonicalizeTerm(originalCv);
  const optNorm = canonicalizeTerm(optimizedCv);

  if (!optNorm) return true;
  if (origNorm === optNorm) return true;

  const { same, total } = countUnchangedBullets(originalCv, optimizedCv);
  if (total > 0 && same / total >= 0.4) return true;

  const optimizedBullets = getBulletLines(optimizedCv);
  if (total > 0 && optimizedBullets.length < Math.max(2, Math.floor(total * 0.7))) {
    return true;
  }

  const weakBefore = countWeakVerbHits(originalCv, roleProfile);
  const weakAfter = countWeakVerbHits(optimizedCv, roleProfile);
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

  if (countWeakVerbHits(optimizedCv, roleProfile) >= 2) return true;
  if (countWeakEnglishRewriteStarts(optimizedCv) >= 2) return true;
  if (hasUnsupportedImpactClaims(originalCv, optimizedCv)) return true;
  if (findUnsupportedTerms(originalCv, jd, optimizedCv).length > 0) return true;

  const roleSpecificRe = getRoleSpecificityRegex(roleProfile);
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
- Never remove useful specificity such as tools, metrics, platforms, channels, technical context, domain terminology, process context, certifications, or compliance signals.
- If a bullet has no measurable metric, improve it using scope + action + context + purpose wording WITHOUT inventing numbers.
- If the original sentence is support-oriented, you may strengthen clarity, but do NOT upgrade it into leadership or full ownership unless clearly supported.
- Weak sentence detection must prioritize genuinely weak, vague, generic, or support-heavy phrasing.
- Do NOT flag already-strong sentences as weak just because they can be polished slightly.
- Sentences that already contain concrete tools, platforms, technical detail, process detail, domain terminology, or strong action verbs should usually NOT be selected as weak unless they are still clearly vague and can be improved without losing specificity.
- Rewrites must be materially better than the original.
- Do NOT make shallow synonym swaps or near-duplicate rewrites.
- Each rewrite must improve at least two of these:
  clarity, specificity, scope, action strength, business context, recruiter readability.
- If a rewrite is too similar to the original, rewrite it again more strongly.
- Keep optimized_cv ATS-friendly, clean, realistic, and parser-friendly.
- For English output, write like a strong US resume writer, not a marketing copywriter.
- Premium quality means: grounded, concise, specific, recruiter-ready, and profession-aware.
- For technical, analytical, finance, engineering, education, healthcare, design, operations, product, project, or support roles, preserve the native terminology of that profession. Do NOT rewrite them into generic marketing/admin language.
- missing_keywords must prioritize these when relevant:
  hard skills, tools/platforms, methodologies, certifications, domain terms, responsibility patterns, seniority signals.
- Avoid low-value filler missing keywords unless they are unusually material to the role.

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

function buildEnglishStyleBlock(roleInput = []) {
  const roleWritingBlock = buildRoleWritingBlock(roleInput);
  return `
ENGLISH WRITING STYLE:
- Write like a strong US resume, not marketing copy.
- Keep bullets concise, concrete, and natural.
- Prefer 9-18 words per bullet when possible.
- Prefer one clear pattern: action + scope + tool/channel/context + purpose.
- If no tool is present, use action + task scope + business/process context.
- For technical, financial, operational, educational, design, support, healthcare, or engineering bullets, preserve the real language of that profession.
- Do NOT convert implementation work into vague strategy wording.
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

function buildPreviewAtsPrompt({ cv, jd, hasJD, outLang, roleProfile }) {
  const englishStyleBlock = outLang === "English" ? buildEnglishStyleBlock(roleProfile) : "";
  const roleContextText = buildRoleContextText(roleProfile);
  const jdSignalText = hasJD ? buildJdSignalText(jd, roleProfile) : "";
  const likelyKeywordThemeText = buildLikelyKeywordThemeText(roleProfile);

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
- Prioritize:
  hard skills, tools/platforms, methodologies, certifications, domain terms, responsibility patterns, seniority expectations.
- Avoid generic filler keywords unless they are unusually material to the job.
- missing_keywords MUST be unique, role-relevant, and written in ${outLang}.
- weak_sentences MUST include up to 2 items picked from real resume sentences.
- Do NOT force the count.
- Both sentence and rewrite MUST be in ${outLang}.
- Select only sentences that are genuinely weak, vague, generic, low-value, or support-heavy.
- Do NOT select already-strong technical or functional bullets that already contain concrete tools, platforms, process detail, or domain terminology unless the rewrite clearly preserves that specificity and materially improves the line.
- Prefer weak experience bullets first, then summary only if necessary.
- Rewrites must be clearly stronger, not cosmetic.
- summary MUST be 4-6 bullet lines in ${outLang}.
- summary must focus on job fit, biggest missing keywords, ATS risks, and top improvements.
- Do NOT add extra keys. Do NOT add optimized_cv.

ROLE CONTEXT:
${roleContextText}

RANKED JD SIGNALS:
${jdSignalText}

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
- These are NOT job-specific missing keywords.
- They should be recommended ATS/recruiter-friendly resume terms based on the candidate's apparent role, seniority, and experience.
- Prioritize role-specific tools, methods, certifications, responsibility terms, and domain phrases over generic soft-skill filler.
- missing_keywords MUST be unique, practical, role-relevant, and written in ${outLang}.
- weak_sentences MUST include up to 2 items picked from real resume sentences.
- Do NOT force the count.
- Both sentence and rewrite MUST be in ${outLang}.
- Select only sentences that are genuinely weak, vague, generic, low-value, or support-heavy.
- Do NOT select already-strong technical or functional bullets that already contain concrete tools, platforms, process detail, or domain terminology unless the rewrite clearly preserves that specificity and materially improves the line.
- Prefer weak experience bullets first, then summary only if necessary.
- Rewrites must be clearly stronger, not cosmetic.
- summary MUST be 4-6 bullet lines in ${outLang}.
- summary must focus on general ATS readiness, structure, clarity, and top improvement areas.
- Do NOT add extra keys. Do NOT add optimized_cv.

ROLE CONTEXT:
${roleContextText}

LIKELY ATS THEMES:
${likelyKeywordThemeText}

${englishStyleBlock}

RESUME:
${cv}
`.trim();
}

function buildFullAtsAnalysisPrompt({ cv, jd, hasJD, outLang, roleProfile }) {
  const englishStyleBlock = outLang === "English" ? buildEnglishStyleBlock(roleProfile) : "";
  const roleContextText = buildRoleContextText(roleProfile);
  const jdSignalText = hasJD ? buildJdSignalText(jd, roleProfile) : "";
  const likelyKeywordThemeText = buildLikelyKeywordThemeText(roleProfile);

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
- Prioritize:
  hard skills, tools/platforms, methodologies, certifications, domain terms, responsibility patterns, seniority signals.
- Avoid low-value filler keywords unless truly material.
- missing_keywords MUST be unique, role-relevant, and written in ${outLang}.
- weak_sentences MUST include 7-12 items from the resume text when genuinely weak examples exist.
- Do NOT force the count if there are fewer genuinely weak examples.
- Both sentence and rewrite MUST be in ${outLang}.
- Only select genuinely weak, vague, generic, or support-heavy sentences.
- Do NOT select sentences as weak if they already contain concrete tools, platforms, process detail, technical detail, or domain terminology unless the rewrite preserves all specificity and is clearly much stronger.
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

RANKED JD SIGNALS:
${jdSignalText}

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
- These are NOT job-specific missing keywords.
- They must be recommended ATS/recruiter-friendly resume terms based on the candidate's likely role, seniority, and experience.
- Prioritize role-specific tools, methods, certifications, responsibility patterns, and domain phrases over generic soft-skill filler.
- missing_keywords MUST be unique, practical, and written in ${outLang}.
- weak_sentences MUST include 8-12 items from the resume text when genuinely weak examples exist.
- Do NOT force the count if there are fewer genuinely weak examples.
- Both sentence and rewrite MUST be in ${outLang}.
- Only select genuinely weak, vague, generic, or support-heavy sentences.
- Do NOT select sentences as weak if they already contain concrete tools, platforms, process detail, technical detail, or domain terminology unless the rewrite preserves all specificity and is clearly much stronger.
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

LIKELY ATS THEMES:
${likelyKeywordThemeText}

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
  roleProfile,
}) {
  const englishStyleBlock = outLang === "English" ? buildEnglishStyleBlock(roleProfile) : "";
  const roleContextText = buildRoleContextText(roleProfile);
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
- Keep the profession-native language of the source sentence. Technical bullets must stay technical, finance bullets must stay finance-oriented, teaching bullets must stay instructional, and so on.
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
- Keep the profession-native language of the source sentence. Technical bullets must stay technical, finance bullets must stay finance-oriented, teaching bullets must stay instructional, and so on.
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
  roleProfile,
}) {
  const keywordsText = Array.isArray(missingKeywords) ? missingKeywords.join(", ") : "";
  const allowedTermsText = buildAllowedTermsText(cv, jd);
  const englishStyleBlock = outLang === "English" ? buildEnglishStyleBlock(roleProfile) : "";
  const roleContextText = buildRoleContextText(roleProfile);
  const priorityRewriteText = buildPriorityRewriteText(bulletUpgrades);
  const jdSignalText = hasJD ? buildJdSignalText(jd, roleProfile) : "";
  const likelyKeywordThemeText = buildLikelyKeywordThemeText(roleProfile);

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
- The final resume should feel premium: concise, grounded, specific, recruiter-ready, and materially stronger than the original.
- Preserve profession-native language. Technical content must stay technical, finance content must stay finance-specific, education content must stay instructional, etc.

ROLE CONTEXT:
${roleContextText}

RANKED JD SIGNALS:
${jdSignalText}

ALLOWED EXPLICIT TOOLS / PLATFORMS / ACRONYMS:
${allowedTermsText}

HARD FACT LOCK:
- You may use only tools, platforms, acronyms, channels, methodologies, and business concepts explicitly present in the resume.
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
- Preserve specific tools, metrics, channels, methodologies, and domain terms already present.
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
- The final resume should feel premium: concise, grounded, specific, recruiter-ready, and materially stronger than the original.
- Preserve profession-native language. Technical content must stay technical, finance content must stay finance-specific, education content must stay instructional, etc.

ROLE CONTEXT:
${roleContextText}

LIKELY ATS THEMES:
${likelyKeywordThemeText}

ALLOWED EXPLICIT TOOLS / PLATFORMS / ACRONYMS:
${allowedTermsText}

HARD FACT LOCK:
- You may use only tools, platforms, acronyms, channels, methodologies, and business concepts explicitly present in the resume.
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
- Preserve specific tools, metrics, channels, methodologies, and domain terms already present.
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
  roleProfile,
}) {
  const keywordsText = Array.isArray(missingKeywords) ? missingKeywords.join(", ") : "";
  const allowedTermsText = buildAllowedTermsText(cv, jd);
  const englishStyleBlock = outLang === "English" ? buildEnglishStyleBlock(roleProfile) : "";
  const unsupportedText =
    Array.isArray(unsupportedTerms) && unsupportedTerms.length
      ? unsupportedTerms.join(", ")
      : "(none)";
  const roleContextText = buildRoleContextText(roleProfile);
  const priorityRewriteText = buildPriorityRewriteText(bulletUpgrades);
  const jdSignalText = hasJD ? buildJdSignalText(jd, roleProfile) : "";
  const likelyKeywordThemeText = buildLikelyKeywordThemeText(roleProfile);

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
- Preserve profession-native language. Technical content must stay technical, finance content must stay finance-specific, education content must stay instructional, etc.

ROLE CONTEXT:
${roleContextText}

RANKED JD SIGNALS:
${jdSignalText}

ALLOWED EXPLICIT TOOLS / PLATFORMS / ACRONYMS:
${allowedTermsText}

REMOVE THESE UNSUPPORTED TERMS IF PRESENT:
${unsupportedText}

PRIORITY REWRITE TARGETS:
${priorityRewriteText}

HARD FACT LOCK:
- You may use only tools, platforms, acronyms, channels, methodologies, and business concepts explicitly present in the original resume.
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
- Preserve profession-native language. Technical content must stay technical, finance content must stay finance-specific, education content must stay instructional, etc.

ROLE CONTEXT:
${roleContextText}

LIKELY ATS THEMES:
${likelyKeywordThemeText}

ALLOWED EXPLICIT TOOLS / PLATFORMS / ACRONYMS:
${allowedTermsText}

REMOVE THESE UNSUPPORTED TERMS IF PRESENT:
${unsupportedText}

PRIORITY REWRITE TARGETS:
${priorityRewriteText}

HARD FACT LOCK:
- You may use only tools, platforms, acronyms, channels, methodologies, and business concepts explicitly present in the original resume.
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
    const roleProfile = inferRoleProfile(cv, jd);
    const roleGroups = roleProfile.roleGroups;

    console.log("ROLE PROFILE", roleProfile);

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
            roleProfile,
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

      const deterministicScore = computeDeterministicAtsScore(cv, jd, roleProfile);
      const modelComponentScore = computeComponentScore(componentScores, hasJD);
      const mergedPreviewScore = clampScore(
        Math.round(deterministicScore * 0.8 + modelComponentScore * 0.2)
      );

      const normalized = {
        ats_score: mergedPreviewScore,
        component_scores: componentScores,
        missing_keywords: finalizeMissingKeywords(
          Array.isArray(previewData?.missing_keywords) ? previewData.missing_keywords : [],
          {
            cv,
            jd,
            roleInput: roleProfile,
            outLang,
            hasJD,
            limit: 7,
          }
        ),
        weak_sentences: filterWeakSentences(
          Array.isArray(previewData?.weak_sentences) ? previewData.weak_sentences : [],
          { outLang, roleInput: roleProfile }
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
          roleProfile,
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

    const deterministicScore = computeDeterministicAtsScore(cv, jd, roleProfile);
    const modelComponentScore = computeComponentScore(componentScores, hasJD);
    const mergedBaseScore = clampScore(
      Math.round(deterministicScore * 0.8 + modelComponentScore * 0.2)
    );

    const normalized = {
      ats_score: mergedBaseScore,
      component_scores: componentScores,
      missing_keywords: finalizeMissingKeywords(
        Array.isArray(analysisData?.missing_keywords) ? analysisData.missing_keywords : [],
        {
          cv,
          jd,
          roleInput: roleProfile,
          outLang,
          hasJD,
          limit: hasJD ? 20 : 18,
        }
      ),
      weak_sentences: filterWeakSentences(
        Array.isArray(analysisData?.weak_sentences) ? analysisData.weak_sentences : [],
        { outLang, roleInput: roleProfile }
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
            roleProfile,
          }),
          isPreview: false,
          passType: "bullet",
          maxCompletionTokens: 1600,
        });

        bulletUpgrades = normalizeBulletUpgrades(
          Array.isArray(bulletData?.bullet_upgrades) ? bulletData.bullet_upgrades : [],
          outLang,
          roleProfile
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
          roleProfile,
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
        roleProfile
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
            roleProfile,
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
            roleProfile,
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
