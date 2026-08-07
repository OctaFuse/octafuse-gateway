/** DashScope 异步 ASR 临时音频发布：R2 保存随机对象，经无鉴权随机 URL 暂时提供给上游。 */
import type { R2Bucket } from '@cloudflare/workers-types';
import type { AudioUpload } from './egress/openai-audio-driver';
import type { PublishedAudioUpload } from './egress/dashscope-audio-driver';

export const TEMPORARY_AUDIO_UPLOAD_TTL_MS = 15 * 60 * 1_000;

export type TemporaryAudioUploadBindings = {
	AUDIO_UPLOADS?: R2Bucket;
	PUBLIC_GATEWAY_BASE_URL?: string;
};

function validatePublicBaseUrl(raw: string): string {
	const url = new URL(raw.trim());
	if (url.protocol !== 'http:' && url.protocol !== 'https:') {
		throw new Error('PUBLIC_GATEWAY_BASE_URL must use http(s)');
	}
	url.pathname = url.pathname.replace(/\/+$/, '');
	url.search = '';
	url.hash = '';
	return url.toString().replace(/\/+$/, '');
}

/** 缺少 R2 或公网地址时不构造 publisher；异步 adapter 会明确报告缺失能力。 */
export function resolveTemporaryAudioPublisher(
	bindings: TemporaryAudioUploadBindings
): ((file: AudioUpload) => Promise<PublishedAudioUpload>) | undefined {
	if (!bindings.AUDIO_UPLOADS || !bindings.PUBLIC_GATEWAY_BASE_URL?.trim()) return undefined;
	const bucket = bindings.AUDIO_UPLOADS;
	const publicBaseUrl = validatePublicBaseUrl(bindings.PUBLIC_GATEWAY_BASE_URL);
	return async (file) => {
		const token = crypto.randomUUID();
		const expiresAt = Date.now() + TEMPORARY_AUDIO_UPLOAD_TTL_MS;
		await bucket.put(token, new Uint8Array(file.bytes), {
			httpMetadata: { contentType: file.mimeType || 'application/octet-stream' },
			customMetadata: { expires_at: String(expiresAt) },
		});
		return {
			url: `${publicBaseUrl}/v1/audio/uploads/${encodeURIComponent(token)}`,
			cleanup: () => bucket.delete(token),
		};
	};
}

export function isTemporaryAudioUploadToken(raw: string): boolean {
	return /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(raw);
}

export function temporaryAudioUploadExpired(customMetadata: Record<string, string> | undefined): boolean {
	const expiresAt = Number(customMetadata?.expires_at);
	if (!Number.isFinite(expiresAt)) {
		throw new Error('Temporary audio upload is missing expires_at metadata');
	}
	return Date.now() >= expiresAt;
}
