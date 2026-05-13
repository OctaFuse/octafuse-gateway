-- MySQL 8 baseline schema（本文件位于 packages/core/migrations-mysql/，与 migrations-postgres/ 并列）。
-- Tables/columns/indexes align with packages/core/migrations-postgres/0001_baseline.sql。
-- PK / UNIQUE / FK 列使用 VARCHAR（MySQL InnoDB 不允许无前缀长度的 TEXT/BLOB 作为键）。
-- New MySQL databases should start from this file.

SET NAMES utf8mb4;

CREATE TABLE users (
  id VARCHAR(512) NOT NULL,
  email VARCHAR(512),
  budget_max DECIMAL(18, 6),
  budget_base DECIMAL(18, 6) NOT NULL DEFAULT 0,
  budget_spent DECIMAL(18, 6) NOT NULL DEFAULT 0,
  budget_period VARCHAR(64) NOT NULL DEFAULT 'none',
  budget_reset_at DATETIME(6),
  status VARCHAR(32) NOT NULL DEFAULT 'active',
  metadata TEXT,
  external_system VARCHAR(128),
  external_user_id VARCHAR(512),
  created_at DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  updated_at DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  PRIMARY KEY (id),
  CONSTRAINT users_external_pair_chk CHECK (
    (external_system IS NULL AND external_user_id IS NULL)
    OR (external_system IS NOT NULL AND external_user_id IS NOT NULL)
  ),
  UNIQUE KEY uk_users_external_system_user_id (external_system, external_user_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE api_keys (
  id VARCHAR(512) NOT NULL,
  `key` VARCHAR(767) NOT NULL,
  user_id VARCHAR(512) NOT NULL,
  name VARCHAR(512),
  status VARCHAR(32) NOT NULL DEFAULT 'active',
  metadata TEXT,
  last_used_at DATETIME(6),
  created_at DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  updated_at DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  PRIMARY KEY (id),
  UNIQUE KEY uk_api_keys_key (`key`),
  CONSTRAINT fk_api_keys_user FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE providers (
  id VARCHAR(512) NOT NULL,
  name VARCHAR(512) NOT NULL,
  base_url_openai TEXT,
  base_url_anthropic TEXT,
  base_url_gemini TEXT,
  api_key TEXT NOT NULL,
  description TEXT,
  created_at DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  PRIMARY KEY (id),
  UNIQUE KEY uk_providers_name (name)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE models (
  id VARCHAR(512) NOT NULL,
  display_name TEXT,
  vendor VARCHAR(64) NOT NULL DEFAULT 'other',
  context_window INT,
  max_tokens INT NOT NULL DEFAULT 8192,
  supports_images INT NOT NULL DEFAULT 0,
  -- pricing_profile: TEXT JSON — 模型标准价/阶梯（canonical { tiers }）；与 Drizzle 一致
  pricing_profile TEXT,
  description TEXT,
  metadata TEXT,
  created_at DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  PRIMARY KEY (id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE model_tags (
  model_id VARCHAR(512) NOT NULL,
  tag VARCHAR(255) NOT NULL,
  PRIMARY KEY (model_id, tag),
  CONSTRAINT fk_model_tags_model FOREIGN KEY (model_id) REFERENCES models (id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE model_routes (
  id VARCHAR(512) NOT NULL,
  model_id VARCHAR(512) NOT NULL,
  provider_id VARCHAR(512) NOT NULL,
  provider_model_name TEXT NOT NULL,
  upstream_protocol VARCHAR(32) NOT NULL DEFAULT 'openai',
  route_group VARCHAR(64) NOT NULL DEFAULT 'default',
  priority INT NOT NULL DEFAULT 0,
  status VARCHAR(32) NOT NULL DEFAULT 'active',
  price_override TEXT,
  custom_params TEXT,
  created_at DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  PRIMARY KEY (id),
  CONSTRAINT fk_model_routes_model FOREIGN KEY (model_id) REFERENCES models (id),
  CONSTRAINT fk_model_routes_provider FOREIGN KEY (provider_id) REFERENCES providers (id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE api_key_request_logs (
  id VARCHAR(512) NOT NULL,
  user_id VARCHAR(512),
  api_key_id VARCHAR(512),
  user_email VARCHAR(512),
  model_id VARCHAR(512),
  model_name TEXT,
  provider_id VARCHAR(512),
  provider_name TEXT,
  provider_model_name TEXT,
  request_body TEXT,
  upstream_request_body TEXT,
  request_protocol VARCHAR(32),
  upstream_protocol VARCHAR(32) NOT NULL DEFAULT 'openai',
  route_group VARCHAR(64) NOT NULL DEFAULT 'default',
  input_tokens INT NOT NULL DEFAULT 0,
  output_tokens INT NOT NULL DEFAULT 0,
  reasoning_tokens INT NOT NULL DEFAULT 0,
  cache_read_tokens INT NOT NULL DEFAULT 0,
  cache_write_tokens INT NOT NULL DEFAULT 0,
  total_tokens INT NOT NULL DEFAULT 0,
  standard_cost DECIMAL(18, 6) NOT NULL DEFAULT 0,
  metered_cost DECIMAL(18, 6) NOT NULL DEFAULT 0,
  charged_cost DECIMAL(18, 6) NOT NULL DEFAULT 0,
  status VARCHAR(32) NOT NULL DEFAULT 'success',
  latency_ms INT,
  error_message TEXT,
  raw_usage TEXT,
  -- pricing_audit: TEXT，JSON 字符串；结构见 packages/core/src/db/pricing-audit.ts（v1: v, basis_tokens?, tier?, snapshot?）
  pricing_audit TEXT NULL,
  created_at DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  PRIMARY KEY (id),
  CONSTRAINT fk_api_key_request_logs_user FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE SET NULL,
  CONSTRAINT fk_api_key_request_logs_api_key FOREIGN KEY (api_key_id) REFERENCES api_keys (id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE system_config (
  `key` VARCHAR(255) NOT NULL,
  value TEXT NOT NULL,
  description TEXT,
  updated_at DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  PRIMARY KEY (`key`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE user_audit_logs (
  id VARCHAR(512) NOT NULL,
  user_id VARCHAR(512) NOT NULL,
  api_key_id VARCHAR(512),
  event_type VARCHAR(64) NOT NULL,
  actor_type VARCHAR(32) NOT NULL DEFAULT 'system',
  before_spent DECIMAL(18, 6) NOT NULL,
  delta_spent DECIMAL(18, 6) NOT NULL,
  after_spent DECIMAL(18, 6) NOT NULL,
  before_budget_max DECIMAL(18, 6),
  after_budget_max DECIMAL(18, 6),
  request_log_id VARCHAR(512),
  metadata TEXT,
  created_at DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  PRIMARY KEY (id),
  CONSTRAINT fk_user_audit_user FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE CASCADE,
  CONSTRAINT fk_user_audit_api_key FOREIGN KEY (api_key_id) REFERENCES api_keys (id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

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
