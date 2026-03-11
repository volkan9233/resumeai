
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

function uniqueTrimmedStrings(arr = []) {
  return Array.from(new Set((Array.isArray(arr) ? arr : []).map((x) => String(x || "").trim()).filter(Boolean)));
}

function escapeRegex(str = "") {
  return String(str).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
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
    [/restful api|rest apis/g, "rest api"],
    [/customer service/g, "customer support"],
    [/talent acquisition/g, "recruiting"],
    [/soc 2/g, "soc2"],
    [/iso 27001/g, "iso27001"],
  ];

  for (const [re, to] of replacements) s = s.replace(re, to);
  return s.trim();
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
  return String(str).trim().split(/\s+/).filter(Boolean).length;
}

function getNonEmptyLines(str = "") {
  return String(str).replace(/\r/g, "").split("\n").map((x) => x.trim()).filter(Boolean);
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
  for (const token of aSet) if (bSet.has(token)) intersection += 1;
  const union = new Set([...aSet, ...bSet]).size;
  return union ? intersection / union : 0;
}

function isSectionHeader(line = "") {
  return /^(PROFESSIONAL SUMMARY|SUMMARY|PROFILE|EXPERIENCE|WORK EXPERIENCE|PROFESSIONAL EXPERIENCE|SKILLS|TECHNICAL SKILLS|COMPETENCIES|EDUCATION|LANGUAGES|CERTIFICATIONS|LICENSES|PROJECTS|ADDITIONAL INFORMATION|PROFESYONEL ÖZET|ÖZET|PROFİL|DENEYİM|İŞ DENEYİMİ|YETKİNLİKLER|YETENEKLER|BECERİLER|EĞİTİM|DİLLER|BİLDİĞİ DİLLER|SERTİFİKALAR|PROJELER|EK BİLGİLER)$/i.test(String(line).trim());
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
      out.push(...line.split(/(?<=[.?!])\s+/).map((x) => x.trim()).filter(Boolean));
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

function extractExperienceTitles(cv = "") {
  const lines = getNonEmptyLines(cv);
  const titles = [];
  for (let i = 1; i < lines.length; i++) {
    const line = lines[i];
    if (/\|\s*.*(\d{4}|Present|Günümüz|Current|Devam)/i.test(line) || /(\d{4}).*(Present|Günümüz|Current|Devam)/i.test(line)) {
      const prev = lines[i - 1];
      if (prev && !isSectionHeader(prev) && !prev.includes("@") && !/^\d/.test(prev)) titles.push(prev);
    }
  }
  return titles;
}

function normalizeOptimizedHeadings(text = "") {
  return String(text || "")
    .replace(/\r/g, "")
    .replace(/^PROFILE$/gim, "PROFESSIONAL SUMMARY")
    .replace(/^WORK EXPERIENCE$/gim, "EXPERIENCE")
    .replace(/^PROFESSIONAL EXPERIENCE$/gim, "EXPERIENCE")
    .replace(/^(TECHNICAL SKILLS|COMPETENCIES)$/gim, "SKILLS")
    .replace(/^LICENSES$/gim, "CERTIFICATIONS")
    .replace(/^BİLDİĞİ DİLLER$/gim, "DİLLER")
    .replace(/^YETENEKLER$/gim, "YETKİNLİKLER")
    .replace(/^BECERİLER$/gim, "YETKİNLİKLER")
    .replace(/^PROFİL$/gim, "PROFESYONEL ÖZET")
    .replace(/^İŞ DENEYİMİ$/gim, "DENEYİM")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
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

function restoreExperienceTitles(originalCv = "", optimizedCv = "") {
  const origTitles = extractExperienceTitles(originalCv);
  if (!origTitles.length) return String(optimizedCv || "").trim();
  const lines = String(optimizedCv || "").replace(/\r/g, "").split("\n");
  let titleIdx = 0;
  for (let i = 1; i < lines.length; i++) {
    const line = String(lines[i]).trim();
    if (/\|\s*.*(\d{4}|Present|Günümüz|Current|Devam)/i.test(line) || /(\d{4}).*(Present|Günümüz|Current|Devam)/i.test(line)) {
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

function forceSafeResume(originalCv = "", optimizedCv = "") {
  let out = normalizeOptimizedHeadings(optimizedCv);
  out = replaceHeaderBlock(originalCv, out);
  out = restoreExperienceTitles(originalCv, out);
  return normalizeOptimizedHeadings(out);
}

function countUnchangedBullets(originalCv = "", optimizedCv = "") {
  const orig = new Set(getBulletLines(originalCv).map(canonicalizeTerm).filter(Boolean));
  const opt = new Set(getBulletLines(optimizedCv).map(canonicalizeTerm).filter(Boolean));
  let same = 0;
  for (const line of orig) if (opt.has(line)) same += 1;
  return { same, total: orig.size };
}

const ROLE_PACKS = {
  software_engineering: {
    titles: ["software engineer", "software developer", "backend engineer", "frontend developer", "full stack developer", "devops engineer", "mobile developer"],
    keywords: ["software development", "backend", "frontend", "api integration", "database", "debugging", "deployment", "cloud", "microservices", "version control"],
    strongTerms: ["rest api", "microservices", "sql", "python", "javascript", "typescript", "react", "node.js", "java", "c sharp", "aws", "azure", "gcp", "docker", "kubernetes", "git", "ci/cd", "unit testing"],
    toolTerms: ["sql", "python", "javascript", "typescript", "react", "node.js", "java", "aws", "azure", "gcp", "docker", "kubernetes", "git", "postman"],
    methodologyTerms: ["agile", "scrum", "ci/cd", "unit testing", "integration testing", "code review", "version control"],
    responsibilityTerms: ["feature development", "api integration", "bug fixing", "production support", "performance optimization", "database design", "release deployment"],
    businessContextTerms: ["application", "system", "service", "api", "database", "feature", "release", "production", "integration", "platform"],
    suggestedKeywords: ["REST APIs", "microservices", "system design", "unit testing", "integration testing", "cloud services", "database optimization", "CI/CD", "debugging", "performance tuning"],
  },
  qa: {
    titles: ["qa engineer", "quality assurance engineer", "software tester", "test engineer", "qa analyst", "automation tester"],
    keywords: ["quality assurance", "test execution", "test planning", "bug tracking", "defect reporting", "regression testing", "test automation"],
    strongTerms: ["qa", "test cases", "test scenarios", "regression testing", "selenium", "cypress", "postman", "jira", "bug tracking", "defect management", "uat"],
    toolTerms: ["selenium", "cypress", "postman", "jira", "api testing", "test automation"],
    methodologyTerms: ["regression testing", "smoke testing", "uat", "test automation", "manual testing", "agile", "scrum"],
    responsibilityTerms: ["test case creation", "defect reporting", "test execution", "bug verification", "quality validation"],
    businessContextTerms: ["testing", "test case", "defect", "bug", "validation", "release", "quality", "uat"],
    suggestedKeywords: ["test cases", "regression testing", "defect tracking", "test documentation", "UAT", "API testing", "automation testing", "quality validation"],
  },
  data: {
    titles: ["data analyst", "business intelligence analyst", "analytics specialist", "reporting analyst", "bi analyst"],
    keywords: ["data analysis", "analytics", "dashboard", "reporting", "kpi", "trend analysis", "data validation", "performance metrics"],
    strongTerms: ["sql", "python", "excel", "tableau", "power bi", "looker studio", "dashboard", "kpi", "data modeling", "etl"],
    toolTerms: ["sql", "python", "excel", "tableau", "power bi", "looker studio", "google sheets"],
    methodologyTerms: ["etl", "data modeling", "trend analysis", "kpi tracking", "report automation", "data validation"],
    responsibilityTerms: ["dashboard creation", "report generation", "trend analysis", "performance reporting", "data validation"],
    businessContextTerms: ["data", "analytics", "dashboard", "reporting", "metrics", "kpi", "insights", "trends", "performance"],
    suggestedKeywords: ["SQL", "data visualization", "dashboard reporting", "trend analysis", "KPI tracking", "data validation", "Power BI", "Tableau", "ETL"],
  },
  marketing: {
    titles: ["digital marketing specialist", "marketing specialist", "performance marketing specialist", "marketing executive", "growth marketer"],
    keywords: ["google ads", "meta ads", "google analytics", "ga4", "google tag manager", "seo", "sem", "ppc", "campaign reporting", "social media", "email marketing", "lead generation"],
    strongTerms: ["google ads", "meta ads", "google analytics", "ga4", "google tag manager", "seo", "sem", "ppc", "cpc", "ctr", "cpa", "roas", "a/b test", "lead generation"],
    toolTerms: ["google ads", "meta ads", "google analytics", "ga4", "google tag manager", "search console", "hubspot"],
    methodologyTerms: ["a/b test", "remarketing", "retargeting", "audience segmentation", "campaign optimization"],
    responsibilityTerms: ["campaign reporting", "content planning", "lead generation", "channel performance", "landing page updates"],
    businessContextTerms: ["campaign", "performance", "audience", "targeting", "social media", "email", "landing page", "content", "reporting", "optimization"],
    suggestedKeywords: ["PPC", "SEO", "SEM", "GA4", "Google Tag Manager", "audience segmentation", "A/B testing", "lead generation", "campaign optimization"],
  },
  product: {
    titles: ["product manager", "product owner", "associate product manager", "technical product manager", "product specialist"],
    keywords: ["product roadmap", "backlog", "requirements", "user stories", "feature planning", "stakeholder alignment", "release planning"],
    strongTerms: ["roadmap", "backlog", "user stories", "requirements gathering", "acceptance criteria", "jira", "confluence", "agile", "scrum", "feature prioritization"],
    toolTerms: ["jira", "confluence", "figma", "analytics"],
    methodologyTerms: ["agile", "scrum", "user stories", "backlog prioritization", "release planning", "product discovery"],
    responsibilityTerms: ["requirements definition", "feature prioritization", "stakeholder communication", "roadmap planning", "release coordination"],
    businessContextTerms: ["product", "feature", "roadmap", "backlog", "requirements", "stakeholders", "release", "user stories"],
    suggestedKeywords: ["product roadmap", "backlog prioritization", "requirements gathering", "user stories", "acceptance criteria", "release planning", "stakeholder communication"],
  },
  business_analysis: {
    titles: ["business analyst", "systems analyst", "process analyst", "operations analyst"],
    keywords: ["business requirements", "process analysis", "gap analysis", "workflow analysis", "documentation", "reporting"],
    strongTerms: ["requirements gathering", "process mapping", "gap analysis", "documentation", "stakeholder management", "jira", "confluence", "excel", "sql"],
    toolTerms: ["jira", "confluence", "excel", "sql", "power bi", "visio"],
    methodologyTerms: ["requirements gathering", "process mapping", "gap analysis", "workflow analysis", "uat", "agile", "scrum"],
    responsibilityTerms: ["requirements documentation", "stakeholder communication", "process improvement", "workflow analysis", "test support"],
    businessContextTerms: ["requirements", "process", "stakeholder", "workflow", "analysis", "documentation", "reporting", "uat"],
    suggestedKeywords: ["requirements gathering", "process mapping", "workflow analysis", "gap analysis", "stakeholder communication", "UAT support", "process improvement"],
  },
  finance: {
    titles: ["accountant", "financial analyst", "finance specialist", "accounts payable specialist", "accounts receivable specialist", "bookkeeper"],
    keywords: ["financial reporting", "reconciliation", "accounts payable", "accounts receivable", "invoice processing", "budget tracking", "forecasting", "variance analysis", "audit support", "ledger", "month-end"],
    strongTerms: ["financial reporting", "reconciliation", "accounts payable", "accounts receivable", "invoice processing", "budgeting", "forecasting", "variance analysis", "audit", "ledger", "excel", "ifrs", "gaap"],
    toolTerms: ["excel", "sap", "oracle", "quickbooks", "netsuite", "erp"],
    methodologyTerms: ["month-end close", "reconciliation", "variance analysis", "budget tracking", "forecasting", "audit support"],
    responsibilityTerms: ["invoice review", "ledger maintenance", "financial reporting", "expense tracking", "account reconciliation"],
    businessContextTerms: ["invoice", "reconciliation", "budget", "expense", "forecast", "variance", "audit", "ledger", "payable", "receivable", "month-end"],
    suggestedKeywords: ["financial reporting", "account reconciliation", "budget tracking", "variance analysis", "forecasting", "month-end close", "AP/AR", "audit support", "GAAP", "IFRS"],
  },
  hr: {
    titles: ["hr specialist", "human resources specialist", "recruiter", "talent acquisition specialist", "hr coordinator", "people operations specialist"],
    keywords: ["recruitment", "candidate screening", "interview scheduling", "employee records", "onboarding", "offboarding", "training coordination", "hr administration", "compliance", "payroll support"],
    strongTerms: ["recruiting", "candidate screening", "interview scheduling", "onboarding", "offboarding", "employee records", "talent acquisition", "compliance", "payroll support", "workday", "greenhouse", "ats"],
    toolTerms: ["workday", "greenhouse", "ats", "excel", "hris"],
    methodologyTerms: ["candidate screening", "interview coordination", "onboarding", "offboarding", "policy compliance"],
    responsibilityTerms: ["candidate communication", "interview scheduling", "employee documentation", "training coordination", "record maintenance"],
    businessContextTerms: ["candidate", "interview", "employee", "onboarding", "policy", "training", "records", "compliance", "payroll", "hr"],
    suggestedKeywords: ["talent acquisition", "candidate screening", "interview coordination", "employee onboarding", "HR administration", "policy compliance", "record management", "ATS"],
  },
  operations: {
    titles: ["operations manager", "operations specialist", "operations coordinator", "operations analyst", "office manager"],
    keywords: ["operations", "workflow", "documentation", "reporting", "process coordination", "process improvement", "scheduling", "cross-functional coordination", "vendor communication"],
    strongTerms: ["operations", "workflow", "process coordination", "documentation", "reporting", "scheduling", "status updates", "vendor communication", "process improvement"],
    toolTerms: ["excel", "erp", "sap", "jira"],
    methodologyTerms: ["process improvement", "workflow tracking", "status reporting"],
    responsibilityTerms: ["process coordination", "record maintenance", "status tracking", "meeting coordination", "vendor communication"],
    businessContextTerms: ["workflow", "operations", "process", "documentation", "records", "reporting", "coordination", "vendor", "status updates"],
    suggestedKeywords: ["process improvement", "workflow coordination", "vendor communication", "cross-functional collaboration", "status reporting", "process documentation"],
  },
  sales: {
    titles: ["sales specialist", "sales executive", "account executive", "sales coordinator", "business development executive"],
    keywords: ["sales", "lead management", "pipeline", "crm", "sales reporting", "proposal", "client communication", "deal tracking", "order processing"],
    strongTerms: ["pipeline", "crm", "lead follow-up", "account support", "sales reporting", "proposal", "deal tracking", "order processing", "salesforce", "hubspot"],
    toolTerms: ["salesforce", "hubspot", "crm", "excel"],
    methodologyTerms: ["pipeline management", "lead follow-up", "account coordination"],
    responsibilityTerms: ["client communication", "proposal preparation", "deal tracking", "order processing", "follow-up management"],
    businessContextTerms: ["sales", "lead", "pipeline", "crm", "proposal", "quote", "client", "deal", "orders", "account"],
    suggestedKeywords: ["sales pipeline", "lead management", "CRM", "proposal preparation", "deal tracking", "account coordination", "client follow-up"],
  },
  customer_support: {
    titles: ["customer support specialist", "customer service representative", "support specialist", "technical support specialist", "help desk specialist"],
    keywords: ["customer support", "ticket handling", "issue resolution", "live chat", "email support", "complaint handling", "service quality", "crm", "zendesk", "freshdesk", "sla", "escalation"],
    strongTerms: ["customer support", "ticket", "issue resolution", "issue escalation", "email support", "live chat", "complaint handling", "response time", "resolution time", "help desk"],
    toolTerms: ["zendesk", "freshdesk", "crm", "help desk"],
    methodologyTerms: ["ticket management", "issue escalation", "sla", "case follow-up"],
    responsibilityTerms: ["customer communication", "case follow-up", "support documentation", "issue escalation", "service records"],
    businessContextTerms: ["customer", "ticket", "case", "issue", "service", "support", "follow-up", "requests", "feedback", "complaints", "response"],
    suggestedKeywords: ["ticket management", "issue resolution", "service quality", "SLA", "escalation handling", "support documentation", "customer communication", "case follow-up"],
  },
  customer_success: {
    titles: ["customer success specialist", "customer success manager", "client success specialist", "account manager"],
    keywords: ["customer success", "onboarding", "renewal", "retention", "account management", "customer communication", "relationship management", "customer feedback", "nps", "csat", "qbr"],
    strongTerms: ["customer success", "onboarding", "account management", "renewal", "retention", "customer feedback", "relationship management", "nps", "csat", "qbr"],
    toolTerms: ["crm", "salesforce", "hubspot"],
    methodologyTerms: ["customer onboarding", "renewal support", "account management", "qbr"],
    responsibilityTerms: ["client communication", "renewal follow-up", "onboarding coordination", "relationship management"],
    businessContextTerms: ["client", "account", "onboarding", "renewal", "retention", "feedback", "engagement", "relationship", "customer journey"],
    suggestedKeywords: ["customer onboarding", "account management", "renewal support", "customer retention", "relationship management", "CSAT", "NPS", "QBR"],
  },
  design: {
    titles: ["designer", "graphic designer", "ui designer", "ux designer", "product designer", "visual designer"],
    keywords: ["design", "wireframes", "prototypes", "user interface", "user experience", "visual design", "brand assets", "design systems"],
    strongTerms: ["figma", "adobe creative suite", "photoshop", "illustrator", "wireframes", "prototypes", "ui", "ux", "design system", "mockups"],
    toolTerms: ["figma", "adobe creative suite", "photoshop", "illustrator", "after effects"],
    methodologyTerms: ["wireframing", "prototyping", "design systems", "user flows", "usability testing"],
    responsibilityTerms: ["asset creation", "interface design", "visual design", "brand consistency", "prototype creation"],
    businessContextTerms: ["design", "wireframe", "prototype", "interface", "visual", "brand", "layout", "assets", "user flow"],
    suggestedKeywords: ["Figma", "wireframing", "prototyping", "design systems", "UI design", "UX design", "user flows", "visual design"],
  },
  education: {
    titles: ["teacher", "english teacher", "math teacher", "subject teacher", "instructor", "lecturer", "teaching assistant"],
    keywords: ["lesson planning", "classroom management", "student assessment", "curriculum", "instruction", "student support", "teaching materials"],
    strongTerms: ["lesson planning", "classroom management", "student assessment", "curriculum development", "instruction", "learning materials", "student progress"],
    toolTerms: ["excel", "powerpoint", "google classroom", "office"],
    methodologyTerms: ["lesson planning", "curriculum development", "classroom management", "student assessment"],
    responsibilityTerms: ["lesson delivery", "assessment preparation", "student progress tracking", "classroom support"],
    businessContextTerms: ["classroom", "student", "curriculum", "lesson", "assessment", "instruction", "learning"],
    suggestedKeywords: ["lesson planning", "classroom management", "student assessment", "curriculum development", "learning materials", "student progress tracking", "instruction"],
  },
  healthcare_admin: {
    titles: ["healthcare administrator", "medical secretary", "medical office assistant", "patient coordinator", "clinic coordinator"],
    keywords: ["patient scheduling", "medical records", "insurance verification", "ehr", "emr", "clinic operations", "appointment coordination", "hipaa"],
    strongTerms: ["patient scheduling", "medical records", "insurance verification", "ehr", "emr", "hipaa", "appointment coordination", "patient communication"],
    toolTerms: ["ehr", "emr", "excel", "office"],
    methodologyTerms: ["patient intake", "insurance verification", "record maintenance", "appointment scheduling"],
    responsibilityTerms: ["patient communication", "appointment scheduling", "medical record updates", "insurance follow-up"],
    businessContextTerms: ["patient", "appointment", "clinic", "medical records", "insurance", "scheduling", "ehr", "emr"],
    suggestedKeywords: ["patient scheduling", "medical records", "insurance verification", "EHR/EMR", "appointment coordination", "HIPAA", "patient communication"],
  },
  civil_engineering: {
    titles: ["civil engineer", "site engineer", "construction engineer", "project site engineer"],
    keywords: ["civil engineering", "site supervision", "construction", "project drawings", "quantity takeoff", "boq", "technical documentation", "autocad", "revit", "primavera p6"],
    strongTerms: ["autocad", "revit", "primavera p6", "site supervision", "technical drawings", "quantity takeoff", "boq", "construction documentation", "inspection"],
    toolTerms: ["autocad", "revit", "primavera p6", "excel"],
    methodologyTerms: ["site inspection", "quantity takeoff", "project documentation", "schedule tracking"],
    responsibilityTerms: ["drawing review", "site coordination", "technical documentation", "progress tracking", "contractor coordination"],
    businessContextTerms: ["construction", "site", "drawing", "inspection", "boq", "quantity", "schedule", "technical"],
    suggestedKeywords: ["AutoCAD", "Revit", "Primavera P6", "site supervision", "quantity takeoff", "BOQ", "technical documentation", "construction coordination"],
  },
  mechanical_engineering: {
    titles: ["mechanical engineer", "design engineer", "maintenance engineer", "production engineer"],
    keywords: ["mechanical design", "technical drawings", "solidworks", "autocad", "equipment maintenance", "production support", "technical documentation", "quality checks"],
    strongTerms: ["solidworks", "autocad", "technical drawings", "equipment maintenance", "preventive maintenance", "production support", "quality checks", "root cause analysis"],
    toolTerms: ["solidworks", "autocad", "excel", "erp"],
    methodologyTerms: ["preventive maintenance", "quality checks", "technical documentation", "root cause analysis"],
    responsibilityTerms: ["drawing preparation", "equipment inspection", "maintenance planning", "technical support", "production coordination"],
    businessContextTerms: ["mechanical", "equipment", "maintenance", "drawing", "production", "quality", "inspection", "technical"],
    suggestedKeywords: ["SolidWorks", "AutoCAD", "technical drawings", "preventive maintenance", "equipment inspection", "production support", "quality checks"],
  },
  project: {
    titles: ["project manager", "project coordinator", "program coordinator", "program manager", "pm"],
    keywords: ["project coordination", "project management", "timelines", "deliverables", "status tracking", "stakeholder updates", "milestones", "project documentation", "risk tracking"],
    strongTerms: ["project coordination", "project management", "timelines", "deliverables", "milestones", "status tracking", "risk tracking", "jira", "confluence", "agile"],
    toolTerms: ["jira", "confluence", "excel", "primavera p6", "ms project"],
    methodologyTerms: ["agile", "scrum", "waterfall", "risk tracking", "timeline management", "deliverable coordination"],
    responsibilityTerms: ["stakeholder updates", "status reporting", "meeting facilitation", "project documentation", "timeline tracking"],
    businessContextTerms: ["project", "timeline", "deliverable", "milestone", "status update", "stakeholder", "coordination", "risk"],
    suggestedKeywords: ["timeline management", "deliverable coordination", "status reporting", "stakeholder communication", "risk tracking", "project documentation", "milestone tracking"],
  },
  executive_assistant: {
    titles: ["executive assistant", "personal assistant", "administrative assistant", "office assistant"],
    keywords: ["calendar management", "travel coordination", "meeting coordination", "document preparation", "executive support", "scheduling", "record keeping", "office administration"],
    strongTerms: ["calendar management", "travel coordination", "meeting coordination", "document preparation", "record keeping", "scheduling", "executive support"],
    toolTerms: ["excel", "powerpoint", "office", "google sheets"],
    methodologyTerms: ["calendar coordination", "meeting scheduling", "document management"],
    responsibilityTerms: ["appointment scheduling", "travel arrangements", "meeting preparation", "document management", "record maintenance"],
    businessContextTerms: ["calendar", "appointments", "schedules", "documents", "records", "meeting materials", "administrative", "executive"],
    suggestedKeywords: ["calendar management", "meeting coordination", "travel coordination", "document management", "record maintenance", "executive support"],
  },
  administrative: {
    titles: ["administrative assistant", "office assistant", "admin assistant"],
    keywords: ["administrative support", "calendar management", "scheduling", "meeting coordination", "document preparation", "filing", "data entry", "record keeping", "office support"],
    strongTerms: ["calendar management", "scheduling", "meeting coordination", "document preparation", "filing", "data entry", "record keeping", "office operations"],
    toolTerms: ["office", "excel", "powerpoint", "google sheets"],
    methodologyTerms: ["document management", "calendar coordination", "meeting scheduling", "record maintenance"],
    responsibilityTerms: ["document preparation", "record maintenance", "appointment scheduling", "office support"],
    businessContextTerms: ["calendar", "appointments", "documents", "records", "filing", "data entry", "administrative", "office support"],
    suggestedKeywords: ["document management", "calendar coordination", "meeting scheduling", "record maintenance", "office administration", "data entry accuracy"],
  },
  supply_chain: {
    titles: ["supply chain specialist", "logistics specialist", "logistics coordinator", "warehouse coordinator", "inventory specialist"],
    keywords: ["supply chain", "logistics", "inventory", "shipment coordination", "warehouse operations", "order fulfillment", "dispatch", "delivery tracking", "stock control"],
    strongTerms: ["inventory management", "warehouse management", "shipment tracking", "logistics coordination", "stock control", "order fulfillment", "vendor coordination", "transport planning", "sap", "erp"],
    toolTerms: ["sap", "erp", "excel", "warehouse management"],
    methodologyTerms: ["inventory control", "shipment tracking", "warehouse operations", "logistics planning"],
    responsibilityTerms: ["delivery tracking", "inventory reconciliation", "order coordination", "stock monitoring", "vendor follow-up"],
    businessContextTerms: ["inventory", "warehouse", "shipment", "logistics", "delivery", "order", "stock", "vendor", "dispatch", "transport"],
    suggestedKeywords: ["inventory management", "shipment tracking", "warehouse operations", "logistics coordination", "stock control", "order fulfillment"],
  },
  procurement: {
    titles: ["procurement specialist", "purchasing specialist", "buyer", "sourcing specialist", "procurement coordinator"],
    keywords: ["procurement", "purchasing", "sourcing", "vendor management", "rfq", "purchase orders", "supplier communication", "cost comparison"],
    strongTerms: ["procurement", "sourcing", "vendor management", "supplier communication", "purchase orders", "rfq", "price comparison", "contract support", "sap", "erp"],
    toolTerms: ["sap", "erp", "excel"],
    methodologyTerms: ["vendor evaluation", "sourcing", "purchase order processing", "rfq handling"],
    responsibilityTerms: ["supplier follow-up", "purchase order processing", "vendor communication", "price comparison", "documentation"],
    businessContextTerms: ["procurement", "purchasing", "sourcing", "vendor", "supplier", "purchase order", "rfq", "contract"],
    suggestedKeywords: ["vendor management", "sourcing", "purchase orders", "supplier communication", "RFQ", "price comparison", "procurement documentation"],
  },
  cybersecurity: {
    titles: ["cybersecurity analyst", "security analyst", "information security analyst", "soc analyst", "security engineer"],
    keywords: ["information security", "security monitoring", "incident response", "vulnerability management", "threat detection", "siem", "soc"],
    strongTerms: ["soc", "siem", "incident response", "vulnerability management", "risk assessment", "iam", "access control", "security monitoring", "splunk", "microsoft defender", "iso27001", "soc2"],
    toolTerms: ["splunk", "microsoft defender", "siem", "jira", "aws", "azure"],
    methodologyTerms: ["incident response", "access review", "security monitoring", "risk assessment", "vulnerability scanning"],
    responsibilityTerms: ["alert triage", "incident documentation", "access review", "security reporting", "control monitoring"],
    businessContextTerms: ["security", "incident", "alert", "access", "risk", "compliance", "monitoring", "controls"],
    suggestedKeywords: ["incident response", "security monitoring", "vulnerability management", "risk assessment", "access control", "SIEM", "ISO 27001", "SOC 2"],
  },
  cloud_infrastructure: {
    titles: ["cloud engineer", "cloud specialist", "site reliability engineer", "infrastructure engineer", "platform engineer"],
    keywords: ["cloud infrastructure", "infrastructure", "deployment", "monitoring", "containers", "terraform", "automation", "sre"],
    strongTerms: ["aws", "azure", "gcp", "docker", "kubernetes", "terraform", "monitoring", "deployment", "ci/cd", "infrastructure as code"],
    toolTerms: ["aws", "azure", "gcp", "docker", "kubernetes", "terraform", "git", "ci/cd"],
    methodologyTerms: ["infrastructure as code", "deployment automation", "monitoring", "incident management"],
    responsibilityTerms: ["environment maintenance", "deployment support", "infrastructure monitoring", "platform documentation"],
    businessContextTerms: ["cloud", "infrastructure", "deployment", "platform", "environment", "monitoring", "availability"],
    suggestedKeywords: ["cloud infrastructure", "Kubernetes", "Docker", "Terraform", "CI/CD", "monitoring", "deployment automation", "infrastructure as code"],
  },
  network_systems: {
    titles: ["network engineer", "system administrator", "systems administrator", "it support specialist", "it administrator"],
    keywords: ["network", "server", "system administration", "user support", "access management", "infrastructure support", "troubleshooting"],
    strongTerms: ["network troubleshooting", "server administration", "active directory", "vpn", "firewall", "user support", "access management", "windows server", "linux"],
    toolTerms: ["active directory", "windows server", "linux", "vpn", "firewall", "office365"],
    methodologyTerms: ["troubleshooting", "access management", "system maintenance", "incident handling"],
    responsibilityTerms: ["user provisioning", "ticket resolution", "system maintenance", "network support", "issue documentation"],
    businessContextTerms: ["network", "server", "system", "user", "access", "ticket", "incident", "infrastructure"],
    suggestedKeywords: ["network troubleshooting", "system administration", "Active Directory", "VPN", "firewall management", "ticket resolution", "user provisioning"],
  },
  legal_compliance: {
    titles: ["legal assistant", "compliance specialist", "compliance analyst", "paralegal", "contracts specialist"],
    keywords: ["compliance", "contract review", "policy review", "documentation", "regulatory requirements", "audit support", "legal research"],
    strongTerms: ["compliance monitoring", "policy review", "contract support", "regulatory documentation", "audit support", "due diligence", "legal research"],
    toolTerms: ["excel", "document management"],
    methodologyTerms: ["policy review", "document review", "regulatory tracking", "audit support"],
    responsibilityTerms: ["contract documentation", "record maintenance", "compliance reporting", "policy updates"],
    businessContextTerms: ["policy", "compliance", "contract", "legal", "documentation", "audit", "regulatory", "records"],
    suggestedKeywords: ["compliance monitoring", "policy review", "regulatory documentation", "contract support", "audit support", "due diligence", "compliance reporting"],
  },
  retail: {
    titles: ["retail associate", "store associate", "store manager", "sales associate", "cashier"],
    keywords: ["retail", "store operations", "customer service", "merchandising", "inventory", "cash handling", "sales floor"],
    strongTerms: ["store operations", "cash handling", "inventory", "merchandising", "customer support", "pos", "stock replenishment"],
    toolTerms: ["pos", "excel"],
    methodologyTerms: ["stock replenishment", "store opening", "store closing", "customer service"],
    responsibilityTerms: ["cash handling", "shelf organization", "inventory checks", "customer assistance", "sales floor support"],
    businessContextTerms: ["store", "retail", "customer", "inventory", "cash", "merchandising", "stock", "sales floor"],
    suggestedKeywords: ["store operations", "cash handling", "inventory checks", "merchandising", "customer support", "POS systems", "stock replenishment"],
  },
  hospitality: {
    titles: ["front desk agent", "hotel receptionist", "guest relations specialist", "restaurant supervisor", "hospitality associate"],
    keywords: ["guest service", "reservations", "front desk", "customer service", "check-in", "check-out", "booking coordination"],
    strongTerms: ["guest relations", "reservations", "front desk", "check-in", "check-out", "booking", "service quality", "complaint handling"],
    toolTerms: ["reservation system", "pos", "excel"],
    methodologyTerms: ["guest service", "reservation handling", "front desk operations"],
    responsibilityTerms: ["booking coordination", "guest communication", "service follow-up", "front desk support"],
    businessContextTerms: ["guest", "reservation", "front desk", "service", "booking", "check-in", "check-out"],
    suggestedKeywords: ["guest relations", "reservation handling", "front desk operations", "check-in/check-out", "service quality", "booking coordination"],
  },
  manufacturing: {
    titles: ["production operator", "production specialist", "manufacturing technician", "production supervisor", "plant operator"],
    keywords: ["production", "manufacturing", "quality control", "machine operation", "process checks", "safety", "maintenance support"],
    strongTerms: ["production line", "quality checks", "machine operation", "safety compliance", "preventive maintenance", "inspection", "process monitoring"],
    toolTerms: ["erp", "excel"],
    methodologyTerms: ["quality control", "process checks", "safety compliance", "preventive maintenance"],
    responsibilityTerms: ["machine monitoring", "inspection", "quality documentation", "production reporting"],
    businessContextTerms: ["production", "manufacturing", "machine", "quality", "inspection", "safety", "line", "process"],
    suggestedKeywords: ["production line support", "quality checks", "machine operation", "inspection", "safety compliance", "process monitoring"],
  },
  ecommerce: {
    titles: ["ecommerce specialist", "marketplace specialist", "online sales specialist", "catalog specialist"],
    keywords: ["ecommerce", "marketplace", "product listings", "catalog management", "order management", "pricing updates", "online merchandising"],
    strongTerms: ["product listings", "catalog management", "marketplace", "order processing", "pricing updates", "inventory sync", "shopify", "amazon", "trendyol"],
    toolTerms: ["shopify", "amazon", "excel", "google sheets"],
    methodologyTerms: ["catalog optimization", "order processing", "listing updates", "inventory sync"],
    responsibilityTerms: ["listing management", "order follow-up", "pricing updates", "catalog maintenance"],
    businessContextTerms: ["catalog", "listing", "product", "order", "marketplace", "inventory", "pricing", "ecommerce"],
    suggestedKeywords: ["catalog management", "product listings", "order processing", "pricing updates", "inventory synchronization", "marketplace operations"],
  },
  content_media: {
    titles: ["content writer", "copywriter", "communications specialist", "editor", "social media specialist"],
    keywords: ["content creation", "copywriting", "editorial", "social media", "content calendar", "communications", "publishing"],
    strongTerms: ["content calendar", "copywriting", "editing", "editorial", "social media", "publishing", "brand voice", "campaign content"],
    toolTerms: ["google docs", "meta ads", "google analytics", "canva"],
    methodologyTerms: ["content planning", "editorial review", "campaign support"],
    responsibilityTerms: ["content drafting", "editing", "posting coordination", "calendar updates"],
    businessContextTerms: ["content", "copy", "editorial", "social media", "post", "campaign", "publishing", "communications"],
    suggestedKeywords: ["content creation", "copywriting", "editing", "editorial planning", "social media content", "content calendar", "publishing"],
  },
  real_estate: {
    titles: ["real estate specialist", "property consultant", "leasing consultant", "property coordinator"],
    keywords: ["property listings", "client communication", "viewing coordination", "leasing", "documentation", "contract support"],
    strongTerms: ["property listings", "viewing coordination", "leasing support", "client follow-up", "contract documentation", "property records"],
    toolTerms: ["crm", "excel"],
    methodologyTerms: ["listing updates", "client follow-up", "property documentation"],
    responsibilityTerms: ["viewing scheduling", "listing coordination", "client communication", "document preparation"],
    businessContextTerms: ["property", "listing", "client", "lease", "viewing", "documentation", "contract"],
    suggestedKeywords: ["property listings", "viewing coordination", "leasing support", "client follow-up", "contract documentation", "property records"],
  },
  generic: {
    titles: [],
    keywords: [],
    strongTerms: ["reporting", "documentation", "coordination", "analysis", "communication", "scheduling", "records", "tracking", "support"],
    toolTerms: ["excel", "office", "google sheets", "powerpoint"],
    methodologyTerms: ["documentation", "tracking", "coordination", "reporting"],
    responsibilityTerms: ["task coordination", "record maintenance", "follow-up", "reporting support"],
    businessContextTerms: ["reporting", "documentation", "coordination", "analysis", "communication", "scheduling", "records", "tracking", "support"],
    suggestedKeywords: ["documentation", "cross-functional collaboration", "process tracking", "stakeholder communication", "task coordination", "record maintenance"],
  },
};

const HARD_FACT_TERMS = uniqueTrimmedStrings(
  Object.values(ROLE_PACKS).flatMap((p) => [...(p.strongTerms || []), ...(p.toolTerms || []), ...(p.methodologyTerms || [])])
);

const WEAK_VERB_RE = /\b(helped|helps|assisted|assists|supported|supports|worked on|contributed to|participated in|involved in|handled|tasked with|responsible for|provided support|görev aldım|destek oldum|yardımcı oldum|ilgilen(dim|di)|bulundum|çalıştım|yaptım)\b/i;
const STRONG_ACTION_RE = /\b(engineered|built|developed|designed|implemented|integrated|tested|debugged|validated|automated|configured|deployed|maintained|optimized|planned|executed|created|responded|resolved|documented|scheduled|reviewed|updated|monitored|processed|reconciled|screened|analyzed|reported|tracked|managed|delivered|verified|produced|prepared|mapped|facilitated|taught|assessed|inspected|coordinated|collaborated|communicated|organized|compiled|addressed|guided|operated|investigated|yönettim|yürüttüm|koordine ettim|hazırladım|analiz ettim|raporladım|geliştirdim|oluşturdum|uyguladım|organize ettim|planladım|tasarladım|gerçekleştirdim)\b/i;
const CERTIFICATION_RE = /\b(pmp|csm|psm|scrum master|cpa|cfa|acca|ifrs|gaap|lean six sigma|six sigma|itil|hipaa|soc2|iso27001)\b/i;
const ACRONYM_RE = /\b[A-Z]{2,}(?:\/[A-Z]{2,})?\b/;
const EN_WEAK_REWRITE_START_RE = /^(?:actively\s+)?(?:helped|assisted|supported|contributed|participated|aided)\b/i;
const EN_UNSUPPORTED_IMPACT_RE = /\b(resulting in|increased|boosted|generated revenue|reduced costs|improved retention|optimized performance|accelerated delivery)\b/i;
const ENGLISH_CORPORATE_FLUFF_RE = /\b(dynamic|robust|seamless|impactful|high-impact|comprehensive|strategic initiatives|operational excellence|best-in-class)\b/i;
const JD_CUE_RE = /\b(required|requirements|must have|preferred|experience with|knowledge of|proficient in|responsible for|responsibilities|qualification|qualifications|nice to have|should have|aranan nitelikler|gerekli|tercihen|deneyim|sorumluluklar|yetkinlikler|beklentiler)\b/i;

function getRolePackAllTerms(pack = {}) {
  return uniqueTrimmedStrings([...(pack.titles || []), ...(pack.keywords || []), ...(pack.strongTerms || []), ...(pack.toolTerms || []), ...(pack.methodologyTerms || []), ...(pack.responsibilityTerms || [])]);
}

function inferSeniority(text = "") {
  const s = normalizeCompareText(text);
  if (/\b(chief|vp|vice president|director|head of|general manager)\b/i.test(s)) return "leadership";
  if (/\b(principal|staff engineer|lead|manager|team lead|supervisor)\b/i.test(s)) return "manager_or_lead";
  if (/\b(senior|sr\.?|kidemli|uzman)\b/i.test(s)) return "senior";
  if (/\b(intern|stajyer|junior|jr\.?|assistant|associate|trainee|entry level)\b/i.test(s)) return "junior";
  return "mid";
}

function getSkillsLines(cv = "") {
  const lines = getNonEmptyLines(cv);
  const out = [];
  let inSkills = false;
  for (const line of lines) {
    if (/(SKILLS|TECHNICAL SKILLS|COMPETENCIES|YETKİNLİKLER|YETENEKLER|BECERİLER)/i.test(line)) {
      inSkills = true;
      continue;
    }
    if (inSkills && isSectionHeader(line)) break;
    if (inSkills) out.push(line.replace(/^[-•·‣▪▫◦]\s+/, "").trim());
  }
  return out.filter(Boolean);
}

function inferRoleProfile(cv = "", jd = "") {
  const combined = `${cv || ""}\n${jd || ""}`;
  const titleText = `${extractHeaderBlock(cv).join(" ")} ${extractExperienceTitles(cv).join(" ")}`.trim();
  const summaryText = extractSummaryLines(cv).join(" ");
  const skillsText = getSkillsLines(cv).join(" ");
  const bulletsText = getBulletLines(cv).join(" ");

  const scored = Object.entries(ROLE_PACKS)
    .filter(([key]) => key !== "generic")
    .map(([key, pack]) => {
      const titleHits = countTermHits(titleText, pack.titles || []);
      const keywordHits = countTermHits(combined, pack.keywords || []);
      const strongHits = countTermHits(combined, pack.strongTerms || []);
      const toolHits = countTermHits(combined, pack.toolTerms || []);
      const methodHits = countTermHits(combined, pack.methodologyTerms || []);
      const summaryHits = countTermHits(summaryText, pack.keywords || []) + countTermHits(summaryText, pack.strongTerms || []);
      const skillHits = countTermHits(skillsText, pack.toolTerms || []) + countTermHits(skillsText, pack.strongTerms || []);
      const bulletHits = countTermHits(bulletsText, pack.responsibilityTerms || []) + countTermHits(bulletsText, pack.businessContextTerms || []);
      const score = titleHits * 8 + skillHits * 5 + strongHits * 4 + toolHits * 4 + keywordHits * 3 + methodHits * 3 + summaryHits * 3 + bulletHits * 2;
      return { key, score, titleHits, strongHits, toolHits, skillHits };
    })
    .filter((x) => x.score > 0)
    .sort((a, b) => b.score - a.score);

  const roleGroups = scored.length ? [scored[0].key] : ["generic"];
  if (scored[1] && (scored[1].score >= scored[0].score - 5 || scored[1].toolHits >= 2 || scored[1].strongHits >= 2)) roleGroups.push(scored[1].key);

  const selectedPacks = roleGroups.map((k) => ROLE_PACKS[k]).filter(Boolean);
  const combinedNorm = canonicalizeTerm(combined);
  const domainSignals = uniqueTrimmedStrings(
    selectedPacks.flatMap((pack) => [...(pack.strongTerms || []), ...(pack.toolTerms || []), ...(pack.methodologyTerms || []), ...(pack.responsibilityTerms || [])])
  ).filter((term) => containsCanonicalTermInNormalizedText(combinedNorm, term)).slice(0, 16);

  return {
    roleGroups,
    primaryRole: roleGroups[0] || "generic",
    secondaryRoles: roleGroups.slice(1),
    seniority: inferSeniority(`${titleText}\n${combined}`),
    focusAreas: [],
    domainSignals,
    scoredRoles: scored.slice(0, 6),
  };
}

function ensureRoleProfile(roleInput, cv = "", jd = "") {
  if (roleInput && typeof roleInput === "object" && Array.isArray(roleInput.roleGroups)) return roleInput;
  const roleGroups = Array.isArray(roleInput) && roleInput.length ? roleInput : inferRoleProfile(cv, jd).roleGroups;
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

function getRolePacks(roleInput = []) {
  const profile = ensureRoleProfile(roleInput);
  const packs = (profile.roleGroups || ["generic"]).map((k) => ROLE_PACKS[k]).filter(Boolean);
  return packs.length ? packs : [ROLE_PACKS.generic];
}

function getSuggestedKeywords(roleInput = [], cv = "") {
  const profile = ensureRoleProfile(roleInput, cv, "");
  const primaryPack = ROLE_PACKS[profile.primaryRole] || ROLE_PACKS.generic;
  const seniority = profile.seniority || "mid";
  let out = uniqueTrimmedStrings([...(primaryPack.suggestedKeywords || []), ...(primaryPack.methodologyTerms || []), ...(primaryPack.responsibilityTerms || []), ...(primaryPack.strongTerms || [])]);
  if (seniority === "manager_or_lead" || seniority === "leadership") out = uniqueTrimmedStrings(["stakeholder communication", "cross-functional collaboration", "process improvement", "risk tracking", ...out]);
  if (seniority === "junior") out = uniqueTrimmedStrings([...out, "documentation", "process adherence", "task coordination", "record maintenance"]);
  return out.slice(0, 24);
}

function buildRoleContextText(roleInput = [], cv = "", jd = "") {
  const profile = ensureRoleProfile(roleInput, cv, jd);
  return [
    `- primary_role: ${profile.primaryRole}`,
    `- secondary_roles: ${(profile.secondaryRoles || []).join(", ") || "(none)"}`,
    `- seniority_signal: ${profile.seniority || "mid"}`,
    `- detected_role_signals: ${(profile.domainSignals || []).join(", ") || "(none)"}`,
    `- likely_ats_themes: ${getSuggestedKeywords(profile, cv).slice(0, 12).join(", ") || "(none)"}`,
  ].join("\n");
}

function buildRoleWritingBlock(roleInput = []) {
  const packs = getRolePacks(roleInput);
  const verbs = uniqueTrimmedStrings(packs.flatMap((p) => [...(p.responsibilityTerms || []), ...(p.suggestedKeywords || [])])).slice(0, 12);
  return `ROLE WRITING RULES:\n- Preserve role-native terminology.\n- Preserve supported tools, methods, and domain context.\n- Keep already-specific bullets specific.\n- Prefer clarity, scope, and process context over generic business fluff.\n- Relevant role terms: ${verbs.join(", ") || "(none)"}`;
}

function buildEnglishStyleBlock(roleInput = []) {
  return `
ENGLISH WRITING STYLE:
- Write like a strong US resume, not marketing copy.
- Keep bullets concise, concrete, and natural.
- Prefer 9-18 words per bullet when possible.
- Do NOT convert technical or domain-specific work into vague business wording.
- Do NOT add unsupported results, metrics, or leadership.
- Do NOT turn one weak verb into another weak verb.
- Avoid corporate fluff.
${buildRoleWritingBlock(roleInput)}
`.trim();
}

function getSentenceSignalProfile(sentence = "", roleInput = []) {
  const s = String(sentence || "").trim();
  const profile = ensureRoleProfile(roleInput);
  const packs = getRolePacks(profile);
  if (!s) return { isWeakCandidate: false, weakScore: 0, strongScore: 0, hasSpecific: false, startsWeak: false, hasWeakPhrase: false };

  const roleTerms = uniqueTrimmedStrings(packs.flatMap((p) => [...(p.strongTerms || []), ...(p.toolTerms || []), ...(p.methodologyTerms || []), ...(p.responsibilityTerms || [])]));
  const businessTerms = uniqueTrimmedStrings(packs.flatMap((p) => p.businessContextTerms || []));
  const explicitFacts = HARD_FACT_TERMS.filter((term) => containsCanonicalTermInNormalizedText(canonicalizeTerm(s), term));
  const roleSpecificHits = countTermHits(s, roleTerms);
  const businessHits = countTermHits(s, businessTerms);
  const hasNumber = /\b\d+(?:[.,]\d+)?%?\b/.test(s);
  const hasAcronym = ACRONYM_RE.test(s);
  const strongAction = STRONG_ACTION_RE.test(s);
  const startsWeak = /^(helped|helps|assisted|assists|supported|supports|worked on|contributed to|participated in|involved in|handled|tasked with|responsible for|yardımcı oldum|destek oldum|görev aldım|ilgilen(dim|di)|bulundum|çalıştım|yaptım)\b/i.test(s);
  const hasWeakPhrase = WEAK_VERB_RE.test(s);
  const hasScopeSignal = /\b(using|with|for|across|through|via|by|on|under|according to|per|kullanarak|ile|için|kapsamında|üzerinde|aracılığıyla)\b/i.test(s);

  let strongScore = 0;
  let weakScore = 0;

  if (strongAction) strongScore += 3;
  if (hasNumber) strongScore += 2;
  if (explicitFacts.length) strongScore += Math.min(3, explicitFacts.length);
  if (roleSpecificHits) strongScore += Math.min(4, roleSpecificHits);
  if (businessHits) strongScore += Math.min(2, businessHits);
  if (hasScopeSignal) strongScore += 1;
  if (countWords(s) >= 6 && countWords(s) <= 22) strongScore += 1;

  if (startsWeak) weakScore += 4;
  if (hasWeakPhrase) weakScore += 3;
  if (!strongAction) weakScore += 1;
  if (countWords(s) <= 5) weakScore += 3;
  else if (countWords(s) <= 8 && !explicitFacts.length && roleSpecificHits <= 1) weakScore += 2;
  if (/^(experienced|results[- ]driven|motivated|detail[- ]oriented|hardworking|dedicated|dynamic|responsible|organized|deneyimli|sonuç odaklı|detay odaklı|çalışkan)\b/i.test(s)) weakScore += 3;
  if (/\b(duties included|responsible for|tasked with|görevlerim arasında|sorumlu olduğum)\b/i.test(s)) weakScore += 2;
  if (/\b(daily tasks?|routine communication|team support|internal service updates|service tracking|customer service tasks?)\b/i.test(s) && !explicitFacts.length) weakScore += 2;

  const hasSpecific = hasNumber || explicitFacts.length > 0 || roleSpecificHits > 1 || (businessHits >= 2 && strongAction) || (hasAcronym && countWords(s) <= 18);
  const protectedSentence =
    strongAction &&
    (explicitFacts.length > 0 || roleSpecificHits >= 2 || businessHits >= 2) &&
    countWords(s) >= 6;

  if (protectedSentence) weakScore -= 5;
  if (hasSpecific && strongAction) weakScore -= 3;

  const isWeakCandidate =
    !protectedSentence &&
    ((weakScore >= 7 && strongScore <= 5) || (weakScore >= 6 && strongScore <= 4 && !hasSpecific) || (startsWeak && strongScore < 6 && roleSpecificHits <= 1));

  return { isWeakCandidate, weakScore, strongScore, hasSpecific, startsWeak, hasWeakPhrase, strongAction, wordCount: countWords(s) };
}

function isProtectedSpecificSentence(sentence = "", roleInput = []) {
  const p = getSentenceSignalProfile(sentence, roleInput);
  const norm = canonicalizeTerm(sentence);
  const explicitFacts = HARD_FACT_TERMS.filter((term) => containsCanonicalTermInNormalizedText(norm, term));
  return p.strongAction && p.hasSpecific && (explicitFacts.length > 0 || p.strongScore >= 6);
}

function filterWeakSentences(items = [], { outLang = "", roleInput = [] } = {}) {
  return (Array.isArray(items) ? items : [])
    .map((x) => ({ sentence: String(x?.sentence || "").trim(), rewrite: String(x?.rewrite || "").trim() }))
    .filter((x) => x.sentence && x.rewrite)
    .filter((x) => canonicalizeTerm(x.sentence) !== canonicalizeTerm(x.rewrite))
    .map((x) => ({ ...x, sourceProfile: getSentenceSignalProfile(x.sentence, roleInput), rewriteProfile: getSentenceSignalProfile(x.rewrite, roleInput) }))
    .filter((x) => !isProtectedSpecificSentence(x.sentence, roleInput))
    .filter((x) => x.sourceProfile.isWeakCandidate || x.sourceProfile.weakScore >= 6)
    .filter((x) => jaccardSimilarity(x.sentence, x.rewrite) < 0.9)
    .filter((x) => x.rewriteProfile.strongScore > x.sourceProfile.strongScore || x.rewriteProfile.weakScore < x.sourceProfile.weakScore)
    .filter((x) => {
      if (outLang !== "English") return true;
      if (EN_WEAK_REWRITE_START_RE.test(x.rewrite)) return false;
      if (EN_UNSUPPORTED_IMPACT_RE.test(x.rewrite) && !EN_UNSUPPORTED_IMPACT_RE.test(x.sentence)) return false;
      if (ENGLISH_CORPORATE_FLUFF_RE.test(x.rewrite) && !ENGLISH_CORPORATE_FLUFF_RE.test(x.sentence)) return false;
      return true;
    })
    .sort((a, b) => (b.sourceProfile.weakScore - a.sourceProfile.weakScore) || (a.sourceProfile.strongScore - b.sourceProfile.strongScore))
    .slice(0, 12)
    .map(({ sentence, rewrite }) => ({ sentence, rewrite }));
}

function detectWeakSentenceCandidates(cv = "", roleInput = {}, hasJD = false) {
  const minDesired = hasJD ? 5 : 6;
  const maxDesired = hasJD ? 10 : 12;
  const all = [
    ...getBulletLines(cv).map((sentence) => ({ sentence, sourceType: "bullet" })),
    ...extractSummaryLines(cv).map((sentence) => ({ sentence, sourceType: "summary" })),
  ]
    .map((item) => ({ ...item, profile: getSentenceSignalProfile(item.sentence, roleInput) }))
    .filter((x) => !isProtectedSpecificSentence(x.sentence, roleInput))
    .filter((x) => x.profile.isWeakCandidate || x.profile.weakScore >= 6)
    .sort((a, b) => (b.profile.weakScore - a.profile.weakScore) || (a.profile.strongScore - b.profile.strongScore));

  const out = [];
  const seen = new Set();
  for (const item of all) {
    const key = canonicalizeTerm(item.sentence);
    if (!key || seen.has(key)) continue;
    seen.add(key);
    out.push(item.sentence);
    if (out.length >= maxDesired) break;
  }

  if (out.length >= minDesired) return out;
  return out;
}

function buildLocalWeakRewrite(sentence = "", roleInput = [], outLang = "English") {
  if (outLang !== "English") return "";
  const source = String(sentence || "").trim();
  if (!source || isProtectedSpecificSentence(source, roleInput)) return "";

  const replacements = [
    [/^supported daily communication with customers regarding (.+)$/i, "Coordinated daily customer communication regarding $1"],
    [/^supported routine communication between (.+)$/i, "Coordinated routine communication between $1"],
    [/^supported daily customer service tasks with the team$/i, "Coordinated daily customer service tasks with team members"],
    [/^assisted with customer requests and internal service updates$/i, "Coordinated customer requests and internal service updates"],
    [/^prepared weekly support summaries for the team$/i, "Prepared weekly support summaries for internal team review"],
  ];

  for (const [re, to] of replacements) {
    if (re.test(source)) return source.replace(re, to);
  }

  const lead = /ticket|case|issue|escalat|follow-?up|status/i.test(source)
    ? "Coordinated"
    : /records?|documentation|logs?|notes?/i.test(source)
    ? "Maintained"
    : /reports?|summary|dashboard/i.test(source)
    ? "Prepared"
    : /schedule|calendar|meeting|travel|communication/i.test(source)
    ? "Coordinated"
    : /invoice|order|request|processing|account updates?/i.test(source)
    ? "Processed"
    : /analysis|reconciliation|audit|review|validation/i.test(source)
    ? "Reviewed"
    : "Coordinated";

  let remainder = source
    .replace(/^(supported|supports|assisted with|assisted|helped with|helped|worked on|responsible for|participated in|contributed to|provided support for|handled)\s+/i, "")
    .replace(/\bwith the team\b/i, "with team members")
    .replace(/\bfor the team\b/i, "for internal team review")
    .replace(/\brelated to\b/i, "regarding")
    .trim();

  if (!remainder || remainder === source) return "";
  const rewrite = `${lead} ${remainder.charAt(0).toLowerCase()}${remainder.slice(1)}`.trim();
  if (EN_WEAK_REWRITE_START_RE.test(rewrite)) return "";
  return rewrite;
}

function buildLocalWeakSentenceSet(candidates = [], roleInput = [], outLang = "English", maxCount = 12) {
  const raw = [];
  for (const sentence of Array.isArray(candidates) ? candidates : []) {
    const rewrite = buildLocalWeakRewrite(sentence, roleInput, outLang);
    if (!rewrite) continue;
    raw.push({ sentence, rewrite });
    if (raw.length >= maxCount) break;
  }
  return filterWeakSentences(raw, { outLang, roleInput }).slice(0, maxCount);
}

function mergeWeakSentenceSets(primary = [], secondary = [], roleInput = {}, outLang = "English", maxCount = 12) {
  const seen = new Set();
  const out = [];
  for (const item of [...(Array.isArray(primary) ? primary : []), ...(Array.isArray(secondary) ? secondary : [])]) {
    const sentence = String(item?.sentence || "").trim();
    const rewrite = String(item?.rewrite || "").trim();
    if (!sentence || !rewrite || isProtectedSpecificSentence(sentence, roleInput)) continue;
    const key = canonicalizeTerm(sentence);
    if (!key || seen.has(key)) continue;
    seen.add(key);
    const filtered = filterWeakSentences([{ sentence, rewrite }], { outLang, roleInput });
    if (filtered.length) out.push(filtered[0]);
    if (out.length >= maxCount) break;
  }
  return out;
}

function buildLocalBulletUpgradeFallback(weakSentences = []) {
  return (Array.isArray(weakSentences) ? weakSentences : [])
    .map((item) => ({
      source: String(item?.sentence || "").trim(),
      rewrite: String(item?.rewrite || "").trim(),
      reason: "Stronger action, clearer scope, and sharper ATS phrasing.",
    }))
    .filter((x) => x.source && x.rewrite)
    .slice(0, 8);
}

function applyBulletUpgradesToText(text = "", bulletUpgrades = []) {
  const sourceMap = new Map();
  for (const item of Array.isArray(bulletUpgrades) ? bulletUpgrades : []) {
    const source = String(item?.source || "").trim();
    const rewrite = String(item?.rewrite || "").trim();
    if (source && rewrite) sourceMap.set(canonicalizeTerm(source), rewrite);
  }
  if (!sourceMap.size) return String(text || "").trim();
  const lines = String(text || "").replace(/\r/g, "").split("\n");
  return lines
    .map((line) => {
      const bulletMatch = line.match(/^(\s*[-•·‣▪▫◦]\s+)(.*)$/);
      if (bulletMatch) {
        const prefix = bulletMatch[1];
        const content = String(bulletMatch[2] || "").trim();
        const rewrite = sourceMap.get(canonicalizeTerm(content));
        return rewrite ? `${prefix}${rewrite}` : line;
      }
      return line;
    })
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function applyBulletUpgradesToCv(originalCv = "", optimizedCv = "", bulletUpgrades = []) {
  const base = String(optimizedCv || originalCv || "").trim();
  if (!base || !Array.isArray(bulletUpgrades) || !bulletUpgrades.length) return base;
  return forceSafeResume(originalCv, applyBulletUpgradesToText(base, bulletUpgrades));
}

function cleanKeywordCandidate(term = "") {
  return String(term || "").replace(/\r/g, " ").replace(/^[-•·‣▪▫◦0-9.)\s]+/, "").replace(/\s+/g, " ").replace(/^[,;:]+|[,;:]+$/g, "").trim();
}

function isLowValueKeyword(term = "") {
  const cleaned = cleanKeywordCandidate(term);
  const norm = canonicalizeTerm(cleaned);
  return !cleaned || /^(experience|knowledge|skills|skill|management|analysis|support|reporting|communication|documentation|tecrube|deneyim|beceri|yetenek|analiz|destek|raporlama)$/i.test(norm);
}

function looksLikeCertification(term = "") {
  return CERTIFICATION_RE.test(String(term || "").trim());
}

function looksLikeAcronym(term = "") {
  const raw = String(term || "").trim();
  return ACRONYM_RE.test(raw) || /^[A-Z0-9/+.-]{2,14}$/.test(raw);
}

function finalizeMissingKeywords(rawKeywords = [], { cv = "", jd = "", roleInput = [], hasJD = false, limit = 12 } = {}) {
  const profile = ensureRoleProfile(roleInput, cv, jd);
  const cvNorm = canonicalizeTerm(cv);
  const fromModel = uniqueTrimmedStrings((Array.isArray(rawKeywords) ? rawKeywords : []).map(cleanKeywordCandidate).filter(Boolean));
  const rolePool = uniqueTrimmedStrings([...getSuggestedKeywords(profile, cv), ...getRolePacks(profile).flatMap((p) => [...(p.strongTerms || []), ...(p.methodologyTerms || []), ...(p.responsibilityTerms || [])])]);
  const jdPool = hasJD ? uniqueTrimmedStrings([...fromModel, ...extractSkillLikeNgrams(jd)]) : rolePool;
  const scored = uniqueTrimmedStrings(jdPool)
    .map((term) => {
      let score = 0;
      const norm = canonicalizeTerm(term);
      if (!norm || isLowValueKeyword(term)) score -= 20;
      if (!containsCanonicalTermInNormalizedText(cvNorm, norm)) score += 7;
      if (hasJD && containsCanonicalTermInNormalizedText(canonicalizeTerm(jd), norm)) score += 8;
      if (looksLikeCertification(term)) score += 3;
      if (looksLikeAcronym(term)) score += 2;
      if (HARD_FACT_TERMS.some((x) => canonicalizeTerm(x) === norm)) score += 4;
      if (countWords(term) >= 2 && countWords(term) <= 4) score += 2;
      return { term, score };
    })
    .filter((x) => x.score > 0)
    .sort((a, b) => b.score - a.score);
  return scored.map((x) => x.term).slice(0, limit);
}

function extractSkillLikeNgrams(text = "") {
  const clauses = String(text || "").replace(/\r/g, "\n").split(/[\n;•]/).map((x) => x.trim()).filter(Boolean).slice(0, 120);
  const out = [];
  for (const clause of clauses) {
    const tokens = clause.replace(/[^\p{L}\p{N}\s/#&+.-]/gu, " ").split(/\s+/).map((x) => x.trim()).filter(Boolean);
    for (let n = 4; n >= 1; n--) {
      for (let i = 0; i <= tokens.length - n; i++) {
        const phrase = tokens.slice(i, i + n).join(" ").trim();
        const norm = canonicalizeTerm(phrase);
        if (!norm || countWords(phrase) > 4 || isLowValueKeyword(phrase)) continue;
        const hasCue = HARD_FACT_TERMS.some((term) => containsCanonicalTermInNormalizedText(norm, term)) || JD_CUE_RE.test(clause) || looksLikeAcronym(phrase) || looksLikeCertification(phrase);
        if (hasCue) out.push(phrase);
      }
    }
  }
  return uniqueTrimmedStrings(out).slice(0, 80);
}

function getSectionPresenceScore(cv = "") {
  const text = getNonEmptyLines(cv).join("\n");
  let score = 0;
  if (/(PROFESSIONAL SUMMARY|SUMMARY|PROFILE|PROFESYONEL ÖZET|ÖZET|PROFİL)/i.test(text)) score += 5;
  if (/(EXPERIENCE|WORK EXPERIENCE|PROFESSIONAL EXPERIENCE|DENEYİM|İŞ DENEYİMİ)/i.test(text)) score += 7;
  if (/(SKILLS|TECHNICAL SKILLS|COMPETENCIES|YETKİNLİKLER|YETENEKLER|BECERİLER)/i.test(text)) score += 4;
  if (/(EDUCATION|EĞİTİM)/i.test(text)) score += 4;
  if (/(LANGUAGES|DİLLER|BİLDİĞİ DİLLER)/i.test(text)) score += 2;
  if (/(CERTIFICATIONS|LICENSES|SERTİFİKALAR)/i.test(text)) score += 2;
  if (/(PROJECTS|PROJELER)/i.test(text)) score += 1;
  return Math.min(25, score);
}

function getKeywordBreadthScore(cv = "", jd = "", roleInput = []) {
  const profile = ensureRoleProfile(roleInput, cv, jd);
  const textNorm = canonicalizeTerm(cv);
  const skills = uniqueTrimmedStrings(getSkillsLines(cv));
  const roleTerms = uniqueTrimmedStrings(getRolePacks(profile).flatMap((p) => [...(p.strongTerms || []), ...(p.toolTerms || []), ...(p.methodologyTerms || []), ...(p.responsibilityTerms || [])]));
  let score = 0;
  score += Math.min(8, skills.length);
  score += Math.min(4, HARD_FACT_TERMS.filter((term) => containsCanonicalTermInNormalizedText(textNorm, term)).length);
  score += Math.min(5, roleTerms.filter((term) => containsCanonicalTermInNormalizedText(textNorm, term)).length);
  score += Math.min(2, countTermHits(`${extractHeaderBlock(cv).join(" ")} ${extractExperienceTitles(cv).join(" ")}`, getRolePacks(profile).flatMap((p) => p.titles || [])));
  return Math.min(15, score);
}

function getReadabilityScore(cv = "") {
  const bullets = getBulletLines(cv);
  const lines = getNonEmptyLines(cv);
  let score = 0;
  if (extractHeaderBlock(cv).length >= 3) score += 3;
  if (lines.length >= 12) score += 3;
  if (bullets.length >= 4) score += 6;
  const avgBulletWords = bullets.length ? bullets.reduce((sum, b) => sum + countWords(b), 0) / bullets.length : 0;
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
    let value = 4 + p.strongScore * 1.6 - p.weakScore * 1.1 + (p.hasSpecific ? 1.5 : 0) + (isProtectedSpecificSentence(bullet, roleInput) ? 1.5 : 0);
    sum += Math.max(0, Math.min(12, value));
  }
  const avg = sum / bullets.length;
  return Math.max(0, Math.min(40, Math.round((avg / 12) * 40)));
}

function getJdAlignmentScore(cv = "", jd = "", roleInput = []) {
  if (!jd || !String(jd).trim()) return 0;
  const cvText = canonicalizeTerm(cv);
  const terms = uniqueTrimmedStrings(extractSkillLikeNgrams(jd)).slice(0, 24);
  if (!terms.length) return 0;
  let total = 0;
  let hits = 0;
  for (const term of terms) {
    const w = looksLikeCertification(term) || HARD_FACT_TERMS.some((x) => canonicalizeTerm(x) === canonicalizeTerm(term)) ? 1.3 : 1;
    total += w;
    if (containsCanonicalTermInNormalizedText(cvText, term)) hits += w;
  }
  return Math.max(0, Math.min(10, Math.round((hits / total) * 10)));
}

function computeDeterministicAtsScore(cv = "", jd = "", roleInput = []) {
  const hasJD = !!String(jd || "").trim();
  const profile = ensureRoleProfile(roleInput, cv, jd);
  const sectionScore = getSectionPresenceScore(cv);
  const bulletScore = getBulletStrengthScore(cv, profile);
  const readabilityScore = getReadabilityScore(cv);
  const keywordScore = getKeywordBreadthScore(cv, jd, profile);
  const jdScore = getJdAlignmentScore(cv, jd, profile);
  const roleBonus = Math.min(6, 2 + Math.min(4, (profile.domainSignals || []).length / 2));

  let total = 0;
  if (hasJD) {
    total = Math.round((sectionScore / 25) * 20) + Math.round((bulletScore / 40) * 35) + Math.round((readabilityScore / 20) * 20) + Math.round((keywordScore / 15) * 15) + jdScore + roleBonus;
  } else {
    total = Math.round((sectionScore / 25) * 25) + Math.round((bulletScore / 40) * 40) + Math.round((readabilityScore / 20) * 20) + Math.round((keywordScore / 15) * 15) + roleBonus;
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
    return clampScore(role_alignment * 0.28 + bullet_strength * 0.28 + jd_keyword_match * 0.18 + section_completeness * 0.16 + ats_safe_formatting * 0.1);
  }
  const section_completeness = clampScore(componentScores?.section_completeness);
  const clarity_readability = clampScore(componentScores?.clarity_readability);
  const bullet_strength = clampScore(componentScores?.bullet_strength);
  const ats_safe_formatting = clampScore(componentScores?.ats_safe_formatting);
  const core_keyword_coverage = clampScore(componentScores?.core_keyword_coverage);
  return clampScore(section_completeness * 0.22 + clarity_readability * 0.24 + bullet_strength * 0.32 + ats_safe_formatting * 0.14 + core_keyword_coverage * 0.08);
}

function computeFinalOptimizedScore(originalCv = "", optimizedCv = "", originalScore = 0, jd = "") {
  const base = clampScore(originalScore);
  if (!originalCv || !optimizedCv) return base;
  if (!optimizedCv.trim() || canonicalizeTerm(originalCv) === canonicalizeTerm(optimizedCv)) return base;
  const roleProfile = inferRoleProfile(originalCv, jd);
  const rescoredOptimized = computeDeterministicAtsScore(optimizedCv, jd, roleProfile);
  const rawLift = Math.max(0, rescoredOptimized - base);
  const weakBefore = getBulletLines(originalCv).filter((b) => getSentenceSignalProfile(b, roleProfile).isWeakCandidate).length;
  const weakAfter = getBulletLines(optimizedCv).filter((b) => getSentenceSignalProfile(b, roleProfile).isWeakCandidate).length;
  const weakGain = Math.max(0, weakBefore - weakAfter);
  const { same, total } = countUnchangedBullets(originalCv, optimizedCv);
  const rewriteRatio = total > 0 ? 1 - same / total : 0;
  let lift = rawLift * 0.48 + Math.min(5, weakGain) * 1.0;
  if (rewriteRatio >= 0.7) lift += 3;
  else if (rewriteRatio >= 0.5) lift += 2;
  else if (rewriteRatio >= 0.3) lift += 1;
  if (!(rawLift > 0 || weakGain > 0 || rewriteRatio >= 0.2)) return base;
  lift = Math.round(lift);
  const cap = base < 40 ? 19 : base < 55 ? 16 : base < 70 ? 14 : base < 80 ? 10 : 6;
  lift = Math.max(3, Math.min(cap, lift));
  return clampScore(base + lift);
}

function shouldRepairOptimizedCv(originalCv = "", optimizedCv = "", jd = "", outLang = "", weakSentences = [], roleInput = []) {
  const roleProfile = ensureRoleProfile(roleInput, originalCv, jd);
  const hasJD = !!String(jd || "").trim();
  if (!optimizedCv || !optimizedCv.trim()) return true;
  if (canonicalizeTerm(originalCv) === canonicalizeTerm(optimizedCv)) return true;

  const { same, total } = countUnchangedBullets(originalCv, optimizedCv);
  if (total > 0 && same / total >= (hasJD ? 0.45 : 0.36)) return true;
  if (getBulletLines(optimizedCv).length < Math.max(2, Math.floor(total * 0.7))) return true;

  const weakBefore = getBulletLines(originalCv).filter((b) => getSentenceSignalProfile(b, roleProfile).isWeakCandidate).length;
  const weakAfter = getBulletLines(optimizedCv).filter((b) => getSentenceSignalProfile(b, roleProfile).isWeakCandidate).length;
  if (weakBefore > 0 && weakAfter >= weakBefore) return true;

  if (countPersistingWeakSources(optimizedCv, weakSentences) >= (hasJD ? 2 : 1)) return true;
  if (outLang === "English" && getBulletLines(optimizedCv).filter((b) => ENGLISH_CORPORATE_FLUFF_RE.test(b)).length >= 2) return true;
  if (findUnsupportedTerms(originalCv, jd, optimizedCv).length > 0) return true;

  return false;
}

function countPersistingWeakSources(optimizedCv = "", weakSentences = []) {
  const lines = getNonEmptyLines(optimizedCv).map(canonicalizeTerm);
  let hits = 0;
  for (const item of Array.isArray(weakSentences) ? weakSentences : []) {
    const source = canonicalizeTerm(String(item?.sentence || ""));
    if (source && lines.some((line) => line === source)) hits += 1;
  }
  return hits;
}

function findUnsupportedTerms(originalCv = "", jd = "", optimizedCv = "") {
  const allowed = new Set(uniqueTrimmedStrings([...HARD_FACT_TERMS.filter((term) => containsCanonicalTermInNormalizedText(canonicalizeTerm(originalCv), term)), ...HARD_FACT_TERMS.filter((term) => containsCanonicalTermInNormalizedText(canonicalizeTerm(jd), term))]).map(canonicalizeTerm));
  return uniqueTrimmedStrings(HARD_FACT_TERMS.filter((term) => containsCanonicalTermInNormalizedText(canonicalizeTerm(optimizedCv), term))).filter((term) => !allowed.has(canonicalizeTerm(term)));
}

function buildAtsSystem(outLang) {
  return `
CRITICAL RULES:
- Do NOT invent any numbers, percentages, dates, budgets, KPIs, results, tools, platforms, ownership, or business impact.
- Only use facts explicitly present in the resume and optional job description.
- Preserve domain-native terminology for each role family.
- Weak sentence detection must be conservative: accuracy over quantity.
- Do NOT flag already-specific bullets as weak.
- If weak_sentences are requested in full ATS analysis, aim for a realistic 5-6 minimum only when those truly exist, with a hard cap of 10-12.
- Avoid shallow synonym swaps.
- Keep optimized_cv ATS-friendly, realistic, and recruiter-ready.
- Return ONLY valid JSON.
- All output VALUES MUST be written ONLY in ${outLang}.
`.trim();
}

function buildLinkedInSystem(outLang) {
  return `
CRITICAL RULES:
- Do NOT invent any numbers, metrics, achievements, dates, or employers.
- Use only facts explicitly present in the resume and optional JD.
- Return ONLY valid JSON.
- All output VALUES MUST be written ONLY in ${outLang}.
`.trim();
}

function buildPreviewAtsPrompt({ cv, jd, hasJD, outLang, roleProfile }) {
  const englishStyleBlock = outLang === "English" ? buildEnglishStyleBlock(roleProfile) : "";
  const roleContextText = buildRoleContextText(roleProfile, cv, jd);
  if (hasJD) {
    return `
Return JSON:
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

RULES:
- Job-specific ATS match.
- missing_keywords: 5-7 genuine gaps from the JD.
- weak_sentences: up to 2 items only, and only if clearly weak.
- Do NOT force weak sentences.
- Summary: 4-6 bullet lines in ${outLang}.
- No optimized_cv.

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
Return JSON:
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

RULES:
- General ATS review.
- missing_keywords: 5-7 role-relevant recruiter/ATS terms.
- weak_sentences: up to 2 items only, and only if clearly weak.
- Accuracy matters more than quantity.
- Summary: 4-6 bullet lines in ${outLang}.
- No optimized_cv.

ROLE CONTEXT:
${roleContextText}

${englishStyleBlock}

RESUME:
${cv}
`.trim();
}

function buildFullAtsAnalysisPrompt({ cv, jd, hasJD, outLang, roleProfile }) {
  const englishStyleBlock = outLang === "English" ? buildEnglishStyleBlock(roleProfile) : "";
  const roleContextText = buildRoleContextText(roleProfile, cv, jd);
  if (hasJD) {
    return `
Return JSON:
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

RULES:
- Job-specific ATS match.
- missing_keywords: 12-20 genuine JD gaps.
- weak_sentences: usually 5-10 if they truly exist. Never pad with good bullets. Hard cap 10-12.
- Keep all rewrites grounded and truthful.
- Summary: 8-12 bullet lines in ${outLang}.
- No optimized_cv.

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
Return JSON:
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

RULES:
- General ATS review.
- missing_keywords: 10-18 role-relevant ATS/recruiter terms.
- weak_sentences: usually 6-10 if they truly exist. Minimum target 5-6 only when genuine. Hard cap 10-12.
- Never pad with already-good bullets.
- Summary: 8-12 bullet lines in ${outLang}.
- No optimized_cv.

ROLE CONTEXT:
${roleContextText}

${englishStyleBlock}

RESUME:
${cv}
`.trim();
}

function buildTargetedBulletUpgradePrompt({ cv, jd, hasJD, weakSentences, outLang, roleProfile }) {
  const englishStyleBlock = outLang === "English" ? buildEnglishStyleBlock(roleProfile) : "";
  const roleContextText = buildRoleContextText(roleProfile, cv, jd);
  const weakText = (Array.isArray(weakSentences) ? weakSentences : []).map((item, idx) => `${idx + 1}. ${String(item?.sentence || "").trim()}`).filter(Boolean).join("\n");
  return `
Return JSON:
{
  "bullet_upgrades": [
    { "source": string, "rewrite": string, "reason": string }
  ]
}

RULES:
- Rewrite ONLY the listed weak sentences.
- Keep each rewrite truthful, ATS-friendly, and role-native.
- Do NOT invent numbers, ownership, tools, or business impact.
- Each rewrite must be materially stronger than the source.
- Output values only in ${outLang}.
- Return 3-8 items.

ROLE CONTEXT:
${roleContextText}

${englishStyleBlock}

WEAK SOURCE SENTENCES:
${weakText || "(none)"}

RESUME:
${cv}

${hasJD ? `JOB DESCRIPTION:\n${jd}` : ""}
`.trim();
}

function buildOptimizeCvPrompt({ cv, jd, hasJD, summary, missingKeywords, bulletUpgrades, outLang, roleProfile }) {
  const englishStyleBlock = outLang === "English" ? buildEnglishStyleBlock(roleProfile) : "";
  const roleContextText = buildRoleContextText(roleProfile, cv, jd);
  const priorityRewriteText = (Array.isArray(bulletUpgrades) ? bulletUpgrades : []).map((item, idx) => `${idx + 1}. source: ${item.source}\n   stronger rewrite target: ${item.rewrite}`).join("\n\n") || "(none)";
  const keywordsText = Array.isArray(missingKeywords) ? missingKeywords.join(", ") : "";
  return `
Return JSON:
{
  "optimized_cv": string
}

RULES:
- Keep header identity block exactly as written.
- Keep existing experience titles, dates, employers, degrees, certifications, and explicit durations unchanged.
- Do NOT invent numbers, tools, platforms, metrics, ownership, or outcomes.
- Preserve already-strong bullets.
- Focus rewrite effort on weaker/support-heavy bullets.
- Do NOT merge bullets if detail is lost.
- Use canonical headings only.
- Make the final resume materially stronger, ATS-friendly, concise, grounded, and recruiter-ready.

ROLE CONTEXT:
${roleContextText}

PRIORITY REWRITE TARGETS:
${priorityRewriteText}

ANALYSIS SUMMARY:
${summary || "(none)"}

HIGH PRIORITY KEYWORD GAPS (context only, do not force):
${keywordsText || "(none)"}

${englishStyleBlock}

RESUME:
${cv}

${hasJD ? `JOB DESCRIPTION:\n${jd}` : ""}
`.trim();
}

function buildRepairPrompt({ cv, jd, hasJD, currentOptimizedCv, summary, missingKeywords, bulletUpgrades, unsupportedTerms = [], outLang, roleProfile }) {
  const englishStyleBlock = outLang === "English" ? buildEnglishStyleBlock(roleProfile) : "";
  const roleContextText = buildRoleContextText(roleProfile, cv, jd);
  const priorityRewriteText = (Array.isArray(bulletUpgrades) ? bulletUpgrades : []).map((item, idx) => `${idx + 1}. source: ${item.source}\n   stronger rewrite target: ${item.rewrite}`).join("\n\n") || "(none)";
  const keywordsText = Array.isArray(missingKeywords) ? missingKeywords.join(", ") : "";
  return `
Return JSON:
{
  "optimized_cv": string
}

RULES:
- Keep header identity block exactly as written.
- Keep titles, dates, employers, degrees, certifications, and explicit durations unchanged.
- Remove unsupported terms if present: ${(unsupportedTerms || []).join(", ") || "(none)"}.
- Do NOT invent metrics, tools, ownership, or business impact.
- Preserve already-strong bullets.
- Repair weak generic bullets and awkward phrasing.
- Keep the resume truthful, role-native, ATS-friendly, and premium.

ROLE CONTEXT:
${roleContextText}

PRIORITY REWRITE TARGETS:
${priorityRewriteText}

ANALYSIS SUMMARY:
${summary || "(none)"}

HIGH PRIORITY KEYWORD GAPS (context only, do not force):
${keywordsText || "(none)"}

${englishStyleBlock}

ORIGINAL RESUME:
${cv}

CURRENT OPTIMIZED CV:
${currentOptimizedCv}

${hasJD ? `JOB DESCRIPTION:\n${jd}` : ""}
`.trim();
}

function buildWeakRewriteFallbackPrompt({ cv, jd, hasJD, candidates, outLang, roleProfile }) {
  const englishStyleBlock = outLang === "English" ? buildEnglishStyleBlock(roleProfile) : "";
  const roleContextText = buildRoleContextText(roleProfile, cv, jd);
  const candidateText = (Array.isArray(candidates) ? candidates : []).map((x, i) => `${i + 1}. ${x}`).join("\n");
  return `
Return JSON:
{
  "weak_sentences": [
    { "sentence": string, "rewrite": string }
  ]
}

RULES:
- Rewrite ONLY the listed weak candidates.
- Keep all facts truthful.
- Do NOT invent metrics, tools, outcomes, ownership, platforms, or business impact.
- Preserve role-native wording.
- Return 5-10 items when possible.

ROLE CONTEXT:
${roleContextText}

${englishStyleBlock}

WEAK CANDIDATES:
${candidateText}

RESUME:
${cv}

${hasJD ? `JOB DESCRIPTION:\n${jd}` : ""}
`.trim();
}

function buildLinkedInPreviewPrompt({ cv, jd, outLang, liTargetRole, liSeniority, liIndustry, liLocation, liTone }) {
  return `
Return JSON:
{
  "headlines": [{"label": string, "text": string}],
  "about": { "short": string },
  "experience_fix": [{"before": string, "after": string, "why": string}],
  "skills": { "top": string[] },
  "recruiter": { "keywords": string[] }
}

RULES:
- headlines: exactly 1 item.
- about.short: 600-900 chars.
- experience_fix: up to 1 item.
- skills.top: 7-10 items.
- recruiter.keywords: 5-8 items.
- Output only in ${outLang}.

TARGETING META:
- target_role: ${liTargetRole || "(not provided)"}
- seniority: ${liSeniority}
- industry: ${liIndustry || "(not provided)"}
- location: ${liLocation || "(not provided)"}
- tone: ${liTone}

RESUME:
${cv}

TARGET ROLE / JOB:
${jd || "(none)"}
`.trim();
}

function buildLinkedInFullPrompt({ cv, jd, outLang, liTargetRole, liSeniority, liIndustry, liLocation, liTone }) {
  return `
Return JSON:
{
  "headlines": [{"label": string, "text": string}],
  "about": { "short": string, "normal": string, "bold": string },
  "experience_fix": [{"before": string, "after": string, "why": string}],
  "skills": { "top": string[], "tools": string[], "industry": string[] },
  "recruiter": { "keywords": string[], "boolean": string }
}

RULES:
- headlines: exactly 5 items with labels Search, Impact, Niche, Leadership, Clean.
- about.short: 500-800 chars.
- about.normal: 900-1400 chars.
- about.bold: 900-1400 chars.
- experience_fix: 4-6 items maximum.
- skills.top: 12-18
- skills.tools: 8-16
- skills.industry: 12-20
- recruiter.keywords: 10-20
- Output only in ${outLang}.

TARGETING META:
- target_role: ${liTargetRole || "(not provided)"}
- seniority: ${liSeniority}
- industry: ${liIndustry || "(not provided)"}
- location: ${liLocation || "(not provided)"}
- tone: ${liTone}

RESUME:
${cv}

TARGET ROLE / JOB:
${jd || "(none)"}
`.trim();
}

function clampScore(n) {
  const x = Number(n);
  if (!Number.isFinite(x)) return 0;
  return Math.max(0, Math.min(100, Math.round(x)));
}

function isGpt5Model(model = "") {
  return /^gpt-5/i.test(String(model).trim());
}

function buildOpenAIPayload({ model, messages, reasoningEffort = null, temperature = null, maxCompletionTokens = 1800 }) {
  const body = { model, response_format: { type: "json_object" }, messages };
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
    return content.map((part) => (typeof part === "string" ? part : typeof part?.text === "string" ? part.text : typeof part?.content === "string" ? part.content : "")).join("").trim();
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

function buildAttempts({ model, isPreview, passType, maxCompletionTokens }) {
  if (!isGpt5Model(model)) return [{ reasoningEffort: null, temperature: isPreview ? 0.2 : 0.25, maxCompletionTokens }];
  if (passType === "optimize") return [{ reasoningEffort: "medium", temperature: null, maxCompletionTokens: Math.max(maxCompletionTokens, 3200) }, { reasoningEffort: "low", temperature: null, maxCompletionTokens: Math.max(maxCompletionTokens, 4200) }];
  if (passType === "repair") return [{ reasoningEffort: "low", temperature: null, maxCompletionTokens: Math.max(maxCompletionTokens, 3600) }, { reasoningEffort: "none", temperature: 0.2, maxCompletionTokens: Math.max(maxCompletionTokens, 4200) }];
  if (passType === "bullet") return [{ reasoningEffort: "low", temperature: null, maxCompletionTokens: Math.max(maxCompletionTokens, 1600) }, { reasoningEffort: "none", temperature: 0.2, maxCompletionTokens: Math.max(maxCompletionTokens, 2200) }];
  if (isPreview) return [{ reasoningEffort: "none", temperature: 0.2, maxCompletionTokens: Math.max(maxCompletionTokens, 1100) }];
  return [{ reasoningEffort: "low", temperature: null, maxCompletionTokens: Math.max(maxCompletionTokens, 1800) }, { reasoningEffort: "none", temperature: 0.2, maxCompletionTokens: Math.max(maxCompletionTokens, 2400) }];
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
      const text = extractAssistantText(parsed);
      if (!text || !text.trim()) throw new Error("Model returned empty content");

      const data = safeJsonParse(text);
      if (data && typeof data === "object" && !Array.isArray(data) && Object.keys(data).length === 0) {
        throw new Error("Model returned empty JSON object");
      }

      return data;
    } catch (err) {
      lastError = err?.name === "AbortError" ? Object.assign(new Error("OpenAI request timed out"), { status: 504, details: "The upstream request exceeded the timeout window." }) : err;
      if (lastError?.status && lastError.status >= 400 && lastError.status < 500 && lastError.status !== 429) throw lastError;
    }
  }

  const err = new Error(lastError?.message || "Model did not return usable JSON");
  err.status = lastError?.status || 500;
  err.details = lastError?.details || String(lastError || "Unknown error");
  throw err;
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
  const expected = crypto.createHmac("sha256", appSecret).update(data).digest("base64url");
  if (sig !== expected) return false;

  try {
    const payload = JSON.parse(Buffer.from(data, "base64url").toString("utf8"));
    return !!(payload?.exp && Date.now() <= payload.exp);
  } catch {
    return false;
  }
}

async function ensureMinDelay(startedAt, minMs) {
  const elapsed = Date.now() - startedAt;
  const remain = minMs - elapsed;
  if (remain > 0) await new Promise((resolve) => setTimeout(resolve, remain));
}

export default async function handler(req, res) {
  const startedAt = Date.now();

  try {
    if (req.method !== "POST") return res.status(405).json({ error: "POST required" });

    const { cv, jd, preview, lang, mode, linkedin_meta } = req.body || {};
    const reqMode = typeof mode === "string" && mode.trim() ? mode.trim().toLowerCase() : "ats";

    const sessionOk = verifySession(req);
    const requestedPreview = !!preview;
    const isPreview = requestedPreview || !sessionOk;

    const ip = getClientIp(req);
    const limiter = isPreview ? rlPreview : rlFull;
    const { success, reset } = await limiter.limit(ip);

    if (!success) {
      const retrySec = Math.max(1, Math.ceil((reset - Date.now()) / 1000));
      return res.status(429).json({ error: "Too many requests", retry_after_seconds: retrySec });
    }

    if (!cv) return res.status(400).json({ error: "cv is required" });

    const apiKey = process.env.OPENAI_API_KEY;
    if (!apiKey) return res.status(500).json({ error: "OPENAI_API_KEY is missing on Vercel" });

    const model = process.env.OPENAI_MODEL || "gpt-4o-mini";
    const langCode = typeof lang === "string" && lang.trim() ? lang.trim().toLowerCase() : "en";
    const outLang = LANG_MAP[langCode] || "English";
    const hasJD = typeof jd === "string" && jd.trim().length > 0;
    const roleProfile = inferRoleProfile(cv, jd);

    if (reqMode === "linkedin") {
      const liMeta = linkedin_meta && typeof linkedin_meta === "object" ? linkedin_meta : {};
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
            ? buildLinkedInPreviewPrompt({ cv, jd, outLang, liTargetRole, liSeniority, liIndustry, liLocation, liTone })
            : buildLinkedInFullPrompt({ cv, jd, outLang, liTargetRole, liSeniority, liIndustry, liLocation, liTone }),
          isPreview,
          passType: "main",
          maxCompletionTokens: isPreview ? 1100 : 2200,
        });
      } catch (err) {
        return res.status(err?.status || 500).json({ error: err?.message || "OpenAI error", status: err?.status || 500, details: err?.details || String(err) });
      }

      const out = {
        headlines: Array.isArray(data?.headlines) ? data.headlines : [],
        about: data?.about && typeof data.about === "object" ? data.about : {},
        experience_fix: Array.isArray(data?.experience_fix) ? data.experience_fix : [],
        skills: data?.skills && typeof data.skills === "object" ? data.skills : {},
        recruiter: data?.recruiter && typeof data.recruiter === "object" ? data.recruiter : {},
      };

      if (isPreview) {
        return res.status(200).json({
          headlines: out.headlines.slice(0, 1),
          about: { short: String(out.about.short || "") },
          experience_fix: out.experience_fix.slice(0, 1),
          skills: { top: Array.isArray(out.skills.top) ? out.skills.top.slice(0, 10) : [] },
          recruiter: { keywords: Array.isArray(out.recruiter.keywords) ? out.recruiter.keywords.slice(0, 8) : [] },
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
          userPrompt: buildPreviewAtsPrompt({ cv, jd, hasJD, outLang, roleProfile }),
          isPreview: true,
          passType: "main",
          maxCompletionTokens: 1100,
        });
      } catch (err) {
        return res.status(err?.status || 500).json({ error: err?.message || "OpenAI error", status: err?.status || 500, details: err?.details || String(err) });
      }

      const componentScores = previewData?.component_scores && typeof previewData.component_scores === "object" ? previewData.component_scores : {};
      const deterministicScore = computeDeterministicAtsScore(cv, jd, roleProfile);
      const modelComponentScore = computeComponentScore(componentScores, hasJD);
      const mergedPreviewScore = clampScore(Math.round(deterministicScore * 0.82 + modelComponentScore * 0.18));

      let previewWeakSentences = filterWeakSentences(Array.isArray(previewData?.weak_sentences) ? previewData.weak_sentences : [], { outLang, roleInput: roleProfile });
      const detectedPreviewWeakCandidates = detectWeakSentenceCandidates(cv, roleProfile, hasJD);

      if (previewWeakSentences.length < Math.min(2, detectedPreviewWeakCandidates.length)) {
        const localPreviewWeak = buildLocalWeakSentenceSet(detectedPreviewWeakCandidates.slice(0, 4), roleProfile, outLang, 4);
        previewWeakSentences = mergeWeakSentenceSets(previewWeakSentences, localPreviewWeak, roleProfile, outLang, 4);
      }

      const normalized = {
        ats_score: mergedPreviewScore,
        component_scores: componentScores,
        missing_keywords: finalizeMissingKeywords(Array.isArray(previewData?.missing_keywords) ? previewData.missing_keywords : [], { cv, jd, roleInput: roleProfile, hasJD, limit: 7 }),
        weak_sentences: previewWeakSentences,
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
        userPrompt: buildFullAtsAnalysisPrompt({ cv, jd, hasJD, outLang, roleProfile }),
        isPreview: false,
        passType: "main",
        maxCompletionTokens: 1800,
      });
    } catch (err) {
      return res.status(err?.status || 500).json({ error: err?.message || "OpenAI error", status: err?.status || 500, details: err?.details || String(err) });
    }

    let modelWeakSentences = filterWeakSentences(Array.isArray(analysisData?.weak_sentences) ? analysisData.weak_sentences : [], { outLang, roleInput: roleProfile });
    const detectedWeakCandidates = detectWeakSentenceCandidates(cv, roleProfile, hasJD);
    const desiredWeakCount = Math.min(hasJD ? 10 : 12, Math.max(hasJD ? 5 : 6, detectedWeakCandidates.length || 0));

    if (modelWeakSentences.length < desiredWeakCount && detectedWeakCandidates.length > 0) {
      const localWeakSentences = buildLocalWeakSentenceSet(detectedWeakCandidates, roleProfile, outLang, 12);
      modelWeakSentences = mergeWeakSentenceSets(modelWeakSentences, localWeakSentences, roleProfile, outLang, 12);
    }

    const componentScores = analysisData?.component_scores && typeof analysisData.component_scores === "object" ? analysisData.component_scores : {};
    const deterministicScore = computeDeterministicAtsScore(cv, jd, roleProfile);
    const modelComponentScore = computeComponentScore(componentScores, hasJD);
    const mergedBaseScore = clampScore(Math.round(deterministicScore * 0.82 + modelComponentScore * 0.18));

    const normalized = {
      ats_score: mergedBaseScore,
      component_scores: componentScores,
      missing_keywords: finalizeMissingKeywords(Array.isArray(analysisData?.missing_keywords) ? analysisData.missing_keywords : [], { cv, jd, roleInput: roleProfile, hasJD, limit: hasJD ? 20 : 18 }),
      weak_sentences: modelWeakSentences.slice(0, 12),
      summary: typeof analysisData?.summary === "string" ? analysisData.summary : "",
      optimized_cv: "",
      optimized_ats_score: mergedBaseScore,
    };

    let bulletUpgrades = buildLocalBulletUpgradeFallback(normalized.weak_sentences);

    try {
      if (normalized.weak_sentences.length > 0) {
        const bulletData = await callOpenAIJson({
          apiKey,
          model,
          system: buildAtsSystem(outLang),
          userPrompt: buildTargetedBulletUpgradePrompt({ cv, jd, hasJD, weakSentences: normalized.weak_sentences, outLang, roleProfile }),
          isPreview: false,
          passType: "bullet",
          maxCompletionTokens: 1600,
        });

        const rawUpgrades = Array.isArray(bulletData?.bullet_upgrades) ? bulletData.bullet_upgrades : [];
        const filtered = rawUpgrades
          .map((item) => ({ source: String(item?.source || "").trim(), rewrite: String(item?.rewrite || "").trim(), reason: String(item?.reason || "").trim() }))
          .filter((x) => x.source && x.rewrite)
          .filter((x) => !isProtectedSpecificSentence(x.source, roleProfile))
          .filter((x) => canonicalizeTerm(x.source) !== canonicalizeTerm(x.rewrite))
          .filter((x) => jaccardSimilarity(x.source, x.rewrite) < 0.9);
        if (filtered.length) bulletUpgrades = filtered.slice(0, 8);
      }
    } catch {
      // keep local upgrades
    }

    let currentOptimized = "";
    let unsupportedTerms = [];

    try {
      const optimizeData = await callOpenAIJson({
        apiKey,
        model,
        system: buildAtsSystem(outLang),
        userPrompt: buildOptimizeCvPrompt({ cv, jd, hasJD, summary: normalized.summary, missingKeywords: normalized.missing_keywords, bulletUpgrades, outLang, roleProfile }),
        isPreview: false,
        passType: "optimize",
        maxCompletionTokens: 3400,
      });

      if (typeof optimizeData?.optimized_cv === "string" && optimizeData.optimized_cv.trim()) {
        currentOptimized = forceSafeResume(cv, optimizeData.optimized_cv.trim());
        if (bulletUpgrades.length) currentOptimized = applyBulletUpgradesToCv(cv, currentOptimized, bulletUpgrades);
        unsupportedTerms = findUnsupportedTerms(cv, jd, currentOptimized);
      }
    } catch {
      currentOptimized = "";
      unsupportedTerms = [];
    }

    if (!currentOptimized) {
      currentOptimized = bulletUpgrades.length ? applyBulletUpgradesToCv(cv, cv, bulletUpgrades) : forceSafeResume(cv, cv);
      unsupportedTerms = findUnsupportedTerms(cv, jd, currentOptimized);
    }

    if (shouldRepairOptimizedCv(cv, currentOptimized, jd, outLang, normalized.weak_sentences, roleProfile) || unsupportedTerms.length > 0) {
      try {
        const repaired = await callOpenAIJson({
          apiKey,
          model,
          system: buildAtsSystem(outLang),
          userPrompt: buildRepairPrompt({ cv, jd, hasJD, currentOptimizedCv: currentOptimized || cv, summary: normalized.summary, missingKeywords: normalized.missing_keywords, bulletUpgrades, unsupportedTerms, outLang, roleProfile }),
          isPreview: false,
          passType: "repair",
          maxCompletionTokens: 3600,
        });

        if (typeof repaired?.optimized_cv === "string" && repaired.optimized_cv.trim()) {
          currentOptimized = forceSafeResume(cv, repaired.optimized_cv.trim());
          if (bulletUpgrades.length) currentOptimized = applyBulletUpgradesToCv(cv, currentOptimized, bulletUpgrades);
        }
      } catch {
        // keep current optimized version
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
    return res.status(500).json({ error: "Server error", details: err?.message || String(err) });
  }
}
