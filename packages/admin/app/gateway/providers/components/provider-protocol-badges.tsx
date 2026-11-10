'use client';

import { useTranslations } from 'next-intl';
import type { ProviderProtocolSummary } from '../types';
import { ProviderProtocolIcon } from './provider-protocol-icon';

/** 与供应商卡片相同的协议端点标签：协议图标 + 已配置端点。 */
export function ProviderProtocolBadges(props: {
	summaries: ProviderProtocolSummary[];
	muted?: boolean;
	compact?: boolean;
}) {
	const t = useTranslations('providers.card');
	const upstream = useTranslations('upstream');
	const { summaries, muted = false, compact = false } = props;

	return (
		<div className="flex min-w-0 flex-wrap gap-1.5">
			{summaries.map((protocol) => {
				const badgeLabels = protocol.badges.map((badge) => t(`cap.${badge}`));
				const capabilitySummary =
					badgeLabels.length > 0
						? badgeLabels.join(' · ')
						: t('endpointCount', { count: protocol.endpoints.length });
				const protocolSummary = t('capabilitiesSr', {
					label: protocol.label,
					caps: capabilitySummary,
				});

				return (
					<span
						key={protocol.key}
						data-protocol={protocol.key}
						className={`provider-protocol-tile inline-flex max-w-full items-center gap-1.5 rounded-md border px-2 py-1 text-xs leading-4 ${
							muted
								? 'border-slate-200 bg-slate-100/60 text-slate-500 grayscale'
								: 'border-gray-100 bg-gray-50/70 text-gray-600'
						}`}
						title={protocolSummary}
						aria-label={protocolSummary}
					>
						<span className="provider-protocol-symbol h-3.5 w-3.5 shrink-0" aria-hidden>
							<ProviderProtocolIcon protocol={protocol.key} />
						</span>
						<span className="min-w-0">
							<span className="block truncate">{upstream(protocol.key)}</span>
							{!compact && badgeLabels.length > 0 ? <span className="mt-0.5 block truncate text-xs text-slate-500">{badgeLabels.slice(0, 2).join(' · ')}{badgeLabels.length > 2 ? ` +${badgeLabels.length - 2}` : ''}</span> : null}
						</span>
					</span>
				);
			})}
		</div>
	);
}
