/**
 * `GET /v1/me` metadata：优先 `users.metadata`，key metadata 作回退/补全。
 */

export function parseMetadataJson(raw: string | null | undefined): Record<string, unknown> | null {
	if (raw == null || raw.trim() === '') return null;
	try {
		const parsed = JSON.parse(raw) as unknown;
		if (parsed !== null && typeof parsed === 'object' && !Array.isArray(parsed)) {
			return parsed as Record<string, unknown>;
		}
		return null;
	} catch {
		return null;
	}
}

/**
 * 合并 user 与 key metadata：user 字段优先；user 为空时回退 key；均无则 `null`。
 */
export function resolveMeMetadata(
	userMetadataJson: string | null | undefined,
	keyMetadataJson: string | null | undefined
): Record<string, unknown> | null {
	const userMeta = parseMetadataJson(userMetadataJson);
	const keyMeta = parseMetadataJson(keyMetadataJson);
	const userKeys = userMeta ? Object.keys(userMeta) : [];
	const keyKeys = keyMeta ? Object.keys(keyMeta) : [];
	if (userKeys.length === 0 && keyKeys.length === 0) return null;
	if (userKeys.length === 0) return keyMeta;
	return { ...(keyMeta ?? {}), ...userMeta };
}
