/**
 * 请求日志用的消息结构摘要：只记字段名和 content part 的 type，不记正文。
 * 用来判断上游拒绝的是消息级字段（例如 reasoning_content），而不是顶层参数。
 */

const MAX_LABEL_CHARS = 64;

export type MessagesShapeForLog = {
	[role: string]: string[] | Record<string, string[]>;
	content_types?: Record<string, string[]>;
};

function asRecord(value: unknown): Record<string, unknown> | null {
	if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
	return value as Record<string, unknown>;
}

function shortLabel(value: unknown): string | null {
	if (typeof value !== 'string') return null;
	const trimmed = value.trim();
	if (!trimmed || trimmed.length > MAX_LABEL_CHARS) return null;
	return trimmed;
}

function bucketKey(record: Record<string, unknown>): string {
	return shortLabel(record.role) ?? shortLabel(record.type) ?? 'unknown';
}

/** 按 role（没有 role 时用 type）汇总出现过的字段名，以及 content 数组里的 part type。 */
export function summarizeMessagesShapeForLog(messages: unknown): MessagesShapeForLog | null {
	if (!Array.isArray(messages) || messages.length === 0) return null;

	const keysByRole = new Map<string, Set<string>>();
	const typesByRole = new Map<string, Set<string>>();

	for (const item of messages) {
		const record = asRecord(item);
		if (!record) continue;
		const role = bucketKey(record);
		let keys = keysByRole.get(role);
		if (!keys) {
			keys = new Set();
			keysByRole.set(role, keys);
		}
		for (const key of Object.keys(record)) {
			if (key === 'role') continue;
			keys.add(key);
		}

		if (!Array.isArray(record.content)) continue;
		let types = typesByRole.get(role);
		if (!types) {
			types = new Set();
			typesByRole.set(role, types);
		}
		for (const part of record.content) {
			const partType = shortLabel(asRecord(part)?.type);
			if (partType) types.add(partType);
		}
	}

	if (keysByRole.size === 0) return null;

	const out: MessagesShapeForLog = {};
	for (const [role, keys] of keysByRole) {
		out[role] = [...keys].sort();
	}
	if (typesByRole.size > 0) {
		const contentTypes: Record<string, string[]> = {};
		for (const [role, types] of typesByRole) {
			if (types.size > 0) contentTypes[role] = [...types].sort();
		}
		if (Object.keys(contentTypes).length > 0) out.content_types = contentTypes;
	}
	return out;
}
