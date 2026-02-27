function escHtml(str = "") {
  return String(str)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function linksInline(links = []) {
  if (!links.length) return "";
  return " • " + links.map(l => `${escHtml(l.label)}: ${escHtml(l.url)}`).join(" • ");
}

function linksBlocks(links = []) {
  return (links || [])
    .map(l => `<div class="muted">${escHtml(l.label)}: ${escHtml(l.url)}</div>`)
    .join("");
}

/* =========================
   ✅ FIX: accept string OR object arrays
   - skills: ["SEO"] OR [{name:"SEO",level:""}]
   - languages/certs: ["EN"] OR [{name:"EN",level:"B2"}]
========================= */
function listItems(items = []) {
  return (items || [])
    .map(x => {
      if (typeof x === "string") return x;
      return x?.name || x?.label || x?.title || "";
    })
    .map(v => String(v || "").trim())
    .filter(Boolean)
    .map(v => `<li>${escHtml(v)}</li>`)
    .join("");
}

function skillsList(skills = []) {
  return (skills || [])
    .map(s => {
      if (typeof s === "string") return { name: s, level: "" };
      return { name: s?.name || "", level: s?.level || "" };
    })
    .map(s => ({ name: String(s.name || "").trim(), level: String(s.level || "").trim() }))
    .filter(s => s.name)
    .map(s => `<li>${escHtml(s.name)}${s.level ? ` (${escHtml(s.level)})` : ""}</li>`)
    .join("");
}

function skillsChips(skills = []) {
  return (skills || [])
    .map(s => {
      if (typeof s === "string") return { name: s, level: "" };
      return { name: s?.name || "", level: s?.level || "" };
    })
    .map(s => ({ name: String(s.name || "").trim(), level: String(s.level || "").trim() }))
    .filter(s => s.name)
    .map(s => `<span class="chip">${escHtml(s.name)}${s.level ? ` - ${escHtml(s.level)}` : ""}</span>`)
    .join("");
}

/* =========================
   ✅ FIX: experience supports BOTH formats
   - old parser: { title, company, bullets, start, end, location }
   - new:        { position, company, highlights, start, end, location }
========================= */
function experienceBlocks(exps = [], t = {}) {
  const nowWord = t?.t_present || "Present";

  return (exps || []).map(e => {
    const position = e?.position || e?.title || "";
    const company = e?.company || "";
    const start = e?.start || "";
    const endOrNow = (e?.end ? e.end : nowWord);
    const location = e?.location || "";

    const highlightsArr = Array.isArray(e?.highlights) ? e.highlights
      : Array.isArray(e?.bullets) ? e.bullets
      : [];

    const highlights = (highlightsArr || [])
      .map(h => String(h || "").trim())
      .filter(Boolean)
      .map(h => `<li>${escHtml(h)}</li>`)
      .join("");

    return `
      <div class="item">
        <div class="row">
          <strong>${escHtml(position)}${company ? ` — ${escHtml(company)}` : ""}</strong>
          <span class="muted">${escHtml(start)}${start || endOrNow ? " - " : ""}${escHtml(endOrNow)}</span>
        </div>
        ${location ? `<div class="muted">${escHtml(location)}</div>` : ``}
        <ul>${highlights}</ul>
      </div>
    `;
  }).join("");
}

/* =========================
   ✅ FIX: projects supports BOTH formats
   - old parser: { name, bullets, description }
   - new:        { name, highlights, tech }
========================= */
function projectBlocks(projects = []) {
  return (projects || []).map(p => {
    const techCsv = (p?.tech || []).join(", ");
    const highlightsArr = Array.isArray(p?.highlights) ? p.highlights
      : Array.isArray(p?.bullets) ? p.bullets
      : [];

    const highlights = (highlightsArr || [])
      .map(h => String(h || "").trim())
      .filter(Boolean)
      .map(h => `<li>${escHtml(h)}</li>`)
      .join("");

    const desc = String(p?.description || "").trim();

    return `
      <div class="item">
        <strong>${escHtml(p?.name || "")}</strong>
        <span class="muted">${techCsv ? ` (${escHtml(techCsv)})` : ""}</span>
        ${desc ? `<div class="muted" style="margin-top:1mm;">${escHtml(desc)}</div>` : ``}
        <ul>${highlights}</ul>
      </div>
    `;
  }).join("");
}

/* =========================
   ✅ FIX: education supports BOTH formats
   - parser: { school, degree, start, end }
   - old/new mixed safe
========================= */
function educationBlocks(edu = []) {
  return (edu || []).map(ed => {
    const degree = ed?.degree || "";
    const school = ed?.school || "";
    const start = ed?.start || "";
    const end = ed?.end || "";

    return `
      <div class="item">
        <strong>${escHtml(degree)}${school ? ` — ${escHtml(school)}` : ""}</strong>
        <span class="muted">${escHtml(start)}${start || end ? " - " : ""}${escHtml(end)}</span>
      </div>
    `;
  }).join("");
}

export async function renderCV({ mode, lang } = {}) {
  let cv = null;

  try {
    const raw = localStorage.getItem("resumeai_cvdata");
    if (raw) cv = JSON.parse(raw);
  } catch (e) {}

  if (!cv) {
    cv = await (await fetch("./scripts/cvData.json")).json(); // fallback
  }

  // Dil seçimi: parametre > querystring > cv.meta.lang > default
  const qs = new URLSearchParams(window.location.search);
  const targetLang =
    (lang || qs.get("lang") || cv?.meta?.lang || "en").toLowerCase();

  const dict = {
    en: {
      t_contact: "Contact",
      t_skills: "Core Skills",
      t_languages: "Languages",
      t_summary: "Summary",
      t_experience: "Experience",
      t_projects: "Projects",
      t_education: "Education",
      t_certificates: "Certifications",
      t_present: "Present",
    },
    tr: {
      t_contact: "İletişim",
      t_skills: "Yetkinlikler",
      t_languages: "Diller",
      t_summary: "Özet",
      t_experience: "İş Deneyimi",
      t_projects: "Projeler",
      t_education: "Eğitim",
      t_certificates: "Sertifikalar",
      t_present: "Devam",
    },
    es: {
      t_contact: "Contacto",
      t_skills: "Habilidades",
      t_languages: "Idiomas",
      t_summary: "Resumen",
      t_experience: "Experiencia",
      t_projects: "Proyectos",
      t_education: "Educación",
      t_certificates: "Certificaciones",
      t_present: "Actualidad",
    },
    ru: {
      t_contact: "Контакты",
      t_skills: "Навыки",
      t_languages: "Языки",
      t_summary: "Профиль",
      t_experience: "Опыт",
      t_projects: "Проекты",
      t_education: "Образование",
      t_certificates: "Сертификаты",
      t_present: "По н.в.",
    },
    fr: {
      t_contact: "Contact",
      t_skills: "Compétences",
      t_languages: "Langues",
      t_summary: "Profil",
      t_experience: "Expérience",
      t_projects: "Projets",
      t_education: "Formation",
      t_certificates: "Certifications",
      t_present: "Aujourd’hui",
    },
    ar: {
      t_contact: "معلومات التواصل",
      t_skills: "المهارات",
      t_languages: "اللغات",
      t_summary: "الملخص",
      t_experience: "الخبرة",
      t_projects: "المشاريع",
      t_education: "التعليم",
      t_certificates: "الشهادات",
      t_present: "حتى الآن",
    },
    zh: {
      t_contact: "联系方式",
      t_skills: "技能",
      t_languages: "语言",
      t_summary: "简介",
      t_experience: "工作经历",
      t_projects: "项目",
      t_education: "教育",
      t_certificates: "证书",
      t_present: "至今",
    }
  };

  const t = dict[targetLang] || dict.en;

  const tplUrl = mode === "ats" ? "./templates/ats.html" : "./templates/modern.html";
  let tpl = await (await fetch(tplUrl)).text();

  // foto kontrol (modern template için)
  const includePhoto = !!cv?.meta?.includePhoto && !!cv?.basics?.photoUrl;

  // ✅ languages support: ["English"] OR [{name:"English",level:"B2"}]
  const langListHtml = (cv.languages || [])
    .map(l => {
      if (typeof l === "string") return `<li>${escHtml(l)}</li>`;
      const name = String(l?.name || "").trim();
      const level = String(l?.level || "").trim();
      if (!name) return "";
      return `<li>${escHtml(name)}${level ? ` (${escHtml(level)})` : ""}</li>`;
    })
    .filter(Boolean)
    .join("");

  tpl = tpl
    // i18n section titles
    .replaceAll("{{t_contact}}", escHtml(t.t_contact))
    .replaceAll("{{t_skills}}", escHtml(t.t_skills))
    .replaceAll("{{t_languages}}", escHtml(t.t_languages))
    .replaceAll("{{t_summary}}", escHtml(t.t_summary))
    .replaceAll("{{t_experience}}", escHtml(t.t_experience))
    .replaceAll("{{t_projects}}", escHtml(t.t_projects))
    .replaceAll("{{t_education}}", escHtml(t.t_education))
    .replaceAll("{{t_certificates}}", escHtml(t.t_certificates))

    // core fields
    .replaceAll("{{fullName}}", escHtml(cv?.basics?.fullName || ""))
    .replaceAll("{{title}}", escHtml(cv?.basics?.title || ""))
    .replaceAll("{{location}}", escHtml(cv?.basics?.location || ""))
    .replaceAll("{{phone}}", escHtml(cv?.basics?.phone || ""))
    .replaceAll("{{email}}", escHtml(cv?.basics?.email || ""))
    .replaceAll("{{summary}}", escHtml(cv?.summary || ""))
    .replaceAll("{{accent}}", escHtml(cv?.meta?.accent || "#2B6CB0"))

    .replaceAll("{{linksInline}}", linksInline(cv?.basics?.links || []))
    .replaceAll("{{linksBlocks}}", linksBlocks(cv?.basics?.links || []))
    .replaceAll("{{skillsList}}", skillsList(cv?.skills || []))
    .replaceAll("{{skillsChips}}", skillsChips(cv?.skills || []))
    .replaceAll("{{experienceBlocks}}", experienceBlocks(cv?.experience || [], t))
    .replaceAll("{{projectBlocks}}", projectBlocks(cv?.projects || []))
    .replaceAll("{{educationBlocks}}", educationBlocks(cv?.education || []))
    .replaceAll("{{certList}}", listItems(cv?.certificates || []))
    .replaceAll("{{langList}}", langListHtml)

    .replaceAll("{{photoDisplay}}", includePhoto ? "block" : "none")
    .replaceAll("{{photoUrl}}", includePhoto ? cv.basics.photoUrl : "");

  return tpl;
}
