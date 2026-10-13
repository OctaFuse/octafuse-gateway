/** SHA-256 hex. Works on Workers and Node via Web Crypto. */
export async function sha256Hex(text: string): Promise<string> {
	const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
	return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, '0')).join('');
}

/** Stable JSON so content hashes do not change with key order. */
export function stableStringify(value: unknown): string {
	if (value === null || typeof value !== 'object') {
		return JSON.stringify(value) ?? 'null';
	}
	if (Array.isArray(value)) {
		return `[${value.map((entry) => stableStringify(entry)).join(',')}]`;
	}
	const record = value as Record<string, unknown>;
	const keys = Object.keys(record).sort();
	return `{${keys.map((key) => `${JSON.stringify(key)}:${stableStringify(record[key])}`).join(',')}}`;
}
