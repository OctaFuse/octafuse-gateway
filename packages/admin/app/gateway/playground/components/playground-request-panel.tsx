'use client';

import { useMemo } from 'react';
import { PaperAirplaneIcon, StopIcon } from '@heroicons/react/24/outline';
import { useTranslations } from 'next-intl';
import { RequestTargetUrl } from '@/components/request-target-url';
import { validateAudioTranscriptionFile } from '@/lib/audio-transcriptions';
import {
	IMAGE_MAX_REFERENCE_COUNT,
	validateEditImageFiles,
	type ImageOperation,
} from '@/lib/image-generations';
import { normalizeProtocol } from '@/lib/playground/usage-parsing';
import {
	codeBlockClass,
	inputClass,
	labelClass,
	matchPlaygroundLlmSample,
	playgroundLlmFamilyForRoute,
	playgroundModelHintFromRoute,
	previewPlaygroundMergedBody,
	previewPlaygroundOutboundHeaderRows,
	PLAYGROUND_LLM_SAMPLE_IDS,
	type PlaygroundLlmSampleId,
} from '../playground-utils';
import type { GeminiAction, RouteListRow } from '../types';

type Props = {
	bodyText: string;
	onBodyTextChange: (v: string) => void;
	bodyDirtyHint: boolean;
	onApplyLlmSample: (sampleId: PlaygroundLlmSampleId) => void;
	bodyError: string | null;
	sending: boolean;
	canSend: boolean;
	sendBlockedHint: string | null;
	onSend: () => void;
	onStop: () => void;
	requestTargetUrl: string | null;
	selected: RouteListRow | null;
	selectedUsesDashScopeRealtime: boolean;
	imageSendBlocked: boolean;
	selectedImageUsesDashScope: boolean;
	audioSendBlocked: boolean;
	selectedIsImage: boolean;
	selectedIsAudio: boolean;
	selectedIsAudioTranscription: boolean;
	selectedAudioUsesDashScope: boolean;
	selectedCanUseMicrophone: boolean;
	selectedNeedsAudioFile: boolean;
	imageOperation: ImageOperation;
	onImageOperationChange: (op: ImageOperation) => void;
	editFiles: File[];
	onEditFilesChange: (files: File[]) => void;
	audioFile: File | null;
	onAudioFileChange: (file: File | null) => void;
	audioInputMode: 'file' | 'microphone';
	onAudioInputModeChange: (mode: 'file' | 'microphone') => void;
	geminiAction: GeminiAction;
	onGeminiActionChange: (action: GeminiAction) => void;
	lastSentWireBody: string | null;
	lastSentWireHeaders: Record<string, string> | null;
};

export function PlaygroundRequestPanel({
	bodyText,
	onBodyTextChange,
	bodyDirtyHint,
	onApplyLlmSample,
	bodyError,
	sending,
	canSend,
	sendBlockedHint,
	onSend,
	onStop,
	requestTargetUrl,
	selected,
	selectedUsesDashScopeRealtime,
	imageSendBlocked,
	selectedImageUsesDashScope,
	audioSendBlocked,
	selectedIsImage,
	selectedIsAudio,
	selectedIsAudioTranscription,
	selectedAudioUsesDashScope,
	selectedCanUseMicrophone,
	selectedNeedsAudioFile,
	imageOperation,
	onImageOperationChange,
	editFiles,
	onEditFilesChange,
	audioFile,
	onAudioFileChange,
	audioInputMode,
	onAudioInputModeChange,
	geminiAction,
	onGeminiActionChange,
	lastSentWireBody,
	lastSentWireHeaders,
}: Props) {
	const t = useTranslations('playground');
	const tCommon = useTranslations('common');
	const showGemini =
		normalizeProtocol(selected?.upstream_protocol ?? 'openai') === 'gemini' && !selectedIsImage && !selectedIsAudio;
	const llmFamily = playgroundLlmFamilyForRoute(selected, {
		isImage: selectedIsImage,
		isAudio: selectedIsAudio,
	});
	const llmSample = llmFamily
		? matchPlaygroundLlmSample(llmFamily, bodyText, playgroundModelHintFromRoute(selected))
		: null;
	const mergedPreview = useMemo(
		() =>
			previewPlaygroundMergedBody({
				bodyText,
				customParams: selected?.custom_params,
				upstreamProtocol: selected?.upstream_protocol,
				providerModelName: selected?.provider_model_name,
			}),
		[bodyText, selected?.custom_params, selected?.upstream_protocol, selected?.provider_model_name],
	);
	const routeHeaderRows = useMemo(
		() =>
			previewPlaygroundOutboundHeaderRows({
				customParams: selected?.custom_params,
				upstreamProtocol: selected?.upstream_protocol,
				sentHeaders: lastSentWireHeaders,
			}),
		[selected?.custom_params, selected?.upstream_protocol, lastSentWireHeaders],
	);
	const actualBodyJson = lastSentWireBody ?? (mergedPreview.status === 'preview' ? mergedPreview.json : null);
	const actualBodyHint = lastSentWireBody
		? t('sentBodyHint')
		: mergedPreview.status === 'invalid'
			? t('sentBodyInvalidJson')
			: t('sentBodyPreviewHint');
	const headerHint = lastSentWireHeaders ? t('sentHeadersHintSent') : t('sentHeadersHint');
	const sampleLabel = (id: PlaygroundLlmSampleId) =>
		id === 'connectivity' ? t('templateConnectivity') : id === 'tools' ? t('templateToolStream') : t('templateReasoning');
	const llmSampleSwitcher = llmFamily ? (
		<div
			className="inline-flex rounded-md border border-slate-300 bg-slate-100 p-0.5"
			role="group"
			aria-label={t('templateSamples')}
		>
			{PLAYGROUND_LLM_SAMPLE_IDS.map((id) => {
				const active = llmSample === id;
				const label = sampleLabel(id);
				return (
					<button
						key={id}
						type="button"
						onClick={() => onApplyLlmSample(id)}
						disabled={sending}
						title={label}
						aria-pressed={active}
						className={
							active
								? 'rounded px-2.5 py-1 text-xs font-semibold bg-slate-800 text-white disabled:cursor-not-allowed disabled:opacity-40'
								: 'rounded px-2.5 py-1 text-xs font-medium text-slate-600 hover:bg-white hover:text-slate-900 disabled:cursor-not-allowed disabled:opacity-40'
						}
					>
						{label}
					</button>
				);
			})}
		</div>
	) : null;

	return (
		<section className="flex min-h-0 flex-1 flex-col space-y-3 overflow-y-auto rounded-xl border border-gray-200/80 bg-white p-4 shadow-sm">
			<div className="flex flex-wrap items-center justify-between gap-2">
				<h2 className="text-sm font-semibold text-gray-900">{t('requestBody')}</h2>
				<div className="flex flex-wrap items-center gap-2">
					{sending ? (
						<button
							type="button"
							onClick={onStop}
							className="inline-flex items-center justify-center gap-1.5 rounded-md bg-amber-600 px-3.5 py-1.5 text-sm font-medium text-white hover:bg-amber-700"
						>
							<StopIcon className="h-4 w-4" />
							{tCommon('stop')}
						</button>
					) : (
						<button
							type="button"
							onClick={onSend}
							disabled={!canSend}
							title={sendBlockedHint ?? undefined}
							className="inline-flex items-center justify-center gap-1.5 rounded-md bg-blue-600 px-3.5 py-1.5 text-sm font-medium text-white hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-blue-500 disabled:cursor-not-allowed disabled:opacity-50"
						>
							<PaperAirplaneIcon className="h-4 w-4" />
							{tCommon('send')}
						</button>
					)}
				</div>
			</div>

			{bodyDirtyHint ? (
				<p className="text-xs text-amber-800">
					{t(llmFamily ? 'bodyDirtyHintLlm' : 'bodyDirtyHint')}
				</p>
			) : null}
			{imageSendBlocked ? (
				<div className="rounded-md border border-amber-200 bg-amber-50 p-2.5 text-sm text-amber-900">
					{t('imageOpenaiOnly')}
				</div>
			) : null}
			{audioSendBlocked ? (
				<div className="rounded-md border border-amber-200 bg-amber-50 p-2.5 text-sm text-amber-900">
					{t('audioOpenaiOnly')}
				</div>
			) : null}

			<div className="space-y-1">
				<RequestTargetUrl
					label={t('requestTargetUrl')}
					method={selectedUsesDashScopeRealtime ? 'WebSocket' : undefined}
					url={requestTargetUrl}
					emptyHint={t('requestTargetUrlEmpty')}
				/>
				{selected ? (
					<p className="text-[11px] text-gray-400">
						{t(selectedUsesDashScopeRealtime ? 'requestTargetUrlRealtimeHint' : 'requestTargetUrlHint')}
					</p>
				) : null}
			</div>

			{selectedIsAudio && !audioSendBlocked ? (
				<div className="space-y-2">
					<p className="text-xs text-gray-500">
						{t(
							selectedUsesDashScopeRealtime
								? 'audioRealtimeDashScopeHint'
								: selectedAudioUsesDashScope
									? selectedIsAudioTranscription
										? 'audioTranscriptionsDashScopeHint'
										: 'audioSpeechHint'
									: selectedIsAudioTranscription
										? 'audioTranscriptionsHint'
										: 'audioSpeechHint',
						)}
					</p>
					{selectedCanUseMicrophone ? (
						<fieldset className="flex flex-wrap items-center gap-4 rounded-md border border-gray-200 px-3 py-2 text-sm">
							<legend className="sr-only">{t('audioInputMode')}</legend>
							<span className="font-medium text-gray-600">{t('audioInputMode')}</span>
							<label className="inline-flex cursor-pointer items-center gap-2">
								<input
									type="radio"
									name="playgroundAudioInput"
									className="text-blue-600 focus:ring-blue-500"
									checked={audioInputMode === 'file'}
									onChange={() => onAudioInputModeChange('file')}
									disabled={sending}
								/>
								{t('audioInputFile')}
							</label>
							<label className="inline-flex cursor-pointer items-center gap-2">
								<input
									type="radio"
									name="playgroundAudioInput"
									className="text-blue-600 focus:ring-blue-500"
									checked={audioInputMode === 'microphone'}
									onChange={() => onAudioInputModeChange('microphone')}
									disabled={sending}
								/>
								{t('audioInputMicrophone')}
							</label>
						</fieldset>
					) : null}
					{selectedNeedsAudioFile ? (
						<div>
							<label className={labelClass}>{t('audioFile')}</label>
							<input
								type="file"
								accept="audio/*,.mp3,.wav,.m4a,.webm,.ogg,.flac,.pcm"
								disabled={sending}
								className={`${inputClass} file:mr-3 file:rounded file:border-0 file:bg-blue-50 file:px-2 file:py-1 file:text-xs file:font-medium file:text-blue-700`}
								onChange={(e) => onAudioFileChange(e.target.files?.[0] ?? null)}
							/>
							<p className="mt-1 text-[11px] text-gray-400">
								{t(
									selectedUsesDashScopeRealtime
										? 'audioRealtimeFileDashScopeHint'
										: selectedAudioUsesDashScope
											? 'audioFileDashScopeHint'
											: 'audioFileHint',
								)}
							</p>
							{!audioFile ? (
								<p className="mt-1 text-xs text-amber-700">{t('audioFileRequired')}</p>
							) : (
								<p className="mt-1 text-xs text-gray-600">
									{audioFile.name} ({audioFile.size} bytes)
								</p>
							)}
							{(() => {
								if (!audioFile) return null;
								const validated = validateAudioTranscriptionFile(audioFile);
								if (validated.ok) return null;
								return <p className="mt-1 text-xs text-red-600">{validated.error}</p>;
							})()}
						</div>
					) : null}
				</div>
			) : null}

			{selectedIsImage && !selectedIsAudio && !imageSendBlocked ? (
				<>
					{selectedImageUsesDashScope ? (
						<p className="text-xs text-gray-500">{t('imageDashScopeHint')}</p>
					) : (
						<>
							<fieldset className="flex flex-wrap items-center gap-4 rounded-md border border-gray-200 px-3 py-2 text-sm">
								<legend className="sr-only">{t('imageOperation')}</legend>
								<span className="font-medium text-gray-600">{t('imageOperation')}</span>
								<label className="inline-flex cursor-pointer items-center gap-2">
									<input
										type="radio"
										name="playgroundImageOperation"
										className="text-blue-600 focus:ring-blue-500"
										checked={imageOperation === 'generations'}
										onChange={() => onImageOperationChange('generations')}
										disabled={sending}
									/>
									generations
								</label>
								<label className="inline-flex cursor-pointer items-center gap-2">
									<input
										type="radio"
										name="playgroundImageOperation"
										className="text-blue-600 focus:ring-blue-500"
										checked={imageOperation === 'edits'}
										onChange={() => onImageOperationChange('edits')}
										disabled={sending}
									/>
									edits
								</label>
							</fieldset>
							<p className="text-xs text-gray-500">
								{imageOperation === 'edits' ? t('imageEditsHint') : t('imageGenerationsHint')}
							</p>
						</>
					)}
					{imageOperation === 'edits' && !selectedImageUsesDashScope ? (
						<div>
							<label className={labelClass}>{t('referenceImages')}</label>
							<input
								type="file"
								accept="image/png,image/jpeg,image/webp,image/*"
								multiple
								disabled={sending}
								className={`${inputClass} file:mr-3 file:rounded file:border-0 file:bg-blue-50 file:px-2 file:py-1 file:text-xs file:font-medium file:text-blue-700`}
								onChange={(e) => {
									const list = e.target.files ? Array.from(e.target.files) : [];
									onEditFilesChange(list.slice(0, IMAGE_MAX_REFERENCE_COUNT));
								}}
							/>
							<p className="mt-1 text-[11px] text-gray-400">
								{t('referenceImagesHint', { max: IMAGE_MAX_REFERENCE_COUNT })}
								{editFiles.length > 0 ? ` · ${t('referenceImagesSelected', { count: editFiles.length })}` : ''}
							</p>
							{editFiles.length === 0 ? (
								<p className="mt-1 text-xs text-amber-700">{t('referenceImagesRequired')}</p>
							) : null}
							{(() => {
								if (editFiles.length === 0) return null;
								const validated = validateEditImageFiles(editFiles);
								if (validated.ok) return null;
								return <p className="mt-1 text-xs text-red-600">{validated.error}</p>;
							})()}
							{editFiles.length > 0 ? (
								<ul className="mt-1 list-inside list-disc text-xs text-gray-600">
									{editFiles.map((f) => (
										<li key={`${f.name}-${f.size}-${f.lastModified}`}>
											{f.name} ({f.size} bytes)
										</li>
									))}
								</ul>
							) : null}
						</div>
					) : null}
				</>
			) : null}

			{showGemini ? (
				<fieldset className="flex flex-wrap items-center gap-4 rounded-md border border-gray-200 px-3 py-2 text-sm">
					<legend className="sr-only">{t('geminiAction')}</legend>
					<span className="font-medium text-gray-600">{t('geminiAction')}</span>
					<label className="inline-flex cursor-pointer items-center gap-2">
						<input
							type="radio"
							name="geminiAction"
							className="text-blue-600 focus:ring-blue-500"
							checked={geminiAction === 'generateContent'}
							onChange={() => onGeminiActionChange('generateContent')}
						/>
						generateContent
					</label>
					<label className="inline-flex cursor-pointer items-center gap-2">
						<input
							type="radio"
							name="geminiAction"
							className="text-blue-600 focus:ring-blue-500"
							checked={geminiAction === 'streamGenerateContent'}
							onChange={() => onGeminiActionChange('streamGenerateContent')}
						/>
						streamGenerateContent
					</label>
				</fieldset>
			) : null}

			<div className="flex min-h-0 flex-1 flex-col gap-3">
				<div className="shrink-0">
					<div className="mb-1 flex items-center justify-between gap-2">
						<label className="text-xs font-medium uppercase tracking-wider text-gray-500" title={headerHint}>
							{t('sentHeaders')}
						</label>
						{lastSentWireBody ? (
							<span className="text-[11px] font-medium text-emerald-700">{t('sentBodySourceSent')}</span>
						) : mergedPreview.status === 'preview' ? (
							<span className="text-[11px] font-medium text-slate-500">{t('sentBodySourcePreview')}</span>
						) : null}
					</div>
					<div className={`${codeBlockClass} max-h-36 overflow-y-auto p-0`}>
						{routeHeaderRows.length === 0 ? (
							<p className="px-3 py-2 text-gray-400">{t('sentHeadersEmpty')}</p>
						) : (
							<ul className="divide-y divide-gray-100">
								{routeHeaderRows.map((row) => {
									const fromCustom = row.source === 'custom_params';
									return (
										<li
											key={`${row.source}:${row.name}`}
											className={`grid grid-cols-1 gap-0.5 px-3 py-1.5 sm:grid-cols-[minmax(8rem,16rem)_minmax(0,1fr)_auto] sm:items-baseline sm:gap-3 ${
												fromCustom ? 'bg-amber-50' : ''
											}`}
										>
											<span className="truncate font-mono text-xs font-semibold text-gray-800" title={row.name}>
												{row.name}
											</span>
											<span className="min-w-0 break-all font-mono text-xs text-gray-700" title={row.value}>
												{row.value}
											</span>
											<span
												className={`w-fit shrink-0 rounded px-1.5 py-0.5 text-[10px] font-semibold ${
													fromCustom ? 'bg-amber-100 text-amber-900' : 'bg-slate-100 text-slate-600'
												}`}
											>
												{fromCustom ? t('sentHeadersSourceCustomParams') : t('sentHeadersSourceProvider')}
											</span>
										</li>
									);
								})}
							</ul>
						)}
					</div>
				</div>

				<div className="grid min-h-0 flex-1 grid-cols-1 gap-3 xl:grid-cols-2 xl:items-stretch">
					<div className="flex min-h-0 min-w-0 flex-col">
						<div className="mb-1 flex items-center justify-between gap-2">
							<label className="text-xs font-medium uppercase tracking-wider text-gray-500">{t('inputBody')}</label>
							{llmSampleSwitcher}
						</div>
						<textarea
							value={bodyText}
							onChange={(e) => onBodyTextChange(e.target.value)}
							rows={12}
							className={`${inputClass} min-h-[180px] flex-1 font-mono text-sm`}
							spellCheck={false}
						/>
					</div>
					<div className="flex min-h-0 min-w-0 flex-col">
						<label className="mb-1 text-xs font-medium uppercase tracking-wider text-gray-500" title={actualBodyHint}>
							{t('sentBody')}
						</label>
						<pre className={`${codeBlockClass} min-h-[180px] flex-1 overflow-y-auto`}>
							{actualBodyJson ?? '—'}
						</pre>
					</div>
				</div>
			</div>

			{bodyError ? (
				<div className="rounded-md border border-red-200 bg-red-50 p-2.5 text-sm text-red-600">{bodyError}</div>
			) : null}
		</section>
	);
}
