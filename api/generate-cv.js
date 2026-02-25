import fs from "node:fs/promises";
import path from "node:path";
import chromium from "@sparticuz/chromium";
import puppeteer from "puppeteer-core";

function escHtml(str = "") {
  return String(str)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function buildLinksInline(links = []) {
  if (!links.length) return "";
  return " • " + links.map(l => `${escHtml(l.label)}: ${escHtml(l.url)}`).join(" • ");
}
function buildLinksBlocks(links = []) {
  return (links || [])
    .map(l => `<div class="muted">${escHtml(l.label)}: ${escHtml(l.url)}</div>`)
    .join("");
}
function buildListItems(items = []) {
  return (items || []).map(x => `<li>${escHtml(x)}</li>`).join("");
}
function buildSkillsList(skills = []) {
  return (skills || [])
    .map(s => `<li>${escHtml(s.name)} (${escHtml(s.level)})</li>`)
    .join("");
}
function buildSkillsChips(skills = []) {
  return (skills || [])
    .map(s => `<span class="chip">${escHtml(s.name)} - ${escHtml(s.level)}</span>`)
    .join("");
}
function buildExperienceBlocks(exps = []) {
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
function buildProjectBlocks(projects = []) {
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
function buildEducationBlocks(edu = []) {
  return (edu || []).map(ed => `
    <div class="item">
      <strong>${escHtml(ed.degree)} — ${escHtml(ed.school)}</strong>
      <span class="muted">${escHtml(ed.start)} - ${escHtml(ed.end)}</span>
    </div>
  `).join("");
}

function renderTemplate(html, data) {
  const safe = (v) => escHtml(v ?? "");
  return html
    .replaceAll("{{fullName}}", safe(data.basics.fullName))
    .replaceAll("{{title}}", safe(data.basics.title))
    .replaceAll("{{location}}", safe(data.basics.location))
    .replaceAll("{{phone}}", safe(data.basics.phone))
    .replaceAll("{{email}}", safe(data.basics.email))
    .replaceAll("{{summary}}", safe(data.summary))
    .replaceAll("{{accent}}", safe(data.meta?.accent || "#2B6CB0"))
    .replaceAll("{{linksInline}}", buildLinksInline(data.basics.links))
    .replaceAll("{{linksBlocks}}", buildLinksBlocks(data.basics.links))
    .replaceAll("{{skillsList}}", buildSkillsList(data.skills))
    .replaceAll("{{skillsChips}}", buildSkillsChips(data.skills))
    .replaceAll("{{experienceBlocks}}", buildExperienceBlocks(data.experience))
    .replaceAll("{{projectBlocks}}", buildProjectBlocks(data.projects))
    .replaceAll("{{educationBlocks}}", buildEducationBlocks(data.education))
    .replaceAll("{{certList}}", buildListItems(data.certificates))
    .replaceAll("{{langList}}", (data.languages || []).map(l => `<li>${escHtml(l.name)} (${escHtml(l.level)})</li>`).join(""))
    .replaceAll("{{photoDisplay}}", data.meta?.includePhoto ? "block" : "none")
    .replaceAll("{{photoUrl}}", data.basics.photoUrl ? data.basics.photoUrl : "");
}

export default async function handler(req, res) {
  try {
    const mode = (req.query.mode || "design").toLowerCase(); // design | ats
    const templateName = mode === "ats" ? "ats" : "modern";

    const cvPath = path.join(process.cwd(), "scripts", "cvData.json");
    const cvRaw = await fs.readFile(cvPath, "utf8");
    const cvData = JSON.parse(cvRaw);

    const tplPath = path.join(process.cwd(), "templates", `${templateName}.html`);
    const tplRaw = await fs.readFile(tplPath, "utf8");

    const html = renderTemplate(tplRaw, cvData);

    const executablePath = await chromium.executablePath();

    const browser = await puppeteer.launch({
      args: chromium.args,
      defaultViewport: chromium.defaultViewport,
      executablePath,
      headless: chromium.headless
    });

    const page = await browser.newPage();
    await page.setContent(html, { waitUntil: "networkidle0" });

    const pdf = await page.pdf({
      format: "A4",
      printBackground: true,
      margin: mode === "ats"
        ? { top: "18mm", right: "18mm", bottom: "18mm", left: "18mm" }
        : { top: "0mm", right: "0mm", bottom: "0mm", left: "0mm" }
    });

    await browser.close();

    res.setHeader("Content-Type", "application/pdf");
    res.setHeader("Content-Disposition", `inline; filename="cv-${mode}.pdf"`);
    res.status(200).send(pdf);
  } catch (err) {
    res.status(500).json({ error: "PDF üretilemedi", details: String(err) });
  }
}
