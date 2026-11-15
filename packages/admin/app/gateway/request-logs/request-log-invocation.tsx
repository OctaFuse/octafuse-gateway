'use client';

/**
 * 工具调用的请求详情。这类请求不经过模型路由，没有协议转换、上游尝试和流式输出，
 * 所以不用「请求流程」，而是按排查顺序展示：失败原因 → 调用概览 → 请求 → 响应 → 记账。
 * REST 工具与 MCP 工具记录的内容不同，各有一个视图，共用外壳和记账块。
 */
import { useState, type ReactNode } from 'react';
import { useLocale, useTranslations } from 'next-intl';
import { ArrowRightIcon, ClockIcon } from '@heroicons/react/24/outline';
import { formatGatewayMoneyCode } from '@/lib/format-gateway-currency';
import { findGatewayToolById } from '@/lib/gateway-tools';
import {
	classifyMcpFailure,
	listRequestParams,
	parseAiDetectionSummary,
	parseMcpArguments,
	parseMcpInvocationSummary,
	parseMcpResult,
	parseToolPricingAudit,
	parseToolRequestSummary,
	parseToolResponseSummary,
	resolveToolEngineProvider,
	type InvocationSource,
	type ToolRequestParam,
} from '@/lib/tool-invocation-detail';
import type { GatewayRequestLog } from '@/lib/types';
import { CostCards, Fields, RawData, type DetailFieldRow } from './request-log-detail-parts';
import { requestAccountingHref } from './request-log-flow-data';
import { requestLogDuration } from './request-log-query';
import { formatRequestCostMultiplier } from './request-log-values';

type DetailProps = { log: GatewayRequestLog; identityLabel: string; currency: string };

const linkClass = 'inline-flex items-center gap-1 text-xs text-gray-800 hover:underline';
const preClass =
	'overflow-auto whitespace-pre-wrap break-words font-mono text-xs leading-relaxed text-gray-800 [overflow-wrap:anywhere]';
const noteClass = 'rounded-lg border border-dashed border-gray-200 px-3 py-4 text-center text-xs text-gray-500';

function ConfigLink({ href, children }: { href: string; children: ReactNode }) {
	return (
		<a href={href} className={linkClass}>
			{children}
			<ArrowRightIcon aria-hidden="true" className="h-3 w-3" />
		</a>
	);
}

function Section({ title, aside, children }: { title: string; aside?: ReactNode; children: ReactNode }) {
	return (
		<section className="border-b border-gray-100 px-4 py-4 last:border-b-0">
			<div className="mb-3 flex flex-wrap items-center justify-between gap-2">
				<h3 className="flex items-center gap-2 text-sm font-medium text-gray-800">
					<span aria-hidden="true" className="h-3 w-1 rounded bg-gray-700" />
					{title}
				</h3>
				{aside}
			</div>
			{children}
		</section>
	);
}

function CallShell({
	log,
	title,
	latencyLabel,
	failureHint,
	children,
}: {
	log: GatewayRequestLog;
	title: string;
	latencyLabel: string;
	/** 失败时的排查方向；错误原文取自日志。 */
	failureHint: string;
	children: ReactNode;
}) {
	const t = useTranslations('requestLogs.invocation');
	const options = useTranslations('options');
	const status = ['success', 'error', 'incomplete', 'cancelled'].includes(log.status)
		? options(`requestStatus.${log.status}`)
		: log.status;
	const statusClass =
		log.status === 'success'
			? 'bg-emerald-50 text-emerald-700'
			: log.status === 'error'
				? 'bg-red-50 text-red-700'
				: 'bg-amber-50 text-amber-800';
	const error = log.error_message?.trim();
	return (
		<section className="min-w-0" aria-label={title}>
			<div className="flex flex-wrap items-center justify-between gap-3 border-b border-gray-100 px-4 py-3">
				<div className="flex min-w-0 flex-wrap items-center gap-2">
					<span className="text-sm font-medium text-gray-900">{title}</span>
					<span className={`rounded-full px-2 py-0.5 text-xs font-medium ${statusClass}`}>{status}</span>
				</div>
				<span className="inline-flex items-center gap-1 text-xs text-gray-500" title={t('latencyHint')}>
					<ClockIcon aria-hidden="true" className="h-3.5 w-3.5" />
					{latencyLabel}{' '}
					<strong className="font-mono font-medium text-gray-800">{requestLogDuration(log.latency_ms)}</strong>
				</span>
			</div>
			{error && (
				<div role="alert" className="mx-4 mt-4 rounded-lg border border-red-100 bg-red-50 p-3 text-xs">
					<p className="whitespace-pre-wrap break-words font-medium text-red-700 [overflow-wrap:anywhere]">
						{error}
					</p>
					<p className="mt-1.5 text-red-700/80">{failureHint}</p>
				</div>
			)}
			{children}
		</section>
	);
}

function ParamList({ params }: { params: ToolRequestParam[] }) {
	return (
		<dl className="divide-y divide-gray-100 rounded-lg border border-gray-200 bg-white">
			{params.map((param) => (
				<div
					key={param.name}
					className="grid gap-1 px-3 py-2 sm:grid-cols-[minmax(8rem,14rem)_minmax(0,1fr)] sm:gap-4"
				>
					<dt className="break-all font-mono text-xs text-gray-500">{param.name}</dt>
					<dd className={`max-h-48 ${preClass}`}>{param.value}</dd>
				</div>
			))}
		</dl>
	);
}

/** 没有响应可看时说明原因：调用失败，或这条记录本来就没存。 */
function NoResponse({ log }: { log: GatewayRequestLog }) {
	const t = useTranslations('requestLogs.invocation');
	return <p className={noteClass}>{t(log.status === 'success' ? 'noResponseStored' : 'noResponseFailed')}</p>;
}

/** 请求、响应共用的可读视图与原始视图；各区独立切换，不转换协议。 */
function DataSection({
	title,
	viewLabel,
	raw,
	rawTitle,
	aside,
	notice,
	children,
}: {
	title: string;
	viewLabel: string;
	raw: string | null | undefined;
	rawTitle: string;
	aside?: ReactNode;
	notice?: ReactNode;
	children: ReactNode;
}) {
	const t = useTranslations('requestLogs.invocation');
	const [view, setView] = useState<'preview' | 'raw'>('preview');
	const hasData = Boolean(raw?.trim());
	return (
		<Section
			title={title}
			aside={
				<div className="ml-auto flex flex-wrap items-center justify-end gap-2">
					{aside}
					{hasData && (
						<div
							role="group"
							aria-label={viewLabel}
							className="inline-flex rounded-lg bg-gray-100 p-1"
						>
							{(['preview', 'raw'] as const).map((option) => (
								<button
									key={option}
									type="button"
									aria-pressed={view === option}
									onClick={() => setView(option)}
									className={`rounded-md px-3 py-1 text-xs font-medium transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-gray-500 ${
										view === option
											? 'bg-white text-gray-950 shadow-sm'
											: 'text-gray-500 hover:text-gray-900'
									}`}
								>
									{t(
										option === 'preview'
											? 'dataPreview'
											: 'dataOriginal'
									)}
								</button>
							))}
						</div>
					)}
				</div>
			}
		>
			{notice}
			{hasData && view === 'raw' ? (
				<RawData title={rawTitle} raw={raw} collapsible={false} />
			) : (
				children
			)}
		</Section>
	);
}

function Accounting({ log, currency }: { log: GatewayRequestLog; currency: string }) {
	const t = useTranslations('requestLogs.invocation');
	const logs = useTranslations('requestLogs');
	const locale = useLocale();
	const pricing = parseToolPricingAudit(log.pricing_audit);
	const money = (value: number | null | undefined) =>
		value == null ? '—' : formatGatewayMoneyCode(value, currency, 6);
	// 失败的调用金额为 0，算不出倍率；这时用审计里的倍率或单价。
	const factor = (configured: number | null | undefined, unitPrice: number | null | undefined, cost: number) =>
		(configured != null ? formatRequestCostMultiplier(configured, 1, locale) : null) ??
		formatRequestCostMultiplier(unitPrice, pricing?.unitPrices.standard, locale) ??
		formatRequestCostMultiplier(cost, log.standard_cost, locale) ??
		'—';
	const units = (value: number | null | undefined) =>
		value == null ? null : [value.toLocaleString(locale), pricing?.unit].filter(Boolean).join(' ');
	const rows: DetailFieldRow[] = [
		[t('billingUnits'), units(pricing?.billingUnits)],
		[t('unitPriceCharged'), money(pricing?.unitPrices.charged)],
		[t('unitPriceMetered'), money(pricing?.unitPrices.metered)],
		[t('unitPriceStandard'), money(pricing?.unitPrices.standard)],
		[logs('ui.chargedFactor'), factor(pricing?.chargedFactor, pricing?.unitPrices.charged, log.charged_cost), 'factor'],
		[logs('ui.meteredFactor'), factor(pricing?.meteredFactor, pricing?.unitPrices.metered, log.metered_cost), 'factor'],
	];
	if (pricing?.ruleSource) {
		rows.push([t('pricingSource'), t(pricing.ruleSource === 'item' ? 'pricingSourceItem' : 'pricingSourceServer')]);
	}
	if (pricing?.preflightUnits != null) rows.push([t('preflightUnits'), units(pricing.preflightUnits)]);
	if (pricing?.settledUnits != null) rows.push([t('settledUnits'), units(pricing.settledUnits)]);
	return (
		<Section
			title={t('accounting')}
			aside={
				<ConfigLink href={requestAccountingHref(log.id, log.created_at)}>
					{logs('flow.viewAccountingAudit')}
				</ConfigLink>
			}
		>
			<CostCards log={log} currency={currency} />
			<div className="mt-4">
				<Fields rows={rows} />
			</div>
			<p className="mt-3 text-xs text-gray-500">
				{log.status !== 'success' && !(log.charged_cost > 0) ? t('notCharged') : logs('flow.billingNote')}
			</p>
			<RawData title={logs('detail.pricingAudit')} raw={log.pricing_audit} />
		</Section>
	);
}

function RestCallDetail({ log, identityLabel, currency }: DetailProps) {
	const t = useTranslations('requestLogs.invocation');
	const logs = useTranslations('requestLogs');
	const catalog = useTranslations('tools.catalog');
	const locale = useLocale();
	const tool = findGatewayToolById(log.model_id);
	const engine = resolveToolEngineProvider(log);
	const request = parseToolRequestSummary(log.request_body);
	const response = parseToolResponseSummary(log.raw_usage);
	const detection = tool?.id === 'ai-detection' ? parseAiDetectionSummary(log.raw_usage) : null;
	const page = tool?.id === 'web-fetch' ? response.results[0] : null;
	// 引擎已在概览里，参数表不再重复。
	const params = listRequestParams(request.raw, ['provider']);
	const chars = (value: number | null | undefined) =>
		value == null ? null : t('charCount', { count: value.toLocaleString(locale) });
	const score = (value: number | null | undefined) =>
		value == null ? null : `${value.toLocaleString(locale, { maximumFractionDigits: 2 })}%`;
	const toolName = tool ? catalog(tool.nameKey) : log.model_name?.trim() || log.model_id;
	const overview: DetailFieldRow[] = [
		[t('tool'), tool ? `${toolName} · ${tool.modelId}` : toolName],
		[t('engine'), engine],
		[logs('detail.identity'), identityLabel],
		[logs('detail.ingressHost'), log.ingress_host],
		...(detection
			? ([
					[t('overallScore'), score(detection.overallScore)],
					[t('totalChars'), chars(detection.totalChars)],
				] as DetailFieldRow[])
			: tool?.id === 'web-fetch'
				? ([
						[t('url'), request.query],
						[t('contentLength'), chars(response.contentLength)],
					] as DetailFieldRow[])
				: ([
						[t('query'), request.query],
						[t('results'), response.resultCount?.toLocaleString(locale)],
					] as DetailFieldRow[])),
	];

	return (
		<CallShell
			log={log}
			title={t('restTitle')}
			latencyLabel={t('engineLatency')}
			failureHint={engine ? t('failureRest', { engine }) : t('failureRestUnknownEngine')}
		>
			<Section
				title={t('overview')}
				aside={
					<ConfigLink href={`/gateway/tools${tool ? `#${tool.configAnchor}` : ''}`}>
						{t('openToolConfig')}
					</ConfigLink>
				}
			>
				<Fields rows={overview} />
			</Section>
			<DataSection title={t('request')} viewLabel={t('requestView')} raw={log.request_body} rawTitle={t('requestRaw')}>
				{params.length > 0 ? (
					<ParamList params={params} />
				) : (
					<pre className={`max-h-48 rounded-lg border border-gray-200 bg-white p-3 ${preClass}`}>
						{log.request_body?.trim() || '—'}
					</pre>
				)}
			</DataSection>
			<DataSection title={t('response')} viewLabel={t('responseView')} raw={log.raw_usage} rawTitle={t('responseRaw')}>
				{!log.raw_usage?.trim() ? (
					<NoResponse log={log} />
				) : detection ? (
					<>
						<Fields
							rows={[
								[t('overallScore'), score(detection.overallScore)],
								[t('totalChars'), chars(detection.totalChars)],
								[t('segmentCount'), detection.segmentCount?.toLocaleString(locale)],
							]}
						/>
						{detection.segments.length > 0 && (
							<div className="mt-4 max-h-72 overflow-auto rounded-lg border border-gray-200">
								<table className="w-full text-left text-xs">
									<thead className="sticky top-0 bg-gray-50 text-gray-500">
										<tr>
											<th className="px-3 py-2 font-medium">{t('segment')}</th>
											<th className="px-3 py-2 font-medium">{t('segmentChars')}</th>
											<th className="px-3 py-2 font-medium">{t('segmentScore')}</th>
										</tr>
									</thead>
									<tbody className="divide-y divide-gray-100 font-mono text-gray-800">
										{detection.segments.map((segment) => (
											<tr key={segment.index}>
												<td className="px-3 py-1.5">#{segment.index}</td>
												<td className="px-3 py-1.5">{segment.chars?.toLocaleString(locale) ?? '—'}</td>
												<td className="px-3 py-1.5">{score(segment.score) ?? '—'}</td>
											</tr>
										))}
									</tbody>
								</table>
							</div>
						)}
						<p className="mt-3 text-xs text-gray-500">{t('aiDetectionNote')}</p>
					</>
				) : page ? (
					<>
						<Fields
							rows={[
								[t('pageTitle'), page.title],
								[t('url'), page.url],
							]}
						/>
						{page.snippet && (
							<div className="mt-4">
								<div className="mb-1.5 text-xs text-gray-500">{t('contentPreview')}</div>
								<pre className={`max-h-48 rounded-lg border border-gray-200 bg-white p-3 ${preClass}`}>
									{page.snippet}
								</pre>
							</div>
						)}
					</>
				) : response.results.length > 0 ? (
					<ol className="max-h-96 divide-y divide-gray-100 overflow-auto rounded-lg border border-gray-200 bg-white">
						{response.results.map((item, index) => (
							<li key={`${item.url ?? 'result'}-${index}`} className="flex gap-3 px-3 py-2.5 text-xs">
								<span className="shrink-0 font-mono text-gray-400">{index + 1}</span>
								<div className="min-w-0">
									<div className="break-words font-medium text-gray-900 [overflow-wrap:anywhere]">
										{item.title || item.url || '—'}
										{item.siteName && <span className="ml-2 font-normal text-gray-500">{item.siteName}</span>}
									</div>
									{item.url && (
										<a
											href={item.url}
											target="_blank"
											rel="noopener noreferrer"
											className="mt-0.5 block break-all font-mono text-gray-500 hover:text-gray-800 hover:underline"
										>
											{item.url}
										</a>
									)}
									{item.snippet && <p className="mt-1 whitespace-pre-wrap break-words text-gray-600">{item.snippet}</p>}
								</div>
							</li>
						))}
					</ol>
				) : (
					<pre className={`max-h-72 rounded-lg border border-gray-200 bg-white p-3 ${preClass}`}>
						{response.raw == null ? log.raw_usage : JSON.stringify(response.raw, null, 2)}
					</pre>
				)}
			</DataSection>
			<Accounting log={log} currency={currency} />
		</CallShell>
	);
}

function McpCallDetail({ log, identityLabel, currency }: DetailProps) {
	const t = useTranslations('requestLogs.invocation');
	const logs = useTranslations('requestLogs');
	const call = parseMcpInvocationSummary(log);
	const args = parseMcpArguments(log.request_body);
	const result = parseMcpResult(log.raw_usage);
	const failure = classifyMcpFailure(log.error_message);
	const failureHint = t(
		failure === 'toolError'
			? 'failureMcpToolError'
			: failure === 'invalidResult'
				? 'failureMcpInvalidResult'
				: failure === 'timeout'
					? 'failureMcpTimeout'
					: 'failureMcpUpstream'
	);

	return (
		<CallShell log={log} title={t('mcpTitle')} latencyLabel={t('upstreamLatency')} failureHint={failureHint}>
			<Section
				title={t('overview')}
				aside={
					<ConfigLink
						href={call.slug ? `/gateway/mcp?${new URLSearchParams({ server: call.slug })}` : '/gateway/mcp'}
					>
						{t('openMcpServer')}
					</ConfigLink>
				}
			>
				<Fields
					rows={[
						[t('server'), call.slug],
						[t('upstreamTool'), call.tool],
						[logs('detail.identity'), identityLabel],
						[logs('detail.ingressHost'), log.ingress_host],
					]}
				/>
			</Section>
			<DataSection title={t('request')} viewLabel={t('requestView')} raw={log.request_body} rawTitle={t('mcpRequestRaw')}>
				{args === null ? (
					<pre className={`max-h-48 rounded-lg border border-gray-200 bg-white p-3 ${preClass}`}>
						{log.request_body?.trim() || '—'}
					</pre>
				) : args.length === 0 ? (
					<p className={noteClass}>{t('noArguments')}</p>
				) : (
					<ParamList params={args} />
				)}
			</DataSection>
			<DataSection
				title={t('response')}
				viewLabel={t('responseView')}
				raw={log.raw_usage}
				rawTitle={t('mcpResponseRaw')}
				notice={result?.truncated && <p className="mb-3 rounded-lg bg-amber-50 px-3 py-2 text-xs text-amber-800">{t('truncated')}</p>}
				aside={
					result?.isError && (
						<span className="rounded-full bg-red-50 px-2 py-0.5 text-xs font-medium text-red-700">
							{t('upstreamIsError')}
						</span>
					)
				}
			>
				{!result ? (
					<NoResponse log={log} />
				) : (
					<div className="space-y-3">
						{result.blocks.length === 0 && !result.structured && <p className={noteClass}>{t('emptyResult')}</p>}
						{result.blocks.map((block, index) => (
							<div key={index} className="overflow-hidden rounded-lg border border-gray-200 bg-white">
								<div className="flex items-center gap-2 border-b border-gray-100 bg-gray-50 px-3 py-1.5 text-xs text-gray-500">
									<span>{t('contentBlock', { index: index + 1 })}</span>
									<span className="rounded border border-gray-200 bg-white px-1.5 font-mono">
										{block.type === 'text' && block.isJson ? 'text · JSON' : block.type}
									</span>
								</div>
								<pre className={`max-h-72 p-3 ${preClass}`}>{block.text}</pre>
							</div>
						))}
						{result.structured && (
							<div className="overflow-hidden rounded-lg border border-gray-200 bg-white">
								<div className="border-b border-gray-100 bg-gray-50 px-3 py-1.5 text-xs text-gray-500">
									{t('structuredContent')}
								</div>
								<pre className={`max-h-72 p-3 ${preClass}`}>{result.structured}</pre>
							</div>
						)}
					</div>
				)}
			</DataSection>
			<Accounting log={log} currency={currency} />
		</CallShell>
	);
}

export function RequestLogInvocation({ source, ...props }: DetailProps & { source: InvocationSource }) {
	return source === 'mcp' ? <McpCallDetail {...props} /> : <RestCallDetail {...props} />;
}
