-- Baseline schema (replaces historical 0001–0019). New databases only via wrangler apply.
-- Column order: identity / FKs → main fields → JSON / extensions → timestamps.
-- Existing DBs that already applied the old chain: register this file in d1_migrations without executing; see docs/ops-d1-baseline-migration.md

-- API keys
CREATE TABLE api_keys (
  id TEXT PRIMARY KEY,
  key TEXT NOT NULL UNIQUE,
  user_id TEXT NOT NULL,
  user_email TEXT,
  budget_max REAL DEFAULT 0,
  budget_base REAL DEFAULT 0,
  budget_spent REAL DEFAULT 0,
  budget_period TEXT DEFAULT NULL,
  budget_reset_at TEXT DEFAULT NULL,
  status TEXT DEFAULT 'active',
  metadata TEXT DEFAULT NULL,
  created_at TEXT DEFAULT (datetime('now')),
  updated_at TEXT DEFAULT (datetime('now'))
);

-- Upstream providers
CREATE TABLE providers (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL UNIQUE,
  api_key TEXT NOT NULL,
  base_url_openai TEXT,
  base_url_anthropic TEXT,
  base_url_gemini TEXT,
  description TEXT DEFAULT NULL,
  created_at TEXT DEFAULT (datetime('now'))
);

-- Models (tags in model_tags)
CREATE TABLE models (
  id TEXT PRIMARY KEY,
  display_name TEXT,
  vendor TEXT NOT NULL DEFAULT 'other',
  context_window INTEGER,
  max_tokens INTEGER DEFAULT 8192,
  supports_images INTEGER DEFAULT 0,
  /* pricing_profile: TEXT JSON — 模型标准价/阶梯（canonical { tiers }；列价真源） */
  pricing_profile TEXT DEFAULT NULL,
  description TEXT DEFAULT NULL,
  metadata TEXT,
  created_at TEXT DEFAULT (datetime('now'))
);

CREATE TABLE model_tags (
  model_id TEXT NOT NULL REFERENCES models(id) ON DELETE CASCADE,
  tag TEXT NOT NULL,
  PRIMARY KEY (model_id, tag)
);

CREATE TABLE model_routes (
  id TEXT PRIMARY KEY,
  model_id TEXT NOT NULL REFERENCES models(id),
  provider_id TEXT NOT NULL REFERENCES providers(id),
  provider_model_name TEXT NOT NULL,
  upstream_protocol TEXT NOT NULL DEFAULT 'openai',
  route_group TEXT NOT NULL DEFAULT 'default',
  priority INTEGER DEFAULT 0,
  status TEXT DEFAULT 'active',
  price_override TEXT DEFAULT NULL,
  custom_params TEXT DEFAULT NULL,
  created_at TEXT DEFAULT (datetime('now'))
);

CREATE TABLE api_key_request_logs (
  id TEXT PRIMARY KEY,
  api_key_id TEXT,
  user_email TEXT,
  model_id TEXT,
  model_name TEXT,
  provider_id TEXT,
  provider_name TEXT,
  provider_model_name TEXT,
  request_body TEXT,
  upstream_request_body TEXT DEFAULT NULL,
  request_protocol TEXT NOT NULL DEFAULT 'openai',
  upstream_protocol TEXT NOT NULL DEFAULT 'openai',
  route_group TEXT NOT NULL DEFAULT 'default',
  input_tokens INTEGER DEFAULT 0,
  output_tokens INTEGER DEFAULT 0,
  reasoning_tokens INTEGER DEFAULT 0,
  cache_read_tokens INTEGER DEFAULT 0,
  cache_write_tokens INTEGER DEFAULT 0,
  total_tokens INTEGER DEFAULT 0,
  standard_cost REAL NOT NULL DEFAULT 0,
  metered_cost REAL NOT NULL DEFAULT 0,
  charged_cost REAL NOT NULL DEFAULT 0,
  status TEXT,
  latency_ms INTEGER,
  error_message TEXT,
  raw_usage TEXT DEFAULT NULL,
  /* pricing_audit: TEXT，存 JSON 字符串。结构约定见 packages/core/src/db/pricing-audit.ts
     v1 含: v, basis_tokens?, tier?, snapshot? — 演进时加键或升 v，避免再加列 */
  pricing_audit TEXT DEFAULT NULL,
  created_at TEXT DEFAULT (datetime('now'))
);

CREATE TABLE system_config (
  key TEXT PRIMARY KEY,
  value TEXT,
  description TEXT,
  updated_at TEXT DEFAULT (datetime('now'))
);

-- Indexes (final set after legacy redundant indexes removed)
CREATE INDEX idx_api_keys_user ON api_keys(user_id);

CREATE INDEX idx_api_key_request_logs_created ON api_key_request_logs(created_at);
CREATE INDEX idx_api_key_request_logs_key_created ON api_key_request_logs(api_key_id, created_at);
CREATE INDEX idx_api_key_request_logs_key_status ON api_key_request_logs(api_key_id, status);
CREATE INDEX idx_api_key_request_logs_key_charged_created ON api_key_request_logs(api_key_id, charged_cost, created_at);
CREATE INDEX idx_api_key_request_logs_model_created ON api_key_request_logs(model_id, created_at);
CREATE INDEX idx_api_key_request_logs_user_email_created ON api_key_request_logs(user_email, created_at);
CREATE INDEX idx_api_key_request_logs_status_created ON api_key_request_logs(status, created_at);

CREATE INDEX idx_model_routes_model_status_group_priority
  ON model_routes(model_id, status, route_group, priority);

-- API key audit trail (budget, usage, admin profile changes, etc.)
CREATE TABLE api_key_audit_logs (
  id TEXT PRIMARY KEY,
  api_key_id TEXT NOT NULL REFERENCES api_keys(id) ON DELETE CASCADE,
  event_type TEXT NOT NULL,
  actor_type TEXT NOT NULL DEFAULT 'system',
  actor_id TEXT DEFAULT NULL,
  reason_code TEXT DEFAULT NULL,
  reason_text TEXT DEFAULT NULL,
  before_spent REAL NOT NULL,
  delta_spent REAL NOT NULL,
  after_spent REAL NOT NULL,
  before_budget_max REAL DEFAULT NULL,
  after_budget_max REAL DEFAULT NULL,
  before_budget_base REAL DEFAULT NULL,
  after_budget_base REAL DEFAULT NULL,
  before_budget_period TEXT DEFAULT NULL,
  after_budget_period TEXT DEFAULT NULL,
  before_budget_reset_at TEXT DEFAULT NULL,
  after_budget_reset_at TEXT DEFAULT NULL,
  request_log_id TEXT DEFAULT NULL,
  metadata TEXT DEFAULT NULL,
  created_at TEXT DEFAULT (datetime('now'))
);

CREATE INDEX idx_api_key_audit_key_created
  ON api_key_audit_logs(api_key_id, created_at);

CREATE INDEX idx_api_key_audit_event_created
  ON api_key_audit_logs(event_type, created_at);

CREATE INDEX idx_api_key_audit_request_log
  ON api_key_audit_logs(request_log_id);
