/** Mask query values. The URL itself may carry an API key. */
export function maskMcpUrl(raw: string): string {
	try {
		const url = new URL(raw);
		url.username = '';
		url.password = '';
		for (const key of [...url.searchParams.keys()]) {
			url.searchParams.set(key, '***');
		}
		return url.toString();
	} catch {
		return '***';
	}
}

export function maskMcpHeaders(headers: Record<string, string>): Record<string, string> {
	const masked: Record<string, string> = {};
	for (const key of Object.keys(headers)) {
		masked[key] = '***';
	}
	return masked;
}

export function parseMcpAuthHeaders(raw: string | null | undefined): Record<string, string> {
	if (!raw || !raw.trim()) {
		return {};
	}
	let parsed: unknown;
	try {
		parsed = JSON.parse(raw);
	} catch {
		return {};
	}
	if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
		return {};
	}
	const out: Record<string, string> = {};
	for (const [key, value] of Object.entries(parsed)) {
		if (typeof value === 'string') {
			out[key] = value;
		}
	}
	return out;
}
