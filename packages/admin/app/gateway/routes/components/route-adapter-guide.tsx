'use client';

import { useEffect, useId, useRef, useState } from 'react';
import {
	CheckIcon,
	ChevronDownIcon,
	ClipboardDocumentIcon,
	ExclamationTriangleIcon,
} from '@heroicons/react/24/outline';
import { displayedProtectedUpstreamPaths } from '@octafuse/core/upstream-extra-fields';
import type { AdapterDescriptor } from '@octafuse/core/adapters/registry';
import { useTranslations } from 'next-intl';
import { buildOpenAiAdapterCallSample, requestSurfacePath } from '../route-utils';

type Props = {
	descriptor: AdapterDescriptor;
	modelId: string;
	routeGroup: string;
	onOpenRequestTab: () => void;
};

type GuideTab = 'mapping' | 'extra' | 'sample';

function mappingLines(value: unknown): string[] {
	if (!Array.isArray(value)) return [];
	return value.filter((item): item is string => typeof item === 'string' && item.trim() !== '');
}

function responseKind(descriptor: AdapterDescriptor): 'job' | 'websocket' | 'sse' | 'binary' | 'json' {
	if (descriptor.exchange === 'job') return 'job';
	if (descriptor.exchange === 'websocket' || descriptor.responsePayload === 'websocket') return 'websocket';
	if (descriptor.exchange === 'sse' || descriptor.responsePayload === 'sse') return 'sse';
	if (descriptor.responsePayload === 'binary') return 'binary';
	return 'json';
}

function CopyButton({ value, label }: { value: string; label: string }) {
	const t = useTranslations('routes.modal.guide');
	const tCommon = useTranslations('common');
	const [status, setStatus] = useState<'idle' | 'copied' | 'failed'>('idle');
	const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
	useEffect(
		() => () => {
			if (timer.current) clearTimeout(timer.current);
		},
		[]
	);

	async function copy() {
		if (timer.current) clearTimeout(timer.current);
		try {
			await navigator.clipboard.writeText(value);
			setStatus('copied');
		} catch {
			setStatus('failed');
		}
		timer.current = setTimeout(() => setStatus('idle'), 2500);
	}

	return (
		<div className="flex shrink-0 items-center gap-2">
			<span role="status" className={status === 'failed' ? 'text-xs text-red-600' : 'sr-only'}>
				{status === 'failed' ? t('copyFailed') : status === 'copied' ? tCommon('copied') : ''}
			</span>
			<button
				type="button"
				onClick={() => void copy()}
				aria-label={status === 'copied' ? tCommon('copied') : label}
				title={label}
				className="inline-flex items-center gap-1.5 rounded px-2 py-1 text-xs font-medium text-slate-500 transition-colors hover:bg-slate-100 hover:text-slate-800 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500"
			>
				{status === 'copied' ? (
					<CheckIcon className="h-3.5 w-3.5" aria-hidden />
				) : (
					<ClipboardDocumentIcon className="h-3.5 w-3.5" aria-hidden />
				)}
				{status === 'copied' ? tCommon('copied') : tCommon('copy')}
			</button>
		</div>
	);
}

function CodeExample({ value, language, label }: { value: string; language: string; label: string }) {
	return (
		<div className="min-w-0 rounded-md bg-slate-50">
			<div className="flex flex-wrap items-center justify-between gap-2 px-3 pt-2">
				<span className="font-mono text-[11px] text-slate-500">{language}</span>
				<CopyButton key={value} value={value} label={label} />
			</div>
			<pre
				tabIndex={0}
				aria-label={label}
				className="max-h-64 overflow-auto p-3 font-mono text-xs leading-5 text-slate-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-blue-500"
			>
				<code>{value}</code>
			</pre>
		</div>
	);
}

export function RouteAdapterGuide({ descriptor, modelId, routeGroup, onOpenRequestTab }: Props) {
	const t = useTranslations('routes.modal');
	const id = useId();
	const [expanded, setExpanded] = useState(false);
	const [activeTab, setActiveTab] = useState<GuideTab>('mapping');
	const passthrough = descriptor.id === 'passthrough';
	const showExtra =
		!passthrough &&
		descriptor.request.protocol === 'openai' &&
		(descriptor.modality === 'image' || descriptor.modality === 'audio');
	const multipart = descriptor.requestPayload === 'multipart';
	const example = descriptor.extraBodyExample ? JSON.stringify(descriptor.extraBodyExample, null, 2) : null;
	const protectedFields = displayedProtectedUpstreamPaths(descriptor.protectedUpstreamPaths);
	const mapping = t.has(`adapterGuides.${descriptor.id}.mapping`)
		? mappingLines(t.raw(`adapterGuides.${descriptor.id}.mapping`))
		: [];
	const group = routeGroup.trim() || 'default';
	const clientModel = `${modelId || 'your-model'}${group === 'default' ? '' : `:${group}`}`;
	const callPath = requestSurfacePath(descriptor.request.protocol, descriptor.request.operation, clientModel);
	const sample = passthrough ? null : buildOpenAiAdapterCallSample(descriptor, clientModel);
	const lossy = descriptor.lossyFeatures ?? [];
	const method = descriptor.exchange === 'websocket' ? 'WS' : 'POST';
	const tabs: GuideTab[] = [
		...(mapping.length > 0 ? ['mapping' as const] : []),
		...(showExtra ? ['extra' as const] : []),
		...(sample ? ['sample' as const] : []),
	];
	const selectedTab = tabs.includes(activeTab) ? activeTab : tabs[0];

	return (
		<section aria-label={t('guide.title')} className="mt-4 min-w-0 border-t border-slate-200 pt-3">
			<div className="flex flex-wrap items-center justify-between gap-2">
				<h4 className="text-xs font-semibold text-slate-700">{t('guide.title')}</h4>
				<button
					type="button"
					onClick={() => setExpanded(!expanded)}
					aria-expanded={expanded}
					aria-controls={`${id}-details`}
					className="inline-flex items-center gap-1 rounded-md px-2 py-1 text-xs font-medium text-blue-700 hover:bg-blue-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500"
				>
					{t(expanded ? 'guide.hideDetails' : 'guide.showDetails')}
					<ChevronDownIcon
						className={`h-3.5 w-3.5 transition-transform ${expanded ? 'rotate-180' : ''}`}
						aria-hidden
					/>
				</button>
			</div>
			<div id={`${id}-details`} hidden={!expanded} className="pt-3">
				<div className={`grid gap-4 ${tabs.length > 0 ? 'lg:grid-cols-2 lg:gap-0' : ''}`}>
					<div className="min-w-0 space-y-3 lg:pr-6">
						<h5 className="py-2 text-xs font-medium text-slate-600">{t('guide.call')}</h5>
						<div className="flex flex-wrap items-center gap-2">
							<span className="font-mono text-[11px] font-semibold text-blue-700">{method}</span>
							<code className="min-w-0 flex-1 break-all text-xs text-slate-800">{callPath}</code>
							<CopyButton key={callPath} value={callPath} label={t('guide.copyPath')} />
						</div>
						<dl className="grid gap-y-2 text-xs">
							{(
								[
									[t('guide.requestLabel'), t(`guide.payload.${multipart ? 'multipart' : 'json'}`)],
									[t('guide.responseLabel'), t(`guide.response.${responseKind(descriptor)}`)],
									[t('guide.billingLabel'), t(`guide.billing.${descriptor.billing}`)],
								] as const
							).map(([label, value]) => (
								<div key={label} className="flex items-center gap-1.5">
									<dt className="w-10 shrink-0 text-slate-500">{label}</dt>
									<dd className="font-medium text-slate-600">{value}</dd>
								</div>
							))}
						</dl>
						{passthrough ? (
							<p className="text-xs leading-5 text-slate-500">{t('guide.passthrough')}</p>
						) : null}
						{lossy.length > 0 ? (
							<div className="flex items-start gap-1.5 text-xs leading-5 text-amber-700">
								<ExclamationTriangleIcon className="mt-0.5 h-4 w-4 shrink-0 text-amber-500" aria-hidden />
								<p>
									{t('adapterLossyFeatures', {
										features: lossy
											.map((feature) =>
												t.has(`lossyFeatureNames.${feature}`) ? t(`lossyFeatureNames.${feature}`) : feature
											)
											.join(', '),
									})}
								</p>
							</div>
						) : null}
					</div>
					<div hidden={tabs.length === 0} className="min-w-0 lg:border-l lg:border-slate-200 lg:pl-6">
						{tabs.length > 0 ? (
							<div role="tablist" aria-label={t('guide.title')} className="flex flex-wrap gap-x-5">
								{tabs.map((section) => (
									<button
										key={section}
										id={`${id}-tab-${section}`}
										type="button"
										role="tab"
										aria-selected={selectedTab === section}
										aria-controls={`${id}-panel-${section}`}
										tabIndex={selectedTab === section ? 0 : -1}
										onClick={() => setActiveTab(section)}
										onKeyDown={(event) => {
											const index = tabs.indexOf(section);
											const next =
												event.key === 'ArrowRight'
													? tabs[(index + 1) % tabs.length]
													: event.key === 'ArrowLeft'
													? tabs[(index + tabs.length - 1) % tabs.length]
													: event.key === 'Home'
													? tabs[0]
													: event.key === 'End'
													? tabs[tabs.length - 1]
													: null;
											if (!next) return;
											event.preventDefault();
											setActiveTab(next);
											document.getElementById(`${id}-tab-${next}`)?.focus();
										}}
										className={`flex items-center gap-1.5 border-b-2 py-2 text-xs font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-blue-500 ${
											selectedTab === section
												? 'border-blue-600 text-blue-700'
												: 'border-transparent text-slate-500 hover:text-slate-800'
										}`}
									>
										{t(`guide.${section}`)}
										{section === 'mapping' ? (
											<span className="text-[10px] font-normal text-slate-400">{mapping.length}</span>
										) : null}
									</button>
								))}
							</div>
						) : null}
						{tabs.map((section) => (
							<div
								key={section}
								id={`${id}-panel-${section}`}
								role="tabpanel"
								aria-labelledby={`${id}-tab-${section}`}
								hidden={selectedTab !== section}
								tabIndex={0}
								className="space-y-3 pb-1 pt-3 text-xs leading-5 text-slate-600 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-blue-500"
							>
								{section === 'mapping' ? (
									<ul className="list-disc space-y-2 pl-4 marker:text-slate-400">
										{mapping.map((line) => (
											<li key={line}>{line}</li>
										))}
									</ul>
								) : null}
								{section === 'extra' ? (
									<>
										<p>{multipart ? t('extraBodyMultipartHint') : t('extraBodyHint')}</p>
										{example ? (
											<CodeExample
												value={example}
												language="JSON · extra_body"
												label={t('guide.copyExtra')}
											/>
										) : null}
										<div className="text-slate-500">
											<div className="flex flex-wrap items-baseline gap-x-2 gap-y-1">
												<span>{t('guide.protectedTitle')}</span>
												{protectedFields.map((field) => (
													<code key={field} className="text-[11px] text-slate-600">
														{field}
													</code>
												))}
											</div>
											<p className="mt-1">{t('guide.protectedHint')}</p>
										</div>
										{descriptor.extraBodyNote === 'dashscope_tts_input' ? (
											<div className="space-y-1 text-slate-500">
												<p>{t('extraBodyInputLimit')}</p>
												<button
													type="button"
													onClick={onOpenRequestTab}
													className="rounded font-medium text-blue-700 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500"
												>
													{t('guide.openRequest')}
												</button>
											</div>
										) : null}
									</>
								) : null}
								{section === 'sample' && sample ? (
									<>
										<p>
											{t(
												descriptor.id === 'dashscope-asr-file-async'
													? 'guide.sampleHintAsync'
													: 'guide.sampleHint'
											)}
										</p>
										<CodeExample value={sample} language="Python" label={t('guide.copySample')} />
										{descriptor.request.operation === 'audio.speech' ? <p>{t('guide.voiceHint')}</p> : null}
									</>
								) : null}
							</div>
						))}
					</div>
				</div>
			</div>
		</section>
	);
}
