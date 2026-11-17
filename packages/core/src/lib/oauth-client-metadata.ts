/**
 * 客户端元数据文档（Client ID Metadata Document，MCP 授权规范 2025-11-25）：
 * 客户端不做动态注册，直接把一个 https URL 当 `client_id`，授权服务器去这个 URL 取 JSON 元数据。
 *
 * Gateway 会替客户端发起出站请求，所以 URL 规则偏严（只防直接指向内网的写法，DNS 解析到内网不在这一层拦截）：
 * https、默认端口、有路径、主机名是域名（不接受 IP 字面量与 localhost / .local / .internal 等内部后缀）；
 * 不跟随重定向，限时、限大小。只接受公开客户端（`token_endpoint_auth_method` 缺省或 `none`）。
 */
import {
	OAUTH_MAX_REDIRECT_URIS,
	isAcceptableRedirectUriShape,
	normalizeStringList,
	sanitizeClientName,
} from './oauth-server';

/** `client_id` 列在 MySQL 是 VARCHAR(255)。 */
export const OAUTH_CIMD_MAX_URL_LENGTH = 255;
export const OAUTH_CIMD_MAX_BYTES = 64 * 1024;
export const OAUTH_CIMD_FETCH_TIMEOUT_MS = 5000;
/** 已取过的文档在这段时间内复用，过期后在下一次授权时重新获取。 */
export const OAUTH_CIMD_REFRESH_SECONDS = 3600;

const INTERNAL_HOST_SUFFIXES = ['.localhost', '.local', '.internal', '.lan', '.home.arpa', '.intranet', '.corp'];

/** `client_id` 形如 https URL 时按元数据文档处理；其它一律按普通 `client_id` 查注册实例。 */
export function isClientIdMetadataUrl(clientId: string): boolean {
	return clientId.startsWith('https://');
}

/** 返回 URL 不可用的原因；可用返回 null。 */
export function clientIdMetadataUrlProblem(clientId: string): string | null {
	if (clientId.length > OAUTH_CIMD_MAX_URL_LENGTH) return 'client_id URL is too long';
	let url: URL;
	try {
		url = new URL(clientId);
	} catch {
		return 'client_id is not a valid URL';
	}
	if (url.href !== clientId) return 'client_id URL must be in canonical form';
	if (url.protocol !== 'https:') return 'client_id URL must use https';
	if (url.username || url.password || url.hash) return 'client_id URL must not contain credentials or a fragment';
	if (url.port) return 'client_id URL must use the default port';
	if (url.pathname === '/' || url.pathname === '') return 'client_id URL must contain a path';
	const host = url.hostname.toLowerCase();
	if (host.startsWith('[') || /^\d+(\.\d+){3}$/.test(host) || /^\d+$/.test(host)) return 'client_id URL host must be a domain name';
	if (!host.includes('.') || host === 'localhost' || INTERNAL_HOST_SUFFIXES.some((suffix) => host.endsWith(suffix))) {
		return 'client_id URL host must be a public domain name';
	}
	return null;
}

export type ClientIdMetadata = {
	clientId: string;
	clientName: string;
	redirectUris: string[];
};

export type ClientIdMetadataResult = { ok: true; metadata: ClientIdMetadata } | { ok: false; reason: string };

async function readLimitedText(response: Response, maxBytes: number): Promise<string | null> {
	const declared = Number(response.headers.get('content-length') ?? 0);
	if (declared > maxBytes) return null;
	if (!response.body) return '';
	const reader = response.body.getReader();
	const chunks: Uint8Array[] = [];
	let total = 0;
	for (;;) {
		const { done, value } = await reader.read();
		if (done) break;
		total += value.byteLength;
		if (total > maxBytes) {
			await reader.cancel().catch(() => undefined);
			return null;
		}
		chunks.push(value);
	}
	const bytes = new Uint8Array(total);
	let offset = 0;
	for (const chunk of chunks) {
		bytes.set(chunk, offset);
		offset += chunk.byteLength;
	}
	return new TextDecoder().decode(bytes);
}

/** 校验已解析的文档内容（与获取分开，便于单测）。 */
export function parseClientIdMetadataDocument(clientId: string, document: unknown): ClientIdMetadataResult {
	if (!document || typeof document !== 'object' || Array.isArray(document)) {
		return { ok: false, reason: 'metadata document must be a JSON object' };
	}
	const doc = document as Record<string, unknown>;
	if (doc.client_id !== clientId) return { ok: false, reason: 'metadata client_id does not match the document URL' };
	if (doc.client_secret !== undefined || doc.client_secret_expires_at !== undefined) {
		return { ok: false, reason: 'metadata document must not contain a client_secret' };
	}
	const method = doc.token_endpoint_auth_method;
	if (method !== undefined && method !== 'none') {
		return { ok: false, reason: 'only token_endpoint_auth_method "none" is supported for metadata document clients' };
	}
	const redirectUris = normalizeStringList(doc.redirect_uris, { max: OAUTH_MAX_REDIRECT_URIS, maxLength: 2000 });
	if (!redirectUris || redirectUris.length === 0) return { ok: false, reason: 'metadata redirect_uris must be a non-empty array' };
	if (!redirectUris.every(isAcceptableRedirectUriShape)) return { ok: false, reason: 'metadata redirect_uris contain an unsupported URI' };
	const fallbackName = new URL(clientId).hostname;
	return {
		ok: true,
		metadata: {
			clientId,
			clientName: sanitizeClientName(typeof doc.client_name === 'string' && doc.client_name.trim() ? doc.client_name : fallbackName),
			redirectUris,
		},
	};
}

/** 获取并校验元数据文档。`fetchImpl` 便于测试替换。 */
export async function fetchClientIdMetadataDocument(
	clientId: string,
	fetchImpl: typeof fetch = fetch
): Promise<ClientIdMetadataResult> {
	const problem = clientIdMetadataUrlProblem(clientId);
	if (problem) return { ok: false, reason: problem };
	let response: Response;
	try {
		response = await fetchImpl(clientId, {
			method: 'GET',
			redirect: 'manual',
			headers: { Accept: 'application/json' },
			signal: AbortSignal.timeout(OAUTH_CIMD_FETCH_TIMEOUT_MS),
		});
	} catch {
		return { ok: false, reason: 'failed to fetch the metadata document' };
	}
	if (response.status !== 200) {
		await response.body?.cancel().catch(() => undefined);
		return { ok: false, reason: `metadata document responded with HTTP ${response.status}` };
	}
	const text = await readLimitedText(response, OAUTH_CIMD_MAX_BYTES).catch(() => null);
	if (text === null) return { ok: false, reason: 'metadata document is too large or unreadable' };
	let parsed: unknown;
	try {
		parsed = JSON.parse(text);
	} catch {
		return { ok: false, reason: 'metadata document is not valid JSON' };
	}
	return parseClientIdMetadataDocument(clientId, parsed);
}

/** 已存的元数据是否还新鲜。 */
export function isClientIdMetadataFresh(fetchedAt: string | null, nowMs: number = Date.now()): boolean {
	if (!fetchedAt) return false;
	const at = Date.parse(fetchedAt);
	return Number.isFinite(at) && nowMs - at < OAUTH_CIMD_REFRESH_SECONDS * 1000;
}
