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

const VALID_ROLE_FAMILIES = new Set([
  "software_engineering",
  "qa",
  "data",
  "product",
  "project",
  "business_analysis",
  "marketing",
  "sales",
  "customer_support",
  "customer_success",
  "operations",
  "procurement_supply_chain",
  "finance_accounting",
  "hr_recruiting",
  "administration",
  "executive_assistant",
  "design",
  "education",
  "healthcare_administration",
  "engineering",
  "legal_compliance",
  "generic",
]);

const ROLE_FAMILIES = {
  software_engineering: {
    titles: [
      "Software Engineer",
      "Software Developer",
      "Backend Engineer",
      "Frontend Engineer",
      "Full Stack Developer",
      "Full-Stack Developer",
      "Web Developer",
      "Application Developer",
      "Mobile Developer",
      "DevOps Engineer",
      "Systems Engineer",
    ],
    aliases: [
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
      "developer",
      "engineer",
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
      "REST API",
      "microservices",
      "SQL",
      "Python",
      "JavaScript",
      "TypeScript",
      "React",
      "Node.js",
      "Java",
      "C#",
      "AWS",
      "Azure",
      "GCP",
      "Docker",
      "Kubernetes",
      "Git",
      "CI/CD",
      "unit testing",
      "integration testing",
    ],
    toolTerms: [
      "SQL",
      "Python",
      "JavaScript",
      "TypeScript",
      "React",
      "Node.js",
      "Java",
      "C#",
      "AWS",
      "Azure",
      "GCP",
      "Docker",
      "Kubernetes",
      "Git",
      "Postman",
    ],
    linkedinKeywords: [
      "software development",
      "backend development",
      "frontend development",
      "API integration",
      "application architecture",
      "database design",
      "cloud services",
      "system reliability",
      "debugging",
      "code review",
    ],
    recruiterTerms: [
      "software engineer",
      "software developer",
      "backend engineer",
      "frontend engineer",
      "full stack developer",
      "web developer",
      "application developer",
    ],
  },
  qa: {
    titles: [
      "QA Engineer",
      "Quality Assurance Engineer",
      "Software Tester",
      "Test Engineer",
      "QA Analyst",
      "Automation Tester",
    ],
    aliases: [
      "qa engineer",
      "quality assurance engineer",
      "software tester",
      "test engineer",
      "qa analyst",
      "manual tester",
      "automation tester",
      "test analyst",
      "quality assurance",
      "qa",
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
      "QA",
      "test cases",
      "test scenarios",
      "regression testing",
      "Selenium",
      "Cypress",
      "Postman",
      "Jira",
      "bug tracking",
      "defect management",
      "UAT",
    ],
    toolTerms: ["Selenium", "Cypress", "Postman", "Jira", "API testing", "test automation"],
    linkedinKeywords: [
      "test execution",
      "regression testing",
      "defect tracking",
      "test documentation",
      "API testing",
      "automation testing",
      "quality validation",
      "release testing",
    ],
    recruiterTerms: ["qa engineer", "qa analyst", "software tester", "test engineer", "quality assurance"],
  },
  data: {
    titles: [
      "Data Analyst",
      "Business Intelligence Analyst",
      "BI Analyst",
      "Reporting Analyst",
      "Analytics Specialist",
    ],
    aliases: [
      "data analyst",
      "business intelligence analyst",
      "bi analyst",
      "reporting analyst",
      "analytics specialist",
      "data specialist",
      "business analyst data",
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
      "data modeling",
      "etl",
    ],
    strongTerms: [
      "SQL",
      "Python",
      "Excel",
      "Tableau",
      "Power BI",
      "Looker Studio",
      "dashboard",
      "KPI",
      "data modeling",
      "ETL",
      "reporting",
      "analysis",
    ],
    toolTerms: ["SQL", "Python", "Excel", "Tableau", "Power BI", "Looker Studio", "Google Sheets"],
    linkedinKeywords: [
      "data visualization",
      "dashboard reporting",
      "trend analysis",
      "KPI tracking",
      "data validation",
      "report automation",
      "data modeling",
      "ETL",
    ],
    recruiterTerms: ["data analyst", "bi analyst", "analytics specialist", "reporting analyst", "business intelligence"],
  },
  product: {
    titles: ["Product Manager", "Product Owner", "Associate Product Manager", "Technical Product Manager"],
    aliases: [
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
      "feature prioritization",
    ],
    strongTerms: [
      "roadmap",
      "backlog",
      "user stories",
      "requirements gathering",
      "acceptance criteria",
      "Jira",
      "Confluence",
      "Agile",
      "Scrum",
      "feature prioritization",
      "cross-functional collaboration",
    ],
    toolTerms: ["Jira", "Confluence", "Figma", "analytics"],
    linkedinKeywords: [
      "product roadmap",
      "backlog prioritization",
      "requirements gathering",
      "release planning",
      "acceptance criteria",
      "stakeholder communication",
      "cross-functional collaboration",
    ],
    recruiterTerms: ["product manager", "product owner", "associate product manager", "technical product manager"],
  },
  project: {
    titles: ["Project Manager", "Project Coordinator", "Program Coordinator", "Program Manager"],
    aliases: [
      "project manager",
      "project coordinator",
      "program coordinator",
      "program manager",
      "pm",
      "project lead",
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
      "Jira",
      "Confluence",
      "Agile",
      "Primavera P6",
      "MS Project",
    ],
    toolTerms: ["Jira", "Confluence", "Excel", "Primavera P6", "MS Project"],
    linkedinKeywords: [
      "timeline management",
      "deliverable coordination",
      "status reporting",
      "stakeholder communication",
      "risk tracking",
      "project documentation",
      "resource coordination",
      "milestone tracking",
    ],
    recruiterTerms: ["project manager", "project coordinator", "program manager", "program coordinator"],
  },
  business_analysis: {
    titles: ["Business Analyst", "Systems Analyst", "Process Analyst", "Operations Analyst"],
    aliases: ["business analyst", "systems analyst", "process analyst", "operations analyst"],
    keywords: [
      "business requirements",
      "process analysis",
      "gap analysis",
      "workflow analysis",
      "stakeholder interviews",
      "documentation",
      "reporting",
      "process mapping",
    ],
    strongTerms: [
      "requirements gathering",
      "process mapping",
      "gap analysis",
      "documentation",
      "stakeholder management",
      "Jira",
      "Confluence",
      "reporting",
      "Excel",
      "SQL",
      "UAT",
    ],
    toolTerms: ["Jira", "Confluence", "Excel", "SQL", "Power BI", "Visio"],
    linkedinKeywords: [
      "requirements gathering",
      "workflow analysis",
      "process mapping",
      "documentation",
      "stakeholder communication",
      "UAT support",
      "process improvement",
    ],
    recruiterTerms: ["business analyst", "systems analyst", "process analyst", "operations analyst"],
  },
  marketing: {
    titles: [
      "Digital Marketing Specialist",
      "Marketing Specialist",
      "Performance Marketing Specialist",
      "Marketing Executive",
      "Growth Marketer",
    ],
    aliases: [
      "digital marketing specialist",
      "marketing specialist",
      "performance marketing specialist",
      "marketing executive",
      "content specialist",
      "growth marketer",
      "marketing manager",
    ],
    keywords: [
      "Google Ads",
      "Meta Ads",
      "Google Analytics",
      "GA4",
      "Google Tag Manager",
      "SEO",
      "SEM",
      "PPC",
      "campaign reporting",
      "content marketing",
      "email marketing",
      "social media",
      "lead generation",
    ],
    strongTerms: [
      "Google Ads",
      "Meta Ads",
      "Google Analytics",
      "GA4",
      "Google Tag Manager",
      "SEO",
      "SEM",
      "PPC",
      "A/B test",
      "lead generation",
      "campaign optimization",
      "Search Console",
      "HubSpot",
    ],
    toolTerms: ["Google Ads", "Meta Ads", "Google Analytics", "GA4", "Google Tag Manager", "Search Console", "HubSpot"],
    linkedinKeywords: [
      "PPC",
      "SEO",
      "SEM",
      "GA4",
      "Google Tag Manager",
      "audience segmentation",
      "A/B testing",
      "lead generation",
      "campaign reporting",
    ],
    recruiterTerms: ["digital marketing specialist", "performance marketing specialist", "marketing specialist", "growth marketer"],
  },
  sales: {
    titles: ["Sales Specialist", "Sales Executive", "Account Executive", "Sales Coordinator", "Business Development Executive"],
    aliases: [
      "sales specialist",
      "sales executive",
      "account executive",
      "sales coordinator",
      "business development executive",
      "sales representative",
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
      "CRM",
      "lead follow-up",
      "account support",
      "sales reporting",
      "proposal",
      "deal tracking",
      "order processing",
      "Salesforce",
      "HubSpot",
    ],
    toolTerms: ["Salesforce", "HubSpot", "CRM", "Excel"],
    linkedinKeywords: [
      "sales pipeline",
      "lead management",
      "CRM",
      "proposal preparation",
      "deal tracking",
      "account coordination",
      "client follow-up",
      "sales reporting",
    ],
    recruiterTerms: ["sales executive", "sales specialist", "account executive", "sales coordinator", "business development"],
  },
  customer_support: {
    titles: [
      "Customer Support Specialist",
      "Customer Service Representative",
      "Support Specialist",
      "Technical Support Specialist",
      "Help Desk Specialist",
    ],
    aliases: [
      "customer support specialist",
      "customer service representative",
      "support specialist",
      "technical support specialist",
      "help desk specialist",
      "customer support",
      "customer service",
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
      "SLA",
      "Zendesk",
      "Freshdesk",
      "CRM",
      "help desk",
    ],
    toolTerms: ["Zendesk", "Freshdesk", "CRM", "help desk"],
    linkedinKeywords: [
      "ticket management",
      "issue resolution",
      "service quality",
      "SLA",
      "escalation handling",
      "support documentation",
      "customer communication",
      "case follow-up",
    ],
    recruiterTerms: ["customer support specialist", "customer service representative", "support specialist", "technical support specialist"],
  },
  customer_success: {
    titles: ["Customer Success Specialist", "Customer Success Manager", "Client Success Specialist", "Account Manager"],
    aliases: [
      "customer success specialist",
      "customer success manager",
      "client success specialist",
      "account manager",
      "customer success",
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
      "NPS",
      "CSAT",
      "QBR",
      "CRM",
      "Salesforce",
      "HubSpot",
    ],
    toolTerms: ["CRM", "Salesforce", "HubSpot"],
    linkedinKeywords: [
      "customer onboarding",
      "account management",
      "renewal support",
      "customer retention",
      "relationship management",
      "CSAT",
      "NPS",
      "QBR",
      "client engagement",
    ],
    recruiterTerms: ["customer success specialist", "customer success manager", "client success specialist", "account manager"],
  },
  operations: {
    titles: ["Operations Specialist", "Operations Coordinator", "Operations Analyst", "Operations Manager", "Office Manager"],
    aliases: [
      "operations specialist",
      "operations coordinator",
      "operations analyst",
      "operations manager",
      "office manager",
      "operations",
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
      "Excel",
      "ERP",
      "SAP",
      "Jira",
    ],
    toolTerms: ["Excel", "ERP", "SAP", "Jira"],
    linkedinKeywords: [
      "workflow coordination",
      "process documentation",
      "status reporting",
      "cross-functional collaboration",
      "task prioritization",
      "operational tracking",
      "resource coordination",
      "vendor communication",
    ],
    recruiterTerms: ["operations specialist", "operations coordinator", "operations analyst", "operations manager"],
  },
  procurement_supply_chain: {
    titles: [
      "Procurement Specialist",
      "Purchasing Specialist",
      "Buyer",
      "Logistics Specialist",
      "Supply Chain Specialist",
      "Logistics Coordinator",
    ],
    aliases: [
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
      "procurement",
      "logistics",
      "supply chain",
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
      "inventory",
      "shipment coordination",
      "warehouse operations",
      "order fulfillment",
      "delivery tracking",
      "stock control",
    ],
    strongTerms: [
      "procurement",
      "sourcing",
      "vendor management",
      "supplier communication",
      "purchase orders",
      "RFQ",
      "price comparison",
      "SAP",
      "ERP",
      "inventory management",
      "shipment tracking",
      "warehouse operations",
      "logistics coordination",
      "stock control",
      "order fulfillment",
    ],
    toolTerms: ["SAP", "ERP", "Excel", "warehouse management"],
    linkedinKeywords: [
      "vendor management",
      "sourcing",
      "purchase orders",
      "supplier communication",
      "RFQ",
      "inventory management",
      "shipment tracking",
      "warehouse operations",
      "logistics coordination",
      "stock control",
    ],
    recruiterTerms: ["procurement specialist", "buyer", "sourcing specialist", "supply chain specialist", "logistics specialist", "logistics coordinator"],
  },
  finance_accounting: {
    titles: [
      "Accountant",
      "Financial Analyst",
      "Finance Specialist",
      "Accounts Payable Specialist",
      "Accounts Receivable Specialist",
      "Bookkeeper",
      "Finance Assistant",
    ],
    aliases: [
      "accountant",
      "financial analyst",
      "finance specialist",
      "accounts payable specialist",
      "accounts receivable specialist",
      "bookkeeper",
      "finance assistant",
      "finance",
      "accounting",
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
      "Excel",
      "IFRS",
      "GAAP",
      "SAP",
      "Oracle",
      "QuickBooks",
      "NetSuite",
      "ERP",
    ],
    toolTerms: ["Excel", "SAP", "Oracle", "QuickBooks", "NetSuite", "ERP"],
    linkedinKeywords: [
      "financial reporting",
      "account reconciliation",
      "budget tracking",
      "variance analysis",
      "forecasting",
      "month-end close",
      "AP/AR",
      "audit support",
      "ERP systems",
    ],
    recruiterTerms: ["accountant", "financial analyst", "finance specialist", "accounts payable specialist", "accounts receivable specialist", "bookkeeper"],
  },
  hr_recruiting: {
    titles: ["HR Specialist", "Human Resources Specialist", "Recruiter", "Talent Acquisition Specialist", "HR Coordinator"],
    aliases: [
      "hr specialist",
      "human resources specialist",
      "recruiter",
      "talent acquisition specialist",
      "hr coordinator",
      "people operations specialist",
      "human resources",
      "hr",
      "recruiting",
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
      "Workday",
      "Greenhouse",
      "ATS",
      "HRIS",
    ],
    toolTerms: ["Workday", "Greenhouse", "ATS", "Excel", "HRIS"],
    linkedinKeywords: [
      "talent acquisition",
      "candidate screening",
      "interview coordination",
      "employee onboarding",
      "HR administration",
      "policy compliance",
      "record management",
      "HRIS",
    ],
    recruiterTerms: ["hr specialist", "human resources specialist", "recruiter", "talent acquisition specialist", "hr coordinator"],
  },
  administration: {
    titles: ["Administrative Assistant", "Office Assistant", "Admin Assistant", "Office Coordinator"],
    aliases: [
      "administrative assistant",
      "office assistant",
      "admin assistant",
      "office coordinator",
      "administration",
      "administrative support",
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
      "Office",
      "Excel",
      "PowerPoint",
      "Google Sheets",
    ],
    toolTerms: ["Office", "Excel", "PowerPoint", "Google Sheets"],
    linkedinKeywords: [
      "document management",
      "calendar coordination",
      "meeting scheduling",
      "record maintenance",
      "office administration",
      "task coordination",
      "data entry accuracy",
      "administrative reporting",
    ],
    recruiterTerms: ["administrative assistant", "office assistant", "admin assistant", "office coordinator"],
  },
  executive_assistant: {
    titles: ["Executive Assistant", "Personal Assistant", "Administrative Assistant"],
    aliases: [
      "executive assistant",
      "personal assistant",
      "administrative assistant",
      "executive support",
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
      "Excel",
      "PowerPoint",
      "Office",
      "Google Sheets",
    ],
    toolTerms: ["Excel", "PowerPoint", "Office", "Google Sheets"],
    linkedinKeywords: [
      "calendar management",
      "meeting coordination",
      "travel coordination",
      "document management",
      "record maintenance",
      "executive support",
      "task prioritization",
      "stakeholder communication",
    ],
    recruiterTerms: ["executive assistant", "personal assistant", "administrative assistant"],
  },
  design: {
    titles: ["Designer", "Graphic Designer", "UI Designer", "UX Designer", "Product Designer", "Visual Designer"],
    aliases: ["designer", "graphic designer", "ui designer", "ux designer", "product designer", "visual designer"],
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
      "Figma",
      "Adobe Creative Suite",
      "Photoshop",
      "Illustrator",
      "wireframes",
      "prototypes",
      "UI",
      "UX",
      "design system",
      "mockups",
    ],
    toolTerms: ["Figma", "Adobe Creative Suite", "Photoshop", "Illustrator", "After Effects"],
    linkedinKeywords: [
      "wireframing",
      "prototyping",
      "design systems",
      "UI design",
      "UX design",
      "user flows",
      "visual design",
      "mockups",
    ],
    recruiterTerms: ["graphic designer", "ui designer", "ux designer", "product designer", "visual designer"],
  },
  education: {
    titles: ["Teacher", "Instructor", "Lecturer", "Teaching Assistant"],
    aliases: ["teacher", "english teacher", "math teacher", "subject teacher", "instructor", "lecturer", "teaching assistant"],
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
      "Google Classroom",
      "PowerPoint",
      "Office",
    ],
    toolTerms: ["Excel", "PowerPoint", "Google Classroom", "Office"],
    linkedinKeywords: [
      "lesson planning",
      "classroom management",
      "student assessment",
      "curriculum development",
      "learning materials",
      "student progress tracking",
      "instruction",
      "academic planning",
    ],
    recruiterTerms: ["teacher", "instructor", "lecturer", "teaching assistant"],
  },
  healthcare_administration: {
    titles: ["Healthcare Administrator", "Medical Secretary", "Medical Office Assistant", "Patient Coordinator", "Clinic Coordinator"],
    aliases: [
      "healthcare administrator",
      "medical secretary",
      "medical office assistant",
      "patient coordinator",
      "clinic coordinator",
      "healthcare administration",
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
      "EHR",
      "EMR",
      "HIPAA",
      "appointment coordination",
      "patient communication",
      "clinic administration",
    ],
    toolTerms: ["EHR", "EMR", "Excel", "Office"],
    linkedinKeywords: [
      "patient scheduling",
      "medical records",
      "insurance verification",
      "EHR/EMR",
      "appointment coordination",
      "HIPAA",
      "patient communication",
      "clinic administration",
    ],
    recruiterTerms: ["healthcare administrator", "medical secretary", "medical office assistant", "patient coordinator", "clinic coordinator"],
  },
  engineering: {
    titles: ["Engineer", "Civil Engineer", "Mechanical Engineer", "Site Engineer", "Design Engineer", "Production Engineer"],
    aliases: [
      "engineer",
      "civil engineer",
      "site engineer",
      "construction engineer",
      "mechanical engineer",
      "design engineer",
      "maintenance engineer",
      "production engineer",
      "industrial engineer",
    ],
    keywords: [
      "technical drawings",
      "site supervision",
      "construction",
      "quantity takeoff",
      "boq",
      "technical documentation",
      "autocad",
      "revit",
      "primavera p6",
      "solidworks",
      "equipment maintenance",
      "production support",
      "quality checks",
    ],
    strongTerms: [
      "AutoCAD",
      "Revit",
      "Primavera P6",
      "site supervision",
      "technical drawings",
      "quantity takeoff",
      "BOQ",
      "construction documentation",
      "inspection",
      "SolidWorks",
      "preventive maintenance",
      "equipment inspection",
      "quality checks",
      "root cause analysis",
    ],
    toolTerms: ["AutoCAD", "Revit", "Primavera P6", "SolidWorks", "Excel", "ERP"],
    linkedinKeywords: [
      "technical documentation",
      "drawing review",
      "site coordination",
      "quantity takeoff",
      "equipment inspection",
      "preventive maintenance",
      "production support",
      "quality checks",
    ],
    recruiterTerms: ["civil engineer", "mechanical engineer", "site engineer", "design engineer", "production engineer", "engineer"],
  },
  legal_compliance: {
    titles: ["Legal Assistant", "Compliance Specialist", "Compliance Analyst", "Legal Support Specialist"],
    aliases: [
      "legal assistant",
      "compliance specialist",
      "compliance analyst",
      "legal support specialist",
      "legal support",
      "compliance",
    ],
    keywords: [
      "compliance",
      "legal documentation",
      "contract support",
      "policy review",
      "regulatory documentation",
      "case files",
      "record maintenance",
    ],
    strongTerms: [
      "compliance",
      "legal documentation",
      "contract support",
      "policy review",
      "regulatory documentation",
      "case files",
      "record maintenance",
      "audit support",
    ],
    toolTerms: ["Excel", "Office"],
    linkedinKeywords: [
      "compliance documentation",
      "policy review",
      "contract support",
      "record maintenance",
      "regulatory support",
      "documentation control",
    ],
    recruiterTerms: ["compliance specialist", "compliance analyst", "legal assistant", "legal support specialist"],
  },
  generic: {
    titles: ["Professional", "Specialist", "Coordinator", "Analyst"],
    aliases: [],
    keywords: ["documentation", "coordination", "reporting", "analysis", "communication", "tracking", "support"],
    strongTerms: ["documentation", "coordination", "reporting", "analysis", "communication", "tracking", "support", "Excel", "Office"],
    toolTerms: ["Excel", "Office", "Google Sheets", "PowerPoint"],
    linkedinKeywords: ["documentation", "cross-functional collaboration", "process tracking", "stakeholder communication", "task coordination", "reporting"],
    recruiterTerms: ["specialist", "coordinator", "analyst", "professional"],
  },
};

const TITLE_DENYLIST_BY_FAMILY = {
  operations: ["market manager", "marketing manager", "product manager", "finance manager"],
  customer_support: ["customer success manager", "product manager", "marketing manager"],
  procurement_supply_chain: ["marketing manager", "product manager", "market manager"],
  administration: ["operations manager", "product manager", "marketing manager"],
  executive_assistant: ["operations manager", "product manager", "marketing manager"],
};

const META_LANGUAGE_RE = /\b(on linkedin[, ]*i aim to|i use clean recruiter-safe language|recruiter-safe language|search-aware|grounded positioning|right audience|strong wording|make the work more visible|the goal is not to sound louder|position my work|recruiter-ready language|linkedIn strategy|profile positioning|writing style)\b/i;
const FLUFF_RE = /\b(dynamic|robust|seamless|impactful|high-impact|comprehensive|various|overall|strategic initiatives|operational excellence|value-driven|best-in-class|visionary|game-changing|world-class|transformational|synergy|self-starter|go-getter|passionate|results-driven|highly motivated|hardworking|dedicated)\b/i;
const UNSUPPORTED_IMPACT_RE = /\b(improve(?:d|s|ing)? efficiency|operational value|stakeholder readiness|future analysis|decision-making|better campaign outcomes|improved follow-up|reduced costs|generated revenue|improved retention|optimized performance|accelerated delivery|enable teams to work with fewer interruptions|support quality improvements|business impact|strategic ownership|growth strategy|revenue growth|performance gains)\b/i;
const WEAK_REWRITE_START_RE = /^(?:actively\s+)?(?:helped|assisted|supported|contributed|participated|aided|worked on|involved in|responsible for|handled)\b/i;
const WEAK_START_RE = /^(helped|helps|assisted|assists|supported|supports|worked on|contributed to|participated in|involved in|handled|tasked with|responsible for|duties included|provided support for|yardımcı oldum|destek verdim|destek oldum|görev aldım|ilgilen(dim|di)|bulundum|çalıştım|yaptım)\b/i;
const STRONG_ACTION_RE = /\b(engineered|built|developed|designed|implemented|integrated|tested|debugged|validated|automated|configured|deployed|maintained|planned|executed|created|responded|resolved|documented|scheduled|reviewed|updated|monitored|processed|reconciled|screened|analyzed|reported|tracked|managed|delivered|verified|produced|prepared|mapped|facilitated|taught|assessed|inspected|coordinated|collaborated|communicated|organized|compiled|addressed|guided|hazırladım|analiz ettim|raporladım|geliştirdim|oluşturdum|uyguladım|organize ettim|takip ettim|düzenledim|izledim|tasarladım|planladım|sundum|denetledim|doğruladım|işledim|değerlendirdim|koordine ettim)\b/i;
const GENERIC_ROLE_DRIFT_RE = /\b(market manager|marketing manager|product manager|finance manager|customer success manager|operations manager|director|head of)\b/i;
const ACRONYM_RE = /\b[A-Z]{2,}(?:\/[A-Z]{2,})?\b/;

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
  return String(str || "").trim().split(/\s+/).filter(Boolean).length;
}

function clampText(str = "", max = 1000) {
  return String(str || "").replace(/\s+/g, " ").trim().slice(0, max);
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
    String(line || "").trim()
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

  try {
    const payloadJson = Buffer.from(data, "base64url").toString("utf8");
    const payload = JSON.parse(payloadJson);
    if (!payload?.exp || Date.now() > payload.exp) return false;
    return true;
  } catch {
    return false;
  }
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

function normalizeSeniority(value = "") {
  const s = String(value || "mid").trim().toLowerCase();
  if (VALID_SENIORITY.has(s)) return s;
  if (/intern|staj/i.test(s)) return "intern";
  if (/junior|jr/i.test(s)) return "junior";
  if (/associate/i.test(s)) return "associate";
  if (/senior|sr|uzman|k[ıi]demli/i.test(s)) return "senior";
  if (/lead/i.test(s)) return "lead";
  if (/manager|supervisor/i.test(s)) return "manager";
  if (/director|head/i.test(s)) return "director";
  if (/executive|vp|chief|c-level/i.test(s)) return "executive";
  return "mid";
}

function normalizeTone(value = "") {
  const s = String(value || "clean").trim().toLowerCase();
  return VALID_TONES.has(s) ? s : "clean";
}

function normalizeRoleFamily(value = "") {
  const raw = String(value || "").trim().toLowerCase();
  if (!raw) return "";
  if (VALID_ROLE_FAMILIES.has(raw)) return raw;

  const aliases = {
    software: "software_engineering",
    engineering_software: "software_engineering",
    test: "qa",
    analytics: "data",
    bi: "data",
    project_management: "project",
    business_analyst: "business_analysis",
    customer_service: "customer_support",
    support: "customer_support",
    supply_chain: "procurement_supply_chain",
    logistics: "procurement_supply_chain",
    procurement: "procurement_supply_chain",
    finance: "finance_accounting",
    accounting: "finance_accounting",
    hr: "hr_recruiting",
    recruiting: "hr_recruiting",
    admin: "administration",
    healthcare_admin: "healthcare_administration",
    legal: "legal_compliance",
    compliance: "legal_compliance",
  };

  return aliases[raw] || "";
}

function looksLikeAcronym(term = "") {
  const raw = String(term || "").trim();
  return ACRONYM_RE.test(raw) || /^[A-Z0-9/+.-]{2,10}$/.test(raw);
}

function isLikelyToolOrPlatform(term = "") {
  const norm = canonicalizeTerm(term);
  return HARD_FACT_TERMS.some((x) => canonicalizeTerm(x) === norm);
}

function cleanListItem(term = "") {
  return String(term || "")
    .replace(/^[-•·‣▪▫◦*\d.)\s]+/, "")
    .replace(/[,:;]+$/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

function extractTermSignals(text = "") {
  const norm = canonicalizeTerm(text);
  return HARD_FACT_TERMS.filter((term) => containsCanonicalTermInNormalizedText(norm, term));
}

function getAllFamilyTerms(familyKey = "generic") {
  const family = ROLE_FAMILIES[familyKey] || ROLE_FAMILIES.generic;
  return uniqueTrimmedStrings([
    ...(family.titles || []),
    ...(family.aliases || []),
    ...(family.keywords || []),
    ...(family.strongTerms || []),
    ...(family.toolTerms || []),
    ...(family.linkedinKeywords || []),
    ...(family.recruiterTerms || []),
  ]);
}

function inferRoleFamilyFromText(text = "") {
  const scored = Object.entries(ROLE_FAMILIES)
    .filter(([key]) => key !== "generic")
    .map(([key, family]) => {
      const score =
        countTermHits(text, family.aliases || []) * 8 +
        countTermHits(text, family.titles || []) * 7 +
        countTermHits(text, family.keywords || []) * 4 +
        countTermHits(text, family.strongTerms || []) * 5 +
        countTermHits(text, family.toolTerms || []) * 5 +
        countTermHits(text, family.linkedinKeywords || []) * 3;
      return { key, score };
    })
    .sort((a, b) => b.score - a.score);

  if (!scored.length || scored[0].score <= 0) return "generic";
  return scored[0].key;
}

function inferRoleProfile({ cv = "", jd = "", targetRole = "", roleFamily = "" } = {}) {
  const safeCv = String(cv || "");
  const safeJd = String(jd || "");
  const safeTargetRole = String(targetRole || "");
  const combined = `${safeCv}\n${safeJd}\n${safeTargetRole}`.trim();

  const forcedFamily = normalizeRoleFamily(roleFamily);
  const inferredCvFamily = inferRoleFamilyFromText(`${extractHeaderBlock(safeCv).join(" ")} ${extractExperienceTitles(safeCv).join(" ")} ${getSkillsLines(safeCv).join(" ")} ${getBulletLines(safeCv).join(" ")} ${extractSummaryLines(safeCv).join(" ")}`);
  const inferredTargetFamily = inferRoleFamilyFromText(`${safeTargetRole}\n${safeJd}`);
  const primaryFamily = forcedFamily || inferredCvFamily || inferredTargetFamily || "generic";
  const secondaryFamily = forcedFamily ? (inferredCvFamily !== forcedFamily ? inferredCvFamily : inferredTargetFamily) : inferredTargetFamily;
  const family = ROLE_FAMILIES[primaryFamily] || ROLE_FAMILIES.generic;
  const normalizedText = canonicalizeTerm(combined);

  const familySignals = uniqueTrimmedStrings(getAllFamilyTerms(primaryFamily)).filter((term) =>
    containsCanonicalTermInNormalizedText(normalizedText, term)
  );

  const explicitTools = uniqueByNormalizedStrings(extractTermSignals(combined));
  const titleSignals = uniqueByNormalizedStrings([
    ...extractExperienceTitles(safeCv),
    ...extractHeaderBlock(safeCv),
  ]).filter((line) => countTermHits(line, family.aliases || []) > 0 || countTermHits(line, family.titles || []) > 0);

  return {
    roleFamily: primaryFamily,
    secondaryFamily: secondaryFamily && secondaryFamily !== primaryFamily ? secondaryFamily : "",
    family,
    targetRole: safeTargetRole,
    inferredSeniority: normalizeSeniority(`${safeTargetRole} ${extractHeaderBlock(safeCv).join(" ")} ${extractExperienceTitles(safeCv).join(" ")}`),
    familySignals: familySignals.slice(0, 18),
    explicitTools: explicitTools.slice(0, 20),
    titleSignals: titleSignals.slice(0, 8),
  };
}

function buildRoleContextText({ cv = "", jd = "", meta = {}, roleProfile }) {
  const profile = roleProfile || inferRoleProfile({
    cv,
    jd,
    targetRole: meta?.target_role || "",
    roleFamily: meta?.role_family || "",
  });

  const family = ROLE_FAMILIES[profile.roleFamily] || ROLE_FAMILIES.generic;
  return [
    `- role_family_hard_constraint: ${profile.roleFamily}`,
    `- secondary_family_signal: ${profile.secondaryFamily || "(none)"}`,
    `- target_role_soft_guidance: ${String(meta?.target_role || "").trim() || "(none)"}`,
    `- seniority: ${normalizeSeniority(meta?.seniority || profile.inferredSeniority || "mid")}`,
    `- industry: ${String(meta?.industry || "").trim() || "(none)"}`,
    `- location: ${String(meta?.location || "").trim() || "(none)"}`,
    `- tone: ${normalizeTone(meta?.tone || "clean")}`,
    `- candidate_title_signals: ${profile.titleSignals.join(", ") || "(none)"}`,
    `- role_family_titles: ${(family.titles || []).join(", ") || "(none)"}`,
    `- role_family_signals_found: ${profile.familySignals.join(", ") || "(none)"}`,
    `- explicit_supported_tools_terms: ${profile.explicitTools.join(", ") || "(none)"}`,
  ].join("\n");
}

function buildLinkedInSystem(outLang = "English") {
  return `
CRITICAL RULES:
- You are writing LinkedIn optimization output only.
- All output values must be written only in ${outLang}. Proper nouns and platform names may stay as-is.
- NEVER invent metrics, percentages, KPIs, budgets, clients, team size, headcount, revenue, results, leadership, ownership, certifications, employers, dates, tools, systems, or platforms.
- Use only facts explicitly supported by the resume, optional JD, and provided metadata.
- role_family is a HARD CONSTRAINT. Stay inside that family. Do not drift into another profession.
- target_role is SOFT GUIDANCE. It can shape positioning, but cannot overwrite the real profile with unsupported claims.
- Headlines must stay inside the chosen role family, sound natural, and avoid keyword spam.
- About sections must describe the candidate, not the writing strategy. Never mention LinkedIn strategy, recruiter-safe wording, search-awareness, profile positioning, or internal writing logic.
- Experience fixes must only rewrite genuinely weak or improvable bullets. The rewrite must be materially better, not a one-word swap.
- Do not use fluffy or exaggerated wording. Avoid meta language, corporate fluff, and fake polish.
- If source evidence is thin, prefer conservative wording.
- Return ONLY valid JSON. No markdown. No commentary.
`.trim();
}

function buildPreviewPrompt({ cv, jd, outLang, meta, roleProfile }) {
  return `
Return JSON in this exact schema:
{
  "headlines": [{"label": string, "text": string}],
  "about": {"short": string},
  "experience_fix": [{"before": string, "after": string, "why": string}],
  "skills": {"top": string[]},
  "recruiter": {"keywords": string[]}
}

REQUIREMENTS:
- headlines: exactly 1 item.
- about.short: one complete LinkedIn-ready summary, concise and natural.
- experience_fix: 0-1 items only, and only if there is a genuine improvement opportunity.
- skills.top: 6-10 grounded items.
- recruiter.keywords: 5-8 grounded items.
- Keep output conservative, truthful, and role-family aligned.
- Never include meta-writing language.
- Never invent tools, systems, or titles.

TARGETING CONTEXT:
${buildRoleContextText({ cv, jd, meta, roleProfile })}

RESUME:
${cv}

OPTIONAL JOB DESCRIPTION / TARGET ROLE CONTEXT:
${jd || meta?.target_role || "(none)"}
`.trim();
}

function buildFullPrompt({ cv, jd, outLang, meta, roleProfile }) {
  return `
Return JSON in this exact schema:
{
  "headlines": [{"label": string, "text": string}],
  "about": {"short": string, "normal": string, "bold": string},
  "experience_fix": [{"before": string, "after": string, "why": string}],
  "skills": {"top": string[], "tools": string[], "industry": string[]},
  "recruiter": {"keywords": string[], "boolean": string}
}

REQUIREMENTS:
- headlines: exactly 5 items with these labels only: Search, Impact, Niche, Leadership, Clean.
- Each headline must stay inside the chosen role family and must not invent a different profession.
- about.short, about.normal, about.bold must sound like real candidate summaries, not writing strategy commentary.
- about.bold may be stronger in tone, but must still stay truthful and role-accurate.
- experience_fix: return 4-6 items only when there are real, grounded, materially stronger rewrites.
- Reject shallow rewrites.
- skills.top: 10-16 grounded items.
- skills.tools: 6-14 grounded items.
- skills.industry: 8-16 grounded items.
- recruiter.keywords: 8-16 grounded items tightly aligned to role_family and target_role.
- recruiter.boolean: concise, recruiter-usable, family-aligned, and free of unrelated roles.
- Never include meta-writing language.
- Never invent tools, systems, or titles.
- Never let target_role overpower role_family.

TARGETING CONTEXT:
${buildRoleContextText({ cv, jd, meta, roleProfile })}

RESUME:
${cv}

OPTIONAL JOB DESCRIPTION / TARGET ROLE CONTEXT:
${jd || meta?.target_role || "(none)"}
`.trim();
}

function isGpt5Model(model = "") {
  return /^gpt-5/i.test(String(model || "").trim());
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

  if (passType === "repair") {
    return [
      {
        reasoningEffort: "low",
        temperature: null,
        maxCompletionTokens: Math.max(maxCompletionTokens, 2600),
      },
      {
        reasoningEffort: "none",
        temperature: 0.2,
        maxCompletionTokens: Math.max(maxCompletionTokens, 3200),
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
        maxCompletionTokens: Math.max(maxCompletionTokens, 1600),
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
      reasoningEffort: "none",
      temperature: 0.2,
      maxCompletionTokens: Math.max(maxCompletionTokens, 2800),
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

function scoreSentenceStrength(sentence = "", roleProfile) {
  const s = String(sentence || "").trim();
  if (!s) return { weakScore: 0, strongScore: 0, isWeak: false };

  const familyTerms = getAllFamilyTerms(roleProfile?.roleFamily || "generic");
  let weakScore = 0;
  let strongScore = 0;

  if (WEAK_START_RE.test(s)) weakScore += 4;
  if (!STRONG_ACTION_RE.test(s)) weakScore += 1;
  if (countWords(s) <= 6) weakScore += 2;
  if (FLUFF_RE.test(s)) weakScore += 1;

  if (countTermHits(s, familyTerms) > 1) strongScore += 2;
  if (extractTermSignals(s).length > 0) strongScore += 2;
  if (/\b\d+(?:[.,]\d+)?%?\b/.test(s)) strongScore += 2;
  if (STRONG_ACTION_RE.test(s)) strongScore += 2;
  if (countWords(s) >= 8 && countWords(s) <= 22) strongScore += 1;

  return {
    weakScore,
    strongScore,
    isWeak: weakScore >= 4 && strongScore <= 3,
  };
}

function extractWeakCandidates(cv = "", roleProfile) {
  const bullets = getBulletLines(cv)
    .map((sentence) => ({ sentence, score: scoreSentenceStrength(sentence, roleProfile) }))
    .filter((item) => item.score.isWeak)
    .sort((a, b) => b.score.weakScore - a.score.weakScore || a.score.strongScore - b.score.strongScore)
    .map((item) => item.sentence);

  return uniqueByNormalizedStrings(bullets).slice(0, 8);
}

function buildRoleAnchoredRewrite(source = "", roleProfile) {
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

  const family = roleProfile?.roleFamily || "generic";
  let verb = "Coordinated";

  if (/(email|live chat|customer|client|request|inquir|ticket|case|issue|escalat|follow-?up)/i.test(sentence)) {
    verb = family === "customer_support" ? "Handled" : "Coordinated";
  } else if (/(report|dashboard|summary|analysis|reconciliation|audit|review|validation)/i.test(sentence)) {
    verb = "Prepared";
  } else if (/(document|record|file|log|note|documentation)/i.test(sentence)) {
    verb = "Maintained";
  } else if (/(schedule|calendar|meeting|travel|appointment)/i.test(sentence)) {
    verb = "Coordinated";
  } else if (/(api|backend|frontend|database|feature|deployment|code)/i.test(sentence)) {
    verb = "Implemented";
  } else if (/(lesson|classroom|student|curriculum)/i.test(sentence)) {
    verb = "Delivered";
  } else if (/(patient|medical|insurance|clinic)/i.test(sentence)) {
    verb = "Coordinated";
  } else if (/(shipment|inventory|vendor|purchase order|rfq|procurement|logistics)/i.test(sentence)) {
    verb = "Tracked";
  } else if (/(campaign|ads|content|seo|sem|social media)/i.test(sentence)) {
    verb = "Managed";
  }

  const rewrite = `${verb} ${lowerFirst(remainder)}`.replace(/\s+/g, " ").trim();
  if (!rewrite) return "";
  if (WEAK_REWRITE_START_RE.test(rewrite)) return "";
  if (canonicalizeTerm(rewrite) === canonicalizeTerm(sentence)) return "";
  if (jaccardSimilarity(sentence, rewrite) >= 0.9) return "";
  if (UNSUPPORTED_IMPACT_RE.test(rewrite) && !UNSUPPORTED_IMPACT_RE.test(sentence)) return "";
  return `${rewrite}${ending}`;
}

function getAllowedTermsSet({ cv = "", jd = "", roleProfile, meta = {} }) {
  const profile = roleProfile;
  const family = ROLE_FAMILIES[profile?.roleFamily || "generic"] || ROLE_FAMILIES.generic;
  const text = `${cv}\n${jd}\n${meta?.target_role || ""}\n${meta?.industry || ""}`;
  const explicit = uniqueTrimmedStrings([
    ...extractTermSignals(text),
    ...profile.explicitTools,
    ...profile.familySignals,
    ...profile.titleSignals,
  ]);

  const familySupported = uniqueTrimmedStrings([
    ...(family.keywords || []),
    ...(family.strongTerms || []),
    ...(family.linkedinKeywords || []),
    ...(family.recruiterTerms || []),
  ]).filter((term) => containsCanonicalTermInNormalizedText(canonicalizeTerm(text), term));

  return new Set(uniqueTrimmedStrings([...explicit, ...familySupported]).map(canonicalizeTerm));
}

function isSupportedTerm(term = "", allowedSet = new Set(), roleProfile) {
  const norm = canonicalizeTerm(term);
  if (!norm) return false;
  if (allowedSet.has(norm)) return true;

  const familyTerms = getAllFamilyTerms(roleProfile?.roleFamily || "generic").map(canonicalizeTerm);
  if (!isLikelyToolOrPlatform(term) && familyTerms.includes(norm)) return true;
  return false;
}

function headlineLooksValid(text = "", context) {
  const value = clampText(text, 220);
  if (!value) return false;
  if (META_LANGUAGE_RE.test(value) || FLUFF_RE.test(value)) return false;

  const norm = canonicalizeTerm(value);
  const deny = TITLE_DENYLIST_BY_FAMILY[context.roleProfile.roleFamily] || [];
  if (deny.some((x) => containsCanonicalTermInNormalizedText(norm, x))) return false;

  if (context.roleProfile.roleFamily !== "generic") {
    const familyTerms = getAllFamilyTerms(context.roleProfile.roleFamily);
    if (countTermHits(value, familyTerms) <= 0 && countTermHits(value, context.roleProfile.titleSignals) <= 0 && countTermHits(value, [context.meta.target_role || ""]) <= 0) {
      return false;
    }
  }

  if (context.meta.role_family && context.roleProfile.roleFamily !== "generic" && GENERIC_ROLE_DRIFT_RE.test(value)) {
    const familyRecruiterTerms = (ROLE_FAMILIES[context.roleProfile.roleFamily]?.recruiterTerms || []).map(canonicalizeTerm);
    const hit = familyRecruiterTerms.some((term) => containsCanonicalTermInNormalizedText(norm, term));
    if (!hit) return false;
  }

  return true;
}

function normalizeHeadlineLabel(label = "", index = 0, isPreview = false) {
  const labels = ["Search", "Impact", "Niche", "Leadership", "Clean"];
  const clean = String(label || "").trim();
  if (isPreview) return "Search";
  return labels.includes(clean) ? clean : labels[index] || labels[labels.length - 1];
}

function buildFallbackHeadlines(context) {
  const family = ROLE_FAMILIES[context.roleProfile.roleFamily] || ROLE_FAMILIES.generic;
  const targetRole = String(context.meta.target_role || "").trim();
  const mainTitle = targetRole || context.roleProfile.titleSignals[0] || family.titles[0] || "Professional";
  const terms = uniqueTrimmedStrings([
    ...context.roleProfile.familySignals,
    ...(family.linkedinKeywords || []),
    ...(family.strongTerms || []),
  ]).slice(0, 8);

  const items = [
    { label: "Search", text: `${mainTitle}${terms[0] ? ` | ${terms[0]}` : ""}${terms[1] ? `, ${terms[1]}` : ""}` },
    { label: "Impact", text: `${mainTitle}${terms[2] ? ` | ${terms[2]}` : terms[0] ? ` | ${terms[0]}` : ""}` },
    { label: "Niche", text: `${mainTitle}${terms[3] ? ` | ${terms[3]}` : ""}${terms[4] ? ` | ${terms[4]}` : ""}` },
    { label: "Leadership", text: `${mainTitle} | ${["lead", "manager", "director", "executive"].includes(context.meta.seniority) ? "Team Coordination" : "Cross-Functional Collaboration"}` },
    { label: "Clean", text: `${mainTitle}${context.meta.industry ? ` | ${context.meta.industry}` : terms[5] ? ` | ${terms[5]}` : ""}` },
  ];

  return items.filter((item) => headlineLooksValid(item.text, context)).slice(0, context.isPreview ? 1 : 5);
}

function normalizeHeadlines(rawHeadlines, context) {
  const items = (Array.isArray(rawHeadlines) ? rawHeadlines : [])
    .map((item, idx) => ({
      label: normalizeHeadlineLabel(item?.label, idx, context.isPreview),
      text: clampText(item?.text, 220),
    }))
    .filter((item) => item.text && headlineLooksValid(item.text, context));

  const out = [];
  const seenText = new Set();
  const seenLabel = new Set();

  for (const item of items) {
    const key = canonicalizeTerm(item.text);
    if (!key || seenText.has(key)) continue;
    if (!context.isPreview && seenLabel.has(item.label)) continue;
    seenText.add(key);
    seenLabel.add(item.label);
    out.push(item);
  }

  for (const item of buildFallbackHeadlines(context)) {
    if (out.length >= (context.isPreview ? 1 : 5)) break;
    const key = canonicalizeTerm(item.text);
    if (!key || seenText.has(key)) continue;
    if (!context.isPreview && seenLabel.has(item.label)) continue;
    seenText.add(key);
    seenLabel.add(item.label);
    out.push(item);
  }

  return out.slice(0, context.isPreview ? 1 : 5);
}

function buildFallbackAbout(context) {
  const family = ROLE_FAMILIES[context.roleProfile.roleFamily] || ROLE_FAMILIES.generic;
  const title = String(context.meta.target_role || "").trim() || context.roleProfile.titleSignals[0] || family.titles[0] || "Professional";
  const terms = uniqueTrimmedStrings([
    ...context.roleProfile.familySignals,
    ...(family.linkedinKeywords || []),
    ...(family.strongTerms || []),
  ]).slice(0, 6);
  const summary = extractSummaryLines(context.cv)[0] || "";

  if (context.outLang === "Turkish") {
    const base = `${title} odağında çalışan bir profesyonelim. Deneyimim ${terms.slice(0, 3).join(", ") || "rol odaklı süreçler, koordinasyon ve uygulama"} alanlarında şekilleniyor.${summary ? ` ${clampText(summary, 180)}` : ""}`.trim();
    const normal = `${base} Çalışma tarzım düzenli takip, açık iletişim ve deneyimi olduğu gibi yansıtan profesyonel bir yaklaşım üzerine kuruludur.${terms.slice(3, 5).length ? ` Öne çıkan alanlarım arasında ${terms.slice(3, 5).join(", ")} yer alır.` : ""}`.trim();
    const bold = `${normal} Profilimde deneyimi abartmadan, daha net ve daha güçlü bir dille sunmaya odaklanıyorum.`.trim();
    return {
      short: clampText(base, 850),
      normal: clampText(normal, 1400),
      bold: clampText(bold, 1400),
    };
  }

  const short = `${summary ? `${clampText(summary, 180)} ` : ""}I work in ${lowerFirst(title)}-aligned roles with experience in ${terms.slice(0, 3).join(", ") || "structured execution, coordination, and documentation"}. My background reflects practical work, steady follow-through, and clear communication within the scope of the roles I have held.`.replace(/\s+/g, " ").trim();
  const normal = `${short} My work style is grounded in consistency, role-appropriate communication, and reliable execution. ${terms.slice(3, 5).length ? `Additional areas of focus include ${terms.slice(3, 5).join(", ")}.` : ""}`.replace(/\s+/g, " ").trim();
  const bold = `${normal} I present my experience with a clear, direct tone while keeping the language accurate and fully supported by the work itself.`.replace(/\s+/g, " ").trim();

  return {
    short: clampText(short, 850),
    normal: clampText(normal, 1400),
    bold: clampText(bold, 1400),
  };
}

function sanitizeAboutText(text = "") {
  let out = clampText(text, 1500);
  out = out.replace(/\bOn LinkedIn,?\b[^.]*\.?/gi, " ");
  out = out.replace(/\bI use clean recruiter-safe language\b[^.]*\.?/gi, " ");
  out = out.replace(/\bThe goal is not to sound louder\b[^.]*\.?/gi, " ");
  out = out.replace(/\bI aim to\b[^.]*LinkedIn[^.]*\.?/gi, " ");
  out = out.replace(/\s+/g, " ").trim();
  return out;
}

function aboutLooksValid(text = "") {
  const value = sanitizeAboutText(text);
  if (!value) return false;
  if (META_LANGUAGE_RE.test(value)) return false;
  if (FLUFF_RE.test(value)) return false;
  if (UNSUPPORTED_IMPACT_RE.test(value)) return false;
  if (value.length < 120) return false;
  return true;
}

function normalizeAbout(rawAbout = {}, context) {
  const fallback = buildFallbackAbout(context);
  let short = sanitizeAboutText(rawAbout?.short) || fallback.short;
  let normal = context.isPreview ? "" : sanitizeAboutText(rawAbout?.normal) || fallback.normal;
  let bold = context.isPreview ? "" : sanitizeAboutText(rawAbout?.bold) || fallback.bold;

  if (!aboutLooksValid(short)) short = fallback.short;
  if (!context.isPreview) {
    if (!aboutLooksValid(normal)) normal = fallback.normal;
    if (!aboutLooksValid(bold)) bold = fallback.bold;
  }

  return {
    short: clampText(short, 900),
    normal: context.isPreview ? "" : clampText(normal, 1500),
    bold: context.isPreview ? "" : clampText(bold, 1500),
  };
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

  return bestScore >= 0.7 ? best : "";
}

function fixesImprovementScore(before = "", after = "") {
  const beforeScore = scoreSentenceStrength(before, null);
  const afterScore = scoreSentenceStrength(after, null);
  let improvement = 0;

  if (countWords(after) > countWords(before)) improvement += 1;
  if (STRONG_ACTION_RE.test(after) && !STRONG_ACTION_RE.test(before)) improvement += 1;
  if (extractTermSignals(after).length > extractTermSignals(before).length) improvement += 1;
  if (jaccardSimilarity(before, after) < 0.82) improvement += 1;
  if (afterScore.strongScore > beforeScore.strongScore) improvement += 1;
  if (afterScore.weakScore < beforeScore.weakScore) improvement += 1;

  return improvement;
}

function fixLooksValid(item, context) {
  const before = String(item?.before || "").trim();
  const after = String(item?.after || "").trim();
  const why = String(item?.why || "").trim();
  if (!before || !after || !why) return false;
  if (canonicalizeTerm(before) === canonicalizeTerm(after)) return false;
  if (WEAK_REWRITE_START_RE.test(after)) return false;
  if (META_LANGUAGE_RE.test(after) || META_LANGUAGE_RE.test(why)) return false;
  if (FLUFF_RE.test(after) || FLUFF_RE.test(why)) return false;
  if (UNSUPPORTED_IMPACT_RE.test(after) && !UNSUPPORTED_IMPACT_RE.test(before)) return false;
  if (jaccardSimilarity(before, after) >= 0.88) return false;
  if (fixesImprovementScore(before, after) < 2) return false;

  const beforeFamilyHits = countTermHits(before, getAllFamilyTerms(context.roleProfile.roleFamily));
  const afterFamilyHits = countTermHits(after, getAllFamilyTerms(context.roleProfile.roleFamily));
  if (beforeFamilyHits > 0 && afterFamilyHits === 0) return false;

  const deny = TITLE_DENYLIST_BY_FAMILY[context.roleProfile.roleFamily] || [];
  if (deny.some((x) => containsCanonicalTermInNormalizedText(canonicalizeTerm(after), x))) return false;

  return true;
}

function normalizeExperienceFixes(rawFixes = [], context) {
  const sourceLines = uniqueByNormalizedStrings([...extractWeakCandidates(context.cv, context.roleProfile), ...getBulletLines(context.cv)]);
  const out = [];
  const seen = new Set();

  for (const item of Array.isArray(rawFixes) ? rawFixes : []) {
    const candidateBefore = clampText(item?.before, 320);
    const before = closestSourceLine(candidateBefore, sourceLines) || candidateBefore;
    const after = clampText(item?.after, 320);
    const why = clampText(item?.why, 160) || "Clearer wording and stronger recruiter readability.";
    const key = `${canonicalizeTerm(before)}__${canonicalizeTerm(after)}`;
    if (!before || !after || seen.has(key)) continue;
    const entry = { before, after, why };
    if (!fixLooksValid(entry, context)) continue;
    seen.add(key);
    out.push(entry);
  }

  const weakCandidates = extractWeakCandidates(context.cv, context.roleProfile);
  const desiredMin = context.isPreview ? 0 : Math.min(4, weakCandidates.length);

  if (out.length < desiredMin || (context.isPreview && out.length < 1 && weakCandidates.length > 0)) {
    for (const source of weakCandidates) {
      const after = buildRoleAnchoredRewrite(source, context.roleProfile);
      const entry = {
        before: source,
        after,
        why: "Clearer action, sharper scope, and more direct recruiter readability.",
      };
      const key = `${canonicalizeTerm(entry.before)}__${canonicalizeTerm(entry.after)}`;
      if (!entry.after || seen.has(key)) continue;
      if (!fixLooksValid(entry, context)) continue;
      seen.add(key);
      out.push(entry);
      if (out.length >= (context.isPreview ? 1 : 6)) break;
    }
  }

  return out.slice(0, context.isPreview ? 1 : 6);
}

function arrayFilterSupported(arr = [], context, options = {}) {
  const { max = 12, allowFamilyGeneric = true, includeTargetRole = false } = options;
  const allowedSet = getAllowedTermsSet({ cv: context.cv, jd: context.jd, roleProfile: context.roleProfile, meta: context.meta });
  const family = ROLE_FAMILIES[context.roleProfile.roleFamily] || ROLE_FAMILIES.generic;
  const extraFamilyTerms = allowFamilyGeneric
    ? uniqueTrimmedStrings([
        ...(family.linkedinKeywords || []),
        ...(family.recruiterTerms || []),
        ...(family.keywords || []),
        ...(family.strongTerms || []),
      ])
    : [];

  const pool = uniqueByNormalizedStrings([
    ...(Array.isArray(arr) ? arr : []).map(cleanListItem),
    ...(includeTargetRole && context.meta.target_role ? [context.meta.target_role] : []),
    ...context.roleProfile.familySignals,
    ...context.roleProfile.explicitTools,
    ...extraFamilyTerms,
  ]);

  const out = [];
  const seen = new Set();

  for (const term of pool) {
    const clean = cleanListItem(term);
    const norm = canonicalizeTerm(clean);
    if (!clean || !norm || seen.has(norm)) continue;
    if (META_LANGUAGE_RE.test(clean) || FLUFF_RE.test(clean) || UNSUPPORTED_IMPACT_RE.test(clean)) continue;
    if (context.roleProfile.roleFamily !== "generic") {
      const deny = TITLE_DENYLIST_BY_FAMILY[context.roleProfile.roleFamily] || [];
      if (deny.some((x) => containsCanonicalTermInNormalizedText(norm, x))) continue;
    }
    if (!isSupportedTerm(clean, allowedSet, context.roleProfile)) {
      if (isLikelyToolOrPlatform(clean) || looksLikeAcronym(clean)) continue;
      if (countTermHits(clean, getAllFamilyTerms(context.roleProfile.roleFamily)) <= 0) continue;
    }
    seen.add(norm);
    out.push(clean);
    if (out.length >= max) break;
  }

  return out;
}

function buildFallbackSkills(context) {
  const family = ROLE_FAMILIES[context.roleProfile.roleFamily] || ROLE_FAMILIES.generic;
  const top = arrayFilterSupported(
    [
      ...getSkillsLines(context.cv),
      ...context.roleProfile.familySignals,
      ...(family.linkedinKeywords || []),
      ...(family.keywords || []),
    ],
    context,
    { max: context.isPreview ? 8 : 16, includeTargetRole: false }
  );

  const tools = arrayFilterSupported(
    [
      ...context.roleProfile.explicitTools,
      ...(family.toolTerms || []),
    ],
    context,
    { max: context.isPreview ? 5 : 14, allowFamilyGeneric: false }
  );

  const industry = arrayFilterSupported(
    [
      ...context.roleProfile.familySignals,
      ...(family.linkedinKeywords || []),
      ...(family.recruiterTerms || []),
    ],
    context,
    { max: context.isPreview ? 5 : 16 }
  );

  return { top, tools, industry };
}

function normalizeSkills(rawSkills = {}, context) {
  const fallback = buildFallbackSkills(context);
  const top = arrayFilterSupported(rawSkills?.top || fallback.top, context, { max: context.isPreview ? 8 : 16 });
  const tools = arrayFilterSupported(rawSkills?.tools || fallback.tools, context, { max: context.isPreview ? 5 : 14, allowFamilyGeneric: false });
  const industry = arrayFilterSupported(rawSkills?.industry || fallback.industry, context, { max: context.isPreview ? 5 : 16 });
  return { top, tools, industry };
}

function buildFallbackRecruiterKeywords(context, skills) {
  const family = ROLE_FAMILIES[context.roleProfile.roleFamily] || ROLE_FAMILIES.generic;
  return arrayFilterSupported(
    [
      ...(family.recruiterTerms || []),
      ...(context.meta.target_role ? [context.meta.target_role] : []),
      ...(skills.top || []),
      ...(skills.industry || []),
    ],
    context,
    { max: context.isPreview ? 6 : 16, includeTargetRole: true }
  );
}

function buildBooleanString(context, skills) {
  const family = ROLE_FAMILIES[context.roleProfile.roleFamily] || ROLE_FAMILIES.generic;
  const titlePool = arrayFilterSupported(
    [
      ...(context.meta.target_role ? [context.meta.target_role] : []),
      ...(family.recruiterTerms || []),
      ...(family.titles || []),
      ...context.roleProfile.titleSignals,
    ],
    context,
    { max: 4, includeTargetRole: true }
  );

  const keywordPool = arrayFilterSupported(
    [
      ...(skills.top || []),
      ...(skills.industry || []),
      ...context.roleProfile.familySignals,
    ],
    context,
    { max: 5 }
  );

  const toolPool = arrayFilterSupported(skills.tools || [], context, { max: 4, allowFamilyGeneric: false });

  const q = (s) => (String(s).includes(" ") ? `"${s}"` : s);
  const parts = [];
  if (titlePool.length) parts.push(`(${titlePool.map(q).join(" OR ")})`);
  if (keywordPool.length) parts.push(`(${keywordPool.map(q).join(" OR ")})`);
  if (toolPool.length) parts.push(`(${toolPool.map(q).join(" OR ")})`);
  if (context.meta.location) parts.push(`("${context.meta.location}")`);
  return clampText(parts.join(" AND "), 360);
}

function normalizeRecruiter(rawRecruiter = {}, context, skills) {
  const keywords = arrayFilterSupported(rawRecruiter?.keywords || [], context, {
    max: context.isPreview ? 6 : 16,
    includeTargetRole: true,
  });
  const mergedKeywords = uniqueByNormalizedStrings([
    ...keywords,
    ...buildFallbackRecruiterKeywords(context, skills),
  ]).slice(0, context.isPreview ? 6 : 16);

  let booleanValue = clampText(rawRecruiter?.boolean, 360);
  if (
    !booleanValue ||
    booleanValue.length < 18 ||
    META_LANGUAGE_RE.test(booleanValue) ||
    FLUFF_RE.test(booleanValue) ||
    (TITLE_DENYLIST_BY_FAMILY[context.roleProfile.roleFamily] || []).some((x) => containsCanonicalTermInNormalizedText(canonicalizeTerm(booleanValue), x))
  ) {
    booleanValue = buildBooleanString(context, skills);
  }

  return {
    keywords: mergedKeywords,
    boolean: booleanValue,
  };
}

function normalizeLinkedInOutput(raw = {}, context) {
  const headlines = normalizeHeadlines(raw?.headlines, context);
  const about = normalizeAbout(raw?.about || {}, context);
  const experience_fix = normalizeExperienceFixes(raw?.experience_fix || [], context);
  const skills = normalizeSkills(raw?.skills || {}, context);
  const recruiter = normalizeRecruiter(raw?.recruiter || {}, context, skills);
  return { headlines, about, experience_fix, skills, recruiter };
}

function detectOutputIssues(output, context) {
  const issues = [];
  if (!Array.isArray(output.headlines) || !output.headlines.length) {
    issues.push("No usable headlines were generated.");
  } else if (!context.isPreview && output.headlines.length < 5) {
    issues.push("Fewer than 5 valid headlines were generated.");
  }

  if (!output.about?.short) issues.push("Short About section is missing.");
  if (!context.isPreview && (!output.about?.normal || !output.about?.bold)) {
    issues.push("Full About section set is incomplete.");
  }

  if (META_LANGUAGE_RE.test(JSON.stringify(output.about || {}))) {
    issues.push("About section still contains meta-writing language.");
  }

  const weakCandidates = extractWeakCandidates(context.cv, context.roleProfile);
  if (!context.isPreview && weakCandidates.length >= 4 && (!Array.isArray(output.experience_fix) || output.experience_fix.length < 3)) {
    issues.push("Experience fix kit is too thin for the number of weak bullets in the resume.");
  }

  if (!Array.isArray(output.skills?.top) || !output.skills.top.length) issues.push("Top skills are missing.");
  if (!Array.isArray(output.recruiter?.keywords) || !output.recruiter.keywords.length) issues.push("Recruiter keywords are missing.");
  if (!context.isPreview && (!output.recruiter?.boolean || output.recruiter.boolean.length < 20)) {
    issues.push("Recruiter boolean string is weak or missing.");
  }

  for (const headline of output.headlines || []) {
    if (!headlineLooksValid(headline.text, context)) {
      issues.push("At least one headline drifts outside the allowed role family.");
      break;
    }
  }

  return uniqueTrimmedStrings(issues).slice(0, 8);
}

function buildRepairPrompt({ currentOutput, issues, cv, jd, outLang, meta, roleProfile }) {
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
Repair the LinkedIn optimization output so it becomes cleaner, more role-accurate, more truthful, and more recruiter-usable.

ISSUES TO FIX:
${issues.map((issue, idx) => `${idx + 1}. ${issue}`).join("\n")}

RULES:
- Keep all output values in ${outLang}.
- Stay inside the hard role_family constraint.
- Remove any meta-writing language.
- Remove any role drift, unsupported tools, unsupported impact, or fake positioning.
- Keep headlines concise and family-aligned.
- Keep About sections natural and candidate-focused.
- Keep experience fixes materially stronger, but fully truthful.
- Keep recruiter keywords and boolean string tightly aligned to role_family and target_role.

TARGETING CONTEXT:
${buildRoleContextText({ cv, jd, meta, roleProfile })}

CURRENT OUTPUT TO REPAIR:
${JSON.stringify(currentOutput)}

RESUME:
${cv}

OPTIONAL JOB DESCRIPTION / TARGET ROLE CONTEXT:
${jd || meta?.target_role || "(none)"}
`.trim();
}

function buildFinalResponse(normalized, isPreview) {
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

    const rawMeta = linkedin_meta && typeof linkedin_meta === "object" ? linkedin_meta : {};
    const meta = {
      role_family: normalizeRoleFamily(rawMeta.role_family || ""),
      target_role: String(rawMeta.target_role || "").trim(),
      seniority: normalizeSeniority(rawMeta.seniority || "mid"),
      industry: String(rawMeta.industry || "").trim(),
      location: String(rawMeta.location || "").trim(),
      tone: normalizeTone(rawMeta.tone || "clean"),
    };

    const safeCv = String(cv || "");
    const safeJd = String(jd || "");
    const roleProfile = inferRoleProfile({
      cv: safeCv,
      jd: safeJd,
      targetRole: meta.target_role,
      roleFamily: meta.role_family,
    });

    const context = {
      cv: safeCv,
      jd: safeJd,
      isPreview,
      outLang,
      roleProfile,
      meta: {
        ...meta,
        role_family: roleProfile.roleFamily,
        seniority: meta.seniority || roleProfile.inferredSeniority || "mid",
      },
    };

    let raw;
    try {
      raw = await callOpenAIJson({
        apiKey,
        model,
        system: buildLinkedInSystem(outLang),
        userPrompt: isPreview
          ? buildPreviewPrompt({ cv: safeCv, jd: safeJd, outLang, meta: context.meta, roleProfile })
          : buildFullPrompt({ cv: safeCv, jd: safeJd, outLang, meta: context.meta, roleProfile }),
        isPreview,
        passType: "main",
        maxCompletionTokens: isPreview ? 1300 : 2600,
      });
    } catch (err) {
      return res.status(err?.status || 500).json({
        error: err?.message || "OpenAI error",
        status: err?.status || 500,
        details: err?.details || String(err),
      });
    }

    let normalized = normalizeLinkedInOutput(raw, context);
    const issues = detectOutputIssues(normalized, context);

    if (issues.length) {
      try {
        const repaired = await callOpenAIJson({
          apiKey,
          model,
          system: buildLinkedInSystem(outLang),
          userPrompt: buildRepairPrompt({
            currentOutput: normalized,
            issues,
            cv: safeCv,
            jd: safeJd,
            outLang,
            meta: context.meta,
            roleProfile,
          }),
          isPreview,
          passType: "repair",
          maxCompletionTokens: isPreview ? 1600 : 3000,
        });

        normalized = normalizeLinkedInOutput(repaired, context);
      } catch {
        // Keep initial normalized output if repair fails.
      }
    }

    if (isPreview) {
      await ensureMinDelay(startedAt, 15000);
    }

    return res.status(200).json(buildFinalResponse(normalized, isPreview));
  } catch (err) {
    return res.status(500).json({
      error: "Server error",
      details: err?.message || String(err),
    });
  }
}
