import type { resolveCustomParamsLayers } from './provider-custom-params';
import { splitRouteCustomParams } from './route-custom-params';

type JsonObject = Record<string, unknown>;
type Layers = ReturnType<typeof resolveCustomParamsLayers>;
type BodySource = 'p' | 'r' | '.';
type SourceNode = { source: BodySource; children?: Map<string, SourceNode> };
export type ConfiguredHeaderSource = 'provider' | 'route' | 'input';
export type RequestParameterSources = {
	body: string | null;
	headers: Array<{ name: string; source: ConfiguredHeaderSource }>;
};

function isObject(value: unknown): value is JsonObject {
	return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function markSources(value: unknown, source: BodySource): SourceNode {
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
export function* requestBodyFieldPaths(body: JsonObject, parent: string[] = []): Generator<string[]> {
	for (const [key, value] of Object.entries(body)) {
		const path = [...parent, key];
		if (isObject(value) && Object.keys(value).length > 0) {
			yield* requestBodyFieldPaths(value, path);
		} else {
			yield path;
		}
	}
}

/** Compact positional codes for the exact fields present in the inspected body. */
export function configuredBodySourceCodes(
	layers: Layers,
	userBody: JsonObject,
	inspectedBody: JsonObject,
	skip?: (path: string[]) => boolean,
): string {
	const effective = splitRouteCustomParams(layers.effective);
	const config = mergeSources(markSources(layers.provider?.body ?? {}, 'p'), markSources(layers.route.body, 'r'));
	for (const key of config.children?.keys() ?? []) {
		if (!Object.hasOwn(effective.body, key)) config.children?.delete(key);
	}
	const user = markSources(userBody, '.');
	const merged = effective.forceOverrideBody ? mergeSources(user, config) : mergeSources(config, user);
	return Array.from(requestBodyFieldPaths(inspectedBody), (path): BodySource => {
		if (skip?.(path)) return '.';
		let node: SourceNode | undefined = merged;
		for (const key of path) node = node?.children?.get(key);
		return node?.source ?? '.';
	}).join('');
}

/** Use the same precedence as the proxy header overlay. Never include the values. */
export function configuredHeaderSources(layers: Layers, inbound?: Headers): RequestParameterSources['headers'] {
	const { extraHeaders, forceOverrideHeaders } = splitRouteCustomParams(layers.effective);
	const route = new Set(Object.keys(layers.route.extraHeaders).map((name) => name.toLowerCase()));
	return Object.keys(extraHeaders).map((name) => ({
		name,
		source: !forceOverrideHeaders && inbound?.has(name) ? 'input' : route.has(name.toLowerCase()) ? 'route' : 'provider',
	}));
}
