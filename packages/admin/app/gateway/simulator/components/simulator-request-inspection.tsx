'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useTranslations } from 'next-intl';
import { readApiJson } from '@/lib/api-json';
import { configuredBodySourceRows } from '@/lib/playground/request-sources';
import type { GatewayRequestLog } from '@/lib/types';
import { readLogObject } from '../../request-logs/request-log-flow-data';
import { prettyJsonBody } from '../simulator-utils';
import type { SimulatorProtocol, WirePreview } from '../types';

type Source = 'key' | 'protocol' | 'selection' | 'input' | 'provider' | 'route';

const sourceStyle: Record<Source, string> = {
	key: 'bg-gray-100 text-gray-700',
	protocol: 'bg-gray-100 text-gray-700',
	selection: 'bg-indigo-50 text-indigo-800',
	input: 'bg-gray-100 text-gray-700',
	provider: 'bg-sky-50 text-sky-800',
	route: 'bg-amber-50 text-amber-800',
};

function SourceRows({ rows }: { rows: { name: string; value?: string; source: Source }[] }) {
	const t = useTranslations('simulator.inspection.source');
	return (
		<dl className="max-h-32 shrink-0 divide-y divide-gray-100 overflow-auto rounded-lg border border-gray-200 bg-white">
			{rows.map(({ name, value, source }) => (
				<div key={name} className="flex flex-wrap items-start justify-between gap-x-3 gap-y-1 px-3 py-1.5">
					<div className="min-w-0 flex-1 break-all font-mono text-xs leading-5 text-gray-700">
						<dt className="inline font-medium">{name}</dt>
						{value !== undefined && <dd className="inline text-gray-600">: {value}</dd>}
					</div>
					<dd className={`shrink-0 rounded px-1.5 py-0.5 text-[11px] font-medium ${sourceStyle[source]}`}>
						{t(source)}
					</dd>
				</div>
			))}
		</dl>
	);
}

export function SimulatorGatewayHeaders({ wire }: { wire: WirePreview | null }) {
	const t = useTranslations('simulator');
	return (
		<section className="shrink-0 space-y-1.5">
			<h3 className="text-xs font-medium text-gray-700">{t('inspection.gatewayHeaders')}</h3>
			{wire ? <SourceRows rows={Object.entries(wire.headers).map(([name, value]) => ({
				name,
				value,
				source: /^(authorization|sec-websocket-protocol)$/i.test(name) ? 'key' : 'protocol',
			}))} /> : <p className="text-xs text-gray-500">{t('wirePreviewEmpty')}</p>}
		</section>
	);
}

function useRequestLog(id: string | null | undefined, keyId: string, sending: boolean) {
	const [result, setResult] = useState<{ id: string; keyId: string; log: GatewayRequestLog | null } | null>(null);
	useEffect(() => {
		if (!id || !keyId || sending) return;
		const controller = new AbortController();
		const query = new URLSearchParams({ id, api_key_id: keyId, page_size: '1' });
		let timer: number | undefined;
		async function findLog(remaining: number) {
			try {
				const res = await fetch(`/api/admin/request-logs?${query}`, { signal: controller.signal, cache: 'no-store' });
				const payload = await readApiJson<GatewayRequestLog[]>(res);
				if (controller.signal.aborted || !id) return;
				const log = payload.success && payload.data?.find((row) => row.id === id && row.api_key_id === keyId);
				if (log) {
					setResult({ id, keyId, log });
				} else if (payload.success && remaining > 1) {
					timer = window.setTimeout(() => void findLog(remaining - 1), 750);
				} else {
					setResult({ id, keyId, log: null });
				}
			} catch {
				if (!controller.signal.aborted && id) setResult({ id, keyId, log: null });
			}
		}
		void findLog(5);
		return () => {
			controller.abort();
			window.clearTimeout(timer);
		};
	}, [id, keyId, sending]);
	return result?.id === id && result?.keyId === keyId ? result : null;
}

function upstreamHeaderRows(value: unknown): { name: string; source: Source }[] {
	if (!Array.isArray(value)) return [];
	return value.flatMap((item) => {
		const name: unknown = item?.name;
		const source: unknown = item?.source;
		return typeof name === 'string' && (source === 'input' || source === 'provider' || source === 'route')
			? [{ name, source }]
			: [];
	});
}

function RequestCode({ text }: { text: string }) {
	return <pre className="whitespace-pre-wrap break-words font-mono text-xs leading-6 text-gray-800">{text}</pre>;
}

function UpstreamRequest({ id, keyId, sending, sent }: { id?: string | null; keyId: string; sending: boolean; sent: boolean }) {
	const t = useTranslations('simulator.inspection');
	const result = useRequestLog(id, keyId, sending);
	const log = result?.log;
	const snapshot = log && (log.final_upstream_headers_ms != null || log.status === 'success') ? log.upstream_request_body : null;
	const trace = readLogObject(log?.route_trace);
	const sources = trace?.request_sources as { body?: unknown; headers?: unknown } | undefined;
	const headers = upstreamHeaderRows(sources?.headers);
	const fieldRows = snapshot && typeof sources?.body === 'string'
		? configuredBodySourceRows(snapshot, sources.body).map(({ path, source }) => ({
			name: path,
			source: source === 'p' ? 'provider' as const : 'route' as const,
		}))
		: [];
	return (
		<div className="space-y-2">
			{snapshot ? (
				<>
					<p className="break-words text-xs text-gray-600">
						{[log?.provider_name || log?.provider_id, log?.provider_model_name].filter(Boolean).join(' · ')}
					</p>
					<p className="text-xs text-gray-500">{t('upstreamSnapshot')}</p>
					{headers.length > 0 && (
						<>
							<h4 className="text-xs font-medium text-gray-700">{t('upstreamHeaderSources')}</h4>
							<SourceRows rows={headers} />
						</>
					)}
					{fieldRows.length > 0 && (
						<>
							<h4 className="text-xs font-medium text-gray-700">{t('upstreamBodySources')}</h4>
							<SourceRows rows={fieldRows} />
						</>
					)}
					{!sources && <p className="text-xs text-gray-500">{t('sourcesUnavailable')}</p>}
					<RequestCode text={prettyJsonBody(snapshot)} />
				</>
			) : (
				<p className="text-xs leading-5 text-gray-500">
					{t(sending || (id && !result) ? 'waitingForLog' : id || sent ? 'snapshotUnavailable' : 'upstreamAfterSend')}
				</p>
			)}
			{id && (
				<Link className="inline-block text-xs font-medium text-blue-700 hover:underline" href={`/gateway/request-logs?${new URLSearchParams({ id, api_key_id: keyId })}`}>
					{t('openThisLog')}
				</Link>
			)}
		</div>
	);
}

export function SimulatorActualRequest({
	wire,
	wireSent,
	protocol,
	tool,
	showUpstream,
	requestLogId,
	selectedKeyId,
	sending,
}: {
	wire: WirePreview | null;
	wireSent: boolean;
	protocol: SimulatorProtocol;
	tool: boolean;
	showUpstream: boolean;
	requestLogId?: string | null;
	selectedKeyId: string;
	sending: boolean;
}) {
	const t = useTranslations('simulator.inspection');
	const common = useTranslations('simulator');
	const [view, setView] = useState<'gateway' | 'upstream'>('gateway');
	const upstream = showUpstream && view === 'upstream';
	const modelField = tool || !wire ? null
		: protocol === 'gemini' ? t('modelInPath')
		: protocol === 'elevenlabs' ? wire.method === 'WebSocket' ? t('modelInQuery', { field: 'model_id' }) : 'model_id'
		: wire.method === 'WebSocket'
			? new URL(wire.url).searchParams.has('model') ? t('modelInQuery', { field: 'model' }) : 'payload.model'
			: 'model';
	return (
		<section className="flex min-h-44 flex-[2] flex-col gap-1.5">
			<header className="flex flex-wrap items-center justify-between gap-2">
				<h3 className="text-xs font-medium text-gray-700">{t('actualBody')}</h3>
				{showUpstream && (
					<div role="group" aria-label={t('actualBody')} className="inline-flex rounded-md border border-gray-200 bg-gray-50 p-0.5">
						{(['gateway', 'upstream'] as const).map((stage) => (
							<button key={stage} type="button" aria-pressed={view === stage} onClick={() => setView(stage)}
								className={`rounded px-2 py-1 text-xs ${view === stage ? 'bg-white font-medium text-gray-900 shadow-sm' : 'text-gray-600 hover:text-gray-900'}`}>
								{t(stage)}
							</button>
						))}
					</div>
				)}
			</header>
			<div tabIndex={0} aria-label={t(upstream ? 'upstream' : 'gateway')}
				className="max-h-80 min-h-0 flex-1 space-y-2 overflow-auto overscroll-contain rounded-lg border border-gray-200 bg-slate-50/60 p-3 xl:max-h-none">
				{upstream ? (
					<UpstreamRequest id={requestLogId} keyId={selectedKeyId} sending={sending} sent={wireSent} />
				) : wire ? (
					<>
						<div className="flex items-start justify-between gap-2 text-xs">
							<p className="font-medium text-gray-700">{t('gateway')}</p>
							<span className="shrink-0 text-gray-500">{t(wireSent ? 'submitted' : 'preview')}</span>
						</div>
						{modelField && <SourceRows rows={[{ name: modelField, source: 'selection' }]} />}
						<p className="text-xs text-gray-500">{t(wire.isMultipart ? 'multipartSource' : wire.method === 'WebSocket' ? 'frameSource' : 'inputSource')}</p>
						<RequestCode text={wire.isMultipart ? wire.bodyText : prettyJsonBody(wire.bodyText)} />
					</>
				) : (
					<p className="text-xs text-gray-500">{common('wirePreviewEmpty')}</p>
				)}
			</div>
		</section>
	);
}
