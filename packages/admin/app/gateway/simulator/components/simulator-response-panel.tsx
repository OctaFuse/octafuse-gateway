'use client';

import type { RefObject } from 'react';
import Link from 'next/link';
import { ArrowDownTrayIcon, ArrowTopRightOnSquareIcon } from '@heroicons/react/24/outline';
import { useTranslations } from 'next-intl';
import { ImageGenerationsPreview } from '@/components/image-generations-preview';
import type { ImagePreviewItem } from '@/lib/image-generations';
import { buildRequestLogsHref, buildToolsInvocationsHref } from '../simulator-utils';
import type { ResponseMeta, ResponseTab, SimulatorProtocol } from '../types';

import { LlmResponseContent } from '@/components/model-test/llm-response-content';
import type { ResponsePreview } from '@/lib/playground/response-preview';

type Props = {
	llm: boolean;
	responsePreview: ResponsePreview;
	sending: boolean;
	interrupted: boolean;
	responseMeta: ResponseMeta | null;
	responseText: string;
	usageHint: string | null;
	imagePreviews: ImagePreviewItem[];
	audioPreviewUrl: string | null;
	responseTab: ResponseTab;
	onResponseTabChange: (tab: ResponseTab) => void;
	mergedReasoningDisplay: string;
	mergedBodyDisplay: string;
	streamEndRef: RefObject<HTMLSpanElement>;
	mergedStreamEndRef: RefObject<HTMLSpanElement>;
	selectedKeyId: string;
	selectedModelId: string;
	routeGroup: string;
	protocol: SimulatorProtocol;
	isToolKind?: boolean;
	selectedToolId?: string;
};

export function SimulatorResponsePanel({
	llm,
	responsePreview,
	sending,
	interrupted,
	responseMeta,
	responseText,
	usageHint,
	imagePreviews,
	audioPreviewUrl,
	responseTab,
	onResponseTabChange,
	mergedReasoningDisplay,
	mergedBodyDisplay,
	streamEndRef,
	mergedStreamEndRef,
	selectedKeyId,
	selectedModelId,
	routeGroup,
	protocol,
	isToolKind = false,
	selectedToolId = '',
}: Props) {
	const t = useTranslations('simulator');
	const hasContent = Boolean(
		sending || responseMeta || responseText || imagePreviews.length > 0 || audioPreviewUrl
	);
	const isImageResponse = imagePreviews.length > 0;
	const isAudioResponse = Boolean(audioPreviewUrl);
	const logsHref = isToolKind
		? buildToolsInvocationsHref({ toolId: selectedToolId || undefined })
		: buildRequestLogsHref({
				apiKeyId: selectedKeyId || undefined,
				modelId: selectedModelId || undefined,
				routeGroup: routeGroup || 'default',
				protocol,
		  });
	const logsLinkLabel = isToolKind ? t('openToolsInvocations') : t('openRequestLogs');

	return (
		<section className="flex h-full min-h-0 flex-col overflow-hidden rounded-xl border border-gray-200 bg-white">
			<div className="flex min-h-[57px] shrink-0 flex-wrap items-center justify-between gap-x-3 gap-y-2 border-b border-gray-100 px-4 py-2.5">
				<h2 className="text-sm font-medium text-gray-900 shrink-0">{t('response')}</h2>
				{responseMeta ? (
					<div className="flex flex-wrap items-center justify-end gap-2 text-xs min-w-0">
						<span
							className={`inline-flex items-center rounded-md px-2 py-1 font-medium tabular-nums ${
								responseMeta.status >= 400 ? 'bg-red-50 text-red-700' : 'bg-emerald-50 text-emerald-700'
							}`}
						>
							HTTP {responseMeta.status}
						</span>
						{responseMeta.latencyMs != null ? (
							<span className="inline-flex items-center rounded-full bg-gray-100 px-2.5 py-1 font-medium text-gray-800">
								{responseMeta.latencyMs} ms
							</span>
						) : null}
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

			{hasContent ? (
				<div className="flex min-h-0 flex-1 flex-col gap-3 p-4">
					<div className="flex flex-wrap items-center gap-2 border-b border-gray-100 pb-2">
						{(
							[
								['merged', t('tabMerged')],
								['raw', t('tabRaw')],
							] as const
						).map(([id, label]) => (
							<button
								key={id}
								type="button"
								onClick={() => onResponseTabChange(id)}
								aria-pressed={responseTab === id}
								className={`px-3 py-1 text-xs font-medium rounded-md ${
									responseTab === id
										? 'bg-slate-800 text-white'
										: 'bg-gray-100 text-gray-700 hover:bg-gray-200'
								}`}
							>
								{label}
							</button>
						))}
					</div>

					{usageHint ? (
						<div className="shrink-0 text-xs leading-5 text-green-800">
							<span className="font-medium">{t('usagePreview')}</span>
							{usageHint}
						</div>
					) : null}

					{llm ? (
						<LlmResponseContent
							preview={responsePreview}
							text={responseText}
							view={responseTab}
							sending={sending}
							interrupted={interrupted}
						/>
					) : responseTab === 'merged' ? (
						isImageResponse ? (
							<div className="min-h-0 flex-1 overflow-auto">
								<ImageGenerationsPreview images={imagePreviews} label={t('imagePreview')} />
							</div>
						) : isAudioResponse ? (
							<div className="rounded-md border border-slate-200 bg-slate-50 p-4 space-y-3">
								<div className="text-sm font-medium text-gray-800">{t('audioPreview')}</div>
								<audio className="w-full" controls src={audioPreviewUrl ?? undefined} />
								<a
									href={audioPreviewUrl ?? undefined}
									download="speech-output"
									className="inline-flex text-xs font-medium text-gray-800 hover:text-gray-950 hover:underline"
								>
									{t('downloadAudio')}
								</a>
							</div>
						) : (
							<div className="rounded-md border border-slate-200 overflow-hidden divide-y divide-slate-200">
								<div>
									<div className="text-xs font-medium text-amber-900/85 normal-case tracking-normal px-3 py-1.5 bg-amber-50 border-b border-amber-100">
										{t('thinkingReasoning')}
									</div>
									<pre className="max-h-[min(200px,28vh)] overflow-auto p-3 bg-amber-50/60 text-sm text-gray-900 font-mono whitespace-pre-wrap break-words">
										{mergedReasoningDisplay}
									</pre>
								</div>
								<div>
									<div className="text-xs font-medium text-slate-600 normal-case tracking-normal px-3 py-1.5 bg-slate-50 border-b border-slate-100">
										{t('body')}
									</div>
									<pre className="max-h-[min(320px,42vh)] overflow-auto p-3 bg-slate-50 text-sm text-gray-900 font-mono whitespace-pre-wrap break-words">
										{mergedBodyDisplay}
										<span
											ref={mergedStreamEndRef}
											className="inline-block w-0 h-0 overflow-hidden"
											aria-hidden
										/>
									</pre>
								</div>
							</div>
						)
					) : (
						<pre className="min-h-0 flex-1 overflow-auto p-4 bg-gray-50 border border-gray-200 rounded-md text-xs text-gray-900 font-mono whitespace-pre-wrap break-words">
							{responseText}
							<span ref={streamEndRef} className="inline-block w-0 h-0 overflow-hidden" aria-hidden />
						</pre>
					)}
				</div>
			) : (
				<div className="flex min-h-[280px] flex-1 flex-col items-center justify-center gap-4 px-6 py-12 text-center">
					<span className="flex h-12 w-12 items-center justify-center rounded-2xl bg-gray-50 text-gray-400">
						<ArrowDownTrayIcon className="h-5 w-5" aria-hidden />
					</span>
					<p className="max-w-64 text-xs leading-6 text-gray-500">{t('emptyResponseHint')}</p>
				</div>
			)}
			{(isToolKind || selectedModelId) && (
				<footer className="flex shrink-0 justify-end border-t border-gray-100 px-4 py-3">
					<Link
						href={logsHref}
						className="inline-flex items-center gap-1.5 text-xs text-gray-500 hover:text-gray-950"
					>
						{logsLinkLabel}
						<ArrowTopRightOnSquareIcon className="h-3.5 w-3.5" aria-hidden />
					</Link>
				</footer>
			)}
		</section>
	);
}
