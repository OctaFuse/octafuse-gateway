'use client';

import { useState } from 'react';
import {
	ArrowPathIcon,
	MagnifyingGlassIcon,
	PlusIcon,
	ServerStackIcon,
	ChevronRightIcon,
} from '@heroicons/react/24/outline';
import { summarizeMcpPricingRule } from '@octafuse/core/mcp/pricing';
import { useTranslations } from 'next-intl';
import { formatGatewayMoneyCompact, getGatewayCurrencySymbol } from '@/lib/format-gateway-currency';
import { useGatewayDateTime } from '@/lib/use-gateway-datetime';
import type { ServerSummary } from '../mcp-types';

export function McpServerTable({
	currency,
	servers,
	busy,
	loading,
	error,
	onOpen,
	onCreate,
	onRefresh,
}: {
	currency: string;
	servers: ServerSummary[];
	busy: boolean;
	loading: boolean;
	error: boolean;
	onOpen: (id: string) => void;
	onCreate: () => void;
	onRefresh: () => void;
}) {
	const t = useTranslations('mcp');
	const common = useTranslations('common');
	const { formatDateTime } = useGatewayDateTime();
	const [query, setQuery] = useState('');
	const [filter, setFilter] = useState('all');
	const filters = [
		{ key: 'all', label: t('allServers'), count: servers.length },
		{ key: 'active', label: t('active'), count: servers.filter((s) => s.status === 'active').length },
		{ key: 'pending', label: t('pendingCount'), count: servers.filter((s) => s.pendingCount > 0).length },
		{ key: 'error', label: t('syncError'), count: servers.filter((s) => s.lastSyncError).length },
		{ key: 'disabled', label: t('disabled'), count: servers.filter((s) => s.status === 'disabled').length },
	];
	const search = query.trim().toLocaleLowerCase();
	const visible = servers.filter((server) => {
		const matches =
			!search ||
			[server.name, server.slug, server.urlMasked, server.description].some((text) =>
				text?.toLocaleLowerCase().includes(search)
			);
		return (
			matches &&
			(filter === 'all' ||
				(filter === 'pending'
					? server.pendingCount > 0
					: filter === 'error'
					? !!server.lastSyncError
					: server.status === filter))
		);
	});

	return (
		<div className="overflow-hidden rounded-xl border border-gray-200 bg-white shadow-sm">
			<div className="flex flex-col gap-4 border-b border-gray-200 px-5 py-4 lg:flex-row lg:items-center lg:justify-between">
				<div className="flex flex-wrap gap-1" role="group" aria-label={t('filterServers')}>
					{filters.map((item) => (
						<button
							key={item.key}
							type="button"
							aria-pressed={filter === item.key}
							onClick={() => setFilter(item.key)}
							className={`inline-flex items-center gap-2 rounded-lg px-3 py-2 text-sm font-medium transition ${
								filter === item.key
									? 'bg-gray-900 text-white'
									: 'text-gray-500 hover:bg-gray-100 hover:text-gray-900'
							}`}
						>
							{item.label}
							<span
								className={`rounded px-1.5 text-xs tabular-nums ${
									filter === item.key ? 'bg-white/15 text-white' : 'bg-gray-100 text-gray-500'
								}`}
							>
								{item.count}
							</span>
						</button>
					))}
				</div>
				<div className="flex items-center gap-2">
					<div className="relative min-w-0 flex-1 lg:w-64">
						<MagnifyingGlassIcon
							className="pointer-events-none absolute left-3 top-2.5 h-4 w-4 text-gray-400"
							aria-hidden="true"
						/>
						<input
							type="search"
							value={query}
							onChange={(e) => setQuery(e.target.value)}
							aria-label={t('searchServers')}
							placeholder={t('searchServers')}
							className="w-full rounded-lg border border-gray-200 py-2 pl-9 pr-3 text-sm focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-100"
						/>
					</div>
					<button
						type="button"
						onClick={onRefresh}
						disabled={loading || busy}
						aria-label={t('refresh')}
						title={t('refresh')}
						className="rounded-lg border border-gray-200 p-2 text-gray-500 hover:bg-gray-50 disabled:opacity-50"
					>
						<ArrowPathIcon className={`h-5 w-5 ${loading ? 'animate-spin' : ''}`} aria-hidden="true" />
					</button>
				</div>
			</div>
			{error ? (
				<div
					role="alert"
					className="flex flex-wrap items-center justify-between gap-3 border-b border-red-100 bg-red-50 px-5 py-3 text-sm text-red-700"
				>
					<span>{t('loadFailed')}</span>
					<button
						type="button"
						disabled={loading}
						onClick={onRefresh}
						className="font-medium underline disabled:opacity-50"
					>
						{t('retry')}
					</button>
				</div>
			) : null}
			{loading && servers.length === 0 ? (
				<div role="status" className="space-y-5 p-6">
					<span className="sr-only">{common('loading')}</span>
					{[0, 1, 2].map((i) => (
						<div key={i} className="h-14 animate-pulse rounded-lg bg-gray-100" />
					))}
				</div>
			) : servers.length === 0 && !error ? (
				<div className="flex flex-col items-center px-6 py-16 text-center">
					<div className="mb-4 rounded-2xl bg-gray-100 p-4">
						<ServerStackIcon className="h-8 w-8 text-gray-400" aria-hidden="true" />
					</div>
					<h3 className="text-base font-semibold text-gray-900">{t('empty')}</h3>
					<p className="mt-2 max-w-md text-sm leading-6 text-gray-500">{t('emptyHint')}</p>
					<button
						type="button"
						onClick={onCreate}
						className="mt-5 inline-flex items-center gap-2 rounded-lg bg-gray-900 px-4 py-2.5 text-sm font-medium text-white hover:bg-gray-800"
					>
						<PlusIcon className="h-4 w-4" aria-hidden="true" />
						{t('add')}
					</button>
				</div>
			) : visible.length === 0 && !error ? (
				<div className="py-14 text-center">
					<p className="text-sm text-gray-500">{t('noResults')}</p>
					<button
						type="button"
						onClick={() => {
							setQuery('');
							setFilter('all');
						}}
						className="mt-3 text-sm font-medium text-blue-600 hover:underline"
					>
						{t('clearFilters')}
					</button>
				</div>
			) : (
				<div className="overflow-x-auto">
					<table className="w-full min-w-[920px] text-left text-sm">
						<thead className="border-b border-gray-100 bg-gray-50/80 text-xs text-gray-500">
							<tr>
								<th className="px-5 py-3 font-medium">{t('name')}</th>
								<th className="px-4 py-3 font-medium">{t('status')}</th>
								<th className="px-4 py-3 font-medium">{t('catalog')}</th>
								{(['standard', 'charged', 'metered'] as const).map((key) => (
									<th key={key} scope="col" className="whitespace-nowrap px-4 py-3 text-right font-medium">
										<div>{t(key)}</div>
										<div className="mt-1 text-[11px] font-normal text-gray-400">
											{t('priceUnit', { currency: getGatewayCurrencySymbol(currency) })}
										</div>
									</th>
								))}
							</tr>
						</thead>
						<tbody className="divide-y divide-gray-100">
							{visible.map((server) => {
								const prices = server.pricing ? summarizeMcpPricingRule(server.pricing) : null;
								return (
									<tr
										key={server.id}
										className={`group transition ${
											busy
												? 'cursor-default'
												: 'cursor-pointer hover:bg-gray-50/80 focus-within:bg-blue-50/50'
										}`}
										onClick={(event) => {
											if (busy) return;
											event.currentTarget.querySelector('button')?.focus();
											onOpen(server.id);
										}}
									>
										<td className="px-5 py-5">
											<div className="flex items-start gap-3">
												<div className="mt-0.5 rounded-lg border border-gray-200 bg-white p-2 text-gray-500">
													<ServerStackIcon className="h-5 w-5" aria-hidden="true" />
												</div>
												<div className="min-w-0">
													<button
														type="button"
														onClick={(e) => {
															e.stopPropagation();
															e.currentTarget.focus();
															onOpen(server.id);
														}}
														disabled={busy}
														className="max-w-[220px] break-words rounded text-left font-semibold text-gray-900 hover:text-blue-600 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 focus-visible:ring-offset-2 disabled:opacity-50"
													>
														{server.name}
													</button>
													<div className="mt-1 font-mono text-xs text-gray-500">{server.slug}</div>
													<div
														className="mt-1 max-w-[260px] truncate text-xs text-gray-400"
														title={server.urlMasked}
													>
														{server.urlMasked}
													</div>
												</div>
											</div>
										</td>
										<td className="px-4 py-5">
											<span
												className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-medium ${
													server.status === 'active'
														? 'bg-emerald-50 text-emerald-700'
														: 'bg-gray-100 text-gray-500'
												}`}
											>
												<span
													className={`h-1.5 w-1.5 rounded-full ${
														server.status === 'active' ? 'bg-emerald-500' : 'bg-gray-400'
													}`}
												/>
												{server.status === 'active' ? t('active') : t('disabled')}
											</span>
											{!server.pricing ? (
												<div className="mt-2 text-xs text-red-600">{t('pricing.invalidStored')}</div>
											) : prices != null && prices.charged < prices.metered ? (
												<div className="mt-2 text-xs text-amber-700">{t('defaultPriceLoss')}</div>
											) : null}
										</td>
										<td className="px-4 py-5">
											<div className="flex flex-wrap items-center gap-x-2 gap-y-1">
												<div className="whitespace-nowrap text-gray-700">
													<span className="font-semibold tabular-nums">{server.enabledCount}</span>{' '}
													<span className="text-xs text-gray-500">{t('enabledCount')}</span>
												</div>
												{server.pendingCount > 0 ? (
													<span className="inline-flex whitespace-nowrap rounded-md bg-amber-50 px-2 py-1 text-xs font-medium text-amber-700">
														{t('pendingBadge', { count: server.pendingCount })}
													</span>
												) : null}
											</div>
											{server.lastSyncError ? (
												<>
													<div className="mt-1.5 whitespace-nowrap text-xs text-red-600">
														{t('syncError')}
													</div>
													<div
														className="mt-0.5 max-w-[240px] truncate text-xs text-red-400"
														title={server.lastSyncError}
													>
														{server.lastSyncError}
													</div>
												</>
											) : (
												<div className="mt-1.5 whitespace-nowrap text-xs text-gray-400">
													{server.lastSyncedAt
														? `${t('lastSync')} ${formatDateTime(server.lastSyncedAt)}`
														: t('neverSynced')}
												</div>
											)}
										</td>
										{(['standard', 'charged', 'metered'] as const).map((key) => {
											const pricing = prices;
											const loss = key === 'charged' && pricing != null && pricing.charged < pricing.metered;
											const amount = pricing ? (
												<div>
													<span className={loss ? 'text-amber-700' : 'text-gray-600'}>
														{formatGatewayMoneyCompact(pricing[key], currency)}
													</span>
													{key === 'charged' ? (
														<div className="mt-1 font-sans text-[11px] text-gray-400">/ {pricing.unit}</div>
													) : null}
												</div>
											) : (
												<span className="text-gray-300">—</span>
											);
											return (
												<td
													key={key}
													className="whitespace-nowrap px-4 py-5 text-right align-top font-mono tabular-nums"
													title={
														pricing
															? t('priceLegend', {
																	standard: formatGatewayMoneyCompact(pricing.standard, currency),
																	charged: formatGatewayMoneyCompact(pricing.charged, currency),
																	metered: formatGatewayMoneyCompact(pricing.metered, currency),
																	unit: pricing.unit,
															  })
															: undefined
													}
												>
													{key === 'metered' ? (
														<div className="flex items-start justify-end gap-4">
															{amount}
															<ChevronRightIcon
																className="h-4 w-4 shrink-0 text-gray-300 transition group-hover:text-gray-600 group-focus-within:text-blue-500"
																aria-hidden="true"
															/>
														</div>
													) : (
														amount
													)}
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
			{servers.length > 0 ? (
				<div className="flex flex-wrap items-center justify-between gap-2 border-t border-gray-100 px-5 py-3 text-xs text-gray-400">
					<div>
						{t('listCount', { visible: visible.length, total: servers.length })}
						<span className="ml-3">
							{t('priceCurrency', { currency: getGatewayCurrencySymbol(currency) })}
						</span>
					</div>
					<span>{t('openServerHint')}</span>
					<p className="w-full leading-5 text-gray-500">{t('defaultPriceHint')}</p>
				</div>
			) : null}
		</div>
	);
}
