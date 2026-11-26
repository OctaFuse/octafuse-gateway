import type { StaticModelPresetRow } from '../model-preset';
import type { StaticProviderImportPresetRow } from '../provider-catalog-pure';
import { readCatalogConfig, type CatalogEnv } from './catalog-config';
import { CatalogFetchError, fetchCatalog } from './catalog-http';

type Endpoint = 'providers' | 'models';
type Freshness = 'remote' | 'stale';
export type CatalogSnapshot<T> = {
	rows: readonly T[];
	fetchedAt: number;
	etag: string | null;
	freshness: Freshness;
};

export class CatalogUnavailableError extends Error {
	constructor() {
		super('Catalog service is unavailable. Please try again later.');
		this.name = 'CatalogUnavailableError';
	}
}

function isObject(value: unknown): value is Record<string, unknown> {
	return value != null && typeof value === 'object' && !Array.isArray(value);
}

function nonEmptyString(value: unknown): value is string {
	return typeof value === 'string' && value.trim().length > 0;
}

function optionalString(value: unknown): boolean {
	return value == null || typeof value === 'string';
}

function optionalNumber(value: unknown): boolean {
	return value == null || (typeof value === 'number' && Number.isFinite(value));
}

function stringArray(value: unknown): boolean {
	return Array.isArray(value) && value.every((entry: unknown) => typeof entry === 'string');
}

function optionalObject(value: unknown, validValue: (value: unknown) => boolean): boolean {
	return value == null || (isObject(value) && Object.values(value).every(validValue));
}

function parseModel(row: Record<string, unknown>): StaticModelPresetRow | undefined {
	const pricing = row.pricing;
	if (!nonEmptyString(row.id) || !isObject(pricing) || !['usd', 'cny'].some((key) => isObject(pricing[key]))) return;
	if (!['usd', 'cny'].every((key) => pricing[key] == null || isObject(pricing[key]))) return;
	if (!['description', 'retired', 'released', 'vendor', 'display_name'].every((key) => optionalString(row[key]))) return;
	if (!optionalNumber(row.context_window) || !optionalNumber(row.max_tokens)) return;
	if (!optionalObject(row.i18n, optionalString)) return;
	const modalities = row.modalities;
	if (modalities != null && (!isObject(modalities) || !stringArray(modalities.input) || !stringArray(modalities.output))) return;
	return row as StaticModelPresetRow;
}

function parseProvider(row: Record<string, unknown>): StaticProviderImportPresetRow | undefined {
	if (!nonEmptyString(row.name) || !nonEmptyString(row.vendor_key) || !isObject(row.endpoints)) return;
	if (!optionalString(row.description) || !optionalString(row.icon_key)) return;
	// Schema v2 publishes the same localized copy and links as top-level fields.
	const catalog = row.catalog ?? (row.i18n != null || row.links != null ? { i18n: row.i18n, links: row.links } : undefined);
	if (catalog != null && (!isObject(catalog) ||
		!optionalObject(catalog.i18n, (copy) => isObject(copy) && optionalString(copy.name) && optionalString(copy.description)) ||
		!optionalObject(catalog.links, optionalString))) return;
	return (catalog === row.catalog ? row : { ...row, catalog }) as StaticProviderImportPresetRow;
}

function parseRows<T>(payload: unknown, endpoint: Endpoint, parseRow: (row: Record<string, unknown>) => T | undefined, key: (row: T) => string): T[] {
	const envelope = isObject(payload) ? payload : undefined;
	const rows = envelope ? envelope.items ?? envelope.data : payload;
	if (!Array.isArray(rows) || rows.length === 0 ||
		(envelope?.count != null && envelope.count !== rows.length) ||
		(envelope?.catalog != null && envelope.catalog !== endpoint)) {
		throw new CatalogFetchError('invalid_catalog');
	}
	const keys = new Set<string>();
	return rows.map((raw: unknown) => {
		const row = isObject(raw) ? parseRow(raw) : undefined;
		if (!row) throw new CatalogFetchError('invalid_row');
		const id = key(row).trim();
		if (keys.has(id)) throw new CatalogFetchError('duplicate_key');
		keys.add(id);
		return row;
	});
}

async function requestCatalog(baseUrl: string, path: string, timeoutMs: number, etag: string | null) {
	const url = new URL(baseUrl);
	if (url.protocol !== 'https:' || url.username || url.password) throw new CatalogFetchError('invalid_base_url');
	url.pathname = `${url.pathname.replace(/\/+$/, '')}/api/catalog/${path}`;
	url.search = '';
	url.hash = '';
	try {
		return await fetchCatalog(url, timeoutMs, etag);
	} catch (error) {
		if (!(error instanceof CatalogFetchError) || !error.retryable) throw error;
		await new Promise((resolve) => setTimeout(resolve, 150));
		return fetchCatalog(url, timeoutMs, etag);
	}
}

function createLoader<T>(endpoint: Endpoint, parseRow: (row: Record<string, unknown>) => T | undefined, key: (row: T) => string) {
	type State = {
		snapshot?: CatalogSnapshot<T>;
		pending?: Promise<CatalogSnapshot<T>>;
		retryAt: number;
	};
	const states = new Map<string, State>();
	return async (env?: CatalogEnv): Promise<CatalogSnapshot<T>> => {
		const { baseUrl, timeoutMs, ttlMs } = readCatalogConfig(env);
		const stateKey = JSON.stringify([baseUrl, timeoutMs, ttlMs]);
		let state = states.get(stateKey);
		if (!state) {
			state = { retryAt: 0 };
			states.set(stateKey, state);
		}
		const previous = state.snapshot;
		const now = Date.now();
		if (previous && now - previous.fetchedAt < ttlMs) return previous;
		if (state.pending) return state.pending;
		if (now < state.retryAt) {
			if (previous) return { ...previous, freshness: 'stale' };
			throw new CatalogUnavailableError();
		}
		const cache = state;
		const pending = (async (): Promise<CatalogSnapshot<T>> => {
			const started = Date.now();
			try {
				const response = await requestCatalog(baseUrl, endpoint, timeoutMs, previous?.etag ?? null);
				const elapsed_ms = Date.now() - started;
				if (response.notModified) {
					if (!previous) throw new CatalogFetchError('unexpected_not_modified');
					console.info('catalog.fetch.not_modified', { endpoint, elapsed_ms });
					return (cache.snapshot = { ...previous, fetchedAt: Date.now() });
				}
				const rows = parseRows(response.payload, endpoint, parseRow, key);
				const { status, etag } = response;
				console.info('catalog.fetch.ok', { endpoint, status, etag, count: rows.length, elapsed_ms });
				return (cache.snapshot = { rows, etag, fetchedAt: Date.now(), freshness: 'remote' });
			} catch (error) {
				cache.retryAt = Date.now() + 10_000;
				console.warn('catalog.fetch.fail', { endpoint, status: error instanceof CatalogFetchError ? error.status : undefined,
					error: error instanceof CatalogFetchError ? error.reason : 'invalid_config', elapsed_ms: Date.now() - started, has_stale: Boolean(previous) });
				if (previous) return { ...previous, freshness: 'stale' };
				throw new CatalogUnavailableError();
			}
		})();
		cache.pending = pending;
		try {
			return await pending;
		} finally {
			cache.pending = undefined;
		}
	};
}

export const loadProviderCatalog = createLoader('providers', parseProvider, (row) => row.name);
export const loadModelCatalog = createLoader('models', parseModel, (row) => row.id);

export async function loadModelCatalogByVendor(vendor: string, env?: CatalogEnv): Promise<readonly StaticModelPresetRow[]> {
	const { baseUrl, timeoutMs } = readCatalogConfig(env);
	const endpoint = `models-by-vendor/${encodeURIComponent(vendor)}`;
	const started = Date.now();
	try {
		const response = await requestCatalog(baseUrl, endpoint, timeoutMs, null);
		if (response.notModified) throw new CatalogFetchError('unexpected_not_modified');
		const rows = parseRows(response.payload, 'models', parseModel, (row) => row.id);
		if (!rows.every((row) => row.vendor === vendor)) throw new CatalogFetchError('wrong_vendor');
		console.info('catalog.fetch.ok', { endpoint, status: response.status, count: rows.length, elapsed_ms: Date.now() - started });
		return rows;
	} catch (error) {
		console.warn('catalog.fetch.fail', { endpoint, status: error instanceof CatalogFetchError ? error.status : undefined,
			error: error instanceof CatalogFetchError ? error.reason : 'invalid_config', elapsed_ms: Date.now() - started });
	}
	return (await loadModelCatalog(env)).rows.filter((row) => row.vendor === vendor);
}

export function requireCurrentCatalog<T>(snapshot: CatalogSnapshot<T>): readonly T[] {
	if (snapshot.freshness === 'stale') throw new CatalogUnavailableError();
	return snapshot.rows;
}

export function optionalCatalog(error: unknown): null {
	if (error instanceof CatalogUnavailableError) return null;
	throw error;
}
