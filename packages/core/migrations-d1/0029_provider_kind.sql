-- Provider kind: stable import-template name (or __custom__). Empty string means unclassified.
-- name stays the account alias. Uniqueness is (name, kind), not name alone.
-- SQLite cannot drop the inline UNIQUE on name, so rebuild providers.
-- defer_foreign_keys lets model_routes keep referencing providers across DROP + RENAME.
PRAGMA defer_foreign_keys = ON;

CREATE TABLE providers__kind (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  endpoints TEXT,
  api_key TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL DEFAULT 'active',
  description TEXT DEFAULT NULL,
  kind TEXT NOT NULL DEFAULT '',
  created_at TEXT DEFAULT (datetime('now'))
);

INSERT INTO providers__kind (id, name, endpoints, api_key, status, description, kind, created_at)
SELECT id, name, endpoints, api_key, status, description, '', created_at
FROM providers;

DROP TABLE providers;
ALTER TABLE providers__kind RENAME TO providers;

CREATE UNIQUE INDEX uk_providers_name_kind ON providers (name, kind);
