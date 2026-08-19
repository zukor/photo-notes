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
  plan          TEXT NOT NULL DEFAULT 'free',
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
  source       TEXT NOT NULL DEFAULT 'elm-creek',
  -- Pro-tier dimension fields. length/width stored canonically in inches
  -- (dim_length_in / dim_width_in) plus the display unit chosen by the user
  -- (dim_length_unit / dim_width_unit = 'ft'|'in'); depth is inches only;
  -- shape is 'rectangle'|'circle'|'irregular'; dim_area_sqft is the computed
  -- (or user-overridden) area in square feet.
  dim_length_in   DOUBLE PRECISION,
  dim_length_unit TEXT,
  dim_width_in    DOUBLE PRECISION,
  dim_width_unit  TEXT,
  dim_depth_in    DOUBLE PRECISION,
  dim_shape       TEXT,
  dim_area_sqft   DOUBLE PRECISION,
  -- Measure-from-photo (Pro): how the dimensions were produced, the AI's
  -- confidence, the raw AI response (for later accuracy tuning), and whether
  -- low-confidence AI values have been confirmed for use in exports.
  dim_source      TEXT,
  dim_confidence  TEXT,
  dim_ai          JSONB,
  dim_confirmed   BOOLEAN NOT NULL DEFAULT true,
  -- AI defect classification (Pro): the classified defect, severity, the AI's
  -- confidence, the raw AI response, and whether a human overrode/confirmed it.
  defect_type     TEXT,
  defect_severity TEXT,
  defect_confidence TEXT,
  defect_ai       JSONB,
  defect_user_confirmed BOOLEAN NOT NULL DEFAULT false
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
-- Before/after pairing of two of a user's captures (Feature 4).
CREATE TABLE IF NOT EXISTS capture_pairs (
  id         SERIAL PRIMARY KEY,
  user_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  before_id  INTEGER NOT NULL REFERENCES captures(id) ON DELETE CASCADE,
  after_id   INTEGER NOT NULL REFERENCES captures(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (before_id, after_id)
);
CREATE INDEX IF NOT EXISTS capture_pairs_user_idx ON capture_pairs (user_id);
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
  // Pro-tier: user plan ('free'|'pro'), default 'free' for all existing users.
  await pool.query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS plan TEXT NOT NULL DEFAULT 'free'`);
  // Pro-tier: capture dimension fields (see SCHEMA above for semantics).
  await pool.query(`ALTER TABLE captures ADD COLUMN IF NOT EXISTS dim_length_in DOUBLE PRECISION`);
  await pool.query(`ALTER TABLE captures ADD COLUMN IF NOT EXISTS dim_length_unit TEXT`);
  await pool.query(`ALTER TABLE captures ADD COLUMN IF NOT EXISTS dim_width_in DOUBLE PRECISION`);
  await pool.query(`ALTER TABLE captures ADD COLUMN IF NOT EXISTS dim_width_unit TEXT`);
  await pool.query(`ALTER TABLE captures ADD COLUMN IF NOT EXISTS dim_depth_in DOUBLE PRECISION`);
  await pool.query(`ALTER TABLE captures ADD COLUMN IF NOT EXISTS dim_shape TEXT`);
  await pool.query(`ALTER TABLE captures ADD COLUMN IF NOT EXISTS dim_area_sqft DOUBLE PRECISION`);
  // Measure-from-photo provenance + confirmation.
  await pool.query(`ALTER TABLE captures ADD COLUMN IF NOT EXISTS dim_source TEXT`);
  await pool.query(`ALTER TABLE captures ADD COLUMN IF NOT EXISTS dim_confidence TEXT`);
  await pool.query(`ALTER TABLE captures ADD COLUMN IF NOT EXISTS dim_ai JSONB`);
  await pool.query(`ALTER TABLE captures ADD COLUMN IF NOT EXISTS dim_confirmed BOOLEAN NOT NULL DEFAULT true`);
  // AI defect classification.
  await pool.query(`ALTER TABLE captures ADD COLUMN IF NOT EXISTS defect_type TEXT`);
  await pool.query(`ALTER TABLE captures ADD COLUMN IF NOT EXISTS defect_severity TEXT`);
  await pool.query(`ALTER TABLE captures ADD COLUMN IF NOT EXISTS defect_confidence TEXT`);
  await pool.query(`ALTER TABLE captures ADD COLUMN IF NOT EXISTS defect_ai JSONB`);
  await pool.query(`ALTER TABLE captures ADD COLUMN IF NOT EXISTS defect_user_confirmed BOOLEAN NOT NULL DEFAULT false`);
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
