-- Postgres baseline schema（本文件位于 packages/core/migrations-postgres/，与 migrations-d1/ 下 D1 链并列）。
-- Tables/columns/indexes align with packages/core/migrations-d1/0001_baseline.sql (D1 baseline).
-- Nullability, defaults, and PG types align with packages/core/src/storage/drizzle/schema.pg.ts.
-- New Postgres databases should start from this file.

CREATE SCHEMA IF NOT EXISTS octafuse;
SET search_path TO octafuse_gateway;

CREATE TABLE api_keys (
  id TEXT PRIMARY KEY,
  key TEXT NOT NULL UNIQUE,
  user_id TEXT NOT NULL,
  user_email TEXT,
  budget_max NUMERIC(18, 6),
  budget_base NUMERIC(18, 6) NOT NULL DEFAULT 0,
  budget_spent NUMERIC(18, 6) NOT NULL DEFAULT 0,
  budget_period TEXT NOT NULL DEFAULT 'none',
  budget_reset_at TIMESTAMPTZ,
  status TEXT NOT NULL DEFAULT 'active',
  metadata TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE providers (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL UNIQUE,
  base_url_openai TEXT,
  base_url_anthropic TEXT,
  base_url_gemini TEXT,
  api_key TEXT NOT NULL,
  description TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE models (
  id TEXT PRIMARY KEY,
  display_name TEXT,
  vendor TEXT NOT NULL DEFAULT 'other',
  context_window INTEGER,
  max_tokens INTEGER NOT NULL DEFAULT 8192,
  supports_images INTEGER NOT NULL DEFAULT 0,
  -- pricing_profile: TEXT JSON — 模型标准价/阶梯（canonical { tiers }）；与 Drizzle 一致
  pricing_profile TEXT,
  description TEXT,
  metadata TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
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
  priority INTEGER NOT NULL DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'active',
  price_override TEXT,
  custom_params TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
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
  upstream_request_body TEXT,
  request_protocol TEXT,
  upstream_protocol TEXT NOT NULL DEFAULT 'openai',
  route_group TEXT NOT NULL DEFAULT 'default',
  input_tokens INTEGER NOT NULL DEFAULT 0,
  output_tokens INTEGER NOT NULL DEFAULT 0,
  reasoning_tokens INTEGER NOT NULL DEFAULT 0,
  cache_read_tokens INTEGER NOT NULL DEFAULT 0,
  cache_write_tokens INTEGER NOT NULL DEFAULT 0,
  total_tokens INTEGER NOT NULL DEFAULT 0,
  standard_cost NUMERIC(18, 6) NOT NULL DEFAULT 0,
  metered_cost NUMERIC(18, 6) NOT NULL DEFAULT 0,
  charged_cost NUMERIC(18, 6) NOT NULL DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'success',
  latency_ms INTEGER,
  error_message TEXT,
  raw_usage TEXT,
  -- pricing_audit: TEXT，JSON 字符串；结构约定见 packages/core/src/db/pricing-audit.ts（v1: v, basis_tokens?, tier?, snapshot?）
  pricing_audit TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE system_config (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL,
  description TEXT,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE api_key_audit_logs (
  id TEXT PRIMARY KEY,
  api_key_id TEXT NOT NULL REFERENCES api_keys(id) ON DELETE CASCADE,
  event_type TEXT NOT NULL,
  actor_type TEXT NOT NULL DEFAULT 'system',
  actor_id TEXT,
  reason_code TEXT,
  reason_text TEXT,
  before_spent NUMERIC(18, 6) NOT NULL,
  delta_spent NUMERIC(18, 6) NOT NULL,
  after_spent NUMERIC(18, 6) NOT NULL,
  before_budget_max NUMERIC(18, 6),
  after_budget_max NUMERIC(18, 6),
  before_budget_base NUMERIC(18, 6),
  after_budget_base NUMERIC(18, 6),
  before_budget_period TEXT,
  after_budget_period TEXT,
  before_budget_reset_at TIMESTAMPTZ,
  after_budget_reset_at TIMESTAMPTZ,
  request_log_id TEXT,
  metadata TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

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

CREATE INDEX idx_api_key_audit_key_created
  ON api_key_audit_logs(api_key_id, created_at);

CREATE INDEX idx_api_key_audit_event_created
  ON api_key_audit_logs(event_type, created_at);

CREATE INDEX idx_api_key_audit_request_log
  ON api_key_audit_logs(request_log_id);
