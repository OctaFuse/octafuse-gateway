'use client';

import { useTranslations } from 'next-intl';
import type { ProviderOverview } from '../types';

type ProviderSummaryProps = {
	pendingKeyCount: number;
	overview: ProviderOverview;
};

export function ProviderSummary(props: ProviderSummaryProps) {
	const { pendingKeyCount, overview } = props;
	const t = useTranslations('providers.summary');
	const tUpstream = useTranslations('upstream');

	return (
		<>
			{pendingKeyCount > 0 && (
				<div
					className="mb-4 rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900"
					role="status"
				>
					{t('pendingKeys', { count: pendingKeyCount })}
				</div>
			)}

			<div className="mb-5 grid grid-cols-2 gap-3 lg:grid-cols-5">
				<div className="rounded-lg border border-gray-200 bg-white px-4 py-3 shadow-sm">
					<div className="text-xs font-medium uppercase tracking-wide text-gray-500">{t('providers')}</div>
					<div className="mt-1 text-2xl font-semibold tabular-nums text-gray-900">{overview.total}</div>
				</div>
				<div className="rounded-lg border border-gray-200 bg-white px-4 py-3 shadow-sm">
					<div className="text-xs font-medium uppercase tracking-wide text-gray-500">{t('activeKeys')}</div>
					<div className="mt-1 text-2xl font-semibold tabular-nums text-gray-900">{overview.activeKeys}</div>
				</div>
				<div className="rounded-lg border border-gray-200 bg-white px-4 py-3 shadow-sm">
					<div className="text-xs font-medium uppercase tracking-wide text-gray-500">{tUpstream('openai')}</div>
					<div className="mt-1 text-2xl font-semibold tabular-nums text-emerald-700">{overview.protocols.openai}</div>
				</div>
				<div className="rounded-lg border border-gray-200 bg-white px-4 py-3 shadow-sm">
					<div className="text-xs font-medium uppercase tracking-wide text-gray-500">{tUpstream('anthropic')}</div>
					<div className="mt-1 text-2xl font-semibold tabular-nums text-orange-700">{overview.protocols.anthropic}</div>
				</div>
				<div className="rounded-lg border border-gray-200 bg-white px-4 py-3 shadow-sm">
					<div className="text-xs font-medium uppercase tracking-wide text-gray-500">{tUpstream('gemini')}</div>
					<div className="mt-1 text-2xl font-semibold tabular-nums text-indigo-700">{overview.protocols.gemini}</div>
				</div>
			</div>

			{overview.withoutKeys > 0 && (
				<div className="mb-4 rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800" role="status">
					{t('withoutKeys', { count: overview.withoutKeys })}
				</div>
			)}
		</>
	);
}
