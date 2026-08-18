/**
 * 调试台把上游 Response 转给浏览器时，必须去掉 hop-by-hop / 已解码的压缩头。
 * 否则 Node 再分块时会出现非法 chunked 帧，浏览器 fetch 读流会抛 `network error`。
 */
const STRIP_HEADERS = new Set([
	'connection',
	'keep-alive',
	'proxy-authenticate',
	'proxy-authorization',
	'te',
	'trailer',
	'trailers',
	'transfer-encoding',
	'upgrade',
	'content-encoding',
	'content-length',
]);

export function copyPlaygroundUpstreamHeaders(source: Headers): Headers {
	const headers = new Headers();
	source.forEach((value, key) => {
		if (STRIP_HEADERS.has(key.toLowerCase())) return;
		headers.append(key, value);
	});
	const contentType = headers.get('content-type') ?? '';
	if (contentType.includes('text/event-stream')) {
		headers.set('cache-control', 'no-cache, no-transform');
		headers.set('x-accel-buffering', 'no');
	}
	return headers;
}
