CREATE TABLE IF NOT EXISTS photo_requests (
 id SERIAL PRIMARY KEY,
 user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
 token TEXT UNIQUE NOT NULL,
 edition TEXT NOT NULL,
 title TEXT NOT NULL,
 recipient_name TEXT NOT NULL DEFAULT '',
 sender_name TEXT NOT NULL DEFAULT '',
 instructions TEXT NOT NULL DEFAULT '',
 views JSONB NOT NULL,
 allow_partial BOOLEAN NOT NULL DEFAULT false,
 related_capture_id INTEGER REFERENCES captures(id) ON DELETE SET NULL,
 job_id INTEGER REFERENCES jobs(id) ON DELETE SET NULL,
 item_id INTEGER REFERENCES hoa_maintenance_items(id) ON DELETE CASCADE,
 status TEXT NOT NULL DEFAULT 'open' CHECK(status IN ('open','partially_submitted','completed','expired','cancelled')),
 expires_at TIMESTAMPTZ NOT NULL,
 created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
 submitted_at TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS photo_requests_owner ON photo_requests(user_id,created_at DESC);
CREATE TABLE IF NOT EXISTS photo_request_photos (
 id SERIAL PRIMARY KEY,
 request_id INTEGER NOT NULL REFERENCES photo_requests(id) ON DELETE CASCADE,
 view_index INTEGER NOT NULL,
 view_name TEXT NOT NULL,
 capture_id INTEGER UNIQUE REFERENCES captures(id) ON DELETE SET NULL,
 submitter_name TEXT NOT NULL DEFAULT '',
 note TEXT NOT NULL DEFAULT '',
 original_name TEXT NOT NULL,
 submitted_at TIMESTAMPTZ NOT NULL DEFAULT now(),
 UNIQUE(request_id,view_index)
);
CREATE TABLE IF NOT EXISTS photo_request_history (
 id SERIAL PRIMARY KEY,
 request_id INTEGER NOT NULL REFERENCES photo_requests(id) ON DELETE CASCADE,
 action TEXT NOT NULL,
 detail JSONB NOT NULL DEFAULT '{}',
 created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
