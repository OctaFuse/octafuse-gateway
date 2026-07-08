'use client';

import { useTranslations } from 'next-intl';
import {
	formatTokenCount,
	getTokenCountMagnitude,
	type TokenDisplayMode,
	type TokenCountMagnitude,
} from '@/lib/format-token-count';

const compactMagnitudeClasses: Record<TokenCountMagnitude, string> = {
	plain: 'text-gray-600',
	K: 'bg-sky-50 text-sky-700 ring-sky-100',
	M: 'bg-violet-50 text-violet-700 ring-violet-100 font-medium',
	B: 'bg-rose-50 text-rose-700 ring-rose-100 font-semibold',
};

export type AnalyticsTokenCountProps = {
	value: number | null | undefined;
	mode: TokenDisplayMode;
};

export function AnalyticsTokenCount({ value, mode }: AnalyticsTokenCountProps) {
	const t = useTranslations('pricing');
	const label = formatTokenCount(value, mode);
	const magnitude = getTokenCountMagnitude(value);

	if (mode !== 'compact' || magnitude === 'plain') {
		return <span className="text-gray-600 tabular-nums">{label}</span>;
	}

	return (
		<span
			className={`inline-flex min-w-[3.25rem] justify-center rounded-full px-2 py-0.5 text-xs tabular-nums ring-1 ${compactMagnitudeClasses[magnitude]}`}
			title={t('tokensTitle', { count: value?.toLocaleString('en-US') ?? label })}
		>
			{label}
		</span>
	);
}
