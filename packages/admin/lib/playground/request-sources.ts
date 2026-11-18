import { splitRouteCustomParams } from '@octafuse/core/route-custom-params';
import type { resolveCustomParamsLayers } from '@octafuse/core/provider-custom-params';

type JsonObject = Record<string, unknown>;
type ConfigSource = 'p' | 'r';
type Source = ConfigSource | '.';
type SourceNode = { source: Source; children?: Map<string, SourceNode> };

export type PlaygroundRequestInspection = {
	body: string;
	headers: Record<string, string>;
	sources: string;
};

export const PLAYGROUND_REQUEST_SOURCES_HEADER = 'x-playground-request-sources';

function isObject(value: unknown): value is JsonObject {
	return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function markSources(value: unknown, source: Source): SourceNode {
	if (!isObject(value)) return { source };
	return {
		source,
		children: new Map(Object.entries(value).map(([key, child]) => [key, markSources(child, source)])),
	};
}

function mergeSources(base: SourceNode | undefined, overlay: SourceNode): SourceNode {
	if (!base?.children || !overlay.children) return overlay;
	const children = new Map(base.children);
	for (const [key, child] of overlay.children) {
		children.set(key, mergeSources(children.get(key), child));
	}
	return { source: overlay.source, children };
}

/** Arrays, scalars and empty objects each have one source. Objects can inherit individual fields. */
function* bodyFieldPaths(body: JsonObject, parent: string[] = []): Generator<string[]> {
	for (const [key, value] of Object.entries(body)) {
		const path = [...parent, key];
		if (isObject(value) && Object.keys(value).length > 0) {
			yield* bodyFieldPaths(value, path);
		} else {
			yield path;
		}
	}
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
	const effective = splitRouteCustomParams(layers.effective);
	const configuredHeaders = new Set(
		Object.keys(effective.extraHeaders).map((name) => name.toLowerCase()),
	);
	const routeHeaders = new Set(Object.keys(layers.route.extraHeaders).map((name) => name.toLowerCase()));
	const headerCodes = Object.keys(headers).map((header): Source => {
		const name = header.toLowerCase();
		if (!configuredHeaders.has(name)) return '.';
		return routeHeaders.has(name) ? 'r' : 'p';
	});

	const body = wireBody == null ? null : parseBody(wireBody);
	if (!body) return `${headerCodes.join('')}:`;
	const config = mergeSources(markSources(layers.provider?.body ?? {}, 'p'), markSources(layers.route.body, 'r'));
	for (const key of config.children?.keys() ?? []) {
		if (!Object.hasOwn(effective.body, key)) config.children?.delete(key);
	}
	const user = markSources(userBody, '.');
	const merged = effective.forceOverrideBody ? mergeSources(user, config) : mergeSources(config, user);

	// Position in the wire JSON keeps the response header compact and avoids duplicating field names.
	const bodyCodes = Array.from(bodyFieldPaths(body), (path): Source => {
		if (writesModel && path[0] === 'model') return '.';
		let node: SourceNode | undefined = merged;
		for (const key of path) node = node?.children?.get(key);
		return node?.source ?? '.';
	});
	return `${headerCodes.join('')}:${bodyCodes.join('')}`;
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
	const bodyCodes = codes?.split(':')[1];
	const body = bodyCodes ? parseBody(text) : null;
	if (!body || !bodyCodes) return [];
	const paths = Array.from(bodyFieldPaths(body));
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
