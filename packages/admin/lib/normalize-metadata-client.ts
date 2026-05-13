/**
 * Client-side JSON metadata for admin forms (API key / user plan editors).
 */
export type NormalizeMetadataResult =
	| { ok: true; value: string | null }
	| { ok: false; message: string };

export function normalizeMetadataClient(raw: string): NormalizeMetadataResult {
	const t = raw.trim();
	if (t === '') {
		return { ok: true, value: null };
	}
	try {
		return { ok: true, value: JSON.stringify(JSON.parse(t)) };
	} catch {
		return { ok: false, message: 'Metadata must be valid JSON' };
	}
}
