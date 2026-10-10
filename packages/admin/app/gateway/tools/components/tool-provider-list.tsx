'use client';

import { useState, type RefObject } from 'react';
import { ChevronRightIcon, MagnifyingGlassIcon, ServerStackIcon } from '@heroicons/react/24/outline';
import { useTranslations } from 'next-intl';
import {
	getPriceSummaryParts,
	resolveCompactStatusBadges,
	showConfiguredDot,
	type CompactStatusBadgeKind,
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

const BADGE_CLASS: Record<CompactStatusBadgeKind, string> = {
	active: 'bg-emerald-50 text-emerald-800 ring-emerald-200',
	unsaved: 'bg-amber-50 text-amber-800 ring-amber-200',
	missing: 'bg-red-50 text-red-700 ring-red-200',
	unavailable: 'bg-gray-100 text-gray-600 ring-gray-200',
	loss: 'bg-amber-50 text-amber-900 ring-amber-300',
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
	const badges = useTranslations('tools.providerCards');
	const prices = useTranslations('tools.unitPrices');
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
	const badgeLabel = (kind: CompactStatusBadgeKind) =>
		badges(
			{
				active: 'active',
				unsaved: 'unsaved',
				missing: 'missingCredentials',
				unavailable: 'unavailable',
				loss: 'lossPricing',
			}[kind]
		);
	const clearFilters = () => {
		setQuery('');
		setTool('all');
		setStatus('all');
	};
	const hasFilters = query !== '' || tool !== 'all' || status !== 'all';

	return (
		<div className="overflow-hidden rounded-xl border border-gray-200 bg-white shadow-sm">
			<div className="flex flex-col gap-3 border-b border-gray-200 px-5 py-4 lg:flex-row lg:items-center">
				<div className="relative min-w-0 flex-1">
					<MagnifyingGlassIcon
						className="pointer-events-none absolute left-3 top-2.5 h-4 w-4 text-gray-400"
						aria-hidden="true"
					/>
					<input
						ref={searchRef}
						type="search"
						value={query}
						onChange={(e) => setQuery(e.target.value)}
						aria-label={t('search')}
						placeholder={t('search')}
						className="w-full rounded-lg border border-gray-200 py-2 pl-9 pr-3 text-sm focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-100"
					/>
				</div>
				<div className="flex flex-wrap items-center gap-2">
					<select
						value={tool}
						onChange={(e) => setTool(e.target.value)}
						aria-label={t('toolType')}
						className="min-w-0 flex-1 rounded-lg border border-gray-200 bg-white px-3 py-2 text-sm text-gray-700 focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-100 lg:flex-none"
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
						className="min-w-0 flex-1 rounded-lg border border-gray-200 bg-white px-3 py-2 text-sm text-gray-700 focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-100 lg:flex-none"
					>
						<option value="all">{t('allStatuses')}</option>
						<option value="active">{badges('active')}</option>
						<option value="configured">{badges('configured')}</option>
						<option value="missing">{badges('missingCredentials')}</option>
						<option value="unavailable">{badges('unavailable')}</option>
						<option value="unsaved">{badges('unsaved')}</option>
						<option value="loss">{badges('lossPricing')}</option>
					</select>
					{hasFilters ? (
						<button
							type="button"
							onClick={clearFilters}
							className="rounded-lg px-2 py-2 text-sm font-medium text-blue-600 hover:bg-blue-50"
						>
							{t('clearFilters')}
						</button>
					) : null}
				</div>
			</div>
			{visible.length === 0 ? (
				<div className="px-5 py-14 text-center">
					<p className="text-sm text-gray-500">{t('noResults')}</p>
					<button
						type="button"
						onClick={clearFilters}
						className="mt-3 text-sm font-medium text-blue-600 hover:underline"
					>
						{t('clearFilters')}
					</button>
				</div>
			) : (
				<div className="overflow-x-auto">
					<table className="w-full min-w-[800px] text-left text-sm">
						<thead className="border-b border-gray-100 bg-gray-50/80 text-xs text-gray-500">
							<tr>
								<th scope="col" className="px-5 py-3 font-medium">
									{t('name')}
								</th>
								<th scope="col" className="px-4 py-3 font-medium">
									{t('toolType')}
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
								return (
									<tr
										key={`${group.id}:${item.id}`}
										data-tool={group.id}
										data-provider={item.id}
										className="group cursor-pointer transition hover:bg-gray-50/80 focus-within:bg-blue-50/50"
										onClick={(e) => {
											e.currentTarget.querySelector('button')?.focus();
											group.onSelect(item.id);
										}}
									>
										<td className="px-5 py-4">
											<div className="flex items-start gap-3">
												<div className="mt-0.5 rounded-lg border border-gray-200 bg-white p-2 text-gray-500">
													<ServerStackIcon className="h-5 w-5" aria-hidden="true" />
												</div>
												<div className="min-w-0">
													<button
														type="button"
														aria-haspopup="dialog"
														aria-expanded={item.status.isSelected}
														onClick={(e) => {
															e.stopPropagation();
															e.currentTarget.focus();
															group.onSelect(item.id);
														}}
														className="rounded text-left font-semibold text-gray-900 hover:text-blue-600 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 focus-visible:ring-offset-2"
													>
														{item.label}
													</button>
													<div className="mt-1 font-mono text-xs text-gray-500">{item.id}</div>
												</div>
											</div>
										</td>
										<td className="px-4 py-4">
											<div className="whitespace-nowrap text-gray-700">{group.label}</div>
											<div className="mt-1 whitespace-nowrap text-xs text-gray-400">
												{item.unitLabel ?? group.unitLabel}
											</div>
										</td>
										<td className="px-4 py-4">
											<div className="flex max-w-[240px] flex-wrap gap-1.5">
												{showConfiguredDot(item.status) ? (
													<span className="inline-flex whitespace-nowrap rounded-full bg-blue-50 px-2.5 py-1 text-xs font-medium text-blue-700 ring-1 ring-inset ring-blue-100">
														{badges('configured')}
													</span>
												) : null}
												{resolveCompactStatusBadges(item.status).map((kind) => (
													<span
														key={kind}
														className={`inline-flex whitespace-nowrap rounded-full px-2.5 py-1 text-xs font-medium ring-1 ring-inset ${BADGE_CLASS[kind]}`}
													>
														{badgeLabel(kind)}
													</span>
												))}
											</div>
										</td>
										<td className="px-4 py-4 text-right font-mono tabular-nums text-gray-600">
											{parts.standard}
										</td>
										<td
											className={`px-4 py-4 text-right font-mono tabular-nums ${
												item.status.isLossPricing ? 'text-amber-700' : 'text-gray-600'
											}`}
										>
											{parts.charged}
										</td>
										<td className="px-4 py-4">
											<div className="flex items-center justify-end gap-4">
												<span className="font-mono tabular-nums text-gray-600">{parts.metered}</span>
												<ChevronRightIcon
													className="h-4 w-4 shrink-0 text-gray-300 transition group-hover:text-gray-600 group-focus-within:text-blue-500"
													aria-hidden="true"
												/>
											</div>
										</td>
									</tr>
								);
							})}
						</tbody>
					</table>
				</div>
			)}
			<div className="flex flex-wrap items-center justify-between gap-2 border-t border-gray-100 px-5 py-3 text-xs text-gray-400">
				<div role="status">
					{t('count', { visible: visible.length, total: rows.length })}
					<span className="ml-3">{t('currency', { currency })}</span>
				</div>
				<span>{t('openHint')}</span>
			</div>
		</div>
	);
}
