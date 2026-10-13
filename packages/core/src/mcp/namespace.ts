import { sha256Hex, stableStringify } from './hash';

export const MCP_RESERVED_SLUGS = ['builtin'] as const;
export const MCP_EXPOSED_NAME_MAX = 64;
export const MCP_LEDGER_PROVIDER_ID = 'octafuse-mcp';

const SLUG_PATTERN = /^[a-z0-9](?:[a-z0-9-]{0,38}[a-z0-9])?$/;

export function assertMcpSlug(slug: string): string {
	const value = slug.trim();
	if (!SLUG_PATTERN.test(value) || value.length > 40) {
		throw new Error('MCP slug must be 1-40 characters of lowercase letters, digits, and hyphens');
	}
	if ((MCP_RESERVED_SLUGS as readonly string[]).includes(value)) {
		throw new Error(`MCP slug "${value}" is reserved`);
	}
	return value;
}

function sanitizeNamePart(name: string): string {
	const cleaned = name.replace(/[^a-zA-Z0-9_-]/g, '_').replace(/_+/g, '_').replace(/^_|_$/g, '');
	return cleaned || 'item';
}

/**
 * Public tool or prompt name: `{slug}__{upstream}`.
 * Truncate to 64 characters and disambiguate with a short hash when needed.
 */
export async function exposeMcpName(slug: string, upstreamName: string, used: ReadonlySet<string>): Promise<string> {
	const safeSlug = assertMcpSlug(slug);
	const base = `${safeSlug}__${sanitizeNamePart(upstreamName)}`;
	const hash = (await sha256Hex(`${safeSlug}\n${upstreamName}`)).slice(0, 8);
	let candidate = base.length <= MCP_EXPOSED_NAME_MAX ? base : `${base.slice(0, MCP_EXPOSED_NAME_MAX - 9)}_${hash}`;
	if (!used.has(candidate)) {
		return candidate;
	}
	const suffix = `_${hash}`;
	candidate = `${candidate.slice(0, MCP_EXPOSED_NAME_MAX - suffix.length)}${suffix}`;
	if (!used.has(candidate)) {
		return candidate;
	}
	throw new Error(`Cannot allocate a unique MCP name for ${safeSlug}/${upstreamName}`);
}

export function exposeResourceUri(slug: string, upstreamUri: string): string {
	return `octafuse://${assertMcpSlug(slug)}/${encodeURIComponent(upstreamUri)}`;
}

export function parseExposedResourceUri(uri: string): { slug: string; upstreamUri: string } | null {
	const match = /^octafuse:\/\/([a-z0-9-]+)\/(.+)$/.exec(uri);
	if (!match) {
		return null;
	}
	try {
		return { slug: match[1], upstreamUri: decodeURIComponent(match[2]) };
	} catch {
		return null;
	}
}

export async function mcpDefinitionHash(definition: unknown): Promise<string> {
	return sha256Hex(stableStringify(definition));
}
