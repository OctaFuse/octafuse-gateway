export function formatLatencyMs(ms: number | null | undefined): string {
	if (ms == null || !Number.isFinite(ms)) return '—';
	return `${Math.round(ms)} ms`;
}
