/**
 * 浏览器端把 MiniMax t2a_v2 的 hex 音频（同步 JSON 或 SSE）变成可播放的 object URL。
 * 仅供 Playground / Simulator 客户端调用。
 */
import {
	decodeMiniMaxHexAudio,
	extractMiniMaxSpeechAudio,
	miniMaxAudioContentType,
} from '@octafuse/core/minimax-native';

export function miniMaxSpeechObjectUrl(text: string): string | null {
	const extracted = extractMiniMaxSpeechAudio(text);
	if (!extracted) return null;
	try {
		const bytes = decodeMiniMaxHexAudio(extracted.hex);
		const copy = new Uint8Array(bytes.byteLength);
		copy.set(bytes);
		return URL.createObjectURL(new Blob([copy], { type: miniMaxAudioContentType(extracted.format) }));
	} catch {
		return null;
	}
}
