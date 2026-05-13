'use client';

/**
 * Playground：选定单条 model_route，编辑 JSON 请求体，直连上游验证连通性（不计费、不入库）。
 */
import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { flushSync } from 'react-dom';
import { PaperAirplaneIcon } from '@heroicons/react/24/outline';
import { readApiJson } from '@/lib/api-json';
import {
	inferPlaygroundParseMode,
	mergeAssistantTextParts,
	type PlaygroundProtocol,
} from '@/lib/playground/merge-assistant-text';
import { parseChargedFactorFromPriceOverride, parseMeteredFactorFromPriceOverride } from '@/lib/pricing-ui';
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

function normalizeProtocol(p: string): PlaygroundProtocol {
	const v = (p || 'openai').trim().toLowerCase();
	if (v === 'anthropic' || v === 'gemini' || v === 'openai') return v;
	return 'openai';
}

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

function tryParseUsageSummary(text: string, protocol: string): string | null {
	const proto = normalizeProtocol(protocol);
	try {
		const parsed = JSON.parse(text) as Record<string, unknown>;
		if (proto === 'gemini') {
			const um = parsed.usageMetadata as Record<string, unknown> | undefined;
			if (um && typeof um === 'object') {
				const parts: string[] = [];
				for (const k of ['promptTokenCount', 'candidatesTokenCount', 'totalTokenCount']) {
					if (typeof um[k] === 'number') parts.push(`${k}: ${um[k]}`);
				}
				return parts.length ? parts.join(', ') : null;
			}
		}
		const u = parsed.usage as Record<string, unknown> | undefined;
		if (u && typeof u === 'object') {
			const pt = u.prompt_tokens ?? u.input_tokens;
			const ct = u.completion_tokens ?? u.output_tokens;
			const tt = u.total_tokens;
			const bits: string[] = [];
			if (typeof pt === 'number') bits.push(`prompt/input: ${pt}`);
			if (typeof ct === 'number') bits.push(`completion/output: ${ct}`);
			if (typeof tt === 'number') bits.push(`total: ${tt}`);
			return bits.length ? bits.join(' · ') : null;
		}
	} catch {
		// ignore
	}
	return null;
}

/** 从单条 SSE JSON 对象中尽量提取 usage 摘要（兼容嵌套与各家字段）。 */
function extractUsageFromStreamChunk(o: Record<string, unknown>, protocol: string): string | null {
	const proto = normalizeProtocol(protocol);
	if (proto === 'gemini' && o.usageMetadata && typeof o.usageMetadata === 'object') {
		return tryParseUsageSummary(JSON.stringify({ usageMetadata: o.usageMetadata }), 'gemini');
	}
	if (o.usage && typeof o.usage === 'object') {
		return tryParseUsageSummary(JSON.stringify({ usage: o.usage }), protocol);
	}
	const msg = o.message;
	if (msg && typeof msg === 'object') {
		const mu = (msg as { usage?: unknown }).usage;
		if (mu && typeof mu === 'object') {
			return tryParseUsageSummary(JSON.stringify({ usage: mu }), protocol);
		}
	}
	const pt = o.prompt_tokens ?? o.input_tokens;
	const ct = o.completion_tokens ?? o.output_tokens;
	const tt = o.total_tokens;
	if (typeof pt === 'number' || typeof ct === 'number') {
		const usage: Record<string, number> = {};
		if (typeof pt === 'number') usage.prompt_tokens = pt;
		if (typeof ct === 'number') usage.completion_tokens = ct;
		if (typeof tt === 'number') usage.total_tokens = tt;
		else if (typeof pt === 'number' && typeof ct === 'number') usage.total_tokens = pt + ct;
		return tryParseUsageSummary(JSON.stringify({ usage }), protocol);
	}
	return null;
}

/** 从 SSE 文本中提取最后一条可解析的 usage（`data:` 允许无空格；自底向上扫描）。 */
function parseLastStreamUsage(sseText: string, protocol: string): string | null {
	const lines = sseText.split(/\r?\n/);
	for (let i = lines.length - 1; i >= 0; i--) {
		const line = lines[i]?.trim() ?? '';
		if (!line.toLowerCase().startsWith('data:')) {
			continue;
		}
		const data = line.slice(5).replace(/^\uFEFF/, '').trim();
		if (data === '[DONE]' || data === '') {
			continue;
		}
		try {
			const o = JSON.parse(data) as Record<string, unknown>;
			const summary = extractUsageFromStreamChunk(o, protocol);
			if (summary) {
				return summary;
			}
		} catch {
			continue;
		}
	}
	return null;
}

export default function PlaygroundPage() {
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

	const filteredRoutes = useMemo(() => {
		return routes.filter((r) => {
			if (filterModel.trim() && !r.model_id.toLowerCase().includes(filterModel.trim().toLowerCase())) {
				return false;
			}
			if (filterProvider.trim()) {
				const q = filterProvider.trim().toLowerCase();
				if (!r.provider_id.toLowerCase().includes(q) && !(r.provider_name ?? '').toLowerCase().includes(q)) {
					return false;
				}
			}
			if (filterProtocol.trim() && !r.upstream_protocol.toLowerCase().includes(filterProtocol.trim().toLowerCase())) {
				return false;
			}
			if (filterGroup.trim() && !r.route_group.toLowerCase().includes(filterGroup.trim().toLowerCase())) {
				return false;
			}
			return true;
		});
	}, [routes, filterModel, filterProvider, filterProtocol, filterGroup]);

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
					setLoadError(data.message ?? 'Failed to load routes');
				}
			} catch (e) {
				if (!cancelled) setLoadError(e instanceof Error ? e.message : 'Failed to load routes');
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
			setBodyError('Select a route first');
			return;
		}
		let bodyObj: Record<string, unknown>;
		try {
			bodyObj = JSON.parse(bodyText) as Record<string, unknown>;
			if (bodyObj === null || typeof bodyObj !== 'object' || Array.isArray(bodyObj)) {
				setBodyError('Body must be a JSON object');
				return;
			}
		} catch {
			setBodyError('Invalid JSON');
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
					if (!msg) msg = 'Request failed';
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
			setBodyError(e instanceof Error ? e.message : 'Request failed');
		} finally {
			setSending(false);
		}
	};

	if (loadingRoutes) {
		return (
			<div className="flex items-center justify-center h-full min-h-[240px]">
				<div className="text-gray-600">Loading...</div>
			</div>
		);
	}

	return (
		<div className="p-8">
			<div className="mb-6">
				<h1 className="text-3xl font-bold text-gray-900">Gateway Playground</h1>
				<p className="text-sm text-gray-500 mt-1">
					Send one upstream request for a single model route. No API key billing, no api_key_request_logs, no failover.
					<span className="text-gray-400"> · </span>
					Usage shown below is display-only.
				</p>
			</div>

			{loadError ? (
				<div className="p-3 bg-red-50 border border-red-200 rounded-md text-red-600 text-sm max-w-3xl">{loadError}</div>
			) : (
				<div className="flex flex-col gap-6">
					<div className="grid grid-cols-1 xl:grid-cols-2 xl:items-stretch gap-6">
						<div className="min-w-0 flex flex-col h-full">
							<div className="bg-white rounded-lg shadow-md p-6 space-y-4 flex flex-col h-full min-h-0">
							<h2 className="text-lg font-semibold text-gray-900 border-b border-gray-100 pb-3">Route</h2>
							<div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
								<div>
									<label className={labelClass}>model id</label>
									<input
										type="text"
										placeholder="Contains…"
										value={filterModel}
										onChange={(e) => setFilterModel(e.target.value)}
										className={inputClass}
									/>
								</div>
								<div>
									<label className={labelClass}>provider</label>
									<input
										type="text"
										placeholder="id or name contains…"
										value={filterProvider}
										onChange={(e) => setFilterProvider(e.target.value)}
										className={inputClass}
									/>
								</div>
								<div>
									<label className={labelClass}>protocol</label>
									<input
										type="text"
										placeholder="openai, anthropic, …"
										value={filterProtocol}
										onChange={(e) => setFilterProtocol(e.target.value)}
										className={inputClass}
									/>
								</div>
								<div>
									<label className={labelClass}>route group</label>
									<input
										type="text"
										placeholder="default, free, …"
										value={filterGroup}
										onChange={(e) => setFilterGroup(e.target.value)}
										className={inputClass}
									/>
								</div>
							</div>
							<div>
								<label className={labelClass}>Select route</label>
								<select
									value={selectedId}
									onChange={(e) => setSelectedId(e.target.value)}
									className={`${inputClass} font-mono`}
									size={Math.min(10, Math.max(6, Math.min(filteredRoutes.length, 10) || 6))}
								>
									<option value="">— Select a route —</option>
									{filteredRoutes.map((r) => (
										<option key={r.id} value={r.id}>
											{routeActiveIndicator(r.status)} {formatRouteLabel(r)} · {r.id.slice(0, 8)}…
										</option>
									))}
								</select>
								<p className="mt-2 text-xs text-gray-500">
									{routes.length} route(s) total · {filteredRoutes.length} after filters
								</p>
							</div>
							</div>
						</div>

						<div className="min-w-0 flex flex-col h-full">
							<div className="bg-white rounded-lg shadow-md p-6 space-y-4 flex flex-col h-full min-h-0">
							<h2 className="text-lg font-semibold text-gray-900 border-b border-gray-100 pb-3">Selected route</h2>
							{selected ? (
								<>
									<div className="grid grid-cols-1 sm:grid-cols-2 gap-x-6 gap-y-3">
										<ReadonlyField label="Model ID">{selected.model_id}</ReadonlyField>
										<ReadonlyField label="Model name">{selected.model_name ?? '—'}</ReadonlyField>
										<ReadonlyField label="Provider ID">{selected.provider_id}</ReadonlyField>
										<ReadonlyField label="Provider name">{selected.provider_name ?? '—'}</ReadonlyField>
										<ReadonlyField label="Upstream protocol">{selected.upstream_protocol}</ReadonlyField>
										<ReadonlyField label="Provider model">{selected.provider_model_name}</ReadonlyField>
										<ReadonlyField label="Route group">{selected.route_group}</ReadonlyField>
										<ReadonlyField label="Priority / status">
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
										<ReadonlyField label="Charged factor (× catalog)">
											{(() => {
												const n = parseChargedFactorFromPriceOverride(selected.price_override);
												return n != null && Number.isFinite(n) ? String(n) : '—';
											})()}
										</ReadonlyField>
										<ReadonlyField label="Metered factor (× catalog)">
											{(() => {
												const n = parseMeteredFactorFromPriceOverride(selected.price_override);
												return n != null && Number.isFinite(n) ? String(n) : '—';
											})()}
										</ReadonlyField>
										<ReadonlyField label="Route ID">
											<code className="text-xs bg-gray-100 px-1.5 py-0.5 rounded">{selected.id}</code>
										</ReadonlyField>
									</div>
									<div className="space-y-3 pt-3 border-t border-gray-100">
										<div>
											<div className="block text-xs font-medium text-gray-600 mb-1">custom_params</div>
											<pre className={codeBlockClass}>{formatRouteJsonColumn(selected.custom_params)}</pre>
										</div>
										<div>
											<div className="block text-xs font-medium text-gray-600 mb-1">price_override</div>
											<pre className={codeBlockClass}>{formatRouteJsonColumn(selected.price_override)}</pre>
										</div>
									</div>
								</>
							) : (
								<p className="text-sm text-gray-500">Choose a route above to see catalog fields.</p>
							)}
						</div>
						</div>
					</div>

					<div className="grid grid-cols-1 xl:grid-cols-2 gap-6">
						<div className="min-w-0">
						<div className="bg-white rounded-lg shadow-md p-6 space-y-4">
							<div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-3 border-b border-gray-100 pb-3">
								<h2 className="text-lg font-semibold text-gray-900">Request body</h2>
								<button
									type="button"
									onClick={() => void send()}
									disabled={sending || !selected}
									className="inline-flex items-center justify-center gap-2 px-4 py-2 bg-blue-600 text-white text-sm font-medium rounded-md hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-blue-500 disabled:opacity-50 disabled:cursor-not-allowed shrink-0"
								>
									<PaperAirplaneIcon className="h-4 w-4" />
									{sending ? 'Sending…' : 'Send'}
								</button>
							</div>
							{normalizeProtocol(selected?.upstream_protocol ?? 'openai') === 'gemini' && (
								<fieldset className="flex flex-wrap items-center gap-4 text-sm border border-gray-200 rounded-md px-3 py-2">
									<legend className="sr-only">Gemini action</legend>
									<span className="text-gray-600 font-medium">Gemini action</span>
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
											实际发送的请求体
											<span className="font-normal text-gray-500 normal-case tracking-normal">
												{' '}
												（服务端合并 <code className="text-[11px] bg-gray-100 px-1 rounded">custom_params</code> 并写入{' '}
												<code className="text-[11px] bg-gray-100 px-1 rounded">model</code> 等与上游一致的 JSON）
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
								<h2 className="text-lg font-semibold text-gray-900 shrink-0">Response</h2>
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
											<span className="font-medium text-gray-600">Upstream: </span>
											{responseMeta.upstreamUrl}
										</div>
									)}
									{usageHint && (
										<div className="p-3 rounded-md bg-green-50 border border-green-200 text-sm text-green-900">
											<span className="font-semibold">Usage (display only): </span>
											{usageHint}
										</div>
									)}
									<div className="space-y-3">
										<div>
											<div className="text-xs font-medium text-gray-600 mb-1">拼接内容</div>
											<div className="rounded-md border border-slate-200 overflow-hidden divide-y divide-slate-200">
												<div>
													<div className="text-[11px] font-semibold text-amber-900/85 uppercase tracking-wide px-3 py-1.5 bg-amber-50 border-b border-amber-100">
														推理 / Thinking
													</div>
													<pre className="max-h-[min(220px,32vh)] overflow-auto p-3 bg-amber-50/60 text-sm text-gray-900 font-mono whitespace-pre-wrap break-words">
														{mergedReasoningDisplay}
													</pre>
												</div>
												<div>
													<div className="text-[11px] font-semibold text-slate-600 uppercase tracking-wide px-3 py-1.5 bg-slate-50 border-b border-slate-100">
														正文
													</div>
													<pre className="max-h-[min(280px,38vh)] overflow-auto p-3 bg-slate-50 text-sm text-gray-900 font-mono whitespace-pre-wrap break-words">
														{mergedBodyDisplay}
														<span ref={mergedStreamEndRef} className="inline-block w-0 h-0 overflow-hidden" aria-hidden />
													</pre>
												</div>
											</div>
										</div>
										<div>
											<div className="text-xs font-medium text-gray-600 mb-1">原始报文</div>
											<pre className="max-h-[min(520px,50vh)] overflow-auto p-4 bg-gray-50 border border-gray-200 rounded-md text-xs text-gray-900 font-mono whitespace-pre-wrap break-words">
												{responseText}
												<span ref={streamEndRef} className="inline-block w-0 h-0 overflow-hidden" aria-hidden />
											</pre>
										</div>
									</div>
								</>
							) : (
								<p className="text-sm text-gray-500">Run Send to see upstream status, headers, and body or stream output here.</p>
							)}
						</div>
						</div>
					</div>
				</div>
			)}
		</div>
	);
}
