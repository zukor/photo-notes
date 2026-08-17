const { Pool } = require('pg');

const connectionString = process.env.DATABASE_URL;
const pool = new Pool({
  connectionString,
  // Railway internal Postgres does not need SSL; managed external ones do.
  ssl: process.env.PGSSL === 'require' ? { rejectUnauthorized: false } : false,
});

const SCHEMA = `
CREATE TABLE IF NOT EXISTS captures (
  id           SERIAL PRIMARY KEY,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  captured_by  TEXT,
  photo_path   TEXT,
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
`;

async function init() {
  await pool.query(SCHEMA);
  console.log('[db] schema ready');
}

module.exports = { pool, init };
