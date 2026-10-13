-- Remote MCP servers aggregated by the gateway MCP endpoint.
-- url and auth_headers are operator secrets. pricing is a JSON billing rule
-- (see packages/core/src/mcp/pricing.ts); an item rule replaces the server default.
-- InnoDB unique keys cannot index unbounded TEXT, so identity uses fixed hashes.

CREATE TABLE IF NOT EXISTS mcp_servers (
	id VARCHAR(128) PRIMARY KEY,
	slug VARCHAR(64) NOT NULL,
	name VARCHAR(255) NOT NULL,
	description TEXT,
	url TEXT NOT NULL,
	auth_headers TEXT NOT NULL,
	status VARCHAR(16) NOT NULL DEFAULT 'active',
	pricing TEXT NOT NULL,
	timeout_ms INT NOT NULL DEFAULT 30000,
	max_response_bytes INT NOT NULL DEFAULT 1048576,
	server_info TEXT,
	last_synced_at VARCHAR(40) NULL,
	last_sync_error TEXT,
	last_sync_summary TEXT,
	created_at VARCHAR(40) NOT NULL,
	updated_at VARCHAR(40) NOT NULL,
	UNIQUE KEY uk_mcp_servers_slug (slug),
	CONSTRAINT mcp_servers_status_chk CHECK (status IN ('active', 'disabled'))
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS mcp_server_items (
	id VARCHAR(128) PRIMARY KEY,
	server_id VARCHAR(128) NOT NULL,
	kind VARCHAR(16) NOT NULL,
	upstream_key TEXT NOT NULL,
	upstream_key_hash CHAR(64) NOT NULL,
	exposed_name TEXT NOT NULL,
	exposed_name_hash CHAR(64) NOT NULL,
	definition TEXT NOT NULL,
	content_hash CHAR(64) NOT NULL,
	pending_definition TEXT,
	pending_hash CHAR(64) NULL,
	review_state VARCHAR(16) NOT NULL DEFAULT 'none',
	status VARCHAR(16) NOT NULL DEFAULT 'disabled',
	pricing TEXT NULL,
	synced_at VARCHAR(40) NOT NULL,
	UNIQUE KEY uk_mcp_items_identity (server_id, kind, upstream_key_hash),
	UNIQUE KEY uk_mcp_items_exposed (exposed_name_hash),
	INDEX idx_mcp_server_items_server (server_id, status),
	CONSTRAINT mcp_items_server_fk FOREIGN KEY (server_id) REFERENCES mcp_servers(id) ON DELETE CASCADE,
	CONSTRAINT mcp_items_kind_chk CHECK (kind IN ('tool', 'prompt', 'resource')),
	CONSTRAINT mcp_items_review_chk CHECK (review_state IN ('none', 'new', 'changed')),
	CONSTRAINT mcp_items_status_chk CHECK (status IN ('enabled', 'disabled', 'removed'))
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
