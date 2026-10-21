/**
 * 重新封装已经读完的 JSON 正文时，不能沿用上游的长度和压缩头。
 * `fetch` 解压后 body 已是明文，原样带回 `Content-Encoding` / `Content-Length`
 * 会让浏览器把明文当 gzip 解码，表现为 Failed to fetch。
 */
const REWRAPPED_HEADER_BLOCKLIST = new Set([
	'content-length',
	'content-encoding',
	'transfer-encoding',
	'connection',
]);

export function sanitizeRewrappedHeaders(source: Headers): Headers {
	const headers = new Headers();
	source.forEach((value, key) => {
		if (REWRAPPED_HEADER_BLOCKLIST.has(key.toLowerCase())) return;
		headers.append(key, value);
	});
	return headers;
}
