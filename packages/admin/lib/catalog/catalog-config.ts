export type CatalogEnv = {
	CATALOG_BASE_URL?: string;
	CATALOG_TIMEOUT_MS?: string;
	CATALOG_TTL_MS?: string;
};

function positiveMilliseconds(value: string | undefined, fallback: number): number {
	const parsed = Number(value);
	return Number.isSafeInteger(parsed) && parsed > 0 && parsed <= 2_147_483_647 ? parsed : fallback;
}

export function readCatalogConfig(env: CatalogEnv = {}) {
	return {
		baseUrl: env.CATALOG_BASE_URL?.trim() || 'https://octafuse.dev',
		timeoutMs: positiveMilliseconds(env.CATALOG_TIMEOUT_MS, 3_000),
		ttlMs: positiveMilliseconds(env.CATALOG_TTL_MS, 300_000),
	};
}
