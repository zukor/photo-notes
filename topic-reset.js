// Owner-authorized, one-time reset of selectable topics. Saved captures and
// specialist property/HOA records are deliberately outside this migration.
module.exports.SQL = `
CREATE TABLE IF NOT EXISTS topic_list_resets (
  key TEXT PRIMARY KEY,
  completed_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  removed_count INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS topic_list_reset_backup (
  reset_key TEXT NOT NULL,
  user_id INTEGER NOT NULL,
  name TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL,
  user_added BOOLEAN NOT NULL,
  PRIMARY KEY (reset_key, user_id, name)
);
DO $$
DECLARE removed INTEGER;
BEGIN
  PERFORM pg_advisory_xact_lock(746031207);
  IF NOT EXISTS (SELECT 1 FROM topic_list_resets WHERE key='empty-account-topics-2026-10-07') THEN
    LOCK TABLE user_areas IN EXCLUSIVE MODE;
    INSERT INTO topic_list_reset_backup (reset_key,user_id,name,created_at,user_added)
      SELECT 'empty-account-topics-2026-10-07',user_id,name,created_at,user_added FROM user_areas;
    DELETE FROM user_areas;
    GET DIAGNOSTICS removed = ROW_COUNT;
    INSERT INTO topic_list_resets (key,removed_count) VALUES ('empty-account-topics-2026-10-07',removed);
    RAISE NOTICE 'Topic list reset completed: % selectable topics removed; saved capture tags preserved', removed;
  END IF;
END $$;
`;
