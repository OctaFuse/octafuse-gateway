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

type TtftPrimaryKind = 'reasoning' | 'content' | 'effective';

type TtftPrimary = {
	kind: TtftPrimaryKind;
	ms: number;
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

export function resolveAnalyticsTtftPrimary(metrics: AnalyticsTtftMetrics): TtftPrimary | null {
	const hasReasoning =
		metrics.reasoning_ttft_rate > 0 && metrics.avg_first_reasoning_token_ms != null;
	if (hasReasoning && metrics.avg_first_reasoning_token_ms != null) {
		return { kind: 'reasoning', ms: metrics.avg_first_reasoning_token_ms };
	}
	if (metrics.avg_first_token_ms != null) {
		return { kind: 'content', ms: metrics.avg_first_token_ms };
	}
	if (metrics.avg_effective_ttft_ms != null) {
		return { kind: 'effective', ms: metrics.avg_effective_ttft_ms };
	}
	return null;
}

export function formatAnalyticsTtftPrimary(metrics: AnalyticsTtftMetrics): string | null {
	const primary = resolveAnalyticsTtftPrimary(metrics);
	if (primary == null) return null;
	if (primary.kind === 'reasoning') return `R ${formatLatencyMs(primary.ms)}`;
	if (primary.kind === 'content') return `C ${formatLatencyMs(primary.ms)}`;
	return formatLatencyMs(primary.ms);
}

const TTFT_BADGE_CLASS: Record<'reasoning' | 'content', string> = {
	reasoning: 'bg-amber-100 text-amber-800 ring-1 ring-inset ring-amber-200/80',
	content: 'bg-sky-100 text-sky-800 ring-1 ring-inset ring-sky-200/80',
};

export function AnalyticsTtftCell({
	metrics,
	noDataLabel,
}: {
	metrics: AnalyticsTtftMetrics;
	noDataLabel: string;
}) {
	const t = useTranslations('analytics');
	const primary = resolveAnalyticsTtftPrimary(metrics);
	if (primary == null) {
		return <span className="text-gray-400">{noDataLabel}</span>;
	}
	const tooltip = buildAnalyticsTtftTooltip(metrics, t);
	return (
		<span className="inline-flex items-center gap-1.5 tabular-nums" title={tooltip}>
			{primary.kind === 'reasoning' || primary.kind === 'content' ? (
				<span
					className={`inline-flex min-w-[1.125rem] items-center justify-center rounded px-1 py-0.5 text-[10px] font-semibold leading-none ${TTFT_BADGE_CLASS[primary.kind]}`}
				>
					{primary.kind === 'reasoning' ? 'R' : 'C'}
				</span>
			) : null}
			<span className="text-gray-700">{formatLatencyMs(primary.ms)}</span>
		</span>
	);
}
