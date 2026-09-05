-- "Keep the video": links whose original file should be downloaded to the laptop by the runner, nothing else.
CREATE TABLE IF NOT EXISTS keeps (
  id TEXT PRIMARY KEY,
  url TEXT NOT NULL UNIQUE,
  platform TEXT NOT NULL,
  title TEXT,
  requested_by TEXT REFERENCES "user"("id") ON DELETE SET NULL,
  status TEXT NOT NULL DEFAULT 'pending',   -- pending | downloading | done | failed
  filename TEXT,
  bytes INTEGER,
  error TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_keeps_status ON keeps(status);
