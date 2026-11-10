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
import { useLocale, useTranslations } from 'next-intl';
import { formatGatewayMoneyCompact, getGatewayCurrencySymbol } from '@/lib/format-gateway-currency';
import { useGatewayDateTime } from '@/lib/use-gateway-datetime';
import type { ServerSummary } from '../mcp-types';
import { mcpConnectEndpoint } from '../mcp-connect-guide-utils';
import { mcpPriceMultiplier } from '../mcp-price-display';

export function McpServerTable({
	proxyBaseUrl,
	currency,
	servers,
	busy,
	loading,
	error,
	onOpen,
	onCreate,
	onRefresh,
}: {
	proxyBaseUrl: string;
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
	const ui = useTranslations('mcp.ui');
	const common = useTranslations('common');
	const locale = useLocale();
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
	const visible = servers.filter(
		(server) =>
			(!search ||
				[
					server.name,
					server.slug,
					server.urlMasked,
					server.description,
					mcpConnectEndpoint(proxyBaseUrl, server.slug),
				].some((text) => text?.toLocaleLowerCase().includes(search))) &&
			(filter === 'all' ||
				(filter === 'pending'
					? server.pendingCount > 0
					: filter === 'error'
					? !!server.lastSyncError
					: server.status === filter))
	);
	const clearFilters = () => {
		setQuery('');
		setFilter('all');
	};
	const exposed = servers.filter((s) => s.status === 'active').reduce((sum, s) => sum + s.enabledCount, 0);
	const pending = servers.reduce((sum, s) => sum + s.pendingCount, 0);
	return (
		<section className="min-w-0 space-y-4" aria-label={t('sections.services')}>
			<div className="flex flex-wrap items-center gap-2">
				<div className="relative w-full sm:max-w-sm">
					<MagnifyingGlassIcon
						className="pointer-events-none absolute left-3 top-3 h-4 w-4 text-gray-400"
						aria-hidden="true"
					/>
					<input
						type="search"
						value={query}
						onChange={(e) => setQuery(e.target.value)}
						aria-label={t('searchServers')}
						placeholder={t('searchServers')}
						className="h-10 w-full rounded-lg border border-gray-200 bg-white pl-9 pr-3 text-sm focus:border-gray-500 focus:outline-none focus:ring-2 focus:ring-gray-100"
					/>
				</div>
				<select
					value={filter}
					onChange={(e) => setFilter(e.target.value)}
					aria-label={t('filterServers')}
					className="h-10 min-w-0 flex-1 rounded-lg border border-gray-200 bg-white px-3 text-sm text-gray-700 sm:flex-none"
				>
					{filters.map((item) => (
						<option key={item.key} value={item.key}>
							{item.label} ({item.count})
						</option>
					))}
				</select>
				{query || filter !== 'all' ? (
					<button
						type="button"
						onClick={clearFilters}
						className="h-10 rounded-lg px-3 text-xs text-gray-500 hover:bg-gray-100"
					>
						{t('clearFilters')}
					</button>
				) : null}
				<span className="ml-auto text-xs text-gray-500" role="status">
					{loading && !servers.length
						? common('loading')
						: t('listCount', { visible: visible.length, total: servers.length })}
				</span>
				<button
					type="button"
					onClick={onRefresh}
					disabled={loading || busy}
					aria-label={t('refresh')}
					title={t('refresh')}
					className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg border border-gray-200 bg-white text-gray-500 hover:bg-gray-50 disabled:opacity-40"
				>
					<ArrowPathIcon className={`h-4 w-4 ${loading ? 'animate-spin' : ''}`} aria-hidden="true" />
				</button>
			</div>
			<div className="overflow-hidden rounded-xl border border-gray-200 bg-white" aria-busy={loading}>
				{error ? (
					<div
						role="alert"
						className="flex flex-wrap items-center justify-between gap-3 bg-red-50 px-5 py-4 text-sm text-red-700"
					>
						<span>{t('loadFailed')}</span>
						<button
							type="button"
							disabled={loading}
							onClick={onRefresh}
							className="font-medium underline disabled:opacity-40"
						>
							{t('retry')}
						</button>
					</div>
				) : null}
				{loading && !servers.length ? (
					<div role="status" className="p-8 text-sm text-gray-500">
						{common('loading')}
					</div>
				) : !servers.length && !error ? (
					<div className="px-6 py-16 text-center">
						<ServerStackIcon className="mx-auto h-8 w-8 text-gray-400" aria-hidden="true" />
						<h3 className="mt-4 text-base font-medium text-gray-900">{t('empty')}</h3>
						<p className="mx-auto mt-2 max-w-md text-sm leading-6 text-gray-500">{t('emptyHint')}</p>
						<button
							type="button"
							onClick={onCreate}
							disabled={busy}
							className="mt-5 inline-flex items-center gap-2 rounded-lg bg-gray-950 px-4 py-2 text-sm text-white hover:bg-gray-800"
						>
							<PlusIcon className="h-4 w-4" aria-hidden="true" />
							{t('add')}
						</button>
					</div>
				) : !visible.length && !error ? (
					<div className="py-16 text-center">
						<p className="text-sm text-gray-500">{t('noResults')}</p>
						<button
							type="button"
							onClick={clearFilters}
							className="mt-4 text-sm font-medium text-gray-900 hover:underline"
						>
							{t('clearFilters')}
						</button>
					</div>
				) : servers.length ? (
					<div className="overflow-x-auto">
						<table className="w-full min-w-[880px] text-left text-sm">
							<thead className="border-b border-gray-200 bg-gray-50/70 text-xs text-gray-500">
								<tr>
									<th scope="col" className="px-5 py-3 font-medium">
										{t('name')}
									</th>
									<th scope="col" className="px-4 py-3 font-medium">
										{t('status')}
									</th>
									<th scope="col" className="px-4 py-3 font-medium">
										{t('catalog')}
									</th>
									{(['standard', 'charged', 'metered'] as const).map((key) => (
										<th
											key={key}
											scope="col"
											className={`whitespace-nowrap py-3 pl-4 text-right font-medium ${
												key === 'metered' ? 'pr-12' : 'pr-4'
											}`}
										>
											{t(key)}
										</th>
									))}
								</tr>
							</thead>
							<tbody className="divide-y divide-gray-100">
								{visible.map((server) => {
									const endpoint = mcpConnectEndpoint(proxyBaseUrl, server.slug);
									const prices = server.pricing ? summarizeMcpPricingRule(server.pricing) : null;
									return (
										<tr
											key={server.id}
											className={`group ${
												busy ? '' : 'cursor-pointer hover:bg-gray-50 focus-within:bg-gray-50'
											}`}
											onClick={(event) => {
												if (busy) return;
												event.currentTarget.querySelector('button')?.focus();
												onOpen(server.id);
											}}
										>
											<td className="px-5 py-4">
												<div className="flex items-center gap-3">
													<div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-gray-100 text-gray-500">
														<ServerStackIcon className="h-4 w-4" aria-hidden="true" />
													</div>
													<div className="min-w-0">
														<button
															type="button"
															aria-haspopup="dialog"
															onClick={(event) => {
																event.stopPropagation();
																event.currentTarget.focus();
																onOpen(server.id);
															}}
															disabled={busy}
															title={server.name}
															className="max-w-[260px] truncate rounded text-left font-medium text-gray-900 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-gray-500 focus-visible:ring-offset-2 disabled:opacity-40"
														>
															{server.name}
														</button>
														<div
															title={`${t('clientEndpoint')}: ${endpoint}`}
															className="mt-1 max-w-[260px] truncate font-mono text-xs text-gray-500"
														>
															/mcp/{server.slug}
														</div>
													</div>
												</div>
											</td>
											<td className="px-4 py-4">
												<span
													className={`inline-flex items-center gap-2 whitespace-nowrap text-xs ${
														server.status === 'active' ? 'text-emerald-700' : 'text-gray-500'
													}`}
												>
													<span
														className={`h-1.5 w-1.5 rounded-full ${
															server.status === 'active' ? 'bg-emerald-500' : 'bg-gray-300'
														}`}
														aria-hidden="true"
													/>
													{t(server.status === 'active' ? 'active' : 'disabled')}
												</span>
												{!server.pricing ? (
													<p className="mt-1 text-xs text-red-600">{t('pricing.invalidStored')}</p>
												) : prices && prices.charged < prices.metered ? (
													<p className="mt-1 text-xs text-amber-700">{t('defaultPriceLoss')}</p>
												) : null}
											</td>
											<td className="px-4 py-4">
												<div className="flex flex-wrap items-center gap-2 text-xs text-gray-700">
													<span>
														{server.enabledCount} {t('enabledCount')}
													</span>
													{server.pendingCount > 0 ? (
														<span className="rounded bg-amber-50 px-1.5 text-amber-700">
															{t('pendingBadge', { count: server.pendingCount })}
														</span>
													) : null}
												</div>
												<p
													title={server.lastSyncError ?? undefined}
													className={`mt-1 whitespace-nowrap text-xs ${
														server.lastSyncError ? 'text-red-600' : 'text-gray-500'
													}`}
												>
													{server.lastSyncError
														? t('syncError')
														: server.lastSyncedAt
														? `${t('lastSync')} ${formatDateTime(server.lastSyncedAt)}`
														: t('neverSynced')}
												</p>
											</td>
											{(['standard', 'charged', 'metered'] as const).map((key) => {
												const factor =
													key !== 'standard' && server.pricing
														? mcpPriceMultiplier(server.pricing, key)
														: null;
												return (
													<td
														key={key}
														className={`relative py-4 pl-4 text-right align-top ${
															key === 'metered' ? 'pr-12' : 'pr-4'
														}`}
													>
														<div className="flex items-baseline justify-end gap-2 whitespace-nowrap">
															<span
																className={`font-mono tabular-nums ${
																	key === 'charged' && prices && prices.charged < prices.metered
																		? 'text-amber-700'
																		: 'text-gray-800'
																}`}
															>
																{prices ? formatGatewayMoneyCompact(prices[key], currency) : '—'}
															</span>
															{factor != null ? (
																<span
																	title={ui('factorHint')}
																	className="font-mono text-xs tabular-nums text-gray-500"
																>
																	{new Intl.NumberFormat(locale, { maximumSignificantDigits: 6 }).format(
																		factor
																	)}
																	×
																</span>
															) : null}
														</div>
														{key === 'standard' ? (
															<p className="mt-1 whitespace-nowrap text-xs text-gray-500">
																{ui('perRequest')}
															</p>
														) : null}
														{key === 'metered' ? (
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
				) : null}
				{servers.length > 0 ? (
					<div className="flex flex-wrap justify-between gap-2 border-t border-gray-100 px-5 py-3 text-xs text-gray-500">
						<div className="flex flex-wrap gap-x-4 gap-y-1">
							<span>{t('priceCurrency', { currency: getGatewayCurrencySymbol(currency) })}</span>
							<span>{ui('exposedItems', { count: exposed })}</span>
							{pending > 0 ? (
								<span className="text-amber-700">{t('pendingBadge', { count: pending })}</span>
							) : null}
						</div>
						<span>{t('defaultPriceHint')}</span>
					</div>
				) : null}
			</div>
		</section>
	);
}
