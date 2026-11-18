import type { resolveCustomParamsLayers } from '@octafuse/core/provider-custom-params';
import { configuredBodySourceCodes, configuredHeaderSources, requestBodyFieldPaths } from '@octafuse/core/request-parameter-sources';

type JsonObject = Record<string, unknown>;

export type PlaygroundRequestInspection = {
	body: string;
	headers: Record<string, string>;
	sources: string;
};

export const PLAYGROUND_REQUEST_SOURCES_HEADER = 'x-playground-request-sources';

function isObject(value: unknown): value is JsonObject {
	return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function parseBody(text: string): JsonObject | null {
	try {
		const body: unknown = JSON.parse(text);
		return isObject(body) ? body : null;
	} catch {
		return null;
	}
}

export function playgroundRequestSourceCodes(input: {
	layers: ReturnType<typeof resolveCustomParamsLayers>;
	userBody: JsonObject;
	wireBody: string | null;
	headers: Record<string, string>;
	writesModel: boolean;
}): string {
	const { layers, userBody, wireBody, headers, writesModel } = input;
	const configuredHeaders = new Map(
		configuredHeaderSources(layers).map(({ name, source }) => [name.toLowerCase(), source]),
	);
	const headerCodes = Object.keys(headers).map((header) => {
		const source = configuredHeaders.get(header.toLowerCase());
		return source === 'provider' ? 'p' : source === 'route' ? 'r' : '.';
	});

	const body = wireBody == null ? null : parseBody(wireBody);
	const bodyCodes = body ? configuredBodySourceCodes(layers, userBody, body, ([key]) => writesModel && key === 'model') : '';
	return `${headerCodes.join('')}:${bodyCodes}`;
}

export function playgroundHeaderSourceRows(headers: Record<string, string>, codes: string | null) {
	const entries = Object.entries(headers);
	const headerCodes = codes?.split(':')[0] ?? '';
	return entries.map(([name, value], index) => ({
		name,
		value,
		source: headerCodes.length === entries.length ? headerCodes[index] : undefined,
	}));
}

export function playgroundBodySourceRows(text: string, codes: string | null) {
	return configuredBodySourceRows(text, codes?.split(':')[1]);
}

export function configuredBodySourceRows(text: string, bodyCodes: string | null | undefined) {
	const body = bodyCodes ? parseBody(text) : null;
	if (!body || !bodyCodes) return [];
	const paths = Array.from(requestBodyFieldPaths(body));
	if (paths.length !== bodyCodes.length) return [];
	return paths.flatMap((keys, index) => {
		const source = bodyCodes[index];
		if (source !== 'p' && source !== 'r') return [];
		const path = keys.reduce(
			(path, key) => /^[A-Za-z_$][\w$]*$/.test(key)
				? `${path}${path ? '.' : ''}${key}`
				: `${path}[${JSON.stringify(key)}]`,
			'',
		);
		return [{ path, source }];
	});
}
