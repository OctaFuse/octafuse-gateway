export type ChargedCostFactorsSummary = {
	empty: boolean;
	/** 行内摘要，如 `gemini-2.5-flash ×0.8 · +2` 或 `gpt-5 web ×0.5 · +2` */
	summary: string;
	/** 弹窗完整 pretty JSON */
	full: string;
	count: number;
};

type ChargedCostFactorValue = number | Record<string, number>;

function formatFactor(n: number): string {
	return `×${n.toLocaleString('en-US', { maximumFractionDigits: 6 })}`;
}

function isFactorMap(value: unknown): value is Record<string, number> {
	return value != null && typeof value === 'object' && !Array.isArray(value);
}

/** 仅做列表展示；不引用 @octafuse/core，避免 Client Component 打进 Node/Postgres。 */
function asFactors(
	raw: Record<string, ChargedCostFactorValue> | string | null | undefined
): Record<string, ChargedCostFactorValue> | null {
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
	const out: Record<string, ChargedCostFactorValue> = {};
	for (const [rawKey, rawVal] of Object.entries(obj)) {
		const key = rawKey.trim();
		if (!key) continue;
		if (typeof rawVal === 'number') {
			if (Number.isFinite(rawVal) && rawVal >= 0) out[key] = rawVal;
			continue;
		}
		if (!isFactorMap(rawVal)) continue;
		const groups: Record<string, number> = {};
		for (const [rawGroup, rawFactor] of Object.entries(rawVal)) {
			const group = rawGroup.trim();
			const n = typeof rawFactor === 'number' ? rawFactor : Number(rawFactor);
			if (!group || !Number.isFinite(n) || n < 0) continue;
			groups[group] = n;
		}
		if (Object.keys(groups).length > 0) out[key] = groups;
	}
	return Object.keys(out).length > 0 ? out : null;
}

function factorLeaves(factors: Record<string, ChargedCostFactorValue>): Array<{ label: string; factor: number }> {
	const leaves: Array<{ label: string; factor: number }> = [];
	const modelIds = Object.keys(factors).sort((a, b) => a.localeCompare(b, undefined, { sensitivity: 'base' }));
	for (const modelId of modelIds) {
		const value = factors[modelId];
		if (typeof value === 'number') {
			leaves.push({ label: modelId, factor: value });
			continue;
		}
		const groups = Object.keys(value).sort((a, b) => {
			if (a === '*') return -1;
			if (b === '*') return 1;
			return a.localeCompare(b, undefined, { sensitivity: 'base' });
		});
		for (const group of groups) {
			leaves.push({ label: `${modelId} ${group}`, factor: value[group]! });
		}
	}
	return leaves;
}

/** 列表行摘要：已解析对象或 JSON 字符串均可。分组倍率按「模型 分组」展开计数。 */
export function summarizeChargedCostFactors(
	raw: Record<string, ChargedCostFactorValue> | string | null | undefined
): ChargedCostFactorsSummary {
	const factors = asFactors(raw);
	if (!factors) {
		return { empty: true, summary: '', full: '', count: 0 };
	}
	const leaves = factorLeaves(factors);
	if (leaves.length === 0) {
		return { empty: true, summary: '', full: '', count: 0 };
	}
	const [first] = leaves;
	const head = `${first!.label} ${formatFactor(first!.factor)}`;
	const rest = leaves.length - 1;
	return {
		empty: false,
		summary: rest > 0 ? `${head} · +${rest}` : head,
		full: JSON.stringify(factors, null, 2),
		count: leaves.length,
	};
}
