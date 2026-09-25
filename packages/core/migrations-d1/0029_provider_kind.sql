-- Provider kind: stable import-template name (or __custom__). Empty string means unclassified.
-- name stays the account alias. Uniqueness is (name, kind), not name alone.
-- SQLite cannot drop the inline UNIQUE on name, so rebuild providers.
-- DROP providers fails while model_routes still references it. Deferred checks
-- still fail at commit, because the pending parent deletes belong to the dropped
-- table and are not satisfied by a later rename. Copy the referencing tables onto
-- the new providers table first, then drop the unreferenced original.
-- route_pool_sticky_bindings references model_routes, so that table moves too.
-- Request logs are not foreign keys and stay untouched.

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

CREATE TABLE model_routes__kind (
  id TEXT PRIMARY KEY,
  model_id TEXT NOT NULL REFERENCES models(id),
  provider_id TEXT NOT NULL REFERENCES providers__kind(id),
  provider_model_name TEXT NOT NULL,
  upstream_protocol TEXT NOT NULL DEFAULT 'openai',
  route_group TEXT NOT NULL DEFAULT 'default',
  priority INTEGER DEFAULT 0,
  status TEXT DEFAULT 'active',
  price_override TEXT DEFAULT NULL,
  custom_params TEXT DEFAULT NULL,
  created_at TEXT DEFAULT (datetime('now')),
  weight INTEGER NOT NULL DEFAULT 1,
  route_pool_id TEXT REFERENCES route_pools(id),
  upstream_operation TEXT NOT NULL DEFAULT '*',
  adapter TEXT NOT NULL DEFAULT 'passthrough'
);

INSERT INTO model_routes__kind (
  id, model_id, provider_id, provider_model_name, upstream_protocol, route_group,
  priority, status, price_override, custom_params, created_at, weight,
  route_pool_id, upstream_operation, adapter
)
SELECT
  id, model_id, provider_id, provider_model_name, upstream_protocol, route_group,
  priority, status, price_override, custom_params, created_at, weight,
  route_pool_id, upstream_operation, adapter
FROM model_routes;

CREATE TABLE route_pool_sticky_bindings__kind (
  route_pool_id TEXT NOT NULL REFERENCES route_pools(id) ON DELETE CASCADE,
  affinity_hash TEXT NOT NULL,
  route_target_id TEXT NOT NULL REFERENCES model_routes__kind(id) ON DELETE CASCADE,
  binding_token TEXT NOT NULL,
  pool_epoch INTEGER NOT NULL DEFAULT 0,
  expires_at TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  PRIMARY KEY (route_pool_id, affinity_hash)
);

INSERT INTO route_pool_sticky_bindings__kind (
  route_pool_id, affinity_hash, route_target_id, binding_token, pool_epoch,
  expires_at, created_at, updated_at
)
SELECT
  route_pool_id, affinity_hash, route_target_id, binding_token, pool_epoch,
  expires_at, created_at, updated_at
FROM route_pool_sticky_bindings;

DROP TABLE route_pool_sticky_bindings;
ALTER TABLE route_pool_sticky_bindings__kind RENAME TO route_pool_sticky_bindings;

DROP TABLE model_routes;
ALTER TABLE model_routes__kind RENAME TO model_routes;

DROP TABLE providers;
ALTER TABLE providers__kind RENAME TO providers;

CREATE UNIQUE INDEX uk_providers_name_kind ON providers (name, kind);

CREATE INDEX idx_model_routes_model_status_group_priority
  ON model_routes(model_id, status, route_group, priority);
CREATE INDEX idx_model_routes_pool_status_priority
  ON model_routes(route_pool_id, status, priority);
CREATE INDEX idx_route_pool_sticky_expires_at
  ON route_pool_sticky_bindings(expires_at);
CREATE INDEX idx_route_pool_sticky_target
  ON route_pool_sticky_bindings(route_target_id);
