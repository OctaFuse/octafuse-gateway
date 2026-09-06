/**
 * Aggregate LLM request surfaces for `GET /v1/models`.
 * This is the client inbound entry (protocol + operation), not upstream_protocol.
 */
import {
	GEMINI_GENERATE_OPERATION,
	GEMINI_LEGACY_GENERATE_OPERATIONS,
	LEGACY_WILDCARD_OPERATION,
	normalizeUpstreamProtocol,
	type ModelRouteJoinRow,
	type UpstreamProtocol,
} from '@octafuse/core';
import { filterRouteGroupsByAllowlist } from '../lib/model-list-parse';

export type LlmInboundSurface = {
	protocol: 'openai' | 'anthropic' | 'gemini';
	operation: string;
};

const LLM_INBOUND_ORDER: readonly LlmInboundSurface[] = [
	{ protocol: 'openai', operation: 'responses' },
	{ protocol: 'openai', operation: 'chat' },
	{ protocol: 'anthropic', operation: 'messages' },
	{ protocol: 'gemini', operation: GEMINI_GENERATE_OPERATION },
];

const WILDCARD_DEFAULT_OPERATION: Record<'openai' | 'anthropic' | 'gemini', string> = {
	openai: 'chat',
	anthropic: 'messages',
	gemini: GEMINI_GENERATE_OPERATION,
};

const inboundKey = (protocol: string, operation: string): string => `${protocol}:${operation}`;

const LLM_OPERATION_KEYS = new Set(
	LLM_INBOUND_ORDER.map((surface) => inboundKey(surface.protocol, surface.operation)),
);

type SurfaceJson = {
	request_protocol?: unknown;
	request_operation?: unknown;
	status?: unknown;
};

const parseSurfaceList = (raw: string | null | undefined): SurfaceJson[] => {
	if (raw == null || raw.trim() === '') return [];
	try {
		const parsed: unknown = JSON.parse(raw);
		return Array.isArray(parsed) ? parsed.filter((row): row is SurfaceJson => row !== null && typeof row === 'object') : [];
	} catch {
		return [];
	}
};

const tryProtocol = (raw: unknown): UpstreamProtocol | undefined => {
	if (typeof raw !== 'string') return undefined;
	try {
		return normalizeUpstreamProtocol(raw);
	} catch {
		return undefined;
	}
};

const normalizeOperation = (protocol: UpstreamProtocol, raw: unknown): string | undefined => {
	if (typeof raw !== 'string') return undefined;
	const operation = raw.trim();
	if (operation === '') return undefined;
	if (protocol === 'gemini' && (GEMINI_LEGACY_GENERATE_OPERATIONS as readonly string[]).includes(operation)) {
		return GEMINI_GENERATE_OPERATION;
	}
	return operation;
};

const isLlmTextProtocol = (
	protocol: UpstreamProtocol,
): protocol is 'openai' | 'anthropic' | 'gemini' =>
	protocol === 'openai' || protocol === 'anthropic' || protocol === 'gemini';

const sortInbound = (inbound: Iterable<LlmInboundSurface>): LlmInboundSurface[] => {
	const keys = new Set(Array.from(inbound, (surface) => inboundKey(surface.protocol, surface.operation)));
	return LLM_INBOUND_ORDER.filter((surface) => keys.has(inboundKey(surface.protocol, surface.operation)));
};

/**
 * Collect LLM inbound surfaces from active route targets whose route_group is allowed.
 * Order is a stable listing (responses before chat), not a client recommendation.
 */
export const collectLlmInboundSurfaces = (
	routes: readonly ModelRouteJoinRow[],
	allowedRouteGroups: readonly string[],
): LlmInboundSurface[] => {
	const exact = new Set<string>();
	const wildcardProtocols = new Set<'openai' | 'anthropic' | 'gemini'>();

	for (const route of routes) {
		if (route.status !== 'active') continue;
		if (filterRouteGroupsByAllowlist([route.route_group], allowedRouteGroups).length === 0) continue;

		for (const surface of parseSurfaceList(route.surfaces)) {
			const status = typeof surface.status === 'string' ? surface.status.trim().toLowerCase() : 'active';
			if (status === 'disabled') continue;

			const protocol = tryProtocol(surface.request_protocol);
			if (protocol === undefined || !isLlmTextProtocol(protocol)) continue;

			const operation = normalizeOperation(protocol, surface.request_operation);
			if (operation === undefined) continue;

			if (operation === LEGACY_WILDCARD_OPERATION) {
				wildcardProtocols.add(protocol);
				continue;
			}

			const key = inboundKey(protocol, operation);
			if (LLM_OPERATION_KEYS.has(key)) exact.add(key);
		}
	}

	for (const protocol of wildcardProtocols) {
		const hasExactForProtocol = LLM_INBOUND_ORDER.some(
			(surface) => surface.protocol === protocol && exact.has(inboundKey(surface.protocol, surface.operation)),
		);
		if (hasExactForProtocol) continue;
		exact.add(inboundKey(protocol, WILDCARD_DEFAULT_OPERATION[protocol]));
	}

	return sortInbound(
		LLM_INBOUND_ORDER.filter((surface) => exact.has(inboundKey(surface.protocol, surface.operation))),
	);
};
