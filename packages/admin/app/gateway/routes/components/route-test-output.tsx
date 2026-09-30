'use client';

import { useLayoutEffect, useRef, useState } from 'react';
import { BeakerIcon } from '@heroicons/react/24/outline';
import { useTranslations } from 'next-intl';
import { ImageGenerationsPreview } from '@/components/image-generations-preview';
import type { ImagePreviewItem } from '@/lib/image-generations';
import type { ResponsePreview } from '@/lib/playground/response-preview';
import type { ResponseMeta } from '../../playground/types';
import { editorPanelClass, RouteEditorSectionHeader } from './route-editor-ui';

/** Each output follows its own tail; scrolling up pauses following until the user returns to the bottom. */
function LiveText({
	text,
	label,
	className = '',
	scroll = false,
}: {
	text: string;
	label: string;
	className?: string;
	scroll?: boolean;
}) {
	const ref = useRef<HTMLPreElement>(null);
	const follow = useRef(true);
	useLayoutEffect(() => {
		if (!text) follow.current = true;
		if (scroll && ref.current && follow.current) ref.current.scrollTop = ref.current.scrollHeight;
	}, [text, scroll]);
	return (
		<pre
			ref={ref}
			tabIndex={scroll ? 0 : undefined}
			aria-label={label}
			onScroll={(e) => {
				const el = e.currentTarget;
				follow.current = el.scrollHeight - el.scrollTop - el.clientHeight < 32;
			}}
			className={`${
				scroll ? 'min-h-0 flex-1 overflow-auto overscroll-contain' : ''
			} whitespace-pre-wrap break-words font-mono text-xs leading-6 text-gray-700 outline-none focus-visible:ring-2 focus-visible:ring-blue-500 ${className}`}
		>
			{text}
		</pre>
	);
}

export function RouteTestOutput({
	visibleOnMobile,
	meta,
	sending,
	stopped,
	stale,
	responseText,
	audioUrl,
	images,
	preview,
	showStream,
}: {
	visibleOnMobile: boolean;
	meta: ResponseMeta | null;
	sending: boolean;
	stopped: boolean;
	stale: boolean;
	responseText: string;
	audioUrl: string | null;
	images: ImagePreviewItem[];
	preview: ResponsePreview;
	showStream: boolean;
}) {
	const t = useTranslations('routes.modal.quickTest');
	const tp = useTranslations('playground');
	const [raw, setRaw] = useState(false);
	const resultRef = useRef<HTMLDivElement>(null);
	const followResult = useRef(true);
	useLayoutEffect(() => {
		if (!responseText) followResult.current = true;
		if (resultRef.current && followResult.current)
			resultRef.current.scrollTop = resultRef.current.scrollHeight;
	}, [responseText]);
	const hasParts = Boolean(preview.body || preview.reasoning || preview.tools.length || preview.error);
	const hasOutput = Boolean(responseText || audioUrl || images.length);
	return (
		<div className="contents">
			<section
				className={`${editorPanelClass} row-start-1 min-h-0 flex-col overflow-hidden md:col-start-2 ${
					showStream ? '' : 'row-span-2'
				} ${visibleOnMobile ? 'flex' : 'hidden md:flex'}`}
			>
				<RouteEditorSectionHeader
					title={t('response')}
					className="shrink-0"
					action={
						meta ? (
							<span
								className={`whitespace-nowrap text-xs font-medium ${
									meta.status >= 400 || preview.error ? 'text-red-600' : 'text-emerald-600'
								}`}
							>
								HTTP {meta.status}
							</span>
						) : undefined
					}
				/>
				<div className="flex shrink-0 flex-wrap items-center justify-between gap-2 px-4 pt-2 text-xs text-gray-500">
					<span role="status">
						{sending ? t('sending') : stopped ? t('stopped') : meta ? t('finished') : ''}
					</span>
					{meta?.latencyMs ? <span>{t('latency', { ms: meta.latencyMs })}</span> : null}
				</div>
				<div
					ref={resultRef}
					tabIndex={0}
					aria-label={t('response')}
					onScroll={(e) => {
						const el = e.currentTarget;
						followResult.current = el.scrollHeight - el.scrollTop - el.clientHeight < 32;
					}}
					className="min-h-0 flex-1 overflow-auto overscroll-contain px-4 py-3 outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-blue-500"
				>
					{stale ? <p className="mb-3 text-xs text-amber-700">{t('stale')}</p> : null}

					{!hasOutput ? (
						<div className="flex h-full flex-col items-center justify-center gap-3 text-center text-gray-400">
							<BeakerIcon className={`h-8 w-8 stroke-1 ${sending ? 'animate-pulse' : ''}`} />
							<p className="text-sm">{sending ? t('waiting') : t('empty')}</p>
						</div>
					) : null}
					{audioUrl ? (
						<audio controls src={audioUrl} className="w-full" aria-label={tp('audioPreview')} />
					) : null}
					{images.length ? <ImageGenerationsPreview images={images} label={tp('imagePreview')} /> : null}
					{!audioUrl && !images.length ? (
						<div className="divide-y divide-gray-100">
							{preview.reasoning ? (
								<section className="pb-3">
									<h4 className="mb-1.5 text-xs font-medium text-amber-700">{tp('thinking')}</h4>
									<LiveText label={tp('thinking')} text={preview.reasoning} className="text-gray-500" />
								</section>
							) : null}
							{preview.body ? (
								<section className="py-3 first:pt-0">
									<h4 className="mb-1.5 text-xs font-medium text-gray-500">{tp('body')}</h4>
									<LiveText label={tp('body')} text={preview.body} className="text-sm text-gray-900" />
								</section>
							) : null}
							{preview.tools.length ? (
								<section className="space-y-3 py-3 first:pt-0">
									<h4 className="text-xs font-medium text-blue-700">{t('toolCalls')}</h4>
									{preview.tools.map((call, index) => (
										<div key={call.key} className="min-w-0">
											<div className="mb-1 flex items-baseline gap-2 font-mono text-xs">
												<span className="text-gray-400">{index + 1}.</span>
												<span className="break-all font-medium text-gray-800">
													{call.name || t('receivingTool')}
												</span>
												<span className="min-w-0 truncate text-gray-400" title={call.id}>
													{call.id}
												</span>
											</div>
											<LiveText
												label={t('toolArguments')}
												text={call.arguments || (sending ? '…' : '{}')}
												className="pl-4"
											/>
										</div>
									))}
									<p className="text-[11px] text-gray-400">{t('toolHint')}</p>
								</section>
							) : null}
							{preview.error ? (
								<section role="alert" className="py-3 first:pt-0">
									<h4 className="mb-1.5 text-xs font-medium text-red-700">{t('upstreamError')}</h4>
									<LiveText label={t('upstreamError')} text={preview.error} />
								</section>
							) : null}
							{!hasParts && responseText ? (
								preview.streaming ? (
									<p className="py-3 text-xs text-gray-400">
										{sending ? t('waitingParts') : t('noReadableParts')}
									</p>
								) : (
									<LiveText label={t('response')} text={responseText} />
								)
							) : null}
						</div>
					) : null}
					{preview.finishReason || Object.keys(preview.usage).length ? (
						<div className="mt-3 flex flex-wrap gap-x-3 gap-y-1 border-t border-gray-100 pt-3 font-mono text-[11px] text-gray-500">
							{preview.finishReason ? (
								<span>
									{t('finishReason')}: {preview.finishReason}
								</span>
							) : null}
							{Object.entries(preview.usage).map(([key, value]) => (
								<span key={key}>
									{key}: {value}
								</span>
							))}
						</div>
					) : null}
					{meta && !preview.streaming ? (
						<div className="mt-3 border-t border-gray-100 pt-3">
							<button
								type="button"
								onClick={() => setRaw(!raw)}
								aria-expanded={raw}
								className="text-xs font-medium text-blue-600"
							>
								{raw ? t('hideRaw') : t('raw')}
							</button>
							{raw ? (
								<LiveText
									label={t('raw')}
									text={responseText || (audioUrl ? t('binaryAudio') : '')}
									className="mt-2"
								/>
							) : null}
						</div>
					) : null}
				</div>
			</section>
			{showStream ? (
				<section
					className={`${editorPanelClass} row-start-2 min-h-0 flex-col overflow-hidden md:col-start-2 ${
						visibleOnMobile ? 'flex' : 'hidden md:flex'
					}`}
				>
					<RouteEditorSectionHeader
						title={t('streamData')}
						className="shrink-0"
						action={
							<span className="whitespace-nowrap text-xs tabular-nums text-gray-400">
								{t('events', { count: preview.eventCount })}
							</span>
						}
					/>
					<div className="flex min-h-0 flex-1 flex-col px-4 py-3" title={t('streamDataHint')}>
						{responseText ? (
							<LiveText label={t('streamData')} text={responseText} scroll />
						) : (
							<p className="flex min-h-0 flex-1 items-center justify-center text-center text-xs text-gray-400">
								{t('streamEmpty')}
							</p>
						)}
					</div>
				</section>
			) : null}
		</div>
	);
}
