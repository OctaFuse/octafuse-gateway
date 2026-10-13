/**
 * Admin MCP server lifecycle: validate operator input, sync upstream catalogs, mask secrets.
 */
import {
	assertMcpSlug,
	assertMcpUpstreamUrl,
	clearMcpUpstreamSession,
	McpPricingRuleError,
	maskMcpUrl,
	parseMcpAuthHeaders,
	parseMcpPricingRule,
	parseStoredMcpPricingRule,
	perCallMcpPricingRule,
	planMcpSync,
	serializeMcpPricingRule,
	syncMcpUpstream,
	type GatewayRepositories,
	type McpItemStatus,
	type McpPricingRule,
	type McpServerListRow,
	type McpServerRow,
	type McpSyncSummary,
} from '@octafuse/core';
import { badRequest, conflict, notFound } from './errors';

const DEFAULT_TIMEOUT_MS = 30_000;
const DEFAULT_MAX_BYTES = 1_048_576;
const HEADER_NAME = /^[!#$%&'*+\-.^_`|~0-9A-Za-z]+$/;

export type McpServerPublic = Omit<McpServerListRow, 'url' | 'authHeaders' | 'pricing'> & {
	urlMasked: string;
	authHeaderNames: string[];
	/** null when the stored rule no longer parses; calls fail closed until it is saved again. */
	pricing: McpPricingRule | null;
};

export type CreateMcpServerInput = {
	slug?: unknown;
	name?: unknown;
	description?: unknown;
	url?: unknown;
	authHeaders?: unknown;
	status?: unknown;
	pricing?: unknown;
	timeoutMs?: unknown;
	maxResponseBytes?: unknown;
};

function asTrimmed(value: unknown, field: string, max: number): string {
	if (typeof value !== 'string' || !value.trim()) {
		throw badRequest(`${field} is required`);
	}
	const trimmed = value.trim();
	if (trimmed.length > max) {
		throw badRequest(`${field} is too long`);
	}
	return trimmed;
}

function asOptionalText(value: unknown, field: string, max: number): string | null | undefined {
	if (value === undefined) return undefined;
	if (value === null || value === '') return null;
	return asTrimmed(value, field, max);
}

function asPricing(value: unknown): McpPricingRule {
	try {
		return parseMcpPricingRule(value);
	} catch (error) {
		if (error instanceof McpPricingRuleError) throw badRequest(error.message);
		throw error;
	}
}

function storedPricing(raw: string): McpPricingRule | null {
	try {
		return parseStoredMcpPricingRule(raw);
	} catch {
		return null;
	}
}

function asPositiveInt(value: unknown, field: string, fallback: number, max: number): number {
	if (value === undefined || value === null || value === '') return fallback;
	const parsed = typeof value === 'number' ? value : Number(value);
	if (!Number.isInteger(parsed) || parsed < 1000 || parsed > max) {
		throw badRequest(`${field} is out of range`);
	}
	return parsed;
}

function asHeaders(value: unknown): Record<string, string> {
	if (value === undefined || value === null) return {};
	if (!value || typeof value !== 'object' || Array.isArray(value)) {
		throw badRequest('authHeaders must be an object');
	}
	const entries = Object.entries(value);
	if (entries.length > 20) {
		throw badRequest('authHeaders has too many entries');
	}
	const headers: Record<string, string> = {};
	for (const [key, headerValue] of entries) {
		if (!HEADER_NAME.test(key) || /^(host|content-length|connection|transfer-encoding)$/i.test(key)) {
			throw badRequest(`Invalid auth header name: ${key}`);
		}
		if (typeof headerValue !== 'string' || headerValue.length > 4096) {
			throw badRequest(`Invalid auth header value: ${key}`);
		}
		headers[key] = headerValue;
	}
	return headers;
}

function asStatus(value: unknown): 'active' | 'disabled' | undefined {
	if (value === undefined) return undefined;
	if (value === 'active' || value === 'disabled') return value;
	throw badRequest('status must be active or disabled');
}

function publicServer(row: McpServerRow & { enabledCount?: number; pendingCount?: number }): McpServerPublic {
	return {
		...stripSecrets(row),
		enabledCount: row.enabledCount ?? 0,
		pendingCount: row.pendingCount ?? 0,
	};
}

function stripSecrets<T extends McpServerRow>(
	row: T
): Omit<T, 'url' | 'authHeaders' | 'pricing'> & {
	urlMasked: string;
	authHeaderNames: string[];
	pricing: McpPricingRule | null;
} {
	const { url, authHeaders, pricing, ...rest } = row;
	return {
		...rest,
		urlMasked: maskMcpUrl(url),
		authHeaderNames: Object.keys(parseMcpAuthHeaders(authHeaders)),
		pricing: storedPricing(pricing),
	};
}

export async function listMcpServers(repos: GatewayRepositories): Promise<McpServerPublic[]> {
	const rows = await repos.mcpServers.listServers();
	return rows.map((row) => publicServer(row));
}

export async function getMcpServer(repos: GatewayRepositories, id: string) {
	const server = await repos.mcpServers.getServerById(id);
	if (!server) throw notFound('MCP server not found');
	const items = await repos.mcpServers.listItems(id);
	return {
		server: stripSecrets(server),
		items: items.map((item) => ({
			...item,
			pricing: item.pricing ? storedPricing(item.pricing) : null,
			definition: safeJson(item.definition),
			pendingDefinition: item.pendingDefinition ? safeJson(item.pendingDefinition) : null,
		})),
	};
}

function safeJson(raw: string): unknown {
	try {
		return JSON.parse(raw) as unknown;
	} catch {
		return raw;
	}
}

export async function createMcpServer(repos: GatewayRepositories, input: CreateMcpServerInput) {
	let slug: string;
	try {
		slug = assertMcpSlug(asTrimmed(input.slug, 'slug', 40));
	} catch (error) {
		throw badRequest(error instanceof Error ? error.message : 'Invalid slug');
	}
	const name = asTrimmed(input.name, 'name', 120);
	const description = asOptionalText(input.description, 'description', 2000) ?? null;
	let url: string;
	try {
		url = assertMcpUpstreamUrl(asTrimmed(input.url, 'url', 2048)).toString();
	} catch (error) {
		throw badRequest(error instanceof Error ? error.message : 'Invalid URL');
	}
	const existing = await repos.mcpServers.getServerBySlug(slug);
	if (existing) throw conflict('MCP slug already exists');
	const id = crypto.randomUUID();
	await repos.mcpServers.insertServer({
		id,
		slug,
		name,
		description,
		url,
		authHeaders: JSON.stringify(asHeaders(input.authHeaders)),
		status: asStatus(input.status) ?? 'active',
		pricing: serializeMcpPricingRule(
			input.pricing === undefined ? perCallMcpPricingRule(0, 0) : asPricing(input.pricing)
		),
		timeoutMs: asPositiveInt(input.timeoutMs, 'timeoutMs', DEFAULT_TIMEOUT_MS, 120_000),
		maxResponseBytes: asPositiveInt(input.maxResponseBytes, 'maxResponseBytes', DEFAULT_MAX_BYTES, 8_000_000),
	});
	return { id, slug };
}

export async function updateMcpServer(repos: GatewayRepositories, id: string, input: CreateMcpServerInput) {
	const current = await repos.mcpServers.getServerById(id);
	if (!current) throw notFound('MCP server not found');
	const patch: Parameters<GatewayRepositories['mcpServers']['updateServer']>[1] = {};
	if (input.name !== undefined) patch.name = asTrimmed(input.name, 'name', 120);
	if (input.description !== undefined)
		patch.description = asOptionalText(input.description, 'description', 2000) ?? null;
	if (input.url !== undefined) {
		try {
			patch.url = assertMcpUpstreamUrl(asTrimmed(input.url, 'url', 2048)).toString();
		} catch (error) {
			throw badRequest(error instanceof Error ? error.message : 'Invalid URL');
		}
	}
	if (input.authHeaders !== undefined) {
		const incoming = asHeaders(input.authHeaders);
		const currentHeaders = parseMcpAuthHeaders(current.authHeaders);
		const merged: Record<string, string> = {};
		for (const [key, value] of Object.entries(incoming)) {
			if (value === '') {
				const kept = currentHeaders[key];
				if (kept === undefined) throw badRequest(`auth header ${key} needs a value`);
				merged[key] = kept;
			} else {
				merged[key] = value;
			}
		}
		patch.authHeaders = JSON.stringify(merged);
	}
	if (input.status !== undefined) {
		const status = asStatus(input.status);
		if (!status) throw badRequest('status is required');
		patch.status = status;
	}
	if (input.pricing !== undefined) patch.pricing = serializeMcpPricingRule(asPricing(input.pricing));
	if (input.timeoutMs !== undefined)
		patch.timeoutMs = asPositiveInt(input.timeoutMs, 'timeoutMs', DEFAULT_TIMEOUT_MS, 120_000);
	if (input.maxResponseBytes !== undefined) {
		patch.maxResponseBytes = asPositiveInt(
			input.maxResponseBytes,
			'maxResponseBytes',
			DEFAULT_MAX_BYTES,
			8_000_000
		);
	}
	if (patch.url || patch.authHeaders) {
		clearMcpUpstreamSession(id);
	}
	await repos.mcpServers.updateServer(id, patch);
	return { id };
}

export async function deleteMcpServer(repos: GatewayRepositories, id: string) {
	clearMcpUpstreamSession(id);
	const deleted = await repos.mcpServers.deleteServer(id);
	if (!deleted) throw notFound('MCP server not found');
}

export async function revealMcpServer(repos: GatewayRepositories, id: string) {
	const server = await repos.mcpServers.getServerById(id);
	if (!server) throw notFound('MCP server not found');
	return { url: server.url, authHeaders: parseMcpAuthHeaders(server.authHeaders) };
}

function upstreamTarget(server: McpServerRow) {
	return {
		serverId: server.id,
		url: server.url,
		authHeaders: parseMcpAuthHeaders(server.authHeaders),
		timeoutMs: server.timeoutMs,
		maxResponseBytes: server.maxResponseBytes,
	};
}

export async function testMcpServer(repos: GatewayRepositories, id: string) {
	const server = await repos.mcpServers.getServerById(id);
	if (!server) throw notFound('MCP server not found');
	try {
		const catalog = await syncMcpUpstream(upstreamTarget(server));
		return {
			ok: true as const,
			protocolVersion: catalog.protocolVersion,
			serverInfo: catalog.serverInfo,
			counts: {
				tools: catalog.entries.filter((entry) => entry.kind === 'tool').length,
				prompts: catalog.entries.filter((entry) => entry.kind === 'prompt').length,
				resources: catalog.entries.filter((entry) => entry.kind === 'resource').length,
			},
		};
	} catch (error) {
		throw badRequest(error instanceof Error ? error.message : 'MCP connection failed');
	}
}

export async function syncMcpServer(repos: GatewayRepositories, id: string): Promise<McpSyncSummary> {
	const server = await repos.mcpServers.getServerById(id);
	if (!server) throw notFound('MCP server not found');
	const now = new Date().toISOString();
	try {
		const catalog = await syncMcpUpstream(upstreamTarget(server));
		const existing = await repos.mcpServers.listItems(id);
		const used = new Set(await repos.mcpServers.listExposedNames());
		for (const item of existing) {
			used.delete(item.exposedName);
		}
		const plan = await planMcpSync({
			slug: server.slug,
			existing,
			incoming: catalog.entries,
			usedExposedNames: used,
		});
		for (const insert of plan.inserts) {
			await repos.mcpServers.insertItem({
				id: crypto.randomUUID(),
				serverId: id,
				...insert,
				syncedAt: now,
			});
		}
		for (const update of plan.updates) {
			await repos.mcpServers.updateItem(update.id, { ...update, syncedAt: now });
		}
		const summary = plan.summary;
		await repos.mcpServers.updateServer(id, {
			serverInfo: JSON.stringify(catalog.serverInfo ?? null),
			lastSyncedAt: now,
			lastSyncError: null,
			lastSyncSummary: JSON.stringify(summary),
		});
		console.info('[mcp-sync]', { slug: server.slug, ...summaryCounts(summary) });
		return summary;
	} catch (error) {
		const message = error instanceof Error ? error.message : 'MCP sync failed';
		await repos.mcpServers.updateServer(id, { lastSyncError: message, lastSyncedAt: now });
		console.info('[mcp-sync]', { slug: server.slug, error: message });
		throw badRequest(message);
	}
}

function summaryCounts(summary: McpSyncSummary) {
	return {
		added: summary.added.length,
		changed: summary.changed.length,
		removed: summary.removed.length,
		unchanged: summary.unchanged,
	};
}

export async function setMcpItemStatus(
	repos: GatewayRepositories,
	serverId: string,
	ids: unknown,
	status: unknown
) {
	if (status !== 'enabled' && status !== 'disabled') {
		throw badRequest('status must be enabled or disabled');
	}
	if (!Array.isArray(ids) || ids.some((id) => typeof id !== 'string')) {
		throw badRequest('ids must be a string array');
	}
	const server = await repos.mcpServers.getServerById(serverId);
	if (!server) throw notFound('MCP server not found');
	const items = await repos.mcpServers.listItems(serverId);
	const allowed = new Set(items.map((item) => item.id));
	let updated = 0;
	for (const id of ids as string[]) {
		if (!allowed.has(id)) continue;
		const item = items.find((row) => row.id === id);
		if (!item || item.status === 'removed') continue;
		const reviewState = status === 'enabled' && item.reviewState === 'new' ? 'none' : item.reviewState;
		await repos.mcpServers.updateItem(id, { status: status as McpItemStatus, reviewState });
		updated += 1;
	}
	return { updated };
}

/** `pricing: null` restores the server default; an object replaces it entirely. */
export async function setMcpItemPricing(
	repos: GatewayRepositories,
	serverId: string,
	itemId: string,
	input: { pricing?: unknown }
) {
	if (input.pricing === undefined) throw badRequest('pricing is required');
	const items = await repos.mcpServers.listItems(serverId);
	const item = items.find((row) => row.id === itemId);
	if (!item) throw notFound('MCP item not found');
	if (item.kind !== 'tool') throw badRequest('Only tools have a price');
	await repos.mcpServers.updateItem(itemId, {
		pricing: input.pricing === null ? null : serializeMcpPricingRule(asPricing(input.pricing)),
	});
	return { id: itemId };
}

export async function acceptMcpItemChange(repos: GatewayRepositories, serverId: string, itemId: string) {
	const items = await repos.mcpServers.listItems(serverId);
	const item = items.find((row) => row.id === itemId);
	if (!item) throw notFound('MCP item not found');
	if (item.reviewState !== 'changed' || !item.pendingDefinition || !item.pendingHash) {
		throw badRequest('MCP item has no pending change');
	}
	await repos.mcpServers.updateItem(itemId, {
		definition: item.pendingDefinition,
		contentHash: item.pendingHash,
		pendingDefinition: null,
		pendingHash: null,
		reviewState: 'none',
	});
	return { id: itemId };
}
