'use client';

import type { RefObject } from 'react';
import { useTranslations } from 'next-intl';
import { ImageGenerationsPreview } from '@/components/image-generations-preview';
import type { ImagePreviewItem } from '@/lib/image-generations';
import type { ResponseMeta, ResponseTab } from '../types';

type Props = {
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
};

export function PlaygroundResponsePanel({
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
}: Props) {
	const t = useTranslations('playground');
	const hasContent = Boolean(responseMeta || responseText || imagePreviews.length > 0 || audioPreviewUrl);
	const isImageResponse = imagePreviews.length > 0;
	const isAudioResponse = Boolean(audioPreviewUrl);

	return (
		<section className="flex min-h-0 flex-col space-y-3 rounded-xl border border-gray-200/80 bg-white p-4 shadow-sm">
			<div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-2">
				<h2 className="shrink-0 text-sm font-semibold text-gray-900">{t('response')}</h2>
				{responseMeta ? (
					<div className="flex min-w-0 flex-wrap items-center justify-end gap-2 text-xs">
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
								className="inline-flex max-w-full items-center truncate rounded-full bg-gray-100 px-2.5 py-1 font-medium text-gray-700"
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
					{responseMeta?.upstreamUrl ? (
						<div className="break-all text-xs text-gray-500">
							<span className="font-medium text-gray-600">{t('upstream')}</span>
							{responseMeta.upstreamUrl}
						</div>
					) : null}

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
								className={`rounded-md px-3 py-1 text-xs font-medium ${
									responseTab === id ? 'bg-slate-800 text-white' : 'bg-gray-100 text-gray-700 hover:bg-gray-200'
								}`}
							>
								{label}
							</button>
						))}
					</div>

					{usageHint ? (
						<div className="rounded-md border border-green-200 bg-green-50 p-2.5 text-sm text-green-900">
							<span className="font-semibold">{t('usageDisplayOnly')}</span>
							{usageHint}
						</div>
					) : null}

					{responseTab === 'merged' ? (
						isImageResponse ? (
							<ImageGenerationsPreview images={imagePreviews} label={t('imagePreview')} />
						) : isAudioResponse ? (
							<div className="space-y-3 rounded-md border border-slate-200 bg-slate-50 p-4">
								<div className="text-sm font-medium text-gray-800">{t('audioPreview')}</div>
								<audio className="w-full" controls src={audioPreviewUrl ?? undefined} />
								<a
									href={audioPreviewUrl ?? undefined}
									download="speech-output"
									className="inline-flex text-xs font-medium text-blue-700 hover:text-blue-900 hover:underline"
								>
									{t('downloadAudio')}
								</a>
							</div>
						) : (
							<div className="divide-y divide-slate-200 overflow-hidden rounded-md border border-slate-200">
								<div>
									<div className="border-b border-amber-100 bg-amber-50 px-3 py-1.5 text-[11px] font-semibold uppercase tracking-wide text-amber-900/85">
										{t('thinking')}
									</div>
									<pre className="max-h-[min(200px,28vh)] overflow-auto whitespace-pre-wrap break-words bg-amber-50/60 p-3 font-mono text-sm text-gray-900">
										{mergedReasoningDisplay}
									</pre>
								</div>
								<div>
									<div className="border-b border-slate-100 bg-slate-50 px-3 py-1.5 text-[11px] font-semibold uppercase tracking-wide text-slate-600">
										{t('body')}
									</div>
									<pre className="max-h-[min(320px,42vh)] overflow-auto whitespace-pre-wrap break-words bg-slate-50 p-3 font-mono text-sm text-gray-900">
										{mergedBodyDisplay}
										<span
											ref={mergedStreamEndRef}
											className="inline-block h-0 w-0 overflow-hidden"
											aria-hidden
										/>
									</pre>
								</div>
							</div>
						)
					) : (
						<pre className="max-h-[min(520px,55vh)] overflow-auto whitespace-pre-wrap break-words rounded-md border border-gray-200 bg-gray-50 p-4 font-mono text-xs text-gray-900">
							{responseText}
							<span ref={streamEndRef} className="inline-block h-0 w-0 overflow-hidden" aria-hidden />
						</pre>
					)}
				</>
			) : (
				<p className="text-sm text-gray-500">{t('emptyResponseHint')}</p>
			)}
		</section>
	);
}
