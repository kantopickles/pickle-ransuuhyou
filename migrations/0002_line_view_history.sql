PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS pickleball_line_view_history (
  viewer_key TEXT NOT NULL,
  share_id TEXT NOT NULL,
  viewed_at TEXT NOT NULL,
  PRIMARY KEY (viewer_key, share_id),
  FOREIGN KEY (share_id) REFERENCES pickleball_shared_schedules(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS pickleball_line_view_history_viewer_recent_idx
  ON pickleball_line_view_history (viewer_key, viewed_at DESC, share_id DESC);

CREATE INDEX IF NOT EXISTS pickleball_line_view_history_viewed_at_idx
  ON pickleball_line_view_history (viewed_at);

CREATE INDEX IF NOT EXISTS pickleball_line_view_history_share_id_idx
  ON pickleball_line_view_history (share_id);
