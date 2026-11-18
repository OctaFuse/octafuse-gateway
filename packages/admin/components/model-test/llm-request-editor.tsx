'use client';
import { useId } from 'react';
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
	headingMark,
	sending,
	canSend,
	onSend,
	onStop,
	blockedHint,
	error,
	notice,
	url,
	inlineInspection,
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
	headingMark: ReactNode;
	sending: boolean;
	canSend: boolean;
	onSend: () => void;
	onStop: () => void;
	blockedHint?: string | null;
	error?: string | null;
	notice?: string | null;
	url: string | null;
	inlineInspection: { headers: ReactNode; body: ReactNode };
}) {
	const t = useTranslations('modelTest');
	const common = useTranslations('common');
	const samples = useTranslations('playground');
	const inputId = useId();
	const body = parseLlmRequest(bodyText);
	const stream = family === 'gemini' ? geminiStreaming : body?.stream === true;
	const sample = family ? matchLlmRequestSample(bodyText, family, modelHint, stream, modelValue) : 'custom';
	const editorHint = error || notice || (url ? blockedHint : null);
	return (
		<section
			className="admin-content-panel flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden rounded-xl border border-gray-200 bg-white"
			aria-label={t('request')}
		>
			<header className="admin-editor-heading flex min-h-[57px] shrink-0 items-center justify-between gap-2 border-b border-gray-100 px-4 py-2.5">
				<h2 className="flex shrink-0 items-center gap-2 text-sm font-medium text-gray-900">
					{headingMark}
					{t('request')}
				</h2>
				<div className="flex items-center gap-2">
					<button
						type="button"
						onClick={sending ? onStop : onSend}
						disabled={!sending && !canSend}
						title={blockedHint ?? undefined}
						className={`inline-flex shrink-0 items-center gap-1.5 rounded-md px-3 py-1.5 text-sm font-medium text-white disabled:opacity-50 ${
							sending ? 'bg-amber-600' : 'bg-gray-950 hover:bg-gray-800'
						}`}
					>
						{sending ? <StopIcon className="h-4 w-4" /> : <PaperAirplaneIcon className="h-4 w-4" />}
						{sending ? common('stop') : common('send')}
					</button>
				</div>
			</header>
			<div className="flex min-h-0 flex-1 flex-col">
				<div className="flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto p-4">
					{controls ? <div className="shrink-0">{controls}</div> : null}
					<p className="shrink-0 truncate font-mono text-xs text-gray-500" title={url ?? undefined}>
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
												modelValue
											)
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
									className="rounded border-gray-300 text-gray-800"
								/>
								{t('streaming')}
							</label>
						</div>
					) : null}
					{inlineInspection.headers}
					<div className="flex min-h-44 flex-[3] flex-col gap-1.5">
						<label htmlFor={inputId} className="text-xs font-medium text-gray-700">
							{samples('inspectionBodyInput')}
						</label>
						<textarea
							id={inputId}
							spellCheck={false}
							value={bodyText}
							disabled={sending}
							onChange={(e) => onChange(e.target.value)}
							className="min-h-0 w-full flex-1 resize-none overflow-auto overscroll-contain rounded-lg border border-gray-200 bg-slate-50/60 p-3 font-mono text-xs leading-6 text-gray-800 outline-none focus:border-gray-500"
						/>
					</div>
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
					{inlineInspection.body}
				</div>
			</div>
		</section>
	);
}
