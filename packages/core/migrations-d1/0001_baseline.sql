-- Baseline schema (replaces historical 0001–0019). New databases only via wrangler apply.
-- Column order: identity → main fields → metadata / upstream linkage → timestamps.
-- Existing DBs that already applied the old chain: register this file in d1_migrations without executing; see docs/ops-d1-baseline-migration.md

-- Gateway-owned users (budget lives here; api_keys.user_id → users.id)
-- 唯一约束（语义层面两组）：
--   1) (external_system, external_user_id) — 多上游幂等。二者须同空或同非空。
--   2) (external_system, email)            — 同一上游内 email 唯一；internal 用户
--      （external_system IS NULL）作为单独 namespace，email 在 internal 用户之间
--      也唯一。SQLite/D1 在普通 UNIQUE 中视 NULL 互不相等，故拆为两条 partial
--      unique index 实现。
-- email 必填；external_system 若设则不可为空字符串（保持 namespace 边界清晰）。
CREATE TABLE users (
  id TEXT PRIMARY KEY,
  email TEXT NOT NULL,
  budget_max REAL DEFAULT NULL,
  budget_base REAL NOT NULL DEFAULT 0,
  budget_spent REAL NOT NULL DEFAULT 0,
  budget_period TEXT NOT NULL DEFAULT 'none',
  budget_reset_at TEXT DEFAULT NULL,
  status TEXT NOT NULL DEFAULT 'active',
  metadata TEXT DEFAULT NULL,
  external_system TEXT,
  external_user_id TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  CHECK (
    (external_system IS NULL AND external_user_id IS NULL)
    OR (external_system IS NOT NULL AND external_user_id IS NOT NULL)
  ),
  CHECK (external_system IS NULL OR length(external_system) > 0)
);

CREATE UNIQUE INDEX uk_users_external_system_user_id ON users(external_system, external_user_id);
CREATE UNIQUE INDEX uk_users_external_system_email
  ON users(external_system, email)
  WHERE external_system IS NOT NULL;
CREATE UNIQUE INDEX uk_users_internal_email
  ON users(email)
  WHERE external_system IS NULL;

-- API keys (no budget columns; belong to users)
CREATE TABLE api_keys (
  id TEXT PRIMARY KEY,
  key TEXT NOT NULL UNIQUE,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name TEXT DEFAULT NULL,
  status TEXT NOT NULL DEFAULT 'active',
  metadata TEXT DEFAULT NULL,
  last_used_at TEXT DEFAULT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
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
  user_id TEXT REFERENCES users(id) ON DELETE SET NULL,
  api_key_id TEXT REFERENCES api_keys(id) ON DELETE SET NULL,
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

-- User-scoped audit trail (budget, profile, etc.; optional api_key_id for attribution)
CREATE TABLE user_audit_logs (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  api_key_id TEXT REFERENCES api_keys(id) ON DELETE SET NULL,
  event_type TEXT NOT NULL,
  actor_type TEXT NOT NULL DEFAULT 'system',
  before_spent REAL NOT NULL,
  delta_spent REAL NOT NULL,
  after_spent REAL NOT NULL,
  before_budget_max REAL DEFAULT NULL,
  after_budget_max REAL DEFAULT NULL,
  request_log_id TEXT DEFAULT NULL,
  metadata TEXT DEFAULT NULL,
  /* Full-row JSON snapshots + structured audit context (see user-audit-snapshot.ts) */
  before_user_snapshot TEXT DEFAULT NULL,
  after_user_snapshot TEXT DEFAULT NULL,
  changed_fields TEXT DEFAULT NULL,
  correlation_id TEXT DEFAULT NULL,
  source TEXT DEFAULT NULL,
  actor_id TEXT DEFAULT NULL,
  reason_code TEXT DEFAULT NULL,
  reason_text TEXT DEFAULT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Indexes
-- 注：(external_system, email) 与 (email WHERE external_system IS NULL) 已在表
-- 定义处加 partial UNIQUE；此处仍保留按 email 单列查询的非唯一索引。
CREATE INDEX idx_users_external_system ON users(external_system);
CREATE INDEX idx_users_external_user_id ON users(external_user_id);
CREATE INDEX idx_users_email ON users(email);
CREATE INDEX idx_users_status ON users(status);

CREATE INDEX idx_api_keys_user ON api_keys(user_id);
CREATE INDEX idx_api_keys_status ON api_keys(status);

CREATE INDEX idx_api_key_request_logs_created ON api_key_request_logs(created_at);
CREATE INDEX idx_api_key_request_logs_user_created ON api_key_request_logs(user_id, created_at);
CREATE INDEX idx_api_key_request_logs_key_created ON api_key_request_logs(api_key_id, created_at);
CREATE INDEX idx_api_key_request_logs_key_status ON api_key_request_logs(api_key_id, status);
CREATE INDEX idx_api_key_request_logs_key_charged_created ON api_key_request_logs(api_key_id, charged_cost, created_at);
CREATE INDEX idx_api_key_request_logs_user_charged_created ON api_key_request_logs(user_id, charged_cost, created_at);
CREATE INDEX idx_api_key_request_logs_model_created ON api_key_request_logs(model_id, created_at);
CREATE INDEX idx_api_key_request_logs_user_email_created ON api_key_request_logs(user_email, created_at);
CREATE INDEX idx_api_key_request_logs_status_created ON api_key_request_logs(status, created_at);

CREATE INDEX idx_model_routes_model_status_group_priority
  ON model_routes(model_id, status, route_group, priority);

CREATE INDEX idx_user_audit_user_created
  ON user_audit_logs(user_id, created_at);
CREATE INDEX idx_user_audit_key_created
  ON user_audit_logs(api_key_id, created_at);
CREATE INDEX idx_user_audit_event_created
  ON user_audit_logs(event_type, created_at);
CREATE INDEX idx_user_audit_request_log
  ON user_audit_logs(request_log_id);
CREATE INDEX idx_user_audit_correlation
  ON user_audit_logs(correlation_id);
CREATE INDEX idx_user_audit_source_created
  ON user_audit_logs(source, created_at);
