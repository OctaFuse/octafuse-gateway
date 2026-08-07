/** 无鉴权临时音频下载：URL 本身含随机 token，仅供 DashScope 异步任务拉取。 */
import { Hono } from 'hono';
import type { Context } from 'hono';
import type { Env } from '../../app';
import {
	isTemporaryAudioUploadToken,
	temporaryAudioUploadExpired,
} from '../../services/temporary-audio-upload';

export const audioUploadRoutes = new Hono<Env>();

async function loadUpload(c: Context<Env>) {
	const bucket = c.env.AUDIO_UPLOADS;
	if (!bucket) return null;
	const token = c.req.param('token');
	if (!token || !isTemporaryAudioUploadToken(token)) return null;
	const object = await bucket.get(token, { range: c.req.raw.headers });
	if (!object) return null;
	if (temporaryAudioUploadExpired(object.customMetadata)) {
		await bucket.delete(token);
		return null;
	}
	return { token, object };
}

audioUploadRoutes.get('/:token', async (c) => {
	const loaded = await loadUpload(c);
	if (!loaded) return c.body(null, 404);
	const headers = new Headers();
	loaded.object.writeHttpMetadata(headers);
	headers.set('Accept-Ranges', 'bytes');
	headers.set('Cache-Control', 'private, no-store');
	if (loaded.object.range) {
		const range = loaded.object.range;
		const length =
			'suffix' in range
				? Math.min(range.suffix, loaded.object.size)
				: (range.length ?? loaded.object.size - (range.offset ?? 0));
		const offset =
			'suffix' in range ? loaded.object.size - length : (range.offset ?? 0);
		headers.set('Content-Range', `bytes ${offset}-${offset + length - 1}/${loaded.object.size}`);
		headers.set('Content-Length', String(length));
		return new Response(loaded.object.body, { status: 206, headers });
	}
	headers.set('Content-Length', String(loaded.object.size));
	return new Response(loaded.object.body, { status: 200, headers });
});

audioUploadRoutes.on('HEAD', '/:token', async (c) => {
	const loaded = await loadUpload(c);
	if (!loaded) return c.body(null, 404);
	const headers = new Headers();
	loaded.object.writeHttpMetadata(headers);
	headers.set('Accept-Ranges', 'bytes');
	headers.set('Cache-Control', 'private, no-store');
	headers.set('Content-Length', String(loaded.object.size));
	return new Response(null, { status: 200, headers });
});
