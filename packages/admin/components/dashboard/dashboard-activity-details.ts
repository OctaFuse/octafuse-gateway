import type { GatewayRequestLog } from '@/lib/types';
import { resolveInvocationSource } from '@/lib/tool-invocation-detail';
import { dashboardErrorSummary } from './dashboard-presentation';
import { formatCompactTokens } from '@/lib/format-compact-tokens';

type UsageLabels = { tokens: string; images: string; seconds: string; characters: string; calls: string; input: string; output: string; cacheRead: string };
function observation(value: unknown): number | null {
	const numeric = typeof value === 'number' ? value : typeof value === 'string' && /^[+-]?(?:\d+\.?\d*|\.\d+)(?:e[+-]?\d+)?$/i.test(value.trim()) ? Number(value) : Number.NaN;
	return Number.isFinite(numeric) && numeric >= 0 ? numeric : null;
}
const compact = (value: number | null) => value == null ? '—' : formatCompactTokens(value);

export function dashboardActivityUsage(log: GatewayRequestLog, labels: UsageLabels) {
	if (resolveInvocationSource(log) != null) {
		return { value: `1 ${labels.calls}`, title: `1 ${labels.calls}` };
	}
	if (log.billing_kind === 'image_per_image') {
		const input = observation(log.input_image_count);
		const output = observation(log.output_image_count);
		return { value: `${input != null && input > 0 ? `${compact(input)} / ${compact(output)}` : compact(output)} ${labels.images}`,
			title: `${labels.input} ${compact(input)} · ${labels.output} ${compact(output)}` };
	}
	if (log.billing_kind === 'audio_per_second' || log.billing_kind === 'audio_per_character') {
		const seconds = log.billing_kind === 'audio_per_second';
		const number = observation(seconds ? log.audio_duration_seconds : log.audio_characters);
		const value = `${number == null ? '—' : seconds ? number.toLocaleString('en-US', { maximumFractionDigits: 2 }) : compact(number)} ${seconds ? labels.seconds : labels.characters}`;
		return { value, title: value };
	}
	const input = observation(log.input_tokens);
	const output = observation(log.output_tokens);
	const total = observation(log.total_tokens);
	const value = (input == null && output == null) || (input === 0 && output === 0 && total != null && total > 0)
		? compact(total) : `${compact(input)} / ${compact(output)}`;
	return { value: `${value} ${labels.tokens}`, title: `${labels.input} ${compact(input)} · ${labels.output} ${compact(output)} · ${labels.cacheRead} ${compact(observation(log.cache_read_tokens))}` };
}

export function dashboardActivityDuration(value: unknown): string {
	const ms = observation(value);
	if (ms == null) return '—';
	return ms < 1000 ? `${Math.round(ms)}ms` : `${(ms / 1000).toLocaleString('en-US', { maximumFractionDigits: 2 })}s`;
}

export function dashboardActivityCostFactor(cost: unknown, standard: unknown): string | null {
	const amount = observation(cost);
	const basis = observation(standard);
	if (amount == null || basis == null || basis === 0) return null;
	const ratio = amount / basis;
	if (!Number.isFinite(ratio)) return null;
	return `×${ratio > 0 && ratio < 0.001 ? ratio.toExponential(1) : ratio.toLocaleString('en-US', { maximumFractionDigits: 3 })}`;
}

export function dashboardActivityMoney(value: unknown): number | null { return observation(value); }

/** Error activity prioritizes the cause; status codes have their own non-wrapping column. */
export function dashboardActivityError(message: string | null | undefined, fallback: string) {
	const text = dashboardErrorSummary(message, fallback);
	const code = message?.match(/\bHTTP\s+([45]\d{2})\b/i)?.[1];
	return { code: code ? `HTTP ${code}` : null,
		summary: text.replace(/^HTTP\s+[45]\d{2}\s*(?:[:·-]\s*)?/i, '').trim() || fallback,
		full: text };
}
