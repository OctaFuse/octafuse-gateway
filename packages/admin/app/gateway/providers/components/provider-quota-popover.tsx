'use client';

import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { BanknotesIcon } from '@heroicons/react/24/outline';
import { useLocale, useTranslations } from 'next-intl';
import type { ProviderQuotaSnapshot, ProviderQuotaState } from '@octafuse/core/provider-quota';
import { fetchProviderQuota } from '../provider-api';

type ProviderQuotaButtonProps = {
	providerId: string;
};

const WINDOW_LABEL_KEYS = {
	key_limit: 'window.key_limit',
	spend_limit: 'window.spend_limit',
	'5h': 'window.5h',
	weekly: 'window.weekly',
	monthly: 'window.monthly',
} as const;

const STATE_BADGE: Record<ProviderQuotaState, string> = {
	ok: 'bg-emerald-50 text-emerald-800 ring-emerald-200',
	low: 'bg-amber-50 text-amber-900 ring-amber-200',
	exhausted: 'bg-rose-50 text-rose-800 ring-rose-200',
	unknown: 'bg-slate-100 text-slate-700 ring-slate-200',
};

const STATE_BAR: Record<ProviderQuotaState, string> = {
	ok: 'bg-emerald-500',
	low: 'bg-amber-500',
	exhausted: 'bg-rose-500',
	unknown: 'bg-slate-400',
};

function formatTime(value: string, locale: string): string {
	const date = new Date(value);
	if (Number.isNaN(date.getTime())) return value;
	return date.toLocaleString(locale);
}

function formatQuantity(value: number, locale: string): string {
	return new Intl.NumberFormat(locale, { maximumFractionDigits: 4 }).format(value);
}

function formatMoney(value: number, currency: string, locale: string): string {
	try {
		return new Intl.NumberFormat(locale, {
			style: 'currency',
			currency,
			maximumFractionDigits: 4,
		}).format(value);
	} catch {
		return `${formatQuantity(value, locale)} ${currency}`;
	}
}

function windowCurrency(adapter: string): string | null {
	if (adapter === 'openrouter' || adapter === 'deepinfra') return 'USD';
	return null;
}

function windowLabel(id: string, labelFor: (key: keyof typeof WINDOW_LABEL_KEYS) => string): string {
	if (id in WINDOW_LABEL_KEYS) return labelFor(id as keyof typeof WINDOW_LABEL_KEYS);
	return id;
}

export function ProviderQuotaButton({ providerId }: ProviderQuotaButtonProps) {
	const t = useTranslations('providers.quota');
	const locale = useLocale();
	const [open, setOpen] = useState(false);
	const [attempt, setAttempt] = useState(0);
	const [loading, setLoading] = useState(false);
	const [snapshot, setSnapshot] = useState<ProviderQuotaSnapshot | null>(null);
	const [error, setError] = useState<string | null>(null);

	function startQuery() {
		setOpen(true);
		setLoading(true);
		setError(null);
		setSnapshot(null);
		setAttempt((current) => current + 1);
	}

	useEffect(() => {
		if (!open || attempt === 0) return;
		let cancelled = false;
		void fetchProviderQuota(providerId).then((result) => {
			if (cancelled) return;
			setLoading(false);
			if (result.success) setSnapshot(result.data);
			else setError(result.message);
		}).catch(() => {
			if (cancelled) return;
			setLoading(false);
			setError(t('failed'));
		});
		return () => {
			cancelled = true;
		};
	}, [open, providerId, attempt, t]);

	useEffect(() => {
		if (!open) return;
		const onKey = (event: KeyboardEvent) => {
			if (event.key === 'Escape') setOpen(false);
		};
		window.addEventListener('keydown', onKey);
		return () => window.removeEventListener('keydown', onKey);
	}, [open]);

	const dialog =
		open && typeof document !== 'undefined'
			? createPortal(
					<div className="fixed inset-0 z-50 flex items-center justify-center p-4">
						<button
							type="button"
							className="absolute inset-0 bg-slate-900/40"
							aria-label={t('close')}
							onClick={() => setOpen(false)}
						/>
						<div
							role="dialog"
							aria-modal="true"
							aria-labelledby="provider-quota-title"
							className="relative z-10 w-full max-w-md rounded-xl border border-slate-200 bg-white p-4 shadow-xl"
						>
							<div className="flex items-start justify-between gap-3">
								<h2 id="provider-quota-title" className="text-sm font-semibold text-slate-900">
									{t('title')}
								</h2>
								<button
									type="button"
									onClick={() => setOpen(false)}
									className="rounded-md px-2 py-1 text-xs text-slate-500 hover:bg-slate-100 hover:text-slate-800"
								>
									{t('close')}
								</button>
							</div>
							<div className="mt-3 space-y-3">
								{loading ? <p className="text-sm text-slate-500">{t('loading')}</p> : null}
								{error ? <p className="text-sm text-rose-700">{error}</p> : null}
								{snapshot ? (
									<QuotaSnapshotBody snapshot={snapshot} locale={locale} />
								) : null}
								{!loading && error ? (
									<button
										type="button"
										onClick={startQuery}
										className="text-xs font-medium text-blue-700 hover:text-blue-800"
									>
										{t('retry')}
									</button>
								) : null}
							</div>
						</div>
					</div>,
					document.body,
				)
			: null;

	return (
		<>
			<button
				type="button"
				onClick={(event) => {
					event.stopPropagation();
					startQuery();
				}}
				className="pointer-events-auto inline-flex h-7 items-center gap-1 rounded-md px-1.5 text-[11px] font-medium text-slate-600 hover:bg-slate-100 hover:text-slate-900 focus:outline-none focus:ring-2 focus:ring-blue-500"
				title={t('action')}
				aria-label={t('action')}
			>
				<BanknotesIcon className="h-3.5 w-3.5" aria-hidden />
				<span className="max-w-[4.5rem] truncate">{t('action')}</span>
			</button>
			{dialog}
		</>
	);
}

function QuotaSnapshotBody({
	snapshot,
	locale,
}: {
	snapshot: ProviderQuotaSnapshot;
	locale: string;
}) {
	const t = useTranslations('providers.quota');
	const currencyUnit = windowCurrency(snapshot.adapter);
	return (
		<div className="space-y-3">
			<div className="flex items-center justify-between gap-2">
				<span
					className={`inline-flex rounded-md px-1.5 py-0.5 text-[11px] font-medium ring-1 ring-inset ${STATE_BADGE[snapshot.state]}`}
				>
					{t(`state.${snapshot.state}`)}
				</span>
				<span className="text-[11px] text-slate-500">
					{t('checkedAt', { time: formatTime(snapshot.checkedAt, locale) })}
				</span>
			</div>
			{snapshot.balances.length > 0 ? (
				<ul className="space-y-2">
					{snapshot.balances.map((balance) => (
						<li key={balance.currency} className="rounded-lg bg-slate-50 px-3 py-2">
							<div className="flex items-baseline justify-between gap-2">
								<span className="text-xs text-slate-500">{t('balance')}</span>
								<span className="text-sm font-semibold text-slate-900">
									{formatMoney(balance.total, balance.currency, locale)}
								</span>
							</div>
							{balance.granted != null || balance.paid != null ? (
								<p className="mt-1 text-[11px] text-slate-500">
									{balance.granted != null
										? `${t('granted')} ${formatMoney(balance.granted, balance.currency, locale)}`
										: null}
									{balance.granted != null && balance.paid != null ? ' · ' : null}
									{balance.paid != null
										? `${t('paid')} ${formatMoney(balance.paid, balance.currency, locale)}`
										: null}
								</p>
							) : null}
						</li>
					))}
				</ul>
			) : null}
			{snapshot.windows.length > 0 ? (
				<div className="space-y-2">
					<p className="text-xs font-medium text-slate-500">{t('windows')}</p>
					<ul className="space-y-2">
						{snapshot.windows.map((quotaWindow) => {
							const percent =
								typeof quotaWindow.usedPercent === 'number' && Number.isFinite(quotaWindow.usedPercent)
									? Math.max(0, Math.min(100, quotaWindow.usedPercent))
									: null;
							const formatValue = (value: number) =>
								currencyUnit
									? formatMoney(value, currencyUnit, locale)
									: formatQuantity(value, locale);
							return (
								<li key={quotaWindow.id} className="rounded-lg bg-slate-50 px-3 py-2">
									<div className="flex items-baseline justify-between gap-2">
										<span className="text-xs font-medium text-slate-700">
											{windowLabel(quotaWindow.id, (key) => t(WINDOW_LABEL_KEYS[key]))}
										</span>
										{percent != null ? (
											<span className="text-xs text-slate-600">{formatQuantity(percent, locale)}%</span>
										) : null}
									</div>
									{percent != null ? (
										<div className="mt-1.5 h-1.5 overflow-hidden rounded-full bg-slate-200">
											<div
												className={`h-full rounded-full ${STATE_BAR[snapshot.state]}`}
												style={{ width: `${percent}%` }}
											/>
										</div>
									) : null}
									{quotaWindow.used != null || quotaWindow.limit != null || quotaWindow.remaining != null ? (
										<p className="mt-1 text-[11px] text-slate-500">
											{quotaWindow.used != null && quotaWindow.limit != null
												? t('usedOfLimit', {
														used: formatValue(quotaWindow.used),
														limit: formatValue(quotaWindow.limit),
													})
												: null}
											{quotaWindow.remaining != null
												? `${quotaWindow.used != null && quotaWindow.limit != null ? ' · ' : ''}${t('remaining', { value: formatValue(quotaWindow.remaining) })}`
												: null}
										</p>
									) : null}
									{quotaWindow.resetsAt ? (
										<p className="mt-0.5 text-[11px] text-slate-500">
											{t('resetsAt', { time: formatTime(quotaWindow.resetsAt, locale) })}
										</p>
									) : null}
								</li>
							);
						})}
					</ul>
				</div>
			) : null}
			{snapshot.balances.length === 0 && snapshot.windows.length === 0 ? (
				<p className="text-sm text-slate-500">{t('empty')}</p>
			) : null}
		</div>
	);
}
