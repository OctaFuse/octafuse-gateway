'use client';

import { useState, type RefObject } from 'react';
import {
	ChevronRightIcon,
	MagnifyingGlassIcon,
	DocumentTextIcon,
	BeakerIcon,
	ShieldCheckIcon,
	ServerStackIcon,
} from '@heroicons/react/24/outline';
import { formatGatewayMoneyCompact, getGatewayCurrencySymbol } from '@/lib/format-gateway-currency';
import { useLocale, useTranslations } from 'next-intl';
import {
	getPriceSummaryParts,
	parseDraftMoney,
	priceMultiplier,
	type PriceTripleDraft,
	type ProviderCardStatusFlags,
} from './provider-card-state';

type ServiceItem = {
	id: string;
	label: string;
	prices: PriceTripleDraft;
	status: ProviderCardStatusFlags;
	unitLabel?: string;
};
export type ToolProviderGroup = {
	id: string;
	label: string;
	unitLabel: string;
	items: ServiceItem[];
	onSelect: (id: string) => void;
};
const TYPE_ICONS: Record<string, typeof ServerStackIcon> = {
	'web-search': MagnifyingGlassIcon,
	'web-fetch': DocumentTextIcon,
	'web-deep-search': BeakerIcon,
	'ai-detection': ShieldCheckIcon,
};

export function ToolProviderList({
	groups,
	currency,
	searchRef,
}: {
	groups: ToolProviderGroup[];
	currency: string;
	searchRef: RefObject<HTMLInputElement>;
}) {
	const t = useTranslations('tools.serviceList');
	const ui = useTranslations('tools.ui');
	const badges = useTranslations('tools.providerCards');
	const prices = useTranslations('tools.unitPrices');
	const locale = useLocale();
	const [query, setQuery] = useState('');
	const [tool, setTool] = useState('all');
	const [status, setStatus] = useState('all');
	const rows = groups.flatMap((group) => group.items.map((item) => ({ group, item })));
	const search = query.trim().toLocaleLowerCase();
	const visible = rows.filter(({ group, item }) => {
		const flags = item.status;
		return (
			(tool === 'all' || group.id === tool) &&
			(!search ||
				[item.label, item.id, group.label, group.id].some((text) =>
					text.toLocaleLowerCase().includes(search)
				)) &&
			(status === 'all' ||
				(status === 'active' && flags.isActive) ||
				(status === 'configured' && flags.isImplemented && flags.isConfigured) ||
				(status === 'missing' && flags.isImplemented && !flags.isConfigured) ||
				(status === 'unavailable' && !flags.isImplemented) ||
				(status === 'unsaved' && flags.isDirty) ||
				(status === 'loss' && flags.isLossPricing))
		);
	});
	const clearFilters = () => {
		setQuery('');
		setTool('all');
		setStatus('all');
	};
	const money = (value: string) => {
		const amount = parseDraftMoney(value);
		return amount == null ? '—' : formatGatewayMoneyCompact(amount, currency);
	};
	const multiplier = (value: string, standard: string) => {
		const factor = priceMultiplier(value, standard);
		return factor == null
			? null
			: `${new Intl.NumberFormat(locale, { maximumSignificantDigits: 6 }).format(factor)}×`;
	};
	const hasFilters = query !== '' || tool !== 'all' || status !== 'all';
	const selectClass =
		'h-10 min-w-0 rounded-lg border border-gray-200 bg-white px-3 text-sm text-gray-700 focus:border-gray-500 focus:outline-none focus:ring-2 focus:ring-gray-100';
	return (
		<section className="min-w-0 space-y-4" aria-label={t('name')}>
			<div className="admin-filter-surface flex flex-wrap items-center gap-2">
				<div className="relative w-full sm:max-w-sm">
					<MagnifyingGlassIcon
						className="pointer-events-none absolute left-3 top-3 h-4 w-4 text-gray-400"
						aria-hidden="true"
					/>
					<input
						ref={searchRef}
						type="search"
						value={query}
						onChange={(e) => setQuery(e.target.value)}
						aria-label={t('search')}
						placeholder={t('search')}
						className="h-10 w-full rounded-lg border border-gray-200 bg-white pl-9 pr-3 text-sm focus:border-gray-500 focus:outline-none focus:ring-2 focus:ring-gray-100"
					/>
				</div>
				<select
					value={tool}
					onChange={(e) => setTool(e.target.value)}
					aria-label={t('toolType')}
					className={`${selectClass} flex-1 sm:flex-none`}
				>
					<option value="all">{t('allTools')}</option>
					{groups.map((group) => (
						<option key={group.id} value={group.id}>
							{group.label}
						</option>
					))}
				</select>
				<select
					value={status}
					onChange={(e) => setStatus(e.target.value)}
					aria-label={t('status')}
					className={`${selectClass} flex-1 sm:flex-none`}
				>
					<option value="all">{t('allStatuses')}</option>
					<option value="active">{badges('active')}</option>
					<option value="configured">{badges('configured')}</option>
					<option value="missing">{ui('notConfigured')}</option>
					<option value="unavailable">{badges('unavailable')}</option>
					<option value="unsaved">{badges('unsaved')}</option>
					<option value="loss">{badges('lossPricing')}</option>
				</select>
				{hasFilters ? (
					<button
						type="button"
						onClick={clearFilters}
						className="h-10 rounded-lg px-3 text-xs text-gray-600 hover:bg-gray-100"
					>
						{t('clearFilters')}
					</button>
				) : null}
				<span role="status" className="w-full text-xs text-gray-500 sm:ml-auto sm:w-auto">
					{t('count', { visible: visible.length, total: rows.length })}
				</span>
			</div>
			<div className="admin-content-panel admin-table-surface overflow-hidden rounded-xl border border-gray-200 bg-white">
				{visible.length === 0 ? (
					<div className="px-5 py-16 text-center">
						<MagnifyingGlassIcon className="mx-auto mb-3 h-6 w-6 text-gray-400" aria-hidden="true" />
						<p className="text-sm text-gray-500">{t('noResults')}</p>
						<button
							type="button"
							onClick={clearFilters}
							className="mt-4 text-sm font-medium text-gray-900 hover:underline"
						>
							{t('clearFilters')}
						</button>
					</div>
				) : (
					<div className="overflow-x-auto">
						<table className="w-full min-w-[720px] text-left text-sm">
							<thead className="border-b border-gray-200 bg-gray-50/70 text-xs text-gray-500">
								<tr>
									<th scope="col" className="px-5 py-3 font-medium">
										{t('name')}
									</th>
									<th scope="col" className="px-4 py-3 font-medium">
										{t('status')}
									</th>
									{(['standard', 'charged', 'metered'] as const).map((kind) => (
										<th
											key={kind}
											scope="col"
											className={`whitespace-nowrap py-3 pl-4 text-right font-medium ${
												kind === 'metered' ? 'pr-12' : 'pr-4'
											}`}
										>
											{prices(kind)}
										</th>
									))}
								</tr>
							</thead>
							<tbody className="divide-y divide-gray-100">
								{visible.map(({ group, item }) => {
									const parts = getPriceSummaryParts(item.prices);
									const Icon = TYPE_ICONS[group.id] ?? ServerStackIcon;
									const flags = item.status;
									const primary = !flags.isImplemented
										? badges('unavailable')
										: flags.isActive
										? badges('active')
										: flags.isConfigured
										? badges('configured')
										: ui('notConfigured');
									return (
										<tr
											key={`${group.id}:${item.id}`}
											data-tool={group.id}
											data-provider={item.id}
											className="group cursor-pointer hover:bg-gray-50/80 focus-within:bg-gray-50"
											onClick={(e) => {
												e.currentTarget.querySelector('button')?.focus();
												group.onSelect(item.id);
											}}
										>
											<td className="px-5 py-4">
												<div className="flex items-center gap-3">
													<div className="admin-tool-symbol flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-gray-100 text-gray-500">
														<Icon className="h-4 w-4" aria-hidden="true" />
													</div>
													<div className="min-w-0">
														<button
															type="button"
															aria-haspopup="dialog"
															title={item.id}
															onClick={(e) => {
																e.stopPropagation();
																e.currentTarget.focus();
																group.onSelect(item.id);
															}}
															className="rounded text-left font-medium text-gray-900 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-gray-500 focus-visible:ring-offset-2"
														>
															{item.label}
														</button>
														<div className="mt-1 text-xs text-gray-500">{group.label}</div>
													</div>
												</div>
											</td>
											<td className="px-4 py-4">
												<div
													className={`inline-flex items-center gap-2 whitespace-nowrap text-xs ${
														flags.isActive ? 'text-emerald-700' : 'text-gray-500'
													}`}
												>
													<span
														className={`h-1.5 w-1.5 rounded-full ${
															flags.isActive
																? 'bg-emerald-500'
																: flags.isConfigured && flags.isImplemented
																? 'bg-gray-500'
																: 'bg-gray-300'
														}`}
														aria-hidden="true"
													/>
													{primary}
												</div>
												{flags.isDirty || flags.isLossPricing ? (
													<div className="mt-1.5 flex flex-wrap gap-1.5 text-xs text-amber-700">
														{flags.isDirty ? <span>{badges('unsaved')}</span> : null}
														{flags.isLossPricing ? (
															<span className="rounded bg-amber-50 px-1.5">{badges('lossPricing')}</span>
														) : null}
													</div>
												) : null}
											</td>
											{(['standard', 'charged', 'metered'] as const).map((kind) => {
												const factor = kind === 'standard' ? null : multiplier(parts[kind], parts.standard);
												return (
													<td
														key={kind}
														className={`relative py-4 pl-4 text-right align-top ${
															kind === 'metered' ? 'pr-12' : 'pr-4'
														}`}
													>
														<div className="flex items-baseline justify-end gap-2 whitespace-nowrap">
															<span className="font-mono tabular-nums text-gray-800">
																{money(parts[kind])}
															</span>
															{factor ? (
																<span
																	title={ui('multiplierHint')}
																	className="font-mono text-xs tabular-nums text-gray-500"
																>
																	{factor}
																</span>
															) : null}
														</div>
														{kind === 'standard' ? (
															<div className="mt-1 whitespace-nowrap text-xs text-gray-500">
																{item.unitLabel ?? group.unitLabel}
															</div>
														) : null}
														{kind === 'metered' ? (
															<ChevronRightIcon
																className="absolute right-4 top-1/2 h-4 w-4 -translate-y-1/2 text-gray-300 group-hover:text-gray-600"
																aria-hidden="true"
															/>
														) : null}
													</td>
												);
											})}
										</tr>
									);
								})}
							</tbody>
						</table>
					</div>
				)}
				<div className="flex flex-wrap justify-between gap-2 border-t border-gray-100 px-5 py-3 text-xs text-gray-500">
					<span>{t('currency', { currency: getGatewayCurrencySymbol(currency) })}</span>
					<span>{ui('oneActivePerType')}</span>
				</div>
			</div>
		</section>
	);
}
