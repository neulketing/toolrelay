CREATE TABLE IF NOT EXISTS keys (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  hash TEXT NOT NULL UNIQUE,          -- sha256 of the key; the key itself is shown once and never stored
  balance_micro INTEGER NOT NULL DEFAULT 0,  -- prepaid balance in micro-USD
  disabled INTEGER NOT NULL DEFAULT 0,
  created INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS calls (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  key_id TEXT,
  target TEXT NOT NULL,
  served_by TEXT,
  outcome TEXT NOT NULL,
  status INTEGER,
  cost_micro INTEGER NOT NULL DEFAULT 0,
  ts INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS calls_key_ts ON calls (key_id, ts);
