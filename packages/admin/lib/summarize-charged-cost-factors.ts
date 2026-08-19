export type ChargedCostFactorsSummary = {
	empty: boolean;
	/** 行内摘要，如 `gemini-2.5-flash ×0.8 · +2` */
	summary: string;
	/** 弹窗完整 pretty JSON */
	full: string;
	count: number;
};

function formatFactor(n: number): string {
	return `×${n.toLocaleString('en-US', { maximumFractionDigits: 6 })}`;
}

/** 仅做列表展示；不引用 @octafuse/core，避免 Client Component 打进 Node/Postgres。 */
function asFactors(raw: Record<string, number> | string | null | undefined): Record<string, number> | null {
	let obj: Record<string, unknown> | null = null;
	if (raw && typeof raw === 'object' && !Array.isArray(raw)) {
		obj = raw;
	} else if (typeof raw === 'string' && raw.trim() !== '') {
		try {
			const parsed: unknown = JSON.parse(raw);
			if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
				obj = parsed as Record<string, unknown>;
			}
		} catch {
			return null;
		}
	}
	if (!obj) {
		return null;
	}
	const out: Record<string, number> = {};
	for (const [rawKey, rawVal] of Object.entries(obj)) {
		const key = rawKey.trim();
		const n = typeof rawVal === 'number' ? rawVal : Number(rawVal);
		if (!key || !Number.isFinite(n) || n < 0) {
			continue;
		}
		out[key] = n;
	}
	return Object.keys(out).length > 0 ? out : null;
}

/** 列表行摘要：已解析对象或 JSON 字符串均可。 */
export function summarizeChargedCostFactors(
	raw: Record<string, number> | string | null | undefined
): ChargedCostFactorsSummary {
	const factors = asFactors(raw);
	if (!factors) {
		return { empty: true, summary: '', full: '', count: 0 };
	}
	const entries = Object.entries(factors).sort(([a], [b]) =>
		a.localeCompare(b, undefined, { sensitivity: 'base' })
	);
	if (entries.length === 0) {
		return { empty: true, summary: '', full: '', count: 0 };
	}
	const [firstId, firstFactor] = entries[0];
	const head = `${firstId} ${formatFactor(firstFactor)}`;
	const rest = entries.length - 1;
	return {
		empty: false,
		summary: rest > 0 ? `${head} · +${rest}` : head,
		full: JSON.stringify(Object.fromEntries(entries), null, 2),
		count: entries.length,
	};
}
