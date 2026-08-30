/** 调试台上游出站请求头：脱敏、响应头编解码。 */

const SECRET_HEADER_NAMES = new Set(['authorization', 'x-api-key', 'x-goog-api-key']);

export function redactPlaygroundOutboundHeaderValue(name: string, value: string): string {
	if (!SECRET_HEADER_NAMES.has(name.toLowerCase())) return value;
	const text = value.trim();
	const bearer = /^(Bearer\s+)(.+)$/i.exec(text);
	if (bearer) {
		const token = bearer[2] ?? '';
		if (token.length > 12) return `${bearer[1]}${token.slice(0, 7)}…${token.slice(-4)}`;
		return `${bearer[1]}••••••••`;
	}
	if (text.length > 12) return `${text.slice(0, 7)}…${text.slice(-4)}`;
	return '••••••••';
}

export function redactPlaygroundOutboundHeaders(headers: Record<string, string>): Record<string, string> {
	const out: Record<string, string> = {};
	for (const [name, value] of Object.entries(headers)) {
		out[name] = redactPlaygroundOutboundHeaderValue(name, value);
	}
	return out;
}

export function encodePlaygroundRequestHeadersHeader(headers: Record<string, string>): string {
	return encodeURIComponent(JSON.stringify(headers));
}

export function decodePlaygroundRequestHeadersHeader(res: Response): Record<string, string> | null {
	const raw = res.headers.get('x-playground-request-headers');
	if (raw == null || raw === '') return null;
	try {
		const parsed = JSON.parse(decodeURIComponent(raw)) as unknown;
		if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return null;
		const out: Record<string, string> = {};
		for (const [name, value] of Object.entries(parsed as Record<string, unknown>)) {
			if (typeof value === 'string') out[name] = value;
		}
		return Object.keys(out).length > 0 ? out : null;
	} catch {
		return null;
	}
}
