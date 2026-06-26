/**
 * Analytics Usage 页 token 展示：纯数字千分位 vs K/M/B 紧凑格式（仅 UI，不影响 CSV）。
 */
export type TokenDisplayMode = 'numeric' | 'compact';

function trimTrailingZeros(raw: string): string {
	if (!raw.includes('.')) return raw;
	return raw.replace(/(\.\d*?[1-9])0+$/, '$1').replace(/\.0+$/, '');
}

function formatCompactUnit(value: number, divisor: number, suffix: string): string {
	return `${trimTrailingZeros((value / divisor).toFixed(2))}${suffix}`;
}

export function formatTokenCount(
	value: number | null | undefined,
	mode: TokenDisplayMode = 'numeric'
): string {
	if (value == null || !Number.isFinite(value)) return '—';

	if (mode === 'numeric') {
		return value.toLocaleString('en-US');
	}

	const abs = Math.abs(value);
	if (abs >= 1_000_000_000) {
		return formatCompactUnit(value, 1_000_000_000, 'B');
	}
	if (abs >= 1_000_000) {
		return formatCompactUnit(value, 1_000_000, 'M');
	}
	if (abs >= 1_000) {
		return formatCompactUnit(value, 1_000, 'K');
	}
	return String(value);
}
