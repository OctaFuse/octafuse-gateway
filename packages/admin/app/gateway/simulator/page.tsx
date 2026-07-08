'use client';

/**
 * Browser-side simulator: calls the Proxy directly (user-provided Base URL) with a real API key,
 * exercising auth, routing, billing, and request logs (unlike Playground upstream tests).
 */
import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { useTranslations } from 'next-intl';
import { flushSync } from 'react-dom';
import { PaperAirplaneIcon, StopIcon } from '@heroicons/react/24/outline';
import { readApiJson } from '@/lib/api-json';
import {
	inferPlaygroundParseMode,
	mergeAssistantTextParts,
	type PlaygroundProtocol,
} from '@/lib/playground/merge-assistant-text';
import { normalizeProtocol, parseLastStreamUsage, tryParseUsageSummary } from '@/lib/playground/usage-parsing';
import {
	buildSimulatorRequest,
	type SimulatorGeminiAction,
	type SimulatorProtocol,
} from '@/lib/simulator/endpoint';
import type { AdminKeyListItem, AdminModelRow } from '@/lib/services/admin/types';
import type { ApiResponse } from '@/lib/types';

const LS_PROXY = 'octafuse.simulator.proxyBaseUrl';
const LS_PROTOCOL = 'octafuse.simulator.protocol';
const LS_MODEL_ID = 'octafuse.simulator.modelId';
const LS_ROUTE_GROUP = 'octafuse.simulator.routeGroup';

const inputClass =
	'w-full px-3 py-2 border border-gray-300 rounded-md text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 bg-white';
const labelClass = 'block text-xs font-medium text-gray-500 uppercase tracking-wider mb-1';

const BODY_TEMPLATES: Record<SimulatorProtocol, string> = {
	openai: `{
  "model": "<auto>",
  "messages": [{ "role": "user", "content": "Hello" }],
  "max_tokens": 256,
  "stream": true,
  "stream_options": { "include_usage": true }
}`,
	anthropic: `{
  "model": "<auto>",
  "messages": [{ "role": "user", "content": "Hello" }],
  "max_tokens": 256,
  "stream": true
}`,
	gemini: `{
  "contents": [{ "role": "user", "parts": [{ "text": "Hello" }] }]
}`,
};

type RouteListRow = {
	id: string;
	model_id: string;
	route_group: string;
	status: string;
};

function ReadonlyField({ label, children }: { label: string; children: ReactNode }) {
	return (
		<div className="min-w-0">
			<div className="text-xs font-medium text-gray-500">{label}</div>
			<div className="mt-0.5 text-sm text-gray-900 break-words">{children}</div>
		</div>
	);
}

function formatModelLabel(m: AdminModelRow): string {
	const dn = m.display_name?.trim() || 'n/a';
	return `${m.id} · ${dn} · ${m.vendor}`;
}

function formatModelOptionLabel(m: AdminModelRow, hasActiveRouter: boolean): string {
	const base = formatModelLabel(m);
	return hasActiveRouter ? `🟢 ${base}` : `🔴 ${base}`;
}

/** Matches Proxy `resolveModelRouting`: default group sends model id only, else `id:group`. */
function buildModelRoutingString(modelId: string, routeGroup: string): string {
	const g = routeGroup.trim();
	if (!g || g === 'default') return modelId.trim();
	return `${modelId.trim()}:${g}`;
}

const codeBlockClass =
	'p-3 text-xs overflow-x-auto whitespace-pre-wrap bg-gray-50 border border-gray-200 rounded-md font-mono text-gray-900';

export default function SimulatorPage() {
	const t = useTranslations('simulator');
	const tBrand = useTranslations('brand');
	const tCommon = useTranslations('common');
	const [proxyBaseUrl, setProxyBaseUrl] = useState('');
	const [protocol, setProtocol] = useState<SimulatorProtocol>('openai');
	const [geminiAction, setGeminiAction] = useState<SimulatorGeminiAction>('streamGenerateContent');

	const [models, setModels] = useState<AdminModelRow[]>([]);
	const [routes, setRoutes] = useState<RouteListRow[]>([]);
	const [loadingCatalog, setLoadingCatalog] = useState(true);
	const [catalogError, setCatalogError] = useState<string | null>(null);

	const [filterModel, setFilterModel] = useState('');
	const [selectedModelId, setSelectedModelId] = useState('');
	const [routeGroup, setRouteGroup] = useState('');

	const KEYS_PAGE_SIZE = 200;

	const [keys, setKeys] = useState<AdminKeyListItem[]>([]);
	const [keysTotal, setKeysTotal] = useState(0);
	const [filterKeyEmail, setFilterKeyEmail] = useState('');
	const [filterKeyUserId, setFilterKeyUserId] = useState('');
	const [loadingKeys, setLoadingKeys] = useState(false);
	const [keysError, setKeysError] = useState<string | null>(null);

	const [selectedKeyId, setSelectedKeyId] = useState('');
	const [revealedSk, setRevealedSk] = useState<string | null>(null);
	const [revealLoading, setRevealLoading] = useState(false);
	const [revealError, setRevealError] = useState<string | null>(null);

	const [bodyText, setBodyText] = useState(BODY_TEMPLATES.openai);
	const [bodyError, setBodyError] = useState<string | null>(null);
	const [infoHint, setInfoHint] = useState<string | null>(null);

	const [sending, setSending] = useState(false);
	const abortRef = useRef<AbortController | null>(null);
	const [responseMeta, setResponseMeta] = useState<{
		status: number;
		latencyMs: string | null;
		requestUrl: string | null;
		contentType: string | null;
	} | null>(null);
	const [responseText, setResponseText] = useState('');
	const [responseProtocol, setResponseProtocol] = useState<PlaygroundProtocol>('openai');
	const [usageHint, setUsageHint] = useState<string | null>(null);
	const [lastWirePreview, setLastWirePreview] = useState<string | null>(null);

	const streamEndRef = useRef<HTMLSpanElement>(null);
	const mergedStreamEndRef = useRef<HTMLSpanElement>(null);

	const filteredModels = useMemo(() => {
		const q = filterModel.trim().toLowerCase();
		if (!q) return models;
		return models.filter(
			(m) =>
				m.id.toLowerCase().includes(q) ||
				(m.display_name ?? '').toLowerCase().includes(q) ||
				m.vendor.toLowerCase().includes(q)
		);
	}, [models, filterModel]);

	const modelIdsWithActiveRouter = useMemo(() => {
		const s = new Set<string>();
		for (const r of routes) {
			if (r.model_id && String(r.status).toLowerCase() === 'active') {
				s.add(r.model_id);
			}
		}
		return s;
	}, [routes]);

	const routeGroupsForModel = useMemo(() => {
		if (!selectedModelId) return [] as string[];
		const set = new Set<string>();
		for (const r of routes) {
			if (r.model_id === selectedModelId && String(r.status).toLowerCase() === 'active' && r.route_group) {
				set.add(r.route_group);
			}
		}
		return Array.from(set).sort((a, b) => a.localeCompare(b));
	}, [routes, selectedModelId]);

	const selectedModel = useMemo(
		() => models.find((m) => m.id === selectedModelId) ?? null,
		[models, selectedModelId]
	);

	const modelRoutingString = useMemo(() => {
		if (!selectedModelId) return '';
		return buildModelRoutingString(selectedModelId, routeGroup);
	}, [selectedModelId, routeGroup]);

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
			(sending && hasRaw ? '(Receiving…)' : '') ||
			(!sending && hasRaw && !p.reasoning ? '—' : '');
		const bodyDisplay =
			p.body ||
			(sending && hasRaw ? '(Receiving…)' : '') ||
			(!sending && hasRaw && !p.body ? (!p.reasoning ? '(Could not extract body from payload)' : '—') : '');
		return { mergedReasoningDisplay: reasoningDisplay, mergedBodyDisplay: bodyDisplay };
	}, [mergedAssistantParts, responseText, sending]);

	const scrollStreamToBottom = useCallback(() => {
		streamEndRef.current?.scrollIntoView({ behavior: 'smooth' });
		mergedStreamEndRef.current?.scrollIntoView({ behavior: 'smooth' });
	}, []);

	// Hydrate localStorage (client)
	useEffect(() => {
		try {
			const u = localStorage.getItem(LS_PROXY);
			if (u) setProxyBaseUrl(u);
			const p = localStorage.getItem(LS_PROTOCOL);
			if (p === 'openai' || p === 'anthropic' || p === 'gemini') setProtocol(p);
			const mid = localStorage.getItem(LS_MODEL_ID);
			if (mid) setSelectedModelId(mid);
			const rg = localStorage.getItem(LS_ROUTE_GROUP);
			if (rg != null) setRouteGroup(rg);
		} catch {
			// ignore
		}
	}, []);

	useEffect(() => {
		try {
			localStorage.setItem(LS_PROXY, proxyBaseUrl);
		} catch {
			// ignore
		}
	}, [proxyBaseUrl]);

	useEffect(() => {
		try {
			localStorage.setItem(LS_PROTOCOL, protocol);
		} catch {
			// ignore
		}
	}, [protocol]);

	useEffect(() => {
		try {
			if (selectedModelId) localStorage.setItem(LS_MODEL_ID, selectedModelId);
			else localStorage.removeItem(LS_MODEL_ID);
		} catch {
			// ignore
		}
	}, [selectedModelId]);

	useEffect(() => {
		try {
			localStorage.setItem(LS_ROUTE_GROUP, routeGroup);
		} catch {
			// ignore
		}
	}, [routeGroup]);

	useEffect(() => {
		setBodyText(BODY_TEMPLATES[protocol]);
		setBodyError(null);
	}, [protocol]);

	useEffect(() => {
		let cancelled = false;
		(async () => {
			setLoadingCatalog(true);
			setCatalogError(null);
			try {
				const [mRes, rRes] = await Promise.all([fetch('/api/admin/models'), fetch('/api/admin/routes')]);
				const mData = await readApiJson<AdminModelRow[]>(mRes);
				const rData = await readApiJson<RouteListRow[]>(rRes);
				if (cancelled) return;
				if (mData.success && Array.isArray(mData.data)) {
					setModels(mData.data);
				} else {
					setCatalogError(mData.message ?? tCommon('failedToLoadModels'));
				}
				if (rData.success && Array.isArray(rData.data)) {
					setRoutes(rData.data);
				} else if (!cancelled) {
					setCatalogError((prev) => prev ?? rData.message ?? tCommon('failedToLoadRoutes'));
				}
			} catch (e) {
				if (!cancelled) setCatalogError(e instanceof Error ? e.message : tCommon('failedToLoadModels'));
			} finally {
				if (!cancelled) setLoadingCatalog(false);
			}
		})();
		return () => {
			cancelled = true;
		};
	}, []);

	useEffect(() => {
		if (!selectedModelId) return;
		if (routeGroup && !routeGroupsForModel.includes(routeGroup) && routeGroupsForModel.length > 0) {
			setRouteGroup('');
		}
	}, [selectedModelId, routeGroup, routeGroupsForModel]);

	const loadKeys = useCallback(async () => {
		setLoadingKeys(true);
		setKeysError(null);
		try {
			const sp = new URLSearchParams({
				page: '1',
				page_size: String(KEYS_PAGE_SIZE),
			});
			if (filterKeyEmail.trim()) sp.set('email', filterKeyEmail.trim());
			if (filterKeyUserId.trim()) sp.set('user_id', filterKeyUserId.trim());
			const res = await fetch(`/api/admin/keys?${sp.toString()}`);
			const data = await readApiJson<AdminKeyListItem[]>(res);
			if (data.success && Array.isArray(data.data) && typeof data.total === 'number') {
				setKeys(data.data);
				setKeysTotal(data.total);
			} else {
				setKeysError(data.message ?? tCommon('failedToLoadApiKeys'));
			}
		} catch (e) {
			setKeysError(e instanceof Error ? e.message : tCommon('failedToLoadApiKeys'));
		} finally {
			setLoadingKeys(false);
		}
	}, [filterKeyEmail, filterKeyUserId]);

	useEffect(() => {
		void loadKeys();
	}, [loadKeys]);

	useEffect(() => {
		if (!selectedKeyId) {
			setRevealedSk(null);
			setRevealError(null);
			setRevealLoading(false);
			return;
		}
		let cancelled = false;
		setRevealLoading(true);
		setRevealError(null);
		setRevealedSk(null);
		void (async () => {
			try {
				const res = await fetch(`/api/admin/keys/${encodeURIComponent(selectedKeyId)}`);
				const data = await readApiJson<{ key: string }>(res);
				if (cancelled) return;
				if (data.success && data.data && typeof data.data.key === 'string') {
					setRevealedSk(data.data.key);
				} else {
					setRevealError(data.message ?? tCommon('failedToLoadApiKeys'));
				}
			} catch (e) {
				if (!cancelled) setRevealError(e instanceof Error ? e.message : tCommon('failedToLoadApiKeys'));
			} finally {
				if (!cancelled) setRevealLoading(false);
			}
		})();
		return () => {
			cancelled = true;
		};
	}, [selectedKeyId]);

	const stop = () => {
		abortRef.current?.abort();
		abortRef.current = null;
	};

	const send = async () => {
		setInfoHint(null);
		let base: string;
		try {
			const raw = proxyBaseUrl.trim();
			const u = new URL(raw);
			if (u.protocol !== 'http:' && u.protocol !== 'https:') {
				setBodyError('Proxy Base URL must be http:// or https://');
				return;
			}
			base = raw.replace(/\/+$/, '');
		} catch {
			setBodyError('Invalid Proxy Base URL');
			return;
		}

		if (!selectedModelId) {
			setBodyError('Select a model');
			return;
		}
		if (revealLoading) {
			setBodyError('API key is still loading');
			return;
		}
		if (!revealedSk || !revealedSk.startsWith('sk-')) {
			setBodyError('Select an API key and wait until it finishes loading (sk-…)');
			return;
		}

		let bodyObj: Record<string, unknown>;
		try {
			bodyObj = JSON.parse(bodyText) as Record<string, unknown>;
			if (bodyObj === null || typeof bodyObj !== 'object' || Array.isArray(bodyObj)) {
				setBodyError('Request body must be a JSON object');
				return;
			}
		} catch {
			setBodyError(tCommon('invalidJson'));
			return;
		}

		const protoNorm = normalizeProtocol(protocol);
		setResponseProtocol(protoNorm);

		const routing = modelRoutingString;
		if (protocol === 'openai' || protocol === 'anthropic') {
			const prev = bodyObj.model;
			bodyObj = { ...bodyObj, model: routing };
			if (prev !== routing) {
				setInfoHint(`Set request body model to "${routing}" (matches selected model and route group).`);
			}
		}

		const built = buildSimulatorRequest({
			baseUrl: base,
			protocol,
			modelForRouting: routing,
			geminiAction: protocol === 'gemini' ? geminiAction : undefined,
			body: bodyObj,
			apiKey: revealedSk,
		});

		setBodyError(null);
		setSending(true);
		setResponseText('');
		setUsageHint(null);
		setResponseMeta(null);
		setLastWirePreview(built.bodyText);

		const ac = new AbortController();
		abortRef.current = ac;
		const t0 = performance.now();

		try {
			const res = await fetch(built.url, {
				method: 'POST',
				headers: built.headers,
				body: built.bodyText,
				signal: ac.signal,
			});

			const latencyMs = String(Math.round(performance.now() - t0));
			const ct = res.headers.get('Content-Type') ?? '';

			setResponseMeta({
				status: res.status,
				latencyMs,
				requestUrl: built.url,
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
					setUsageHint(tryParseUsageSummary(JSON.stringify(j), protoNorm));
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
					flushSync(() => {
						setResponseText(acc);
					});
					scrollStreamToBottom();
				}
				acc += dec.decode();
				flushSync(() => {
					setResponseText(acc);
				});
				setUsageHint(parseLastStreamUsage(acc, protoNorm));
				setSending(false);
				return;
			}

			const text = await res.text();
			setResponseText(text);
			let summary: string | null = null;
			try {
				summary = tryParseUsageSummary(text, protoNorm);
			} catch {
				summary = null;
			}
			setUsageHint(summary);
			if (!res.ok && !summary) {
				setBodyError(text.slice(0, 500) || `HTTP ${res.status}`);
			}
		} catch (e) {
			if (e instanceof DOMException && e.name === 'AbortError') {
				setBodyError(tCommon('requestCancelled'));
				setResponseText('');
			} else {
				setResponseText('');
				setBodyError(e instanceof Error ? e.message : tCommon('requestFailed'));
			}
		} finally {
			setSending(false);
			abortRef.current = null;
		}
	};

	if (loadingCatalog) {
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
				<p className="text-xs text-amber-800 mt-2 max-w-3xl">
					Local dev example: <span className="font-mono">http://127.0.0.1:8787</span> — enter your own Base URL
					above; avoid pointing at production by mistake.
				</p>
			</div>

			{catalogError ? (
				<div className="p-3 bg-red-50 border border-red-200 rounded-md text-red-600 text-sm max-w-3xl mb-6">{catalogError}</div>
			) : null}

			<div className="flex flex-col gap-6">
				<div className="bg-white rounded-lg shadow-md p-6 space-y-4">
					<h2 className="text-lg font-semibold text-gray-900 border-b border-gray-100 pb-3">{t('connection')}</h2>
					<div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
						<div>
							<label className={labelClass}>{t('proxyBaseUrl')}</label>
							<input
								type="url"
								placeholder="https://your-proxy.example.com"
								value={proxyBaseUrl}
								onChange={(e) => setProxyBaseUrl(e.target.value)}
								className={inputClass}
								autoComplete="off"
							/>
						</div>
						<div>
							<label className={labelClass}>Protocol</label>
							<div className="flex flex-wrap gap-4 pt-1 text-sm">
								{(['openai', 'anthropic', 'gemini'] as const).map((p) => (
									<label key={p} className="inline-flex items-center gap-2 cursor-pointer">
										<input
											type="radio"
											name="simProtocol"
											checked={protocol === p}
											onChange={() => setProtocol(p)}
											className="text-blue-600 focus:ring-blue-500"
										/>
										{p}
									</label>
								))}
							</div>
						</div>
					</div>
					{protocol === 'gemini' && (
						<fieldset className="flex flex-wrap items-center gap-4 text-sm border border-gray-200 rounded-md px-3 py-2">
							<legend className="sr-only">Gemini action</legend>
							<span className="text-gray-600 font-medium">Gemini action</span>
							<label className="inline-flex items-center gap-2 cursor-pointer">
								<input
									type="radio"
									name="geminiActionSim"
									className="text-blue-600 focus:ring-blue-500"
									checked={geminiAction === 'generateContent'}
									onChange={() => setGeminiAction('generateContent')}
								/>
								generateContent
							</label>
							<label className="inline-flex items-center gap-2 cursor-pointer">
								<input
									type="radio"
									name="geminiActionSim"
									checked={geminiAction === 'streamGenerateContent'}
									onChange={() => setGeminiAction('streamGenerateContent')}
								/>
								streamGenerateContent
							</label>
						</fieldset>
					)}
				</div>

				<div className="grid grid-cols-1 xl:grid-cols-2 gap-6 xl:items-stretch">
					<div className="bg-white rounded-lg shadow-md p-6 space-y-4 min-h-0 flex flex-col">
						<h2 className="text-lg font-semibold text-gray-900 border-b border-gray-100 pb-3">Model</h2>
						<div>
							<label className={labelClass}>Filter</label>
							<input
								type="text"
								placeholder="id / display name / vendor contains…"
								value={filterModel}
								onChange={(e) => setFilterModel(e.target.value)}
								className={inputClass}
							/>
						</div>
						<div>
							<label className={labelClass}>Model</label>
							<select
								value={selectedModelId}
								onChange={(e) => {
									setSelectedModelId(e.target.value);
									setRouteGroup('');
								}}
								className={`${inputClass} font-mono`}
								size={Math.min(10, Math.max(6, Math.min(filteredModels.length, 10) || 6))}
							>
								<option value="">— Select a model —</option>
								{filteredModels.map((m) => (
									<option key={m.id} value={m.id}>
										{formatModelOptionLabel(m, modelIdsWithActiveRouter.has(m.id))}
									</option>
								))}
							</select>
							<p className="mt-2 text-xs text-gray-500">
								{models.length} model(s) total · {filteredModels.length} after filter · 🟢 = at least one{' '}
								<span className="font-medium">active</span> route · 🔴 = none
							</p>
						</div>
						<div>
							<label className={labelClass}>Route group (optional)</label>
							<select
								value={routeGroup}
								onChange={(e) => setRouteGroup(e.target.value)}
								className={inputClass}
								disabled={!selectedModelId}
							>
								<option value="">Default (no explicit suffix)</option>
								{routeGroupsForModel.map((g) => (
									<option key={g} value={g}>
										{g}
									</option>
								))}
							</select>
							<p className="mt-1 text-xs text-gray-500">
								Options come from <span className="font-medium">active</span> routes for this model
								(non-empty route_group). OpenAI/Anthropic set <code className="text-[11px] bg-gray-100 px-1 rounded">body.model</code>{' '}
								to <code className="text-[11px] bg-gray-100 px-1 rounded">id</code> or{' '}
								<code className="text-[11px] bg-gray-100 px-1 rounded">id:group</code>; Gemini uses the same segment in the path.
							</p>
						</div>
						{selectedModel ? (
							<div className="grid grid-cols-1 sm:grid-cols-2 gap-3 pt-2 border-t border-gray-100">
								<ReadonlyField label="Routing model string">{modelRoutingString || '—'}</ReadonlyField>
								<ReadonlyField label="max_tokens">{String(selectedModel.max_tokens ?? '—')}</ReadonlyField>
							</div>
						) : null}
					</div>

					<div className="bg-white rounded-lg shadow-md p-6 space-y-4 min-h-0 flex flex-col">
						<h2 className="text-lg font-semibold text-gray-900 border-b border-gray-100 pb-3">API Key</h2>
						<div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
							<div>
								<label className={labelClass}>Email contains</label>
								<input
									type="text"
									value={filterKeyEmail}
									onChange={(e) => {
										setFilterKeyEmail(e.target.value);
									}}
									className={inputClass}
								/>
							</div>
							<div>
								<label className={labelClass}>user_id</label>
								<input
									type="text"
									value={filterKeyUserId}
									onChange={(e) => {
										setFilterKeyUserId(e.target.value);
									}}
									className={inputClass}
								/>
							</div>
						</div>
						<div className="flex flex-wrap items-center gap-2">
							<button
								type="button"
								onClick={() => void loadKeys()}
								disabled={loadingKeys}
								className="px-3 py-1.5 text-sm rounded-md border border-gray-300 hover:bg-gray-50 disabled:opacity-50"
							>
								{loadingKeys ? 'Refreshing…' : 'Refresh list'}
							</button>
							<span className="text-xs text-gray-500">
								Showing {keys.length} of {keysTotal} key(s)
								{keysTotal > keys.length ? ' — narrow filters to see more within the scroll limit.' : ''}
							</span>
						</div>
						{keysError ? <div className="p-2 text-sm text-red-600 bg-red-50 rounded border border-red-100">{keysError}</div> : null}
						<div className="min-h-0 flex flex-col flex-1">
							<label className={labelClass}>API key (row id)</label>
							<select
								value={selectedKeyId}
								onChange={(e) => {
									setSelectedKeyId(e.target.value);
								}}
								className={`${inputClass} font-mono max-h-[min(320px,40vh)] overflow-y-auto`}
								size={12}
							>
								<option value="">— Select —</option>
								{keys.map((k) => (
									<option key={k.id} value={k.id}>
										{k.user_email ?? k.user_id} · {k.name ?? 'n/a'} · {k.id.slice(0, 8)}…
									</option>
								))}
							</select>
							<div className="mt-2 flex flex-wrap items-center gap-2 text-xs text-gray-600">
								{revealLoading && selectedKeyId ? <span>Loading key…</span> : null}
								{!revealLoading && revealedSk && revealedSk.startsWith('sk-') ? (
									<span className="font-mono text-gray-700 break-all">
										Loaded: {revealedSk.slice(0, 12)}…{revealedSk.slice(-4)}
									</span>
								) : null}
							</div>
						</div>
						{revealError ? <div className="text-sm text-red-600">{revealError}</div> : null}
					</div>
				</div>

				<div className="grid grid-cols-1 xl:grid-cols-2 gap-6">
					<div className="bg-white rounded-lg shadow-md p-6 space-y-4">
						<div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-3 border-b border-gray-100 pb-3">
							<h2 className="text-lg font-semibold text-gray-900">{t('requestBody')}</h2>
							<div className="flex gap-2 shrink-0">
								{sending ? (
									<button
										type="button"
										onClick={() => stop()}
										className="inline-flex items-center justify-center gap-2 px-4 py-2 bg-amber-600 text-white text-sm font-medium rounded-md hover:bg-amber-700"
									>
										<StopIcon className="h-4 w-4" />
										{tCommon('stop')}
									</button>
								) : (
									<button
										type="button"
										onClick={() => void send()}
										className="inline-flex items-center justify-center gap-2 px-4 py-2 bg-blue-600 text-white text-sm font-medium rounded-md hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-blue-500"
									>
										<PaperAirplaneIcon className="h-4 w-4" />
										{tCommon('send')}
									</button>
								)}
							</div>
						</div>
						{infoHint ? (
							<div className="p-3 bg-blue-50 border border-blue-200 rounded-md text-blue-900 text-sm">{infoHint}</div>
						) : null}
						<div>
							<label className={labelClass}>JSON</label>
							<textarea
								value={bodyText}
								onChange={(e) => setBodyText(e.target.value)}
								rows={10}
								className={`${inputClass} font-mono text-sm min-h-[120px]`}
								spellCheck={false}
							/>
						</div>
						{bodyError ? <div className="p-3 bg-red-50 border border-red-200 rounded-md text-red-600 text-sm">{bodyError}</div> : null}
						{lastWirePreview ? (
							<div className="pt-2 border-t border-gray-100">
								<div className="text-xs font-medium text-gray-600 mb-1">JSON body sent to Proxy</div>
								<pre className={codeBlockClass}>{lastWirePreview}</pre>
							</div>
						) : null}
					</div>

					<div className="bg-white rounded-lg shadow-md p-6 space-y-4">
						<div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-2 border-b border-gray-100 pb-3">
							<h2 className="text-lg font-semibold text-gray-900 shrink-0">{t('response')}</h2>
							{responseMeta ? (
								<div className="flex flex-wrap items-center justify-end gap-2 text-xs min-w-0">
									<span className="inline-flex items-center rounded-full bg-gray-100 px-2.5 py-1 font-medium text-gray-800">
										HTTP {responseMeta.status}
									</span>
									{responseMeta.latencyMs != null && (
										<span className="inline-flex items-center rounded-full bg-gray-100 px-2.5 py-1 font-medium text-gray-800">
											{responseMeta.latencyMs} ms
										</span>
									)}
									{responseMeta.contentType ? (
										<span
											className="inline-flex items-center rounded-full bg-gray-100 px-2.5 py-1 font-medium text-gray-700 max-w-full truncate"
											title={responseMeta.contentType}
										>
											{responseMeta.contentType}
										</span>
									) : null}
								</div>
							) : null}
						</div>
						{responseMeta?.requestUrl ? (
							<div className="text-xs text-gray-500 break-all">
								<span className="font-medium text-gray-600">Request URL: </span>
								{responseMeta.requestUrl}
							</div>
						) : null}
						{responseMeta || responseText ? (
							<>
								{usageHint ? (
									<div className="p-3 rounded-md bg-green-50 border border-green-200 text-sm text-green-900">
										<span className="font-semibold">Usage (preview): </span>
										{usageHint}
									</div>
								) : null}
								<div className="space-y-3">
									<div>
										<div className="text-xs font-medium text-gray-600 mb-1">Merged view</div>
										<div className="rounded-md border border-slate-200 overflow-hidden divide-y divide-slate-200">
											<div>
												<div className="text-[11px] font-semibold text-amber-900/85 uppercase tracking-wide px-3 py-1.5 bg-amber-50 border-b border-amber-100">
													Thinking / reasoning
												</div>
												<pre className="max-h-[min(220px,32vh)] overflow-auto p-3 bg-amber-50/60 text-sm text-gray-900 font-mono whitespace-pre-wrap break-words">
													{mergedReasoningDisplay}
												</pre>
											</div>
											<div>
												<div className="text-[11px] font-semibold text-slate-600 uppercase tracking-wide px-3 py-1.5 bg-slate-50 border-b border-slate-100">
													Body
												</div>
												<pre className="max-h-[min(280px,38vh)] overflow-auto p-3 bg-slate-50 text-sm text-gray-900 font-mono whitespace-pre-wrap break-words">
													{mergedBodyDisplay}
													<span ref={mergedStreamEndRef} className="inline-block w-0 h-0 overflow-hidden" aria-hidden />
												</pre>
											</div>
										</div>
									</div>
									<div>
										<div className="text-xs font-medium text-gray-600 mb-1">Raw payload</div>
										<pre className="max-h-[min(520px,50vh)] overflow-auto p-4 bg-gray-50 border border-gray-200 rounded-md text-xs text-gray-900 font-mono whitespace-pre-wrap break-words">
											{responseText}
											<span ref={streamEndRef} className="inline-block w-0 h-0 overflow-hidden" aria-hidden />
										</pre>
									</div>
								</div>
							</>
						) : (
							<p className="text-sm text-gray-500">
								After you click Send, status, body, or streamed output appears here.
							</p>
						)}
					</div>
				</div>
			</div>
		</div>
	);
}
