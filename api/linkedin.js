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

const ROLE_FAMILIES = {
  software_engineering: {
    label: "Software Engineering",
    defaultHeadline: "Software Engineer",
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
      "feature development",
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
      "integration testing",
      "system design",
      "performance optimization",
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
    linkedinKeywords: [
      "software development",
      "api integration",
      "backend systems",
      "frontend development",
      "cloud services",
      "testing",
      "deployment",
    ],
    recruiterTerms: [
      "software engineer",
      "backend engineer",
      "frontend engineer",
      "full stack developer",
      "api",
      "microservices",
      "cloud",
      "testing",
    ],
  },
  qa: {
    label: "QA",
    defaultHeadline: "QA Specialist",
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
      "uat",
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
      "api testing",
    ],
    toolTerms: ["selenium", "cypress", "postman", "jira"],
    linkedinKeywords: [
      "quality assurance",
      "test execution",
      "defect tracking",
      "release testing",
      "test documentation",
    ],
    recruiterTerms: [
      "qa engineer",
      "software tester",
      "manual testing",
      "automation testing",
      "regression testing",
      "api testing",
    ],
  },
  data: {
    label: "Data & Analytics",
    defaultHeadline: "Data Analyst",
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
      "analytics",
      "dashboard",
      "reporting",
      "kpi",
      "trend analysis",
      "data validation",
      "performance metrics",
      "data visualization",
      "data modeling",
      "etl",
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
    toolTerms: ["sql", "python", "excel", "tableau", "power bi", "looker studio", "google sheets"],
    linkedinKeywords: [
      "dashboard reporting",
      "trend analysis",
      "kpi tracking",
      "data validation",
      "data visualization",
      "business reporting",
    ],
    recruiterTerms: [
      "data analyst",
      "bi analyst",
      "reporting analyst",
      "sql",
      "dashboard",
      "power bi",
      "tableau",
    ],
  },
  product: {
    label: "Product",
    defaultHeadline: "Product Professional",
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
      "acceptance criteria",
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
    linkedinKeywords: [
      "product roadmap",
      "requirements gathering",
      "feature planning",
      "release coordination",
      "stakeholder communication",
    ],
    recruiterTerms: [
      "product manager",
      "product owner",
      "backlog",
      "roadmap",
      "user stories",
      "agile",
    ],
  },
  project: {
    label: "Project & Program",
    defaultHeadline: "Project Professional",
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
      "resource coordination",
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
      "ms project",
      "primavera p6",
    ],
    toolTerms: ["jira", "confluence", "excel", "ms project", "primavera p6"],
    linkedinKeywords: [
      "timeline management",
      "deliverable coordination",
      "status reporting",
      "stakeholder communication",
      "project documentation",
    ],
    recruiterTerms: [
      "project coordinator",
      "project manager",
      "program coordinator",
      "timelines",
      "deliverables",
      "status reporting",
    ],
  },
  business_analysis: {
    label: "Business Analysis",
    defaultHeadline: "Business Analyst",
    titles: ["business analyst", "systems analyst", "process analyst", "operations analyst"],
    keywords: [
      "business requirements",
      "process analysis",
      "gap analysis",
      "workflow analysis",
      "stakeholder interviews",
      "documentation",
      "reporting",
      "process mapping",
      "uat",
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
      "workflow analysis",
    ],
    toolTerms: ["jira", "confluence", "excel", "sql", "power bi", "visio"],
    linkedinKeywords: [
      "requirements gathering",
      "process mapping",
      "workflow analysis",
      "stakeholder communication",
      "documentation",
    ],
    recruiterTerms: [
      "business analyst",
      "systems analyst",
      "requirements gathering",
      "process mapping",
      "workflow analysis",
    ],
  },
  marketing: {
    label: "Marketing",
    defaultHeadline: "Marketing Professional",
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
    linkedinKeywords: [
      "campaign reporting",
      "channel performance",
      "audience targeting",
      "lead generation",
      "analytics reporting",
    ],
    recruiterTerms: [
      "digital marketing",
      "performance marketing",
      "google ads",
      "seo",
      "sem",
      "ga4",
    ],
  },
  sales: {
    label: "Sales",
    defaultHeadline: "Sales Professional",
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
      "account support",
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
    linkedinKeywords: [
      "sales pipeline",
      "lead management",
      "proposal preparation",
      "deal tracking",
      "client follow-up",
    ],
    recruiterTerms: [
      "sales executive",
      "account executive",
      "sales coordinator",
      "pipeline",
      "crm",
      "deal tracking",
    ],
  },
  customer_support: {
    label: "Customer Support",
    defaultHeadline: "Customer Support Professional",
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
      "case follow-up",
    ],
    strongTerms: [
      "customer support",
      "ticket",
      "issue resolution",
      "issue escalation",
      "email support",
      "live chat",
      "complaint handling",
      "help desk",
      "service requests",
      "case follow-up",
    ],
    toolTerms: ["zendesk", "freshdesk", "crm", "help desk"],
    linkedinKeywords: [
      "ticket handling",
      "issue resolution",
      "support documentation",
      "customer communication",
      "escalation handling",
    ],
    recruiterTerms: [
      "customer support",
      "technical support",
      "help desk",
      "ticket handling",
      "issue resolution",
      "zendesk",
    ],
  },
  customer_success: {
    label: "Customer Success",
    defaultHeadline: "Customer Success Professional",
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
    linkedinKeywords: [
      "customer onboarding",
      "account management",
      "renewal support",
      "relationship management",
      "customer retention",
    ],
    recruiterTerms: [
      "customer success",
      "client success",
      "account management",
      "onboarding",
      "renewal",
      "csat",
    ],
  },
  operations: {
    label: "Operations",
    defaultHeadline: "Operations Professional",
    titles: [
      "operations specialist",
      "operations coordinator",
      "operations analyst",
      "operations manager",
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
      "status updates",
      "task tracking",
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
      "task coordination",
      "record maintenance",
    ],
    toolTerms: ["excel", "office", "google sheets", "erp", "sap", "jira"],
    linkedinKeywords: [
      "workflow coordination",
      "status reporting",
      "process documentation",
      "cross-functional coordination",
      "record management",
    ],
    recruiterTerms: [
      "operations specialist",
      "operations coordinator",
      "workflow coordination",
      "reporting",
      "documentation",
      "process coordination",
    ],
  },
  procurement_supply_chain: {
    label: "Procurement & Supply Chain",
    defaultHeadline: "Procurement & Supply Chain Professional",
    titles: [
      "procurement specialist",
      "purchasing specialist",
      "buyer",
      "sourcing specialist",
      "procurement coordinator",
      "supply chain specialist",
      "logistics specialist",
      "logistics coordinator",
      "warehouse coordinator",
      "inventory specialist",
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
      "supply chain",
      "logistics",
      "inventory",
      "shipment coordination",
      "warehouse operations",
      "order fulfillment",
      "stock control",
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
      "inventory management",
      "warehouse management",
      "shipment tracking",
      "logistics coordination",
      "stock control",
      "order fulfillment",
      "sap",
      "erp",
    ],
    toolTerms: ["sap", "erp", "excel", "warehouse management"],
    linkedinKeywords: [
      "vendor coordination",
      "purchase order processing",
      "shipment tracking",
      "inventory management",
      "logistics coordination",
    ],
    recruiterTerms: [
      "procurement specialist",
      "buyer",
      "logistics coordinator",
      "supply chain specialist",
      "inventory management",
      "purchase orders",
    ],
  },
  finance_accounting: {
    label: "Finance & Accounting",
    defaultHeadline: "Finance & Accounting Professional",
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
      "month-end close",
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
      "ap/ar",
    ],
    toolTerms: ["excel", "sap", "oracle", "quickbooks", "netsuite", "erp"],
    linkedinKeywords: [
      "financial reporting",
      "account reconciliation",
      "budget tracking",
      "audit support",
      "month-end close",
    ],
    recruiterTerms: [
      "accountant",
      "financial analyst",
      "accounts payable",
      "accounts receivable",
      "reconciliation",
      "forecasting",
    ],
  },
  hr_recruiting: {
    label: "HR & Recruiting",
    defaultHeadline: "HR & Recruiting Professional",
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
      "hris",
    ],
    toolTerms: ["workday", "greenhouse", "ats", "excel", "hris"],
    linkedinKeywords: [
      "candidate screening",
      "interview coordination",
      "employee onboarding",
      "record management",
      "hr administration",
    ],
    recruiterTerms: [
      "hr specialist",
      "recruiter",
      "talent acquisition",
      "candidate screening",
      "onboarding",
      "hr administration",
    ],
  },
  administration: {
    label: "Administration",
    defaultHeadline: "Administrative Professional",
    titles: ["administrative assistant", "office assistant", "admin assistant", "office administrator"],
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
      "document management",
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
      "record maintenance",
    ],
    toolTerms: ["office", "excel", "powerpoint", "google sheets"],
    linkedinKeywords: [
      "document management",
      "calendar coordination",
      "meeting scheduling",
      "record maintenance",
      "office administration",
    ],
    recruiterTerms: [
      "administrative assistant",
      "office assistant",
      "office administration",
      "document management",
      "calendar coordination",
    ],
  },
  executive_assistant: {
    label: "Executive Support",
    defaultHeadline: "Executive Assistant",
    titles: ["executive assistant", "personal assistant", "administrative assistant", "office assistant"],
    keywords: [
      "calendar management",
      "travel coordination",
      "meeting coordination",
      "document preparation",
      "executive support",
      "scheduling",
      "record keeping",
      "office administration",
      "stakeholder communication",
    ],
    strongTerms: [
      "calendar management",
      "travel coordination",
      "meeting coordination",
      "document preparation",
      "record keeping",
      "scheduling",
      "executive support",
      "meeting materials",
    ],
    toolTerms: ["excel", "powerpoint", "office", "google sheets"],
    linkedinKeywords: [
      "executive support",
      "calendar management",
      "travel coordination",
      "meeting preparation",
      "document management",
    ],
    recruiterTerms: [
      "executive assistant",
      "personal assistant",
      "calendar management",
      "travel coordination",
      "meeting coordination",
    ],
  },
  design: {
    label: "Design",
    defaultHeadline: "Design Professional",
    titles: ["designer", "graphic designer", "ui designer", "ux designer", "product designer", "visual designer"],
    keywords: [
      "design",
      "wireframes",
      "prototypes",
      "user interface",
      "user experience",
      "visual design",
      "brand assets",
      "design systems",
      "mockups",
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
    toolTerms: ["figma", "adobe creative suite", "photoshop", "illustrator", "after effects"],
    linkedinKeywords: [
      "wireframing",
      "prototyping",
      "design systems",
      "visual design",
      "user flows",
    ],
    recruiterTerms: [
      "ui designer",
      "ux designer",
      "graphic designer",
      "figma",
      "wireframes",
      "prototypes",
    ],
  },
  education: {
    label: "Education",
    defaultHeadline: "Education Professional",
    titles: ["teacher", "english teacher", "math teacher", "subject teacher", "instructor", "lecturer", "teaching assistant"],
    keywords: [
      "lesson planning",
      "classroom management",
      "student assessment",
      "curriculum",
      "instruction",
      "student support",
      "teaching materials",
      "student progress",
    ],
    strongTerms: [
      "lesson planning",
      "classroom management",
      "student assessment",
      "curriculum development",
      "instruction",
      "learning materials",
      "student progress",
      "parent communication",
    ],
    toolTerms: ["excel", "powerpoint", "google classroom", "office"],
    linkedinKeywords: [
      "lesson planning",
      "classroom management",
      "student assessment",
      "curriculum support",
      "instruction",
    ],
    recruiterTerms: [
      "teacher",
      "instructor",
      "classroom management",
      "lesson planning",
      "student assessment",
    ],
  },
  healthcare_administration: {
    label: "Healthcare Administration",
    defaultHeadline: "Healthcare Administration Professional",
    titles: ["healthcare administrator", "medical secretary", "medical office assistant", "patient coordinator", "clinic coordinator"],
    keywords: [
      "patient scheduling",
      "medical records",
      "insurance verification",
      "ehr",
      "emr",
      "clinic operations",
      "appointment coordination",
      "hipaa",
      "patient communication",
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
      "record maintenance",
    ],
    toolTerms: ["ehr", "emr", "excel", "office"],
    linkedinKeywords: [
      "patient scheduling",
      "medical records",
      "insurance verification",
      "appointment coordination",
      "clinic administration",
    ],
    recruiterTerms: [
      "patient coordinator",
      "medical office assistant",
      "medical secretary",
      "ehr",
      "medical records",
      "appointment coordination",
    ],
  },
  engineering: {
    label: "Engineering",
    defaultHeadline: "Engineering Professional",
    titles: [
      "civil engineer",
      "site engineer",
      "construction engineer",
      "project site engineer",
      "mechanical engineer",
      "design engineer",
      "maintenance engineer",
      "production engineer",
      "industrial engineer",
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
      "mechanical design",
      "technical drawings",
      "solidworks",
      "equipment maintenance",
      "production support",
      "quality checks",
      "inspection",
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
      "solidworks",
      "preventive maintenance",
      "equipment maintenance",
      "quality checks",
      "root cause analysis",
    ],
    toolTerms: ["autocad", "revit", "primavera p6", "solidworks", "excel", "erp"],
    linkedinKeywords: [
      "technical documentation",
      "drawing review",
      "inspection",
      "maintenance planning",
      "site coordination",
    ],
    recruiterTerms: [
      "civil engineer",
      "mechanical engineer",
      "site engineer",
      "autocad",
      "solidworks",
      "technical drawings",
    ],
  },
  legal_compliance: {
    label: "Legal & Compliance",
    defaultHeadline: "Legal & Compliance Professional",
    titles: ["legal assistant", "legal support specialist", "compliance specialist", "compliance coordinator", "paralegal"],
    keywords: [
      "legal documentation",
      "contract review",
      "compliance",
      "policy documentation",
      "regulatory review",
      "record keeping",
      "case files",
      "legal research",
      "document management",
    ],
    strongTerms: [
      "compliance",
      "policy documentation",
      "regulatory review",
      "contract support",
      "case files",
      "legal documentation",
      "document management",
      "record maintenance",
    ],
    toolTerms: ["excel", "office", "document management"],
    linkedinKeywords: [
      "compliance support",
      "policy documentation",
      "contract coordination",
      "record management",
      "legal documentation",
    ],
    recruiterTerms: [
      "compliance specialist",
      "legal assistant",
      "paralegal",
      "policy documentation",
      "regulatory review",
    ],
  },
  generic: {
    label: "Professional",
    defaultHeadline: "Professional",
    titles: [],
    keywords: ["reporting", "documentation", "coordination", "analysis", "communication", "scheduling", "records", "tracking", "support"],
    strongTerms: ["reporting", "documentation", "coordination", "analysis", "communication", "scheduling", "records", "tracking", "support"],
    toolTerms: ["excel", "office", "google sheets", "powerpoint"],
    linkedinKeywords: ["documentation", "coordination", "reporting", "process tracking", "record maintenance"],
    recruiterTerms: ["coordination", "reporting", "documentation", "support"],
  },
};

const ROLE_FAMILY_ALIASES = {
  software: "software_engineering",
  software_engineering: "software_engineering",
  engineering_software: "software_engineering",
  devops: "software_engineering",
  qa: "qa",
  quality_assurance: "qa",
  testing: "qa",
  data: "data",
  analytics: "data",
  bi: "data",
  product: "product",
  project: "project",
  program: "project",
  business_analysis: "business_analysis",
  business_analyst: "business_analysis",
  marketing: "marketing",
  sales: "sales",
  customer_support: "customer_support",
  support: "customer_support",
  customer_success: "customer_success",
  operations: "operations",
  procurement_supply_chain: "procurement_supply_chain",
  procurement: "procurement_supply_chain",
  supply_chain: "procurement_supply_chain",
  logistics: "procurement_supply_chain",
  finance_accounting: "finance_accounting",
  finance: "finance_accounting",
  accounting: "finance_accounting",
  hr_recruiting: "hr_recruiting",
  hr: "hr_recruiting",
  recruiting: "hr_recruiting",
  administration: "administration",
  admin: "administration",
  executive_assistant: "executive_assistant",
  executive_support: "executive_assistant",
  design: "design",
  education: "education",
  healthcare_administration: "healthcare_administration",
  healthcare_admin: "healthcare_administration",
  engineering: "engineering",
  civil_engineering: "engineering",
  mechanical_engineering: "engineering",
  legal_compliance: "legal_compliance",
  legal: "legal_compliance",
  compliance: "legal_compliance",
  generic: "generic",
};

const HARD_FACT_TERMS = uniqueTrimmedStrings([
  "google ads", "meta ads", "google analytics", "ga4", "google tag manager", "gtm",
  "seo", "sem", "ppc", "hubspot", "salesforce", "crm", "zendesk", "freshdesk", "help desk",
  "jira", "confluence", "tableau", "power bi", "looker studio", "excel", "google sheets",
  "powerpoint", "sql", "python", "javascript", "typescript", "react", "node.js", "java",
  "c sharp", "aws", "azure", "gcp", "docker", "kubernetes", "git", "ci/cd", "rest api",
  "microservices", "unit testing", "integration testing", "selenium", "cypress", "postman",
  "figma", "adobe creative suite", "photoshop", "illustrator", "autocad", "solidworks",
  "revit", "primavera p6", "sap", "oracle", "quickbooks", "netsuite", "erp", "ifrs", "gaap",
  "accounts payable", "accounts receivable", "payroll", "forecasting", "variance analysis",
  "budgeting", "audit", "reconciliation", "workday", "greenhouse", "ats", "agile", "scrum",
  "kanban", "lean", "six sigma", "pmp", "csm", "psm", "etl", "data modeling", "ehr", "emr",
  "hipaa", "patient scheduling", "insurance verification", "inventory management", "warehouse management",
  "procurement", "sourcing", "vendor management", "csat", "nps", "qbr", "a/b test", "remarketing",
  "retargeting", "lead generation", "audience segmentation", "boq", "ms project", "hris"
]);

const WEAK_START_RE = /^(helped|helps|assisted|assists|supported|supports|worked on|contributed to|participated in|involved in|handled|tasked with|responsible for|duties included|yardımcı oldum|destek verdim|destek oldum|görev aldım|ilgilen(dim|di)|bulundum|çalıştım|yaptım)\b/i;
const WEAK_ANY_RE = /\b(helped|assisted|supported|contributed to|participated in|involved in|responsible for|worked on|provided support|supported the team|görev aldım|destek oldum|yardımcı oldum)\b/i;
const GENERIC_LOW_VALUE_RE = /\b(daily tasks?|routine communication|general support|various tasks?|miscellaneous|team support|administrative tasks?|ongoing support|service updates?|operations support|process support|reporting support|customer service tasks?|office support|support activities?)\b/i;
const STRONG_ACTION_RE = /\b(engineered|built|developed|designed|implemented|integrated|tested|debugged|validated|automated|configured|deployed|maintained|optimized|planned|executed|created|responded|resolved|documented|scheduled|reviewed|updated|monitored|processed|reconciled|screened|analyzed|reported|tracked|managed|delivered|verified|produced|prepared|mapped|facilitated|taught|assessed|inspected|coordinated|collaborated|communicated|organized|compiled|addressed|guided|hazırladım|analiz ettim|raporladım|geliştirdim|uyguladım|organize ettim|takip ettim|düzenledim|gerçekleştirdim|tasarladım|planladım|sundum|doğruladım|işledim|eğitim verdim|değerlendirdim|koordine ettim|yönettim|yürüttüm)\b/i;
const META_WRITING_RE = /\b(on linkedin|recruiter-safe|search-aware|grounded positioning|make the work more visible|strong wording|right audience|profile-ready|clean language|writing style|this profile|this summary|the goal is|premium language|meta language|ats-safe|positioning language|search visibility|keyword strategy)\b/i;
const CORPORATE_FLUFF_RE = /\b(dynamic|robust|seamless|impactful|high-impact|comprehensive|overall|best-in-class|world-class|transformational|game-changing|visionary|synergy|value-driven|operational value|stakeholder readiness|future analysis|stronger market presence|premium language|decision-making)\b/i;
const UNSUPPORTED_IMPACT_RE = /\b(resulting in|drove|driving|boosted|improved efficiency|improve efficiency|optimized performance|reduced costs|generated revenue|enabled teams to work with fewer interruptions|support quality improvements|future analysis|operational value|stakeholder readiness|decision-making|business impact|growth strategy|performance gains|measurable results|accelerated delivery|increased conversion|increased retention|improved service quality)\b/i;
const META_SENTENCE_SPLIT_RE = /(?<=[.!?])\s+/;

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
  return String(str || "")
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
  if (termNorm.includes(" ")) return normalizedText.includes(termNorm);
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
  return String(str || "").trim().split(/\s+/).filter(Boolean).length;
}

function clampText(str = "", max = 1000) {
  const s = String(str || "").replace(/\s+/g, " ").trim();
  if (s.length <= max) return s;
  const sliced = s.slice(0, max);
  const idx = sliced.lastIndexOf(" ");
  return (idx > max * 0.75 ? sliced.slice(0, idx) : sliced).trim();
}

function getNonEmptyLines(str = "") {
  return String(str || "")
    .replace(/\r/g, "")
    .split("\n")
    .map((x) => x.trim())
    .filter(Boolean);
}

function getBulletLines(str = "") {
  return String(str || "")
    .replace(/\r/g, "")
    .split("\n")
    .map((x) => x.trim())
    .filter((x) => /^[-•·‣▪▫◦*]\s+/.test(x))
    .map((x) => x.replace(/^[-•·‣▪▫◦*]\s+/, "").trim())
    .filter(Boolean);
}

function tokenizeForSimilarity(str = "") {
  return String(str || "")
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
  return s ? s.charAt(0).toUpperCase() + s.slice(1) : s;
}

function lowerFirst(str = "") {
  const s = String(str || "").trim();
  return s ? s.charAt(0).toLowerCase() + s.slice(1) : s;
}

function splitSentenceEnding(str = "") {
  const s = String(str || "").trim();
  const m = s.match(/[.?!]+$/);
  return { body: s.replace(/[.?!]+$/, "").trim(), ending: m ? m[0] : "." };
}

function splitIntoSentences(text = "") {
  return String(text || "")
    .split(META_SENTENCE_SPLIT_RE)
    .map((x) => x.trim())
    .filter(Boolean);
}

function isSectionHeader(line = "") {
  return /^(PROFESSIONAL SUMMARY|SUMMARY|PROFILE|CORE SUMMARY|EXPERIENCE|WORK EXPERIENCE|PROFESSIONAL EXPERIENCE|SKILLS|CORE SKILLS|TECHNICAL SKILLS|COMPETENCIES|EDUCATION|LANGUAGES|CERTIFICATIONS|LICENSES|PROJECTS|ADDITIONAL INFORMATION|AWARDS|ACHIEVEMENTS|PROFESYONEL ÖZET|ÖZET|PROFİL|DENEYİM|İŞ DENEYİMİ|YETKİNLİKLER|YETENEKLER|BECERİLER|EĞİTİM|DİLLER|BİLDİĞİ DİLLER|SERTİFİKALAR|PROJELER|EK BİLGİLER)$/i.test(String(line || "").trim());
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
      out.push(...splitIntoSentences(line));
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
    if (inSkills) out.push(line.replace(/^[-•·‣▪▫◦*]\s+/, "").trim());
  }
  return out.filter(Boolean);
}

function extractExperienceTitles(cv = "") {
  const lines = getNonEmptyLines(cv);
  const titles = [];
  for (let i = 1; i < lines.length; i += 1) {
    const line = lines[i];
    if (/\|\s*.*(\d{4}|Present|Günümüz|Current|Devam)/i.test(line) || /(\d{4}).*(Present|Günümüz|Current|Devam)/i.test(line)) {
      const prev = lines[i - 1];
      if (prev && !isSectionHeader(prev) && !prev.includes("@") && !/^\d/.test(prev)) {
        titles.push(prev);
      }
    }
  }
  return uniqueByNormalizedStrings(titles);
}

function sanitizeSimpleText(str = "") {
  return String(str || "")
    .replace(/[\r\n\t]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function normalizeTone(s = "") {
  const value = String(s || "clean").trim().toLowerCase();
  return VALID_TONES.has(value) ? value : "clean";
}

function normalizeSeniority(s = "") {
  const value = String(s || "mid").trim().toLowerCase();
  if (VALID_SENIORITY.has(value)) return value;
  if (/intern|staj/i.test(value)) return "intern";
  if (/junior|jr/i.test(value)) return "junior";
  if (/associate/i.test(value)) return "associate";
  if (/senior|sr|uzman|k[ıi]demli/i.test(value)) return "senior";
  if (/lead/i.test(value)) return "lead";
  if (/manager|supervisor/i.test(value)) return "manager";
  if (/director|head/i.test(value)) return "director";
  if (/executive|vp|chief|c-level/i.test(value)) return "executive";
  return "mid";
}

function normalizeRoleFamily(value = "") {
  const raw = canonicalizeTerm(value).replace(/\s+/g, "_");
  if (!raw) return "";
  if (ROLE_FAMILY_ALIASES[raw]) return ROLE_FAMILY_ALIASES[raw];

  const aliasCandidates = Object.keys(ROLE_FAMILY_ALIASES);
  for (const key of aliasCandidates) {
    if (raw === key || raw.includes(key) || key.includes(raw)) return ROLE_FAMILY_ALIASES[key];
  }

  if (/software|developer|engineer|backend|frontend|full[_ ]?stack|devops/.test(raw)) return "software_engineering";
  if (/qa|test/.test(raw)) return "qa";
  if (/data|analytics|bi/.test(raw)) return "data";
  if (/product/.test(raw)) return "product";
  if (/project|program/.test(raw)) return "project";
  if (/business[_ ]?analysis|analyst/.test(raw)) return "business_analysis";
  if (/marketing|seo|sem|ppc/.test(raw)) return "marketing";
  if (/sales|account[_ ]?executive|business[_ ]?development/.test(raw)) return "sales";
  if (/customer[_ ]?support|support|help[_ ]?desk/.test(raw)) return "customer_support";
  if (/customer[_ ]?success/.test(raw)) return "customer_success";
  if (/operations|workflow/.test(raw)) return "operations";
  if (/procurement|purchasing|sourcing|supply[_ ]?chain|logistics|warehouse|inventory/.test(raw)) return "procurement_supply_chain";
  if (/finance|accounting|accountant|financial/.test(raw)) return "finance_accounting";
  if (/hr|recruit|talent/.test(raw)) return "hr_recruiting";
  if (/administration|admin|office/.test(raw)) return "administration";
  if (/executive[_ ]?assistant|personal[_ ]?assistant/.test(raw)) return "executive_assistant";
  if (/design|ui|ux|graphic/.test(raw)) return "design";
  if (/education|teacher|instructor|lecturer/.test(raw)) return "education";
  if (/healthcare|medical|clinic|patient/.test(raw)) return "healthcare_administration";
  if (/civil|mechanical|industrial|construction|site[_ ]?engineer|engineering/.test(raw)) return "engineering";
  if (/legal|compliance|paralegal/.test(raw)) return "legal_compliance";
  return "";
}

function inferSeniority(text = "") {
  const s = normalizeCompareText(text);
  if (/\b(chief|vp|vice president|director|head of|department head|general manager)\b/i.test(s)) return "executive";
  if (/\b(principal|staff engineer|lead|manager|team lead|supervisor)\b/i.test(s)) return "manager";
  if (/\b(senior|sr\.?|uzman|k[ıi]demli)\b/i.test(s)) return "senior";
  if (/\b(intern|stajyer|junior|jr\.?|assistant|associate|trainee|entry level)\b/i.test(s)) return "junior";
  return "mid";
}

function getFamilyPack(family = "generic") {
  return ROLE_FAMILIES[family] || ROLE_FAMILIES.generic;
}

function getAllFamilyTerms(family = "generic") {
  const pack = getFamilyPack(family);
  return uniqueTrimmedStrings([
    ...(pack.titles || []),
    ...(pack.keywords || []),
    ...(pack.strongTerms || []),
    ...(pack.toolTerms || []),
    ...(pack.linkedinKeywords || []),
    ...(pack.recruiterTerms || []),
  ]);
}

const ALL_FAMILY_TERMS = uniqueTrimmedStrings(
  Object.keys(ROLE_FAMILIES).flatMap((key) => getAllFamilyTerms(key))
);

function inferRoleFamily(cv = "", jd = "", hardFamily = "") {
  const forced = normalizeRoleFamily(hardFamily);
  const combined = `${cv || ""}\n${jd || ""}`;
  const titleText = `${extractHeaderBlock(cv).join(" ")} ${extractExperienceTitles(cv).join(" ")}`.trim();
  const summaryText = extractSummaryLines(cv).join(" ");
  const skillsText = getSkillsLines(cv).join(" ");
  const bulletsText = getBulletLines(cv).join(" ");

  const scored = Object.entries(ROLE_FAMILIES)
    .filter(([key]) => key !== "generic")
    .map(([key, pack]) => {
      const titleHits = countTermHits(titleText, pack.titles || []);
      const summaryHits = countTermHits(summaryText, [...(pack.titles || []), ...(pack.keywords || []), ...(pack.strongTerms || [])]);
      const skillsHits = countTermHits(skillsText, [...(pack.toolTerms || []), ...(pack.strongTerms || []), ...(pack.keywords || [])]);
      const bulletHits = countTermHits(bulletsText, [...(pack.keywords || []), ...(pack.strongTerms || []), ...(pack.toolTerms || [])]);
      const combinedHits = countTermHits(combined, [...(pack.keywords || []), ...(pack.strongTerms || []), ...(pack.toolTerms || []), ...(pack.titles || [])]);
      const score = titleHits * 9 + summaryHits * 4 + skillsHits * 5 + bulletHits * 3 + combinedHits * 2;
      return { key, score, titleHits, summaryHits, skillsHits, bulletHits, combinedHits };
    })
    .filter((x) => x.score > 0)
    .sort((a, b) => b.score - a.score);

  const inferred = scored[0]?.key || "generic";
  const effectiveFamily = forced || inferred || "generic";

  return {
    hardFamily: forced || "",
    inferredFamily: inferred || "generic",
    effectiveFamily,
    scoredFamilies: scored.slice(0, 6),
  };
}

function extractLikelyCurrentTitles(cv = "", family = "generic") {
  const pack = getFamilyPack(family);
  const lines = uniqueByNormalizedStrings([
    ...extractExperienceTitles(cv),
    ...extractHeaderBlock(cv),
  ]).filter((line) => line && !/@/.test(line) && countWords(line) <= 10);

  const filtered = lines.filter((line) => {
    const norm = canonicalizeTerm(line);
    if (!norm) return false;
    if (containsCanonicalTermInNormalizedText(norm, "linkedin")) return false;
    if (pack.titles.length) {
      return pack.titles.some((title) => containsCanonicalTermInNormalizedText(norm, title));
    }
    return true;
  });

  return uniqueByNormalizedStrings(filtered).slice(0, 4);
}

function isFamilyCompatibleTitle(title = "", family = "generic") {
  const value = sanitizeSimpleText(title);
  if (!value) return false;
  const current = normalizeRoleFamily(value);
  if (!current) {
    const pack = getFamilyPack(family);
    return (pack.titles || []).some((x) => canonicalizeTerm(value).includes(canonicalizeTerm(x)) || canonicalizeTerm(x).includes(canonicalizeTerm(value)));
  }
  return current === family;
}

function parseLinkedInMeta(meta = {}) {
  const obj = meta && typeof meta === "object" ? meta : {};
  const roleFamily = normalizeRoleFamily(obj.role_family || obj.roleFamily || "");
  const targetRole = sanitizeSimpleText(obj.target_role || obj.targetRole || "");
  const seniority = normalizeSeniority(obj.seniority || "mid");
  const industry = sanitizeSimpleText(obj.industry || "");
  const location = sanitizeSimpleText(obj.location || "");
  const tone = normalizeTone(obj.tone || "clean");
  return { roleFamily, targetRole, seniority, industry, location, tone };
}

function extractSupportedFacts(text = "") {
  const norm = canonicalizeTerm(text);
  return HARD_FACT_TERMS.filter((term) => containsCanonicalTermInNormalizedText(norm, term));
}

function extractSupportedFamilyTerms(text = "", family = "generic") {
  const norm = canonicalizeTerm(text);
  return getAllFamilyTerms(family).filter((term) => containsCanonicalTermInNormalizedText(norm, term));
}

function buildEvidenceProfile({ cv = "", jd = "", meta = {}, familyInfo = null }) {
  const familyState = familyInfo || inferRoleFamily(cv, jd, meta.roleFamily || meta.role_family || "");
  const family = familyState.effectiveFamily || "generic";
  const pack = getFamilyPack(family);
  const combined = `${cv || ""}\n${jd || ""}`;
  const currentTitles = extractLikelyCurrentTitles(cv, family);
  const targetRoleCompatible = !!meta.targetRole && isFamilyCompatibleTitle(meta.targetRole, family);

  const supportedFacts = uniqueTrimmedStrings([
    ...extractSupportedFacts(cv),
    ...extractSupportedFacts(jd),
  ]);

  const supportedFamilyTerms = uniqueTrimmedStrings([
    ...extractSupportedFamilyTerms(cv, family),
    ...extractSupportedFamilyTerms(jd, family),
  ]);

  const supportedKeywords = uniqueTrimmedStrings([
    ...supportedFamilyTerms,
    ...supportedFacts,
  ]);

  const skills = uniqueTrimmedStrings(
    getSkillsLines(cv)
      .flatMap((line) => line.split(/[;,|]/g).map((x) => sanitizeSimpleText(x)))
      .filter(Boolean)
  );

  const supportedTools = uniqueTrimmedStrings([
    ...supportedFacts.filter((term) => (pack.toolTerms || []).some((x) => canonicalizeTerm(x) === canonicalizeTerm(term))),
    ...skills.filter((term) => (pack.toolTerms || []).some((x) => canonicalizeTerm(x) === canonicalizeTerm(term)) || HARD_FACT_TERMS.some((x) => canonicalizeTerm(x) === canonicalizeTerm(term))),
  ]);

  const recruiterTerms = uniqueTrimmedStrings([
    ...(pack.recruiterTerms || []).filter((term) => supportedFamilyTerms.some((x) => canonicalizeTerm(x) === canonicalizeTerm(term)) || supportedFacts.some((x) => canonicalizeTerm(x) === canonicalizeTerm(term))),
    ...currentTitles,
    ...(targetRoleCompatible ? [meta.targetRole] : []),
  ]);

  const summaryLines = extractSummaryLines(cv);
  const bullets = getBulletLines(cv);
  const summaryText = summaryLines.join(" ");

  return {
    family,
    familyPack: pack,
    hardFamily: familyState.hardFamily || "",
    inferredFamily: familyState.inferredFamily || family,
    currentTitles,
    targetRoleCompatible,
    targetRole: meta.targetRole || "",
    supportedFacts,
    supportedFamilyTerms,
    supportedKeywords,
    supportedTools,
    skills,
    recruiterTerms,
    summaryLines,
    summaryText,
    bullets,
    combinedText: combined,
    seniority: meta.seniority || inferSeniority(`${currentTitles.join(" ")}\n${cv}\n${jd}`),
    industry: meta.industry || "",
    location: meta.location || "",
    tone: meta.tone || "clean",
  };
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
  const expected = crypto.createHmac("sha256", appSecret).update(data).digest("base64url");
  if (sig !== expected) return false;

  let payload;
  try {
    payload = JSON.parse(Buffer.from(data, "base64url").toString("utf8"));
  } catch {
    return false;
  }

  return !!payload?.exp && Date.now() <= payload.exp;
}

function getClientIp(req) {
  const xf = req.headers["x-forwarded-for"];
  if (typeof xf === "string" && xf.length) return xf.split(",")[0].trim();
  return req.socket?.remoteAddress || "unknown";
}

async function ensureMinDelay(startedAt, minMs) {
  const elapsed = Date.now() - startedAt;
  const remain = minMs - elapsed;
  if (remain > 0) await new Promise((resolve) => setTimeout(resolve, remain));
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
      { reasoningEffort: "low", temperature: null, maxCompletionTokens: Math.max(maxCompletionTokens, 2600) },
      { reasoningEffort: "none", temperature: 0.2, maxCompletionTokens: Math.max(maxCompletionTokens, 3200) },
    ];
  }

  if (isPreview) {
    return [
      { reasoningEffort: "none", temperature: 0.2, maxCompletionTokens: Math.max(maxCompletionTokens, 1200) },
      { reasoningEffort: "none", temperature: 0.2, maxCompletionTokens: Math.max(maxCompletionTokens, 1600) },
    ];
  }

  return [
    { reasoningEffort: "low", temperature: null, maxCompletionTokens: Math.max(maxCompletionTokens, 2200) },
    { reasoningEffort: "none", temperature: 0.2, maxCompletionTokens: Math.max(maxCompletionTokens, 2800) },
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

async function callOpenAIJson({ apiKey, model, system, userPrompt, isPreview = false, passType = "main", maxCompletionTokens = 1800 }) {
  const attempts = buildAttempts({ model, isPreview, passType, maxCompletionTokens });
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
              temperature: attempt.temperature,
              maxCompletionTokens: attempt.maxCompletionTokens,
            })
          ),
        },
        passType === "repair" ? 70000 : 60000
      );

      const raw = await response.text();
      if (!response.ok) {
        const err = new Error("OpenAI error");
        err.status = response.status;
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

      const text = extractAssistantText(parsed);
      const finishReason = parsed?.choices?.[0]?.finish_reason || "";
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
  const cand = String(candidateText || "");
  return UNSUPPORTED_IMPACT_RE.test(cand) && !UNSUPPORTED_IMPACT_RE.test(orig);
}

function containsMetaWriting(text = "") {
  return META_WRITING_RE.test(String(text || ""));
}

function containsCorporateFluff(text = "") {
  return CORPORATE_FLUFF_RE.test(String(text || ""));
}

function extractExplicitTermsFromText(text = "", evidence = null) {
  const norm = canonicalizeTerm(text);
  const candidates = uniqueTrimmedStrings([
    ...(evidence?.supportedFacts || []),
    ...(evidence?.supportedFamilyTerms || []),
  ]);
  return candidates.filter((term) => containsCanonicalTermInNormalizedText(norm, term));
}

function containsForeignFamilyTitle(text = "", selectedFamily = "generic") {
  const norm = canonicalizeTerm(text);
  if (!norm) return false;

  for (const [family, pack] of Object.entries(ROLE_FAMILIES)) {
    if (family === selectedFamily || family === "generic") continue;
    if ((pack.titles || []).some((title) => containsCanonicalTermInNormalizedText(norm, title))) {
      return true;
    }
  }
  return false;
}

function scoreLineSignals(sentence = "", evidence = null) {
  const s = String(sentence || "").trim();
  const facts = extractExplicitTermsFromText(s, evidence);
  const familyTerms = (evidence?.supportedFamilyTerms || []).filter((term) => containsCanonicalTermInNormalizedText(canonicalizeTerm(s), term));
  const hasNumber = /\b\d+(?:[.,]\d+)?%?\b/.test(s);
  const hasWeakStart = WEAK_START_RE.test(s);
  const hasWeakAny = WEAK_ANY_RE.test(s);
  const hasStrongAction = STRONG_ACTION_RE.test(s);
  const hasGenericLowValue = GENERIC_LOW_VALUE_RE.test(s);
  const hasScope = /\b(using|with|for|across|through|via|by|on|under|according to|per|kullanarak|ile|için|kapsamında|üzerinde|aracılığıyla)\b/i.test(s);
  const wc = countWords(s);

  let weakScore = 0;
  let strongScore = 0;

  if (hasWeakStart) weakScore += 4;
  if (hasWeakAny) weakScore += 2;
  if (!hasStrongAction) weakScore += 1;
  if (hasGenericLowValue) weakScore += 2;
  if (!facts.length && !familyTerms.length && !hasNumber) weakScore += 2;
  if (wc <= 5) weakScore += 2;
  if (wc <= 8 && !hasScope && !facts.length) weakScore += 1;

  if (hasStrongAction) strongScore += 3;
  if (facts.length) strongScore += Math.min(3, facts.length);
  if (familyTerms.length) strongScore += Math.min(3, familyTerms.length);
  if (hasNumber) strongScore += 2;
  if (hasScope) strongScore += 1;
  if (wc >= 6 && wc <= 20) strongScore += 1;

  return {
    weakScore,
    strongScore,
    hasWeakStart,
    hasWeakAny,
    hasStrongAction,
    hasGenericLowValue,
    hasScope,
    facts,
    familyTerms,
    wordCount: wc,
    isWeak: weakScore >= 5 && strongScore <= 4,
    isModeratelyWeak: weakScore >= 4 && strongScore <= 5,
  };
}

function extractExperienceRewriteCandidates(cv = "", evidence = null, maxCount = 8) {
  const bullets = getBulletLines(cv)
    .map((sentence) => ({ sentence, section: "experience", signals: scoreLineSignals(sentence, evidence) }))
    .filter((item) => item.signals.isWeak || item.signals.isModeratelyWeak)
    .sort((a, b) => {
      return (
        b.signals.weakScore - a.signals.weakScore ||
        a.signals.strongScore - b.signals.strongScore ||
        a.signals.wordCount - b.signals.wordCount
      );
    });

  const summary = extractSummaryLines(cv)
    .map((sentence) => ({ sentence, section: "summary", signals: scoreLineSignals(sentence, evidence) }))
    .filter((item) => item.signals.isWeak || item.signals.isModeratelyWeak)
    .sort((a, b) => {
      return (
        b.signals.weakScore - a.signals.weakScore ||
        a.signals.strongScore - b.signals.strongScore ||
        a.signals.wordCount - b.signals.wordCount
      );
    });

  const out = [];
  const seen = new Set();
  for (const item of [...bullets, ...summary]) {
    const key = canonicalizeTerm(item.sentence);
    if (!key || seen.has(key)) continue;
    seen.add(key);
    out.push(item);
    if (out.length >= maxCount) break;
  }
  return out;
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

function buildLocalExperienceRewrite(source = "", context = {}) {
  const sentence = String(source || "").trim();
  if (!sentence) return "";

  const { body, ending } = splitSentenceEnding(sentence);
  const pack = getFamilyPack(context.family || "generic");

  const removals = [
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
  for (const re of removals) {
    if (re.test(remainder)) {
      remainder = remainder.replace(re, "").trim();
      matched = true;
      break;
    }
  }

  if (!matched || !remainder) return "";

  let verb = "Coordinated";
  if (/(email|live chat|customer|client|request|inquir|complaint|service)/i.test(sentence)) verb = "Responded to";
  else if (/(ticket|case|issue|escalat|follow-?up)/i.test(sentence)) verb = "Coordinated";
  else if (/(report|dashboard|summary|reconciliation|audit|review|validation)/i.test(sentence)) verb = /(reconciliation|audit|review|validation)/i.test(sentence) ? "Reviewed" : "Prepared";
  else if (/(schedule|calendar|meeting|travel|appointment)/i.test(sentence)) verb = "Coordinated";
  else if (/(record|documentation|log|file|note)/i.test(sentence)) verb = "Maintained";
  else if (/(invoice|order|request processing|processing)/i.test(sentence)) verb = "Processed";
  else if (/(api|backend|frontend|database|feature|deployment|code|testing|debug)/i.test(sentence)) verb = "Implemented";
  else if (/(design|wireframe|prototype|visual|mockup)/i.test(sentence)) verb = "Designed";
  else if (/(lesson|classroom|student|curriculum|instruction)/i.test(sentence)) verb = "Delivered";
  else if (/(patient|appointment|medical|insurance)/i.test(sentence)) verb = "Coordinated";
  else if (/(shipment|inventory|warehouse|purchase order|vendor|supplier|procurement|logistics)/i.test(sentence)) verb = "Coordinated";
  else if (/(candidate|interview|onboarding|employee|records)/i.test(sentence)) verb = "Coordinated";
  else if ((pack.recruiterTerms || []).some((term) => /analysis|analyst/.test(term))) verb = "Prepared";

  remainder = remainder
    .replace(/\bwith the team\b/i, "with team members")
    .replace(/\bfor the team\b/i, "for internal team review")
    .replace(/\brelated to\b/i, "regarding")
    .replace(/\bto improve efficiency\b/i, "")
    .replace(/\bto support decision[- ]making\b/i, "")
    .replace(/\s+/g, " ")
    .trim();

  const rewrite = `${verb} ${lowerFirst(remainder)}`.replace(/\s+/g, " ").trim();
  if (!rewrite) return "";
  if (WEAK_START_RE.test(rewrite)) return "";
  if (canonicalizeTerm(rewrite) === canonicalizeTerm(sentence)) return "";
  if (containsMetaWriting(rewrite)) return "";
  if (containsCorporateFluff(rewrite)) return "";
  if (hasUnsupportedImpactClaims(sentence, rewrite)) return "";
  return `${rewrite}${ending}`;
}

function improvementSignals(before = "", after = "", context = {}) {
  const b = scoreLineSignals(before, context.evidence);
  const a = scoreLineSignals(after, context.evidence);
  let improvements = 0;
  if (b.hasWeakStart && !a.hasWeakStart) improvements += 1;
  if (!b.hasStrongAction && a.hasStrongAction) improvements += 1;
  if (a.familyTerms.length > b.familyTerms.length || a.facts.length > b.facts.length) improvements += 1;
  if (!b.hasScope && a.hasScope) improvements += 1;
  if ((a.wordCount >= 6 && a.wordCount <= 22) && !(b.wordCount >= 6 && b.wordCount <= 22)) improvements += 1;
  if (a.strongScore > b.strongScore) improvements += 1;
  if (a.weakScore < b.weakScore) improvements += 1;
  return { improvements, beforeSignals: b, afterSignals: a };
}

function preservesImportantSpecificity(before = "", after = "", evidence = null) {
  const beforeTerms = extractExplicitTermsFromText(before, evidence);
  if (!beforeTerms.length) return true;
  const afterNorm = canonicalizeTerm(after);
  const kept = beforeTerms.filter((term) => containsCanonicalTermInNormalizedText(afterNorm, term));
  return kept.length >= Math.max(1, Math.ceil(beforeTerms.length * 0.7));
}

function isShallowRewrite(before = "", after = "") {
  if (!before || !after) return true;
  const sim = jaccardSimilarity(before, after);
  if (canonicalizeTerm(before) === canonicalizeTerm(after)) return true;
  if (sim >= 0.88) return true;

  const bTokens = tokenizeForSimilarity(before);
  const aTokens = tokenizeForSimilarity(after);
  const diff = Math.abs(aTokens.length - bTokens.length);
  const overlap = bTokens.filter((x) => aTokens.includes(x)).length;
  if (overlap >= Math.min(bTokens.length, aTokens.length) - 1 && diff <= 2) return true;
  return false;
}

function isValidExperienceFix(entry, context) {
  const before = String(entry?.before || "").trim();
  const after = String(entry?.after || "").trim();
  const why = String(entry?.why || "").trim();
  if (!before || !after) return false;
  if (canonicalizeTerm(before) === canonicalizeTerm(after)) return false;
  if (WEAK_START_RE.test(after)) return false;
  if (containsMetaWriting(after) || containsMetaWriting(why)) return false;
  if (containsCorporateFluff(after) || containsCorporateFluff(why)) return false;
  if (hasUnsupportedImpactClaims(before, after)) return false;
  if (containsForeignFamilyTitle(after, context.family)) return false;
  if (!preservesImportantSpecificity(before, after, context.evidence)) return false;
  if (isShallowRewrite(before, after)) return false;

  const { improvements, beforeSignals, afterSignals } = improvementSignals(before, after, context);
  if (improvements < 2) return false;
  if (afterSignals.strongScore < beforeSignals.strongScore) return false;
  if (afterSignals.weakScore >= beforeSignals.weakScore) return false;
  if (countWords(why) < 3) return false;
  return true;
}

function buildLinkedInSystem(outLang) {
  return `
CRITICAL RULES:
- Return ONLY valid JSON. No markdown. No explanations. No surrounding text.
- All output values must be written only in ${outLang}. Proper nouns and tool names may remain unchanged.
- Stay inside the selected role_family. role_family is a HARD CONSTRAINT.
- target_role is SOFT GUIDANCE only. It may shape positioning, but it must not overwrite the candidate's actual background.
- Never turn the candidate into a different profession.
- Never invent metrics, percentages, KPIs, budgets, revenue, clients, headcount, ownership, leadership, tools, platforms, results, certifications, employers, dates, or systems.
- Only use tools, platforms, terms, and facts supported by the resume, optional job description, and compatible targeting metadata.
- Do not replace generic tool language with a branded platform unless it is explicitly supported.
- Headlines must be natural, recruiter-friendly, concise, and truthful.
- About sections must describe the candidate, not the writing strategy.
- Never use meta-writing phrases such as: On LinkedIn, recruiter-safe, search-aware, grounded positioning, make the work more visible, strong wording, right audience.
- Never use fake polish, corporate fluff, or unsupported impact language.
- Experience rewrites must be materially stronger than the source, not one-word swaps.
- If the source is support-level work, keep it support-level and truthful.
- Boolean search must stay aligned to the role_family and must not include unrelated role titles.
`.trim();
}

function buildRoleContextBlock(evidence) {
  return [
    `- role_family_hard_constraint: ${evidence.hardFamily || "(none provided)"}`,
    `- effective_role_family: ${evidence.family}`,
    `- inferred_role_family: ${evidence.inferredFamily}`,
    `- current_titles_from_resume: ${evidence.currentTitles.join(", ") || "(none detected)"}`,
    `- compatible_target_role: ${evidence.targetRoleCompatible ? evidence.targetRole : "(not used)"}`,
    `- seniority: ${evidence.seniority}`,
    `- industry: ${evidence.industry || "(not provided)"}`,
    `- location: ${evidence.location || "(not provided)"}`,
    `- tone: ${evidence.tone}`,
  ].join("\n");
}

function buildGroundingBlock(evidence) {
  return [
    `SUPPORTED TOOLS / PLATFORMS: ${evidence.supportedTools.join(", ") || "(none explicit)"}`,
    `SUPPORTED FAMILY TERMS: ${evidence.supportedFamilyTerms.join(", ") || "(none explicit)"}`,
    `SUPPORTED FACT TERMS: ${evidence.supportedFacts.join(", ") || "(none explicit)"}`,
    `ALLOWED RECRUITER VOCABULARY: ${uniqueTrimmedStrings([...(evidence.recruiterTerms || []), ...(evidence.familyPack.recruiterTerms || [])]).join(", ") || "(none)"}`,
    `FORBIDDEN BEHAVIOR: do not drift outside ${evidence.family}`,
  ].join("\n");
}

function buildPreviewPrompt({ cv, jd, outLang, evidence }) {
  return `
Return JSON in this exact schema:
{
  "headlines": [{"label": string, "text": string}],
  "about": {"short": string},
  "experience_fix": [{"before": string, "after": string, "why": string}],
  "skills": {"top": string[]},
  "recruiter": {"keywords": string[]}
}

PREVIEW RULES:
- headlines: exactly 1 item.
- about.short: 450-900 characters, complete and natural.
- experience_fix: 0-1 item only, and only when there is a real improvement opportunity.
- skills.top: 6-10 items.
- recruiter.keywords: 5-8 items.
- No extra keys.

HEADLINE RULES:
- Stay inside role_family.
- Use actual background first.
- Do not invent a different profession.
- Do not use keyword spam.

ABOUT RULES:
- Must describe the candidate, not the writing process.
- No meta language.
- No fluff.
- No fake positioning.

EXPERIENCE FIX RULES:
- Only rewrite a real source line.
- Rewrite must be materially better, not cosmetic.
- No fake impact.
- No invented tools, ownership, or results.

ROLE CONTEXT:
${buildRoleContextBlock(evidence)}

GROUNDING:
${buildGroundingBlock(evidence)}

RESUME:
${cv}

OPTIONAL TARGET ROLE / JOB DESCRIPTION:
${jd || evidence.targetRole || "(none)"}
`.trim();
}

function buildFullPrompt({ cv, jd, outLang, evidence }) {
  return `
Return JSON in this exact schema:
{
  "headlines": [{"label": string, "text": string}],
  "about": {"short": string, "normal": string, "bold": string},
  "experience_fix": [{"before": string, "after": string, "why": string}],
  "skills": {"top": string[], "tools": string[], "industry": string[]},
  "recruiter": {"keywords": string[], "boolean": string}
}

FULL MODE RULES:
- headlines: exactly 5 items with these labels: Search, Impact, Niche, Leadership, Clean.
- about.short: 450-900 characters.
- about.normal: 700-1300 characters.
- about.bold: 700-1300 characters.
- experience_fix: 4-6 items when real opportunities exist; otherwise fewer naturally.
- skills.top: 10-16 items.
- skills.tools: 4-12 items.
- skills.industry: 6-16 items.
- recruiter.keywords: 8-16 items.
- recruiter.boolean: one clean recruiter-ready boolean string.
- No extra keys.

HEADLINE RULES:
- Stay strictly inside role_family.
- No profession drift.
- No fake seniority or unsupported titles.
- Keep the text concise and natural.

ABOUT RULES:
- Must sound like a real candidate summary.
- Must not mention writing strategy, profile strategy, or LinkedIn strategy.
- Must not inflate ownership, leadership, impact, or tools.
- The bold version may sound stronger, but it must still remain truthful.

EXPERIENCE FIX RULES:
- Only rewrite genuinely weak or improvable lines.
- Do not do one-word swaps.
- Improve clarity, specificity, scope, or recruiter readability.
- Preserve role-native wording.
- Keep support work truthful and support-level.

SKILLS / RECRUITER RULES:
- Keep keywords inside role_family.
- Do not add unrelated tools.
- Boolean search must not include unrelated job families.
- Use target_role only when compatible with role_family.

ROLE CONTEXT:
${buildRoleContextBlock(evidence)}

GROUNDING:
${buildGroundingBlock(evidence)}

RESUME:
${cv}

OPTIONAL TARGET ROLE / JOB DESCRIPTION:
${jd || evidence.targetRole || "(none)"}
`.trim();
}

function buildRepairPrompt({ currentOutput, issues, cv, jd, outLang, evidence, isPreview }) {
  return `
Return JSON in this exact schema:
${isPreview
  ? `{
  "headlines": [{"label": string, "text": string}],
  "about": {"short": string},
  "experience_fix": [{"before": string, "after": string, "why": string}],
  "skills": {"top": string[]},
  "recruiter": {"keywords": string[]}
}`
  : `{
  "headlines": [{"label": string, "text": string}],
  "about": {"short": string, "normal": string, "bold": string},
  "experience_fix": [{"before": string, "after": string, "why": string}],
  "skills": {"top": string[], "tools": string[], "industry": string[]},
  "recruiter": {"keywords": string[], "boolean": string}
}`}

TASK:
Repair the output so it is more grounded, more truthful, more role-accurate, and more recruiter-usable.

ISSUES TO FIX:
${issues.map((x, i) => `${i + 1}. ${x}`).join("\n")}

RULES:
- Keep role_family as the hard anchor.
- Remove meta language, fluff, unsupported tools, unsupported impact, and unrelated role titles.
- Do not invent new facts.
- Keep the JSON shape unchanged.

ROLE CONTEXT:
${buildRoleContextBlock(evidence)}

GROUNDING:
${buildGroundingBlock(evidence)}

CURRENT OUTPUT:
${JSON.stringify(currentOutput)}

RESUME:
${cv}

OPTIONAL TARGET ROLE / JOB DESCRIPTION:
${jd || evidence.targetRole || "(none)"}
`.trim();
}

function fallbackIdentityTitle(evidence) {
  const current = evidence.currentTitles.find((x) => isFamilyCompatibleTitle(x, evidence.family));
  if (current) return current;
  if (evidence.targetRoleCompatible && evidence.targetRole) return evidence.targetRole;
  return evidence.familyPack.defaultHeadline || capitalizeFirst(evidence.familyPack.label || "Professional");
}

function buildFallbackHeadlines(evidence, isPreview = false) {
  const title = fallbackIdentityTitle(evidence);
  const primaryTerms = uniqueTrimmedStrings([
    ...(evidence.supportedFamilyTerms || []),
    ...(evidence.supportedTools || []),
    ...(evidence.familyPack.linkedinKeywords || []),
  ]).filter((term) => !isFamilyCompatibleTitle(term, evidence.family)).slice(0, 8);

  const searchText = `${title}${primaryTerms[0] ? ` | ${primaryTerms[0]}` : ""}${primaryTerms[1] ? ` | ${primaryTerms[1]}` : ""}`.trim();
  const impactText = `${evidence.familyPack.label} | ${primaryTerms.slice(0, 3).join(", ") || "coordination, reporting, documentation"}`.trim();
  const nicheText = `${title}${primaryTerms[2] ? ` | ${primaryTerms[2]}` : primaryTerms[0] ? ` | ${primaryTerms[0]}` : ""}${primaryTerms[3] ? ` | ${primaryTerms[3]}` : ""}`.trim();
  const leadershipPhrase = ["lead", "manager", "director", "executive"].includes(evidence.seniority)
    ? "Cross-Functional Leadership"
    : "Cross-Functional Collaboration";
  const leadershipText = `${evidence.familyPack.label} | ${leadershipPhrase}`.trim();
  const cleanText = `${title}${evidence.industry ? ` | ${evidence.industry}` : ""}${evidence.location ? ` | ${evidence.location}` : ""}`.trim();

  const items = [
    { label: "Search", text: clampText(searchText, 220) },
    { label: "Impact", text: clampText(impactText, 220) },
    { label: "Niche", text: clampText(nicheText, 220) },
    { label: "Leadership", text: clampText(leadershipText, 220) },
    { label: "Clean", text: clampText(cleanText, 220) },
  ];

  return isPreview ? items.slice(0, 1) : items;
}

function cleanMetaSentences(text = "") {
  const kept = splitIntoSentences(text).filter((sentence) => {
    return !containsMetaWriting(sentence) && !containsCorporateFluff(sentence);
  });
  return kept.join(" ").replace(/\s+/g, " ").trim();
}

function buildFallbackAbout(evidence, outLang = "English", isPreview = false) {
  const title = fallbackIdentityTitle(evidence);
  const terms = uniqueTrimmedStrings([
    ...(evidence.supportedFamilyTerms || []),
    ...(evidence.supportedTools || []),
    ...(evidence.familyPack.linkedinKeywords || []),
  ]).filter((x) => !isFamilyCompatibleTitle(x, evidence.family)).slice(0, 8);

  const summarySource = evidence.summaryLines.filter((line) => !containsMetaWriting(line) && !containsCorporateFluff(line));
  const familyLabel = evidence.familyPack.label || "Professional";
  const termLine = terms.slice(0, 3).join(", ");
  const extraLine = terms.slice(3, 6).join(", ");
  const compatibleTargetLine = evidence.targetRoleCompatible && evidence.targetRole && canonicalizeTerm(evidence.targetRole) !== canonicalizeTerm(title)
    ? evidence.family === normalizeRoleFamily(evidence.targetRole)
      ? evidence.industry
        ? `${evidence.targetRole} opportunities in ${evidence.industry}`
        : `${evidence.targetRole} opportunities`
      : ""
    : "";

  if (outLang === "Turkish") {
    const base = `${title} geçmişine sahip bir ${familyLabel.toLowerCase()} profesyoneliyim. ${termLine ? `${termLine} alanlarında çalıştım. ` : ""}${summarySource[0] ? `${clampText(summarySource[0], 180)} ` : ""}`.replace(/\s+/g, " ").trim();
    const normal = `${base}${extraLine ? `Deneyimim ${extraLine} gibi alanları da kapsıyor. ` : ""}${compatibleTargetLine ? `Profilim ${compatibleTargetLine} ile uyumlu yönler taşıyor. ` : ""}`.replace(/\s+/g, " ").trim();
    const bold = `${normal}${evidence.seniority === "senior" || evidence.seniority === "manager" || evidence.seniority === "director" || evidence.seniority === "executive" ? " Rolüme uygun sorumlulukları net, düzenli ve profesyonel bir şekilde yürütmeye odaklanırım." : " Net iletişim, düzenli takip ve güçlü uygulama disiplini ile çalışırım."}`.replace(/\s+/g, " ").trim();
    return {
      short: clampText(base, 900),
      normal: isPreview ? "" : clampText(normal, 1300),
      bold: isPreview ? "" : clampText(bold, 1300),
    };
  }

  const base = `${title} with experience in ${termLine || "role-relevant coordination, reporting, and execution"}. ${summarySource[0] ? `${clampText(summarySource[0], 180)} ` : ""}`.replace(/\s+/g, " ").trim();
  const normal = `${base}${extraLine ? `My background also includes ${extraLine}. ` : ""}${compatibleTargetLine ? `My experience aligns well with ${compatibleTargetLine}. ` : ""}`.replace(/\s+/g, " ").trim();
  const bold = `${normal}${["senior", "manager", "director", "executive"].includes(evidence.seniority) ? "I bring a steady, structured approach to role-relevant delivery and cross-functional collaboration." : "I bring a clear, practical approach to day-to-day execution, communication, and follow-through."}`.replace(/\s+/g, " ").trim();

  return {
    short: clampText(base, 900),
    normal: isPreview ? "" : clampText(normal, 1300),
    bold: isPreview ? "" : clampText(bold, 1300),
  };
}

function filterHeadlineText(text = "", context = {}) {
  const s = clampText(text, 220);
  if (!s) return "";
  if (containsMetaWriting(s) || containsCorporateFluff(s)) return "";
  if (containsForeignFamilyTitle(s, context.family)) return "";
  if (hasUnsupportedImpactClaims("", s)) return "";
  return s;
}

function normalizeHeadlines(rawHeadlines, context) {
  const desired = context.isPreview ? 1 : 5;
  const labels = ["Search", "Impact", "Niche", "Leadership", "Clean"];
  const out = [];
  const seenText = new Set();
  const seenLabel = new Set();

  for (const [index, item] of (Array.isArray(rawHeadlines) ? rawHeadlines : []).entries()) {
    const label = context.isPreview ? "Search" : labels.includes(String(item?.label || "").trim()) ? String(item?.label).trim() : labels[index] || labels[out.length] || "Search";
    const text = filterHeadlineText(item?.text, context);
    if (!text) continue;
    const key = canonicalizeTerm(text);
    if (!key || seenText.has(key)) continue;
    if (!context.isPreview && seenLabel.has(label)) continue;
    seenText.add(key);
    seenLabel.add(label);
    out.push({ label, text });
    if (out.length >= desired) break;
  }

  for (const item of buildFallbackHeadlines(context.evidence, context.isPreview)) {
    if (out.length >= desired) break;
    const key = canonicalizeTerm(item.text);
    if (!key || seenText.has(key)) continue;
    if (!context.isPreview && seenLabel.has(item.label)) continue;
    seenText.add(key);
    seenLabel.add(item.label);
    out.push(item);
  }

  return out.slice(0, desired);
}

function normalizeAbout(rawAbout, context) {
  const fallback = buildFallbackAbout(context.evidence, context.languageLabel, context.isPreview);

  function cleanAboutText(value, max) {
    const base = cleanMetaSentences(clampText(value, max));
    if (!base) return "";
    if (containsForeignFamilyTitle(base, context.family)) return "";
    if (hasUnsupportedImpactClaims("", base)) return "";
    return clampText(base, max);
  }

  const short = cleanAboutText(rawAbout?.short, 1000) || fallback.short;
  const normal = context.isPreview ? "" : cleanAboutText(rawAbout?.normal, 1500) || fallback.normal;
  const bold = context.isPreview ? "" : cleanAboutText(rawAbout?.bold, 1500) || fallback.bold;

  return { short, normal, bold };
}

function normalizeExperienceFixes(rawFixes, context) {
  const sourceCandidates = extractExperienceRewriteCandidates(context.cv, context.evidence, 10).map((x) => x.sentence);
  const sourceLines = uniqueByNormalizedStrings([...sourceCandidates, ...getBulletLines(context.cv), ...extractSummaryLines(context.cv)]);
  const maxItems = context.isPreview ? 1 : 6;
  const minTarget = context.isPreview ? 0 : Math.min(4, sourceCandidates.length);
  const out = [];
  const seen = new Set();

  for (const item of Array.isArray(rawFixes) ? rawFixes : []) {
    const candidateBefore = clampText(item?.before, 280);
    const before = closestSourceLine(candidateBefore, sourceLines) || candidateBefore;
    const after = clampText(item?.after, 320);
    const why = clampText(item?.why, 180) || "Clearer wording, stronger action, and better recruiter readability.";
    const entry = { before, after, why };
    const key = `${canonicalizeTerm(before)}__${canonicalizeTerm(after)}`;
    if (!before || !after || seen.has(key)) continue;
    if (!isValidExperienceFix(entry, context)) continue;
    seen.add(key);
    out.push(entry);
    if (out.length >= maxItems) break;
  }

  if (out.length < Math.max(1, minTarget)) {
    for (const source of sourceCandidates) {
      const entry = {
        before: source,
        after: buildLocalExperienceRewrite(source, context),
        why: context.languageLabel === "Turkish"
          ? "Daha net aksiyon, daha temiz kapsam ve daha güçlü profesyonel ifade."
          : "Clearer action, stronger framing, and better recruiter readability.",
      };
      const key = `${canonicalizeTerm(entry.before)}__${canonicalizeTerm(entry.after)}`;
      if (!entry.after || seen.has(key)) continue;
      if (!isValidExperienceFix(entry, context)) continue;
      seen.add(key);
      out.push(entry);
      if (out.length >= maxItems) break;
    }
  }

  return out.slice(0, maxItems);
}

function safeKeywordCandidate(term = "", max = 80) {
  return clampText(term, max)
    .replace(/^[-•·‣▪▫◦*0-9.)\s]+/, "")
    .replace(/^[,;:]+|[,;:]+$/g, "")
    .trim();
}

function isSupportedKeyword(term = "", context = {}) {
  const value = safeKeywordCandidate(term);
  if (!value) return false;
  if (containsMetaWriting(value) || containsCorporateFluff(value)) return false;
  if (containsForeignFamilyTitle(value, context.family)) return false;

  const norm = canonicalizeTerm(value);
  const textNorm = canonicalizeTerm(`${context.cv || ""}\n${context.jd || ""}\n${context.targetRole || ""}\n${context.industry || ""}`);

  if (context.evidence.supportedFacts.some((x) => canonicalizeTerm(x) === norm)) return true;
  if (context.evidence.supportedFamilyTerms.some((x) => canonicalizeTerm(x) === norm)) return true;
  if (context.evidence.currentTitles.some((x) => canonicalizeTerm(x) === norm)) return true;
  if (context.evidence.targetRoleCompatible && context.targetRole && canonicalizeTerm(context.targetRole) === norm) return true;
  if (containsCanonicalTermInNormalizedText(textNorm, value)) return true;

  return false;
}

function buildFallbackSkills(context) {
  const evidence = context.evidence;
  const top = uniqueByNormalizedStrings([
    ...evidence.currentTitles,
    ...evidence.supportedFamilyTerms,
    ...evidence.supportedTools,
    ...(evidence.familyPack.linkedinKeywords || []).filter((term) => evidence.supportedFamilyTerms.some((x) => canonicalizeTerm(x) === canonicalizeTerm(term))),
  ]).slice(0, context.isPreview ? 8 : 16);

  const tools = uniqueByNormalizedStrings(evidence.supportedTools).slice(0, context.isPreview ? 5 : 12);

  const industry = uniqueByNormalizedStrings([
    ...evidence.supportedFamilyTerms.filter((term) => !(evidence.familyPack.toolTerms || []).some((x) => canonicalizeTerm(x) === canonicalizeTerm(term))),
    ...(evidence.familyPack.linkedinKeywords || []).filter((term) => evidence.supportedFamilyTerms.some((x) => canonicalizeTerm(x) === canonicalizeTerm(term))),
  ]).slice(0, context.isPreview ? 5 : 16);

  return { top, tools, industry };
}

function normalizeSkillArray(arr = [], context, maxItems = 12) {
  return uniqueByNormalizedStrings(
    (Array.isArray(arr) ? arr : [])
      .map((x) => safeKeywordCandidate(x))
      .filter(Boolean)
      .filter((x) => isSupportedKeyword(x, context))
  ).slice(0, maxItems);
}

function normalizeSkills(rawSkills, context) {
  const fallback = buildFallbackSkills(context);

  const top = uniqueByNormalizedStrings([
    ...normalizeSkillArray(rawSkills?.top, context, context.isPreview ? 8 : 16),
    ...fallback.top,
  ]).slice(0, context.isPreview ? 8 : 16);

  const tools = uniqueByNormalizedStrings([
    ...normalizeSkillArray(rawSkills?.tools, context, context.isPreview ? 5 : 12),
    ...fallback.tools,
  ]).slice(0, context.isPreview ? 5 : 12);

  const industry = uniqueByNormalizedStrings([
    ...normalizeSkillArray(rawSkills?.industry, context, context.isPreview ? 5 : 16),
    ...fallback.industry,
  ]).slice(0, context.isPreview ? 5 : 16);

  return { top, tools, industry };
}

function buildBooleanString(context, skills) {
  const evidence = context.evidence;
  const titleCandidates = uniqueByNormalizedStrings([
    ...evidence.currentTitles.filter((x) => isFamilyCompatibleTitle(x, context.family)),
    ...(evidence.targetRoleCompatible && evidence.targetRole ? [evidence.targetRole] : []),
    ...(evidence.familyPack.titles || []).filter((term) => evidence.supportedFamilyTerms.some((x) => canonicalizeTerm(x) === canonicalizeTerm(term))),
  ]).slice(0, 4);

  const skillCandidates = uniqueByNormalizedStrings([
    ...(skills?.top || []),
    ...(skills?.industry || []),
    ...(evidence.recruiterTerms || []),
  ]).filter((term) => isSupportedKeyword(term, context)).slice(0, 6);

  const toolCandidates = uniqueByNormalizedStrings([
    ...(skills?.tools || []),
    ...evidence.supportedTools,
  ]).filter((term) => isSupportedKeyword(term, context)).slice(0, 4);

  const q = (term) => (countWords(term) > 1 ? `"${term}"` : term);
  const groups = [];
  if (titleCandidates.length) groups.push(`(${titleCandidates.map(q).join(" OR ")})`);
  if (skillCandidates.length) groups.push(`(${skillCandidates.map(q).join(" OR ")})`);
  if (toolCandidates.length) groups.push(`(${toolCandidates.map(q).join(" OR ")})`);
  if (context.location) groups.push(`("${context.location}")`);
  return clampText(groups.join(" AND "), 360);
}

function normalizeRecruiter(rawRecruiter, context, skills) {
  const fallbackKeywords = uniqueByNormalizedStrings([
    ...context.evidence.currentTitles,
    ...(context.evidence.targetRoleCompatible && context.targetRole ? [context.targetRole] : []),
    ...(skills?.top || []),
    ...(skills?.tools || []),
    ...(context.evidence.recruiterTerms || []),
  ]).filter((term) => isSupportedKeyword(term, context)).slice(0, context.isPreview ? 8 : 16);

  const keywords = uniqueByNormalizedStrings([
    ...normalizeSkillArray(rawRecruiter?.keywords, context, context.isPreview ? 8 : 16),
    ...fallbackKeywords,
  ]).slice(0, context.isPreview ? 8 : 16);

  let booleanString = "";
  if (!context.isPreview) {
    const rawBoolean = clampText(rawRecruiter?.boolean, 400);
    booleanString = rawBoolean && !containsMetaWriting(rawBoolean) && !containsCorporateFluff(rawBoolean) && !containsForeignFamilyTitle(rawBoolean, context.family)
      ? rawBoolean
      : buildBooleanString(context, skills);
  }

  return { keywords, boolean: booleanString };
}

function normalizeLinkedInOutput(raw = {}, context = {}) {
  const headlines = normalizeHeadlines(raw?.headlines, context);
  const about = normalizeAbout(raw?.about || {}, context);
  const experience_fix = normalizeExperienceFixes(raw?.experience_fix, context);
  const skills = normalizeSkills(raw?.skills || {}, context);
  const recruiter = normalizeRecruiter(raw?.recruiter || {}, context, skills);
  return { headlines, about, experience_fix, skills, recruiter };
}

function detectLinkedInIssues(output, context) {
  const issues = [];
  const expectedHeadlines = context.isPreview ? 1 : 5;
  if (!Array.isArray(output.headlines) || output.headlines.length < expectedHeadlines) {
    issues.push(`Expected ${expectedHeadlines} usable headline option(s).`);
  }
  if (!output.about?.short) issues.push("Short About section is missing.");
  if (!context.isPreview && (!output.about?.normal || !output.about?.bold)) issues.push("Normal and bold About versions are incomplete.");
  const availableCandidates = extractExperienceRewriteCandidates(context.cv, context.evidence, 8);
  if (!context.isPreview && availableCandidates.length >= 3 && (!Array.isArray(output.experience_fix) || output.experience_fix.length < 3)) {
    issues.push("Experience rewrites are too thin for the available resume content.");
  }
  if (!Array.isArray(output.skills?.top) || output.skills.top.length < (context.isPreview ? 4 : 8)) issues.push("Top skills are too thin.");
  if (!Array.isArray(output.recruiter?.keywords) || output.recruiter.keywords.length < (context.isPreview ? 4 : 8)) issues.push("Recruiter keywords are too thin.");
  if (!context.isPreview && (!output.recruiter?.boolean || output.recruiter.boolean.length < 20)) issues.push("Boolean search string is missing or weak.");

  const headlineDrift = (output.headlines || []).some((item) => containsForeignFamilyTitle(item.text, context.family));
  if (headlineDrift) issues.push("Headline drift detected outside the selected role family.");

  const aboutDrift = [output.about?.short, output.about?.normal, output.about?.bold].filter(Boolean).some((text) => containsForeignFamilyTitle(text, context.family) || containsMetaWriting(text));
  if (aboutDrift) issues.push("About section contains drift or meta language.");

  const recruiterDrift = (output.recruiter?.keywords || []).some((term) => containsForeignFamilyTitle(term, context.family));
  if (recruiterDrift) issues.push("Recruiter keywords include unrelated role vocabulary.");

  return issues;
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
    const cv = String(body.cv || "").trim();
    const jd = String(body.jd || "").trim();
    const preview = !!body.preview;
    const langCode = typeof body.lang === "string" && body.lang.trim() ? body.lang.trim().toLowerCase() : "en";
    const languageLabel = LANG_MAP[langCode] || "English";

    if (!cv) {
      return res.status(400).json({ error: "cv is required" });
    }

    const sessionOk = verifySession(req);
    const isPreview = preview || !sessionOk;

    const ip = getClientIp(req);
    const limiter = isPreview ? rlPreview : rlFull;
    const { success, reset } = await limiter.limit(ip);
    if (!success) {
      const retrySec = Math.max(1, Math.ceil((reset - Date.now()) / 1000));
      return res.status(429).json({ error: "Too many requests", retry_after_seconds: retrySec });
    }

    const apiKey = process.env.OPENAI_API_KEY;
    if (!apiKey) {
      return res.status(500).json({ error: "OPENAI_API_KEY is missing on Vercel" });
    }

    const model = process.env.OPENAI_LINKEDIN_MODEL || process.env.OPENAI_MODEL || "gpt-4o-mini";
    const meta = parseLinkedInMeta(body.linkedin_meta || {});
    const familyInfo = inferRoleFamily(cv, jd, meta.roleFamily);
    const evidence = buildEvidenceProfile({ cv, jd, meta, familyInfo });

    const context = {
      cv,
      jd,
      isPreview,
      languageLabel,
      family: evidence.family,
      targetRole: meta.targetRole,
      industry: meta.industry,
      location: meta.location,
      tone: meta.tone,
      evidence,
    };

    let raw;
    try {
      raw = await callOpenAIJson({
        apiKey,
        model,
        system: buildLinkedInSystem(languageLabel),
        userPrompt: isPreview
          ? buildPreviewPrompt({ cv, jd, outLang: languageLabel, evidence })
          : buildFullPrompt({ cv, jd, outLang: languageLabel, evidence }),
        isPreview,
        passType: "main",
        maxCompletionTokens: isPreview ? 1400 : 2600,
      });
    } catch (err) {
      return res.status(err?.status || 500).json({
        error: err?.message || "OpenAI error",
        status: err?.status || 500,
        details: err?.details || String(err),
      });
    }

    let normalized = normalizeLinkedInOutput(raw, context);
    let issues = detectLinkedInIssues(normalized, context);

    if (issues.length) {
      try {
        const repaired = await callOpenAIJson({
          apiKey,
          model,
          system: buildLinkedInSystem(languageLabel),
          userPrompt: buildRepairPrompt({
            currentOutput: normalized,
            issues,
            cv,
            jd,
            outLang: languageLabel,
            evidence,
            isPreview,
          }),
          isPreview,
          passType: "repair",
          maxCompletionTokens: isPreview ? 1800 : 3000,
        });

        normalized = normalizeLinkedInOutput(repaired, context);
        issues = detectLinkedInIssues(normalized, context);
      } catch {
        // keep normalized main output if repair fails
      }
    }

    const finalPayload = buildFinalLinkedInResponse(normalized, isPreview);

    if (isPreview) {
      await ensureMinDelay(startedAt, 15000);
    }

    return res.status(200).json(finalPayload);
  } catch (err) {
    return res.status(500).json({
      error: "Server error",
      details: err?.message || String(err),
    });
  }
}
