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
    .map(s => `<li>${escHtml(s.name)} (${escHtml(s.level)})</li>`)
    .join("");
}

function skillsChips(skills = []) {
  return (skills || [])
    .map(s => `<span class="chip">${escHtml(s.name)} - ${escHtml(s.level)}</span>`)
    .join("");
}

function experienceBlocks(exps = []) {
  return (exps || []).map(e => {
    const endOrNow = e.end ? e.end : "Devam";
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
        <strong>${escHtml(p.name)}</strong> <span class="muted">(${escHtml(techCsv)})</span>
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

export async function renderCV({ mode }) {
  let cv = null;

try {
  const raw = localStorage.getItem("resumeai_cvdata");
  if (raw) cv = JSON.parse(raw);
} catch (e) {}

if (!cv) {
  cv = await (await fetch("./scripts/cvData.json")).json(); // fallback
}
  const tplUrl = mode === "ats" ? "./templates/ats.html" : "./templates/modern.html";
  let tpl = await (await fetch(tplUrl)).text();

  // foto kontrol (modern template için)
  const includePhoto = !!cv?.meta?.includePhoto && !!cv?.basics?.photoUrl;

  tpl = tpl
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
    .replaceAll("{{experienceBlocks}}", experienceBlocks(cv.experience))
    .replaceAll("{{projectBlocks}}", projectBlocks(cv.projects))
    .replaceAll("{{educationBlocks}}", educationBlocks(cv.education))
    .replaceAll("{{certList}}", listItems(cv.certificates))
    .replaceAll("{{langList}}", (cv.languages || []).map(l => `<li>${escHtml(l.name)} (${escHtml(l.level)})</li>`).join(""))
    .replaceAll("{{photoDisplay}}", includePhoto ? "block" : "none")
    .replaceAll("{{photoUrl}}", includePhoto ? cv.basics.photoUrl : "");

  return tpl;
}
