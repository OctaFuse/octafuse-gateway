'use client';

import type { ReactNode } from 'react';
import { useTranslations } from 'next-intl';
import {
	formatPriceSummary,
	getPriceSummaryParts,
	resolveCompactStatusBadges,
	showConfiguredDot,
	type CompactStatusBadgeKind,
	type PriceTripleDraft,
	type ProviderCardStatusFlags,
} from './provider-card-state';

export type ToolProviderPickerItem = {
	id: string;
	label: string;
	prices: PriceTripleDraft;
	status: ProviderCardStatusFlags;
};

const BADGE_CLASS: Record<CompactStatusBadgeKind, string> = {
	active: 'bg-emerald-50 text-emerald-800 ring-emerald-200',
	unsaved: 'bg-amber-50 text-amber-800 ring-amber-200',
	missing: 'bg-red-50 text-red-700 ring-red-200',
	unavailable: 'bg-gray-100 text-gray-600 ring-gray-200',
	loss: 'bg-amber-50 text-amber-900 ring-amber-300',
};

function cardClassName(status: ProviderCardStatusFlags): string {
	const base =
		'flex min-h-[4.5rem] min-w-0 flex-col justify-between gap-2 rounded-md border px-2.5 py-2 text-left transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-500';
	if (status.isSelected) {
		return `${base} border-blue-400 bg-blue-50/60 ring-1 ring-blue-200`;
	}
	if (status.isActive) {
		return `${base} border-emerald-300 bg-emerald-50/25 hover:border-emerald-400`;
	}
	if (!status.isImplemented) {
		return `${base} border-dashed border-gray-200 bg-gray-50/70 hover:border-gray-300`;
	}
	if (status.isLossPricing) {
		return `${base} border-amber-300 bg-amber-50/30 hover:border-amber-400`;
	}
	return `${base} border-gray-200 bg-white hover:border-blue-300 hover:bg-blue-50/20`;
}

/** 页面级提示 + 价格图例（各工具区不再重复）。 */
export function ToolProviderOverviewHints() {
	const t = useTranslations('tools.providerCards');
	return (
		<div className="mb-4 flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
			<p className="text-xs text-gray-500">{t('selectHint')}</p>
			<p className="text-[10px] text-gray-400">{t('priceLegend')}</p>
		</div>
	);
}

/** Tools 专用紧凑区块：标题 + Active 摘要 + 单行说明，无宽左栏。 */
export function ToolOverviewSection({
	id,
	title,
	description,
	activeLabel,
	headerExtra,
	children,
}: {
	id?: string;
	title: string;
	description: string;
	activeLabel?: string | null;
	headerExtra?: ReactNode;
	children: ReactNode;
}) {
	const t = useTranslations('tools.providerCards');
	return (
		<section
			id={id}
			className="scroll-mt-8 rounded-lg border border-gray-200 bg-white p-4 shadow-sm"
		>
			<div className="mb-3 flex flex-wrap items-start justify-between gap-2">
				<div className="min-w-0 flex-1">
					<div className="flex flex-wrap items-center gap-2">
						<h2 className="text-base font-semibold text-gray-900">{title}</h2>
						{activeLabel ? (
							<span className="inline-flex items-center rounded-full bg-emerald-50 px-2 py-0.5 text-[10px] font-medium text-emerald-800 ring-1 ring-inset ring-emerald-200">
								{t('activeSummary', { name: activeLabel })}
							</span>
						) : (
							<span className="inline-flex items-center rounded-full bg-gray-50 px-2 py-0.5 text-[10px] font-medium text-gray-500 ring-1 ring-inset ring-gray-200">
								{t('noActive')}
							</span>
						)}
					</div>
					<p className="mt-0.5 text-xs text-gray-500" title={description}>
						{description}
					</p>
				</div>
				{headerExtra ? <div className="shrink-0">{headerExtra}</div> : null}
			</div>
			{children}
		</section>
	);
}

function PriceSummaryLine({ prices }: { prices: PriceTripleDraft }) {
	const parts = getPriceSummaryParts(prices);
	const tPrices = useTranslations('tools.unitPrices');
	const summary = formatPriceSummary(prices);
	const tip = `${tPrices('standard')} (S) · ${tPrices('charged')} (C) · ${tPrices('metered')} (M)`;

	return (
		<p
			className="truncate font-mono text-[10px] tabular-nums text-gray-600"
			title={`${tip}\n${summary}`}
			aria-label={`${tip}: ${summary}`}
		>
			<span className="text-gray-400">S</span> {parts.standard}
			<span className="mx-1 text-gray-300" aria-hidden>
				·
			</span>
			<span className="text-gray-400">C</span> {parts.charged}
			<span className="mx-1 text-gray-300" aria-hidden>
				·
			</span>
			<span className="text-gray-400">M</span> {parts.metered}
		</p>
	);
}

export function ToolProviderPicker({
	items,
	onSelect,
}: {
	items: ToolProviderPickerItem[];
	onSelect: (id: string) => void;
}) {
	const t = useTranslations('tools.providerCards');
	const labelFor = (kind: CompactStatusBadgeKind): string => {
		switch (kind) {
			case 'active':
				return t('active');
			case 'unsaved':
				return t('unsaved');
			case 'missing':
				return t('missingCredentials');
			case 'unavailable':
				return t('unavailable');
			case 'loss':
				return t('lossPricing');
		}
	};

	return (
		<div
			className="grid grid-cols-[repeat(auto-fill,minmax(min(100%,13rem),1fr))] gap-2"
			role="group"
			aria-label={t('selectHint')}
		>
			{items.map((item) => {
				const badges = resolveCompactStatusBadges(item.status);
				const configuredDot = showConfiguredDot(item.status);
				return (
					<button
						key={item.id}
						type="button"
						aria-pressed={item.status.isSelected}
						onClick={() => onSelect(item.id)}
						className={cardClassName(item.status)}
						title={item.label}
					>
						<div className="flex min-w-0 items-start justify-between gap-1.5">
							<span className="min-w-0 truncate text-xs font-semibold text-gray-900">
								{item.label}
							</span>
							<div className="flex shrink-0 flex-wrap items-center justify-end gap-1">
								{configuredDot ? (
									<span
										className="h-1.5 w-1.5 rounded-full bg-slate-400"
										title={t('configured')}
										aria-label={t('configured')}
									/>
								) : null}
								{badges.map((kind) => (
									<span
										key={kind}
										className={`inline-flex items-center rounded-full px-1.5 py-px text-[9px] font-medium ring-1 ring-inset ${BADGE_CLASS[kind]}`}
									>
										{labelFor(kind)}
									</span>
								))}
							</div>
						</div>
						<PriceSummaryLine prices={item.prices} />
					</button>
				);
			})}
		</div>
	);
}

export function ToolProviderSaveActions({
	saving,
	selectedIsActive,
	canSaveConfig,
	canSaveAndActivate,
	onSaveConfig,
	onSaveAndActivate,
	feedback,
}: {
	saving: boolean;
	selectedIsActive: boolean;
	canSaveConfig: boolean;
	canSaveAndActivate: boolean;
	onSaveConfig: () => void;
	onSaveAndActivate: () => void;
	feedback?: ReactNode;
}) {
	const t = useTranslations('tools.providerCards');
	const tCommon = useTranslations('common');

	return (
		<div className="flex flex-wrap items-center gap-3">
			{selectedIsActive ? (
				<button
					type="button"
					onClick={onSaveConfig}
					disabled={saving || !canSaveConfig}
					className="rounded-md bg-gray-900 px-4 py-2 text-sm font-medium text-white hover:bg-gray-800 disabled:opacity-50"
				>
					{saving ? tCommon('saving') : t('saveConfig')}
				</button>
			) : (
				<>
					<button
						type="button"
						onClick={onSaveAndActivate}
						disabled={saving || !canSaveAndActivate}
						className="rounded-md bg-gray-900 px-4 py-2 text-sm font-medium text-white hover:bg-gray-800 disabled:opacity-50"
					>
						{saving ? tCommon('saving') : t('saveAndActivate')}
					</button>
					<button
						type="button"
						onClick={onSaveConfig}
						disabled={saving || !canSaveConfig}
						className="rounded-md border border-gray-200 bg-white px-4 py-2 text-sm font-medium text-gray-700 shadow-sm hover:bg-gray-50 disabled:opacity-50"
					>
						{t('saveConfigOnly')}
					</button>
				</>
			)}
			{feedback}
		</div>
	);
}
