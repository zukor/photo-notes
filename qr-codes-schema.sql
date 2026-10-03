-- Optional physical-context links. No permissions are granted by a token.
CREATE TABLE IF NOT EXISTS photo_context_qr (
 target_type TEXT NOT NULL,
 target_id BIGINT NOT NULL,
 token TEXT NOT NULL UNIQUE,
 created_by BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
 disabled BOOLEAN NOT NULL DEFAULT false,
 updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
 PRIMARY KEY(target_type,target_id)
);
