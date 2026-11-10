'use client';

import { ClockIcon, LinkIcon, UsersIcon } from '@heroicons/react/24/outline';
import { formatStickyIdleTtlShort } from '@octafuse/core/db/route-pool-sticky-types';
import { useTranslations } from 'next-intl';
import { useStickySummary } from '../sticky-summary-store';

type Props = {
	enabled: boolean;
	idleTtlSeconds: number;
	poolId?: string | null;
	disabled?: boolean;
	onClick: () => void;
};

function ChipSep() {
	return (
		<span className="text-xs opacity-60" aria-hidden>
			·
		</span>
	);
}

export function ProviderStickyChip(props: Props) {
	const { enabled, idleTtlSeconds, poolId, disabled, onClick } = props;
	const t = useTranslations('routes.providerSticky');
	const ttl = formatStickyIdleTtlShort(idleTtlSeconds);
	const summary = useStickySummary(enabled ? poolId : null);
	const activeCount = summary?.total_active ?? null;

	const ariaLabel =
		enabled && activeCount != null
			? t('chipOnWithCount', { ttl, count: activeCount })
			: enabled
				? t('chipOn', { ttl })
				: t('chipOff');

	return (
		<button
			type="button"
			onClick={onClick}
			disabled={disabled}
			title={t('tooltip')}
			aria-label={ariaLabel}
			className={
				enabled
					? 'inline-flex max-w-full items-center gap-1 rounded-md bg-emerald-100 px-2 py-0.5 text-xs font-medium text-emerald-800 shadow-sm ring-1 ring-inset ring-emerald-300 transition hover:bg-emerald-200/80 focus:outline-none focus-visible:ring-2 focus-visible:ring-gray-500 disabled:cursor-not-allowed disabled:opacity-50'
					: 'inline-flex max-w-full items-center gap-1 rounded-md bg-slate-100 px-2 py-0.5 text-xs font-medium text-slate-500 shadow-sm ring-1 ring-inset ring-slate-300 transition hover:bg-slate-200/80 focus:outline-none focus-visible:ring-2 focus-visible:ring-gray-500 disabled:cursor-not-allowed disabled:opacity-50'
			}
		>
			<LinkIcon className="h-3 w-3 shrink-0" aria-hidden />
			<span className="truncate">{t('chipLabel')}</span>
			<ChipSep />
			{enabled ? (
				<>
					<ClockIcon className="h-3 w-3 shrink-0" aria-hidden />
					<span className="tabular-nums">{ttl}</span>
					{activeCount != null ? (
						<>
							<ChipSep />
							<UsersIcon className="h-3 w-3 shrink-0" aria-hidden />
							<span className="tabular-nums">{activeCount}</span>
						</>
					) : null}
				</>
			) : (
				<span>{t('chipOffState')}</span>
			)}
		</button>
	);
}
