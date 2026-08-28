/**
 * 浏览器原生 WebSocket 不能设置 Authorization 请求头，实时网关入口使用
 * 一个带 API Key 的 Sec-WebSocket-Protocol token 完成握手鉴权。
 */
export const DASHSCOPE_REALTIME_AUTH_PROTOCOL_PREFIX = 'octafuse-api-key.';

export function buildDashScopeRealtimeAuthProtocol(apiKey: string): string {
	const key = apiKey.trim();
	if (!key) throw new Error('Realtime API key is empty');
	return `${DASHSCOPE_REALTIME_AUTH_PROTOCOL_PREFIX}${key}`;
}

/** 从 Sec-WebSocket-Protocol 的逗号分隔 offer 中提取网关 API Key。 */
export function parseDashScopeRealtimeAuthProtocol(
	header: string | null | undefined
): { apiKey: string; protocol: string } | null {
	const offered = String(header ?? '')
		.split(',')
		.map((value) => value.trim())
		.find((value) => value.startsWith(DASHSCOPE_REALTIME_AUTH_PROTOCOL_PREFIX));
	if (!offered) return null;
	const apiKey = offered.slice(DASHSCOPE_REALTIME_AUTH_PROTOCOL_PREFIX.length).trim();
	return apiKey ? { apiKey, protocol: offered } : null;
}

/**
 * Node `ws` `handleProtocols`：优先回写网关鉴权子协议，避免客户端同时 offer 其他值时选错。
 */
export function pickDashScopeRealtimeSubprotocol(protocols: Iterable<string>): string | false {
	const offered = [...protocols];
	const auth = offered.find((value) => value.startsWith(DASHSCOPE_REALTIME_AUTH_PROTOCOL_PREFIX));
	if (auth) return auth;
	return offered[0] ?? false;
}
