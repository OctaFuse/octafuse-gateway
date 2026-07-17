'use client';

import type { RefObject } from 'react';
import Link from 'next/link';
import { useTranslations } from 'next-intl';
import { ImageGenerationsPreview } from '@/components/image-generations-preview';
import type { ImagePreviewItem } from '@/lib/image-generations';
import { buildRequestLogsHref } from '../simulator-utils';
import type { ResponseMeta, ResponseTab, SimulatorProtocol } from '../types';

type Props = {
	responseMeta: ResponseMeta | null;
	responseText: string;
	usageHint: string | null;
	imagePreviews: ImagePreviewItem[];
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
};

export function SimulatorResponsePanel({
	responseMeta,
	responseText,
	usageHint,
	imagePreviews,
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
}: Props) {
	const t = useTranslations('simulator');
	const hasContent = Boolean(responseMeta || responseText || imagePreviews.length > 0);
	const isImageResponse = imagePreviews.length > 0;
	const logsHref = buildRequestLogsHref({
		apiKeyId: selectedKeyId || undefined,
		modelId: selectedModelId || undefined,
		routeGroup: routeGroup || undefined,
		protocol,
	});

	return (
		<section className="rounded-xl border border-gray-200/80 bg-white p-4 shadow-sm space-y-3 flex flex-col min-h-0">
			<div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-2">
				<h2 className="text-sm font-semibold text-gray-900 shrink-0">{t('response')}</h2>
				{responseMeta ? (
					<div className="flex flex-wrap items-center justify-end gap-2 text-xs min-w-0">
						<span className="inline-flex items-center rounded-full bg-gray-100 px-2.5 py-1 font-medium text-gray-800">
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
				<>
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
								className={`px-3 py-1 text-xs font-medium rounded-md ${
									responseTab === id
										? 'bg-slate-800 text-white'
										: 'bg-gray-100 text-gray-700 hover:bg-gray-200'
								}`}
							>
								{label}
							</button>
						))}
						<Link
							href={logsHref}
							className="ml-auto text-xs font-medium text-blue-700 hover:text-blue-900 hover:underline"
						>
							{t('openRequestLogs')}
						</Link>
					</div>

					{usageHint ? (
						<div className="p-2.5 rounded-md bg-green-50 border border-green-200 text-sm text-green-900">
							<span className="font-semibold">{t('usagePreview')}</span>
							{usageHint}
						</div>
					) : null}

					{responseTab === 'merged' ? (
						isImageResponse ? (
							<ImageGenerationsPreview images={imagePreviews} label={t('imagePreview')} />
						) : (
						<div className="rounded-md border border-slate-200 overflow-hidden divide-y divide-slate-200">
							<div>
								<div className="text-[11px] font-semibold text-amber-900/85 uppercase tracking-wide px-3 py-1.5 bg-amber-50 border-b border-amber-100">
									{t('thinkingReasoning')}
								</div>
								<pre className="max-h-[min(200px,28vh)] overflow-auto p-3 bg-amber-50/60 text-sm text-gray-900 font-mono whitespace-pre-wrap break-words">
									{mergedReasoningDisplay}
								</pre>
							</div>
							<div>
								<div className="text-[11px] font-semibold text-slate-600 uppercase tracking-wide px-3 py-1.5 bg-slate-50 border-b border-slate-100">
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
						<pre className="max-h-[min(520px,55vh)] overflow-auto p-4 bg-gray-50 border border-gray-200 rounded-md text-xs text-gray-900 font-mono whitespace-pre-wrap break-words">
							{responseText}
							<span ref={streamEndRef} className="inline-block w-0 h-0 overflow-hidden" aria-hidden />
						</pre>
					)}
				</>
			) : (
				<p className="text-sm text-gray-500">{t('emptyResponseHint')}</p>
			)}
		</section>
	);
}
