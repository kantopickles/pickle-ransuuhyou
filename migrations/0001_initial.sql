PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS pickleball_shared_schedules (
  id TEXT PRIMARY KEY,
  payload TEXT NOT NULL,
  checked_matches TEXT NOT NULL DEFAULT '[]',
  updated_at TEXT NOT NULL,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS pickleball_share_edit_tokens (
  share_id TEXT PRIMARY KEY,
  token_hash TEXT NOT NULL,
  created_at TEXT NOT NULL,
  FOREIGN KEY (share_id) REFERENCES pickleball_shared_schedules(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS pickleball_shared_schedules_created_at_idx
  ON pickleball_shared_schedules (created_at DESC);

CREATE INDEX IF NOT EXISTS pickleball_share_edit_tokens_share_id_idx
  ON pickleball_share_edit_tokens (share_id);
