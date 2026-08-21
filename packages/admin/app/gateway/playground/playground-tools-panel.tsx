'use client';

/**
 * Playground Tools：工具 + 引擎两级下拉，直连 catalog 引擎（不计费、不写 logs）。
 */
import { useCallback, useEffect, useMemo, useState } from 'react';
import { PaperAirplaneIcon } from '@heroicons/react/24/outline';
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

	return {
		toolId,
		onToolChange,
		providers,
		provider,
		setProvider,
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
			<h2 className="text-sm font-semibold text-gray-900">{t('toolsSection')}</h2>
			<p className="text-xs text-gray-500">{t('toolsHint')}</p>
			<div className="space-y-3">
				<div>
					<label className={labelClass}>{t('tool')}</label>
					<select
						value={state.toolId}
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
					<label className={labelClass}>{t('engineProvider')}</label>
					<select
						value={state.provider}
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
		<div className="space-y-4">
			<section className="space-y-3 rounded-xl border border-gray-200/80 bg-white p-4 shadow-sm">
				<div className="flex flex-wrap items-center justify-between gap-2">
					<h2 className="text-sm font-semibold text-gray-900">{t('requestBody')}</h2>
					<div className="flex flex-wrap items-center gap-2">
						<button
							type="button"
							onClick={state.applyTemplate}
							className="rounded-md border border-gray-300 px-2.5 py-1.5 text-xs text-gray-700 hover:bg-gray-50"
						>
							{t('applyTemplate')}
						</button>
						<button
							type="button"
							disabled={state.sending}
							onClick={() => void state.send()}
							className="inline-flex items-center gap-1.5 rounded-md bg-blue-600 px-3.5 py-1.5 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-50"
						>
							<PaperAirplaneIcon className="h-4 w-4" />
							{state.sending ? tCommon('sending') : tCommon('send')}
						</button>
					</div>
				</div>
				<div className="grid min-h-0 grid-cols-1 gap-3 xl:grid-cols-2 xl:items-stretch">
					<div className="flex min-h-0 min-w-0 flex-col">
						<label className="mb-1 text-xs font-medium uppercase tracking-wider text-gray-500">
							{t('inputBody')}
						</label>
						<textarea
							value={state.bodyText}
							onChange={(e) => state.setBodyText(e.target.value)}
							rows={12}
							className={`${inputClass} min-h-[180px] flex-1 font-mono text-sm`}
							spellCheck={false}
						/>
					</div>
					<div className="flex min-h-0 min-w-0 flex-col">
						<div className="mb-1 flex items-center justify-between gap-2">
							<label className="text-xs font-medium uppercase tracking-wider text-gray-500">{t('sentBody')}</label>
							{state.wireBody ? (
								<span className="text-[11px] font-medium text-emerald-700">{t('sentBodySourceSent')}</span>
							) : null}
						</div>
						<p className="mb-1 text-[11px] text-gray-500">
							{state.wireBody ? t('sentBodyHint') : t('sentBodyEmpty')}
						</p>
						<pre className={`${codeBlockClass} min-h-[180px] flex-1 overflow-y-auto`}>
							{state.wireBody ?? '—'}
						</pre>
					</div>
				</div>
				{state.bodyError ? (
					<div className="whitespace-pre-wrap rounded-md border border-red-200 bg-red-50 p-2.5 text-sm text-red-700">
						{state.bodyError}
					</div>
				) : null}
			</section>

			<section className="space-y-3 rounded-xl border border-gray-200/80 bg-white p-4 shadow-sm">
				<h2 className="text-sm font-semibold text-gray-900">{t('response')}</h2>
				{state.responseMeta ? (
					<div className="flex flex-wrap gap-2 text-xs">
						<span className="rounded-full bg-gray-100 px-2.5 py-1 font-medium">HTTP {state.responseMeta.status}</span>
						{state.responseMeta.latencyMs ? (
							<span className="rounded-full bg-gray-100 px-2.5 py-1 font-medium">
								{state.responseMeta.latencyMs} ms
							</span>
						) : null}
						{state.responseMeta.upstreamUrl ? (
							<span className="max-w-full truncate rounded-full bg-gray-100 px-2.5 py-1 font-mono">
								{state.responseMeta.upstreamUrl}
							</span>
						) : null}
					</div>
				) : (
					<p className="text-sm text-gray-500">{t('emptyResponseHint')}</p>
				)}
				{state.responseText ? <pre className={codeBlockClass}>{state.responseText}</pre> : null}
			</section>
		</div>
	);
}
