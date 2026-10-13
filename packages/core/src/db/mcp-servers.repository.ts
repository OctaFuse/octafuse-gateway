import type {
	InsertMcpItemParams,
	InsertMcpServerParams,
	McpCallableItem,
	McpItemKind,
	McpItemStatus,
	McpReviewState,
	McpServerItemRow,
	McpServerListRow,
	McpServerRow,
	McpServerStatus,
	McpToolPriceRow,
	UpdateMcpItemParams,
	UpdateMcpServerParams,
} from './mcp-types';

export type SqlExec = (query: string, params: unknown[]) => Promise<Array<Record<string, unknown>>>;

function text(value: unknown): string | null {
	if (value == null) return null;
	return String(value);
}

function asStatus(value: unknown): McpServerStatus {
	return value === 'disabled' ? 'disabled' : 'active';
}

function asKind(value: unknown): McpItemKind {
	if (value === 'prompt' || value === 'resource' || value === 'tool') return value;
	return 'tool';
}

function asItemStatus(value: unknown): McpItemStatus {
	if (value === 'enabled' || value === 'removed' || value === 'disabled') return value;
	return 'disabled';
}

function asReview(value: unknown): McpReviewState {
	if (value === 'new' || value === 'changed' || value === 'none') return value;
	return 'none';
}

export function mapMcpServer(row: Record<string, unknown>): McpServerRow {
	return {
		id: String(row.id),
		slug: String(row.slug),
		name: String(row.name),
		description: text(row.description),
		url: String(row.url ?? ''),
		authHeaders: String(row.auth_headers ?? '{}'),
		status: asStatus(row.status),
		pricing: String(row.pricing ?? ''),
		timeoutMs: Number(row.timeout_ms ?? 30000),
		maxResponseBytes: Number(row.max_response_bytes ?? 1048576),
		serverInfo: text(row.server_info),
		lastSyncedAt: text(row.last_synced_at),
		lastSyncError: text(row.last_sync_error),
		lastSyncSummary: text(row.last_sync_summary),
		createdAt: String(row.created_at ?? ''),
		updatedAt: String(row.updated_at ?? ''),
	};
}

export function mapMcpItem(row: Record<string, unknown>): McpServerItemRow {
	return {
		id: String(row.id),
		serverId: String(row.server_id),
		kind: asKind(row.kind),
		upstreamKey: String(row.upstream_key ?? ''),
		upstreamKeyHash: String(row.upstream_key_hash ?? ''),
		exposedName: String(row.exposed_name ?? ''),
		exposedNameHash: String(row.exposed_name_hash ?? ''),
		definition: String(row.definition ?? '{}'),
		contentHash: String(row.content_hash ?? ''),
		pendingDefinition: text(row.pending_definition),
		pendingHash: text(row.pending_hash),
		reviewState: asReview(row.review_state),
		status: asItemStatus(row.status),
		pricing: text(row.pricing),
		syncedAt: String(row.synced_at ?? ''),
	};
}

const SERVER_COLUMNS = `id, slug, name, description, url, auth_headers, status, pricing,
	timeout_ms, max_response_bytes, server_info, last_synced_at, last_sync_error, last_sync_summary,
	created_at, updated_at`;

const ITEM_COLUMNS = `id, server_id, kind, upstream_key, upstream_key_hash, exposed_name, exposed_name_hash,
	definition, content_hash, pending_definition, pending_hash, review_state, status, pricing, synced_at`;

function mapCallable(row: Record<string, unknown>): McpCallableItem {
	return {
		...mapMcpItem(row),
		slug: String(row.slug),
		serverStatus: asStatus(row.server_status),
		url: String(row.url ?? ''),
		authHeaders: String(row.auth_headers ?? '{}'),
		timeoutMs: Number(row.timeout_ms ?? 30000),
		maxResponseBytes: Number(row.max_response_bytes ?? 1048576),
		defaultPricing: String(row.default_pricing ?? ''),
	};
}

const CALLABLE_SELECT = `
	SELECT i.id, i.server_id, i.kind, i.upstream_key, i.upstream_key_hash, i.exposed_name, i.exposed_name_hash,
		i.definition, i.content_hash, i.pending_definition, i.pending_hash, i.review_state, i.status,
		i.pricing, i.synced_at,
		s.slug, s.status AS server_status, s.url, s.auth_headers, s.timeout_ms, s.max_response_bytes,
		s.pricing AS default_pricing
	FROM mcp_server_items i
	JOIN mcp_servers s ON s.id = i.server_id
`;

export function createMcpServersSqlRepository(exec: SqlExec) {
	return {
		async listServers(): Promise<McpServerListRow[]> {
			const rows = await exec(
				`SELECT ${SERVER_COLUMNS},
					(SELECT COUNT(*) FROM mcp_server_items i WHERE i.server_id = mcp_servers.id AND i.status = 'enabled') AS enabled_count,
					(SELECT COUNT(*) FROM mcp_server_items i WHERE i.server_id = mcp_servers.id AND i.review_state <> 'none' AND i.status <> 'removed') AS pending_count
				 FROM mcp_servers ORDER BY created_at DESC`,
				[],
			);
			return rows.map((row) => ({
				...mapMcpServer(row),
				enabledCount: Number(row.enabled_count ?? 0),
				pendingCount: Number(row.pending_count ?? 0),
			}));
		},
		async getServerById(id: string): Promise<McpServerRow | null> {
			const rows = await exec(`SELECT ${SERVER_COLUMNS} FROM mcp_servers WHERE id = ?`, [id]);
			return rows[0] ? mapMcpServer(rows[0]) : null;
		},
		async getServerBySlug(slug: string): Promise<McpServerRow | null> {
			const rows = await exec(`SELECT ${SERVER_COLUMNS} FROM mcp_servers WHERE slug = ?`, [slug]);
			return rows[0] ? mapMcpServer(rows[0]) : null;
		},
		async insertServer(params: InsertMcpServerParams): Promise<void> {
			const now = new Date().toISOString();
			await exec(
				`INSERT INTO mcp_servers (
					id, slug, name, description, url, auth_headers, status, pricing,
					timeout_ms, max_response_bytes, created_at, updated_at
				) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
				[
					params.id,
					params.slug,
					params.name,
					params.description,
					params.url,
					params.authHeaders,
					params.status ?? 'active',
					params.pricing,
					params.timeoutMs,
					params.maxResponseBytes,
					now,
					now,
				],
			);
		},
		async updateServer(id: string, patch: UpdateMcpServerParams): Promise<boolean> {
			const sets: string[] = [];
			const params: unknown[] = [];
			const assign = (column: string, value: unknown) => {
				sets.push(`${column} = ?`);
				params.push(value);
			};
			if (patch.name !== undefined) assign('name', patch.name);
			if (patch.description !== undefined) assign('description', patch.description);
			if (patch.url !== undefined) assign('url', patch.url);
			if (patch.authHeaders !== undefined) assign('auth_headers', patch.authHeaders);
			if (patch.status !== undefined) assign('status', patch.status);
			if (patch.pricing !== undefined) assign('pricing', patch.pricing);
			if (patch.timeoutMs !== undefined) assign('timeout_ms', patch.timeoutMs);
			if (patch.maxResponseBytes !== undefined) assign('max_response_bytes', patch.maxResponseBytes);
			if (patch.serverInfo !== undefined) assign('server_info', patch.serverInfo);
			if (patch.lastSyncedAt !== undefined) assign('last_synced_at', patch.lastSyncedAt);
			if (patch.lastSyncError !== undefined) assign('last_sync_error', patch.lastSyncError);
			if (patch.lastSyncSummary !== undefined) assign('last_sync_summary', patch.lastSyncSummary);
			if (sets.length === 0) return false;
			const existing = await exec('SELECT id FROM mcp_servers WHERE id = ?', [id]);
			if (!existing[0]) return false;
			assign('updated_at', new Date().toISOString());
			params.push(id);
			await exec(`UPDATE mcp_servers SET ${sets.join(', ')} WHERE id = ?`, params);
			return true;
		},
		async deleteServer(id: string): Promise<boolean> {
			const existing = await exec('SELECT id FROM mcp_servers WHERE id = ?', [id]);
			if (!existing[0]) return false;
			await exec('DELETE FROM mcp_server_items WHERE server_id = ?', [id]);
			await exec('DELETE FROM mcp_servers WHERE id = ?', [id]);
			return true;
		},
		async listItems(serverId: string): Promise<McpServerItemRow[]> {
			const rows = await exec(
				`SELECT ${ITEM_COLUMNS} FROM mcp_server_items WHERE server_id = ? ORDER BY kind, exposed_name`,
				[serverId],
			);
			return rows.map(mapMcpItem);
		},
		async listExposedNames(): Promise<string[]> {
			const rows = await exec('SELECT exposed_name FROM mcp_server_items', []);
			return rows.map((row) => String(row.exposed_name));
		},
		async insertItem(params: InsertMcpItemParams): Promise<void> {
			await exec(
				`INSERT INTO mcp_server_items (
					id, server_id, kind, upstream_key, upstream_key_hash, exposed_name, exposed_name_hash,
					definition, content_hash, review_state, status, synced_at
				) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
				[
					params.id,
					params.serverId,
					params.kind,
					params.upstreamKey,
					params.upstreamKeyHash,
					params.exposedName,
					params.exposedNameHash,
					params.definition,
					params.contentHash,
					params.reviewState,
					params.status,
					params.syncedAt,
				],
			);
		},
		async updateItem(id: string, patch: UpdateMcpItemParams): Promise<boolean> {
			const sets: string[] = [];
			const params: unknown[] = [];
			const assign = (column: string, value: unknown) => {
				sets.push(`${column} = ?`);
				params.push(value);
			};
			if (patch.definition !== undefined) assign('definition', patch.definition);
			if (patch.contentHash !== undefined) assign('content_hash', patch.contentHash);
			if (patch.pendingDefinition !== undefined) assign('pending_definition', patch.pendingDefinition);
			if (patch.pendingHash !== undefined) assign('pending_hash', patch.pendingHash);
			if (patch.reviewState !== undefined) assign('review_state', patch.reviewState);
			if (patch.status !== undefined) assign('status', patch.status);
			if (patch.pricing !== undefined) assign('pricing', patch.pricing);
			if (patch.syncedAt !== undefined) assign('synced_at', patch.syncedAt);
			if (sets.length === 0) return false;
			const existing = await exec('SELECT id FROM mcp_server_items WHERE id = ?', [id]);
			if (!existing[0]) return false;
			params.push(id);
			await exec(`UPDATE mcp_server_items SET ${sets.join(', ')} WHERE id = ?`, params);
			return true;
		},
		async listCallable(slug?: string): Promise<McpCallableItem[]> {
			if (slug) {
				const rows = await exec(
					`${CALLABLE_SELECT} WHERE s.slug = ? AND s.status = 'active' AND i.status <> 'removed'`,
					[slug],
				);
				return rows.map(mapCallable);
			}
			const rows = await exec(
				`${CALLABLE_SELECT} WHERE s.status = 'active' AND i.status <> 'removed'`,
				[],
			);
			return rows.map(mapCallable);
		},
		async listEnabledToolPrices(): Promise<McpToolPriceRow[]> {
			const rows = await exec(
				`SELECT s.slug, i.upstream_key, i.exposed_name, COALESCE(i.pricing, s.pricing) AS pricing
				 FROM mcp_server_items i
				 JOIN mcp_servers s ON s.id = i.server_id
				 WHERE s.status = 'active' AND i.status = 'enabled' AND i.kind = 'tool'
				 ORDER BY i.exposed_name`,
				[],
			);
			return rows.map((row) => ({
				slug: String(row.slug),
				upstreamKey: String(row.upstream_key),
				exposedName: String(row.exposed_name),
				pricing: String(row.pricing ?? ''),
			}));
		},
	};
}

export type McpServersRepository = ReturnType<typeof createMcpServersSqlRepository>;
