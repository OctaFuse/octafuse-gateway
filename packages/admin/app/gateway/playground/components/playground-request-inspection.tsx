'use client';

import { useEffect, useMemo, useState } from 'react';
import { useTranslations } from 'next-intl';
import { readApiJson } from '@/lib/api-json';
import { parseLlmRequest } from '@/lib/playground/llm-request';
import {
	playgroundBodySourceRows,
	playgroundHeaderSourceRows,
	type PlaygroundRequestInspection,
} from '@/lib/playground/request-sources';
import type { GeminiAction } from '../types';
import { formatRouteJsonColumn } from '../playground-utils';

export function usePlaygroundRequestInspection(input: {
	routeId: string | null;
	bodyText: string;
	geminiAction: GeminiAction;
	sentBody: string | null;
	sentHeaders: Record<string, string> | null;
	sentSources: string | null;
}) {
	const { routeId, bodyText, geminiAction, sentBody, sentHeaders, sentSources } = input;
	const body = useMemo(() => parseLlmRequest(bodyText), [bodyText]);
	const request = routeId ? JSON.stringify({ routeId, body: body ?? {}, geminiAction, preview: true }) : null;
	const [preview, setPreview] = useState<{
		request: string;
		data: PlaygroundRequestInspection | null;
	} | null>(null);

	useEffect(() => {
		if (!request || sentBody !== null) return;
		const controller = new AbortController();
		const timer = window.setTimeout(async () => {
			try {
				const response = await fetch('/api/admin/playground', {
					method: 'POST',
					headers: { 'Content-Type': 'application/json' },
					body: request,
					signal: controller.signal,
				});
				const result = await readApiJson<PlaygroundRequestInspection>(response);
				if (controller.signal.aborted) return;
				if (result.success && result.data) {
					setPreview({ request, data: { ...result.data, body: formatRouteJsonColumn(result.data.body) } });
				} else {
					setPreview({ request, data: null });
				}
			} catch {
				if (!controller.signal.aborted) setPreview({ request, data: null });
			}
		}, 200);
		return () => {
			window.clearTimeout(timer);
			controller.abort();
		};
	}, [request, sentBody]);

	const current = preview?.request === request ? preview : null;
	const sent = sentBody !== null;
	return {
		hasRoute: routeId !== null,
		invalid: body === null,
		sent,
		loading: Boolean(request && !sent && !current),
		headers: sent ? sentHeaders : current?.data?.headers,
		body: sent ? sentBody : body ? current?.data?.body ?? null : null,
		sources: sent ? sentSources : current?.data?.sources ?? null,
	};
}

type Inspection = ReturnType<typeof usePlaygroundRequestInspection>;

function SourceLabel({ source }: { source: string }) {
	const t = useTranslations('playground');
	const label = source === 'p'
		? t('inspectionSourceProvider')
		: source === 'r' ? t('inspectionSourceRoute') : t('inspectionSourceProtocol');
	return (
		<span className={`shrink-0 rounded px-1.5 py-0.5 text-[11px] font-medium ${
			source === 'p' ? 'bg-sky-50 text-sky-800' :
			source === 'r' ? 'bg-amber-50 text-amber-800' : 'bg-gray-100 text-gray-600'
		}`}>
			{label}
		</span>
	);
}

export function PlaygroundInspectionHeaders({ inspection }: { inspection: Inspection }) {
	const t = useTranslations('playground');
	const common = useTranslations('common');
	const { headers, sources, loading, hasRoute, sent } = inspection;
	const rows = useMemo(() => headers ? playgroundHeaderSourceRows(headers, sources) : [], [headers, sources]);
	return (
		<section className="shrink-0 space-y-1.5">
			<h3 className="text-xs font-medium text-gray-700">{t('sentHeaders')}</h3>
			{rows.length ? (
				<dl className="max-h-32 divide-y divide-gray-100 overflow-auto rounded-lg border border-gray-200">
					{rows.map(({ name, value, source }) => (
						<div key={name} className="flex flex-wrap items-start justify-between gap-x-3 gap-y-1 px-3 py-1.5">
							<div className="min-w-0 flex-1 break-all font-mono text-xs leading-5 text-gray-700">
								<dt className="inline font-medium">{name}</dt>
								<dd className="inline text-gray-600">: {value}</dd>
							</div>
							{source && <SourceLabel source={source} />}
						</div>
					))}
				</dl>
			) : (
				<p className="rounded-lg border border-gray-200 px-3 py-2 text-xs text-gray-500">
					{!hasRoute ? common('selectRouteFirst') : loading ? common('loading')
						: sent ? t('sentHeadersEmpty') : t('inspectionUnavailable')}
				</p>
			)}
		</section>
	);
}

export function PlaygroundInspectionBody({ inspection }: { inspection: Inspection }) {
	const t = useTranslations('playground');
	const common = useTranslations('common');
	const { body, invalid, hasRoute, loading, sent, sources } = inspection;
	const rows = useMemo(() => body ? playgroundBodySourceRows(body, sources) : [], [body, sources]);
	const fallback = !hasRoute ? common('selectRouteFirst')
		: invalid ? t('inspectionInvalidBody') : loading ? common('loading') : t('inspectionUnavailable');
	return (
		<section className="flex min-h-44 flex-[2] flex-col gap-1.5">
			<header className="flex items-center justify-between gap-2">
				<h3 className="text-xs font-medium text-gray-700">{t('inspectionBodyActual')}</h3>
				{body && <span className="text-xs text-gray-500">{t(sent ? 'sentBodySourceSent' : 'sentBodySourcePreview')}</span>}
			</header>
			{body ? (
				<div
					tabIndex={0}
					aria-label={t('inspectionBodyActual')}
					className="max-h-72 min-h-0 flex-1 overflow-auto overscroll-contain rounded-lg border border-gray-200 bg-slate-50/60 xl:max-h-none"
				>
					{rows.length > 0 && (
						<ul aria-label={t('inspectionFieldSources')} className="space-y-1.5 border-b border-gray-200 bg-white px-3 py-2">
							{rows.map(({ path, source }) => (
								<li key={path} className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1">
									<code className="min-w-0 break-all text-xs text-gray-700">{path}</code>
									<SourceLabel source={source} />
								</li>
							))}
						</ul>
					)}
					<pre className="whitespace-pre-wrap break-words p-3 font-mono text-xs leading-6 text-gray-800">{body}</pre>
				</div>
			) : (
				<p className="flex-1 rounded-lg border border-gray-200 bg-gray-50 p-3 text-xs text-gray-500">{fallback}</p>
			)}
		</section>
	);
}
