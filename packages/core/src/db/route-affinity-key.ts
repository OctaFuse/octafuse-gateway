/**
 * Affinity key helpers shared by Proxy sticky routing and Admin lookup.
 * affinityKey = userId|baseModelId|routeGroup|protocol (no capability).
 */

/** Build the plaintext affinity key used for sticky + hash_affinity scoring. */
export function buildAffinityKey(
	userId: string,
	baseModelId: string,
	routeGroup: string,
	protocol: string
): string {
	return `${userId}|${baseModelId}|${routeGroup}|${protocol}`;
}

/** SHA-256 hex digest of an affinity key (stored as `affinity_hash`). */
export async function hashAffinityKey(affinityKey: string): Promise<string> {
	const data = new TextEncoder().encode(affinityKey);
	const digest = await crypto.subtle.digest('SHA-256', data);
	return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

export type ParsedAffinityKey = {
	userId: string;
	modelId: string;
	routeGroup: string;
	protocol: string;
};

/**
 * Inverse of `buildAffinityKey`. The user id is the first segment and
 * route group / protocol are the last two; whatever is in between is the model id.
 * Returns null for malformed keys.
 */
export function parseAffinityKey(affinityKey: string | null | undefined): ParsedAffinityKey | null {
	if (!affinityKey) return null;
	const parts = affinityKey.split('|');
	if (parts.length < 4) return null;
	const [userId, ...rest] = parts;
	const protocol = rest.pop() as string;
	const routeGroup = rest.pop() as string;
	const modelId = rest.join('|');
	if (!userId || !modelId) return null;
	return { userId, modelId, routeGroup, protocol };
}
