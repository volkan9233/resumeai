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
  let lastPct = 0;
  return (pct, label) => {
    const safePct = Math.max(lastPct, Math.min(100, Number(pct) || 0));
    lastPct = safePct;
    sendEvent(res, "progress", {
      percent: safePct,
      label: String(label || ""),
    });
  };
}
