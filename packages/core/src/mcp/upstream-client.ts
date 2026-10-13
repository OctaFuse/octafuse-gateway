import type { McpItemKind } from '../db/mcp-types';
import type { McpCatalogEntry } from './sync-plan';
import { assertMcpUpstreamUrl } from './url-guard';

const PROTOCOL_CANDIDATES = ['2025-06-18', '2025-03-26'] as const;
const MAX_PAGES = 50;

export type McpUpstreamTarget = {
	serverId: string;
	url: string;
	authHeaders: Record<string, string>;
	timeoutMs: number;
	maxResponseBytes: number;
};

export type McpUpstreamCatalog = {
	serverInfo: unknown;
	protocolVersion: string;
	entries: McpCatalogEntry[];
};

type SessionState = {
	sessionId?: string;
	protocolVersion: string;
	url: string;
	headerFingerprint: string;
};

const sessions = new Map<string, SessionState>();

function headerFingerprint(headers: Record<string, string>): string {
	return Object.entries(headers)
		.sort(([left], [right]) => left.localeCompare(right))
		.map(([key, value]) => `${key}=${value}`)
		.join('\n');
}

function sessionMatches(target: McpUpstreamTarget, session: SessionState | undefined): session is SessionState {
	return !!session && session.url === target.url && session.headerFingerprint === headerFingerprint(target.authHeaders);
}

export function clearMcpUpstreamSession(serverId: string): void {
	sessions.delete(serverId);
}

export class McpUpstreamError extends Error {
	readonly status: number | null;
	constructor(message: string, status: number | null = null) {
		super(message);
		this.name = 'McpUpstreamError';
		this.status = status;
	}
}

type JsonRpcSuccess = { jsonrpc?: string; id?: unknown; result?: unknown; error?: { code?: number; message?: string } };

function isRecord(value: unknown): value is Record<string, unknown> {
	return !!value && typeof value === 'object' && !Array.isArray(value);
}

async function readLimited(response: Response, maxBytes: number): Promise<string> {
	if (!response.body) {
		return '';
	}
	const reader = response.body.getReader();
	const chunks: Uint8Array[] = [];
	let received = 0;
	for (;;) {
		const { done, value } = await reader.read();
		if (done) {
			break;
		}
		received += value.byteLength;
		if (received > maxBytes) {
			await reader.cancel();
			throw new McpUpstreamError('MCP upstream response is too large');
		}
		chunks.push(value);
	}
	const merged = new Uint8Array(received);
	let offset = 0;
	for (const chunk of chunks) {
		merged.set(chunk, offset);
		offset += chunk.byteLength;
	}
	return new TextDecoder().decode(merged);
}

function parseRpcBody(text: string, contentType: string, id: number): JsonRpcSuccess {
	if (!text.trim()) {
		return {};
	}
	if (contentType.includes('text/event-stream')) {
		const messages: JsonRpcSuccess[] = [];
		for (const line of text.split('\n')) {
			const trimmed = line.trim();
			if (!trimmed.startsWith('data:')) {
				continue;
			}
			const payload = trimmed.slice(5).trim();
			if (!payload || payload === '[DONE]') {
				continue;
			}
			try {
				const parsed = JSON.parse(payload) as JsonRpcSuccess;
				messages.push(parsed);
			} catch {
				// ignore non-JSON SSE comments
			}
		}
		const matched = messages.find((message) => message.id === id) ?? messages[messages.length - 1];
		if (!matched) {
			throw new McpUpstreamError('MCP upstream returned an empty event stream');
		}
		return matched;
	}
	try {
		return JSON.parse(text) as JsonRpcSuccess;
	} catch {
		throw new McpUpstreamError('MCP upstream returned invalid JSON');
	}
}

async function postRpc(
	target: McpUpstreamTarget,
	body: unknown,
	session: SessionState | undefined,
	fetchImpl: typeof fetch,
	id: number | null,
): Promise<{ response: Response; text: string; parsed: JsonRpcSuccess }> {
	assertMcpUpstreamUrl(target.url);
	const headers = new Headers();
	headers.set('Content-Type', 'application/json');
	headers.set('Accept', 'application/json, text/event-stream');
	if (session?.protocolVersion) {
		headers.set('MCP-Protocol-Version', session.protocolVersion);
	}
	if (session?.sessionId) {
		headers.set('Mcp-Session-Id', session.sessionId);
	}
	for (const [key, value] of Object.entries(target.authHeaders)) {
		if (!key.trim() || /^(host|content-length|transfer-encoding|connection)$/i.test(key)) {
			continue;
		}
		headers.set(key, value);
	}
	let response: Response;
	try {
		response = await fetchImpl(target.url, {
			method: 'POST',
			headers,
			body: JSON.stringify(body),
			redirect: 'manual',
			signal: AbortSignal.timeout(Math.max(1000, target.timeoutMs)),
		});
	} catch (error) {
		const name = error instanceof Error ? error.name : '';
		if (name === 'TimeoutError' || name === 'AbortError') {
			throw new McpUpstreamError('MCP upstream timed out');
		}
		throw new McpUpstreamError('MCP upstream request failed');
	}
	if (response.status >= 300 && response.status < 400) {
		throw new McpUpstreamError('MCP upstream redirect is not allowed', response.status);
	}
	const text = await readLimited(response, target.maxResponseBytes);
	if (response.status === 202 || response.status === 204 || !text.trim() || response.status < 200 || response.status >= 300) {
		return { response, text, parsed: {} };
	}
	const parsed = id == null ? {} : parseRpcBody(text, response.headers.get('content-type') ?? '', id);
	return { response, text, parsed };
}

let nextId = 1;

async function rpc(
	target: McpUpstreamTarget,
	method: string,
	params: unknown,
	fetchImpl: typeof fetch,
	allowSessionRetry: boolean,
): Promise<unknown> {
	const id = nextId++;
	const stored = sessions.get(target.serverId);
	const session = sessionMatches(target, stored) ? stored : undefined;
	if (stored && !session) {
		sessions.delete(target.serverId);
	}
	const body = { jsonrpc: '2.0', id, method, params };
	const first = await postRpc(target, body, session, fetchImpl, id);
	if (first.response.status === 404 && allowSessionRetry && session?.sessionId) {
		clearMcpUpstreamSession(target.serverId);
		await initializeUpstream(target, fetchImpl);
		return rpc(target, method, params, fetchImpl, false);
	}
	if (first.response.status < 200 || first.response.status >= 300) {
		throw new McpUpstreamError('MCP upstream request failed', first.response.status);
	}
	if (first.parsed.error) {
		const code = first.parsed.error.code;
		const message = first.parsed.error.message || 'MCP upstream error';
		const error = new McpUpstreamError(message, first.response.status);
		(error as McpUpstreamError & { rpcCode?: number }).rpcCode = code;
		throw error;
	}
	const sessionId = first.response.headers.get('mcp-session-id') ?? undefined;
	if (sessionId) {
		const current = sessions.get(target.serverId) ?? {
			protocolVersion: session?.protocolVersion ?? PROTOCOL_CANDIDATES[0],
			url: target.url,
			headerFingerprint: headerFingerprint(target.authHeaders),
		};
		current.sessionId = sessionId;
		current.url = target.url;
		current.headerFingerprint = headerFingerprint(target.authHeaders);
		sessions.set(target.serverId, current);
	}
	return first.parsed.result;
}

function rpcCodeOf(error: unknown): number | undefined {
	if (error instanceof McpUpstreamError && 'rpcCode' in error) {
		const code = (error as McpUpstreamError & { rpcCode?: number }).rpcCode;
		return typeof code === 'number' ? code : undefined;
	}
	return undefined;
}

export async function initializeUpstream(target: McpUpstreamTarget, fetchImpl: typeof fetch = fetch): Promise<{
	protocolVersion: string;
	serverInfo: unknown;
}> {
	assertMcpUpstreamUrl(target.url);
	let lastError: unknown;
	for (const protocolVersion of PROTOCOL_CANDIDATES) {
		const id = nextId++;
		try {
			const posted = await postRpc(
				target,
				{
					jsonrpc: '2.0',
					id,
					method: 'initialize',
					params: {
						protocolVersion,
						capabilities: {},
						clientInfo: { name: 'octafuse-gateway', version: '2.14.0' },
					},
				},
				undefined,
				fetchImpl,
				id,
			);
			if (posted.response.status < 200 || posted.response.status >= 300 || posted.parsed.error) {
				lastError = new McpUpstreamError(posted.parsed.error?.message || 'MCP initialize failed', posted.response.status);
				continue;
			}
			const result = isRecord(posted.parsed.result) ? posted.parsed.result : {};
			const negotiated = typeof result.protocolVersion === 'string' ? result.protocolVersion : protocolVersion;
			const sessionId = posted.response.headers.get('mcp-session-id') ?? undefined;
			sessions.set(target.serverId, {
				sessionId,
				protocolVersion: negotiated,
				url: target.url,
				headerFingerprint: headerFingerprint(target.authHeaders),
			});
			try {
				await postRpc(
					target,
					{ jsonrpc: '2.0', method: 'notifications/initialized' },
					sessions.get(target.serverId),
					fetchImpl,
					null,
				);
			} catch {
				// A stateless upstream may ignore the initialized notification.
			}
			return { protocolVersion: negotiated, serverInfo: result.serverInfo ?? null };
		} catch (error) {
			lastError = error;
		}
	}
	if (lastError instanceof McpUpstreamError) {
		throw lastError;
	}
	throw new McpUpstreamError('MCP initialize failed');
}

async function listAll(
	target: McpUpstreamTarget,
	method: string,
	listKey: string,
	fetchImpl: typeof fetch,
): Promise<unknown[]> {
	const items: unknown[] = [];
	let cursor: string | undefined;
	for (let page = 0; page < MAX_PAGES; page += 1) {
		let result: unknown;
		try {
			result = await rpc(target, method, cursor ? { cursor } : {}, fetchImpl, true);
		} catch (error) {
			if (rpcCodeOf(error) === -32601) {
				return items;
			}
			throw error;
		}
		if (!isRecord(result)) {
			break;
		}
		const batch = result[listKey];
		if (Array.isArray(batch)) {
			items.push(...batch);
		}
		const next = result.nextCursor;
		if (typeof next !== 'string' || !next || next === cursor) {
			break;
		}
		cursor = next;
	}
	return items;
}

function asEntry(kind: McpItemKind, value: unknown, keyField: string): McpCatalogEntry | null {
	if (!isRecord(value)) {
		return null;
	}
	const key = value[keyField];
	if (typeof key !== 'string' || !key.trim()) {
		return null;
	}
	return { kind, upstreamKey: key, definition: value };
}

export async function syncMcpUpstream(target: McpUpstreamTarget, fetchImpl: typeof fetch = fetch): Promise<McpUpstreamCatalog> {
	const initialized = await initializeUpstream(target, fetchImpl);
	const [tools, prompts, resources] = await Promise.all([
		listAll(target, 'tools/list', 'tools', fetchImpl),
		listAll(target, 'prompts/list', 'prompts', fetchImpl),
		listAll(target, 'resources/list', 'resources', fetchImpl),
	]);
	const entries = [
		...tools.flatMap((tool) => {
			const entry = asEntry('tool', tool, 'name');
			return entry ? [entry] : [];
		}),
		...prompts.flatMap((prompt) => {
			const entry = asEntry('prompt', prompt, 'name');
			return entry ? [entry] : [];
		}),
		...resources.flatMap((resource) => {
			const entry = asEntry('resource', resource, 'uri');
			return entry ? [entry] : [];
		}),
	];
	return { serverInfo: initialized.serverInfo, protocolVersion: initialized.protocolVersion, entries };
}

async function ensureSession(target: McpUpstreamTarget, fetchImpl: typeof fetch): Promise<void> {
	const stored = sessions.get(target.serverId);
	if (!sessionMatches(target, stored)) {
		if (stored) {
			sessions.delete(target.serverId);
		}
		await initializeUpstream(target, fetchImpl);
	}
}

export async function callMcpUpstreamTool(
	target: McpUpstreamTarget,
	name: string,
	args: unknown,
	fetchImpl: typeof fetch = fetch,
): Promise<{ result: Record<string, unknown>; isError: boolean }> {
	await ensureSession(target, fetchImpl);
	const result = await rpc(target, 'tools/call', { name, arguments: args ?? {} }, fetchImpl, true);
	const record = isRecord(result) ? result : {};
	return { result: record, isError: record.isError === true };
}

export async function getMcpUpstreamPrompt(
	target: McpUpstreamTarget,
	name: string,
	args: unknown,
	fetchImpl: typeof fetch = fetch,
): Promise<Record<string, unknown>> {
	await ensureSession(target, fetchImpl);
	const result = await rpc(target, 'prompts/get', { name, arguments: args ?? {} }, fetchImpl, true);
	return isRecord(result) ? result : {};
}

export async function readMcpUpstreamResource(
	target: McpUpstreamTarget,
	uri: string,
	fetchImpl: typeof fetch = fetch,
): Promise<Record<string, unknown>> {
	await ensureSession(target, fetchImpl);
	const result = await rpc(target, 'resources/read', { uri }, fetchImpl, true);
	return isRecord(result) ? result : {};
}
