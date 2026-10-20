'use strict';
// Sign-in protection, single-session sign out, and daily limits on paid AI requests.
const crypto = require('crypto');

const SCHEMA = `
CREATE TABLE IF NOT EXISTS revoked_sessions (
  session_key TEXT PRIMARY KEY,
  expires_at TIMESTAMPTZ NOT NULL
);
CREATE INDEX IF NOT EXISTS revoked_sessions_expiry_idx ON revoked_sessions (expires_at);
CREATE TABLE IF NOT EXISTS ai_daily_usage (
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  usage_day DATE NOT NULL,
  kind TEXT NOT NULL,
  count INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (user_id, usage_day, kind)
);`;

const MIN_PASSWORD_LENGTH = 8;
function passwordProblem(password) {
  return String(password || '').length < MIN_PASSWORD_LENGTH ? `Use a password of at least ${MIN_PASSWORD_LENGTH} characters.` : null;
}

// Failed sign-ins are counted per email and per network address. Expired entries are dropped first
// when memory fills; an active lockout is never dropped to make room.
function createLoginLimiter({ emailLimit = 10, ipLimit = 50, windowMs = 15 * 60 * 1000, maxEntries = 50000 } = {}) {
  const maps = { email: new Map(), ip: new Map() };
  const limits = { email: emailLimit, ip: ipLimit }, prunedAt = { email: 0, ip: 0 };
  const recent = (list, now) => (list || []).filter(t => now - t < windowMs);
  function blocked(kind, key, now = Date.now()) {
    if (!key) return false;
    const map = maps[kind], list = recent(map.get(key), now);
    if (list.length) map.set(key, list); else map.delete(key);
    return list.length >= limits[kind];
  }
  function prune(kind, now) {
    const map = maps[kind];
    if (now - prunedAt[kind] < 1000) return; // A flood of new keys cannot force a full scan on every request.
    prunedAt[kind] = now;
    for (const [key, list] of map) { const live = recent(list, now); if (live.length) map.set(key, live); else map.delete(key); }
    if (map.size < maxEntries) return;
    // Still full: drop the oldest entries that are not locked out.
    for (const [key, list] of map) { if (list.length < limits[kind]) map.delete(key); if (map.size < maxEntries * 0.9) break; }
  }
  function note(kind, key, now = Date.now()) {
    if (!key) return;
    const map = maps[kind], list = recent(map.get(key), now);
    if (!map.has(key) && map.size >= maxEntries) { prune(kind, now); if (map.size >= maxEntries) return; }
    list.push(now); map.set(key, list.slice(-limits[kind]));
  }
  return {
    blocked: (email, ip, now) => blocked('email', email, now) || blocked('ip', ip, now),
    failure: (email, ip, now) => { note('email', email, now); note('ip', ip, now); },
    success: email => { maps.email.delete(email); },
    size: kind => maps[kind].size,
  };
}

// Each session has its own key, so signing out ends only that session. Older sessions use a hash of the token.
function sessionKey(session, token) {
  if (session && typeof session.sid === 'string' && /^[A-Za-z0-9_-]{16,64}$/.test(session.sid)) return 'sid:' + session.sid;
  return 'tok:' + crypto.createHash('sha256').update(String(token || '')).digest('hex');
}
function newSessionId() { return crypto.randomBytes(18).toString('base64url'); }

function createSessionRevocation({ pool, maxLocal = 20000 }) {
  const local = new Map();
  return {
    // Checked together with the account lookup that every request already makes.
    sql: 'EXISTS(SELECT 1 FROM revoked_sessions WHERE session_key=$2 AND expires_at>now()) AS session_revoked',
    revokedHere(key, now = Date.now()) { const until = local.get(key); if (!until) return false; if (until <= now) { local.delete(key); return false; } return true; },
    async revoke(key, expiresAtMs) {
      const expires = new Date(Number.isFinite(expiresAtMs) ? expiresAtMs : Date.now() + 30 * 86400000);
      if (local.size >= maxLocal) local.clear();
      local.set(key, expires.getTime());
      await pool.query('INSERT INTO revoked_sessions(session_key,expires_at) VALUES($1,$2) ON CONFLICT (session_key) DO UPDATE SET expires_at=GREATEST(revoked_sessions.expires_at,EXCLUDED.expires_at)', [key, expires]);
      if (Math.random() < 0.05) pool.query('DELETE FROM revoked_sessions WHERE expires_at<now()').catch(() => {});
    },
  };
}

// Counts one paid AI request against the user's daily allowance. Returns false when the allowance is used up.
const AI_DAILY_LIMIT = Math.max(1, Number(process.env.AI_DAILY_LIMIT) || 500);
const AI_LIMIT_LABEL = { classify: 'AI classifications', measure: 'AI measurements' };
async function takeAiAllowance(pool, userId, kind, limit = AI_DAILY_LIMIT) {
  const row = (await pool.query(`INSERT INTO ai_daily_usage(user_id,usage_day,kind,count) VALUES($1,CURRENT_DATE,$2,1)
    ON CONFLICT (user_id,usage_day,kind) DO UPDATE SET count=ai_daily_usage.count+1 WHERE ai_daily_usage.count<$3 RETURNING count`, [userId, kind, limit])).rows[0];
  return !!row;
}
function aiLimitMessage(kind, limit = AI_DAILY_LIMIT) {
  return `You have reached today's limit of ${limit} ${AI_LIMIT_LABEL[kind] || 'AI requests'}. Please try again tomorrow, or enter the details by hand.`;
}

module.exports = { SCHEMA, MIN_PASSWORD_LENGTH, passwordProblem, createLoginLimiter, sessionKey, newSessionId, createSessionRevocation, takeAiAllowance, aiLimitMessage, AI_DAILY_LIMIT };
