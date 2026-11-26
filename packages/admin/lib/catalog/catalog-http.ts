const MAX_CATALOG_BYTES = 5 * 1024 * 1024;

export class CatalogFetchError extends Error {
	constructor(readonly reason: string, readonly retryable = false, readonly status?: number) {
		super(reason);
	}
}

async function readCatalogJson(response: Response): Promise<unknown> {
	if (Number(response.headers.get('content-length')) > MAX_CATALOG_BYTES) {
		await response.body?.cancel();
		throw new CatalogFetchError('response_too_large');
	}
	if (!response.body) throw new CatalogFetchError('missing_body');
	const reader = response.body.getReader();
	const decoder = new TextDecoder();
	let bytes = 0;
	let body = '';
	try {
		for (;;) {
			const { done, value } = await reader.read();
			if (done) break;
			bytes += value.byteLength;
			if (bytes > MAX_CATALOG_BYTES) {
				await reader.cancel();
				throw new CatalogFetchError('response_too_large');
			}
			body += decoder.decode(value, { stream: true });
		}
	} finally {
		reader.releaseLock();
	}
	try {
		return JSON.parse(body + decoder.decode());
	} catch {
		throw new CatalogFetchError('invalid_json');
	}
}

export async function fetchCatalog(url: URL, timeoutMs: number, etag: string | null) {
	const controller = new AbortController();
	const timer = setTimeout(() => controller.abort(), timeoutMs);
	const headers = new Headers({ accept: 'application/json' });
	if (etag) headers.set('if-none-match', etag);
	try {
		const response = await fetch(url, { headers, signal: controller.signal, redirect: 'manual', cache: 'no-store' });
		if (response.status === 304) return { notModified: true as const };
		if (!response.ok) {
			await response.body?.cancel();
			throw new CatalogFetchError('http_error', response.status >= 500, response.status);
		}
		return { notModified: false as const, status: response.status, payload: await readCatalogJson(response), etag: response.headers.get('etag') };
	} catch (error) {
		if (error instanceof CatalogFetchError) throw error;
		throw new CatalogFetchError(controller.signal.aborted ? 'timeout' : 'network_error', true);
	} finally {
		clearTimeout(timer);
	}
}
