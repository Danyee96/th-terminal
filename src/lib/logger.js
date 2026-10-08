const LEVELS = { debug: 10, info: 20, warn: 30, error: 40 };

export function createLogger(level = "info") {
  const min = LEVELS[level] ?? 20;
  const out = (lvl, msg) => {
    if (LEVELS[lvl] < min) return;
    const line = `${new Date().toISOString()} ${lvl.toUpperCase().padEnd(5)} ${msg}`;
    (lvl === "error" || lvl === "warn" ? console.error : console.log)(line);
  };
  return {
    debug: (m) => out("debug", m),
    info: (m) => out("info", m),
    warn: (m) => out("warn", m),
    error: (m) => out("error", m),
  };
}
