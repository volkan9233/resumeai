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

const PREVIEW_MODEL =
  process.env.OPENAI_MODEL_PREVIEW || process.env.OPENAI_MODEL || "gpt-5-mini";
const FULL_MODEL =
  process.env.OPENAI_MODEL_FULL || process.env.OPENAI_MODEL || "gpt-5.1";

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

const HEADER_SECTION_RE =
  /^(PROFESSIONAL SUMMARY|SUMMARY|PROFILE|CORE SUMMARY|EXPERIENCE|WORK EXPERIENCE|PROFESSIONAL EXPERIENCE|SKILLS|CORE SKILLS|TECHNICAL SKILLS|COMPETENCIES|EDUCATION|LANGUAGES|CERTIFICATIONS|LICENSES|PROJECTS|ADDITIONAL INFORMATION|AWARDS|ACHIEVEMENTS|PROFESYONEL ÖZET|ÖZET|PROFİL|DENEYİM|İŞ DENEYİMİ|YETKİNLİKLER|YETENEKLER|BECERİLER|EĞİTİM|DİLLER|BİLDİĞİ DİLLER|SERTİFİKALAR|PROJELER|EK BİLGİLER)$/i;

const BULLET_RE = /^[-•·‣▪▫◦*]\s+/;
const DATE_SPAN_RE =
  /(?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Sept|Oct|Nov|Dec|Ocak|Şubat|Subat|Mart|Nisan|Mayıs|Mayis|Haziran|Temmuz|Ağustos|Agustos|Eylül|Eylul|Ekim|Kasım|Kasim|Aralık|Aralik|\d{1,2}\/\d{4}|\d{4})[\s–—-]+(?:Present|Current|Günümüz|Devam|Now|Şimdi|[\d]{4})/i;

const GENERIC_SUMMARY_RE =
  /^(experienced|results[- ]driven|motivated|detail[- ]oriented|hardworking|dedicated|dynamic|versatile|organized|responsible|experienced professional|deneyimli|sonuç odaklı|motivasyonu yüksek|detay odaklı|çalışkan|disiplinli|öğrenmeye açık|sorumluluk sahibi)\b/i;

const WEAK_VERB_RE =
  /\b(helped|helps|assisted|assists|supported|supports|worked on|responsible for|contributed to|participated in|involved in|handled|tasked with|duties included|provided support|provided assistance|helped with|assisted with|supported with|yardımcı oldum|destek oldum|destek verdim|görev aldım|ilgilen(dim|di)|çalıştım|yaptım|sorumluydum|takip ettim|katıldım|katkı sağladım)\b/i;

const WEAK_START_RE =
  /^(helped|helps|assisted|assists|supported|supports|worked on|responsible for|contributed to|participated in|involved in|handled|tasked with|duties included|provided support|provided assistance|helped with|assisted with|supported with|yardımcı oldum|destek oldum|destek verdim|görev aldım|ilgilen(dim|di)|çalıştım|yaptım|sorumluydum)\b/i;

const STRONG_ACTION_RE =
  /\b(built|developed|designed|implemented|integrated|tested|debugged|optimized|deployed|maintained|automated|configured|analyzed|reported|tracked|prepared|reviewed|reconciled|processed|scheduled|coordinated|organized|documented|validated|monitored|delivered|created|managed|planned|mapped|executed|screened|taught|assessed|inspected|responded|resolved|guided|engineered|modeled|supported training|facilitated|verified|assembled|picked|packed|labeled|received|counted|staged|shipped|yönettim|koordine ettim|hazırladım|analiz ettim|raporladım|geliştirdim|oluşturdum|uyguladım|organize ettim|izledim|optimize ettim|tasarladım|planladım|sundum|denetledim|doğruladım|uzlaştırdım|işledim|değerlendirdim)\b/i;

const SOFT_ACTION_START_RE =
  /^(prepared|maintained|coordinated|tracked|updated|processed|documented|communicated|organized|reviewed|monitored|followed up on|responded to|scheduled|compiled|recorded|handled|checked|supported training|verified|maintained records for)\b/i;

const GENERIC_TASK_RE =
  /\b(daily tasks?|routine tasks?|general support|various tasks?|team support|support activities|campaign tasks?|backend improvements?|customer requests?|internal service updates?|documentation tasks?|administrative tasks?|follow-?up tasks?|service tasks?|general coordination|basic reporting|report preparation|operations tasks?|record keeping|data entry|office tasks?|ad hoc tasks?|other duties as assigned|general assistance)\b/i;

const SCOPE_CONTEXT_RE =
  /\b(using|with|for|across|through|via|by|on|under|according to|per|regarding|including|covering|handling|tracking|supporting|kullanarak|ile|için|kapsamında|üzerinde|aracılığıyla|konusunda)\b/i;

const ENGLISH_FLUFF_RE =
  /\b(dynamic|robust|seamless|impactful|high-impact|comprehensive|various|overall|best-in-class|value-driven|strategic initiatives|operational excellence|fast-paced environment|cross-functional excellence|best practice)\b/i;

const ENGLISH_RISKY_OUTCOME_RE =
  /\b(resulting in|driving|boosting|enhancing|improving|increasing|streamlining|maximizing|delivering|leading to|contributed to improvements in|generated|grew|reduced)\b/i;

const WEAK_REWRITE_RESIDUAL_RE =
  /\b(helped|helps|assisted|assists|supported|supports|contributed to|participated in|involved in|worked on|responsible for|provided support|provided assistance|helped with|assisted with|supported with|destek oldum|destek verdim|yardımcı oldum|görev aldım|katkı sağladım|katıldım|çalıştım|yaptım|sorumluydum)\b/i;

const LOW_VALUE_KEYWORD_RE =
  /\b(communication|teamwork|hardworking|motivated|detail[- ]oriented|problem solving|leadership|microsoft office|ms office|computer skills|organizasyon|iletişim|takım çalışması|motivasyon|çözüm odaklı|detay odaklı|uyumlu|çalışkan|analysis|support|management|beceri|yetenek|deneyim|responsible|experienced)\b/i;

const JD_CUE_RE =
  /\b(requirements|required|must have|nice to have|preferred|responsibilities|qualification|qualifications|experience with|knowledge of|proficient in|aranan nitelikler|gerekli|tercihen|yetkinlikler|sorumluluklar|beklentiler)\b/i;

const ACRONYM_RE = /\b[A-Z]{2,}(?:\/[A-Z]{2,})?\b/;
const CERTIFICATION_RE =
  /\b(pmp|csm|psm|scrum master|cpa|cfa|acca|ifrs|gaap|lean six sigma|six sigma|itil|hipaa|aws certified|azure fundamentals|google ads certification)\b/i;

const IMPACT_NUMBER_RE =
  /\b\d+(?:[.,]\d+)?(?:%|k|m|b|x)?\b/i;

const CADENCE_TERMS = uniqueTrimmedStrings([
  "daily",
  "weekly",
  "monthly",
  "quarterly",
  "annual",
  "yearly",
  "günlük",
  "haftalık",
  "aylık",
  "çeyreklik",
  "yıllık",
]);

const STAKEHOLDER_TERMS = uniqueTrimmedStrings([
  "customers",
  "customer",
  "clients",
  "client",
  "patients",
  "patient",
  "students",
  "student",
  "parents",
  "parent",
  "vendors",
  "vendor",
  "suppliers",
  "supplier",
  "management",
  "leadership",
  "executives",
  "executive",
  "stakeholders",
  "stakeholder",
  "internal teams",
  "cross-functional teams",
  "sales team",
  "marketing team",
  "operations team",
  "finance team",
  "hr team",
]);

const WORKFLOW_TERMS = uniqueTrimmedStrings([
  "reports",
  "reporting",
  "dashboard",
  "dashboards",
  "ticket",
  "tickets",
  "cases",
  "case",
  "orders",
  "order",
  "shipments",
  "shipment",
  "inventory",
  "stock",
  "records",
  "documentation",
  "calendar",
  "meetings",
  "meeting",
  "travel",
  "invoices",
  "invoice",
  "payments",
  "accounts",
  "campaigns",
  "ads",
  "api",
  "apis",
  "database",
  "deployments",
  "tests",
  "test cases",
  "lesson plans",
  "classroom",
  "appointments",
  "medical records",
  "patient records",
  "contracts",
  "case files",
]);

const ROLE_TAXONOMY = {
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
      "site reliability engineer",
      "systems engineer",
    ],
    signals: [
      "software development",
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
      "rest api",
      "ci/cd",
      "unit testing",
      "integration testing",
      "performance optimization",
      "docker",
      "kubernetes",
      "aws",
      "azure",
      "gcp",
      "react",
      "node.js",
      "javascript",
      "typescript",
      "python",
      "java",
      "c#",
      "sql",
    ],
    keywords: [
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
    verbs: [
      "built",
      "developed",
      "implemented",
      "integrated",
      "tested",
      "debugged",
      "deployed",
      "optimized",
      "maintained",
    ],
    safeSupportVerbs: [
      "maintained",
      "tested",
      "documented",
      "collaborated with",
      "integrated with",
    ],
  },
  qa: {
    titles: [
      "qa engineer",
      "quality assurance engineer",
      "software tester",
      "test engineer",
      "qa analyst",
      "automation tester",
      "manual tester",
    ],
    signals: [
      "quality assurance",
      "test cases",
      "test scenarios",
      "regression testing",
      "smoke testing",
      "uat",
      "selenium",
      "cypress",
      "postman",
      "jira",
      "bug tracking",
      "defect management",
      "test automation",
    ],
    keywords: [
      "test cases",
      "regression testing",
      "defect tracking",
      "test documentation",
      "UAT",
      "API testing",
      "automation testing",
      "quality validation",
    ],
    verbs: [
      "tested",
      "validated",
      "documented",
      "reported",
      "tracked",
      "verified",
      "executed",
      "automated",
    ],
    safeSupportVerbs: ["documented", "tracked", "verified", "executed"],
  },
  data_analytics: {
    titles: [
      "data analyst",
      "business intelligence analyst",
      "bi analyst",
      "analytics specialist",
      "reporting analyst",
      "data specialist",
    ],
    signals: [
      "data analysis",
      "analytics",
      "dashboard",
      "reporting",
      "kpi",
      "trend analysis",
      "data validation",
      "power bi",
      "tableau",
      "looker studio",
      "sql",
      "excel",
      "report automation",
      "data visualization",
      "business intelligence",
    ],
    keywords: [
      "SQL",
      "data visualization",
      "dashboard reporting",
      "trend analysis",
      "KPI tracking",
      "data validation",
      "Power BI",
      "Tableau",
      "dashboard maintenance",
      "data reporting",
    ],
    conservativeKeywords: [
      "dashboard reporting",
      "KPI tracking",
      "data validation",
      "trend analysis",
      "data visualization",
      "Excel reporting",
      "reporting accuracy",
    ],
    advancedKeywords: ["ETL", "data modeling", "SQL joins", "report automation"],
    verbs: [
      "analyzed",
      "reported",
      "tracked",
      "validated",
      "prepared",
      "reviewed",
      "modeled",
    ],
    safeSupportVerbs: ["reported", "tracked", "validated", "prepared", "maintained"],
  },
  product_project: {
    titles: [
      "product manager",
      "product owner",
      "associate product manager",
      "technical product manager",
      "project manager",
      "project coordinator",
      "program manager",
    ],
    signals: [
      "roadmap",
      "backlog",
      "user stories",
      "requirements gathering",
      "acceptance criteria",
      "stakeholder communication",
      "release planning",
      "jira",
      "confluence",
      "agile",
      "scrum",
      "timeline",
      "deliverables",
      "milestones",
      "risk tracking",
    ],
    keywords: [
      "product roadmap",
      "backlog prioritization",
      "requirements gathering",
      "user stories",
      "acceptance criteria",
      "release planning",
      "stakeholder communication",
      "timeline management",
      "deliverable coordination",
      "risk tracking",
    ],
    verbs: [
      "defined",
      "prioritized",
      "coordinated",
      "planned",
      "aligned",
      "tracked",
      "facilitated",
      "documented",
    ],
    safeSupportVerbs: ["coordinated", "tracked", "scheduled", "documented", "aligned with"],
  },
  sales: {
    titles: [
      "sales specialist",
      "sales executive",
      "account executive",
      "sales coordinator",
      "business development executive",
      "account manager",
    ],
    signals: [
      "sales",
      "pipeline",
      "crm",
      "lead follow-up",
      "proposal",
      "deal tracking",
      "sales reporting",
      "salesforce",
      "hubspot",
      "client communication",
      "order processing",
      "upsell",
      "cross-sell",
      "renewal",
      "retention",
    ],
    keywords: [
      "sales pipeline",
      "lead management",
      "CRM",
      "proposal preparation",
      "deal tracking",
      "account coordination",
      "client follow-up",
      "Salesforce",
      "HubSpot",
    ],
    verbs: [
      "managed",
      "followed up",
      "coordinated",
      "prepared",
      "updated",
      "processed",
      "documented",
    ],
    safeSupportVerbs: ["followed up on", "coordinated", "prepared", "updated", "processed"],
  },
  marketing: {
    titles: [
      "digital marketing specialist",
      "marketing specialist",
      "performance marketing specialist",
      "marketing executive",
      "growth marketer",
      "content specialist",
    ],
    signals: [
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
      "a/b test",
      "remarketing",
      "retargeting",
    ],
    keywords: [
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
    verbs: [
      "managed",
      "optimized",
      "analyzed",
      "tracked",
      "reported",
      "executed",
      "launched",
      "monitored",
    ],
    safeSupportVerbs: ["coordinated", "prepared", "tracked", "updated", "monitored"],
  },
  finance_accounting: {
    titles: [
      "accountant",
      "financial analyst",
      "finance specialist",
      "accounts payable specialist",
      "accounts receivable specialist",
      "bookkeeper",
      "finance assistant",
    ],
    signals: [
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
      "sap",
      "oracle",
      "erp",
      "ifrs",
      "gaap",
    ],
    keywords: [
      "financial reporting",
      "account reconciliation",
      "budget tracking",
      "variance analysis",
      "forecasting",
      "month-end close",
      "AP/AR",
      "audit support",
      "ERP systems",
      "GAAP",
      "IFRS",
    ],
    verbs: [
      "prepared",
      "reconciled",
      "processed",
      "reviewed",
      "tracked",
      "reported",
      "maintained",
    ],
    safeSupportVerbs: ["prepared", "reconciled", "processed", "reviewed", "tracked"],
  },
  hr_recruiting: {
    titles: [
      "hr specialist",
      "human resources specialist",
      "recruiter",
      "talent acquisition specialist",
      "hr coordinator",
      "people operations specialist",
    ],
    signals: [
      "recruiting",
      "candidate screening",
      "interview scheduling",
      "employee records",
      "onboarding",
      "offboarding",
      "training coordination",
      "hr administration",
      "compliance",
      "payroll support",
      "workday",
      "greenhouse",
      "ats",
      "hris",
    ],
    keywords: [
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
    verbs: [
      "screened",
      "scheduled",
      "coordinated",
      "maintained",
      "prepared",
      "documented",
      "updated",
    ],
    safeSupportVerbs: ["scheduled", "coordinated", "maintained", "documented", "updated"],
  },
  operations: {
    titles: [
      "operations manager",
      "operations specialist",
      "operations coordinator",
      "operations analyst",
      "office manager",
    ],
    signals: [
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
      "status reporting",
    ],
    keywords: [
      "process improvement",
      "workflow coordination",
      "vendor communication",
      "cross-functional collaboration",
      "status reporting",
      "documentation",
      "task prioritization",
      "operational tracking",
    ],
    verbs: [
      "coordinated",
      "tracked",
      "organized",
      "maintained",
      "documented",
      "scheduled",
      "reported",
      "monitored",
    ],
    safeSupportVerbs: ["coordinated", "tracked", "organized", "maintained", "documented"],
  },
  warehouse_operations: {
    titles: [
      "warehouse assistant",
      "warehouse worker",
      "warehouse operative",
      "storekeeper",
      "picker packer",
      "inventory clerk",
      "warehouse staff",
    ],
    signals: [
      "warehouse operations",
      "stock control",
      "stock counting",
      "inventory control",
      "inventory records",
      "order preparation",
      "picking",
      "packing",
      "labeling",
      "shipment",
      "dispatch",
      "receiving",
      "putaway",
      "goods handling",
      "warehouse safety",
    ],
    keywords: [
      "inventory control",
      "stock counting",
      "order preparation",
      "picking and packing",
      "packing and labeling",
      "shipment handling",
      "dispatch preparation",
      "receiving",
      "putaway",
      "inventory records",
      "goods handling",
      "warehouse safety",
    ],
    verbs: [
      "prepared",
      "picked",
      "packed",
      "labeled",
      "received",
      "inspected",
      "updated",
      "maintained",
      "organized",
      "counted",
      "staged",
    ],
    safeSupportVerbs: [
      "prepared",
      "packed",
      "labeled",
      "received",
      "inspected",
      "updated",
      "maintained",
      "organized",
      "counted",
      "staged",
    ],
    blockedWithoutEvidence: [
      "RFQ",
      "sourcing",
      "vendor management",
      "supplier communication",
      "procurement",
      "purchase orders",
      "purchase orders (PO) processing",
      "ERP systems",
      "goods receipt",
      "goods receipt (GR) documentation",
    ],
  },
  procurement_supply_chain: {
    titles: [
      "procurement specialist",
      "purchasing specialist",
      "buyer",
      "sourcing specialist",
      "logistics specialist",
      "logistics coordinator",
      "inventory specialist",
      "warehouse coordinator",
    ],
    signals: [
      "procurement",
      "purchasing",
      "sourcing",
      "vendor management",
      "purchase orders",
      "rfq",
      "supplier communication",
      "cost comparison",
      "inventory management",
      "shipment tracking",
      "warehouse operations",
      "logistics coordination",
      "stock control",
      "order fulfillment",
      "sap",
      "erp",
    ],
    keywords: [
      "vendor management",
      "sourcing",
      "purchase orders",
      "supplier communication",
      "RFQ",
      "inventory management",
      "shipment tracking",
      "warehouse operations",
      "ERP systems",
      "order fulfillment",
    ],
    verbs: [
      "sourced",
      "processed",
      "coordinated",
      "reviewed",
      "tracked",
      "documented",
      "communicated",
    ],
    safeSupportVerbs: ["processed", "coordinated", "reviewed", "tracked", "documented"],
  },
  customer_support: {
    titles: [
      "customer support specialist",
      "customer service representative",
      "support specialist",
      "technical support specialist",
      "help desk specialist",
      "customer success specialist",
      "customer success manager",
    ],
    signals: [
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
      "onboarding",
      "renewal",
      "retention",
      "csat",
      "nps",
      "qbr",
    ],
    keywords: [
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
      "customer onboarding",
    ],
    conservativeKeywords: [
      "ticket management",
      "issue resolution",
      "service quality",
      "support documentation",
      "customer communication",
      "case follow-up",
    ],
    advancedKeywords: ["SLA", "CRM segmentation", "renewal", "retention", "QBR", "upsell"],
    verbs: [
      "responded",
      "resolved",
      "escalated",
      "documented",
      "maintained",
      "communicated",
      "processed",
      "tracked",
      "guided",
    ],
    safeSupportVerbs: [
      "responded to",
      "followed up on",
      "documented",
      "maintained",
      "updated",
      "communicated with",
    ],
  },
  administration: {
    titles: [
      "executive assistant",
      "personal assistant",
      "administrative assistant",
      "office assistant",
      "admin assistant",
      "executive coordinator",
    ],
    signals: [
      "calendar management",
      "travel coordination",
      "meeting coordination",
      "document preparation",
      "executive support",
      "scheduling",
      "record keeping",
      "office administration",
      "filing",
      "data entry",
    ],
    keywords: [
      "calendar management",
      "meeting coordination",
      "travel coordination",
      "document management",
      "record maintenance",
      "executive support",
      "office administration",
      "task prioritization",
      "time management",
    ],
    verbs: [
      "managed",
      "organized",
      "scheduled",
      "prepared",
      "maintained",
      "coordinated",
      "documented",
    ],
    safeSupportVerbs: ["organized", "scheduled", "prepared", "maintained", "coordinated"],
  },
  education: {
    titles: [
      "teacher",
      "instructor",
      "lecturer",
      "teaching assistant",
      "english teacher",
      "math teacher",
    ],
    signals: [
      "lesson planning",
      "classroom management",
      "student assessment",
      "curriculum",
      "instruction",
      "student support",
      "learning materials",
      "student progress",
      "parent communication",
    ],
    keywords: [
      "lesson planning",
      "classroom management",
      "student assessment",
      "curriculum development",
      "learning materials",
      "student progress tracking",
      "instruction",
    ],
    verbs: [
      "planned",
      "delivered",
      "prepared",
      "assessed",
      "tracked",
      "organized",
      "taught",
      "guided",
    ],
    safeSupportVerbs: ["prepared", "tracked", "organized", "communicated with"],
  },
  healthcare_administration: {
    titles: [
      "healthcare administrator",
      "medical secretary",
      "medical office assistant",
      "patient coordinator",
      "clinic coordinator",
    ],
    signals: [
      "patient scheduling",
      "medical records",
      "insurance verification",
      "ehr",
      "emr",
      "clinic operations",
      "appointment coordination",
      "hipaa",
      "patient communication",
      "patient intake",
    ],
    keywords: [
      "patient scheduling",
      "medical records",
      "insurance verification",
      "EHR/EMR",
      "appointment coordination",
      "HIPAA",
      "patient communication",
      "clinic administration",
    ],
    conservativeKeywords: [
      "patient scheduling",
      "medical records",
      "appointment coordination",
      "patient communication",
      "clinic administration",
    ],
    advancedKeywords: ["HIPAA", "EHR", "EMR", "insurance verification", "patient intake"],
    verbs: [
      "scheduled",
      "coordinated",
      "updated",
      "maintained",
      "verified",
      "documented",
      "communicated",
    ],
    safeSupportVerbs: ["scheduled", "updated", "maintained", "verified", "documented"],
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
    signals: [
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
      "visual design",
      "brand assets",
      "canva",
      "print design",
      "social media design",
    ],
    keywords: [
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
      "brand assets",
    ],
    conservativeKeywords: [
      "visual design",
      "brand assets",
      "Adobe Creative Suite",
      "print design",
      "social media design",
    ],
    advancedKeywords: [
      "UI design",
      "UX design",
      "wireframing",
      "prototyping",
      "user flows",
      "design systems",
      "mockups",
    ],
    verbs: ["designed", "created", "developed", "prepared", "produced", "refined", "updated"],
    safeSupportVerbs: ["prepared", "produced", "updated", "collaborated with"],
  },
  engineering_construction: {
    titles: [
      "civil engineer",
      "site engineer",
      "construction engineer",
      "mechanical engineer",
      "design engineer",
      "maintenance engineer",
      "production engineer",
      "industrial engineer",
    ],
    signals: [
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
      "equipment maintenance",
      "preventive maintenance",
      "root cause analysis",
      "production support",
      "quality checks",
    ],
    keywords: [
      "AutoCAD",
      "Revit",
      "Primavera P6",
      "site supervision",
      "quantity takeoff",
      "BOQ",
      "technical documentation",
      "SolidWorks",
      "preventive maintenance",
      "equipment inspection",
      "quality checks",
    ],
    verbs: [
      "reviewed",
      "prepared",
      "coordinated",
      "tracked",
      "inspected",
      "documented",
      "designed",
      "verified",
    ],
    safeSupportVerbs: ["reviewed", "prepared", "coordinated", "tracked", "documented"],
  },
  legal_support: {
    titles: ["legal assistant", "paralegal", "legal secretary", "compliance assistant"],
    signals: [
      "legal documentation",
      "contract review",
      "case files",
      "compliance",
      "regulatory",
      "document management",
      "filing",
      "research",
      "case support",
    ],
    keywords: [
      "legal documentation",
      "contract support",
      "case file management",
      "compliance documentation",
      "regulatory support",
      "document review",
    ],
    verbs: ["prepared", "reviewed", "organized", "maintained", "documented", "coordinated"],
    safeSupportVerbs: ["prepared", "reviewed", "organized", "maintained", "documented"],
  },
  generic: {
    titles: [],
    signals: [
      "documentation",
      "reporting",
      "coordination",
      "analysis",
      "communication",
      "scheduling",
      "tracking",
      "records",
      "support",
    ],
    keywords: [
      "documentation",
      "cross-functional collaboration",
      "process tracking",
      "stakeholder communication",
      "task coordination",
      "time management",
      "reporting",
      "record maintenance",
    ],
    verbs: ["coordinated", "prepared", "tracked", "maintained", "documented", "updated", "organized"],
    safeSupportVerbs: ["coordinated", "prepared", "tracked", "maintained", "documented"],
  },
};

const ROLE_OVERRIDE_MAP = {
  "warehouse assistant": ["warehouse_operations"],
  "warehouse worker": ["warehouse_operations"],
  "warehouse operative": ["warehouse_operations"],
  "storekeeper": ["warehouse_operations"],
  "picker packer": ["warehouse_operations"],
  "inventory clerk": ["warehouse_operations"],
  "warehouse operations": ["warehouse_operations"],

  "procurement specialist": ["procurement_supply_chain"],
  "purchasing specialist": ["procurement_supply_chain"],
  "logistics coordinator": ["procurement_supply_chain"],

  "customer support specialist": ["customer_support"],
  "customer service representative": ["customer_support"],
  "customer support": ["customer_support"],
  "customer service": ["customer_support"],

  "backend engineer": ["software_engineering"],
  "backend developer": ["software_engineering"],
  "software engineer": ["software_engineering"],
  "software developer": ["software_engineering"],

  "data analyst": ["data_analytics"],
  "business intelligence analyst": ["data_analytics"],

  "graphic designer": ["design"],
  "visual designer": ["design"],
  "product designer": ["design"],
  "ui designer": ["design"],
  "ux designer": ["design"],

  "healthcare administrator": ["healthcare_administration"],
  "patient coordinator": ["healthcare_administration"],
  "medical secretary": ["healthcare_administration"],

  "executive assistant": ["administration"],
  "administrative assistant": ["administration"],

  "project manager": ["product_project"],
  "product manager": ["product_project"],
};

const HARD_FACT_TERMS = uniqueTrimmedStrings([
  "google ads",
  "meta ads",
  "google analytics",
  "ga4",
  "google tag manager",
  "seo",
  "sem",
  "ppc",
  "hubspot",
  "salesforce",
  "crm",
  "zendesk",
  "freshdesk",
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
  "c#",
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
  "canva",
  "autocad",
  "solidworks",
  "revit",
  "primavera p6",
  "sap",
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
  "boq",
  "rfq",
  "purchase orders",
  "goods receipt",
  "insurance verification",
  "patient intake",
  "wireframing",
  "prototyping",
  "design systems",
  "user flows",
  "mockups",
  "ui design",
  "ux design",
]);

const BRAND_TERMS = new Set(
  [
    "google ads",
    "meta ads",
    "google analytics",
    "ga4",
    "google tag manager",
    "hubspot",
    "salesforce",
    "zendesk",
    "freshdesk",
    "jira",
    "confluence",
    "tableau",
    "power bi",
    "looker studio",
    "react",
    "node.js",
    "aws",
    "azure",
    "gcp",
    "docker",
    "kubernetes",
    "selenium",
    "cypress",
    "postman",
    "figma",
    "adobe creative suite",
    "photoshop",
    "illustrator",
    "canva",
    "autocad",
    "solidworks",
    "revit",
    "primavera p6",
    "sap",
    "oracle",
    "quickbooks",
    "netsuite",
    "workday",
    "greenhouse",
  ].map(canonicalizeTerm)
);

const ALL_ROLE_TERMS = uniqueTrimmedStrings(
  Object.values(ROLE_TAXONOMY).flatMap((role) => [
    ...(role.titles || []),
    ...(role.signals || []),
    ...(role.keywords || []),
    ...(role.conservativeKeywords || []),
    ...(role.advancedKeywords || []),
  ])
);

const ROLE_ADJACENCY_BLOCKS = {
  warehouse_operations: [
    "rfq",
    "sourcing",
    "vendor management",
    "supplier communication",
    "procurement",
    "purchase orders",
    "goods receipt",
    "erp",
  ],
  customer_support: [
    "sales pipeline",
    "proposal preparation",
    "account executive",
    "qbr",
    "renewal",
    "retention",
    "crm segmentation",
    "upsell",
    "cross-sell",
  ],
  design_graphic_focus: [
    "ui design",
    "ux design",
    "wireframing",
    "prototyping",
    "user flows",
    "mockups",
    "design systems",
  ],
  healthcare_administration: [
    "hipaa",
    "ehr",
    "emr",
    "insurance verification",
    "patient intake",
    "clinic procedures",
  ],
  administration: [
    "product roadmap",
    "program management",
    "project charter",
    "backlog prioritization",
    "stakeholder mapping",
    "release planning",
  ],
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
  return String(str).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function normalizeSpace(str = "") {
  return String(str || "")
    .replace(/\r/g, "")
    .replace(/\u00A0/g, " ")
    .replace(/[^\S\n]+/g, " ")
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
    [
      /continuous integration continuous deployment|continuous integration continuous delivery|ci cd/g,
      "ci/cd",
    ],
    [/restful api|rest apis/g, "rest api"],
    [/customer service/g, "customer support"],
    [/talent acquisition/g, "recruiting"],
    [/electronic health record/g, "ehr"],
    [/electronic medical record/g, "emr"],
    [/c sharp/g, "c#"],
    [/human resources/g, "hr"],
    [/search engine optimization/g, "seo"],
    [/search engine marketing/g, "sem"],
    [/pay per click/g, "ppc"],
    [/application programming interface/g, "api"],
  ];

  for (const [re, to] of replacements) s = s.replace(re, to);
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
  if (hay === needle) return true;
  if (needle.includes(" ")) return hay.includes(needle);
  return new RegExp(`(?:^|\\s)${escapeRegex(needle)}(?:$|\\s)`, "i").test(hay);
}

function countTermHits(text = "", terms = []) {
  const hay = canonicalizeTerm(text);
  return uniqueTrimmedStrings(terms).reduce(
    (sum, term) => sum + (containsCanonicalTermInText(hay, term) ? 1 : 0),
    0
  );
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

  const matches = hay.match(
    new RegExp(`(?:^|\\s)${escapeRegex(needle)}(?:$|\\s)`, "gi")
  );
  return Array.isArray(matches) ? matches.length : 0;
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
  for (const token of aSet) if (bSet.has(token)) intersection += 1;
  const union = new Set([...aSet, ...bSet]).size;
  return union ? intersection / union : 0;
}

function countWords(str = "") {
  return String(str || "").trim().split(/\s+/).filter(Boolean).length;
}

function clampScore(n) {
  const x = Number(n);
  if (!Number.isFinite(x)) return 0;
  return Math.max(0, Math.min(100, Math.round(x)));
}

function capitalizeFirst(str = "") {
  const s = String(str || "").trim();
  return s ? s.charAt(0).toUpperCase() + s.slice(1) : s;
}

function lowerFirst(str = "") {
  const s = String(str || "").trim();
  return s ? s.charAt(0).toLowerCase() + s.slice(1) : s;
}

function cleanKeywordCandidate(term = "") {
  return String(term || "")
    .replace(/\r/g, " ")
    .replace(/^[-•·‣▪▫◦*0-9.)\s]+/, "")
    .replace(/\s+/g, " ")
    .replace(/^[,;:]+|[,;:]+$/g, "")
    .trim();
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

function isSectionHeader(line = "") {
  return HEADER_SECTION_RE.test(String(line || "").trim());
}

function isSkillsSectionHeader(line = "") {
  return /(SKILLS|CORE SKILLS|TECHNICAL SKILLS|COMPETENCIES|YETKİNLİKLER|YETENEKLER|BECERİLER)/i.test(
    String(line || "").trim()
  );
}

function isShortSkillLabel(line = "") {
  const s = String(line || "").trim();
  if (!s) return false;
  const wc = countWords(s);
  if (wc < 1 || wc > 6) return false;
  if (/[.?!]$/.test(s)) return false;
  if (/\b\d+(?:[.,]\d+)?%?\b/.test(s)) return false;
  if (WEAK_VERB_RE.test(s) || STRONG_ACTION_RE.test(s)) return false;
  if (SCOPE_CONTEXT_RE.test(s)) return false;
  return true;
}

function getSkillsLines(cv = "") {
  const lines = getNonEmptyLines(cv);
  const out = [];
  let inSkills = false;

  for (const line of lines) {
    if (isSkillsSectionHeader(line)) {
      inSkills = true;
      continue;
    }
    if (inSkills && isSectionHeader(line)) break;
    if (inSkills) out.push(line.replace(BULLET_RE, "").trim());
  }

  return out.filter(Boolean);
}

function isLikelySkillLabel(sentence = "", cv = "") {
  const s = String(sentence || "").trim();
  if (!s) return false;

  const skillLines = getSkillsLines(cv);
  if (skillLines.some((x) => canonicalizeTerm(x) === canonicalizeTerm(s))) return true;
  if (isShortSkillLabel(s)) return true;

  const norm = canonicalizeTerm(s);
  if (norm.includes(",") && countWords(s) <= 8 && !/[.?!]$/.test(s)) return true;

  return false;
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
      if (/^(EXPERIENCE|WORK EXPERIENCE|PROFESSIONAL EXPERIENCE|DENEYİM|İŞ DENEYİMİ)$/i.test(line)) {
        section = "experience";
      } else if (/^(PROFESSIONAL SUMMARY|SUMMARY|PROFILE|PROFESYONEL ÖZET|ÖZET|PROFİL)$/i.test(line)) {
        section = "summary";
      } else if (isSkillsSectionHeader(line)) {
        section = "skills";
      } else {
        section = "other";
      }
      continue;
    }

    if (!BULLET_RE.test(line)) continue;
    const bullet = line.replace(BULLET_RE, "").trim();
    if (!bullet || section === "skills") continue;
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
    if (DATE_SPAN_RE.test(line)) {
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
    if (DATE_SPAN_RE.test(line)) {
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

function isLowValueKeyword(term = "") {
  const cleaned = cleanKeywordCandidate(term);
  if (!cleaned) return true;

  const norm = canonicalizeTerm(cleaned);
  const wc = countWords(cleaned);

  if (wc === 1 && norm.length < 4 && !looksLikeAcronym(cleaned)) return true;
  if (LOW_VALUE_KEYWORD_RE.test(cleaned) && wc <= 3) return true;

  if (
    /^(experience|knowledge|skills|skill|management|analysis|support|reporting|communication|documentation|tecrube|deneyim|beceri|yetenek|analiz|destek|raporlama|customer support|operations|marketing|finance|sales)$/i.test(
      norm
    )
  ) {
    return true;
  }

  return false;
}

function extractExplicitFactTerms(text = "") {
  const hay = canonicalizeTerm(text);
  return HARD_FACT_TERMS.filter((term) => containsCanonicalTermInText(hay, term));
}

function extractAcronymLikeTerms(text = "") {
  return uniqueTrimmedStrings(
    (String(text || "").match(/\b[A-Z]{2,}(?:\/[A-Z]{2,})?\b/g) || [])
      .map((x) => x.trim())
      .filter((x) => x.length <= 16)
  );
}

function extractNumericClaims(text = "") {
  return uniqueTrimmedStrings(String(text || "").match(/\b\d+(?:[.,]\d+)?(?:%|k|m|b|x)?\b/g) || []);
}

function extractCadenceTerms(text = "") {
  return CADENCE_TERMS.filter((term) => containsCanonicalTermInText(text, term));
}

function extractStakeholderTerms(text = "") {
  return STAKEHOLDER_TERMS.filter((term) => containsCanonicalTermInText(text, term));
}

function extractWorkflowTerms(text = "") {
  return WORKFLOW_TERMS.filter((term) => containsCanonicalTermInText(text, term));
}

function inferSeniority(text = "") {
  const norm = normalizeCompareText(text);
  if (/\b(chief|vp|vice president|director|head of|department head|general manager)\b/i.test(norm)) {
    return "leadership";
  }
  if (/\b(principal|staff engineer|lead|manager|team lead|supervisor)\b/i.test(norm)) {
    return "manager_or_lead";
  }
  if (/\b(senior|sr\.?|kidemli|uzman)\b/i.test(norm)) return "senior";
  if (/\b(intern|stajyer|junior|jr\.?|assistant|associate|trainee|entry level)\b/i.test(norm)) {
    return "junior";
  }
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
      const conservativeHits = countTermHits(combined, role.conservativeKeywords || []);
      const score =
        titleHits * 9 +
        skillHits * 5 +
        signalHits * 4 +
        keywordHits * 3 +
        summaryHits * 3 +
        bulletHits * 2 +
        conservativeHits * 3;

      return {
        key,
        score,
        titleHits,
        skillHits,
        signalHits,
        keywordHits,
        summaryHits,
        bulletHits,
        conservativeHits,
      };
    })
    .filter((item) => item.score > 0)
    .sort((a, b) => b.score - a.score);

  const top = scored[0]?.score || 0;
  const roleGroups = scored
    .filter(
      (item, idx) =>
        idx === 0 ||
        item.score >= Math.max(8, top - 6) ||
        item.titleHits >= 1 ||
        item.skillHits >= 2 ||
        item.signalHits >= 3
    )
    .slice(0, jd ? 3 : 2)
    .map((item) => item.key);

  const finalGroups = roleGroups.length ? roleGroups : ["generic"];
  const packs = finalGroups.map((key) => ROLE_TAXONOMY[key]).filter(Boolean);
  const domainSignals = uniqueTrimmedStrings(
    packs.flatMap((role) => [...(role.signals || []), ...(role.keywords || []), ...(role.conservativeKeywords || [])])
  )
    .filter((term) => containsCanonicalTermInText(combined, term))
    .slice(0, 20);

  return {
    roleGroups: finalGroups,
    primaryRole: finalGroups[0] || "generic",
    secondaryRoles: finalGroups.slice(1),
    seniority: inferSeniority(`${titleText}\n${combined}`),
    domainSignals,
    scoredRoles: scored.slice(0, 6),
    userSelectedRole: "",
    roleLocked: false,
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

function buildRoleProfileWithOverride({ targetRole = "", inferredRoleProfile = null, cv = "", jd = "" }) {
  const inferred = inferredRoleProfile || inferRoleProfile(cv, jd);
  const key = canonicalizeTerm(targetRole);

  if (!key) return inferred;

  const forcedGroups = ROLE_OVERRIDE_MAP[key] || inferred.roleGroups || ["generic"];
  const packs = forcedGroups.map((group) => ROLE_TAXONOMY[group]).filter(Boolean);

  const domainSignals = uniqueTrimmedStrings(
    packs.flatMap((role) => [...(role.signals || []), ...(role.keywords || []), ...(role.conservativeKeywords || [])])
  )
    .filter((term) => containsCanonicalTermInText(`${cv}\n${jd}`, term))
    .slice(0, 20);

  return {
    ...inferred,
    roleGroups: forcedGroups,
    primaryRole: forcedGroups[0] || inferred.primaryRole,
    secondaryRoles: forcedGroups.slice(1),
    domainSignals: domainSignals.length ? domainSignals : inferred.domainSignals,
    userSelectedRole: targetRole,
    roleLocked: true,
  };
}

function getSelectedRoleCanonical(roleProfile) {
  return canonicalizeTerm(roleProfile?.userSelectedRole || "");
}

function getRoleBlockedTerms(roleInput, cv = "", jd = "") {
  const profile = ensureRoleProfile(roleInput, cv, jd);
  const primary = profile?.primaryRole || "generic";
  const selected = getSelectedRoleCanonical(profile);

  let blocked = [...(ROLE_TAXONOMY[primary]?.blockedWithoutEvidence || [])];

  if (primary === "warehouse_operations") blocked.push(...ROLE_ADJACENCY_BLOCKS.warehouse_operations);
  if (primary === "customer_support") blocked.push(...ROLE_ADJACENCY_BLOCKS.customer_support);
  if (primary === "healthcare_administration") blocked.push(...ROLE_ADJACENCY_BLOCKS.healthcare_administration);
  if (primary === "administration") blocked.push(...ROLE_ADJACENCY_BLOCKS.administration);

  if (
    primary === "design" &&
    /(graphic designer|visual designer)/i.test(selected || profile?.userSelectedRole || "")
  ) {
    blocked.push(...ROLE_ADJACENCY_BLOCKS.design_graphic_focus);
  }

  return uniqueTrimmedStrings(blocked);
}

function buildRoleLockBlock(roleProfile) {
  if (!roleProfile?.roleLocked || !roleProfile?.userSelectedRole) return "";

  return [
    "USER-SELECTED ROLE LOCK:",
    `- The selected target role is: ${roleProfile.userSelectedRole}`,
    "- Treat this as the primary hard boundary.",
    "- Do not drift into adjacent job families unless directly supported by the resume or job description.",
    "- For weak rewrites, bullet-level evidence is required for injected specificity.",
    "- For JD-free missing keywords, stay inside conservative ATS vocabulary for the selected role.",
    "- Block adjacent-role language unless it is clearly supported.",
  ].join("\n");
}

function getRoleSuggestedKeywords(roleInput, cv = "", jd = "", { conservativeOnly = false } = {}) {
  const profile = ensureRoleProfile(roleInput, cv, jd);
  const packs = getRolePacks(profile, cv, jd);

  let out = uniqueTrimmedStrings(
    packs.flatMap((role) => {
      if (conservativeOnly && Array.isArray(role.conservativeKeywords) && role.conservativeKeywords.length) {
        return role.conservativeKeywords;
      }
      return [...(role.keywords || []), ...(role.conservativeKeywords || [])];
    })
  );

  if (!conservativeOnly) {
    if (profile.seniority === "manager_or_lead" || profile.seniority === "leadership") {
      out = uniqueTrimmedStrings(["stakeholder communication", "cross-functional collaboration", "process improvement", ...out]);
    }

    if (profile.seniority === "junior") {
      out = uniqueTrimmedStrings(["documentation", "process adherence", "task coordination", "quality checks", ...out]);
    }
  }

  return out;
}

function buildRoleContextText(roleInput, cv = "", jd = "") {
  const profile = ensureRoleProfile(roleInput, cv, jd);
  const packs = getRolePacks(profile);
  const suggested = getRoleSuggestedKeywords(profile, cv, jd, { conservativeOnly: !jd }).slice(0, 12);
  const verbs = uniqueTrimmedStrings(
    packs.flatMap((role) => [...(role.verbs || []), ...(role.safeSupportVerbs || [])])
  ).slice(0, 12);

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
  const verbs = uniqueTrimmedStrings(
    packs.flatMap((role) => [...(role.verbs || []), ...(role.safeSupportVerbs || [])])
  ).slice(0, 20);

  return [
    "ROLE WRITING RULES:",
    `- Primary role family: ${profile.primaryRole}`,
    `- Seniority signal: ${profile.seniority}`,
    `- Prefer truthful verbs such as: ${verbs.join(", ") || "coordinated, prepared, tracked, maintained"}`,
    "- Preserve native terminology of the profession.",
    "- Do not convert technical, finance, healthcare, education, legal, design, warehouse, or engineering bullets into generic business language.",
    "- If the original is support-level work, keep it support-level but sharper and clearer.",
    "- Do not invent leadership, ownership, tools, metrics, scale, stakeholders, channels, cadences, or business outcomes.",
  ].join("\n");
}

function looksLikeToolOrMethod(term = "", roleInput, cv = "", jd = "") {
  const profile = ensureRoleProfile(roleInput, cv, jd);
  const packs = getRolePacks(profile, cv, jd);
  const pool = uniqueTrimmedStrings([
    ...HARD_FACT_TERMS,
    ...packs.flatMap((role) => [
      ...(role.signals || []),
      ...(role.keywords || []),
      ...(role.conservativeKeywords || []),
      ...(role.advancedKeywords || []),
    ]),
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

  const conservativeThemes = getRoleSuggestedKeywords(profile, cv, "", { conservativeOnly: true });
  return conservativeThemes.some(
    (item) =>
      canonicalizeTerm(item) === norm ||
      canonicalizeTerm(item).includes(norm) ||
      norm.includes(canonicalizeTerm(item))
  );
}

function extractSkillLikeNgrams(text = "") {
  const clauses = normalizeSpace(text)
    .split(/[\n;•]/)
    .map((x) => x.trim())
    .filter(Boolean)
    .slice(0, 200);

  const hints = uniqueTrimmedStrings([
    "analysis",
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
    "legal",
    "compliance",
    "risk",
    "release",
    "deployment",
    "lesson",
    "schedule",
    "coordination",
    "documentation",
    "integration",
    "boq",
    "ticket",
    "case",
    "service",
    "email support",
    "live chat",
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

  return uniqueByNormalizedStrings(out).slice(0, 120);
}

function classifyTermCategory(term = "", roleInput, cv = "", jd = "") {
  const profile = ensureRoleProfile(roleInput, cv, jd);
  const norm = canonicalizeTerm(term);

  if (looksLikeCertification(term)) return "certification";
  if (HARD_FACT_TERMS.some((item) => canonicalizeTerm(item) === norm)) return "tool";

  const roleThemes = getRoleSuggestedKeywords(profile, cv, jd);
  if (roleThemes.some((item) => canonicalizeTerm(item) === norm)) return "domain";

  if (/\b(senior|lead|manager|director|principal|junior|associate|intern|uzman|kidemli|stajyer)\b/i.test(term)) {
    return "seniority";
  }

  return looksLikeToolOrMethod(term, profile, cv, jd) ? "methodology" : "responsibility";
}

function scoreExtractedTerm(term = "", text = "", roleInput, cv = "", jd = "") {
  const cleaned = cleanKeywordCandidate(term);
  if (!cleaned) return 0;

  let score = 0;
  const wc = countWords(cleaned);
  const norm = canonicalizeTerm(cleaned);

  if (isLowValueKeyword(cleaned)) score -= 14;
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

  const profile = ensureRoleProfile(roleInput, cv, jd);
  const packs = getRolePacks(profile, cv, jd);

  const lexicon = uniqueTrimmedStrings([
    ...HARD_FACT_TERMS,
    ...packs.flatMap((role) => [
      ...(role.signals || []),
      ...(role.keywords || []),
      ...(role.conservativeKeywords || []),
      ...(role.titles || []),
    ]),
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
    .slice(0, 45);

  return {
    ranked,
    tools: ranked.filter((item) => item.category === "tool").slice(0, 10).map((item) => item.term),
    methodologies: ranked.filter((item) => item.category === "methodology").slice(0, 10).map((item) => item.term),
    certifications: ranked.filter((item) => item.category === "certification").slice(0, 8).map((item) => item.term),
    responsibilities: ranked.filter((item) => item.category === "responsibility").slice(0, 12).map((item) => item.term),
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
  const terms = uniqueTrimmedStrings([
    ...extractExplicitFactTerms(cv),
    ...extractExplicitFactTerms(jd),
    ...extractAcronymLikeTerms(cv),
    ...extractAcronymLikeTerms(jd),
  ]);
  return terms.length ? terms.join(", ") : "(none explicitly supported)";
}

function extractSentenceFacts(text = "", roleInput, cv = "", jd = "") {
  const profile = ensureRoleProfile(roleInput, cv, jd);
  const packs = getRolePacks(profile, cv, jd);
  const roleTerms = uniqueTrimmedStrings(
    packs.flatMap((role) => [
      ...(role.signals || []),
      ...(role.keywords || []),
      ...(role.conservativeKeywords || []),
      ...(role.advancedKeywords || []),
    ])
  );

  return {
    tools: extractExplicitFactTerms(text),
    acronyms: extractAcronymLikeTerms(text),
    numbers: extractNumericClaims(text),
    cadence: extractCadenceTerms(text),
    stakeholders: extractStakeholderTerms(text),
    workflows: extractWorkflowTerms(text),
    roleTerms: roleTerms.filter((term) => containsCanonicalTermInText(text, term)).slice(0, 20),
  };
}

function buildFactSet(facts = {}) {
  return new Set(
    uniqueTrimmedStrings([
      ...(facts.tools || []),
      ...(facts.acronyms || []),
      ...(facts.numbers || []),
      ...(facts.cadence || []),
      ...(facts.stakeholders || []),
      ...(facts.workflows || []),
      ...(facts.roleTerms || []),
    ]).map(canonicalizeTerm)
  );
}

function findIntroducedFacts(source = "", rewrite = "", roleInput, cv = "", jd = "") {
  const sourceFacts = extractSentenceFacts(source, roleInput, cv, jd);
  const rewriteFacts = extractSentenceFacts(rewrite, roleInput, cv, jd);

  const sourceSet = buildFactSet(sourceFacts);
  const introduced = uniqueTrimmedStrings([
    ...(rewriteFacts.tools || []),
    ...(rewriteFacts.acronyms || []),
    ...(rewriteFacts.numbers || []),
    ...(rewriteFacts.cadence || []),
    ...(rewriteFacts.stakeholders || []),
    ...(rewriteFacts.workflows || []),
    ...(rewriteFacts.roleTerms || []),
  ]).filter((term) => !sourceSet.has(canonicalizeTerm(term)));

  return {
    sourceFacts,
    rewriteFacts,
    introduced,
  };
}

function isDirectlySupportedByJdForBullet(term = "", source = "", jd = "", roleInput, cv = "") {
  const normTerm = canonicalizeTerm(term);
  if (!normTerm || !containsCanonicalTermInText(jd, normTerm)) return false;

  const profile = ensureRoleProfile(roleInput, cv, jd);
  const sourceNorm = canonicalizeTerm(source);
  const sourceFacts = extractSentenceFacts(source, profile, cv, jd);
  const sourceSignals = uniqueTrimmedStrings([
    ...(sourceFacts.workflows || []),
    ...(sourceFacts.stakeholders || []),
    ...(sourceFacts.roleTerms || []),
    ...tokenizeForSimilarity(source).filter((t) => t.length > 3),
  ]);

  if (sourceSignals.some((sig) => containsCanonicalTermInText(term, sig) || containsCanonicalTermInText(jd, sig))) {
    return true;
  }

  const jdProfile = extractJdSignalProfile(jd, profile, cv);
  const category = classifyTermCategory(term, profile, cv, jd);
  if (category === "tool") {
    return sourceFacts.tools.length > 0 || sourceFacts.roleTerms.length > 0;
  }
  if (category === "methodology" || category === "domain") {
    return sourceFacts.roleTerms.length > 0 || sourceFacts.workflows.length > 0;
  }

  return sourceNorm.length > 0 && sourceFacts.roleTerms.length > 0;
}

function hasUnsupportedSpecificityInWeakRewrite(source = "", rewrite = "", cv = "", jd = "", roleInput) {
  const { introduced } = findIntroducedFacts(source, rewrite, roleInput, cv, jd);
  if (!introduced.length) return false;

  for (const term of introduced) {
    const supportedBySource = containsCanonicalTermInText(source, term);
    const supportedByJd = isDirectlySupportedByJdForBullet(term, source, jd, roleInput, cv);
    if (!supportedBySource && !supportedByJd) return true;
  }

  return false;
}

function getRoleDriftTermsInText(text = "", roleInput, cv = "", jd = "") {
  const blocked = getRoleBlockedTerms(roleInput, cv, jd);
  return blocked.filter((term) => containsCanonicalTermInText(text, term));
}

function hasUnsupportedRoleDriftInWeakRewrite(source = "", rewrite = "", roleInput, cv = "", jd = "") {
  const introducedBlocked = getRoleDriftTermsInText(rewrite, roleInput, cv, jd).filter(
    (term) => !containsCanonicalTermInText(source, term)
  );
  if (!introducedBlocked.length) return false;

  return introducedBlocked.some((term) => !isDirectlySupportedByJdForBullet(term, source, jd, roleInput, cv));
}

function hasUnsupportedRoleDriftInOptimized(originalCv = "", optimizedCv = "", roleInput, jd = "") {
  const profile = ensureRoleProfile(roleInput, originalCv, jd);
  const blocked = getRoleBlockedTerms(profile, originalCv, jd);
  if (!blocked.length) return false;

  const introduced = blocked.filter(
    (term) =>
      containsCanonicalTermInText(optimizedCv, term) &&
      !containsCanonicalTermInText(originalCv, term) &&
      !containsCanonicalTermInText(jd, term)
  );

  return introduced.length > 0;
}

function findUnsupportedTerms(originalCv = "", jd = "", optimizedCv = "", roleInput = null) {
  const allowed = new Set(
    uniqueTrimmedStrings([
      ...extractExplicitFactTerms(originalCv),
      ...extractExplicitFactTerms(jd),
      ...extractAcronymLikeTerms(originalCv),
      ...extractAcronymLikeTerms(jd),
    ]).map(canonicalizeTerm)
  );

  const rewriteTerms = uniqueTrimmedStrings([
    ...extractExplicitFactTerms(optimizedCv),
    ...extractAcronymLikeTerms(optimizedCv),
  ]).filter((term) => !allowed.has(canonicalizeTerm(term)));

  const roleDrift = roleInput && hasUnsupportedRoleDriftInOptimized(originalCv, optimizedCv, roleInput, jd)
    ? getRoleDriftTermsInText(optimizedCv, roleInput, originalCv, jd).filter(
        (term) =>
          !containsCanonicalTermInText(originalCv, term) &&
          !containsCanonicalTermInText(jd, term)
      )
    : [];

  return uniqueTrimmedStrings([...rewriteTerms, ...roleDrift]);
}

function isVerbOnlyRewrite(source = "", rewrite = "") {
  const s = String(source || "").trim();
  const r = String(rewrite || "").trim();
  if (!s || !r) return false;

  const sourceCore = stripLeadingWeakPhrase(s);
  const rewriteCore = stripLeadingWeakPhrase(r);
  const simCore = jaccardSimilarity(sourceCore, rewriteCore);
  const delta = getTokenDeltaMetrics(s, r);
  const sourceFacts = extractSentenceFacts(s);
  const rewriteFacts = extractSentenceFacts(r);

  const factDelta =
    (rewriteFacts.tools?.length || 0) - (sourceFacts.tools?.length || 0) +
    (rewriteFacts.workflows?.length || 0) - (sourceFacts.workflows?.length || 0) +
    (rewriteFacts.stakeholders?.length || 0) - (sourceFacts.stakeholders?.length || 0) +
    (rewriteFacts.cadence?.length || 0) - (sourceFacts.cadence?.length || 0);

  return simCore >= 0.9 && delta.totalDelta <= 2 && factDelta <= 0;
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
    /^provided assistance for\s+/i,
    /^provided assistance to\s+/i,
    /^provided assistance\s+/i,
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

function getSentenceSignalProfile(sentence = "", roleInput, cv = "", jd = "") {
  const s = String(sentence || "").trim();
  const profile = ensureRoleProfile(roleInput, cv, jd);
  const packs = getRolePacks(profile, cv, jd);
  const roleTerms = uniqueTrimmedStrings(
    packs.flatMap((role) => [
      ...(role.signals || []),
      ...(role.keywords || []),
      ...(role.conservativeKeywords || []),
    ])
  );

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
      isReasonablyStrong: false,
      genericSummary: false,
      stakeholderCount: 0,
      workflowCount: 0,
      cadenceCount: 0,
      numberCount: 0,
    };
  }

  const wc = countWords(s);
  const facts = extractSentenceFacts(s, profile, cv, jd);
  const explicitFactsCount =
    (facts.tools?.length || 0) +
    (facts.acronyms?.length || 0) +
    (facts.numbers?.length || 0);

  const roleHits = countTermHits(s, roleTerms);
  const hasNumber = facts.numbers.length > 0;
  const strongAction = STRONG_ACTION_RE.test(s);
  const startsWeak = WEAK_START_RE.test(s);
  const hasWeakPhrase = WEAK_VERB_RE.test(s);
  const genericSummary = GENERIC_SUMMARY_RE.test(s);
  const hasScopeSignal = SCOPE_CONTEXT_RE.test(s);
  const genericTask = GENERIC_TASK_RE.test(s);
  const softActionStart = SOFT_ACTION_START_RE.test(s);
  const stakeholderCount = facts.stakeholders.length;
  const workflowCount = facts.workflows.length;
  const cadenceCount = facts.cadence.length;
  const numberCount = facts.numbers.length;

  const hasSpecific =
    explicitFactsCount > 0 ||
    roleHits >= 2 ||
    workflowCount > 0 ||
    stakeholderCount > 0 ||
    (strongAction && roleHits >= 1 && hasScopeSignal) ||
    hasNumber;

  let strongScore = 0;
  let weakScore = 0;

  if (strongAction) strongScore += 3;
  if (hasNumber) strongScore += 2;
  if (facts.tools.length > 0) strongScore += Math.min(3, facts.tools.length);
  if (facts.acronyms.length > 0) strongScore += Math.min(2, facts.acronyms.length);
  if (roleHits > 0) strongScore += Math.min(4, roleHits);
  if (hasScopeSignal) strongScore += 1;
  if (workflowCount > 0) strongScore += Math.min(2, workflowCount);
  if (stakeholderCount > 0) strongScore += 1;
  if (wc >= 6 && wc <= 22) strongScore += 1;

  if (startsWeak) weakScore += 4;
  if (hasWeakPhrase) weakScore += 3;
  if (genericSummary) weakScore += 3;
  if (!hasSpecific) weakScore += 2;
  if (!strongAction) weakScore += 1;
  if (genericTask && !hasSpecific) weakScore += 2;
  if (softActionStart && !hasSpecific && roleHits <= 1) weakScore += 1;
  if (roleHits === 1 && !hasScopeSignal && explicitFactsCount === 0 && !hasNumber) weakScore += 1;
  if (wc <= 5) weakScore += 2;
  else if (wc <= 8 && !hasSpecific) weakScore += 1;
  if (wc > 28) weakScore += 1;

  if (hasSpecific && strongAction) weakScore -= 3;
  if (roleHits >= 2 && hasScopeSignal) weakScore -= 2;
  if (explicitFactsCount > 0) weakScore -= 1;
  if (genericTask && strongAction && roleHits >= 1 && hasScopeSignal) weakScore -= 1;

  const clearWeak =
    weakScore >= 8 ||
    (startsWeak && (!hasSpecific || strongScore <= 4)) ||
    (genericSummary && !hasSpecific) ||
    (hasWeakPhrase && genericTask && strongScore <= 4);

  const moderatelyWeak =
    !clearWeak &&
    (weakScore >= 5 ||
      (weakScore >= 4 &&
        (startsWeak || hasWeakPhrase || genericTask || !hasSpecific || softActionStart) &&
        strongScore <= 6) ||
      (softActionStart && !hasSpecific && roleHits <= 1 && wc <= 16));

  const isWeakCandidate = clearWeak || moderatelyWeak;
  const candidateTier = clearWeak ? "clear" : moderatelyWeak ? "moderate" : "none";
  const improvementPotential =
    Math.max(0, weakScore - Math.floor(strongScore / 2)) +
    (startsWeak ? 2 : 0) +
    (genericTask ? 1 : 0) +
    (!hasSpecific ? 1 : 0);

  const isReasonablyStrong =
    strongScore >= 6 &&
    hasSpecific &&
    !startsWeak &&
    !hasWeakPhrase &&
    !genericTask &&
    wc >= 6 &&
    wc <= 22;

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
    explicitFactsCount,
    wordCount: wc,
    isReasonablyStrong,
    genericSummary,
    stakeholderCount,
    workflowCount,
    cadenceCount,
    numberCount,
  };
}

function detectWeakSentenceCandidates(cv = "", roleInput, minCount = 6, maxCount = 12, jd = "") {
  const pools = extractWeakCandidatePools(cv);
  const candidates = [
    ...pools.experienceBullets.map((sentence) => ({
      sentence,
      sourceType: "experience_bullet",
      sectionPriority: 4,
    })),
    ...pools.summaryLines.map((sentence) => ({
      sentence,
      sourceType: "summary_line",
      sectionPriority: 2,
    })),
    ...pools.otherBullets.map((sentence) => ({
      sentence,
      sourceType: "other_bullet",
      sectionPriority: 1,
    })),
  ];

  const ranked = candidates
    .map((item) => {
      const profile = getSentenceSignalProfile(item.sentence, roleInput, cv, jd);
      const tierBoost = profile.candidateTier === "clear" ? 55 : profile.candidateTier === "moderate" ? 30 : 0;

      let rank =
        item.sectionPriority * 100 +
        tierBoost +
        profile.improvementPotential * 3 +
        (profile.startsWeak ? 8 : 0) +
        (profile.hasWeakPhrase ? 6 : 0) +
        (!profile.hasSpecific ? 4 : 0) +
        (profile.genericTask ? 6 : 0) -
        profile.strongScore * 2;

      if (
        /\b(team|support staff|internal service updates|daily tasks|routine communication|general support|various tasks|basic reporting|other duties|record keeping)\b/i.test(
          item.sentence
        )
      ) {
        rank += 4;
      }

      return { ...item, profile, rank };
    })
    .filter((item) => {
      if (isLikelySkillLabel(item.sentence, cv)) return false;
      if (item.profile.isReasonablyStrong) return false;

      if (item.sourceType === "summary_line") {
        return (
          item.profile.clearWeak ||
          (item.profile.moderatelyWeak && !item.profile.hasSpecific) ||
          (item.profile.genericSummary && item.profile.wordCount <= 16)
        );
      }

      if (item.sourceType === "experience_bullet") {
        return (
          item.profile.clearWeak ||
          item.profile.moderatelyWeak ||
          (item.profile.weakScore >= 4 &&
            (item.profile.startsWeak ||
              item.profile.hasWeakPhrase ||
              item.profile.genericTask ||
              !item.profile.hasSpecific))
        );
      }

      return item.profile.clearWeak || item.profile.moderatelyWeak;
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

function computeRewriteImprovementBreakdown(source = "", rewrite = "", roleInput, cv = "", jd = "") {
  const sourceProfile = getSentenceSignalProfile(source, roleInput, cv, jd);
  const rewriteProfile = getSentenceSignalProfile(rewrite, roleInput, cv, jd);
  const delta = getTokenDeltaMetrics(source, rewrite);
  const sourceFacts = extractSentenceFacts(source, roleInput, cv, jd);
  const rewriteFacts = extractSentenceFacts(rewrite, roleInput, cv, jd);

  const actionStrengthImproved =
    (!rewriteProfile.startsWeak && sourceProfile.startsWeak) ||
    (rewriteProfile.strongScore >= sourceProfile.strongScore + 2) ||
    (rewriteProfile.strongAction && !sourceProfile.strongAction);

  const clarityImproved =
    (rewriteProfile.hasScopeSignal && !sourceProfile.hasScopeSignal) ||
    (rewriteProfile.wordCount >= 6 &&
      rewriteProfile.wordCount <= 20 &&
      (sourceProfile.wordCount < 6 || sourceProfile.wordCount > 22)) ||
    (rewriteProfile.weakScore <= sourceProfile.weakScore - 2);

  const contextImproved =
    (rewriteFacts.workflows.length > sourceFacts.workflows.length) ||
    (rewriteFacts.stakeholders.length > sourceFacts.stakeholders.length) ||
    (rewriteProfile.roleHits > sourceProfile.roleHits);

  const readabilityImproved =
    (rewriteProfile.wordCount >= 6 &&
      rewriteProfile.wordCount <= 18 &&
      (sourceProfile.wordCount < 6 || sourceProfile.wordCount > 20)) ||
    (delta.totalDelta >= 3 && jaccardSimilarity(source, rewrite) < 0.92);

  const atsQualityImproved =
    rewriteProfile.strongScore > sourceProfile.strongScore &&
    rewriteProfile.weakScore < sourceProfile.weakScore;

  const nonVerbImprovement =
    clarityImproved || contextImproved || readabilityImproved || atsQualityImproved;

  const total =
    Number(actionStrengthImproved) +
    Number(clarityImproved) +
    Number(contextImproved) +
    Number(readabilityImproved) +
    Number(atsQualityImproved);

  return {
    total,
    actionStrengthImproved,
    clarityImproved,
    contextImproved,
    readabilityImproved,
    atsQualityImproved,
    nonVerbImprovement,
    sourceProfile,
    rewriteProfile,
  };
}

function rewriteStillFeelsWeak(rewrite = "", roleInput, cv = "", jd = "") {
  const profile = getSentenceSignalProfile(rewrite, roleInput, cv, jd);

  if (WEAK_REWRITE_RESIDUAL_RE.test(rewrite)) return true;
  if (WEAK_START_RE.test(rewrite)) return true;
  if (profile.startsWeak || profile.hasWeakPhrase) return true;
  if (profile.isWeakCandidate && profile.weakScore >= 5) return true;
  if (!profile.hasSpecific && profile.wordCount <= 8) return true;

  return false;
}

function isShallowRewrite(source = "", rewrite = "") {
  const s = String(source || "").trim();
  const r = String(rewrite || "").trim();
  if (!s || !r) return true;
  if (canonicalizeTerm(s) === canonicalizeTerm(r)) return true;

  const sim = jaccardSimilarity(s, r);
  const delta = getTokenDeltaMetrics(s, r);
  const sourceCore = stripLeadingWeakPhrase(s);
  const rewriteCore = stripLeadingWeakPhrase(r);
  const sourceFacts = extractSentenceFacts(s);
  const rewriteFacts = extractSentenceFacts(r);

  const sourceSpecificity =
    sourceFacts.tools.length +
    sourceFacts.acronyms.length +
    sourceFacts.workflows.length +
    sourceFacts.stakeholders.length +
    sourceFacts.cadence.length;
  const rewriteSpecificity =
    rewriteFacts.tools.length +
    rewriteFacts.acronyms.length +
    rewriteFacts.workflows.length +
    rewriteFacts.stakeholders.length +
    rewriteFacts.cadence.length;

  if (sim >= 0.91) return true;
  if (isVerbOnlyRewrite(s, r)) return true;
  if (WEAK_REWRITE_RESIDUAL_RE.test(r) && WEAK_VERB_RE.test(s)) return true;
  if (delta.totalDelta <= 1) return true;
  if (delta.totalDelta <= 2 && rewriteSpecificity <= sourceSpecificity && !SCOPE_CONTEXT_RE.test(r)) {
    return true;
  }

  if (
    sourceCore &&
    rewriteCore &&
    jaccardSimilarity(sourceCore, rewriteCore) >= 0.89 &&
    delta.totalDelta <= 3 &&
    rewriteSpecificity <= sourceSpecificity &&
    !SCOPE_CONTEXT_RE.test(r)
  ) {
    return true;
  }

  return false;
}

function isLongerWithoutBetter(source = "", rewrite = "", roleInput, cv = "", jd = "") {
  const sourceWc = countWords(source);
  const rewriteWc = countWords(rewrite);
  if (rewriteWc <= sourceWc + 2) return false;

  const breakdown = computeRewriteImprovementBreakdown(source, rewrite, roleInput, cv, jd);
  if (breakdown.total >= 3 && breakdown.nonVerbImprovement) return false;

  return rewriteWc >= sourceWc + 4;
}

function hasUnsupportedImpactClaims(originalText = "", candidateText = "") {
  const orig = String(originalText || "");
  const next = String(candidateText || "");
  return ENGLISH_RISKY_OUTCOME_RE.test(next) && !ENGLISH_RISKY_OUTCOME_RE.test(orig);
}

function hasOwnershipInflation(source = "", rewrite = "") {
  const inflationTerms = [
    "owned",
    "led",
    "drove",
    "spearheaded",
    "directed",
    "headed",
    "oversaw",
    "managed end-to-end",
    "owned end-to-end",
    "strategy",
    "strategic",
  ];

  return inflationTerms.some(
    (term) =>
      containsCanonicalTermInText(rewrite, term) &&
      !containsCanonicalTermInText(source, term)
  );
}

function pickRoleAwareRewriteVerb(sentence = "", roleInput, cv = "", jd = "") {
  const packs = getRolePacks(roleInput, cv, jd);

  if (/(email|live chat|inquiries|customer emails?|chat channels?)/i.test(sentence)) return "Responded to";
  if (/(ticket|case|issue|escalat|follow-?up|status)/i.test(sentence)) return "Handled";
  if (/(records?|documentation|logs?|notes?)/i.test(sentence)) return "Maintained";
  if (/(reports?|summary|summaries|dashboard)/i.test(sentence)) return "Prepared";
  if (/(schedule|calendar|meeting|travel|communication)/i.test(sentence)) return "Coordinated";
  if (/(invoice|order|request|processing|account updates?)/i.test(sentence)) return "Processed";
  if (/(analysis|reconciliation|audit|review|validation)/i.test(sentence)) return "Reviewed";
  if (/(testing|qa|defect|bug|test cases?)/i.test(sentence)) return "Executed";
  if (/(backend|api|integration|feature|code|application|system)/i.test(sentence)) return "Implemented";
  if (/(pick|pack|label|receive|shipment|inventory|stock)/i.test(sentence)) return "Handled";

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
  if (!(sourceProfile.isWeakCandidate || sourceProfile.weakScore >= 4 || sourceProfile.moderatelyWeak)) {
    return "";
  }

  const facts = extractSentenceFacts(source, roleInput, cv, jd);
  const { body, ending } = splitSentenceEnding(source);
  const stripped = stripLeadingWeakPhrase(body);

  if (!stripped || countWords(stripped) < 2) return "";

  const directMaps = [
    {
      re: /^daily communication with customers regarding (.+)$/i,
      fn: (m) => `Handled daily customer communication regarding ${m[1]}`,
    },
    {
      re: /^routine communication between (.+)$/i,
      fn: (m) => `Coordinated routine communication between ${m[1]}`,
    },
    {
      re: /^customer requests and internal service updates$/i,
      fn: () => `Handled customer requests and updated related service records`,
    },
    {
      re: /^weekly support summaries for the team$/i,
      fn: () => `Prepared weekly support summaries for internal case tracking`,
    },
    {
      re: /^reports?$/i,
      fn: () => `Prepared reports`,
    },
    {
      re: /^documentation$/i,
      fn: () => `Maintained documentation`,
    },
    {
      re: /^record keeping$/i,
      fn: () => `Maintained records`,
    },
  ];

  let rewrite = "";
  for (const item of directMaps) {
    const match = stripped.match(item.re);
    if (match) {
      rewrite = item.fn(match);
      break;
    }
  }

  if (!rewrite) {
    const lead = pickRoleAwareRewriteVerb(source, roleInput, cv, jd);
    let core = stripped;

    core = core
      .replace(/^the /i, "")
      .replace(/^team with /i, "")
      .replace(/^daily /i, (m) => m)
      .replace(/\s+/g, " ")
      .trim();

    if (!SCOPE_CONTEXT_RE.test(core) && facts.workflows.length === 0 && facts.stakeholders.length === 0) {
      if (countWords(core) <= 3) return "";
    }

    rewrite = `${lead} ${lowerFirst(core)}`.replace(/\s+/g, " ").trim();
  }

  if (!rewrite) return "";

  const candidate = `${rewrite}${ending}`;
  const filtered = filterWeakSentences([{ sentence: source, rewrite: candidate }], {
    outLang,
    roleInput,
    cv,
    jd,
  });

  return filtered.length ? filtered[0].rewrite : "";
}

function filterWeakSentences(items = [], { outLang = "English", roleInput, cv = "", jd = "" } = {}) {
  return (Array.isArray(items) ? items : [])
    .map((item) => ({
      sentence: String(item?.sentence || item?.source || "").trim(),
      rewrite: String(item?.rewrite || item?.after || "").trim(),
    }))
    .filter((item) => item.sentence && item.rewrite)
    .filter((item) => !isLikelySkillLabel(item.sentence, cv))
    .filter((item) => !isLikelySkillLabel(item.rewrite, cv))
    .filter((item) => canonicalizeTerm(item.sentence) !== canonicalizeTerm(item.rewrite))
    .map((item) => {
      const breakdown = computeRewriteImprovementBreakdown(item.sentence, item.rewrite, roleInput, cv, jd);
      return {
        ...item,
        ...breakdown,
      };
    })
    .filter((item) => {
      if (item.sourceProfile.isReasonablyStrong) return false;
      return (
        item.sourceProfile.isWeakCandidate ||
        item.sourceProfile.weakScore >= 4 ||
        (item.sourceProfile.weakScore >= 3 &&
          (item.sourceProfile.startsWeak ||
            item.sourceProfile.hasWeakPhrase ||
            item.sourceProfile.genericTask ||
            !item.sourceProfile.hasSpecific))
      );
    })
    .filter((item) => !isShallowRewrite(item.sentence, item.rewrite))
    .filter((item) => item.total >= 2)
    .filter((item) => item.nonVerbImprovement)
    .filter((item) => !rewriteStillFeelsWeak(item.rewrite, roleInput, cv, jd))
    .filter((item) => !hasUnsupportedSpecificityInWeakRewrite(item.sentence, item.rewrite, cv, jd, roleInput))
    .filter((item) => !hasUnsupportedRoleDriftInWeakRewrite(item.sentence, item.rewrite, roleInput, cv, jd))
    .filter((item) => !hasOwnershipInflation(item.sentence, item.rewrite))
    .filter((item) => !isLongerWithoutBetter(item.sentence, item.rewrite, roleInput, cv, jd))
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
        b.total - a.total ||
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

    const filtered = filterWeakSentences([{ sentence, rewrite }], {
      outLang,
      roleInput,
      cv,
      jd,
    });

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
    if (isLikelySkillLabel(source, cv)) continue;

    const filtered = filterWeakSentences([{ sentence: source, rewrite }], {
      outLang,
      roleInput,
      cv,
      jd,
    });

    if (!filtered.length) continue;

    const breakdown = computeRewriteImprovementBreakdown(source, rewrite, roleInput, cv, jd);
    const key = `${canonicalizeTerm(source)}__${canonicalizeTerm(rewrite)}`;
    if (seen.has(key)) continue;
    seen.add(key);

    out.push({
      source,
      rewrite,
      reason,
      ...breakdown,
    });
  }

  return out
    .sort((a, b) => {
      const tierOrder = { clear: 2, moderate: 1, none: 0 };
      return (
        tierOrder[b.sourceProfile.candidateTier] - tierOrder[a.sourceProfile.candidateTier] ||
        b.total - a.total ||
        b.sourceProfile.weakScore - a.sourceProfile.weakScore ||
        a.rewriteProfile.weakScore - b.rewriteProfile.weakScore
      );
    })
    .slice(0, 8)
    .map(({ source, rewrite, reason }) => ({ source, rewrite, reason }));
}

function buildPriorityRewriteText(bulletUpgrades = []) {
  const items = Array.isArray(bulletUpgrades) ? bulletUpgrades : [];
  if (!items.length) return "(none)";

  return items
    .map(
      (item, idx) =>
        `${idx + 1}. source: ${item.source}\n  stronger rewrite target: ${item.rewrite}${item.reason ? `\n  why: ${item.reason}` : ""}`
    )
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
  return hasJD
    ? Math.min(10, Math.max(5, Math.min(8, candidateCount)))
    : Math.min(12, Math.max(6, Math.min(10, candidateCount)));
}

function finalizeMissingKeywords(
  rawKeywords = [],
  { cv = "", jd = "", roleInput, hasJD = false, limit = 12 } = {}
) {
  const profile = ensureRoleProfile(roleInput, cv, jd);
  const cvNorm = canonicalizeTerm(cv);
  const rolePack = getRolePacks(profile, cv, jd);
  const blocked = getRoleBlockedTerms(profile, cv, jd);

  const modelTerms = uniqueByNormalizedStrings(
    (Array.isArray(rawKeywords) ? rawKeywords : [])
      .map(cleanKeywordCandidate)
      .filter(Boolean)
  );

  let pool = [...modelTerms];

  if (hasJD) {
    const jdTerms = extractJdSignalProfile(jd, profile, cv).ranked.map((item) => item.term);
    pool = uniqueByNormalizedStrings([...pool, ...jdTerms]);
  } else {
    pool = uniqueByNormalizedStrings([
      ...pool,
      ...getRoleSuggestedKeywords(profile, cv, jd, { conservativeOnly: true }),
    ]);
  }

  const scored = uniqueByNormalizedStrings(pool)
    .map((term) => {
      const cleaned = cleanKeywordCandidate(term);
      const norm = canonicalizeTerm(cleaned);
      let score = 0;

      if (!cleaned) score -= 100;
      if (isLowValueKeyword(cleaned)) score -= 18;
      if (containsCanonicalTermInText(cvNorm, norm)) score -= hasJD ? 12 : 14;
      else score += 7;

      if (blocked.some((t) => canonicalizeTerm(t) === norm)) {
        if (!containsCanonicalTermInText(cv, cleaned) && !containsCanonicalTermInText(jd, cleaned)) {
          score -= 30;
        }
      }

      if (hasJD && containsCanonicalTermInText(jd, norm)) score += 12;
      if (!hasJD && !isSafeCvOnlySuggestedTerm(cleaned, profile, cv)) score -= 22;

      if (HARD_FACT_TERMS.some((item) => canonicalizeTerm(item) === norm)) score += 4;
      if (looksLikeCertification(cleaned)) score += 5;
      if (looksLikeToolOrMethod(cleaned, profile, cv, jd)) score += 4;

      const wc = countWords(cleaned);
      if (wc >= 2 && wc <= 4) score += 3;
      if (looksLikeAcronym(cleaned)) score += 2;

      if (!hasJD && isBrandedOrVendorSpecific(cleaned)) score -= 18;

      const activeAdvanced = rolePack.flatMap((role) => role.advancedKeywords || []);
      if (!hasJD && activeAdvanced.some((item) => canonicalizeTerm(item) === norm)) {
        if (!containsCanonicalTermInText(cv, cleaned)) score -= 16;
      }

      if (!hasJD && /(sql joins|etl|data modeling|report automation|hipaa|ehr|emr|insurance verification|patient intake|crm segmentation|renewal|retention|qbr|upsell|wireframing|prototyping|design systems|user flows|mockups|ui design|ux design|rfq|purchase orders|goods receipt)/i.test(cleaned)) {
        if (!containsCanonicalTermInText(cv, cleaned)) score -= 22;
      }

      return { term: cleaned, score };
    })
    .filter((item) => item.score > -4)
    .sort((a, b) => b.score - a.score || countWords(b.term) - countWords(a.term));

  return scored.map((item) => item.term).slice(0, limit);
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

  const avgBulletWords = bullets.length
    ? bullets.reduce((sum, item) => sum + countWords(item), 0) / bullets.length
    : 0;

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
    if (profile.workflowCount > 0) value += 0.8;
    if (profile.stakeholderCount > 0) value += 0.5;

    if (
      /\b(prepared|processed|reviewed|tracked|updated|recorded|documented|coordinated|monitored|validated|maintained|resolved|responded|scheduled|organized|assembled|verified|collected|delivered|implemented|debugged|tested|integrated|deployed|optimized|analyzed|reconciled|inspected|packed|labeled|picked|received|counted|staged|shipped|follow(?:ed)?\s?up|guided|taught)\b/i.test(
        bullet
      )
    ) {
      value += 1.2;
    }

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
  const packs = getRolePacks(profile, cv, jd);
  const skills = uniqueTrimmedStrings(getSkillsLines(cv));
  const norm = canonicalizeTerm(cv);

  let score = 0;
  score += Math.min(8, skills.length);

  const hardHits = HARD_FACT_TERMS.filter((term) => containsCanonicalTermInText(norm, term)).length;
  score += Math.min(4, hardHits);

  const relevantPool = uniqueTrimmedStrings(
    packs.flatMap((role) => [...(role.signals || []), ...(role.keywords || []), ...(role.conservativeKeywords || [])])
  );
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

function normalizeModelComponentScores(componentScores = {}, hasJD = false) {
  const normalized = {};
  const input = componentScores && typeof componentScores === "object" ? componentScores : {};

  if (hasJD) {
    normalized.role_alignment = clampScore(input.role_alignment);
    normalized.bullet_strength = clampScore(input.bullet_strength);
    normalized.jd_keyword_match = clampScore(input.jd_keyword_match);
    normalized.section_completeness = clampScore(input.section_completeness);
    normalized.ats_safe_formatting = clampScore(input.ats_safe_formatting);
  } else {
    normalized.section_completeness = clampScore(input.section_completeness);
    normalized.clarity_readability = clampScore(input.clarity_readability);
    normalized.bullet_strength = clampScore(input.bullet_strength);
    normalized.ats_safe_formatting = clampScore(input.ats_safe_formatting);
    normalized.core_keyword_coverage = clampScore(input.core_keyword_coverage);
  }

  return normalized;
}

function computeComponentScore(componentScores = {}, hasJD = false) {
  const scores = normalizeModelComponentScores(componentScores, hasJD);

  if (hasJD) {
    return clampScore(
      scores.role_alignment * 0.28 +
        scores.bullet_strength * 0.28 +
        scores.jd_keyword_match * 0.18 +
        scores.section_completeness * 0.16 +
        scores.ats_safe_formatting * 0.1
    );
  }

  return clampScore(
    scores.section_completeness * 0.22 +
      scores.clarity_readability * 0.24 +
      scores.bullet_strength * 0.32 +
      scores.ats_safe_formatting * 0.14 +
      scores.core_keyword_coverage * 0.08
  );
}

function computeFinalOptimizedScore(originalCv = "", optimizedCv = "", originalScore = 0, jd = "", roleInput = null) {
  const base = clampScore(originalScore);
  if (!originalCv || !optimizedCv) return base;

  const origNorm = canonicalizeTerm(originalCv);
  const optNorm = canonicalizeTerm(optimizedCv);
  if (!optNorm || origNorm === optNorm) return base;

  const roleProfile = ensureRoleProfile(roleInput || inferRoleProfile(originalCv, jd), originalCv, jd);
  const rescoredOptimized = computeDeterministicAtsScore(optimizedCv, jd, roleProfile);
  const rawLift = Math.max(0, rescoredOptimized - base);

  const weakBefore = detectWeakSentenceCandidates(originalCv, roleProfile, 0, 20, jd).length;
  const weakAfter = detectWeakSentenceCandidates(optimizedCv, roleProfile, 0, 20, jd).length;
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

  const meaningfulChange =
    rawLift > 1 ||
    weakGain > 0 ||
    rewriteRatio >= 0.18 ||
    bulletGain >= 3 ||
    readabilityGain >= 2;

  if (!meaningfulChange) return base;

  lift = Math.round(lift);

  const cap = base < 40 ? 22 : base < 55 ? 18 : base < 70 ? 15 : base < 80 ? 12 : 8;
  lift = Math.max(4, Math.min(cap, lift));

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

  const weakBefore = detectWeakSentenceCandidates(originalCv, profile, 0, 20, jd).length;
  const weakAfter = detectWeakSentenceCandidates(optimizedCv, profile, 0, 20, jd).length;
  if (weakBefore > 0 && weakAfter >= weakBefore) return true;
  if (countPersistingWeakSources(optimizedCv, weakSentences) >= (hasJD ? 2 : 1)) return true;
  if (outLang === "English" && countCorporateFluffHits(optimizedCv) >= 2) return true;
  if (outLang === "English" && getOverlongBulletRatio(optimizedCv) > 0.35) return true;
  if (countWeakEnglishRewriteStarts(optimizedCv) >= 2) return true;
  if (findUnsupportedTerms(originalCv, jd, optimizedCv, profile).length > 0) return true;
  if (hasUnsupportedRoleDriftInOptimized(originalCv, optimizedCv, profile, jd)) return true;

  return false;
}

// --- PART 1 END ---
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
      {
        reasoningEffort: "medium",
        temperature: null,
        maxCompletionTokens: Math.max(maxCompletionTokens, 3600),
      },
      {
        reasoningEffort: "low",
        temperature: null,
        maxCompletionTokens: Math.max(maxCompletionTokens, 4400),
      },
    ];
  }

  if (passType === "repair") {
    return [
      {
        reasoningEffort: "low",
        temperature: null,
        maxCompletionTokens: Math.max(maxCompletionTokens, 3600),
      },
      {
        reasoningEffort: "minimal",
        temperature: 0.2,
        maxCompletionTokens: Math.max(maxCompletionTokens, 4200),
      },
    ];
  }

  if (passType === "bullet") {
    return [
      {
        reasoningEffort: "low",
        temperature: null,
        maxCompletionTokens: Math.max(maxCompletionTokens, 1700),
      },
      {
        reasoningEffort: "minimal",
        temperature: 0.2,
        maxCompletionTokens: Math.max(maxCompletionTokens, 2300),
      },
    ];
  }

  if (isPreview) {
    return [
      {
        reasoningEffort: "minimal",
        temperature: 0.2,
        maxCompletionTokens: Math.max(maxCompletionTokens, 1100),
      },
      {
        reasoningEffort: "minimal",
        temperature: 0.2,
        maxCompletionTokens: Math.max(maxCompletionTokens, 1500),
      },
    ];
  }

  return [
    {
      reasoningEffort: "low",
      temperature: null,
      maxCompletionTokens: Math.max(maxCompletionTokens, 1900),
    },
    {
      reasoningEffort: "minimal",
      temperature: 0.2,
      maxCompletionTokens: Math.max(maxCompletionTokens, 2500),
    },
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

async function callOpenAIJson({
  apiKey,
  model,
  system,
  userPrompt,
  isPreview = false,
  passType = "main",
  maxCompletionTokens = 1800,
}) {
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

function buildAtsSystem(outLang = "English") {
  return [
    "CRITICAL RULES (must follow):",
    "- Do NOT invent or assume any numbers, percentages, dates, KPIs, budgets, clients, team size, revenue, ownership level, or outcomes.",
    "- Only use facts, tools, platforms, processes, and terminology explicitly supported by the resume and optional job description.",
    "- Weak sentence detection must be selective. Do NOT flag strong lines just because they could be polished.",
    "- Only flag lines that are genuinely vague, generic, duty-only, support-heavy, shallow, or low-signal.",
    "- Do NOT produce trivial rewrites where only one word changes.",
    "- Rewrites must materially improve at least two of these: clarity, specificity, action strength, scope, business context, recruiter readability.",
    "- At least one accepted improvement must be more than a verb substitution.",
    "- If the original sentence is support-level work, keep it truthful and support-level. Do NOT escalate it into leadership or full ownership.",
    "- Bullet-level evidence must control specificity. Do not inject tools, workflows, cadences, stakeholders, acronyms, or reporting context unless the source bullet itself or the JD directly supports it.",
    "- Preserve profession-native terminology across technical, operational, finance, healthcare, education, legal, warehouse, design, and engineering resumes.",
    "- missing_keywords must prioritize realistic role-relevant tools, methods, certifications, domain phrases, and responsibility patterns.",
    "- In JD-free mode, missing keyword suggestions must be conservative and role-locked.",
    "- Avoid random filler keywords and soft-skill spam.",
    "- Keep optimized_cv ATS-safe, clean, parser-friendly, and commercially credible.",
    "- Return only valid JSON. No markdown. No extra text.",
    `- All output values must be written only in ${outLang}. Do not mix languages.`,
  ].join("\n");
}

function buildEnglishStyleBlock(roleInput, cv = "", jd = "") {
  return [
    "ENGLISH WRITING STYLE:",
    "- Write like a strong recruiter-edited resume, not marketing copy.",
    "- Prefer concise recruiter-friendly bullets, usually around 8-18 words when possible.",
    "- Prefer: action + scope/context + truthful operational detail.",
    "- Do not add corporate fluff, vague value statements, or unsupported outcome clauses.",
    "- Avoid shallow verb swaps such as helped -> assisted or supported -> contributed.",
    "- Avoid AI-polished filler such as across ongoing workflows, strategic initiatives, seamless support, or operational excellence.",
    "- Keep already-strong bullets sharp and short.",
    buildRoleWritingBlock(roleInput, cv, jd),
  ].join("\n");
}

function buildAnalysisPrompt({ cv, jd, hasJD, outLang, roleProfile, isPreview }) {
  const roleContextText = buildRoleContextText(roleProfile, cv, jd);
  const roleLockBlock = buildRoleLockBlock(roleProfile);
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
    ? "- Return up to 2 weak_sentences.\n- Do not force the count.\n- Skip borderline lines."
    : hasJD
    ? "- Return 7-12 weak_sentences only when they are genuinely weak.\n- Prefer weak experience bullets first, then other genuinely weak lines."
    : "- Return 8-12 weak_sentences only when they are genuinely weak.\n- If the resume clearly contains many weak or moderately weak bullets, return at least 6 items.";

  const missingRules = hasJD
    ? isPreview
      ? "- missing_keywords must contain 5-7 genuinely missing or underrepresented JD-relevant items."
      : "- missing_keywords must contain 12-20 genuinely missing or underrepresented JD-relevant items."
    : isPreview
    ? "- missing_keywords must contain 5-7 conservative role-aware ATS-relevant suggestions based on the resume alone."
    : "- missing_keywords must contain 10-18 conservative role-aware ATS-relevant suggestions based on the resume alone.";

  const summaryRule = isPreview
    ? "- summary must be 4-6 compact bullet-style lines."
    : "- summary must be 8-12 detailed bullet-style lines.";

  return [
    `Return JSON in this exact schema:\n\n${baseSchema}`,
    hasJD
      ? "\nTASK: Perform a job-specific ATS review."
      : "\nTASK: Perform a general ATS review with no job description.",
    "\nSTRICT REQUIREMENTS:",
    hasJD
      ? "- Score the resume against the job description without inventing alignment."
      : "- Infer likely role family, seniority, and recruiter-facing terminology from the resume itself.",
    missingRules,
    "- Prioritize tools, platforms, methods, certifications, domain phrases, responsibility patterns, and seniority signals over filler.",
    weakRules,
    "- Only select lines that are genuinely vague, generic, duty-only, shallow, or support-heavy.",
    "- Do not flag short skill labels, fragments, skill list entries, or already-acceptable bullets.",
    "- Do not flag already-strong technical or functional bullets that already contain concrete tools, platform detail, process detail, or domain terminology unless the rewrite would be clearly and materially stronger.",
    "- Weak rewrites must stay truthful and materially better.",
    "- Reject rewrites that are mainly one-word swaps, slight rearrangements, padded versions, or fake-specific versions.",
    summaryRule,
    "- Do not add extra keys. Do not add optimized_cv.",
    "\nROLE CONTEXT:",
    roleContextText,
    roleLockBlock ? `\n${roleLockBlock}` : "",
    hasJD ? `\nRANKED JD SIGNALS:\n${buildJdSignalText(jd, roleProfile, cv)}` : "",
    englishStyleBlock ? `\n${englishStyleBlock}` : "",
    `\nRESUME:\n${cv}`,
    hasJD ? `\nJOB DESCRIPTION:\n${jd}` : "",
  ]
    .filter(Boolean)
    .join("\n");
}

function buildWeakRewriteFallbackPrompt({ cv, jd, hasJD, candidates, outLang, roleProfile }) {
  const roleContextText = buildRoleContextText(roleProfile, cv, jd);
  const roleLockBlock = buildRoleLockBlock(roleProfile);
  const englishStyleBlock = outLang === "English" ? buildEnglishStyleBlock(roleProfile, cv, jd) : "";
  const candidateText = (Array.isArray(candidates) ? candidates : [])
    .map((item, idx) => `${idx + 1}. ${item}`)
    .join("\n");

  return [
    `Return JSON in this exact schema:\n\n{\n  "weak_sentences": [{"sentence": string, "rewrite": string}]\n}`,
    "\nTASK:",
    "Rewrite only the listed weak resume lines into materially stronger ATS-friendly versions.",
    "\nSTRICT RULES:",
    "- Rewrite only the provided sentences.",
    "- Keep all facts truthful.",
    "- Do not invent tools, metrics, results, stakeholders, cadence, platforms, or outcomes.",
    "- A tool, process, acronym, stakeholder type, cadence, or workflow detail may only be added if it is already in the source line or directly justified by the JD.",
    "- Preserve profession-native wording.",
    "- Avoid shallow synonym swaps.",
    "- Avoid role drift.",
    `- Output values only in ${outLang}.`,
    hasJD ? "- Return 6-12 items when possible." : "- Return 6-12 items when possible.",
    `\nROLE CONTEXT:\n${roleContextText}`,
    roleLockBlock ? `\n${roleLockBlock}` : "",
    englishStyleBlock ? `\n${englishStyleBlock}` : "",
    `\nWEAK CANDIDATES:\n${candidateText || "(none)"}`,
    `\nRESUME:\n${cv}`,
    hasJD ? `\nJOB DESCRIPTION:\n${jd}` : "",
  ]
    .filter(Boolean)
    .join("\n");
}

function buildTargetedBulletUpgradePrompt({
  cv,
  jd,
  hasJD,
  weakSentences,
  outLang,
  roleProfile,
}) {
  const roleContextText = buildRoleContextText(roleProfile, cv, jd);
  const roleLockBlock = buildRoleLockBlock(roleProfile);
  const englishStyleBlock = outLang === "English" ? buildEnglishStyleBlock(roleProfile, cv, jd) : "";
  const weakText = (Array.isArray(weakSentences) ? weakSentences : [])
    .map((item, idx) => `${idx + 1}. ${String(item?.sentence || "").trim()}`)
    .filter(Boolean)
    .join("\n");

  return [
    `Return JSON in this exact schema:\n\n{\n  "bullet_upgrades": [{ "source": string, "rewrite": string, "reason": string }]\n}`,
    "\nTASK:",
    "Create premium-quality bullet rewrites only for the provided weak resume sentences.",
    "\nSTRICT RULES:",
    "- Rewrite only the listed source sentences.",
    "- Keep each rewrite truthful, ATS-friendly, and recruiter-ready.",
    "- Do not invent numbers, results, tools, platforms, budgets, clients, ownership, stakeholders, cadence, or impact.",
    "- If the original is support-level work, keep it support-level but sharper and more specific.",
    "- Each rewrite must be materially stronger than the source, not a synonym swap.",
    "- reason must be short and explain what improved.",
    `- Output values only in ${outLang}.`,
    "- Return 3-8 items depending on real quality opportunities.",
    `\nROLE CONTEXT:\n${roleContextText}`,
    roleLockBlock ? `\n${roleLockBlock}` : "",
    englishStyleBlock ? `\n${englishStyleBlock}` : "",
    `\nWEAK SOURCE SENTENCES:\n${weakText || "(none)"}`,
    `\nRESUME:\n${cv}`,
    hasJD ? `\nJOB DESCRIPTION:\n${jd}` : "",
  ]
    .filter(Boolean)
    .join("\n");
}

function buildOptimizePrompt({
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
  const roleContextText = buildRoleContextText(roleProfile, cv, jd);
  const roleLockBlock = buildRoleLockBlock(roleProfile);
  const englishStyleBlock = outLang === "English" ? buildEnglishStyleBlock(roleProfile, cv, jd) : "";
  const priorityRewriteText = buildPriorityRewriteText(bulletUpgrades);

  return [
    `Return JSON in this exact schema:\n\n{\n  "optimized_cv": string\n}`,
    "\nTASK:",
    hasJD
      ? "Rewrite the resume into a materially stronger ATS-friendly version aligned to the job description."
      : "Rewrite the resume into a materially stronger ATS-friendly version.",
    "\nSTRICT RULES:",
    "- Keep the header identity block exactly as written.",
    "- Keep existing experience titles unchanged.",
    "- Keep exact dates, employers, titles, education, certifications, and explicit experience durations unchanged.",
    "- Do not invent numbers, tools, platforms, acronyms, KPIs, budgets, achievements, ownership, stakeholders, cadence, channels, or outcomes.",
    "- Do not replace generic platform language with specific platforms unless explicitly present in the resume.",
    "- Treat missing keywords as context only. Never force keywords into the resume unless the underlying work is already supported by the original resume text.",
    "- Keep already-strong bullets unchanged or only lightly polished.",
    "- Focus most rewrite effort on weaker summary lines and weaker or support-heavy bullets.",
    "- If 4 or more weak bullets were identified, materially improve at least 4 of them in the final optimized_cv.",
    "- Preserve structure and bullet count as much as possible.",
    "- Do not merge multiple bullets into one if that removes detail.",
    "- Use canonical section headings only.",
    `\nROLE CONTEXT:\n${roleContextText}`,
    roleLockBlock ? `\n${roleLockBlock}` : "",
    hasJD ? `\nRANKED JD SIGNALS:\n${buildJdSignalText(jd, roleProfile, cv)}` : "",
    `\nALLOWED EXPLICIT TOOLS / PLATFORMS / ACRONYMS:\n${allowedTermsText}`,
    `\nPRIORITY REWRITE TARGETS:\n${priorityRewriteText}`,
    englishStyleBlock ? `\n${englishStyleBlock}` : "",
    `\nANALYSIS SUMMARY:\n${summary || "(none)"}`,
    `\nHIGH PRIORITY KEYWORD GAPS (context only, do not force):\n${keywordsText || "(none)"}`,
    "\nSELF-CHECK BEFORE RETURNING:",
    "- no unsupported tools/platforms/acronyms added",
    "- no unsupported stakeholders/cadence/workflow details added",
    "- no invented achievements/results/ownership added",
    "- no unjustified leadership escalation",
    "- no adjacent-role drift",
    "- no major bullet loss",
    "- weak bullets materially improved, not cosmetically polished",
    `\nRESUME:\n${cv}`,
    hasJD ? `\nJOB DESCRIPTION:\n${jd}` : "",
  ]
    .filter(Boolean)
    .join("\n");
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
  const unsupportedText =
    Array.isArray(unsupportedTerms) && unsupportedTerms.length
      ? unsupportedTerms.join(", ")
      : "(none)";
  const roleContextText = buildRoleContextText(roleProfile, cv, jd);
  const roleLockBlock = buildRoleLockBlock(roleProfile);
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
    "- Do not invent tools, platforms, acronyms, stakeholders, cadence, channels, achievements, ownership, or impact.",
    "- Remove unsupported additions.",
    "- Preserve bullet count and structure as much as possible.",
    "- Use canonical section headings only.",
    `\nROLE CONTEXT:\n${roleContextText}`,
    roleLockBlock ? `\n${roleLockBlock}` : "",
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
    "- no invented stakeholders/cadence/workflow detail",
    "- no invented outcomes or ownership",
    "- no unjustified leadership escalation",
    "- no adjacent-role drift",
    "- no major bullet loss",
    `\nRESUME (original):\n${cv}`,
    hasJD ? `\nJOB DESCRIPTION:\n${jd}` : "",
    `\nCURRENT OPTIMIZED CV (rewrite this into a stronger final version):\n${currentOptimizedCv}`,
  ]
    .filter(Boolean)
    .join("\n");
}

function buildSummaryFallback({
  cv = "",
  jd = "",
  roleProfile,
  atsScore = 0,
  missingKeywords = [],
  weakSentences = [],
  hasJD = false,
  outLang = "English",
}) {
  const profile = ensureRoleProfile(roleProfile, cv, jd);
  const sectionScore = getSectionPresenceScore(cv);
  const bulletScore = getBulletStrengthScore(cv, profile, jd);
  const readabilityScore = getReadabilityScore(cv);
  const keywordScore = getKeywordBreadthScore(cv, profile, jd);
  const topMissing = ensureArrayStrings(missingKeywords, 6, 80);
  const weakCount = Array.isArray(weakSentences) ? weakSentences.length : 0;

  const linesEn = [
    `${profile.userSelectedRole ? `Target role: ${profile.userSelectedRole}. ` : ""}Resume is being evaluated mainly for ${profile.primaryRole.replace(/_/g, " ")} positions.`,
    `Current ATS score is ${clampScore(atsScore)}/100, with the strongest contributions coming from ${sectionScore >= 16 ? "basic structure" : "recoverable structure"}, ${readabilityScore >= 12 ? "readability" : "formatting/readability fundamentals"}, and ${keywordScore >= 8 ? "some relevant role terminology" : "limited role-specific terminology"}.`,
    `${bulletScore >= 24 ? "Several bullets already show usable task detail." : "Bullet quality is the main improvement area."} ${weakCount > 0 ? `${weakCount} weak or low-signal line${weakCount === 1 ? "" : "s"} were identified for targeted strengthening.` : "Only a limited number of bullets clearly qualify for rewrite."}`,
    hasJD
      ? `Because a job description is present, alignment is judged against role-specific requirements instead of generic ATS advice.`
      : `Because no job description is present, keyword suggestions are intentionally conservative and anchored to the selected role.`,
    topMissing.length
      ? `Highest-value missing or underrepresented terms include: ${topMissing.join(", ")}.`
      : `Missing-keyword suggestions are limited because unsupported adjacent-role terms were filtered out.`,
    `The strongest rewrite opportunities are duty-only bullets, support-heavy phrasing, and lines that lack clear scope or recruiter-readable context.`,
    `The optimized version should preserve facts, dates, titles, employers, and experience level while making weaker lines cleaner, sharper, and more ATS-friendly.`,
    hasJD
      ? `Keyword alignment should improve only where the JD is directly compatible with the existing resume evidence.`
      : `JD-free optimization should improve wording quality without forcing advanced tools, branded platforms, or adjacent-role vocabulary.`,
  ];

  const linesTr = [
    `${profile.userSelectedRole ? `Hedef rol: ${profile.userSelectedRole}. ` : ""}CV ağırlıklı olarak ${profile.primaryRole.replace(/_/g, " ")} rolleri için değerlendiriliyor.`,
    `Mevcut ATS skoru ${clampScore(atsScore)}/100. En güçlü alanlar ${sectionScore >= 16 ? "temel yapı" : "iyileştirilebilir yapı"}, ${readabilityScore >= 12 ? "okunabilirlik" : "format / okunabilirlik temeli"} ve ${keywordScore >= 8 ? "bazı role uygun terimler" : "sınırlı role özgü terimler"} olarak görünüyor.`,
    `${bulletScore >= 24 ? "Bazı maddeler zaten kullanılabilir görev detayı içeriyor." : "En büyük gelişim alanı madde kalitesi."} ${weakCount > 0 ? `${weakCount} zayıf veya düşük sinyalli satır güçlendirme için seçildi.` : "Yeniden yazım için net zayıf madde sayısı sınırlı."}`,
    hasJD
      ? `İş ilanı bulunduğu için değerlendirme genel ATS tavsiyesi yerine ilana özgü uyuma göre yapılıyor.`
      : `İş ilanı olmadığı için anahtar kelime önerileri bilinçli olarak daha temkinli ve seçilen role bağlı tutuldu.`,
    topMissing.length
      ? `En yüksek değerli eksik veya zayıf temsil edilen terimler: ${topMissing.join(", ")}.`
      : `Desteklenmeyen yakın-rol terimleri elendiği için anahtar kelime önerileri daha sınırlı tutuldu.`,
    `En iyi yeniden yazım fırsatları görev tanımı gibi kalan maddeler, aşırı destek odaklı ifadeler ve kapsamı net olmayan satırlardır.`,
    `Optimize edilmiş versiyon; gerçekler, tarihler, unvanlar, şirketler ve deneyim seviyesini korurken zayıf satırları daha net ve ATS dostu hale getirmelidir.`,
    hasJD
      ? `Anahtar kelime uyumu yalnızca iş ilanı ile CV kanıtı gerçekten örtüştüğünde artırılmalıdır.`
      : `İş ilanı olmadan yapılan optimizasyon, ileri seviye araçları veya komşu rol terimlerini zorlamadan ifade kalitesini iyileştirmelidir.`,
  ];

  return (outLang === "Turkish" ? linesTr : linesEn)
    .slice(0, outLang === "Turkish" ? 8 : 8)
    .join("\n");
}

function sanitizeSummary(summary = "", outLang = "English") {
  const s = normalizeSpace(String(summary || ""));
  if (!s) return "";
  const lines = s
    .split("\n")
    .map((line) => line.replace(/^[-•*]\s*/, "").trim())
    .filter(Boolean)
    .slice(0, 12);

  const cleaned = lines.filter((line) => {
    if (line.length < 18) return false;
    if (outLang === "English" && ENGLISH_FLUFF_RE.test(line) && countWords(line) < 8) return false;
    return true;
  });

  return cleaned.join("\n");
}

function sanitizeStringInput(value = "", maxChars = 40000) {
  return normalizeSpace(String(value || "").slice(0, maxChars));
}

function ensureArrayStrings(value, maxItems = 20, maxChars = 120) {
  return uniqueByNormalizedStrings(
    (Array.isArray(value) ? value : [])
      .map((item) => cleanKeywordCandidate(String(item || "").slice(0, maxChars)))
      .filter(Boolean)
  ).slice(0, maxItems);
}

function buildPreviewResponse({ normalized, hasJD, roleProfile }) {
  return {
    ats_score: normalized.ats_score,
    summary: normalized.summary,
    missing_keywords: normalized.missing_keywords.slice(0, 5),
    weak_sentences: normalized.weak_sentences.slice(0, 2),
    review_mode: hasJD ? "job_specific" : "general",
    detected_role: roleProfile?.primaryRole || "",
    selected_role: roleProfile?.userSelectedRole || "",
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
    sendEvent(res, "progress", {
      percent: safePercent,
      label: String(label || ""),
    });
  };
}

function sendStreamError(res, message, extra = {}) {
  sendEvent(res, "error", {
    message: message || "Server error",
    ...extra,
  });
  sendEvent(res, "done", { ok: false });
  res.end();
}

export default async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(405).json({ error: "POST required" });
  }

  initEventStream(res);
  const progress = createProgressSender(res);

  try {
    progress(4, "Reading resume...");

    const body = req.body && typeof req.body === "object" ? req.body : {};
    const cv = sanitizeStringInput(body.cv || "", 50000);
    const jd = sanitizeStringInput(body.jd || "", 30000);
    const targetRole = sanitizeStringInput(body.target_role || "", 120);
    const previewRequested = !!body.preview;
    const langCode =
      typeof body.lang === "string" && body.lang.trim()
        ? body.lang.trim().toLowerCase()
        : "en";
    const outLang = LANG_MAP[langCode] || "English";

    if (!cv) {
      return sendStreamError(res, "cv is required");
    }

    if (!targetRole) {
      return sendStreamError(res, "target_role is required", {
        code: "TARGET_ROLE_REQUIRED",
      });
    }

    const apiKey = process.env.OPENAI_API_KEY;
    if (!apiKey) {
      return sendStreamError(res, "OPENAI_API_KEY is missing on Vercel");
    }

    progress(10, "Checking access and limits...");

    const hasJD = !!jd;
    const sessionOk = verifySession(req);
    const isPreview = previewRequested || !sessionOk;
    const model = isPreview ? PREVIEW_MODEL : FULL_MODEL;

    const ip = getClientIp(req);
    const limiter = isPreview ? rlPreview : rlFull;
    const { success, reset } = await limiter.limit(ip);

    if (!success) {
      const retrySec = Math.max(1, Math.ceil((reset - Date.now()) / 1000));
      return sendStreamError(res, "Too many requests", {
        retry_after_seconds: retrySec,
      });
    }

    progress(18, "Detecting role profile...");

    const inferredRoleProfile = inferRoleProfile(cv, jd);
    const roleProfile = buildRoleProfileWithOverride({
      targetRole,
      inferredRoleProfile,
      cv,
      jd,
    });

    const systemPrompt = buildAtsSystem(outLang);

    progress(30, "Analyzing ATS score and structure...");

    let analysisData;
    try {
      analysisData = await callOpenAIJson({
        apiKey,
        model,
        system: systemPrompt,
        userPrompt: buildAnalysisPrompt({
          cv,
          jd,
          hasJD,
          outLang,
          roleProfile,
          isPreview,
        }),
        isPreview,
        passType: "main",
        maxCompletionTokens: isPreview ? 1000 : 1900,
      });
    } catch (err) {
      return sendStreamError(res, err?.message || "OpenAI error", {
        status: err?.status || 500,
        details: err?.details || String(err),
      });
    }

    progress(45, "Reviewing weak phrases...");

    const componentScores = normalizeModelComponentScores(
      analysisData?.component_scores && typeof analysisData.component_scores === "object"
        ? analysisData.component_scores
        : {},
      hasJD
    );

    const deterministicScore = computeDeterministicAtsScore(cv, jd, roleProfile);
    const modelComponentScore = computeComponentScore(componentScores, hasJD);
    const mergedBaseScore = clampScore(
      Math.round(deterministicScore * 0.82 + modelComponentScore * 0.18)
    );

    let weakSentences = filterWeakSentences(
      Array.isArray(analysisData?.weak_sentences) ? analysisData.weak_sentences : [],
      { outLang, roleInput: roleProfile, cv, jd }
    );

    const detectedWeakCandidates = detectWeakSentenceCandidates(
      cv,
      roleProfile,
      isPreview ? 2 : 6,
      12,
      jd
    );
    const desiredWeakCount = getDesiredWeakCount(hasJD, detectedWeakCandidates.length);

    if (
      weakSentences.length <
      Math.min(isPreview ? 2 : desiredWeakCount, detectedWeakCandidates.length)
    ) {
      try {
        const fallbackWeakData = await callOpenAIJson({
          apiKey,
          model,
          system: systemPrompt,
          userPrompt: buildWeakRewriteFallbackPrompt({
            cv,
            jd,
            hasJD,
            candidates: detectedWeakCandidates,
            outLang,
            roleProfile,
          }),
          isPreview,
          passType: "bullet",
          maxCompletionTokens: isPreview ? 1200 : 1800,
        });

        weakSentences = mergeWeakSentenceSets(
          weakSentences,
          Array.isArray(fallbackWeakData?.weak_sentences)
            ? fallbackWeakData.weak_sentences
            : [],
          roleProfile,
          outLang,
          cv,
          jd,
          isPreview ? 4 : 12
        );
      } catch {
        // keep current weak sentences
      }
    }

    if (
      weakSentences.length <
      Math.min(isPreview ? 2 : desiredWeakCount, detectedWeakCandidates.length)
    ) {
      const localWeak = buildLocalWeakSentenceSet(
        detectedWeakCandidates,
        roleProfile,
        outLang,
        cv,
        jd,
        isPreview ? 4 : 12
      );

      weakSentences = mergeWeakSentenceSets(
        weakSentences,
        localWeak,
        roleProfile,
        outLang,
        cv,
        jd,
        isPreview ? 4 : 12
      );
    }

    progress(58, "Building keyword suggestions...");

    const normalized = {
      ats_score: mergedBaseScore,
      optimized_ats_score: mergedBaseScore,
      component_scores: componentScores,
      missing_keywords: finalizeMissingKeywords(
        ensureArrayStrings(analysisData?.missing_keywords, hasJD ? 20 : 18),
        {
          cv,
          jd,
          roleInput: roleProfile,
          hasJD,
          limit: isPreview ? 7 : hasJD ? 20 : 18,
        }
      ),
      weak_sentences: weakSentences,
      summary: "",
      optimized_cv: "",
    };

    normalized.summary = sanitizeSummary(analysisData?.summary || "", outLang);
    if (!normalized.summary || normalized.summary.split("\n").length < (isPreview ? 3 : 5)) {
      normalized.summary = buildSummaryFallback({
        cv,
        jd,
        roleProfile,
        atsScore: normalized.ats_score,
        missingKeywords: normalized.missing_keywords,
        weakSentences: normalized.weak_sentences,
        hasJD,
        outLang,
      });
    }

    if (isPreview) {
      progress(100, "Completed.");
      sendEvent(res, "result", buildPreviewResponse({ normalized, hasJD, roleProfile }));
      sendEvent(res, "done", { ok: true });
      return res.end();
    }

    progress(68, "Generating stronger bullet rewrites...");

    let bulletUpgrades = [];
    if (normalized.weak_sentences.length > 0) {
      try {
        const bulletData = await callOpenAIJson({
          apiKey,
          model,
          system: systemPrompt,
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
          maxCompletionTokens: 1500,
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
        maxCompletionTokens: 3200,
      });

      if (typeof optimizeData?.optimized_cv === "string" && optimizeData.optimized_cv.trim()) {
        currentOptimized = forceSafeResume(cv, optimizeData.optimized_cv.trim(), outLang);

        if (bulletUpgrades.length) {
          currentOptimized = applyBulletUpgradesToCv(cv, currentOptimized, bulletUpgrades, outLang);
        }

        unsupportedTerms = findUnsupportedTerms(cv, jd, currentOptimized, roleProfile);
      }
    } catch {
      currentOptimized = "";
      unsupportedTerms = [];
    }

    if (!currentOptimized) {
      currentOptimized = bulletUpgrades.length
        ? applyBulletUpgradesToCv(cv, cv, bulletUpgrades, outLang)
        : forceSafeResume(cv, cv, outLang);

      unsupportedTerms = findUnsupportedTerms(cv, jd, currentOptimized, roleProfile);
    }

    progress(92, "Running final quality checks...");

    if (
      shouldRepairOptimizedCv(
        cv,
        currentOptimized,
        jd,
        outLang,
        normalized.weak_sentences,
        roleProfile
      ) ||
      unsupportedTerms.length > 0
    ) {
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
          maxCompletionTokens: 3200,
        });

        if (typeof repaired?.optimized_cv === "string" && repaired.optimized_cv.trim()) {
          currentOptimized = forceSafeResume(cv, repaired.optimized_cv.trim(), outLang);

          if (bulletUpgrades.length) {
            currentOptimized = applyBulletUpgradesToCv(cv, currentOptimized, bulletUpgrades, outLang);
          }

          unsupportedTerms = findUnsupportedTerms(cv, jd, currentOptimized, roleProfile);
        }
      } catch {
        // keep current optimized text
      }
    }

    if (
      !currentOptimized ||
      shouldRepairOptimizedCv(
        cv,
        currentOptimized,
        jd,
        outLang,
        normalized.weak_sentences,
        roleProfile
      ) ||
      unsupportedTerms.length > 0
    ) {
      currentOptimized = bulletUpgrades.length
        ? applyBulletUpgradesToCv(cv, cv, bulletUpgrades, outLang)
        : forceSafeResume(cv, cv, outLang);
      unsupportedTerms = findUnsupportedTerms(cv, jd, currentOptimized, roleProfile);
    }

    normalized.optimized_cv = currentOptimized;
    normalized.optimized_ats_score = computeFinalOptimizedScore(
      cv,
      currentOptimized,
      normalized.ats_score,
      jd,
      roleProfile
    );

    progress(100, "Completed.");

    sendEvent(res, "result", {
      ats_score: normalized.ats_score,
      optimized_ats_score: normalized.optimized_ats_score,
      component_scores: normalized.component_scores,
      missing_keywords: normalized.missing_keywords,
      weak_sentences: normalized.weak_sentences,
      optimized_cv: normalized.optimized_cv,
      summary: normalized.summary,
      review_mode: hasJD ? "job_specific" : "general",
      detected_role: roleProfile?.primaryRole || "",
      selected_role: roleProfile?.userSelectedRole || "",
    });

    sendEvent(res, "done", { ok: true });
    return res.end();
  } catch (err) {
    return sendStreamError(res, "Server error", {
      details: err?.message || String(err),
    });
  }
}

// --- PART 2 END / FILE END ---
