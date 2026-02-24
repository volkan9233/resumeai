export default async function handler(req, res) {
  try {
    if (req.method !== "POST") {
      return res.status(405).json({ error: "POST required" });
    }

    const { cv, jd, preview } = req.body || {};
    if (!cv || !jd) {
      return res.status(400).json({ error: "cv and jd are required" });
    }

    const apiKey = process.env.OPENAI_API_KEY;
    if (!apiKey) {
      return res.status(500).json({ error: "OPENAI_API_KEY is missing on Vercel" });
    }

    const model = process.env.OPENAI_MODEL || "gpt-4o-mini";
    const isPreview = !!preview;

    const system = "You are an ATS resume analyzer. Return ONLY valid JSON. No markdown.";
    const user = `
Analyze the resume vs job description and return JSON in this exact schema:

{
  "ats_score": number,                   
  "missing_keywords": string[],          
  "weak_sentences": [{"sentence": string, "rewrite": string}],  
  "optimized_cv": string,                
  "summary": string                      
}

Rules:
- ats_score is based on keyword overlap + seniority fit + impact metrics + structure.
- missing_keywords should be single words or short phrases.
- weak_sentences should come from the resume text (or close paraphrase).
- optimized_cv should be ATS-friendly, bullet-based, achievement-focused.

NOW INPUTS:

RESUME:
${cv}

JOB DESCRIPTION:
${jd}
`.trim();

    const openaiRes = await fetch("https://api.openai.com/v1/responses", {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${apiKey}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        model,
        input: [
          { role: "system", content: system },
          { role: "user", content: user }
        ],
        response_format: { type: "json_object" },
        temperature: 0.3
      })
    });

    const rawText = await openaiRes.text();
    if (!openaiRes.ok) {
      return res.status(500).json({ error: "OpenAI error", details: rawText });
    }

    const parsed = JSON.parse(rawText);

    const text =
      parsed.output_text ||
      parsed.output?.[0]?.content?.[0]?.text ||
      "";

    let data;
    try {
      data = JSON.parse(text);
    } catch {
      return res.status(500).json({
        error: "Model did not return valid JSON",
        model_output: String(text).slice(0, 2000)
      });
    }

    if (isPreview) {
      const previewData = {
        ats_score: Number.isFinite(data.ats_score) ? data.ats_score : 0,
        summary: data.summary || "",
        missing_keywords: Array.isArray(data.missing_keywords) ? data.missing_keywords.slice(0, 5) : [],
        weak_sentences: Array.isArray(data.weak_sentences) ? data.weak_sentences.slice(0, 2) : []
        // optimized_cv deliberately omitted in preview
      };
      return res.status(200).json(previewData);
    }

    return res.status(200).json(data);

  } catch (err) {
    return res.status(500).json({ error: "Server error", details: err?.message || String(err) });
  }
}
