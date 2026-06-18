"use strict";

function terminateChild(child, opts = {}) {
  const platform = opts.platform || process.platform;
  const graceMs = typeof opts.graceMs === "number" ? opts.graceMs : 5000;
  if (!child || typeof child.kill !== "function") return null;

  if (platform === "win32") {
    try { child.kill(); } catch { /* already dead */ }
    return null;
  }

  try { child.kill("SIGTERM"); } catch { /* already dead */ }
  const timer = setTimeout(() => {
    try { child.kill("SIGKILL"); } catch { /* already dead */ }
  }, graceMs);
  timer.unref?.();
  return timer;
}

module.exports = { terminateChild };
