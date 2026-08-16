'use client';

import { useState, type RefObject } from 'react';
import { QuestionMarkCircleIcon } from '@heroicons/react/24/outline';
import { useTranslations } from 'next-intl';
import { ImageGenerationsPreview } from '@/components/image-generations-preview';
import type { ImagePreviewItem } from '@/lib/image-generations';
import type { ObservationTag } from '@/lib/playground/response-observations';
import type { ResponseMeta, ResponseTab } from '../types';

type ObservationHelpTone = ObservationTag['tone'];

const OBSERVATION_HELP_GROUPS = [
	{
		titleKey: 'obsHelpGroupShape',
		noteKey: 'obsHelpGroupShapeNote',
		wide: false,
		rows: [
			{ labelKey: 'obsShapeSse', helpKey: 'obsHelpShapeSse', tone: 'neutral' as const },
			{ labelKey: 'obsShapeJson', helpKey: 'obsHelpShapeJson', tone: 'neutral' as const },
			{ labelKey: 'obsShapeNdjson', helpKey: 'obsHelpShapeNdjson', tone: 'neutral' as const },
		],
	},
	{
		titleKey: 'obsHelpGroupBody',
		noteKey: 'obsHelpGroupBodyNote',
		wide: false,
		rows: [
			{ labelKey: 'obsBodyDeltas', helpKey: 'obsHelpBodyDeltas', tone: 'neutral' as const },
			{ labelKey: 'obsBody', helpKey: 'obsHelpBody', tone: 'neutral' as const },
			{ labelKey: 'obsEmptyBody', helpKey: 'obsHelpEmptyBody', tone: 'muted' as const },
		],
	},
	{
		titleKey: 'obsHelpGroupReasoning',
		noteKey: 'obsHelpGroupReasoningNote',
		wide: false,
		rows: [{ labelKey: 'obsReasoning', helpKey: 'obsHelpReasoning', tone: 'neutral' as const }],
	},
	{
		titleKey: 'obsHelpGroupTool',
		noteKey: 'obsHelpGroupToolNote',
		wide: false,
		rows: [
			{ labelKey: 'obsToolIncremental', helpKey: 'obsHelpToolIncremental', tone: 'positive' as const },
			{ labelKey: 'obsToolBulk', helpKey: 'obsHelpToolBulk', tone: 'warning' as const },
			{ labelKey: 'obsTool', helpKey: 'obsHelpTool', tone: 'neutral' as const },
			{ labelKey: 'obsNoTool', helpKey: 'obsHelpNoTool', tone: 'muted' as const },
		],
	},
	{
		titleKey: 'obsHelpGroupFinish',
		noteKey: 'obsHelpGroupFinishNote',
		wide: true,
		rows: [{ labelKey: 'obsHelpFinishLabel', helpKey: 'obsHelpFinish', tone: 'muted' as const }],
	},
] as const;

function observationChipClass(tone: ObservationHelpTone): string {
	if (tone === 'positive') return 'bg-green-100 text-green-800';
	if (tone === 'warning') return 'bg-amber-100 text-amber-900';
	if (tone === 'muted') return 'bg-gray-200 text-gray-700';
	return 'bg-slate-100 text-slate-800';
}

type Props = {
	responseMeta: ResponseMeta | null;
	responseText: string;
	usageHint: string | null;
	imagePreviews: ImagePreviewItem[];
	audioPreviewUrl: string | null;
	responseTab: ResponseTab;
	onResponseTabChange: (tab: ResponseTab) => void;
	observationTags: ObservationTag[];
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
	observationTags,
	mergedReasoningDisplay,
	mergedBodyDisplay,
	streamEndRef,
	mergedStreamEndRef,
}: Props) {
	const t = useTranslations('playground');
	const [obsHelpOpen, setObsHelpOpen] = useState(false);
	const hasContent = Boolean(responseMeta || responseText || imagePreviews.length > 0 || audioPreviewUrl);
	const isImageResponse = imagePreviews.length > 0;
	const isAudioResponse = Boolean(audioPreviewUrl);

	return (
		<section className="flex min-h-0 flex-1 flex-col space-y-3 overflow-hidden rounded-xl border border-gray-200/80 bg-white p-4 shadow-sm">
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
				<div className="flex min-h-0 flex-1 flex-col gap-3">
					{responseMeta?.upstreamUrl ? (
						<div className="shrink-0 break-all text-xs text-gray-500">
							<span className="font-medium text-gray-600">{t('upstream')}</span>
							{responseMeta.upstreamUrl}
						</div>
					) : null}

					<div className="flex shrink-0 flex-wrap items-center gap-2 border-b border-gray-100 pb-2">
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

					{observationTags.length > 0 ? (
						<div className="shrink-0 space-y-2">
							<div className="flex flex-wrap items-center gap-1.5">
								{observationTags.map((tag) => {
									const label =
										tag.id === 'finish'
											? t(tag.messageKey, { reason: tag.finishReason ?? '' })
											: tag.count != null
												? t(tag.messageKey, { count: tag.count })
												: t(tag.messageKey);
									return (
										<span
											key={tag.id}
											className={`inline-flex items-center rounded-full px-2.5 py-1 text-xs font-medium ${observationChipClass(tag.tone)}`}
										>
											{label}
										</span>
									);
								})}
								<button
									type="button"
									onClick={() => setObsHelpOpen((open) => !open)}
									aria-expanded={obsHelpOpen}
									title={t('obsHelpTitle')}
									className="inline-flex h-6 w-6 items-center justify-center rounded-full text-slate-500 hover:bg-slate-100 hover:text-slate-800"
								>
									<QuestionMarkCircleIcon className="h-4 w-4" aria-hidden />
									<span className="sr-only">{t('obsHelpTitle')}</span>
								</button>
							</div>
							{obsHelpOpen ? (
								<div className="max-h-80 overflow-y-auto rounded-md border border-slate-200 bg-white px-3 py-2.5 text-xs text-slate-700">
									<p className="mb-2 text-slate-500">{t('obsHelpIntro')}</p>
									<div className="grid gap-2 sm:grid-cols-2">
										{OBSERVATION_HELP_GROUPS.map((group) => (
											<section
												key={group.titleKey}
												className={`rounded-lg border border-slate-200 bg-slate-50/80 p-2.5 ${group.wide ? 'sm:col-span-2' : ''}`}
											>
												<div className="mb-2 flex items-baseline justify-between gap-2">
													<h3 className="font-semibold text-slate-800">{t(group.titleKey)}</h3>
													<span className="shrink-0 text-[11px] text-slate-400">{t(group.noteKey)}</span>
												</div>
												<ul className="space-y-1.5">
													{group.rows.map((row) => (
														<li key={row.helpKey} className="flex items-start gap-2">
															<span
																className={`mt-0.5 inline-flex shrink-0 items-center rounded-full px-2 py-0.5 text-[11px] font-medium ${observationChipClass(row.tone)}`}
															>
																{row.labelKey === 'obsBodyDeltas'
																	? t(row.labelKey, { count: 'N' })
																	: t(row.labelKey)}
															</span>
															<span className="min-w-0 leading-5 text-slate-600">{t(row.helpKey)}</span>
														</li>
													))}
												</ul>
											</section>
										))}
									</div>
								</div>
							) : null}
						</div>
					) : null}

					{usageHint ? (
						<div className="shrink-0 rounded-md border border-green-200 bg-green-50 p-2.5 text-sm text-green-900">
							<span className="font-semibold">{t('usageDisplayOnly')}</span>
							{usageHint}
						</div>
					) : null}

					{responseTab === 'merged' ? (
						isImageResponse ? (
							<div className="min-h-0 flex-1 overflow-auto">
								<ImageGenerationsPreview images={imagePreviews} label={t('imagePreview')} />
							</div>
						) : isAudioResponse ? (
							<div className="min-h-0 flex-1 space-y-3 overflow-auto rounded-md border border-slate-200 bg-slate-50 p-4">
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
							<div className="flex min-h-0 flex-1 flex-col overflow-hidden rounded-md border border-slate-200">
								<div className="flex min-h-0 flex-[0.4] flex-col">
									<div className="shrink-0 border-b border-amber-100 bg-amber-50 px-3 py-1.5 text-[11px] font-semibold uppercase tracking-wide text-amber-900/85">
										{t('thinking')}
									</div>
									<pre className="min-h-0 flex-1 overflow-auto whitespace-pre-wrap break-words bg-amber-50/60 p-3 font-mono text-sm text-gray-900">
										{mergedReasoningDisplay}
									</pre>
								</div>
								<div className="flex min-h-0 flex-1 flex-col border-t border-slate-200">
									<div className="shrink-0 border-b border-slate-100 bg-slate-50 px-3 py-1.5 text-[11px] font-semibold uppercase tracking-wide text-slate-600">
										{t('body')}
									</div>
									<pre className="min-h-0 flex-1 overflow-auto whitespace-pre-wrap break-words bg-slate-50 p-3 font-mono text-sm text-gray-900">
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
						<pre className="min-h-0 flex-1 overflow-auto whitespace-pre-wrap break-words rounded-md border border-gray-200 bg-gray-50 p-4 font-mono text-xs text-gray-900">
							{responseText}
							<span ref={streamEndRef} className="inline-block h-0 w-0 overflow-hidden" aria-hidden />
						</pre>
					)}
				</div>
			) : (
				<p className="min-h-0 flex-1 text-sm text-gray-500">{t('emptyResponseHint')}</p>
			)}
		</section>
	);
}
