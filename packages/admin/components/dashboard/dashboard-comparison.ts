export function dashboardPeriodChange(current: number | null | undefined, previous: number | null | undefined, kind: 'count' | 'rate' | 'latency' | 'money') {
 if (current == null || previous == null || !Number.isFinite(current) || !Number.isFinite(previous)) return null;
 const delta = current - previous;
 const step = kind === 'rate' ? 0.05 : kind === 'money' ? 0.00005 : kind === 'latency' ? 1 : 1;
 if (Math.abs(delta) < step) return null;
 if (kind === 'rate') return { delta, value: Math.abs(delta), unit: 'points' as const };
 if (previous === 0) return current > 0 ? { delta, value: current, unit: 'new' as const } : null;
 const percent = Math.abs(delta / previous * 100);
 return percent >= 0.05 ? { delta, value: percent, unit: 'percent' as const } : null;
}
