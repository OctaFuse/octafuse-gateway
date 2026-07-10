'use client';

/**
 * Playground：选定单条 model_route，编辑 JSON 请求体，直连上游验证连通性（不计费、不入库）。
 */
import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { useTranslations } from 'next-intl';
import { flushSync } from 'react-dom';
import { PaperAirplaneIcon } from '@heroicons/react/24/outline';
import { readApiJson } from '@/lib/api-json';
import {
	inferPlaygroundParseMode,
	mergeAssistantTextParts,
	type PlaygroundProtocol,
} from '@/lib/playground/merge-assistant-text';
import {
	normalizeProtocol,
	parseLastStreamUsage,
	tryParseUsageSummary,
} from '@/lib/playground/usage-parsing';
import type { ApiResponse } from '@/lib/types';

const inputClass =
	'w-full px-3 py-2 border border-gray-300 rounded-md text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 bg-white';
const labelClass = 'block text-xs font-medium text-gray-500 uppercase tracking-wider mb-1';

function ReadonlyField({ label, children }: { label: string; children: ReactNode }) {
	return (
		<div className="min-w-0">
			<div className="text-xs font-medium text-gray-500">{label}</div>
			<div className="mt-0.5 text-sm text-gray-900 break-words">{children}</div>
		</div>
	);
}

type RouteListRow = {
	id: string;
	model_id: string;
	provider_id: string;
	provider_model_name: string;
	priority: number;
	status: string;
	route_group: string;
	price_override: string | null;
	custom_params: string | null;
	upstream_protocol: string;
	model_name: string | null;
	provider_name: string | null;
};

const BODY_TEMPLATES: Record<string, string> = {
	openai: `{
  "messages": [{ "role": "user", "content": "Hello" }],
  "max_tokens": 256,
  "stream": true,
  "stream_options": { "include_usage": true }
}`,
	anthropic: `{
  "messages": [{ "role": "user", "content": "Hello" }],
  "max_tokens": 256,
  "stream": true
}`,
	gemini: `{
  "contents": [{ "role": "user", "parts": [{ "text": "Hello" }] }]
}`,
};

function formatRouteLabel(r: RouteListRow): string {
	const m = r.model_name || r.model_id;
	const p = r.provider_name || r.provider_id;
	return `${m} · ${p} · ${r.provider_model_name} · ${r.route_group} · ${r.upstream_protocol}`;
}

/** 下拉项开头：active → 🟢，否则 🔴（不拼 status 文案，避免与 emoji 重复）。 */
function routeActiveIndicator(status: string): string {
	return status.trim().toLowerCase() === 'active' ? '🟢' : '🔴';
}

/** 路由表 JSON 列：可解析则 pretty-print，否则原文。 */
function formatRouteJsonColumn(raw: string | null | undefined): string {
	if (raw == null || String(raw).trim() === '') {
		return '—';
	}
	const t = String(raw).trim();
	try {
		return JSON.stringify(JSON.parse(t), null, 2);
	} catch {
		return t;
	}
}

const codeBlockClass =
	'p-3 text-xs overflow-x-auto whitespace-pre-wrap bg-gray-50 border border-gray-200 rounded-md font-mono text-gray-900';

/** Route 卡片内 JSON 预览：限制高度避免长内容撑满视口 */
const routeJsonPreClass = `${codeBlockClass} max-h-56 overflow-y-auto`;

function decodeWireRequestBodyHeader(res: Response): string | null {
	const raw = res.headers.get('x-playground-request-body');
	if (raw == null || raw === '') return null;
	try {
		const decoded = decodeURIComponent(raw);
		try {
			return JSON.stringify(JSON.parse(decoded), null, 2);
		} catch {
			return decoded;
		}
	} catch {
		return '（无法解码 x-playground-request-body）';
	}
}

export default function PlaygroundPage() {
	const t = useTranslations('playground');
	const tBrand = useTranslations('brand');
	const tCommon = useTranslations('common');
	const [routes, setRoutes] = useState<RouteListRow[]>([]);
	const [loadingRoutes, setLoadingRoutes] = useState(true);
	const [loadError, setLoadError] = useState<string | null>(null);

	const [filterModel, setFilterModel] = useState('');
	const [filterProvider, setFilterProvider] = useState('');
	const [filterProtocol, setFilterProtocol] = useState('');
	const [filterGroup, setFilterGroup] = useState('');

	const [selectedId, setSelectedId] = useState('');
	const [bodyText, setBodyText] = useState(BODY_TEMPLATES.openai);
	const [bodyError, setBodyError] = useState<string | null>(null);
	const [geminiAction, setGeminiAction] = useState<'generateContent' | 'streamGenerateContent'>('streamGenerateContent');

	const [sending, setSending] = useState(false);
	const [responseMeta, setResponseMeta] = useState<{
		status: number;
		latencyMs: string | null;
		upstreamUrl: string | null;
		contentType: string | null;
	} | null>(null);
	const [responseText, setResponseText] = useState('');
	/** 与最后一次 Send 时的路由协议一致，避免切换下拉后拼接错乱 */
	const [responseProtocol, setResponseProtocol] = useState<PlaygroundProtocol>('openai');
	const [usageHint, setUsageHint] = useState<string | null>(null);
	/** Send 成功后由响应头 `x-playground-request-body` 解析（服务端合并后的实际上游 JSON）。 */
	const [lastSentWireBody, setLastSentWireBody] = useState<string | null>(null);
	const streamEndRef = useRef<HTMLSpanElement>(null);
	const mergedStreamEndRef = useRef<HTMLSpanElement>(null);

	const selected = useMemo(
		() => routes.find((r) => r.id === selectedId) ?? null,
		[routes, selectedId]
	);

	const mergedAssistantParts = useMemo(() => {
		const mode = inferPlaygroundParseMode(responseMeta?.contentType ?? null);
		if (!responseText.trim() || !mode) {
			return { reasoning: '', body: '' };
		}
		return mergeAssistantTextParts(responseText, responseProtocol, mode);
	}, [responseText, responseProtocol, responseMeta?.contentType]);

	const { mergedReasoningDisplay, mergedBodyDisplay } = useMemo(() => {
		const hasRaw = responseText.trim().length > 0;
		const p = mergedAssistantParts;
		const reasoningDisplay =
			p.reasoning ||
			(sending && hasRaw ? '（接收中…）' : '') ||
			(!sending && hasRaw && !p.reasoning ? '—' : '');
		const bodyDisplay =
			p.body ||
			(sending && hasRaw ? '（接收中…）' : '') ||
			(!sending && hasRaw && !p.body ? (!p.reasoning ? '（无法从报文提取正文）' : '—') : '');
		return { mergedReasoningDisplay: reasoningDisplay, mergedBodyDisplay: bodyDisplay };
	}, [mergedAssistantParts, responseText, sending]);

	const matchesFilters = useCallback(
		(
			r: RouteListRow,
			omit: 'model' | 'provider' | 'protocol' | 'group' | null = null
		) => {
			if (omit !== 'model' && filterModel && r.model_id !== filterModel) return false;
			if (omit !== 'provider' && filterProvider && r.provider_id !== filterProvider) return false;
			if (omit !== 'protocol' && filterProtocol && r.upstream_protocol !== filterProtocol) return false;
			if (omit !== 'group' && filterGroup && r.route_group !== filterGroup) return false;
			return true;
		},
		[filterModel, filterProvider, filterProtocol, filterGroup]
	);

	const filteredRoutes = useMemo(
		() => routes.filter((r) => matchesFilters(r)),
		[routes, matchesFilters]
	);

	/** Model 下拉：按当前其它筛选项联动（不含 model 自身）。 */
	const modelOptions = useMemo(() => {
		const pool = routes.filter((r) => matchesFilters(r, 'model'));
		const byId = new Map<string, { id: string; label: string }>();
		for (const r of pool) {
			if (byId.has(r.model_id)) continue;
			const name = (r.model_name ?? '').trim();
			byId.set(r.model_id, {
				id: r.model_id,
				label: name && name !== r.model_id ? `${name} (${r.model_id})` : r.model_id,
			});
		}
		return [...byId.values()].sort((a, b) => a.label.localeCompare(b.label));
	}, [routes, matchesFilters]);

	/** Provider 下拉：按当前其它筛选项联动（不含 provider 自身）。 */
	const providerOptions = useMemo(() => {
		const pool = routes.filter((r) => matchesFilters(r, 'provider'));
		const byId = new Map<string, { id: string; label: string }>();
		for (const r of pool) {
			if (byId.has(r.provider_id)) continue;
			const name = (r.provider_name ?? '').trim();
			byId.set(r.provider_id, {
				id: r.provider_id,
				label: name && name !== r.provider_id ? `${name} (${r.provider_id})` : r.provider_id,
			});
		}
		return [...byId.values()].sort((a, b) => a.label.localeCompare(b.label));
	}, [routes, matchesFilters]);

	const protocolOptions = useMemo(() => {
		const set = new Set<string>();
		for (const r of routes) {
			if (!matchesFilters(r, 'protocol')) continue;
			if (r.upstream_protocol) set.add(r.upstream_protocol);
		}
		return [...set].sort((a, b) => a.localeCompare(b));
	}, [routes, matchesFilters]);

	const groupOptions = useMemo(() => {
		const set = new Set<string>();
		for (const r of routes) {
			if (!matchesFilters(r, 'group')) continue;
			if (r.route_group) set.add(r.route_group);
		}
		return [...set].sort((a, b) => a.localeCompare(b));
	}, [routes, matchesFilters]);

	useEffect(() => {
		if (filterModel && !modelOptions.some((o) => o.id === filterModel)) {
			setFilterModel('');
		}
	}, [filterModel, modelOptions]);

	useEffect(() => {
		if (filterProvider && !providerOptions.some((o) => o.id === filterProvider)) {
			setFilterProvider('');
		}
	}, [filterProvider, providerOptions]);

	useEffect(() => {
		if (filterProtocol && !protocolOptions.includes(filterProtocol)) {
			setFilterProtocol('');
		}
	}, [filterProtocol, protocolOptions]);

	useEffect(() => {
		if (filterGroup && !groupOptions.includes(filterGroup)) {
			setFilterGroup('');
		}
	}, [filterGroup, groupOptions]);

	useEffect(() => {
		if (selectedId && !filteredRoutes.some((r) => r.id === selectedId)) {
			setSelectedId('');
		}
	}, [selectedId, filteredRoutes]);

	useEffect(() => {
		let cancelled = false;
		(async () => {
			setLoadingRoutes(true);
			setLoadError(null);
			try {
				const res = await fetch('/api/admin/routes');
				const data = await readApiJson<RouteListRow[]>(res);
				if (cancelled) return;
				if (data.success && Array.isArray(data.data)) {
					setRoutes(data.data);
				} else {
					setLoadError(data.message ?? tCommon('failedToLoadRoutes'));
				}
			} catch (e) {
				if (!cancelled) setLoadError(e instanceof Error ? e.message : tCommon('failedToLoadRoutes'));
			} finally {
				if (!cancelled) setLoadingRoutes(false);
			}
		})();
		return () => {
			cancelled = true;
		};
	}, []);

	useEffect(() => {
		const r = routes.find((x) => x.id === selectedId);
		if (!r) return;
		const proto = normalizeProtocol(r.upstream_protocol);
		setBodyText(BODY_TEMPLATES[proto] ?? BODY_TEMPLATES.openai);
		setBodyError(null);
	}, [selectedId, routes]);

	const scrollStreamToBottom = useCallback(() => {
		streamEndRef.current?.scrollIntoView({ behavior: 'smooth' });
		mergedStreamEndRef.current?.scrollIntoView({ behavior: 'smooth' });
	}, []);

	const send = async () => {
		if (!selected) {
			setBodyError(tCommon('selectRouteFirst'));
			return;
		}
		let bodyObj: Record<string, unknown>;
		try {
			bodyObj = JSON.parse(bodyText) as Record<string, unknown>;
			if (bodyObj === null || typeof bodyObj !== 'object' || Array.isArray(bodyObj)) {
				setBodyError(tCommon('bodyMustBeJsonObject'));
				return;
			}
		} catch {
			setBodyError(tCommon('invalidJson'));
			return;
		}
		setBodyError(null);
		setSending(true);
		setResponseText('');
		setUsageHint(null);
		setResponseMeta(null);
		setLastSentWireBody(null);

		const proto = normalizeProtocol(selected.upstream_protocol);
		setResponseProtocol(proto);
		const payload: {
			routeId: string;
			body: Record<string, unknown>;
			geminiAction?: 'generateContent' | 'streamGenerateContent';
		} = { routeId: selected.id, body: bodyObj };
		if (proto === 'gemini') {
			payload.geminiAction = geminiAction;
		}

		try {
			const res = await fetch('/api/admin/playground', {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify(payload),
			});

			const latencyMs = res.headers.get('x-playground-latency-ms');
			const upstreamUrl = res.headers.get('x-playground-upstream-url');
			const ct = res.headers.get('Content-Type') ?? '';

			setLastSentWireBody(decodeWireRequestBodyHeader(res));

			setResponseMeta({
				status: res.status,
				latencyMs,
				upstreamUrl,
				contentType: ct,
			});

			const jsonErr = ct.includes('application/json') && !ct.includes('text/event-stream');
			if (jsonErr) {
				const j = (await res.json()) as ApiResponse<unknown> & {
					error?: string | { message?: string };
					message?: string;
				};
				setResponseText(JSON.stringify(j, null, 2));
				if (!res.ok) {
					setUsageHint(null);
					const errObj = j.error;
					const nested =
						errObj && typeof errObj === 'object' && 'message' in errObj
							? String((errObj as { message?: unknown }).message ?? '')
							: '';
					let msg = (j.message ?? '').trim();
					if (!msg && typeof errObj === 'string') msg = errObj;
					if (!msg) msg = nested.trim();
					if (!msg) msg = tCommon('requestFailed');
					setBodyError(msg);
				} else {
					const summary = tryParseUsageSummary(JSON.stringify(j), proto);
					setUsageHint(summary);
				}
				setSending(false);
				return;
			}

			if (ct.includes('text/event-stream') && res.body) {
				const reader = res.body.getReader();
				const dec = new TextDecoder();
				let acc = '';
				while (true) {
					const { done, value } = await reader.read();
					if (done) break;
					acc += dec.decode(value, { stream: true });
					// 避免 React 18 批处理把多次更新合成一次渲染，导致「拼接内容」只在流结束后才出现
					flushSync(() => {
						setResponseText(acc);
					});
					scrollStreamToBottom();
				}
				acc += dec.decode();
				flushSync(() => {
					setResponseText(acc);
				});
				setUsageHint(parseLastStreamUsage(acc, proto));
				setSending(false);
				return;
			}

			const text = await res.text();
			setResponseText(text);
			let summary: string | null = null;
			try {
				summary = tryParseUsageSummary(text, proto);
			} catch {
				summary = null;
			}
			setUsageHint(summary);
		} catch (e) {
			setResponseText('');
			setBodyError(e instanceof Error ? e.message : tCommon('requestFailed'));
		} finally {
			setSending(false);
		}
	};

	if (loadingRoutes) {
		return (
			<div className="flex items-center justify-center h-full min-h-[240px]">
				<div className="text-gray-600">{tCommon('loading')}</div>
			</div>
		);
	}

	return (
		<div className="p-8">
			<div className="mb-6">
				<h1 className="text-3xl font-bold text-gray-900">{t('title')}</h1>
				<p className="text-sm text-gray-500 mt-1">
					{t('subtitle', { product: tBrand('product') })}
					<span className="text-gray-400"> · </span>
					{t('usageNote')}
				</p>
			</div>

			{loadError ? (
				<div className="p-3 bg-red-50 border border-red-200 rounded-md text-red-600 text-sm max-w-3xl">{loadError}</div>
			) : (
				<div className="flex flex-col gap-6">
					<div className="grid grid-cols-1 xl:grid-cols-2 xl:items-stretch gap-6">
						<div className="min-w-0 flex flex-col h-full">
							<div className="bg-white rounded-lg shadow-md p-6 space-y-4 flex flex-col h-full min-h-0">
							<h2 className="text-lg font-semibold text-gray-900 border-b border-gray-100 pb-3">{t('routeSection')}</h2>
							<div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
								<div>
									<label className={labelClass}>{t('modelId')}</label>
									<select
										value={filterModel}
										onChange={(e) => setFilterModel(e.target.value)}
										className={inputClass}
									>
										<option value="">{t('placeholders.allModels')}</option>
										{modelOptions.map((o) => (
											<option key={o.id} value={o.id}>
												{o.label}
											</option>
										))}
									</select>
								</div>
								<div>
									<label className={labelClass}>{t('provider')}</label>
									<select
										value={filterProvider}
										onChange={(e) => setFilterProvider(e.target.value)}
										className={inputClass}
									>
										<option value="">{t('placeholders.allProviders')}</option>
										{providerOptions.map((o) => (
											<option key={o.id} value={o.id}>
												{o.label}
											</option>
										))}
									</select>
								</div>
								<div>
									<label className={labelClass}>{t('protocol')}</label>
									<select
										value={filterProtocol}
										onChange={(e) => setFilterProtocol(e.target.value)}
										className={inputClass}
									>
										<option value="">{t('placeholders.allProtocols')}</option>
										{protocolOptions.map((p) => (
											<option key={p} value={p}>
												{p}
											</option>
										))}
									</select>
								</div>
								<div>
									<label className={labelClass}>{t('routeGroup')}</label>
									<select
										value={filterGroup}
										onChange={(e) => setFilterGroup(e.target.value)}
										className={inputClass}
									>
										<option value="">{t('placeholders.allRouteGroups')}</option>
										{groupOptions.map((g) => (
											<option key={g} value={g}>
												{g}
											</option>
										))}
									</select>
								</div>
							</div>
							<div>
								<label className={labelClass}>{t('selectRoute')}</label>
								<select
									value={selectedId}
									onChange={(e) => setSelectedId(e.target.value)}
									className={`${inputClass} font-mono`}
									size={Math.min(10, Math.max(6, Math.min(filteredRoutes.length, 10) || 6))}
								>
									<option value="">{t('selectRouteOption')}</option>
									{filteredRoutes.map((r) => (
										<option key={r.id} value={r.id}>
											{routeActiveIndicator(r.status)} {formatRouteLabel(r)} · {r.id.slice(0, 8)}…
										</option>
									))}
								</select>
								<p className="mt-2 text-xs text-gray-500">
									{t('routeCount', { total: routes.length, filtered: filteredRoutes.length })}
								</p>
							</div>
							</div>
						</div>

						<div className="min-w-0 flex flex-col h-full">
							<div className="bg-white rounded-lg shadow-md p-6 space-y-4 flex flex-col h-full min-h-0">
							<h2 className="text-lg font-semibold text-gray-900 border-b border-gray-100 pb-3 break-words">
								{selected ? (
									<>
										{t('selected')}：<span className="font-mono text-base font-normal">{selected.id}</span>
									</>
								) : (
									t('selectedRoute')
								)}
							</h2>
							{selected ? (
								<>
									<div className="grid grid-cols-1 sm:grid-cols-2 gap-x-6 gap-y-3">
										<ReadonlyField label={t('modelId')}>{selected.model_id}</ReadonlyField>
										<ReadonlyField label={t('modelName')}>{selected.model_name ?? '—'}</ReadonlyField>
										<ReadonlyField label={t('providerId')}>{selected.provider_id}</ReadonlyField>
										<ReadonlyField label={t('providerName')}>{selected.provider_name ?? '—'}</ReadonlyField>
										<ReadonlyField label={t('upstreamProtocol')}>{selected.upstream_protocol}</ReadonlyField>
										<ReadonlyField label={t('providerModel')}>{selected.provider_model_name}</ReadonlyField>
										<ReadonlyField label={t('routeGroup')}>{selected.route_group}</ReadonlyField>
										<ReadonlyField label={t('priorityStatus')}>
											{selected.priority} /{' '}
											<span
												className={
													selected.status === 'active'
														? 'text-green-700 font-medium'
														: 'text-amber-700 font-medium'
												}
											>
												{selected.status}
											</span>
										</ReadonlyField>
									</div>
									<div className="grid grid-cols-1 sm:grid-cols-2 gap-3 pt-3 border-t border-gray-100 min-w-0">
										<div className="min-w-0 flex flex-col">
											<div className="block text-xs font-medium text-gray-600 mb-1">custom_params</div>
											<pre className={routeJsonPreClass}>{formatRouteJsonColumn(selected.custom_params)}</pre>
										</div>
										<div className="min-w-0 flex flex-col">
											<div className="block text-xs font-medium text-gray-600 mb-1">price_override</div>
											<pre className={routeJsonPreClass}>{formatRouteJsonColumn(selected.price_override)}</pre>
										</div>
									</div>
								</>
							) : (
								<p className="text-sm text-gray-500">{t('chooseRouteHint')}</p>
							)}
						</div>
						</div>
					</div>

					<div className="grid grid-cols-1 xl:grid-cols-2 gap-6">
						<div className="min-w-0">
						<div className="bg-white rounded-lg shadow-md p-6 space-y-4">
							<div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-3 border-b border-gray-100 pb-3">
								<h2 className="text-lg font-semibold text-gray-900">{t('requestBody')}</h2>
								<button
									type="button"
									onClick={() => void send()}
									disabled={sending || !selected}
									className="inline-flex items-center justify-center gap-2 px-4 py-2 bg-blue-600 text-white text-sm font-medium rounded-md hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-blue-500 disabled:opacity-50 disabled:cursor-not-allowed shrink-0"
								>
									<PaperAirplaneIcon className="h-4 w-4" />
									{sending ? tCommon('sending') : tCommon('send')}
								</button>
							</div>
							{normalizeProtocol(selected?.upstream_protocol ?? 'openai') === 'gemini' && (
								<fieldset className="flex flex-wrap items-center gap-4 text-sm border border-gray-200 rounded-md px-3 py-2">
									<legend className="sr-only">{t('geminiAction')}</legend>
									<span className="text-gray-600 font-medium">{t('geminiAction')}</span>
									<label className="inline-flex items-center gap-2 cursor-pointer">
										<input
											type="radio"
											name="geminiAction"
											className="text-blue-600 focus:ring-blue-500"
											checked={geminiAction === 'generateContent'}
											onChange={() => setGeminiAction('generateContent')}
										/>
										generateContent
									</label>
									<label className="inline-flex items-center gap-2 cursor-pointer">
										<input
											type="radio"
											name="geminiAction"
											checked={geminiAction === 'streamGenerateContent'}
											onChange={() => setGeminiAction('streamGenerateContent')}
										/>
										streamGenerateContent
									</label>
								</fieldset>
							)}
							<div>
								<label className={labelClass}>JSON</label>
								<textarea
									value={bodyText}
									onChange={(e) => setBodyText(e.target.value)}
									rows={8}
									className={`${inputClass} font-mono text-sm min-h-[100px]`}
									spellCheck={false}
								/>
							</div>
							{bodyError && (
								<div className="p-3 bg-red-50 border border-red-200 rounded-md text-red-600 text-sm">{bodyError}</div>
							)}
							{lastSentWireBody != null && lastSentWireBody !== '' && (
								<div className="pt-2 border-t border-gray-100 space-y-2">
									<div>
										<div className="text-xs font-medium text-gray-600 mb-1">
											{t('sentBody')}
											<span className="font-normal text-gray-500 normal-case tracking-normal">
												{' '}
												{t('sentBodyHint')}
											</span>
										</div>
										<pre className={codeBlockClass}>{lastSentWireBody}</pre>
									</div>
								</div>
							)}
						</div>
						</div>

						<div className="min-w-0">
						<div className="bg-white rounded-lg shadow-md p-6 space-y-4">
							<div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-2 border-b border-gray-100 pb-3">
								<h2 className="text-lg font-semibold text-gray-900 shrink-0">{t('response')}</h2>
								{responseMeta && (
									<div className="flex flex-wrap items-center justify-end gap-2 text-xs min-w-0">
										<span className="inline-flex items-center rounded-full bg-gray-100 px-2.5 py-1 font-medium text-gray-800">
											HTTP {responseMeta.status}
										</span>
										{responseMeta.latencyMs != null && (
											<span className="inline-flex items-center rounded-full bg-gray-100 px-2.5 py-1 font-medium text-gray-800">
												{responseMeta.latencyMs} ms
											</span>
										)}
										{responseMeta.contentType && (
											<span className="inline-flex items-center rounded-full bg-gray-100 px-2.5 py-1 font-medium text-gray-700 max-w-full truncate" title={responseMeta.contentType}>
												{responseMeta.contentType}
											</span>
										)}
									</div>
								)}
							</div>
							{responseMeta || responseText ? (
								<>
									{responseMeta?.upstreamUrl && (
										<div className="text-xs text-gray-500 break-all">
											<span className="font-medium text-gray-600">{t('upstream')}</span>
											{responseMeta.upstreamUrl}
										</div>
									)}
									{usageHint && (
										<div className="p-3 rounded-md bg-green-50 border border-green-200 text-sm text-green-900">
											<span className="font-semibold">{t('usageDisplayOnly')}</span>
											{usageHint}
										</div>
									)}
									<div className="space-y-3">
										<div>
											<div className="text-xs font-medium text-gray-600 mb-1">{t('mergedContent')}</div>
											<div className="rounded-md border border-slate-200 overflow-hidden divide-y divide-slate-200">
												<div>
													<div className="text-[11px] font-semibold text-amber-900/85 uppercase tracking-wide px-3 py-1.5 bg-amber-50 border-b border-amber-100">
														{t('thinking')}
													</div>
													<pre className="max-h-[min(220px,32vh)] overflow-auto p-3 bg-amber-50/60 text-sm text-gray-900 font-mono whitespace-pre-wrap break-words">
														{mergedReasoningDisplay}
													</pre>
												</div>
												<div>
													<div className="text-[11px] font-semibold text-slate-600 uppercase tracking-wide px-3 py-1.5 bg-slate-50 border-b border-slate-100">
														{t('body')}
													</div>
													<pre className="max-h-[min(280px,38vh)] overflow-auto p-3 bg-slate-50 text-sm text-gray-900 font-mono whitespace-pre-wrap break-words">
														{mergedBodyDisplay}
														<span ref={mergedStreamEndRef} className="inline-block w-0 h-0 overflow-hidden" aria-hidden />
													</pre>
												</div>
											</div>
										</div>
										<div>
											<div className="text-xs font-medium text-gray-600 mb-1">{t('rawPayload')}</div>
											<pre className="max-h-[min(520px,50vh)] overflow-auto p-4 bg-gray-50 border border-gray-200 rounded-md text-xs text-gray-900 font-mono whitespace-pre-wrap break-words">
												{responseText}
												<span ref={streamEndRef} className="inline-block w-0 h-0 overflow-hidden" aria-hidden />
											</pre>
										</div>
									</div>
								</>
							) : (
								<p className="text-sm text-gray-500">{t('emptyResponseHint')}</p>
							)}
						</div>
						</div>
					</div>
				</div>
			)}
		</div>
	);
}
