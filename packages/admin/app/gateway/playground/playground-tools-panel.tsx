'use client';

/**
 * Playground Tools：工具 + 引擎两级下拉，直连 catalog 引擎（不计费、不写 logs）。
 */
import { useCallback, useEffect, useMemo, useState } from 'react';
import { AdminInspector } from '@/components/admin-inspector';
import { PaperAirplaneIcon, ArrowDownTrayIcon } from '@heroicons/react/24/outline';
import { useTranslations } from 'next-intl';
import { GATEWAY_TOOLS } from '@/lib/gateway-tools';
import { parseGatewayToolId, type GatewayToolId } from '@/lib/invoke-kind';
import { AI_DETECTION_IMPLEMENTED_PROVIDERS } from '@/lib/ai-detection-options';
import { WEB_SEARCH_PROVIDERS } from '@/lib/web-search-options';
import { WEB_FETCH_PROVIDERS } from '@/lib/web-fetch-options';
import { WEB_DEEP_SEARCH_PROVIDERS } from '@/lib/web-deep-search-options';
import { TOOL_BODY_TEMPLATES, bodyTemplateForTool } from '../simulator/simulator-utils';
import { inputClass, labelClass, panelClass, codeBlockClass } from './playground-utils';

function providersForTool(toolId: GatewayToolId): readonly string[] {
	switch (toolId) {
		case 'web-search':
			return WEB_SEARCH_PROVIDERS;
		case 'web-fetch':
			return WEB_FETCH_PROVIDERS;
		case 'web-deep-search':
			return WEB_DEEP_SEARCH_PROVIDERS;
		case 'ai-detection':
			return AI_DETECTION_IMPLEMENTED_PROVIDERS;
		default:
			return [];
	}
}

export function usePlaygroundToolsState(initialToolId?: string | null, initialProvider?: string | null) {
	const t = useTranslations('playground');
	const tCommon = useTranslations('common');

	const initialTool = parseGatewayToolId(initialToolId) ?? 'ai-detection';
	const [toolId, setToolId] = useState<GatewayToolId>(initialTool);
	const providers = useMemo(() => providersForTool(toolId), [toolId]);
	const [provider, setProvider] = useState(() => {
		const p = initialProvider?.trim() ?? '';
		if (p && (providersForTool(initialTool) as readonly string[]).includes(p)) return p;
		return providersForTool(initialTool)[0] ?? '';
	});
	const [bodyText, setBodyText] = useState(() => bodyTemplateForTool(initialTool));
	const [bodyError, setBodyError] = useState<string | null>(null);
	const [sending, setSending] = useState(false);
	const [responseMeta, setResponseMeta] = useState<{
		status: number;
		latencyMs: string | null;
		upstreamUrl: string | null;
	} | null>(null);
	const [responseText, setResponseText] = useState('');
	const [wireBody, setWireBody] = useState<string | null>(null);

	useEffect(() => {
		const nextProviders = providersForTool(toolId);
		if (!nextProviders.includes(provider)) {
			setProvider(nextProviders[0] ?? '');
		}
	}, [toolId, provider]);

	const onToolChange = useCallback((next: string) => {
		const parsed = parseGatewayToolId(next);
		if (!parsed) return;
		setToolId(parsed);
		setResponseMeta(null);
		setResponseText('');
		setWireBody(null);
		setBodyText(TOOL_BODY_TEMPLATES[parsed] ?? bodyTemplateForTool(parsed));
		setBodyError(null);
		const nextProviders = providersForTool(parsed);
		setProvider(nextProviders[0] ?? '');
	}, []);

	const applyTemplate = useCallback(() => {
		setBodyText(bodyTemplateForTool(toolId));
		setBodyError(null);
	}, [toolId]);

	const send = useCallback(async () => {
		setBodyError(null);
		let body: Record<string, unknown>;
		try {
			body = JSON.parse(bodyText) as Record<string, unknown>;
			if (body === null || typeof body !== 'object' || Array.isArray(body)) {
				setBodyError(t('toolsBodyMustBeObject'));
				return;
			}
		} catch {
			setBodyError(tCommon('invalidJson'));
			return;
		}
		if (!provider) {
			setBodyError(t('toolsNeedProvider'));
			return;
		}

		setSending(true);
		setResponseText('');
		setResponseMeta(null);
		setWireBody(null);
		try {
			const res = await fetch('/api/admin/playground', {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ toolId, provider, body }),
			});
			const latency = res.headers.get('x-playground-latency-ms');
			const upstream = res.headers.get('x-playground-upstream-url');
			const wireRaw = res.headers.get('x-playground-request-body');
			if (wireRaw) {
				try {
					setWireBody(JSON.stringify(JSON.parse(decodeURIComponent(wireRaw)), null, 2));
				} catch {
					setWireBody(decodeURIComponent(wireRaw));
				}
			}
			const text = await res.text();
			setResponseMeta({
				status: res.status,
				latencyMs: latency,
				upstreamUrl: upstream,
			});
			try {
				setResponseText(JSON.stringify(JSON.parse(text), null, 2));
			} catch {
				setResponseText(text);
			}
			if (!res.ok) {
				setBodyError(text.slice(0, 400) || `HTTP ${res.status}`);
			}
		} catch (e) {
			setBodyError(e instanceof Error ? e.message : tCommon('requestFailed'));
		} finally {
			setSending(false);
		}
	}, [bodyText, provider, toolId, t, tCommon]);

	const onProviderChange = (value: string) => {
		setProvider(value);
		setBodyError(null);
		setResponseMeta(null);
		setResponseText('');
		setWireBody(null);
	};

	return {
		toolId,
		onToolChange,
		providers,
		provider,
		setProvider: onProviderChange,
		bodyText,
		setBodyText,
		bodyError,
		sending,
		responseMeta,
		responseText,
		wireBody,
		applyTemplate,
		send,
	};
}

export type PlaygroundToolsState = ReturnType<typeof usePlaygroundToolsState>;

export function PlaygroundToolsSetup({ state }: { state: PlaygroundToolsState }) {
	const t = useTranslations('playground');
	const tTools = useTranslations('tools.catalog');

	return (
		<section className={panelClass}>
			<h2 className="text-sm font-medium text-gray-900">{t('toolsSection')}</h2>
			<p className="text-xs text-gray-500">{t('toolsHint')}</p>
			<div className="space-y-3">
				<div>
					<label className={labelClass} htmlFor="playground-tool">
						{t('tool')}
					</label>
					<select
						id="playground-tool"
						value={state.toolId}
						disabled={state.sending}
						onChange={(e) => state.onToolChange(e.target.value)}
						className={`${inputClass} font-mono`}
					>
						{GATEWAY_TOOLS.map((tool) => (
							<option key={tool.id} value={tool.id}>
								{tTools(tool.nameKey)} ({tool.id})
							</option>
						))}
					</select>
				</div>
				<div>
					<label className={labelClass} htmlFor="playground-engine">
						{t('engineProvider')}
					</label>
					<select
						id="playground-engine"
						value={state.provider}
						disabled={state.sending}
						onChange={(e) => state.setProvider(e.target.value)}
						className={`${inputClass} font-mono`}
					>
						{state.providers.map((p) => (
							<option key={p} value={p}>
								{p}
							</option>
						))}
					</select>
					<p className="mt-1 text-xs text-gray-500">{t('engineProviderHint')}</p>
				</div>
			</div>
		</section>
	);
}

export function PlaygroundToolsWorkspace({ state }: { state: PlaygroundToolsState }) {
	const t = useTranslations('playground');
	const tCommon = useTranslations('common');

	return (
		<div className="grid min-h-0 flex-1 grid-cols-1 gap-4 xl:grid-cols-2 xl:grid-rows-[minmax(0,1fr)]">
			<section
				aria-label={t('requestBody')}
				className="admin-content-panel flex min-h-0 flex-col overflow-hidden rounded-xl border border-gray-200 bg-white"
			>
				<header className="flex min-h-[57px] shrink-0 flex-wrap items-center justify-between gap-2 border-b border-gray-100 px-4 py-2.5">
					<h2 className="text-sm font-medium text-gray-900">{t('requestBody')}</h2>
					<div className="flex items-center gap-2">
						<AdminInspector
							label={t('sentBody')}
							hint={state.wireBody ? t('sentBodyHint') : t('sentBodyEmpty')}
							disabled={!state.wireBody}
						>
							<pre className={`${codeBlockClass} leading-6`}>{state.wireBody}</pre>
						</AdminInspector>
						<button
							type="button"
							disabled={state.sending}
							onClick={() => void state.send()}
							className="inline-flex h-9 items-center gap-1.5 rounded-lg bg-gray-950 px-3 text-xs font-medium text-white hover:bg-gray-800 disabled:opacity-50"
						>
							<PaperAirplaneIcon className="h-4 w-4" aria-hidden />
							{state.sending ? tCommon('sending') : tCommon('send')}
						</button>
					</div>
				</header>
				<div className="flex min-h-0 flex-1 flex-col gap-3 p-4">
					<div className="flex flex-wrap items-center justify-between gap-2">
						<p className="min-w-0 truncate font-mono text-xs text-gray-500">
							{state.toolId} · {state.provider}
						</p>
						<button
							type="button"
							onClick={state.applyTemplate}
							disabled={state.sending}
							className="shrink-0 rounded-lg px-2 py-1.5 text-xs text-gray-500 hover:bg-gray-100 disabled:opacity-50"
						>
							{t('applyTemplate')}
						</button>
					</div>
					<label className="sr-only" htmlFor="playground-tool-body">
						{t('inputBody')}
					</label>
					<textarea
						id="playground-tool-body"
						value={state.bodyText}
						onChange={(event) => state.setBodyText(event.target.value)}
						disabled={state.sending}
						rows={14}
						spellCheck={false}
						className={`${inputClass} min-h-[280px] flex-1 resize-y bg-gray-50/60 font-mono text-xs leading-6 xl:min-h-0 xl:resize-none`}
					/>
					{state.bodyError && (
						<p
							role="alert"
							className="max-h-24 shrink-0 overflow-auto whitespace-pre-wrap text-xs leading-5 text-red-700"
						>
							{state.bodyError}
						</p>
					)}
				</div>
			</section>
			<section
				aria-label={t('response')}
				className="admin-content-panel flex min-h-0 flex-col overflow-hidden rounded-xl border border-gray-200 bg-white"
			>
				<header className="flex min-h-[57px] shrink-0 flex-wrap items-center justify-between gap-2 border-b border-gray-100 px-4 py-2.5">
					<h2 className="text-sm font-medium text-gray-900">{t('response')}</h2>
					{state.responseMeta && (
						<div className="flex items-center gap-2 text-xs tabular-nums">
							<span
								className={`rounded-md px-2 py-1 ${
									state.responseMeta.status >= 400
										? 'bg-red-50 text-red-700'
										: 'bg-emerald-50 text-emerald-700'
								}`}
							>
								HTTP {state.responseMeta.status}
							</span>
							{state.responseMeta.latencyMs != null && (
								<span className="text-gray-500">{state.responseMeta.latencyMs} ms</span>
							)}
						</div>
					)}
				</header>
				{state.responseText ? (
					<div className="flex min-h-0 flex-1 flex-col gap-3 p-4">
						{state.responseMeta?.upstreamUrl && (
							<p className="truncate font-mono text-xs text-gray-500" title={state.responseMeta.upstreamUrl}>
								{state.responseMeta.upstreamUrl}
							</p>
						)}
						<pre className={`${codeBlockClass} min-h-0 flex-1 overflow-auto leading-6`}>
							{state.responseText}
						</pre>
					</div>
				) : (
					<div className="flex min-h-[320px] flex-1 flex-col items-center justify-center gap-4 px-6 py-12 text-center">
						<span className="flex h-12 w-12 items-center justify-center rounded-2xl bg-gray-50 text-gray-400">
							<ArrowDownTrayIcon className="h-5 w-5" aria-hidden />
						</span>
						<p className="max-w-64 text-xs leading-6 text-gray-500">{t('emptyResponseHint')}</p>
					</div>
				)}
			</section>
		</div>
	);
}
