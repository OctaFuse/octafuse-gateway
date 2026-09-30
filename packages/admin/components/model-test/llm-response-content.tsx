'use client';
import { useLayoutEffect, useRef, type ReactNode } from 'react';
import { useTranslations } from 'next-intl';
import type { ResponsePreview } from '@/lib/playground/response-preview';

function FollowContent({ text, label, children }: { text: string; label: string; children: ReactNode }) {
	const ref = useRef<HTMLDivElement>(null),
		follow = useRef(true);
	useLayoutEffect(() => {
		if (!text) follow.current = true;
		if (ref.current && follow.current) ref.current.scrollTop = ref.current.scrollHeight;
	}, [text]);
	return (
		<div
			ref={ref}
			tabIndex={0}
			aria-label={label}
			onScroll={(e) => {
				const el = e.currentTarget;
				follow.current = el.scrollHeight - el.scrollTop - el.clientHeight < 32;
			}}
			className="min-h-0 flex-1 overflow-auto overscroll-contain p-3 outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-blue-500"
		>
			{children}
		</div>
	);
}
const textClass = 'whitespace-pre-wrap break-words font-mono text-xs leading-6 text-gray-800';
export function LlmResponseContent({
	preview,
	text,
	view,
	sending,
	interrupted,
}: {
	preview: ResponsePreview;
	text: string;
	view: 'merged' | 'raw';
	sending: boolean;
	interrupted: boolean;
}) {
	const t = useTranslations('modelTest');
	const p = useTranslations('playground');
	const readable = preview.body || preview.reasoning || preview.tools.length || preview.error;
	return (
		<div className="flex min-h-0 flex-1 flex-col gap-2">
			<div
				role="status"
				className={`shrink-0 text-xs ${interrupted || preview.error ? 'text-amber-700' : 'text-gray-500'}`}
			>
				{sending ? t('receiving') : interrupted ? t('interrupted') : text ? t('finished') : ''}
			</div>
			<div
				className={`grid min-h-0 flex-1 gap-3 ${
					view === 'merged' && preview.streaming
						? 'grid-rows-[minmax(0,2fr)_minmax(0,1fr)]'
						: 'grid-rows-[minmax(0,1fr)]'
				}`}
			>
				{view === 'merged' ? (
					<section className="flex min-h-0 flex-col overflow-hidden rounded-lg border border-gray-200 bg-white">
						<FollowContent text={text} label={t('result')}>
							<div className="divide-y divide-gray-100">
								{preview.reasoning ? (
									<section className="pb-3">
										<h3 className="mb-1 text-xs font-medium text-amber-700">{p('thinking')}</h3>
										<pre className={textClass}>{preview.reasoning}</pre>
									</section>
								) : null}
								{preview.body ? (
									<section className="py-3 first:pt-0">
										<h3 className="mb-1 text-xs font-medium text-gray-500">{p('body')}</h3>
										<pre className={textClass}>{preview.body}</pre>
									</section>
								) : null}
								{preview.tools.length ? (
									<section className="space-y-3 py-3 first:pt-0">
										<h3 className="text-xs font-medium text-blue-700">{t('tools')}</h3>
										{preview.tools.map((call) => (
											<div key={call.key}>
												<p className="mb-1 flex gap-2 font-mono text-xs">
													<span className="break-all font-medium">{call.name || '…'}</span>
													<span className="truncate text-gray-400" title={call.id}>
														{call.id}
													</span>
												</p>
												<pre className={textClass}>{call.arguments || '…'}</pre>
											</div>
										))}
										<p className="text-[11px] text-gray-400">{t('toolHint')}</p>
									</section>
								) : null}
								{preview.error ? (
									<section role="alert" className="py-3 first:pt-0">
										<h3 className="mb-1 text-xs font-medium text-red-700">{t('upstreamError')}</h3>
										<pre className={textClass}>{preview.error}</pre>
									</section>
								) : null}
								{!readable ? (
									<p className="text-xs text-gray-400">
										{sending ? t('receiving') : preview.streaming ? t('noParts') : ''}
									</p>
								) : null}
								{!readable && !preview.streaming ? <pre className={textClass}>{text}</pre> : null}
							</div>
						</FollowContent>
					</section>
				) : null}
				{view === 'raw' || preview.streaming ? (
					<section className="flex min-h-0 flex-col overflow-hidden rounded-lg border border-gray-200 bg-slate-50/60">
						<header
							className="flex shrink-0 items-center justify-between border-b border-gray-100 px-3 py-2 text-xs text-gray-500"
							title={t('followHint')}
						>
							<h3 className="font-medium">{preview.streaming ? t('streamData') : p('tabRaw')}</h3>
							{preview.streaming ? <span>{t('events', { count: preview.eventCount })}</span> : null}
						</header>
						<FollowContent text={text} label={preview.streaming ? t('streamData') : p('tabRaw')}>
							<pre className={textClass}>{text}</pre>
						</FollowContent>
					</section>
				) : null}
			</div>
		</div>
	);
}
