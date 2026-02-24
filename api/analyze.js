module.exports = async (req, res) => {
  try {
    if (req.method !== "POST") {
      res.statusCode = 405;
      return res.json({ error: "Method not allowed" });
    }

    const apiKey = process.env.OPENAI_API_KEY;
    if (!apiKey) {
      res.statusCode = 500;
      return res.json({ error: "Missing OPENAI_API_KEY on server" });
    }

    const { resume, job } = req.body || {};
    if (!resume || !job) {
      res.statusCode = 400;
      return res.json({ error: "Missing resume or job" });
    }

    const system = "You are an ATS and recruiter resume evaluator. Return STRICT JSON only (no markdown).";
    const user = `
Resume text:
${resume}

Job description:
${job}

Return JSON with this exact shape:
{
  "ats_score": number (0-100),
  "missing_keywords": string[] (max 12),
  "weak_phrases": string[] (max 8),
  "optimized_resume": string
}

Rules:
- ats_score must be realistic and consistent with your findings.
- missing_keywords should be phrases from the job description that are absent or weakly represented in the resume.
- weak_phrases should quote or paraphrase weak parts from the resume, short and actionable.
- optimized_resume should be a clean, professional resume text (no tables), keeping truthful claims only.
`;

    const model = process.env.OPENAI_MODEL || "gpt-4o-mini";

    const resp = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${apiKey}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        model,
        temperature: 0.3,
        messages: [
          { role: "system", content: system },
          { role: "user", content: user }
        ],
        response_format: { type: "json_object" }
      })
    });

    const raw = await resp.json();
    if (!resp.ok) {
      res.statusCode = resp.status;
      return res.json({ error: raw?.error?.message || "OpenAI request failed", raw });
    }

    const content = raw?.choices?.[0]?.message?.content || "{}";
    let parsed;
    try {
      parsed = JSON.parse(content);
    } catch {
      res.statusCode = 500;
      return res.json({ error: "Model did not return valid JSON", content });
    }

    res.statusCode = 200;
    return res.json(parsed);
  } catch (e) {
    res.statusCode = 500;
    return res.json({ error: e.message || String(e) });
  }
};
