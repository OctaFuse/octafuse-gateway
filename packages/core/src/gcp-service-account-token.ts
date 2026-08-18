/**
 * GCP 服务账号 JSON → OAuth access token（JWT bearer grant）。
 * 使用 Web Crypto，兼容 Cloudflare Workers 与 Node。token 只缓存在进程内存。
 */

export const GCP_OAUTH_TOKEN_URL = 'https://oauth2.googleapis.com/token';
export const GCP_CLOUD_PLATFORM_SCOPE = 'https://www.googleapis.com/auth/cloud-platform';
const TOKEN_REFRESH_SKEW_MS = 5 * 60 * 1000;
const JWT_LIFETIME_SECONDS = 3600;

export type GcpServiceAccount = {
	type: 'service_account';
	client_email: string;
	private_key: string;
	token_uri?: string;
};

export type ResolveProviderUpstreamSecretOptions = {
	fetchImpl?: typeof fetch;
	nowMs?: () => number;
};

export type ResolvedProviderUpstreamSecret = {
	secret: string;
	isServiceAccount: boolean;
	clientEmail?: string;
};

type CachedToken = {
	accessToken: string;
	expiresAtMs: number;
};

const tokenCache = new Map<string, CachedToken>();
const inflight = new Map<string, Promise<string>>();

export function parseGcpServiceAccountJson(raw: string): GcpServiceAccount | null {
	const trimmed = raw.trim();
	if (!trimmed.startsWith('{')) return null;
	try {
		const parsed = JSON.parse(trimmed) as Record<string, unknown>;
		if (parsed.type !== 'service_account') return null;
		const clientEmail = typeof parsed.client_email === 'string' ? parsed.client_email.trim() : '';
		const privateKey = typeof parsed.private_key === 'string' ? parsed.private_key : '';
		if (!clientEmail || !privateKey.includes('BEGIN') || !privateKey.includes('PRIVATE KEY')) {
			return null;
		}
		const tokenUri = typeof parsed.token_uri === 'string' ? parsed.token_uri.trim() : '';
		return {
			type: 'service_account',
			client_email: clientEmail,
			private_key: privateKey.replace(/\\n/g, '\n'),
			...(tokenUri ? { token_uri: tokenUri } : {}),
		};
	} catch {
		return null;
	}
}

export function isGcpServiceAccountJson(raw: string | null | undefined): boolean {
	return typeof raw === 'string' && parseGcpServiceAccountJson(raw) != null;
}

export function gcpServiceAccountCacheKey(account: GcpServiceAccount): string {
	return `${account.client_email}\n${account.private_key}`;
}

export function clearGcpServiceAccountTokenCache(): void {
	tokenCache.clear();
	inflight.clear();
}

export async function resolveProviderUpstreamSecret(
	raw: string,
	options: ResolveProviderUpstreamSecretOptions = {}
): Promise<ResolvedProviderUpstreamSecret> {
	const account = parseGcpServiceAccountJson(raw);
	if (!account) {
		return { secret: raw, isServiceAccount: false };
	}
	const accessToken = await getGcpAccessToken(account, options);
	return {
		secret: accessToken,
		isServiceAccount: true,
		clientEmail: account.client_email,
	};
}

export async function getGcpAccessToken(
	account: GcpServiceAccount,
	options: ResolveProviderUpstreamSecretOptions = {}
): Promise<string> {
	const nowMs = options.nowMs ?? Date.now;
	const cacheKey = gcpServiceAccountCacheKey(account);
	const cached = tokenCache.get(cacheKey);
	if (cached && cached.expiresAtMs - TOKEN_REFRESH_SKEW_MS > nowMs()) {
		return cached.accessToken;
	}

	const pending = inflight.get(cacheKey);
	if (pending) return pending;

	const request = exchangeGcpAccessToken(account, options)
		.then((token) => {
			tokenCache.set(cacheKey, token);
			return token.accessToken;
		})
		.finally(() => {
			inflight.delete(cacheKey);
		});
	inflight.set(cacheKey, request);
	return request;
}

async function exchangeGcpAccessToken(
	account: GcpServiceAccount,
	options: ResolveProviderUpstreamSecretOptions
): Promise<CachedToken> {
	const nowMs = options.nowMs ?? Date.now;
	const fetchImpl = options.fetchImpl ?? fetch;
	const tokenUrl = account.token_uri?.trim() || GCP_OAUTH_TOKEN_URL;
	const assertion = await signGcpServiceAccountJwt(account, tokenUrl, nowMs);
	const body = new URLSearchParams({
		grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer',
		assertion,
	});
	const response = await fetchImpl(tokenUrl, {
		method: 'POST',
		headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
		body: body.toString(),
	});
	const text = await response.text();
	if (!response.ok) {
		throw new Error(`GCP token exchange failed (${response.status}): ${truncateError(text)}`);
	}
	let payload: { access_token?: unknown; expires_in?: unknown };
	try {
		payload = JSON.parse(text) as { access_token?: unknown; expires_in?: unknown };
	} catch {
		throw new Error('GCP token exchange returned non-JSON');
	}
	const accessToken = typeof payload.access_token === 'string' ? payload.access_token.trim() : '';
	if (!accessToken) {
		throw new Error('GCP token exchange response missing access_token');
	}
	const expiresIn =
		typeof payload.expires_in === 'number' && Number.isFinite(payload.expires_in)
			? payload.expires_in
			: JWT_LIFETIME_SECONDS;
	return {
		accessToken,
		expiresAtMs: nowMs() + Math.max(60, expiresIn) * 1000,
	};
}

export async function signGcpServiceAccountJwt(
	account: GcpServiceAccount,
	audience: string,
	nowMs: () => number = Date.now
): Promise<string> {
	const nowSeconds = Math.floor(nowMs() / 1000);
	const header = { alg: 'RS256', typ: 'JWT' };
	const claims = {
		iss: account.client_email,
		sub: account.client_email,
		aud: audience,
		iat: nowSeconds,
		exp: nowSeconds + JWT_LIFETIME_SECONDS,
		scope: GCP_CLOUD_PLATFORM_SCOPE,
	};
	const signingInput = `${base64UrlJson(header)}.${base64UrlJson(claims)}`;
	const key = await importRsaPrivateKey(account.private_key);
	const signature = await crypto.subtle.sign(
		'RSASSA-PKCS1-v1_5',
		key,
		new TextEncoder().encode(signingInput)
	);
	return `${signingInput}.${base64UrlEncode(new Uint8Array(signature))}`;
}

async function importRsaPrivateKey(pem: string): Promise<CryptoKey> {
	const der = decodePemToDer(pem);
	return crypto.subtle.importKey(
		'pkcs8',
		der,
		{ name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' },
		false,
		['sign']
	);
}

function decodePemToDer(pem: string): ArrayBuffer {
	const normalized = pem.replace(/\\n/g, '\n').trim();
	const pkcs8 = normalized.match(/-----BEGIN PRIVATE KEY-----([\s\S]+?)-----END PRIVATE KEY-----/);
	if (pkcs8?.[1]) return base64ToArrayBuffer(pkcs8[1]);
	const pkcs1 = normalized.match(/-----BEGIN RSA PRIVATE KEY-----([\s\S]+?)-----END RSA PRIVATE KEY-----/);
	if (pkcs1?.[1]) {
		return wrapPkcs1ToPkcs8(new Uint8Array(base64ToArrayBuffer(pkcs1[1]))).buffer;
	}
	throw new Error('GCP service account private_key must be a PEM PRIVATE KEY');
}

function wrapPkcs1ToPkcs8(pkcs1: Uint8Array): Uint8Array {
	const version = new Uint8Array([0x02, 0x01, 0x00]);
	const rsaOid = new Uint8Array([
		0x30, 0x0d, 0x06, 0x09, 0x2a, 0x86, 0x48, 0x86, 0xf7, 0x0d, 0x01, 0x01, 0x01, 0x05, 0x00,
	]);
	const octet = encodeDer(0x04, pkcs1);
	return encodeDer(0x30, concatBytes(version, rsaOid, octet));
}

function encodeDer(tag: number, content: Uint8Array): Uint8Array {
	const length = encodeDerLength(content.length);
	const out = new Uint8Array(1 + length.length + content.length);
	out[0] = tag;
	out.set(length, 1);
	out.set(content, 1 + length.length);
	return out;
}

function encodeDerLength(length: number): Uint8Array {
	if (length < 0x80) return new Uint8Array([length]);
	const bytes: number[] = [];
	let value = length;
	while (value > 0) {
		bytes.unshift(value & 0xff);
		value >>= 8;
	}
	return new Uint8Array([0x80 | bytes.length, ...bytes]);
}

function concatBytes(...parts: Uint8Array[]): Uint8Array {
	const total = parts.reduce((sum, part) => sum + part.length, 0);
	const out = new Uint8Array(total);
	let offset = 0;
	for (const part of parts) {
		out.set(part, offset);
		offset += part.length;
	}
	return out;
}

function base64UrlJson(value: unknown): string {
	return base64UrlEncode(new TextEncoder().encode(JSON.stringify(value)));
}

function base64UrlEncode(bytes: Uint8Array): string {
	return base64Encode(bytes).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
}

function base64Encode(bytes: Uint8Array): string {
	let binary = '';
	for (const byte of bytes) binary += String.fromCharCode(byte);
	return btoa(binary);
}

function base64ToArrayBuffer(base64: string): ArrayBuffer {
	const cleaned = base64.replace(/\s+/g, '');
	const binary = atob(cleaned);
	const bytes = new Uint8Array(binary.length);
	for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
	return bytes.buffer;
}

function truncateError(text: string): string {
	const compact = text.replace(/\s+/g, ' ').trim();
	return compact.length > 240 ? `${compact.slice(0, 240)}…` : compact;
}
