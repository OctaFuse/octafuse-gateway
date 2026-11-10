'use client';

import { AdminPageTitle } from '@/components/admin-page-title';

/**
 * 调用记录：REST 服务（octafuse-tools / tool:*）与 MCP 服务（octafuse-mcp / mcp:*）共用请求日志。
 */
import Link from 'next/link';
import { Fragment, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useTranslations } from 'next-intl';
import { LogRangeControl } from '../../request-logs/log-range-control';
import { AdminDialog } from '@/components/admin-dialog';
import { FinancialAmount } from '@/components/FinancialAmount';
import { invocationLogScope } from './invocation-scope';
import { readApiJson } from '@/lib/api-json';
import { detectRollingPreset } from '@/lib/analytics-range';
import { useAnalyticsRange } from '@/lib/use-analytics-range';
import {
	formatGatewayMoneyCompact,
	formatGatewayMoneyCompactSigned,
	getGatewayCurrencySymbol,
} from '@/lib/format-gateway-currency';
import { findGatewayToolById, GATEWAY_TOOLS } from '@/lib/gateway-tools';
import {
	parseMcpInvocationSummary,
	parseToolRequestSummary,
	parseToolResponseSummary,
	resolveInvocationSource,
	resolveToolEngineProvider,
} from '@/lib/tool-invocation-detail';
import type { GatewayRequestLog } from '@/lib/types';
import { useBillingCurrency } from '@/lib/use-billing-currency';
import { useGatewayDateTime } from '@/lib/use-gateway-datetime';
import { useReplaceListPageQuery } from '@/lib/use-replace-list-query';

export default function GatewayToolInvocationsPage() {
	const t = useTranslations('tools');
	const tCommon = useTranslations('common');
	const ui = useTranslations('remainingUi');
	const requestId = useRef(0);
	const [filtersReady, setFiltersReady] = useState(false);
	const [loadError, setLoadError] = useState(false);
	const { currency: billingCurrency } = useBillingCurrency();
	const billingCurrencySym = getGatewayCurrencySymbol(billingCurrency);
	const { businessTimezone, formatDateTime } = useGatewayDateTime();

	const [source, setSource] = useState<'' | 'rest' | 'mcp'>('');
	const [toolFilter, setToolFilter] = useState('');
	const [serverFilter, setServerFilter] = useState('');
	const [mcpServers, setMcpServers] = useState<Array<{ slug: string; name: string }>>([]);
	const [filterStatus, setFilterStatus] = useState('');
	const [rangeValue, setRangeValue] = useAnalyticsRange();
	const [logs, setLogs] = useState<GatewayRequestLog[]>([]);
	const [total, setTotal] = useState(0);
	const [page, setPage] = useState(1);
	const [isLoading, setIsLoading] = useState(true);
	const [detailLogId, setDetailLogId] = useState<string | null>(null);
	/** Response 面板展示格式：可读列表 / 原始 JSON */
	const [responseView, setResponseView] = useState<'list' | 'json'>('list');
	const pageSize = 50;

	useEffect(() => {
		const params = new URLSearchParams(window.location.search);
		const sourceParam = params.get('source');
		const tool = params.get('tool');
		const server = params.get('server');
		const status = params.get('status');
		const startDate = params.get('start_date');
		const endDate = params.get('end_date');
		const pageParam = params.get('page');
		if (sourceParam === 'rest' || sourceParam === 'mcp') setSource(sourceParam);
		const found = findGatewayToolById(tool);
		if (found) setToolFilter(found.id);
		if (server) setServerFilter(server);
		if (status != null) setFilterStatus(status);
		const hasStart = startDate != null && startDate !== '';
		const hasEnd = endDate != null && endDate !== '';
		if (startDate !== null || endDate !== null) {
			const s = hasStart ? startDate! : '';
			const e = hasEnd ? endDate! : '';
			setRangeValue({
				preset: hasStart && hasEnd ? detectRollingPreset(s, e) ?? 'custom' : 'custom',
				start_date: s,
				end_date: e,
			});
		}
		if (pageParam) {
			const n = Number(pageParam);
			if (Number.isSafeInteger(n) && n >= 1) setPage(n);
		}
		setFiltersReady(true);
	}, [setRangeValue]);

	useReplaceListPageQuery(() => {
		const q = new URLSearchParams();
		if (source) q.set('source', source);
		if (source !== 'mcp' && toolFilter) q.set('tool', toolFilter);
		if (source === 'mcp' && serverFilter) q.set('server', serverFilter);
		if (filterStatus) q.set('status', filterStatus);
		q.set('start_date', rangeValue.start_date);
		q.set('end_date', rangeValue.end_date);
		if (page > 1) q.set('page', String(page));
		return q;
	}, [source, toolFilter, serverFilter, filterStatus, rangeValue.start_date, rangeValue.end_date, page]);

	useEffect(() => {
		void (async () => {
			const data = await readApiJson<Array<{ slug: string; name: string }>>(
				await fetch('/api/admin/mcp-servers')
			);
			if (data.success && data.data) {
				setMcpServers(data.data.map((server) => ({ slug: server.slug, name: server.name })));
			}
		})();
	}, []);

	const requestLogsHref = useMemo(() => {
		const q = invocationLogScope(source, toolFilter, serverFilter);
		if (filterStatus) q.set('status', filterStatus);
		q.set('start_date', rangeValue.start_date);
		q.set('end_date', rangeValue.end_date);
		return `/gateway/request-logs?${q.toString()}`;
	}, [source, toolFilter, serverFilter, filterStatus, rangeValue.start_date, rangeValue.end_date]);

	const fetchLogs = useCallback(async () => {
		const request = ++requestId.current;
		setLoadError(false);
		setDetailLogId(null);
		setIsLoading(true);
		try {
			const params = invocationLogScope(source, toolFilter, serverFilter);
			params.set('page', String(page));
			params.set('page_size', String(pageSize));
			if (filterStatus) params.set('status', filterStatus);
			if (rangeValue.start_date) params.set('start_date', rangeValue.start_date);
			if (rangeValue.end_date) params.set('end_date', rangeValue.end_date);

			const response = await fetch(`/api/admin/request-logs?${params.toString()}`);
			const data = await readApiJson<GatewayRequestLog[]>(response);
			if (request !== requestId.current) return;
			if (!response.ok || !data.success) {
				setLoadError(true);
				setLogs([]);
				setTotal(0);
				return;
			}
			setLogs(data.data || []);
			setTotal(data.total || 0);
		} catch (e) {
			if (request !== requestId.current) return;
			setLoadError(true);
			console.error('Fetch tool invocations:', e);
			setLogs([]);
			setTotal(0);
		} finally {
			if (request === requestId.current) setIsLoading(false);
		}
	}, [page, source, toolFilter, serverFilter, filterStatus, rangeValue.start_date, rangeValue.end_date]);

	useEffect(() => {
		if (filtersReady) void fetchLogs();
	}, [fetchLogs, filtersReady]);
	useEffect(
		() => () => {
			++requestId.current;
		},
		[]
	);

	const totalPages = Math.max(1, Math.ceil(total / pageSize));

	const toolLabel = (modelId: string | null | undefined) => {
		const found = GATEWAY_TOOLS.find((x) => x.modelId === modelId);
		if (found) return t(`catalog.${found.nameKey}`);
		return modelId || '—';
	};

	return (
		<div className="min-w-0 p-4 sm:p-6 lg:p-8">
			<div className="mb-6 flex flex-wrap items-start justify-between gap-4">
				<div>
					<AdminPageTitle>{t('invocations.title')}</AdminPageTitle>
					<p className="mt-1 max-w-3xl text-sm text-gray-500">{t('invocations.subtitle')}</p>
				</div>
				<div className="flex flex-wrap items-center gap-3">
					<Link
						href={source === 'mcp' ? '/gateway/mcp' : '/gateway/tools'}
						className="text-sm font-medium text-gray-800 hover:underline"
					>
						{source === 'mcp' ? ui('resources.mcp') : t('invocations.configureTools')}
					</Link>
					<Link
						href={requestLogsHref}
						className="rounded-lg border border-gray-200 bg-white px-3 py-2 text-xs text-gray-600 hover:bg-gray-50"
					>
						{ui('requestLogs')}
					</Link>
				</div>
			</div>

			<div className="mb-5 flex flex-wrap items-center gap-2">
				<div>
					<label className="sr-only">{t('invocations.source')}</label>
					<select
						aria-label={t('invocations.source')}
						value={source}
						onChange={(e) => {
							const next = e.target.value === 'rest' || e.target.value === 'mcp' ? e.target.value : '';
							setSource(next);
							if (next === 'mcp') setToolFilter('');
							if (next !== 'mcp') setServerFilter('');
							setPage(1);
						}}
						className="h-10 max-w-full rounded-lg border border-gray-200 bg-white px-3 text-sm text-gray-600"
					>
						<option value="">{t('invocations.allSources')}</option>
						<option value="rest">{t('invocations.sourceRest')}</option>
						<option value="mcp">{t('invocations.sourceMcp')}</option>
					</select>
				</div>
				<div>
					<label className="sr-only">
						{source === 'mcp' ? t('invocations.serverFilter') : t('invocations.toolFilter')}
					</label>
					{source === 'mcp' ? (
						<select
							aria-label={t('invocations.serverFilter')}
							value={serverFilter}
							onChange={(e) => {
								setServerFilter(e.target.value);
								setPage(1);
							}}
							className="h-10 max-w-full rounded-lg border border-gray-200 bg-white px-3 text-sm text-gray-600"
						>
							<option value="">{t('invocations.allServers')}</option>
							{mcpServers.map((server) => (
								<option key={server.slug} value={server.slug}>
									{server.name}
								</option>
							))}
						</select>
					) : (
						<select
							aria-label={t('invocations.toolFilter')}
							value={toolFilter}
							onChange={(e) => {
								setToolFilter(e.target.value);
								setPage(1);
							}}
							className="h-10 max-w-full rounded-lg border border-gray-200 bg-white px-3 text-sm text-gray-600"
						>
							<option value="">{t('invocations.allTools')}</option>
							{GATEWAY_TOOLS.map((tool) => (
								<option key={tool.id} value={tool.id}>
									{t(`catalog.${tool.nameKey}`)}
								</option>
							))}
						</select>
					)}
				</div>
				<div>
					<label className="sr-only">{t('invocations.status')}</label>
					<select
						aria-label={t('invocations.status')}
						value={filterStatus}
						onChange={(e) => {
							setFilterStatus(e.target.value);
							setPage(1);
						}}
						className="h-10 max-w-full rounded-lg border border-gray-200 bg-white px-3 text-sm text-gray-600"
					>
						<option value="">{ui('allStatuses')}</option>
						<option value="success">success</option>
						<option value="error">error</option>
					</select>
				</div>
				<div className="ml-auto max-w-full">
					<LogRangeControl
						timeZone={businessTimezone}
						value={rangeValue}
						onChange={(next) => {
							setRangeValue(next);
							setPage(1);
						}}
					/>
				</div>
			</div>

			{loadError ? (
				<div
					role="alert"
					className="mb-4 flex flex-wrap justify-between gap-3 rounded-lg bg-red-50 p-4 text-sm text-red-700"
				>
					{ui('loadFailed')}
					<button type="button" onClick={() => void fetchLogs()} className="font-medium underline">
						{ui('retry')}
					</button>
				</div>
			) : null}
			{isLoading ? (
				<div className="py-12 text-center text-gray-600">{tCommon('loading')}</div>
			) : logs.length === 0 ? (
				<div className="rounded-lg border border-dashed border-gray-300 bg-white py-12 text-center text-sm text-gray-500">
					{t('invocations.empty')}
				</div>
			) : (
				<div className="overflow-hidden rounded-xl border border-gray-200 bg-white">
					<div className="overflow-x-auto">
						<table className="min-w-full divide-y divide-gray-200 text-sm">
							<thead className="bg-gray-50">
								<tr>
									<th className="px-4 py-3 text-left font-medium text-gray-600">
										{t('invocations.columns.time')}
									</th>
									<th className="px-4 py-3 text-left font-medium text-gray-600">
										{t('invocations.columns.tool')}
									</th>
									<th className="px-4 py-3 text-left font-medium text-gray-600">
										{t('invocations.columns.provider')}
									</th>

									<th className="px-4 py-3 text-left font-medium text-gray-600">
										{t('invocations.columns.user')}
									</th>
									<th className="px-4 py-3 text-left font-medium text-gray-600">
										{t('invocations.columns.status')}
									</th>

									<th
										className="px-4 py-3 text-right font-medium text-gray-600"
										title={t('invocations.titles.standard')}
									>
										{t('invocations.columns.standard', { currency: billingCurrencySym })}
									</th>
									<th
										className="px-4 py-3 text-right font-medium text-gray-600"
										title={t('invocations.titles.charged')}
									>
										{t('invocations.columns.charged', { currency: billingCurrencySym })}
									</th>
									<th
										className="px-4 py-3 text-right font-medium text-gray-600"
										title={t('invocations.titles.metered')}
									>
										{t('invocations.columns.metered', { currency: billingCurrencySym })}
									</th>

									<th className="px-4 py-3 text-right font-medium text-gray-600">
										{t('invocations.columns.latency')}
									</th>
								</tr>
							</thead>
							<tbody className="divide-y divide-gray-100">
								{logs.map((log) => {
									const req = parseToolRequestSummary(log.request_body);
									const res = parseToolResponseSummary(log.raw_usage);
									const rowSource = resolveInvocationSource(log);
									const mcp = rowSource === 'mcp' ? parseMcpInvocationSummary(log) : null;
									const engine = mcp?.slug || resolveToolEngineProvider(log);
									const queryText = mcp ? mcp.argumentSummary : req.query;
									const standardCost = Number(log.standard_cost ?? 0);
									const chargedCost = Number(log.charged_cost ?? 0);
									const meteredCost = Number(log.metered_cost ?? 0);
									const profit = chargedCost - meteredCost;
									const profitToneClass =
										profit > 0 ? 'text-emerald-700' : profit < 0 ? 'text-red-600' : 'text-gray-600';
									const expanded = detailLogId === log.id;
									return (
										<Fragment key={log.id}>
											<tr
												className={`cursor-pointer hover:bg-gray-50 ${
													expanded ? 'bg-slate-50' : profit < 0 ? 'bg-amber-50/50' : ''
												}`}
												onClick={(event) => {
													event.currentTarget.querySelector('button')?.focus();
													if (expanded) {
														setDetailLogId(null);
													} else {
														setDetailLogId(log.id);
														setResponseView(rowSource === 'mcp' ? 'json' : 'list');
													}
												}}
												aria-expanded={expanded}
											>
												<td className="whitespace-nowrap px-4 py-3 text-gray-700">
													<button
														type="button"
														aria-haspopup="dialog"
														onClick={(event) => {
															event.stopPropagation();
															setDetailLogId(log.id);
															setResponseView(rowSource === 'mcp' ? 'json' : 'list');
														}}
														className="rounded text-left hover:text-gray-950 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-gray-500"
													>
														{formatDateTime(log.created_at)}
													</button>
												</td>
												<td className="px-4 py-3 text-xs text-gray-900">
													<span
														className={`mr-2 inline-flex rounded-full px-1.5 py-px align-middle font-sans text-xs font-medium ring-1 ring-inset ${
															rowSource === 'mcp'
																? 'bg-teal-50 text-teal-800 ring-teal-200'
																: 'bg-gray-50 text-gray-700 ring-gray-200'
														}`}
													>
														{rowSource === 'mcp' ? t('invocations.sourceMcp') : t('invocations.sourceRest')}
													</span>
													<span className="font-mono">{mcp ? mcp.label : toolLabel(log.model_id)}</span>
													{queryText ? (
														<p
															title={queryText}
															className="mt-1 max-w-64 truncate font-sans text-xs text-gray-500"
														>
															{queryText}
														</p>
													) : null}
												</td>
												<td className="px-4 py-3 font-mono text-xs text-gray-800" title={engine ?? undefined}>
													{engine || '—'}
												</td>

												<td
													className="max-w-[12rem] truncate px-4 py-3 text-gray-700"
													title={log.user_email ?? ''}
												>
													{log.user_email || '—'}
												</td>
												<td className="px-4 py-3">
													<span
														className={
															log.status === 'success'
																? 'text-green-700'
																: log.status === 'error'
																? 'text-red-700'
																: 'text-gray-700'
														}
													>
														{log.status}
													</span>
												</td>

												<td
													className="px-4 py-3 text-right font-mono text-xs tabular-nums text-gray-800"
													title={t('invocations.titles.standard')}
												>
													{formatGatewayMoneyCompact(standardCost, billingCurrency)}
												</td>
												<td
													className="px-4 py-3 text-right font-mono text-xs tabular-nums text-gray-900"
													title={t('invocations.titles.charged')}
												>
													<FinancialAmount
														compact
														value={chargedCost}
														standard={standardCost}
														currency={billingCurrency}
													/>
												</td>
												<td
													className="px-4 py-3 text-right font-mono text-xs tabular-nums text-gray-700"
													title={t('invocations.titles.metered')}
												>
													<FinancialAmount
														compact
														value={meteredCost}
														standard={standardCost}
														currency={billingCurrency}
													/>
												</td>

												<td className="px-4 py-3 text-right font-mono text-xs text-gray-600">
													{log.latency_ms != null ? `${log.latency_ms} ms` : '—'}
												</td>
											</tr>
											{expanded && (
												<AdminDialog
													open={expanded}
													wide
													title={ui('invocationDetails')}
													hint={formatDateTime(log.created_at)}
													onClose={() => setDetailLogId(null)}
													footer={
														<div className="flex items-center justify-between gap-3">
															<Link
																href={`/gateway/request-logs?id=${encodeURIComponent(log.id)}`}
																className="text-xs text-gray-600 hover:underline"
															>
																{ui('requestLogs')}
															</Link>
															<button
																type="button"
																onClick={() => setDetailLogId(null)}
																className="rounded-lg border border-gray-200 bg-white px-4 py-2 text-sm"
															>
																{tCommon('close')}
															</button>
														</div>
													}
												>
													<div className="mb-5 flex flex-wrap gap-x-6 gap-y-3 rounded-lg bg-gray-50 p-4 text-xs text-gray-500">
														<div>
															{t('invocations.columns.profit', { currency: billingCurrencySym })}
															<p className={`mt-1 font-mono ${profitToneClass}`}>
																{formatGatewayMoneyCompactSigned(profit, billingCurrency)}
															</p>
														</div>
														<div>
															{t('invocations.columns.results')}
															<p className="mt-1 font-mono text-gray-800">
																{mcp || res.resultCount == null ? '—' : res.resultCount}
															</p>
														</div>
														{queryText ? (
															<div className="min-w-0 flex-1">
																{t('invocations.columns.query')}
																<p className="mt-1 break-words text-gray-800">{queryText}</p>
															</div>
														) : null}
													</div>
													<div className="grid items-stretch gap-4 lg:grid-cols-2">
														<div className="flex min-h-[14rem] flex-col">
															<h3 className="mb-2 shrink-0 text-xs font-medium normal-case tracking-normal text-gray-500">
																{t('invocations.detail.request')}
															</h3>
															<pre className="min-h-0 flex-1 overflow-auto rounded-md border border-gray-200 bg-white p-3 font-mono text-xs text-gray-800 whitespace-pre-wrap break-all">
																{log.request_body
																	? JSON.stringify(req.raw ?? log.request_body, null, 2)
																	: '—'}
															</pre>
														</div>
														<div className="flex min-h-[14rem] flex-col">
															<div className="mb-2 flex shrink-0 items-center justify-between gap-2">
																<h3 className="text-xs font-medium normal-case tracking-normal text-gray-500">
																	{t('invocations.detail.response')}
																</h3>
																<div
																	className="inline-flex rounded-md border border-gray-200 bg-white p-0.5 text-xs shadow-sm"
																	role="tablist"
																	aria-label={t('invocations.detail.responseFormat')}
																>
																	<button
																		type="button"
																		role="tab"
																		aria-selected={responseView === 'list'}
																		onClick={() => setResponseView('list')}
																		className={`rounded px-2.5 py-1 font-medium ${
																			responseView === 'list'
																				? 'bg-gray-900 text-white'
																				: 'text-gray-600 hover:bg-gray-50'
																		}`}
																	>
																		{t('invocations.detail.formatList')}
																	</button>
																	<button
																		type="button"
																		role="tab"
																		aria-selected={responseView === 'json'}
																		onClick={() => setResponseView('json')}
																		className={`rounded px-2.5 py-1 font-medium ${
																			responseView === 'json'
																				? 'bg-gray-900 text-white'
																				: 'text-gray-600 hover:bg-gray-50'
																		}`}
																	>
																		{t('invocations.detail.formatJson')}
																	</button>
																</div>
															</div>
															<div className="flex min-h-0 flex-1 flex-col overflow-hidden rounded-md border border-gray-200 bg-white">
																{log.error_message ? (
																	<p className="shrink-0 border-b border-red-100 bg-red-50 px-3 py-2 text-xs text-red-700">
																		{log.error_message}
																	</p>
																) : null}
																{responseView === 'list' ? (
																	res.results.length > 0 ? (
																		<ul className="min-h-0 flex-1 space-y-2 overflow-auto p-3">
																			{res.results.map((item, idx) => (
																				<li key={`${item.url ?? 'r'}-${idx}`} className="text-xs">
																					{item.url ? (
																						<a
																							href={item.url}
																							target="_blank"
																							rel="noopener noreferrer"
																							className="font-medium text-gray-800 hover:underline"
																						>
																							{item.title || item.url}
																						</a>
																					) : (
																						<span className="font-medium text-gray-900">
																							{item.title || '—'}
																						</span>
																					)}
																					{item.snippet ? (
																						<p className="mt-0.5 line-clamp-2 text-gray-600">
																							{item.snippet}
																						</p>
																					) : null}
																				</li>
																			))}
																		</ul>
																	) : (
																		<div className="flex min-h-0 flex-1 items-center justify-center px-3 py-6 text-xs text-gray-500">
																			{log.raw_usage
																				? t('invocations.detail.noListResults')
																				: t('invocations.detail.noResponseStored')}
																		</div>
																	)
																) : (
																	<pre className="min-h-0 flex-1 overflow-auto p-3 font-mono text-xs text-gray-800 whitespace-pre-wrap break-all">
																		{log.raw_usage
																			? JSON.stringify(res.raw ?? log.raw_usage, null, 2)
																			: t('invocations.detail.noResponseStored')}
																	</pre>
																)}
															</div>
														</div>
													</div>
													<p className="mt-3 text-xs text-gray-500">{t('invocations.detail.hint')}</p>
												</AdminDialog>
											)}
										</Fragment>
									);
								})}
							</tbody>
						</table>
					</div>
					<div className="flex flex-wrap items-center justify-between gap-3 border-t border-gray-200 px-4 py-3 text-sm text-gray-600">
						<span>
							{tCommon('pageOf', { page, totalPages })} · {total}
						</span>
						<div className="flex gap-2">
							<button
								type="button"
								disabled={page <= 1}
								onClick={() => setPage((p) => Math.max(1, p - 1))}
								className="rounded-md border border-gray-300 px-3 py-1 disabled:opacity-40"
							>
								{tCommon('previous')}
							</button>
							<button
								type="button"
								disabled={page >= totalPages}
								onClick={() => setPage((p) => p + 1)}
								className="rounded-md border border-gray-300 px-3 py-1 disabled:opacity-40"
							>
								{tCommon('next')}
							</button>
						</div>
					</div>
				</div>
			)}
		</div>
	);
}
