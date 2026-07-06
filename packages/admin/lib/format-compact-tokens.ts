export function trimTrailingZeros(raw: string): string {
	if (!raw.includes('.')) return raw;
	return raw.replace(/(\.\d*?[1-9])0+$/, '$1').replace(/\.0+$/, '');
}

export function formatCompactTokens(value: number | null | undefined): string {
	if (value == null || !Number.isFinite(value)) return '—';
	const abs = Math.abs(value);
	if (abs >= 1_000_000) return `${trimTrailingZeros((value / 1_000_000).toFixed(2))}M`;
	if (abs >= 1_000) return `${trimTrailingZeros((value / 1_000).toFixed(2))}K`;
	return String(value);
}
