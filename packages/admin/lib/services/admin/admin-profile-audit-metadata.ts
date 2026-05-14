/**
 * 管理端用户/密钥资料 PATCH 审计：metadata 前后对比（与 `users-service` / `keys-service` 共用）。
 */
import type { JsonObject } from './types';

function parseMetadataSnapshot(raw: string | null | undefined): unknown {
	if (raw == null || raw === '') return null;
	try {
		return JSON.parse(raw) as unknown;
	} catch {
		return raw;
	}
}

function isPlainObject(value: unknown): value is JsonObject {
	return Boolean(value && typeof value === 'object' && !Array.isArray(value));
}

function metadataValueEqual(a: unknown, b: unknown): boolean {
	return JSON.stringify(a) === JSON.stringify(b);
}

/**
 * 将 metadata 变更编码为审计 `change_payload` 中的 `metadata` 片段。
 */
export function buildMetadataAuditChange(
	beforeRaw: string | null | undefined,
	afterRaw: string | null | undefined,
	operation: 'merge' | 'replace' | 'update',
	touchedKeys?: string[]
): JsonObject {
	const before = parseMetadataSnapshot(beforeRaw);
	const after = parseMetadataSnapshot(afterRaw);
	if (!isPlainObject(before) || !isPlainObject(after)) {
		return { operation, from: before, to: after };
	}
	const keys =
		touchedKeys && touchedKeys.length > 0
			? touchedKeys
			: Array.from(new Set([...Object.keys(before), ...Object.keys(after)]));
	const changes: JsonObject = {};
	for (const key of keys) {
		if (metadataValueEqual(before[key], after[key])) continue;
		changes[key] = { from: before[key] ?? null, to: after[key] ?? null };
	}
	return Object.keys(changes).length > 0 ? { operation, changes } : { operation, from: before, to: after };
}
