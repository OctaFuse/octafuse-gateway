import {
	DASHSCOPE_REALTIME_INFERENCE_PATH,
	ELEVENLABS_SPEECH_TO_TEXT_REALTIME_PATH,
	DASHSCOPE_REALTIME_SESSION_PATH,
	LEGACY_DASHSCOPE_REALTIME_PATH,
} from './adapters/registry';

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

/**
 * DashScope 实时 WebSocket 入口路径判断（含旧入口别名）。
 * 这些入口允许浏览器用 `Sec-WebSocket-Protocol` 携带 API Key，Node upgrade 白名单也用它。
 */
export function isDashScopeRealtimePath(pathname: string): boolean {
	const path = pathname.length > 1 && pathname.endsWith('/') ? pathname.slice(0, -1) : pathname;
	return (
		path === DASHSCOPE_REALTIME_SESSION_PATH ||
		path === DASHSCOPE_REALTIME_INFERENCE_PATH ||
		// TEMP(soloent)：旧实时入口别名，删除条件见 proxy `app.ts` 的 TEMP 注释。
		path === LEGACY_DASHSCOPE_REALTIME_PATH
	);
}

function trimTrailingSlash(pathname: string): string {
	return pathname.length > 1 && pathname.endsWith('/') ? pathname.slice(0, -1) : pathname;
}

const ELEVENLABS_TTS_REALTIME_PATH_RE = /^\/elevenlabs\/v1\/text-to-speech\/([^/]+)\/stream-input$/;

/** ElevenLabs TTS WebSocket 入口 `/elevenlabs/v1/text-to-speech/{voice_id}/stream-input`；返回解码后的 voice_id。 */
export function parseElevenLabsTtsRealtimePath(pathname: string): { voiceId: string } | null {
	const match = ELEVENLABS_TTS_REALTIME_PATH_RE.exec(trimTrailingSlash(pathname));
	if (!match) return null;
	try {
		const voiceId = decodeURIComponent(match[1]!);
		return voiceId ? { voiceId } : null;
	} catch {
		return null;
	}
}

/** ElevenLabs 实时转写 WebSocket 入口 `/elevenlabs/v1/speech-to-text/realtime`。 */
export function isElevenLabsSttRealtimePath(pathname: string): boolean {
	return trimTrailingSlash(pathname) === ELEVENLABS_SPEECH_TO_TEXT_REALTIME_PATH;
}

/** ElevenLabs 两条 WebSocket 入口之一。 */
export function isElevenLabsRealtimePath(pathname: string): boolean {
	return parseElevenLabsTtsRealtimePath(pathname) !== null || isElevenLabsSttRealtimePath(pathname);
}

/**
 * 网关支持 WebSocket 升级的全部入口（DashScope + ElevenLabs）。
 * 鉴权允许 `Sec-WebSocket-Protocol` 携带 API Key，Node upgrade 白名单也用它。
 */
export function isRealtimeUpgradePath(pathname: string): boolean {
	return isDashScopeRealtimePath(pathname) || isElevenLabsRealtimePath(pathname);
}
