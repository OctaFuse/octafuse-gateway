'use client';

import { useTranslations } from 'next-intl';
import { formatLatencyMs } from '@/lib/format-latency';

export type AnalyticsTtftMetrics = {
	avg_first_reasoning_token_ms: number | null;
	avg_first_token_ms: number | null;
	avg_effective_ttft_ms: number | null;
	avg_reasoning_phase_ms: number | null;
	reasoning_ttft_rate: number;
	content_ttft_rate: number;
};

function formatRate(rate: number): string {
	return `${rate.toFixed(1)}%`;
}

export function buildAnalyticsTtftTooltip(metrics: AnalyticsTtftMetrics, t: (key: string) => string): string {
	const lines: string[] = [];
	if (metrics.avg_first_reasoning_token_ms != null) {
		lines.push(`${t('columns.avgTtftReasoningMs')}: ${formatLatencyMs(metrics.avg_first_reasoning_token_ms)}`);
	}
	if (metrics.avg_first_token_ms != null) {
		lines.push(`${t('columns.avgTtftContentMs')}: ${formatLatencyMs(metrics.avg_first_token_ms)}`);
	}
	if (metrics.avg_effective_ttft_ms != null) {
		lines.push(`${t('columns.avgEffectiveTtftMs')}: ${formatLatencyMs(metrics.avg_effective_ttft_ms)}`);
	}
	if (metrics.avg_reasoning_phase_ms != null) {
		lines.push(`${t('columns.avgReasoningPhaseMs')}: ${formatLatencyMs(metrics.avg_reasoning_phase_ms)}`);
	}
	lines.push(`${t('columns.reasoningTtftRate')}: ${formatRate(metrics.reasoning_ttft_rate)}`);
	lines.push(`${t('columns.contentTtftRate')}: ${formatRate(metrics.content_ttft_rate)}`);
	return lines.join('\n');
}

export function formatAnalyticsTtftPrimary(metrics: AnalyticsTtftMetrics): string | null {
	const hasReasoning =
		metrics.reasoning_ttft_rate > 0 && metrics.avg_first_reasoning_token_ms != null;
	if (hasReasoning) {
		return `R ${formatLatencyMs(metrics.avg_first_reasoning_token_ms)}`;
	}
	if (metrics.avg_first_token_ms != null) {
		return `C ${formatLatencyMs(metrics.avg_first_token_ms)}`;
	}
	if (metrics.avg_effective_ttft_ms != null) {
		return formatLatencyMs(metrics.avg_effective_ttft_ms);
	}
	return null;
}

export function AnalyticsTtftCell({
	metrics,
	noDataLabel,
}: {
	metrics: AnalyticsTtftMetrics;
	noDataLabel: string;
}) {
	const t = useTranslations('analytics');
	const primary = formatAnalyticsTtftPrimary(metrics);
	if (primary == null) {
		return <span className="text-gray-400">{noDataLabel}</span>;
	}
	const tooltip = buildAnalyticsTtftTooltip(metrics, t);
	return (
		<span className="tabular-nums" title={tooltip}>
			{primary}
		</span>
	);
}
