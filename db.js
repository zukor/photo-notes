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
  pro_type      TEXT NOT NULL DEFAULT 'paving',
  industry      TEXT,
  feature_access JSONB NOT NULL DEFAULT '{}'::jsonb,
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
  photo_title  TEXT,
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
  defect_user_confirmed BOOLEAN NOT NULL DEFAULT false,
  -- Concrete Pro: photo-centered field context. These describe what the photo
  -- proves; they are not a parallel project-management system.
  concrete_element TEXT,
  concrete_stage TEXT,
  concrete_condition TEXT,
  concrete_severity TEXT,
  concrete_mix TEXT,
  concrete_location TEXT,
  -- Photo overlays (stamps): array of {t,text,x,y,size,color,font,outline}.
  -- Non-destructive; rendered on cards, burned into exports, and flattenable.
  overlays        JSONB
);
CREATE TABLE IF NOT EXISTS jobs (
  id          SERIAL PRIMARY KEY,
  user_id     INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name        TEXT NOT NULL,
  job_number  TEXT,
  customer    TEXT,
  address     TEXT,
  status      TEXT NOT NULL DEFAULT 'active',
  start_date  DATE,
  end_date    DATE,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS jobs_user_idx ON jobs (user_id, status, created_at DESC);
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
-- Minimal, content-free Stripe webhook ledger. The event ID primary key makes
-- retries idempotent without storing customer or payment details locally.
CREATE TABLE IF NOT EXISTS stripe_events (
  event_id     TEXT PRIMARY KEY,
  event_type   TEXT NOT NULL,
  object_id    TEXT,
  livemode     BOOLEAN NOT NULL DEFAULT false,
  processed_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS stripe_events_type_idx ON stripe_events (event_type, processed_at DESC);
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
-- Concrete batch tickets/spec sheets remain supporting photos attached to the
-- placement photo that they substantiate.
CREATE TABLE IF NOT EXISTS concrete_ticket_links (
  id                   SERIAL PRIMARY KEY,
  user_id              INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  placement_capture_id INTEGER NOT NULL REFERENCES captures(id) ON DELETE CASCADE,
  ticket_capture_id    INTEGER NOT NULL REFERENCES captures(id) ON DELETE CASCADE,
  reference_type       TEXT NOT NULL DEFAULT 'batch_ticket',
  created_at           TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (placement_capture_id, ticket_capture_id)
);
CREATE INDEX IF NOT EXISTS concrete_ticket_links_user_idx ON concrete_ticket_links (user_id, placement_capture_id);
-- Satellite takeoff / measurement zones (Pro). points holds ordered [{lat,lng}]:
-- polygon vertices, or centerline points for a span. length_ft/area_sqft are
-- computed server-side and never trusted from the client.
CREATE TABLE IF NOT EXISTS measure_zones (
  id         SERIAL PRIMARY KEY,
  user_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  group_id   INTEGER REFERENCES groups(id) ON DELETE SET NULL,
  name       TEXT NOT NULL,
  zone_type  TEXT NOT NULL,
  points     JSONB NOT NULL,
  width_ft   DOUBLE PRECISION,
  length_ft  DOUBLE PRECISION,
  area_sqft  DOUBLE PRECISION,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS measure_zones_user_idx ON measure_zones (user_id);
-- Extra Work Record (Paving Pro): job-site documentation of out-of-scope work.
-- Kept in its own tables (not captures) so it never mixes into the Library,
-- map, pairing, zones, or normal exports.
CREATE TABLE IF NOT EXISTS extra_work_records (
  id          SERIAL PRIMARY KEY,
  user_id     INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  group_id    INTEGER REFERENCES groups(id) ON DELETE SET NULL,
  created_by  TEXT,
  customer    TEXT,
  status      TEXT NOT NULL DEFAULT 'documented',
  reason_category   TEXT,
  reason_other_text TEXT,
  description_text  TEXT,
  latitude    DOUBLE PRECISION,
  longitude   DOUBLE PRECISION,
  address     TEXT,
  notified_person_name    TEXT,
  notified_person_company TEXT,
  notification_method     TEXT,
  notified_at TIMESTAMPTZ,
  notification_notes      TEXT,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS ewr_photos (
  id           SERIAL PRIMARY KEY,
  ewr_id       INTEGER NOT NULL REFERENCES extra_work_records(id) ON DELETE CASCADE,
  user_id      INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  photo_path   TEXT,
  photo_width  INTEGER,
  photo_height INTEGER,
  caption      TEXT,
  latitude     DOUBLE PRECISION,
  longitude    DOUBLE PRECISION,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS ewr_user_idx ON extra_work_records (user_id);
CREATE INDEX IF NOT EXISTS ewr_group_idx ON extra_work_records (group_id);
CREATE INDEX IF NOT EXISTS ewr_photos_ewr_idx ON ewr_photos (ewr_id);
-- Asphalt delivery tickets (Paving Pro). A scan begins as a draft so the AI
-- result can be reviewed and corrected before it counts toward daily tonnage.
CREATE TABLE IF NOT EXISTS asphalt_tickets (
  id                     SERIAL PRIMARY KEY,
  user_id                INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  job_id                 INTEGER REFERENCES jobs(id) ON DELETE SET NULL,
  photo_path             TEXT,
  ticket_number          TEXT,
  ticket_date            DATE,
  plant_name             TEXT,
  plant_address          TEXT,
  mix_description        TEXT,
  mix_code               TEXT,
  truck_number           TEXT,
  job_number             TEXT,
  net_tons               NUMERIC(12,2),
  dispatch_time          TEXT,
  arrival_time           TEXT,
  dispatch_temperature_f NUMERIC(8,2),
  confidence             TEXT,
  raw_ai                 JSONB,
  status                 TEXT NOT NULL DEFAULT 'draft',
  created_at             TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at             TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS asphalt_tickets_user_date_idx ON asphalt_tickets (user_id, ticket_date DESC, created_at DESC);
-- Camera readers (Paving Pro): equipment plates and gauges are photographed
-- as source evidence, while their reviewed structured data is the useful record.
CREATE TABLE IF NOT EXISTS camera_readings (
  id           SERIAL PRIMARY KEY,
  user_id      INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  reading_type TEXT NOT NULL,
  photo_path   TEXT,
  title        TEXT,
  fields       JSONB NOT NULL DEFAULT '{}'::jsonb,
  confidence   TEXT,
  raw_ai       JSONB,
  status       TEXT NOT NULL DEFAULT 'draft',
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS camera_readings_user_type_idx ON camera_readings (user_id, reading_type, created_at DESC);
-- Basic-app issue reports. Reports are stored before email is attempted so a
-- mail-provider outage can never discard a tester's feedback.
CREATE TABLE IF NOT EXISTS issue_reports (
  id             SERIAL PRIMARY KEY,
  user_id        INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  description    TEXT NOT NULL,
  page_name      TEXT,
  page_url       TEXT,
  screenshot_path TEXT,
  viewport       TEXT,
  user_agent     TEXT,
  email_status   TEXT NOT NULL DEFAULT 'pending',
  email_error    TEXT,
  management_status TEXT NOT NULL DEFAULT 'new',
  priority       TEXT NOT NULL DEFAULT 'normal',
  admin_notes    TEXT,
  updated_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  resolved_at    TIMESTAMPTZ,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS issue_reports_created_idx ON issue_reports (created_at DESC);
-- Tamper-evident fingerprint and content-free edit history for each capture.
CREATE TABLE IF NOT EXISTS capture_evidence (
  capture_id      INTEGER PRIMARY KEY REFERENCES captures(id) ON DELETE CASCADE,
  user_id         INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  original_sha256 TEXT,
  original_bytes  BIGINT,
  original_name   TEXT,
  captured_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS capture_history (
  id         SERIAL PRIMARY KEY,
  capture_id INTEGER NOT NULL REFERENCES captures(id) ON DELETE CASCADE,
  user_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  action     TEXT NOT NULL,
  detail     JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS capture_history_capture_idx ON capture_history (capture_id, created_at);
CREATE TABLE IF NOT EXISTS approval_packages (
  id          SERIAL PRIMARY KEY,
  user_id     INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  job_id      INTEGER REFERENCES jobs(id) ON DELETE SET NULL,
  token       TEXT UNIQUE NOT NULL,
  title       TEXT NOT NULL,
  message     TEXT,
  capture_ids INTEGER[] NOT NULL,
  status      TEXT NOT NULL DEFAULT 'pending',
  customer_name TEXT,
  customer_comment TEXT,
  responded_at TIMESTAMPTZ,
  expires_at  TIMESTAMPTZ NOT NULL,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS approval_packages_user_idx ON approval_packages (user_id, created_at DESC);
CREATE TABLE IF NOT EXISTS hoa_management_companies (
  id SERIAL PRIMARY KEY,
  name TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS hoa_company_members (
  company_id INTEGER NOT NULL REFERENCES hoa_management_companies(id) ON DELETE CASCADE,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  company_role TEXT NOT NULL DEFAULT 'manager',
  PRIMARY KEY(company_id,user_id)
);
CREATE TABLE IF NOT EXISTS hoa_communities (
  id SERIAL PRIMARY KEY,
  company_id INTEGER NOT NULL REFERENCES hoa_management_companies(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  address TEXT,
  manager_name TEXT,
  assignment_rules JSONB NOT NULL DEFAULT '{}'::jsonb,
  fiscal_year_start INTEGER NOT NULL DEFAULT 1,
  active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS hoa_communities_company_idx ON hoa_communities(company_id,active,name);
CREATE TABLE IF NOT EXISTS hoa_maintenance_items (
  id SERIAL PRIMARY KEY,
  company_id INTEGER NOT NULL REFERENCES hoa_management_companies(id) ON DELETE CASCADE,
  community_id INTEGER NOT NULL REFERENCES hoa_communities(id) ON DELETE CASCADE,
  capture_id INTEGER REFERENCES captures(id) ON DELETE SET NULL,
  created_by INTEGER NOT NULL REFERENCES users(id),
  title TEXT NOT NULL,
  item_type TEXT NOT NULL DEFAULT 'maintenance',
  description TEXT,
  area TEXT NOT NULL DEFAULT 'Maintenance',
  priority TEXT NOT NULL DEFAULT 'routine',
  status TEXT NOT NULL DEFAULT 'new',
  target_date DATE,
  primary_assignee TEXT,
  directed_to TEXT,
  involved_people TEXT[],
  budget_source TEXT NOT NULL DEFAULT 'unassigned',
  photo_stage TEXT NOT NULL DEFAULT 'initial',
  board_approval TEXT NOT NULL DEFAULT 'not_required',
  estimated_cost NUMERIC(12,2),
  actual_cost NUMERIC(12,2),
  completed_by TEXT,
  completion_date DATE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  completed_at TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS hoa_items_company_idx ON hoa_maintenance_items(company_id,status,priority,created_at DESC);
CREATE INDEX IF NOT EXISTS hoa_items_community_idx ON hoa_maintenance_items(community_id,status,created_at DESC);
CREATE TABLE IF NOT EXISTS hoa_item_photos (
  item_id INTEGER NOT NULL REFERENCES hoa_maintenance_items(id) ON DELETE CASCADE,
  capture_id INTEGER NOT NULL REFERENCES captures(id) ON DELETE CASCADE,
  photo_stage TEXT NOT NULL DEFAULT 'initial',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY(item_id,capture_id)
);
CREATE TABLE IF NOT EXISTS hoa_item_history (
  id SERIAL PRIMARY KEY,
  item_id INTEGER NOT NULL REFERENCES hoa_maintenance_items(id) ON DELETE CASCADE,
  user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
  action TEXT NOT NULL,
  detail JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS hoa_notifications (
  id SERIAL PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  item_id INTEGER REFERENCES hoa_maintenance_items(id) ON DELETE CASCADE,
  message TEXT NOT NULL,
  read_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS hoa_assets (
  id SERIAL PRIMARY KEY,
  company_id INTEGER NOT NULL REFERENCES hoa_management_companies(id) ON DELETE CASCADE,
  community_id INTEGER NOT NULL REFERENCES hoa_communities(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  asset_type TEXT NOT NULL DEFAULT 'Other',
  location_description TEXT,
  condition TEXT NOT NULL DEFAULT 'not_assessed',
  primary_capture_id INTEGER REFERENCES captures(id) ON DELETE SET NULL,
  active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS hoa_assets_company_idx ON hoa_assets(company_id,community_id,active,name);
CREATE TABLE IF NOT EXISTS hoa_asset_photos (
  asset_id INTEGER NOT NULL REFERENCES hoa_assets(id) ON DELETE CASCADE,
  capture_id INTEGER NOT NULL REFERENCES captures(id) ON DELETE CASCADE,
  photo_type TEXT NOT NULL DEFAULT 'condition',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY(asset_id,capture_id)
);
CREATE TABLE IF NOT EXISTS hoa_inspection_routes (
  id SERIAL PRIMARY KEY,
  company_id INTEGER NOT NULL REFERENCES hoa_management_companies(id) ON DELETE CASCADE,
  community_id INTEGER NOT NULL REFERENCES hoa_communities(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  instructions TEXT,
  active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS hoa_inspection_stops (
  id SERIAL PRIMARY KEY,
  route_id INTEGER NOT NULL REFERENCES hoa_inspection_routes(id) ON DELETE CASCADE,
  asset_id INTEGER REFERENCES hoa_assets(id) ON DELETE SET NULL,
  name TEXT NOT NULL,
  instructions TEXT,
  required_views TEXT[] NOT NULL DEFAULT ARRAY['overview']::text[],
  sort_order INTEGER NOT NULL DEFAULT 0
);
CREATE TABLE IF NOT EXISTS hoa_property_visits (
  id SERIAL PRIMARY KEY,
  company_id INTEGER NOT NULL REFERENCES hoa_management_companies(id) ON DELETE CASCADE,
  community_id INTEGER NOT NULL REFERENCES hoa_communities(id) ON DELETE CASCADE,
  route_id INTEGER REFERENCES hoa_inspection_routes(id) ON DELETE SET NULL,
  created_by INTEGER NOT NULL REFERENCES users(id),
  status TEXT NOT NULL DEFAULT 'in_progress',
  started_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  completed_at TIMESTAMPTZ
);
CREATE TABLE IF NOT EXISTS hoa_visit_stops (
  id SERIAL PRIMARY KEY,
  visit_id INTEGER NOT NULL REFERENCES hoa_property_visits(id) ON DELETE CASCADE,
  inspection_stop_id INTEGER REFERENCES hoa_inspection_stops(id) ON DELETE SET NULL,
  name TEXT NOT NULL,
  instructions TEXT,
  required_views TEXT[] NOT NULL DEFAULT ARRAY['overview']::text[],
  capture_ids INTEGER[] NOT NULL DEFAULT '{}'::integer[],
  note TEXT,
  status TEXT NOT NULL DEFAULT 'pending',
  sort_order INTEGER NOT NULL DEFAULT 0
);
CREATE TABLE IF NOT EXISTS hoa_completion_photo_requests (
  id SERIAL PRIMARY KEY,
  item_id INTEGER NOT NULL REFERENCES hoa_maintenance_items(id) ON DELETE CASCADE,
  token TEXT UNIQUE NOT NULL,
  recipient_name TEXT,
  status TEXT NOT NULL DEFAULT 'open',
  expires_at TIMESTAMPTZ NOT NULL,
  submitted_at TIMESTAMPTZ,
  created_by INTEGER NOT NULL REFERENCES users(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
`;

const DEFAULT_AREAS = ['Roads', 'Maintenance', 'Fences & Walls', 'Security', 'Landscaping', 'Other'];

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
  await pool.query(`ALTER TABLE captures ADD COLUMN IF NOT EXISTS photo_title TEXT`);
  // Pro-tier: user plan ('free'|'pro'), default 'free' for all existing users.
  await pool.query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS plan TEXT NOT NULL DEFAULT 'free'`);
  await pool.query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS pro_type TEXT NOT NULL DEFAULT 'paving'`);
  // Preserve every existing account and paving record while adopting the new
  // public product identifier.
  await pool.query(`UPDATE users SET pro_type = 'paving' WHERE pro_type = 'asphalt'`);
  await pool.query(`ALTER TABLE users ALTER COLUMN pro_type SET DEFAULT 'paving'`);
  await pool.query(`ALTER TABLE hoa_communities ADD COLUMN IF NOT EXISTS assignment_rules JSONB NOT NULL DEFAULT '{}'::jsonb`);
  await pool.query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS feature_access JSONB NOT NULL DEFAULT '{}'::jsonb`);
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
  await pool.query(`ALTER TABLE captures ADD COLUMN IF NOT EXISTS concrete_element TEXT`);
  await pool.query(`ALTER TABLE captures ADD COLUMN IF NOT EXISTS concrete_stage TEXT`);
  await pool.query(`ALTER TABLE captures ADD COLUMN IF NOT EXISTS concrete_condition TEXT`);
  await pool.query(`ALTER TABLE captures ADD COLUMN IF NOT EXISTS concrete_severity TEXT`);
  await pool.query(`ALTER TABLE captures ADD COLUMN IF NOT EXISTS concrete_mix TEXT`);
  await pool.query(`ALTER TABLE captures ADD COLUMN IF NOT EXISTS concrete_location TEXT`);
  await pool.query(`ALTER TABLE captures ADD COLUMN IF NOT EXISTS overlays JSONB`);
  await pool.query(`ALTER TABLE captures ADD COLUMN IF NOT EXISTS job_id INTEGER REFERENCES jobs(id) ON DELETE SET NULL`);
  await pool.query(`ALTER TABLE captures ADD COLUMN IF NOT EXISTS perceptual_hash TEXT`);
  await pool.query(`CREATE INDEX IF NOT EXISTS captures_job_idx ON captures (user_id, job_id, created_at DESC)`);
  // Non-destructive crop: when a photo is first cropped, the pre-crop image is
  // backed up here so the original can always be restored.
  await pool.query(`ALTER TABLE captures ADD COLUMN IF NOT EXISTS photo_original_path TEXT`);
  await pool.query(`ALTER TABLE asphalt_tickets ADD COLUMN IF NOT EXISTS job_id INTEGER REFERENCES jobs(id) ON DELETE SET NULL`);
  await pool.query(`CREATE TABLE IF NOT EXISTS concrete_ticket_links (id SERIAL PRIMARY KEY,user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,placement_capture_id INTEGER NOT NULL REFERENCES captures(id) ON DELETE CASCADE,ticket_capture_id INTEGER NOT NULL REFERENCES captures(id) ON DELETE CASCADE,reference_type TEXT NOT NULL DEFAULT 'batch_ticket',created_at TIMESTAMPTZ NOT NULL DEFAULT now(),UNIQUE(placement_capture_id,ticket_capture_id))`);
  await pool.query(`CREATE INDEX IF NOT EXISTS concrete_ticket_links_user_idx ON concrete_ticket_links (user_id,placement_capture_id)`);
  await pool.query(`ALTER TABLE groups ADD COLUMN IF NOT EXISTS user_id INTEGER REFERENCES users(id)`);
  await pool.query(`UPDATE groups SET user_id = $1 WHERE user_id IS NULL`, [adminId]);
  // Tester issue triage. These ALTERs upgrade existing production databases
  // without changing or losing previously submitted reports.
  await pool.query(`ALTER TABLE issue_reports ADD COLUMN IF NOT EXISTS management_status TEXT NOT NULL DEFAULT 'new'`);
  await pool.query(`ALTER TABLE issue_reports ADD COLUMN IF NOT EXISTS priority TEXT NOT NULL DEFAULT 'normal'`);
  await pool.query(`ALTER TABLE issue_reports ADD COLUMN IF NOT EXISTS admin_notes TEXT`);
  await pool.query(`ALTER TABLE issue_reports ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ NOT NULL DEFAULT now()`);
  await pool.query(`ALTER TABLE issue_reports ADD COLUMN IF NOT EXISTS resolved_at TIMESTAMPTZ`);

  // This common property-maintenance topic is available to every existing and
  // future account. Existing custom topics are preserved.
  await pool.query(`INSERT INTO user_areas (user_id, name) SELECT id, 'Fences & Walls' FROM users ON CONFLICT DO NOTHING`);

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
