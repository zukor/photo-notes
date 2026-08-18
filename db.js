const { Pool } = require('pg');
const bcrypt = require('bcryptjs');

const connectionString = process.env.DATABASE_URL;
const pool = new Pool({
  connectionString,
  // Railway internal Postgres does not need SSL; managed external ones do.
  ssl: process.env.PGSSL === 'require' ? { rejectUnauthorized: false } : false,
});

// Note: the old global `areas` table is kept (vestigial) so migration can copy
// from it safely; areas are now per-user in `user_areas`.
const SCHEMA = `
CREATE TABLE IF NOT EXISTS users (
  id            SERIAL PRIMARY KEY,
  email         TEXT UNIQUE NOT NULL,
  name          TEXT,
  password_hash TEXT NOT NULL,
  role          TEXT NOT NULL DEFAULT 'user',
  industry      TEXT,
  active        BOOLEAN NOT NULL DEFAULT true,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_login_at TIMESTAMPTZ
);
CREATE TABLE IF NOT EXISTS captures (
  id           SERIAL PRIMARY KEY,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  captured_by  TEXT,
  photo_path   TEXT,
  photo_width  INTEGER,
  photo_height INTEGER,
  note         TEXT,
  latitude     DOUBLE PRECISION,
  longitude    DOUBLE PRECISION,
  address      TEXT,
  area_tags    TEXT[] NOT NULL DEFAULT '{}',
  kind         TEXT NOT NULL DEFAULT 'note',
  status       TEXT,
  assignee     TEXT,
  source       TEXT NOT NULL DEFAULT 'elm-creek'
);
CREATE TABLE IF NOT EXISTS groups (
  id          SERIAL PRIMARY KEY,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  title       TEXT,
  description TEXT
);
CREATE TABLE IF NOT EXISTS group_items (
  group_id    INTEGER NOT NULL REFERENCES groups(id) ON DELETE CASCADE,
  capture_id  INTEGER NOT NULL REFERENCES captures(id) ON DELETE CASCADE,
  position    INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (group_id, capture_id)
);
CREATE TABLE IF NOT EXISTS areas (
  name        TEXT PRIMARY KEY,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS user_areas (
  user_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name       TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, name)
);
-- Activity log for admin usage metadata. Stores only WHAT was done, never the
-- content: no note text, no photos. detail holds small non-sensitive facts like
-- export format or a count.
CREATE TABLE IF NOT EXISTS events (
  id         SERIAL PRIMARY KEY,
  user_id    INTEGER REFERENCES users(id) ON DELETE CASCADE,
  action     TEXT NOT NULL,
  detail     JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS events_user_idx ON events (user_id);
CREATE INDEX IF NOT EXISTS events_action_idx ON events (action);
`;

const DEFAULT_AREAS = ['Roads', 'Maintenance', 'Walls', 'Security', 'Landscaping', 'Other'];

async function seedUserAreas(userId) {
  for (let i = 0; i < DEFAULT_AREAS.length; i++) {
    await pool.query(
      `INSERT INTO user_areas (user_id, name, created_at)
       VALUES ($1, $2, now() + ($3 || ' milliseconds')::interval)
       ON CONFLICT DO NOTHING`,
      [userId, DEFAULT_AREAS[i], String(i)]);
  }
}

async function init() {
  await pool.query(SCHEMA);

  // 1. Ensure an admin user exists. On a fresh/existing DB with no users, seed
  //    the admin from env (email + the current ADMIN_PASSWORD), so the original
  //    login keeps working as email + that password.
  let adminId;
  const existing = await pool.query('SELECT id FROM users ORDER BY id ASC LIMIT 1');
  if (existing.rows.length === 0) {
    const email = (process.env.ADMIN_EMAIL || 'turcotte@zukor.com').toLowerCase().trim();
    const name = process.env.ADMIN_NAME || 'Sam';
    const pw = process.env.ADMIN_PASSWORD || 'change-me';
    const hash = bcrypt.hashSync(pw, 10);
    const ins = await pool.query(
      `INSERT INTO users (email, name, password_hash, role, industry, active)
       VALUES ($1, $2, $3, 'admin', $4, true) RETURNING id`,
      [email, name, hash, 'HOA / property management']);
    adminId = ins.rows[0].id;
  } else {
    const a = await pool.query(`SELECT id FROM users WHERE role = 'admin' ORDER BY id ASC LIMIT 1`);
    adminId = a.rows.length ? a.rows[0].id : existing.rows[0].id;
  }

  // 1b. One-time admin password reset. When ADMIN_PASSWORD_RESET is set, force the
  //     admin account's password to the current ADMIN_PASSWORD. The flag is turned
  //     off again after use so ordinary redeploys never override a password the
  //     admin later changes from the admin area.
  if (process.env.ADMIN_PASSWORD_RESET && String(process.env.ADMIN_PASSWORD_RESET).trim() && process.env.ADMIN_PASSWORD) {
    const hash = bcrypt.hashSync(process.env.ADMIN_PASSWORD, 10);
    await pool.query(`UPDATE users SET password_hash = $1 WHERE id = $2`, [hash, adminId]);
    console.log('[db] admin password reset applied for user ' + adminId);
  }

  // 2. Add owner columns to existing tables (idempotent) and backfill legacy
  //    rows to the admin so nothing is orphaned.
  await pool.query(`ALTER TABLE captures ADD COLUMN IF NOT EXISTS user_id INTEGER REFERENCES users(id)`);
  await pool.query(`UPDATE captures SET user_id = $1 WHERE user_id IS NULL`, [adminId]);
  await pool.query(`ALTER TABLE captures ADD COLUMN IF NOT EXISTS photo_width INTEGER`);
  await pool.query(`ALTER TABLE captures ADD COLUMN IF NOT EXISTS photo_height INTEGER`);
  await pool.query(`ALTER TABLE groups ADD COLUMN IF NOT EXISTS user_id INTEGER REFERENCES users(id)`);
  await pool.query(`UPDATE groups SET user_id = $1 WHERE user_id IS NULL`, [adminId]);

  // 3. Move any legacy global areas into the admin's per-user area list.
  await pool.query(
    `INSERT INTO user_areas (user_id, name, created_at)
     SELECT $1, name, created_at FROM areas
     ON CONFLICT DO NOTHING`, [adminId]);

  // 4. Make sure the admin has a default area list even if none existed.
  const adminAreas = await pool.query(`SELECT 1 FROM user_areas WHERE user_id = $1 LIMIT 1`, [adminId]);
  if (adminAreas.rows.length === 0) await seedUserAreas(adminId);

  console.log('[db] schema ready');
}

module.exports = { pool, init, seedUserAreas };
