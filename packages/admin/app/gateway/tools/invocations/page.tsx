'use client';

/**
 * Tools 调用查询：筛选 `provider_id=octafuse-tools`（或单工具 `model_id=tool:*`）的 request logs。
 */
import Link from 'next/link';
import { Fragment, useCallback, useEffect, useMemo, useState } from 'react';
import { useTranslations } from 'next-intl';
import { GatewayTimeRangePicker } from '@/components/GatewayTimeRangePicker';
import { readApiJson } from '@/lib/api-json';
import {
	createRangeValue,
	DEFAULT_GATEWAY_TIME_RANGE_PRESET,
	detectRollingPreset,
	type GatewayTimeRangeValue,
} from '@/lib/analytics-range';
import { formatGatewayMoneyCode } from '@/lib/format-gateway-currency';
import {
	findGatewayToolById,
	GATEWAY_TOOLS,
	GATEWAY_TOOLS_PROVIDER_ID,
} from '@/lib/gateway-tools';
import { parseToolRequestSummary, parseToolResponseSummary } from '@/lib/tool-invocation-detail';
import type { GatewayRequestLog } from '@/lib/types';
import { useBillingCurrency } from '@/lib/use-billing-currency';
import { useGatewayDateTime } from '@/lib/use-gateway-datetime';
import { useReplaceListPageQuery } from '@/lib/use-replace-list-query';

export default function GatewayToolInvocationsPage() {
	const t = useTranslations('tools');
	const tCommon = useTranslations('common');
	const { currency: billingCurrency } = useBillingCurrency();
	const { formatDateTime } = useGatewayDateTime();

	const [toolFilter, setToolFilter] = useState('');
	const [filterStatus, setFilterStatus] = useState('');
	const [rangeValue, setRangeValue] = useState<GatewayTimeRangeValue>(() => createRangeValue(DEFAULT_GATEWAY_TIME_RANGE_PRESET));
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
		const tool = params.get('tool');
		const status = params.get('status');
		const startDate = params.get('start_date');
		const endDate = params.get('end_date');
		const pageParam = params.get('page');
		const found = findGatewayToolById(tool);
		if (found) setToolFilter(found.id);
		if (status != null) setFilterStatus(status);
		const hasStart = startDate != null && startDate !== '';
		const hasEnd = endDate != null && endDate !== '';
		if (hasStart || hasEnd) {
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
			if (Number.isFinite(n) && n >= 1) setPage(n);
		}
	}, []);

	useReplaceListPageQuery(
		() => {
			const q = new URLSearchParams();
			if (toolFilter) q.set('tool', toolFilter);
			if (filterStatus) q.set('status', filterStatus);
			if (rangeValue.start_date) q.set('start_date', rangeValue.start_date);
			if (rangeValue.end_date) q.set('end_date', rangeValue.end_date);
			if (page > 1) q.set('page', String(page));
			return q;
		},
		[toolFilter, filterStatus, rangeValue.start_date, rangeValue.end_date, page]
	);

	const requestLogsHref = useMemo(() => {
		const q = new URLSearchParams();
		const tool = findGatewayToolById(toolFilter);
		if (tool) {
			q.set('model_id', tool.modelId);
		} else {
			q.set('provider_id', GATEWAY_TOOLS_PROVIDER_ID);
		}
		if (filterStatus) q.set('status', filterStatus);
		if (rangeValue.start_date) q.set('start_date', rangeValue.start_date);
		if (rangeValue.end_date) q.set('end_date', rangeValue.end_date);
		return `/gateway/request-logs?${q.toString()}`;
	}, [toolFilter, filterStatus, rangeValue.start_date, rangeValue.end_date]);

	const fetchLogs = useCallback(async () => {
		setIsLoading(true);
		try {
			const params = new URLSearchParams();
			params.set('page', String(page));
			params.set('page_size', String(pageSize));
			const tool = findGatewayToolById(toolFilter);
			if (tool) {
				params.set('model_id', tool.modelId);
			} else {
				params.set('provider_id', GATEWAY_TOOLS_PROVIDER_ID);
			}
			if (filterStatus) params.set('status', filterStatus);
			if (rangeValue.start_date) params.set('start_date', rangeValue.start_date);
			if (rangeValue.end_date) params.set('end_date', rangeValue.end_date);

			const response = await fetch(`/api/admin/request-logs?${params.toString()}`);
			const data = await readApiJson<GatewayRequestLog[]>(response);
			if (!data.success) {
				setLogs([]);
				setTotal(0);
				return;
			}
			setLogs(data.data || []);
			setTotal(data.total || 0);
		} catch (e) {
			console.error('Fetch tool invocations:', e);
			setLogs([]);
			setTotal(0);
		} finally {
			setIsLoading(false);
		}
	}, [page, toolFilter, filterStatus, rangeValue.start_date, rangeValue.end_date]);

	useEffect(() => {
		void fetchLogs();
	}, [fetchLogs]);

	const totalPages = Math.max(1, Math.ceil(total / pageSize));

	const toolLabel = (modelId: string | null | undefined) => {
		const found = GATEWAY_TOOLS.find((x) => x.modelId === modelId);
		if (found) return t(`catalog.${found.nameKey}`);
		return modelId || '—';
	};

	return (
		<div className="p-8">
			<div className="mb-6 flex flex-wrap items-start justify-between gap-4">
				<div>
					<h1 className="text-3xl font-bold text-gray-900">{t('invocations.title')}</h1>
					<p className="mt-1 max-w-3xl text-sm text-gray-500">{t('invocations.subtitle')}</p>
				</div>
				<div className="flex flex-wrap items-center gap-3">
					<Link href="/gateway/tools" className="text-sm font-medium text-blue-600 hover:underline">
						{t('invocations.configureTools')}
					</Link>
					<Link
						href={requestLogsHref}
						className="rounded-md border border-gray-300 bg-white px-3 py-2 text-sm font-medium text-gray-800 shadow-sm hover:bg-gray-50"
					>
						{t('invocations.openInRequestLogs')}
					</Link>
				</div>
			</div>

			<div className="mb-4 flex flex-wrap items-end gap-3 rounded-lg border border-gray-200 bg-white p-4 shadow-sm">
				<div>
					<label className="mb-1 block text-xs font-medium text-gray-600">{t('invocations.toolFilter')}</label>
					<select
						value={toolFilter}
						onChange={(e) => {
							setToolFilter(e.target.value);
							setPage(1);
						}}
						className="min-w-[14rem] rounded-md border border-gray-300 bg-white px-3 py-2 text-sm shadow-sm"
					>
						<option value="">{t('invocations.allTools')}</option>
						{GATEWAY_TOOLS.map((tool) => (
							<option key={tool.id} value={tool.id}>
								{t(`catalog.${tool.nameKey}`)}
							</option>
						))}
					</select>
				</div>
				<div>
					<label className="mb-1 block text-xs font-medium text-gray-600">{t('invocations.status')}</label>
					<select
						value={filterStatus}
						onChange={(e) => {
							setFilterStatus(e.target.value);
							setPage(1);
						}}
						className="min-w-[10rem] rounded-md border border-gray-300 bg-white px-3 py-2 text-sm shadow-sm"
					>
						<option value="">{tCommon('all')}</option>
						<option value="success">success</option>
						<option value="error">error</option>
					</select>
				</div>
				<div className="min-w-[16rem] flex-1">
					<GatewayTimeRangePicker
						value={rangeValue}
						onChange={(next) => {
							setRangeValue(next);
							setPage(1);
						}}
					/>
				</div>
			</div>

			{isLoading ? (
				<div className="py-12 text-center text-gray-600">{tCommon('loading')}</div>
			) : logs.length === 0 ? (
				<div className="rounded-lg border border-dashed border-gray-300 bg-white py-12 text-center text-sm text-gray-500">
					{t('invocations.empty')}
				</div>
			) : (
				<div className="overflow-hidden rounded-lg border border-gray-200 bg-white shadow-sm">
					<table className="min-w-full divide-y divide-gray-200 text-sm">
						<thead className="bg-gray-50">
							<tr>
								<th className="px-4 py-3 text-left font-medium text-gray-600">{t('invocations.columns.time')}</th>
								<th className="px-4 py-3 text-left font-medium text-gray-600">{t('invocations.columns.tool')}</th>
								<th className="px-4 py-3 text-left font-medium text-gray-600">{t('invocations.columns.query')}</th>
								<th className="px-4 py-3 text-left font-medium text-gray-600">{t('invocations.columns.user')}</th>
								<th className="px-4 py-3 text-left font-medium text-gray-600">{t('invocations.columns.status')}</th>
								<th className="px-4 py-3 text-right font-medium text-gray-600">{t('invocations.columns.results')}</th>
								<th className="px-4 py-3 text-right font-medium text-gray-600">{t('invocations.columns.cost')}</th>
								<th className="px-4 py-3 text-right font-medium text-gray-600">{t('invocations.columns.latency')}</th>
							</tr>
						</thead>
						<tbody className="divide-y divide-gray-100">
							{logs.map((log) => {
								const req = parseToolRequestSummary(log.request_body);
								const res = parseToolResponseSummary(log.raw_usage);
								const expanded = detailLogId === log.id;
								return (
									<Fragment key={log.id}>
										<tr
											className={`cursor-pointer hover:bg-gray-50 ${expanded ? 'bg-slate-50' : ''}`}
											onClick={() => {
												if (expanded) {
													setDetailLogId(null);
												} else {
													setDetailLogId(log.id);
													setResponseView('list');
												}
											}}
											aria-expanded={expanded}
										>
											<td className="whitespace-nowrap px-4 py-3 text-gray-700">
												{formatDateTime(log.created_at)}
											</td>
											<td className="px-4 py-3 font-mono text-xs text-gray-900">{toolLabel(log.model_id)}</td>
											<td className="max-w-[18rem] truncate px-4 py-3 text-gray-800" title={req.query ?? ''}>
												{req.query || '—'}
											</td>
											<td className="max-w-[12rem] truncate px-4 py-3 text-gray-700" title={log.user_email ?? ''}>
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
											<td className="px-4 py-3 text-right font-mono text-xs text-gray-600">
												{res.resultCount != null ? res.resultCount : '—'}
											</td>
											<td className="px-4 py-3 text-right font-mono text-xs text-gray-800">
												{formatGatewayMoneyCode(log.charged_cost ?? 0, billingCurrency)}
											</td>
											<td className="px-4 py-3 text-right font-mono text-xs text-gray-600">
												{log.latency_ms != null ? `${log.latency_ms} ms` : '—'}
											</td>
										</tr>
										{expanded && (
											<tr className="bg-slate-50">
												<td colSpan={8} className="px-4 py-4" onClick={(e) => e.stopPropagation()}>
													<div className="grid items-stretch gap-4 lg:grid-cols-2">
														<div className="flex min-h-[18rem] flex-col">
															<h3 className="mb-2 shrink-0 text-xs font-semibold uppercase tracking-wide text-gray-500">
																{t('invocations.detail.request')}
															</h3>
															<pre className="min-h-0 flex-1 overflow-auto rounded-md border border-gray-200 bg-white p-3 font-mono text-xs text-gray-800 whitespace-pre-wrap break-all">
																{log.request_body
																	? JSON.stringify(req.raw ?? log.request_body, null, 2)
																	: '—'}
															</pre>
														</div>
														<div className="flex min-h-[18rem] flex-col">
															<div className="mb-2 flex shrink-0 items-center justify-between gap-2">
																<h3 className="text-xs font-semibold uppercase tracking-wide text-gray-500">
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
																							rel="noreferrer"
																							className="font-medium text-blue-700 hover:underline"
																						>
																							{item.title || item.url}
																						</a>
																					) : (
																						<span className="font-medium text-gray-900">{item.title || '—'}</span>
																					)}
																					{item.snippet ? (
																						<p className="mt-0.5 line-clamp-2 text-gray-600">{item.snippet}</p>
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
												</td>
											</tr>
										)}
									</Fragment>
								);
							})}
						</tbody>
					</table>
					<div className="flex items-center justify-between border-t border-gray-200 px-4 py-3 text-sm text-gray-600">
						<span>{tCommon('pageOf', { page, totalPages })} · {total}</span>
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
