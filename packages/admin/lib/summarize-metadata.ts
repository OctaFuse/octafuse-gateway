/**
 * One-line metadata summary for admin tables (API keys, users, …).
 */
export type MetadataSummary = {
	ok: boolean;
	empty: boolean;
	/** 行内简短摘要（如 `plan_id: pro · +2`） */
	summary: string;
	/** 弹窗内完整 pretty JSON（解析失败时为原始字符串） */
	full: string;
};

export function summarizeMetadata(raw: string | null | undefined): MetadataSummary {
	if (raw == null || raw === '') {
		return { ok: true, empty: true, summary: '', full: '' };
	}
	try {
		const parsed = JSON.parse(raw);
		const full = JSON.stringify(parsed, null, 2);
		if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
			const entries = Object.entries(parsed as Record<string, unknown>);
			if (entries.length === 0) {
				return { ok: true, empty: false, summary: '{}', full };
			}
			const [firstKey, firstVal] = entries[0];
			const valueText = typeof firstVal === 'string' ? firstVal : JSON.stringify(firstVal);
			const head = `${firstKey}: ${valueText}`;
			const rest = entries.length - 1;
			return {
				ok: true,
				empty: false,
				summary: rest > 0 ? `${head} · +${rest}` : head,
				full,
			};
		}
		const compact = JSON.stringify(parsed);
		return { ok: true, empty: false, summary: compact, full };
	} catch {
		return { ok: false, empty: false, summary: raw, full: raw };
	}
}
