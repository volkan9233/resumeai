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

function listItems(items = []) {
  return (items || []).map(x => `<li>${escHtml(x)}</li>`).join("");
}

function skillsList(skills = []) {
  return (skills || [])
    .map(s => `<li>${escHtml(s.name)}${s.level ? ` (${escHtml(s.level)})` : ""}</li>`)
    .join("");
}

function skillsChips(skills = []) {
  return (skills || [])
    .map(s => `<span class="chip">${escHtml(s.name)}${s.level ? ` - ${escHtml(s.level)}` : ""}</span>`)
    .join("");
}

function experienceBlocks(exps = [], t = {}) {
  const nowWord = t?.t_present || "Present";
  return (exps || []).map(e => {
    const endOrNow = e.end ? e.end : nowWord;
    const highlights = (e.highlights || []).map(h => `<li>${escHtml(h)}</li>`).join("");
    return `
      <div class="item">
        <div class="row">
          <strong>${escHtml(e.position)} — ${escHtml(e.company)}</strong>
          <span class="muted">${escHtml(e.start)} - ${escHtml(endOrNow)}</span>
        </div>
        <div class="muted">${escHtml(e.location || "")}</div>
        <ul>${highlights}</ul>
      </div>
    `;
  }).join("");
}

function projectBlocks(projects = []) {
  return (projects || []).map(p => {
    const techCsv = (p.tech || []).join(", ");
    const highlights = (p.highlights || []).map(h => `<li>${escHtml(h)}</li>`).join("");
    return `
      <div class="item">
        <strong>${escHtml(p.name)}</strong> <span class="muted">${techCsv ? `(${escHtml(techCsv)})` : ""}</span>
        <ul>${highlights}</ul>
      </div>
    `;
  }).join("");
}

function educationBlocks(edu = []) {
  return (edu || []).map(ed => `
    <div class="item">
      <strong>${escHtml(ed.degree)} — ${escHtml(ed.school)}</strong>
      <span class="muted">${escHtml(ed.start)} - ${escHtml(ed.end)}</span>
    </div>
  `).join("");
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
    .replaceAll("{{fullName}}", escHtml(cv.basics.fullName))
    .replaceAll("{{title}}", escHtml(cv.basics.title))
    .replaceAll("{{location}}", escHtml(cv.basics.location))
    .replaceAll("{{phone}}", escHtml(cv.basics.phone))
    .replaceAll("{{email}}", escHtml(cv.basics.email))
    .replaceAll("{{summary}}", escHtml(cv.summary || ""))
    .replaceAll("{{accent}}", escHtml(cv?.meta?.accent || "#2B6CB0"))
    .replaceAll("{{linksInline}}", linksInline(cv.basics.links))
    .replaceAll("{{linksBlocks}}", linksBlocks(cv.basics.links))
    .replaceAll("{{skillsList}}", skillsList(cv.skills))
    .replaceAll("{{skillsChips}}", skillsChips(cv.skills))
    .replaceAll("{{experienceBlocks}}", experienceBlocks(cv.experience, t))
    .replaceAll("{{projectBlocks}}", projectBlocks(cv.projects))
    .replaceAll("{{educationBlocks}}", educationBlocks(cv.education))
    .replaceAll("{{certList}}", listItems(cv.certificates))
    .replaceAll("{{langList}}", (cv.languages || []).map(l =>
      `<li>${escHtml(l.name)}${l.level ? ` (${escHtml(l.level)})` : ""}</li>`
    ).join(""))
    .replaceAll("{{photoDisplay}}", includePhoto ? "block" : "none")
    .replaceAll("{{photoUrl}}", includePhoto ? cv.basics.photoUrl : "");

  return tpl;
}
