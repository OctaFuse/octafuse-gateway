-- Remote MCP servers aggregated by the gateway MCP endpoint.
-- url and auth_headers are operator secrets. pricing is a JSON billing rule
-- (see packages/core/src/mcp/pricing.ts); an item rule replaces the server default.
SET search_path TO octafuse_gateway;

CREATE TABLE IF NOT EXISTS mcp_servers (
	id TEXT PRIMARY KEY,
	slug TEXT NOT NULL UNIQUE,
	name TEXT NOT NULL,
	description TEXT,
	url TEXT NOT NULL,
	auth_headers TEXT NOT NULL DEFAULT '{}',
	status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'disabled')),
	pricing TEXT NOT NULL,
	timeout_ms INTEGER NOT NULL DEFAULT 30000,
	max_response_bytes INTEGER NOT NULL DEFAULT 1048576,
	server_info TEXT,
	last_synced_at TEXT,
	last_sync_error TEXT,
	last_sync_summary TEXT,
	created_at TEXT NOT NULL,
	updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS mcp_server_items (
	id TEXT PRIMARY KEY,
	server_id TEXT NOT NULL REFERENCES mcp_servers(id) ON DELETE CASCADE,
	kind TEXT NOT NULL CHECK (kind IN ('tool', 'prompt', 'resource')),
	upstream_key TEXT NOT NULL,
	upstream_key_hash TEXT NOT NULL,
	exposed_name TEXT NOT NULL,
	exposed_name_hash TEXT NOT NULL UNIQUE,
	definition TEXT NOT NULL,
	content_hash TEXT NOT NULL,
	pending_definition TEXT,
	pending_hash TEXT,
	review_state TEXT NOT NULL DEFAULT 'none' CHECK (review_state IN ('none', 'new', 'changed')),
	status TEXT NOT NULL DEFAULT 'disabled' CHECK (status IN ('enabled', 'disabled', 'removed')),
	pricing TEXT,
	synced_at TEXT NOT NULL,
	UNIQUE (server_id, kind, upstream_key_hash)
);

CREATE INDEX IF NOT EXISTS idx_mcp_server_items_server ON mcp_server_items(server_id, status);
