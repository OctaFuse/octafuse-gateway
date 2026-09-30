'use client';
import type { ReactNode } from 'react';
import { useTranslations } from 'next-intl';
import { PaperAirplaneIcon, StopIcon } from '@heroicons/react/24/outline';
import {
	PLAYGROUND_LLM_SAMPLE_IDS,
	type PlaygroundLlmFamily,
	type PlaygroundLlmSampleId,
} from '@/lib/playground/samples';
import { setQuickTestStreaming } from '@/lib/playground/quick-test-samples';
import { llmRequestSample, matchLlmRequestSample, parseLlmRequest } from '@/lib/playground/llm-request';

export function LlmRequestEditor({
	family,
	modelHint,
	modelValue,
	bodyText,
	onChange,
	onApplySample,
	geminiStreaming,
	onGeminiStreamingChange,
	streamingDisabled = false,
	controls,
	sending,
	canSend,
	onSend,
	onStop,
	blockedHint,
	error,
	notice,
	url,
	actualBody,
	headers,
	sent,
}: {
	family: PlaygroundLlmFamily | null;
	modelHint: string;
	modelValue?: string;
	bodyText: string;
	onChange: (text: string) => void;
	onApplySample?: (text: string) => void;
	geminiStreaming: boolean;
	onGeminiStreamingChange: (stream: boolean) => void;
	streamingDisabled?: boolean;
	controls?: ReactNode;
	sending: boolean;
	canSend: boolean;
	onSend: () => void;
	onStop: () => void;
	blockedHint?: string | null;
	error?: string | null;
	notice?: string | null;
	url: string | null;
	actualBody: string | null;
	headers: ReactNode;
	sent: boolean;
}) {
	const t = useTranslations('modelTest');
	const common = useTranslations('common');
	const samples = useTranslations('playground');
	const body = parseLlmRequest(bodyText);
	const stream = family === 'gemini' ? geminiStreaming : body?.stream === true;
	const sample = family ? matchLlmRequestSample(bodyText, family, modelHint, stream, modelValue) : 'custom';
	const editorHint = error || notice || (url ? blockedHint : null);
	return (
		<section
			className="flex min-h-0 flex-1 flex-col overflow-hidden rounded-xl border border-gray-200 bg-white shadow-sm"
			aria-label={t('request')}
		>
			<header className="flex shrink-0 items-center justify-between gap-2 border-b border-gray-100 px-4 py-2.5">
				<h2 className="text-sm font-semibold text-gray-900">{t('request')}</h2>
				<button
					type="button"
					onClick={sending ? onStop : onSend}
					disabled={!sending && !canSend}
					title={blockedHint ?? undefined}
					className={`inline-flex shrink-0 items-center gap-1.5 rounded-md px-3 py-1.5 text-sm font-medium text-white disabled:opacity-50 ${
						sending ? 'bg-amber-600' : 'bg-blue-600 hover:bg-blue-700'
					}`}
				>
					{sending ? <StopIcon className="h-4 w-4" /> : <PaperAirplaneIcon className="h-4 w-4" />}
					{sending ? common('stop') : common('send')}
				</button>
			</header>
			<div className="grid min-h-0 flex-1 grid-rows-[minmax(0,2fr)_minmax(0,1fr)]">
				<div className="flex min-h-0 flex-col gap-2 p-3">
					{controls ? <div className="shrink-0">{controls}</div> : null}
					<p className="shrink-0 truncate font-mono text-[11px] text-gray-500" title={url ?? undefined}>
						{url ? `POST ${url}` : blockedHint || '—'}
					</p>
					{family ? (
						<div className="flex shrink-0 flex-wrap items-center justify-between gap-2 text-xs">
							<label className="flex items-center gap-2 text-gray-500">
								{t('template')}
								<select
									aria-label={t('template')}
									value={sample}
									disabled={sending}
									onChange={(e) =>
										(onApplySample ?? onChange)(
											llmRequestSample(
												family,
												e.target.value as PlaygroundLlmSampleId,
												modelHint,
												stream,
												modelValue,
											),
										)
									}
									className="rounded-md border border-gray-200 bg-white px-2 py-1.5 text-gray-800"
								>
									<option value="custom" disabled>
										{t('custom')}
									</option>
									{PLAYGROUND_LLM_SAMPLE_IDS.map((id) => (
										<option key={id} value={id}>
											{id === 'tools'
												? t('tools')
												: samples(id === 'connectivity' ? 'templateConnectivity' : 'templateReasoning')}
										</option>
									))}
								</select>
							</label>
							<label className="flex items-center gap-1.5 text-gray-600">
								<input
									type="checkbox"
									checked={stream}
									disabled={sending || !body || streamingDisabled}
									onChange={(e) =>
										family === 'gemini'
											? onGeminiStreamingChange(e.target.checked)
											: onChange(setQuickTestStreaming(bodyText, family, e.target.checked))
									}
									className="rounded border-gray-300 text-blue-600"
								/>
								{t('streaming')}
							</label>
						</div>
					) : null}
					<textarea
						aria-label={t('requestBody')}
						spellCheck={false}
						value={bodyText}
						disabled={sending}
						onChange={(e) => onChange(e.target.value)}
						className="min-h-0 w-full flex-1 resize-none overflow-auto overscroll-contain rounded-lg border border-gray-200 bg-slate-50/60 p-3 font-mono text-xs leading-6 text-gray-800 outline-none focus:border-blue-500"
					/>
					{editorHint ? (
						<p
							role={error ? 'alert' : 'status'}
							title={editorHint}
							className={`${error ? 'max-h-16 overflow-auto' : 'truncate'} shrink-0 text-xs ${
								error ? 'text-red-700' : 'text-amber-700'
							}`}
						>
							{editorHint}
						</p>
					) : null}
				</div>
				<section className="flex min-h-0 flex-col border-t border-gray-200" aria-label={t('actualRequest')}>
					<header className="flex shrink-0 items-center justify-between gap-2 bg-slate-50 px-4 py-2.5">
						<h3 className="text-xs font-semibold text-gray-700">{t('actualRequest')}</h3>
						<span className="text-[11px] text-gray-400">{sent ? t('sent') : t('preview')}</span>
					</header>
					<div
						tabIndex={0}
						aria-label={t('actualRequest')}
						className="min-h-0 flex-1 overflow-auto overscroll-contain px-4 py-3 outline-none focus-visible:ring-2 focus-visible:ring-blue-500"
					>
						{headers ? (
							<details className="mb-2 text-xs text-gray-500">
								<summary className="cursor-pointer">{t('headers')}</summary>
								<div className="mt-2">{headers}</div>
							</details>
						) : null}
						<pre className="whitespace-pre-wrap break-words font-mono text-xs leading-6 text-gray-700">
							{actualBody ?? '—'}
						</pre>
					</div>
				</section>
			</div>
		</section>
	);
}
