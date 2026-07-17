import { IMAGE_GENERATIONS_BODY_TEMPLATE } from '@/lib/image-generations';
import type { SimulatorProtocol } from '@/lib/simulator/endpoint';
import type { AdminKeyListItem, AdminModelRow, RouteListRow } from './types';

export const LS_PROXY = 'octafuse.simulator.proxyBaseUrl';
export const LS_PROTOCOL = 'octafuse.simulator.protocol';
export const LS_MODEL_ID = 'octafuse.simulator.modelId';
export const LS_ROUTE_GROUP = 'octafuse.simulator.routeGroup';
export const LS_KEY_ID = 'octafuse.simulator.keyId';

export const KEYS_PAGE_SIZE = 200;

export const inputClass =
	'w-full px-3 py-2 border border-gray-300 rounded-md text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 bg-white';
export const labelClass = 'block text-xs font-medium text-gray-500 uppercase tracking-wider mb-1';
export const panelClass = 'rounded-xl border border-gray-200/80 bg-white p-4 shadow-sm space-y-3';
export const codeBlockClass =
	'p-3 text-xs overflow-x-auto whitespace-pre-wrap bg-gray-50 border border-gray-200 rounded-md font-mono text-gray-900';

export const BODY_TEMPLATES: Record<SimulatorProtocol, string> = {
	openai: `{
  "model": "<auto>",
  "messages": [{ "role": "user", "content": "Hello" }],
  "max_tokens": 256,
  "stream": true,
  "stream_options": { "include_usage": true }
}`,
	anthropic: `{
  "model": "<auto>",
  "messages": [{ "role": "user", "content": "Hello" }],
  "max_tokens": 256,
  "stream": true
}`,
	gemini: `{
  "contents": [{ "role": "user", "parts": [{ "text": "Hello" }] }]
}`,
};

/** Chat or Images generations template for the current selection. */
export function bodyTemplateForSelection(
	protocol: SimulatorProtocol,
	isImageModel: boolean
): string {
	if (isImageModel && protocol === 'openai') {
		return IMAGE_GENERATIONS_BODY_TEMPLATE;
	}
	return BODY_TEMPLATES[protocol];
}

/** Matches Proxy `resolveModelRouting`: default group sends model id only, else `id:group`. */
export function buildModelRoutingString(modelId: string, routeGroup: string): string {
	const g = routeGroup.trim();
	if (!g || g === 'default') return modelId.trim();
	return `${modelId.trim()}:${g}`;
}

export function formatModelLabel(m: AdminModelRow): string {
	const dn = m.display_name?.trim() || 'n/a';
	return `${m.id} · ${dn} · ${m.vendor}`;
}

export function formatModelOptionLabel(m: AdminModelRow, hasActiveRouter: boolean): string {
	const base = formatModelLabel(m);
	return hasActiveRouter ? `🟢 ${base}` : `🔴 ${base}`;
}

export function formatKeyOptionLabel(k: AdminKeyListItem): string {
	return `${k.user_email ?? k.user_id} · ${k.name ?? 'n/a'} · ${k.id.slice(0, 8)}…`;
}

export function normalizeBodyWhitespace(text: string): string {
	return text.replace(/\r\n/g, '\n').trim();
}

export function isBodyDirty(
	bodyText: string,
	protocol: SimulatorProtocol,
	isImageModel = false
): boolean {
	return (
		normalizeBodyWhitespace(bodyText) !==
		normalizeBodyWhitespace(bodyTemplateForSelection(protocol, isImageModel))
	);
}

/** Effective route_group for matching: empty / default → routes with empty or "default" group. */
export function routeGroupMatchesSelection(routeGroup: string, selected: string): boolean {
	const sel = selected.trim();
	const rg = (routeGroup ?? '').trim() || 'default';
	if (!sel || sel === 'default') {
		return rg === 'default' || rg === '';
	}
	return rg === sel;
}

export function filterMatchingActiveRoutes(
	routes: RouteListRow[],
	modelId: string,
	routeGroup: string
): RouteListRow[] {
	if (!modelId) return [];
	return routes
		.filter(
			(r) =>
				r.model_id === modelId &&
				String(r.status).toLowerCase() === 'active' &&
				routeGroupMatchesSelection(r.route_group, routeGroup)
		)
		.sort((a, b) => b.priority - a.priority || a.id.localeCompare(b.id));
}

export function redactAuthHeader(value: string): string {
	const t = value.trim();
	const m = /^(Bearer\s+)(.+)$/i.exec(t);
	if (!m) {
		if (t.startsWith('sk-') && t.length > 16) return `${t.slice(0, 12)}…${t.slice(-4)}`;
		return t;
	}
	const sk = m[2];
	if (sk.startsWith('sk-') && sk.length > 16) {
		return `${m[1]}${sk.slice(0, 12)}…${sk.slice(-4)}`;
	}
	return `${m[1]}***`;
}

export function redactHeaders(headers: Record<string, string>): Record<string, string> {
	const out: Record<string, string> = {};
	for (const [k, v] of Object.entries(headers)) {
		out[k] = k.toLowerCase() === 'authorization' ? redactAuthHeader(v) : v;
	}
	return out;
}

export function buildRequestLogsHref(opts: {
	apiKeyId?: string;
	modelId?: string;
	routeGroup?: string;
	protocol?: string;
}): string {
	const sp = new URLSearchParams();
	if (opts.apiKeyId) sp.set('api_key_id', opts.apiKeyId);
	if (opts.modelId) sp.set('model_id', opts.modelId);
	const rg = opts.routeGroup?.trim();
	if (rg && rg !== 'default') sp.set('route_group', rg);
	if (opts.protocol) sp.set('protocol', opts.protocol);
	const q = sp.toString();
	return q ? `/gateway/request-logs?${q}` : '/gateway/request-logs';
}

export function tryParseProxyBaseUrl(raw: string): { ok: true; base: string } | { ok: false; reason: 'empty' | 'invalid' } {
	const trimmed = raw.trim();
	if (!trimmed) return { ok: false, reason: 'empty' };
	try {
		const u = new URL(trimmed);
		if (u.protocol !== 'http:' && u.protocol !== 'https:') {
			return { ok: false, reason: 'invalid' };
		}
		return { ok: true, base: trimmed.replace(/\/+$/, '') };
	} catch {
		return { ok: false, reason: 'invalid' };
	}
}

export function prettyJsonBody(bodyText: string): string {
	try {
		return JSON.stringify(JSON.parse(bodyText), null, 2);
	} catch {
		return bodyText;
	}
}
