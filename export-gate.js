'use strict';
// Document exports hold every resized photo in memory until the file is finished.
// A few large exports at once can exhaust the server, so only a few run at a time
// and the rest wait their turn briefly instead of failing.
const EXPORT_PATHS = [
  '/api/export',
  '/api/concrete/report',
  '/api/hoa/report',
  '/api/paving/jobs/:id/report',
  '/api/ewr/:id/export',
  '/api/property/incidents/:id/report',
  '/api/camera-readings/:id/report',
];

function createExportGate({ max = 2, queueLimit = 20, waitMs = 120000, setTimer = setTimeout, clearTimer = clearTimeout } = {}) {
  let running = 0;
  const waiting = [];
  const stats = () => ({ running, waiting: waiting.length, max });
  function release() {
    running = Math.max(0, running - 1);
    while (waiting.length && running < max) {
      const next = waiting.shift();
      if (next.cancelled) continue;
      clearTimer(next.timer);
      running++;
      next.start();
    }
  }
  function middleware(req, res, next) {
    let done = false;
    const finish = () => { if (done) return; done = true; release(); };
    const start = () => { res.once('finish', finish); res.once('close', finish); next(); };
    if (running < max) { running++; return start(); }
    if (waiting.length >= queueLimit) return busy(res);
    const entry = { start, cancelled: false };
    entry.timer = setTimer(() => { entry.cancelled = true; const i = waiting.indexOf(entry); if (i >= 0) waiting.splice(i, 1); busy(res); }, waitMs);
    // A person who gives up and leaves no longer holds a place in line.
    res.once('close', () => { if (!done && !entry.started) { entry.cancelled = true; clearTimer(entry.timer); const i = waiting.indexOf(entry); if (i >= 0) waiting.splice(i, 1); } });
    const original = entry.start;
    entry.start = () => { entry.started = true; original(); };
    waiting.push(entry);
  }
  function busy(res) {
    if (res.headersSent || res.writableEnded) return;
    res.set('Retry-After', '30');
    res.status(503).json({ error: 'Several documents are being made right now. Please try again in a minute.' });
  }
  return { middleware, stats };
}

module.exports = { createExportGate, EXPORT_PATHS };
