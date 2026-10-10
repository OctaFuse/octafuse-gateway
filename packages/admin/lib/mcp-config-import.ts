export type McpImportHeader = { key: string; value: string };

export type McpImportCandidate = {
	name: string;
	slug: string;
	url: string;
	headers: McpImportHeader[];
};

export type McpImportFailure = 'empty' | 'invalid' | 'stdio' | 'sse' | 'oauth';

export type McpImportParseResult =
	| { ok: true; servers: McpImportCandidate[] }
	| { ok: false; reason: McpImportFailure };

const SLUG_PATTERN = /^[a-z0-9](?:[a-z0-9-]{0,38}[a-z0-9])?$/;
const HTTP_URL = /https?:\/\/[^\s"']+/i;
const FAILURE_PRIORITY: readonly Exclude<McpImportFailure, 'empty'>[] = ['sse', 'stdio', 'oauth', 'invalid'];

type ServerDraft = { server?: McpImportCandidate; failure?: Exclude<McpImportFailure, 'empty'> };

export function slugFromMcpName(name: string): string {
	const slug = name
		.trim()
		.toLowerCase()
		.replace(/[^a-z0-9]+/g, '-')
		.replace(/^-+|-+$/g, '')
		.slice(0, 40)
		.replace(/-+$/g, '');
	if (!slug || slug === 'builtin' || !SLUG_PATTERN.test(slug)) return '';
	return slug;
}

export function parseMcpClientConfig(input: string): McpImportParseResult {
	const text = input.trim();
	if (!text) return { ok: false, reason: 'empty' };
	if (/^https?:\/\//i.test(text)) {
		const server = candidate('', text);
		return server ? { ok: true, servers: [server] } : { ok: false, reason: 'invalid' };
	}
	let parsed: unknown;
	try {
		parsed = JSON.parse(text);
	} catch {
		return { ok: false, reason: 'invalid' };
	}
	const collected = collect(parsed);
	if (collected.servers.length > 0) return { ok: true, servers: collected.servers };
	return { ok: false, reason: pickFailure(collected.failures) };
}

export function applyMcpImport<T extends { slug: string; name: string; url: string; headers: McpImportHeader[] }>(
	form: T,
	candidate: McpImportCandidate,
	mode: 'create' | 'edit',
): T {
	return {
		...form,
		slug: mode === 'create' && form.slug.trim() === '' && candidate.slug ? candidate.slug : form.slug,
		name: mode === 'create' && form.name.trim() === '' && candidate.name ? candidate.name : form.name,
		url: candidate.url,
		headers: candidate.headers.length > 0 ? candidate.headers : [{ key: '', value: '' }],
	};
}

function collect(value: unknown): { servers: McpImportCandidate[]; failures: Exclude<McpImportFailure, 'empty'>[] } {
	const servers: McpImportCandidate[] = [];
	const failures: Exclude<McpImportFailure, 'empty'>[] = [];
	if (typeof value === 'string') {
		const server = /^https?:\/\//i.test(value.trim()) ? candidate('', value.trim()) : null;
		if (server) servers.push(server);
		else failures.push('invalid');
		return { servers, failures };
	}
	if (!isRecord(value)) return { servers, failures: ['invalid'] };

	const map = serverMap(value);
	if (map) {
		for (const [name, config] of Object.entries(map)) {
			const draft = fromConfig(name, config);
			if (draft.server) servers.push(draft.server);
			else if (draft.failure) failures.push(draft.failure);
		}
		return { servers, failures };
	}
	const draft = fromConfig(labelOf(value), value);
	if (draft.server) servers.push(draft.server);
	else if (draft.failure) failures.push(draft.failure);
	return { servers, failures };
}

function fromConfig(fallbackName: string, value: unknown): ServerDraft {
	if (!isRecord(value)) return { failure: 'invalid' };
	const transport = (textField(value, 'type') ?? textField(value, 'transport'))?.toLowerCase() ?? null;
	if (transport === 'sse') return { failure: 'sse' };

	const url = directUrl(value) ?? urlFromCommand(value);
	if (!url) {
		if (isOAuth(value, transport)) return { failure: 'oauth' };
		if (transport === 'stdio' || typeof value.command === 'string' || Array.isArray(value.args)) return { failure: 'stdio' };
		return { failure: 'invalid' };
	}
	const name = textField(value, 'name') || textField(value, 'server_label') || textField(value, 'serverLabel') || fallbackName;
	const server = candidate(name, url, headersOf(value.headers));
	return server ? { server } : { failure: 'invalid' };
}

function candidate(name: string, url: string, headers: McpImportHeader[] = []): McpImportCandidate | null {
	const trimmed = url.trim();
	if (!/^https?:\/\//i.test(trimmed)) return null;
	const displayName = name.trim();
	return {
		name: displayName,
		slug: slugFromMcpName(displayName),
		url: trimmed,
		headers,
	};
}

function directUrl(value: Record<string, unknown>): string | null {
	for (const key of ['url', 'serverUrl', 'server_url']) {
		const url = textField(value, key);
		if (url && /^https?:\/\//i.test(url)) return url;
	}
	return null;
}

function urlFromCommand(value: Record<string, unknown>): string | null {
	const chunks: string[] = [];
	if (typeof value.command === 'string') chunks.push(value.command);
	if (Array.isArray(value.args)) {
		for (const arg of value.args) {
			if (typeof arg === 'string') chunks.push(arg);
		}
	}
	for (const chunk of chunks) {
		const match = chunk.match(HTTP_URL);
		if (match) return match[0];
	}
	return null;
}

function headersOf(value: unknown): McpImportHeader[] {
	if (!isRecord(value)) return [];
	const headers: McpImportHeader[] = [];
	for (const [key, raw] of Object.entries(value)) {
		if (typeof raw !== 'string') continue;
		const name = key.trim();
		if (!name) continue;
		headers.push({ key: name, value: raw });
	}
	return headers;
}

function isOAuth(value: Record<string, unknown>, transport: string | null): boolean {
	if (transport === 'oauth') return true;
	if (value.oauth === true) return true;
	const auth = value.auth;
	if (typeof auth === 'string') return auth.trim().toLowerCase() === 'oauth';
	if (isRecord(auth)) {
		const authType = textField(auth, 'type')?.toLowerCase();
		if (authType === 'oauth') return true;
	}
	return false;
}

function serverMap(value: Record<string, unknown>): Record<string, unknown> | null {
	for (const key of ['mcpServers', 'servers']) {
		const map = value[key];
		if (isRecord(map)) return map;
	}
	return null;
}

function labelOf(value: Record<string, unknown>): string {
	return textField(value, 'name') || textField(value, 'server_label') || textField(value, 'serverLabel') || '';
}

function textField(value: Record<string, unknown>, key: string): string | null {
	const raw = value[key];
	if (typeof raw !== 'string') return null;
	const text = raw.trim();
	return text ? text : null;
}

function pickFailure(failures: Exclude<McpImportFailure, 'empty'>[]): McpImportFailure {
	for (const reason of FAILURE_PRIORITY) {
		if (failures.includes(reason)) return reason;
	}
	return 'invalid';
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === 'object' && value !== null && !Array.isArray(value);
}
