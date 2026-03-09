function escHtml(str = "") {
  return String(str)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function isFilled(v) {
  return !(v == null || String(v).trim() === "");
}

function cleanText(v = "") {
  return String(v || "").replace(/\r/g, "").trim();
}

function arrify(v) {
  if (Array.isArray(v)) return v;
  if (v == null) return [];
  return [v];
}

function firstFilled(...values) {
  for (const v of values) {
    if (Array.isArray(v)) {
      if (v.length) return v;
      continue;
    }
    if (v && typeof v === "object") {
      if (Object.keys(v).length) return v;
      continue;
    }
    if (isFilled(v)) return v;
  }
  return "";
}

function normalizeDash(str = "") {
  return String(str || "")
    .replace(/[–—]/g, "-")
    .replace(/\s*-\s*/g, " - ")
    .replace(/\s+/g, " ")
    .trim();
}

function normalizeSectionName(s = "") {
  return String(s)
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[^\p{L}\p{N}\s]/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function getCanonicalSectionKey(title = "") {
  const t = normalizeSectionName(title);

  if (["profesyonel ozet", "ozet", "profil", "summary", "professional summary", "profile"].includes(t)) return "summary";
  if (["deneyim", "is deneyimi", "experience", "work experience"].includes(t)) return "experience";
  if (["yetkinlikler", "yetenekler", "beceriler", "skills", "core skills"].includes(t)) return "skills";
  if (["diller", "bildigi diller", "languages"].includes(t)) return "languages";
  if (["sertifikalar", "certifications"].includes(t)) return "certifications";
  if (["projeler", "projects"].includes(t)) return "projects";
  if (["egitim", "education"].includes(t)) return "education";
  if (["ek bilgiler", "additional information"].includes(t)) return "additional";
  return "";
}

function isSectionHeaderLine(line = "") {
  return !!getCanonicalSectionKey(line);
}

function stripBullet(line = "") {
  return String(line || "").replace(/^[-•·‣▪▫◦]\s+/, "").trim();
}

function isBulletLine(line = "") {
  return /^[-•·‣▪▫◦]\s+/.test(String(line || "").trim());
}

function normalizeLinks(links = []) {
  return arrify(links)
    .map((l) => {
      if (typeof l === "string") {
        const raw = cleanText(l);
        if (!raw) return null;
        return {
          label: raw.toLowerCase().includes("linkedin") ? "LinkedIn" : "Link",
          url: raw.replace(/^linkedin:\s*/i, "").trim(),
        };
      }

      const label = cleanText(firstFilled(l?.label, l?.name, l?.title, "Link"));
      const url = cleanText(firstFilled(l?.url, l?.href, l?.value, l?.link));
      if (!url) return null;
      return { label, url };
    })
    .filter(Boolean);
}

function linksInline(links = []) {
  const normalized = normalizeLinks(links);
  if (!normalized.length) return "";
  return " • " + normalized.map((l) => `${escHtml(l.label)}: ${escHtml(l.url)}`).join(" • ");
}

function linksBlocks(links = []) {
  return normalizeLinks(links)
    .map((l) => `<div class="muted">${escHtml(l.label)}: ${escHtml(l.url)}</div>`)
    .join("");
}

function normalizeSimpleList(items = []) {
  return arrify(items)
    .map((x) => {
      if (typeof x === "string") return stripBullet(x);
      return cleanText(firstFilled(x?.name, x?.label, x?.title, x?.value));
    })
    .filter(Boolean);
}

function listItems(items = []) {
  return normalizeSimpleList(items)
    .map((v) => `<li>${escHtml(v)}</li>`)
    .join("");
}

function normalizeSkills(skills = []) {
  return arrify(skills)
    .map((s) => {
      if (typeof s === "string") {
        return { name: stripBullet(s), level: "" };
      }
      return {
        name: cleanText(firstFilled(s?.name, s?.label, s?.title, s?.value)),
        level: cleanText(firstFilled(s?.level, s?.proficiency)),
      };
    })
    .filter((s) => s.name);
}

function skillsList(skills = []) {
  return normalizeSkills(skills)
    .map((s) => `<li>${escHtml(s.name)}${s.level ? ` (${escHtml(s.level)})` : ""}</li>`)
    .join("");
}

function skillsChips(skills = []) {
  return normalizeSkills(skills)
    .map((s) => `<span class="chip">${escHtml(s.name)}${s.level ? ` - ${escHtml(s.level)}` : ""}</span>`)
    .join("");
}

function normalizeLanguages(items = []) {
  return arrify(items)
    .map((l) => {
      if (typeof l === "string") {
        const raw = stripBullet(l);
        if (!raw) return null;

        if (raw.includes(":")) {
          const [name, ...rest] = raw.split(":");
          return {
            name: cleanText(name),
            level: cleanText(rest.join(":")),
          };
        }

        if (raw.includes("(") && raw.endsWith(")")) {
          const idx = raw.lastIndexOf("(");
          return {
            name: cleanText(raw.slice(0, idx)),
            level: cleanText(raw.slice(idx + 1, -1)),
          };
        }

        return { name: raw, level: "" };
      }

      const name = cleanText(firstFilled(l?.name, l?.label, l?.title, l?.value));
      const level = cleanText(firstFilled(l?.level, l?.proficiency));
      if (!name) return null;
      return { name, level };
    })
    .filter(Boolean);
}

function normalizeDateValue(v = "") {
  return cleanText(v).replace(/[–—]/g, "-");
}

function splitDateText(detail = "", presentWord = "Present") {
  const txt = normalizeDateValue(detail);
  if (!txt) return { start: "", end: "" };

  if (txt.includes("|")) {
    const right = txt.split("|").pop().trim();
    return splitDateText(right, presentWord);
  }

  const parts = txt.split(/\s+-\s+/);
  if (parts.length >= 2) {
    return {
      start: cleanText(parts[0]),
      end: cleanText(parts.slice(1).join(" - ")),
    };
  }

  if (/\b(19|20)\d{2}\b/.test(txt)) {
    return { start: txt, end: "" };
  }

  return { start: "", end: txt || presentWord };
}

function normalizeExperience(exps = [], t = {}) {
  const nowWord = t?.t_present || "Present";

  return arrify(exps)
    .map((e) => {
      if (typeof e === "string") return null;

      const position = cleanText(firstFilled(e?.position, e?.title, e?.role));
      const company = cleanText(firstFilled(e?.company, e?.employer, e?.organization));
      const location = cleanText(e?.location);

      let start = cleanText(e?.start);
      let end = cleanText(e?.end);

      const dateText = cleanText(firstFilled(e?.date, e?.dates, e?.period, e?.detail));
      if ((!start && !end) && dateText) {
        const parsed = splitDateText(dateText, nowWord);
        start = parsed.start;
        end = parsed.end;
      }

      const rawHighlights = firstFilled(e?.highlights, e?.bullets, e?.items, []);
      const highlights = arrify(rawHighlights)
        .map((h) => stripBullet(h))
        .filter(Boolean);

      if (!position && !company && !highlights.length) return null;

      return {
        position,
        company,
        location,
        start,
        end,
        highlights,
      };
    })
    .filter(Boolean);
}

function experienceBlocks(exps = [], t = {}) {
  const nowWord = t?.t_present || "Present";

  return normalizeExperience(exps, t).map((e) => {
    const endOrNow = e.end || (e.start ? nowWord : "");
    const highlights = (e.highlights || [])
      .map((h) => `<li>${escHtml(h)}</li>`)
      .join("");

    return `
      <div class="item">
        <div class="row">
          <strong>${escHtml(e.position)}${e.company ? ` — ${escHtml(e.company)}` : ""}</strong>
          <span class="muted">${escHtml(e.start)}${e.start || endOrNow ? " - " : ""}${escHtml(endOrNow)}</span>
        </div>
        ${e.location ? `<div class="muted">${escHtml(e.location)}</div>` : ``}
        <ul>${highlights}</ul>
      </div>
    `;
  }).join("");
}

function normalizeProjects(projects = []) {
  return arrify(projects)
    .map((p) => {
      if (typeof p === "string") {
        const raw = cleanText(p);
        if (!raw) return null;
        return { name: raw, description: "", tech: [], highlights: [] };
      }

      const name = cleanText(firstFilled(p?.name, p?.title, p?.project));
      const description = cleanText(firstFilled(p?.description, p?.summary));
      const tech = normalizeSimpleList(firstFilled(p?.tech, p?.tools, []));
      const highlights = arrify(firstFilled(p?.highlights, p?.bullets, p?.items, []))
        .map((h) => stripBullet(h))
        .filter(Boolean);

      if (!name && !description && !highlights.length) return null;

      return { name, description, tech, highlights };
    })
    .filter(Boolean);
}

function projectBlocks(projects = []) {
  return normalizeProjects(projects).map((p) => {
    const techCsv = (p.tech || []).join(", ");
    const highlights = (p.highlights || [])
      .map((h) => `<li>${escHtml(h)}</li>`)
      .join("");

    return `
      <div class="item">
        <strong>${escHtml(p.name || "")}</strong>
        <span class="muted">${techCsv ? ` (${escHtml(techCsv)})` : ""}</span>
        ${p.description ? `<div class="muted" style="margin-top:1mm;">${escHtml(p.description)}</div>` : ``}
        <ul>${highlights}</ul>
      </div>
    `;
  }).join("");
}

function normalizeEducation(edu = []) {
  return arrify(edu)
    .map((ed) => {
      if (typeof ed === "string") {
        const raw = cleanText(ed);
        if (!raw) return null;
        return {
          school: raw,
          degree: "",
          start: "",
          end: "",
          detail: "",
        };
      }

      const school = cleanText(firstFilled(ed?.school, ed?.institution, ed?.university, ed?.name));
      const degree = cleanText(firstFilled(ed?.degree, ed?.title, ed?.program));
      let start = cleanText(ed?.start);
      let end = cleanText(ed?.end);
      let detail = cleanText(firstFilled(ed?.detail, ed?.subtitle, ed?.dates, ed?.period));

      if ((!start && !end) && detail) {
        const parsed = splitDateText(detail);
        if (parsed.start || parsed.end) {
          start = parsed.start;
          end = parsed.end;
          detail = detail.replace(/\|\s*(19|20)\d{2}.*$/g, "").trim();
        }
      }

      if (!school && !degree && !detail) return null;

      return { school, degree, start, end, detail };
    })
    .filter(Boolean);
}

function educationBlocks(edu = []) {
  return normalizeEducation(edu).map((ed) => {
    const titleLine =
      ed.degree && ed.school
        ? `${escHtml(ed.degree)} — ${escHtml(ed.school)}`
        : ed.degree
        ? escHtml(ed.degree)
        : escHtml(ed.school);

    const dateLine =
      ed.start || ed.end
        ? `${escHtml(ed.start)}${ed.start || ed.end ? " - " : ""}${escHtml(ed.end)}`
        : "";

    const detailLine =
      ed.detail && !(ed.start || ed.end)
        ? escHtml(ed.detail)
        : "";

    return `
      <div class="item">
        <strong>${titleLine}</strong>
        ${dateLine ? `<span class="muted">${dateLine}</span>` : ``}
        ${detailLine ? `<div class="muted">${detailLine}</div>` : ``}
      </div>
    `;
  }).join("");
}

function getRawTextFromCv(cv = {}) {
  return cleanText(
    firstFilled(
      cv?.rawText,
      cv?.resumeText,
      cv?.cvText,
      cv?.optimized_cv,
      cv?.optimizedCv,
      cv?.text,
      cv?.content,
      cv?.raw,
      cv?.sourceText,
      cv?.resume,
      cv?.cv
    )
  );
}

function parseHeaderBasics(headerLines = []) {
  const lines = headerLines.map(cleanText).filter(Boolean);

  const fullName = lines[0] || "";
  let title = "";
  let location = "";
  let phone = "";
  let email = "";
  const links = [];

  for (let i = 1; i < lines.length; i++) {
    const line = lines[i];

    if (!email && /\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/i.test(line)) {
      email = line.match(/\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/i)?.[0] || line;
      continue;
    }

    if (!phone && /(\+?\d[\d\s().-]{7,}\d)/.test(line)) {
      phone = line.match(/(\+?\d[\d\s().-]{7,}\d)/)?.[0] || line;
      continue;
    }

    if (/linkedin|github|portfolio|http|www\./i.test(line)) {
      const label =
        /linkedin/i.test(line) ? "LinkedIn" :
        /github/i.test(line) ? "GitHub" :
        /portfolio/i.test(line) ? "Portfolio" :
        "Link";

      const url = line.includes(":") ? line.split(":").slice(1).join(":").trim() : line;
      links.push({ label, url });
      continue;
    }

    if (!title) {
      title = line;
      continue;
    }

    if (!location) {
      location = line;
    }
  }

  return { fullName, title, location, phone, email, links };
}

function parseSectionsFromText(rawText = "") {
  const lines = String(rawText || "").replace(/\r/g, "").split("\n");
  const sections = {};
  const headerLines = [];
  let currentKey = "";

  for (const rawLine of lines) {
    const line = rawLine.trim();
    if (!line) {
      if (currentKey) {
        sections[currentKey].push("");
      }
      continue;
    }

    const key = getCanonicalSectionKey(line);
    if (key) {
      currentKey = key;
      if (!sections[currentKey]) sections[currentKey] = [];
      continue;
    }

    if (!currentKey) headerLines.push(line);
    else sections[currentKey].push(line);
  }

  return { headerLines, sections };
}

function splitBlocks(lines = []) {
  const blocks = [];
  let current = [];

  for (const line of lines) {
    const txt = cleanText(line);
    if (!txt) {
      if (current.length) {
        blocks.push(current);
        current = [];
      }
      continue;
    }
    current.push(txt);
  }

  if (current.length) blocks.push(current);
  return blocks;
}

function parseSimpleListSection(lines = []) {
  return lines.map(stripBullet).filter(Boolean);
}

function parseExperienceSection(lines = []) {
  const cleanLines = lines.map(cleanText);
  const items = [];
  let current = null;

  function flush() {
    if (current && (current.position || current.company || current.highlights.length)) {
      items.push(current);
    }
    current = null;
  }

  for (let i = 0; i < cleanLines.length; i++) {
    const line = cleanLines[i];
    if (!line) continue;

    const next = cleanLines[i + 1] || "";
    const lineIsBullet = isBulletLine(line);
    const nextLooksLikeDateCompany =
      /\|\s*.*((19|20)\d{2}|Günümüz|Devam|Present|Current)/i.test(next) ||
      /((19|20)\d{2}).*(Günümüz|Devam|Present|Current)/i.test(next);

    if (!lineIsBullet && nextLooksLikeDateCompany) {
      flush();

      const detail = next;
      const parts = detail.split("|");
      const company = cleanText(parts[0] || "");
      const datePart = cleanText(parts.slice(1).join("|"));
      const { start, end } = splitDateText(datePart);

      current = {
        position: line,
        company,
        start,
        end,
        location: "",
        highlights: [],
      };

      i += 1;
      continue;
    }

    if (!current) {
      current = {
        position: "",
        company: "",
        start: "",
        end: "",
        location: "",
        highlights: [],
      };
    }

    if (lineIsBullet) {
      current.highlights.push(stripBullet(line));
    } else if (!current.position && !current.company) {
      current.position = line;
    } else {
      current.highlights.push(stripBullet(line));
    }
  }

  flush();
  return items;
}

function parseProjectSection(lines = []) {
  const blocks = splitBlocks(lines);
  const items = [];

  for (const block of blocks) {
    const title = cleanText(block[0] || "");
    const rest = block.slice(1);

    const highlights = rest
      .map((x) => stripBullet(x))
      .filter(Boolean);

    if (!title) continue;
    items.push({
      name: title,
      description: "",
      tech: [],
      highlights,
    });
  }

  return items;
}

function parseEducationSection(lines = []) {
  const blocks = splitBlocks(lines);
  const items = [];

  for (const block of blocks) {
    if (!block.length) continue;

    if (block.length >= 2) {
      const first = cleanText(block[0]);
      const second = cleanText(block[1]);

      const dateInSecond = /\b(19|20)\d{2}\b/.test(second);

      if (dateInSecond) {
        const [left, ...rest] = second.split("|");
        const degree = cleanText(left);
        const { start, end } = splitDateText(rest.join("|"));

        items.push({
          school: first,
          degree,
          start,
          end,
          detail: "",
        });
        continue;
      }
    }

    items.push({
      school: cleanText(block[0] || ""),
      degree: cleanText(block[1] || ""),
      start: "",
      end: "",
      detail: "",
    });
  }

  return items;
}

function buildFallbackCvFromText(rawText = "") {
  if (!rawText) return null;

  const { headerLines, sections } = parseSectionsFromText(rawText);
  const basics = parseHeaderBasics(headerLines);

  const summaryLines = sections.summary || [];
  const summary = summaryLines.join(" ").replace(/\s+/g, " ").trim();

  const experience = parseExperienceSection(sections.experience || []);
  const projects = parseProjectSection(sections.projects || []);
  const education = parseEducationSection(sections.education || []);
  const skills = parseSimpleListSection(sections.skills || []);
  const languages = parseSimpleListSection(sections.languages || []);
  const certificates = parseSimpleListSection(sections.certifications || []);

  return {
    basics,
    summary,
    experience,
    projects,
    education,
    skills,
    languages,
    certificates,
    additional: parseSimpleListSection(sections.additional || []),
  };
}

function normalizeCvData(cv = {}) {
  const rawText = getRawTextFromCv(cv);
  const fallback = rawText ? buildFallbackCvFromText(rawText) : null;

  const basicsSource = firstFilled(cv?.basics, fallback?.basics, {});
  const basics = {
    fullName: cleanText(firstFilled(cv?.basics?.fullName, cv?.fullName, cv?.name, basicsSource?.fullName)),
    title: cleanText(firstFilled(cv?.basics?.title, cv?.title, basicsSource?.title)),
    location: cleanText(firstFilled(cv?.basics?.location, cv?.location, basicsSource?.location)),
    phone: cleanText(firstFilled(cv?.basics?.phone, cv?.phone, basicsSource?.phone)),
    email: cleanText(firstFilled(cv?.basics?.email, cv?.email, basicsSource?.email)),
    links: normalizeLinks(firstFilled(cv?.basics?.links, cv?.links, basicsSource?.links, [])),
    photoUrl: cleanText(firstFilled(cv?.basics?.photoUrl, cv?.photoUrl)),
  };

  const summary = cleanText(firstFilled(
    cv?.summary,
    cv?.profile,
    cv?.professionalSummary,
    cv?.basics?.summary,
    fallback?.summary
  ));

  const skills = normalizeSkills(firstFilled(
    cv?.skills,
    cv?.coreSkills,
    cv?.yetkinlikler,
    cv?.yetenekler,
    cv?.sections?.skills,
    cv?.sections?.yetkinlikler,
    fallback?.skills,
    []
  ));

  const languages = normalizeLanguages(firstFilled(
    cv?.languages,
    cv?.diller,
    cv?.bildigiDiller,
    cv?.sections?.languages,
    cv?.sections?.diller,
    fallback?.languages,
    []
  ));

  const certificates = normalizeSimpleList(firstFilled(
    cv?.certificates,
    cv?.certifications,
    cv?.sertifikalar,
    cv?.sections?.certifications,
    cv?.sections?.sertifikalar,
    fallback?.certificates,
    []
  ));

  const experience = normalizeExperience(firstFilled(
    cv?.experience,
    cv?.workExperience,
    cv?.sections?.experience,
    fallback?.experience,
    []
  ));

  const projects = normalizeProjects(firstFilled(
    cv?.projects,
    cv?.sections?.projects,
    fallback?.projects,
    []
  ));

  const education = normalizeEducation(firstFilled(
    cv?.education,
    cv?.sections?.education,
    fallback?.education,
    []
  ));

  const meta = {
    includePhoto: !!firstFilled(cv?.meta?.includePhoto, false),
    accent: cleanText(firstFilled(cv?.meta?.accent, "#2B6CB0")) || "#2B6CB0",
    lang: cleanText(firstFilled(cv?.meta?.lang, cv?.lang, "en")) || "en",
  };

  return {
    basics,
    summary,
    skills,
    languages,
    certificates,
    experience,
    projects,
    education,
    additional: normalizeSimpleList(firstFilled(cv?.additional, cv?.ekBilgiler, fallback?.additional, [])),
    meta,
    rawText,
  };
}

export async function renderCV({ mode, lang } = {}) {
  let cv = null;

  try {
    const raw = localStorage.getItem("resumeai_cvdata");
    if (raw) cv = JSON.parse(raw);
  } catch {}

  if (!cv) {
    cv = await (await fetch("./scripts/cvData.json")).json();
  }

  const normalized = normalizeCvData(cv);

  const qs = new URLSearchParams(window.location.search);
  const targetLang =
    (lang || qs.get("lang") || normalized?.meta?.lang || "en").toLowerCase();

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

  const includePhoto = !!normalized?.meta?.includePhoto && !!normalized?.basics?.photoUrl;

  const langListHtml = normalizeLanguages(normalized.languages || [])
    .map((l) => `<li>${escHtml(l.name)}${l.level ? ` (${escHtml(l.level)})` : ""}</li>`)
    .join("");

  tpl = tpl
    .replaceAll("{{t_contact}}", escHtml(t.t_contact))
    .replaceAll("{{t_skills}}", escHtml(t.t_skills))
    .replaceAll("{{t_languages}}", escHtml(t.t_languages))
    .replaceAll("{{t_summary}}", escHtml(t.t_summary))
    .replaceAll("{{t_experience}}", escHtml(t.t_experience))
    .replaceAll("{{t_projects}}", escHtml(t.t_projects))
    .replaceAll("{{t_education}}", escHtml(t.t_education))
    .replaceAll("{{t_certificates}}", escHtml(t.t_certificates))

    .replaceAll("{{fullName}}", escHtml(normalized?.basics?.fullName || ""))
    .replaceAll("{{title}}", escHtml(normalized?.basics?.title || ""))
    .replaceAll("{{location}}", escHtml(normalized?.basics?.location || ""))
    .replaceAll("{{phone}}", escHtml(normalized?.basics?.phone || ""))
    .replaceAll("{{email}}", escHtml(normalized?.basics?.email || ""))
    .replaceAll("{{summary}}", escHtml(normalized?.summary || ""))
    .replaceAll("{{accent}}", escHtml(normalized?.meta?.accent || "#2B6CB0"))

    .replaceAll("{{linksInline}}", linksInline(normalized?.basics?.links || []))
    .replaceAll("{{linksBlocks}}", linksBlocks(normalized?.basics?.links || []))
    .replaceAll("{{skillsList}}", skillsList(normalized?.skills || []))
    .replaceAll("{{skillsChips}}", skillsChips(normalized?.skills || []))
    .replaceAll("{{experienceBlocks}}", experienceBlocks(normalized?.experience || [], t))
    .replaceAll("{{projectBlocks}}", projectBlocks(normalized?.projects || []))
    .replaceAll("{{educationBlocks}}", educationBlocks(normalized?.education || []))
    .replaceAll("{{certList}}", listItems(normalized?.certificates || []))
    .replaceAll("{{langList}}", langListHtml)

    .replaceAll("{{photoDisplay}}", includePhoto ? "block" : "none")
    .replaceAll("{{photoUrl}}", includePhoto ? normalized.basics.photoUrl : "");

  return tpl;
}
