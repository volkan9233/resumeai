(function () {
  let timer = null;
  let startedAt = 0;
  let currentMode = "full";
  let finished = false;

  function el(id) {
    return document.getElementById(id);
  }

  function getUi() {
    return {
      wrap: el("analyzeProgressWrap"),
      label: el("analyzeProgressLabel"),
      percent: el("analyzeProgressPercent"),
      fill: el("analyzeProgressFill"),
    };
  }

  const STAGES = {
    preview: [
      { t: 0,     p: 8,  label: "Starting preview analysis..." },
      { t: 2500,  p: 22, label: "Reading resume content..." },
      { t: 7000,  p: 42, label: "Checking ATS structure..." },
      { t: 13000, p: 62, label: "Scanning keywords and weak phrases..." },
      { t: 22000, p: 82, label: "Preparing preview result..." },
      { t: 32000, p: 92, label: "Finalizing preview..." }
    ],
    full: [
      { t: 0,     p: 6,  label: "Starting full ATS analysis..." },
      { t: 3000,  p: 16, label: "Reading resume and role context..." },
      { t: 9000,  p: 31, label: "Analyzing ATS structure and formatting..." },
      { t: 18000, p: 47, label: "Evaluating keywords and recruiter signals..." },
      { t: 29000, p: 63, label: "Detecting weak bullets and rewrite opportunities..." },
      { t: 41000, p: 78, label: "Generating optimized ATS-ready resume..." },
      { t: 56000, p: 90, label: "Final quality check and output formatting..." }
    ]
  };

  function setVisible(show) {
    const ui = getUi();
    if (!ui.wrap) return;
    ui.wrap.hidden = !show;
  }

  function setProgress(percent, label) {
    const ui = getUi();
    if (!ui.wrap || !ui.label || !ui.percent || !ui.fill) return;

    const p = Math.max(0, Math.min(100, Math.round(percent)));
    ui.label.textContent = label || "Starting analysis...";
    ui.percent.textContent = p + "%";
    ui.fill.style.width = p + "%";
  }

  function tick() {
    if (finished) return;

    const elapsed = Date.now() - startedAt;
    const stages = STAGES[currentMode] || STAGES.full;

    let active = stages[0];
    for (const s of stages) {
      if (elapsed >= s.t) active = s;
      else break;
    }

    let targetPercent = active.p;
    let targetLabel = active.label;

    const last = stages[stages.length - 1];
    if (elapsed > last.t) {
      const extra = Math.min(5, Math.floor((elapsed - last.t) / 4000));
      targetPercent = Math.min(95, last.p + extra);
      targetLabel = last.label;
    }

    setProgress(targetPercent, targetLabel);
  }

  function stopTimer() {
    if (timer) {
      clearInterval(timer);
      timer = null;
    }
  }

  window.ResumeAIProgress = {
    start(opts = {}) {
      stopTimer();
      finished = false;
      currentMode = opts.mode === "preview" ? "preview" : "full";
      startedAt = Date.now();

      setVisible(true);
      setProgress(0, "Starting analysis...");

      timer = setInterval(tick, 300);
      tick();
    },

    complete(doneLabel = "Analysis completed") {
      if (finished) return;
      finished = true;
      stopTimer();
      setProgress(100, doneLabel);
      setTimeout(() => setVisible(false), 1200);
    },

    fail(failLabel = "Analysis failed") {
      if (finished) return;
      finished = true;
      stopTimer();

      const ui = getUi();
      let current = 12;
      if (ui.percent) {
        current = Math.max(12, parseInt(ui.percent.textContent || "12", 10) || 12);
      }

      setProgress(current, failLabel);
      setTimeout(() => setVisible(false), 1600);
    },

    reset() {
      finished = false;
      stopTimer();
      setProgress(0, "Starting analysis...");
      setVisible(false);
    }
  };
})();
