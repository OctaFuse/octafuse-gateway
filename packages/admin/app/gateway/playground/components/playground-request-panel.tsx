'use client';
import { AdminContentMark } from '@/components/admin-content-mark';

import { AdminInspector } from '@/components/admin-inspector';
import { useMemo } from 'react';
import { PaperAirplaneIcon, StopIcon, ArrowUpTrayIcon } from '@heroicons/react/24/outline';
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
	splitPlaygroundCustomParams,
	PLAYGROUND_LLM_SAMPLE_IDS,
	type PlaygroundLlmSampleId,
} from '../playground-utils';
import type { GeminiAction, RouteListRow } from '../types';

import { LlmRequestEditor } from '@/components/model-test/llm-request-editor';

type Props = {
	llm: boolean;
	onApplyLlmBody: (text: string) => void;
	onResetTemplate: () => void;
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
	requestTargetMissing: string | null;
	selected: RouteListRow | null;
	selectedUsesDashScopeRealtime: boolean;
	selectedUsesElevenLabsRealtime: boolean;
	/** DashScope 或 ElevenLabs 的 WebSocket 实时路由。 */
	selectedUsesRealtime: boolean;
	imageSendBlocked: boolean;
	selectedImageUsesDashScope: boolean;
	audioSendBlocked: boolean;
	selectedIsImage: boolean;
	selectedIsAudio: boolean;
	selectedIsEmbedding: boolean;
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
	llm,
	onApplyLlmBody,
	onResetTemplate,
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
	requestTargetMissing,
	selected,
	selectedUsesDashScopeRealtime,
	selectedUsesElevenLabsRealtime,
	selectedUsesRealtime,
	imageSendBlocked,
	selectedImageUsesDashScope,
	audioSendBlocked,
	selectedIsImage,
	selectedIsAudio,
	selectedIsEmbedding,
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
		normalizeProtocol(selected?.upstream_protocol ?? 'openai') === 'gemini' &&
		!selectedIsImage &&
		!selectedIsEmbedding &&
		!selectedIsAudio;
	const llmFamily = playgroundLlmFamilyForRoute(selected, {
		isImage: selectedIsImage,
		isAudio: selectedIsAudio,
		isEmbedding: selectedIsEmbedding,
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
				upstreamOperation: selected?.upstream_operation,
				providerModelName: selected?.provider_model_name,
			}),
		[
			bodyText,
			selected?.custom_params,
			selected?.upstream_protocol,
			selected?.upstream_operation,
			selected?.provider_model_name,
		]
	);
	const routeHeaderRows = useMemo(
		() =>
			previewPlaygroundOutboundHeaderRows({
				customParams: selected?.custom_params,
				upstreamProtocol: selected?.upstream_protocol,
				sentHeaders: lastSentWireHeaders,
			}),
		[selected?.custom_params, selected?.upstream_protocol, lastSentWireHeaders]
	);
	const actualBodyJson = lastSentWireBody ?? (mergedPreview.status === 'preview' ? mergedPreview.json : null);
	const actualBodyHint = lastSentWireBody
		? t('sentBodyHint')
		: mergedPreview.status === 'invalid'
		? t('sentBodyInvalidJson')
		: splitPlaygroundCustomParams(selected?.custom_params).forceOverrideBody
		? t('sentBodyPreviewHintForceOverride')
		: t('sentBodyPreviewHint');
	const headerHint = lastSentWireHeaders ? t('sentHeadersHintSent') : t('sentHeadersHint');
	const sampleLabel = (id: PlaygroundLlmSampleId) =>
		id === 'connectivity'
			? t('templateConnectivity')
			: id === 'tools'
			? t('templateToolStream')
			: t('templateReasoning');
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
								? 'rounded px-2.5 py-1 text-xs font-medium bg-slate-800 text-white disabled:cursor-not-allowed disabled:opacity-40'
								: 'rounded px-2.5 py-1 text-xs font-medium text-slate-600 hover:bg-white hover:text-slate-900 disabled:cursor-not-allowed disabled:opacity-40'
						}
					>
						{label}
					</button>
				);
			})}
		</div>
	) : null;

	if (llm)
		return (
			<LlmRequestEditor
				previewInDialog
				family={llmFamily}
				modelHint={`${selected?.model_id ?? ''} ${selected?.provider_model_name ?? ''}`.toLowerCase()}
				bodyText={bodyText}
				onChange={onBodyTextChange}
				onApplySample={onApplyLlmBody}
				geminiStreaming={geminiAction === 'streamGenerateContent'}
				onGeminiStreamingChange={(stream) =>
					onGeminiActionChange(stream ? 'streamGenerateContent' : 'generateContent')
				}
				sending={sending}
				canSend={canSend}
				onSend={onSend}
				onStop={onStop}
				blockedHint={sendBlockedHint}
				error={bodyError}
				notice={bodyDirtyHint ? t('bodyDirtyHintLlm') : null}
				url={requestTargetUrl}
				actualBody={selected ? actualBodyJson : tCommon('selectRouteFirst')}
				sent={Boolean(lastSentWireBody)}
				headers={
					selected ? (
						<div className="space-y-1 font-mono text-xs">
							{routeHeaderRows.map((row) => (
								<p
									key={row.name}
									className={row.source === 'custom_params' ? 'break-all text-amber-800' : 'break-all'}
								>
									{row.name}: {row.value}
								</p>
							))}
						</div>
					) : null
				}
			/>
		);

	return (
		<section className="admin-editor-panel admin-content-panel flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto rounded-xl border border-gray-200 bg-white p-4">
			<div className="flex flex-wrap items-center justify-between gap-2">
				<h2 className="flex items-center gap-2 text-sm font-medium text-gray-900"><AdminContentMark icon={ArrowUpTrayIcon} compact />{t('requestBody')}</h2>
				<div className="flex flex-wrap items-center gap-2">
					<AdminInspector
						label={t('actualRequest')}
						hint={lastSentWireBody ? t('sentBodySourceSent') : t('sentBodySourcePreview')}
						disabled={!selected}
					>
						<p className="break-all font-mono text-xs text-gray-500">
							{selectedUsesRealtime ? 'WebSocket' : 'POST'} {requestTargetUrl}
						</p>
						<div>
							<h3 className="mb-2 text-xs font-medium text-gray-600" title={headerHint}>
								{t('sentHeaders')}
							</h3>
							<div className="space-y-2 rounded-lg bg-gray-50 p-4">
								{routeHeaderRows.length ? (
									routeHeaderRows.map((row) => (
										<p
											key={row.name}
											className={`break-all font-mono text-xs ${
												row.source === 'custom_params' ? 'text-amber-800' : 'text-gray-600'
											}`}
										>
											{row.name}: {row.value}
										</p>
									))
								) : (
									<p className="text-xs text-gray-400">{t('sentHeadersEmpty')}</p>
								)}
							</div>
						</div>
						<div>
							<h3 className="mb-2 text-xs font-medium text-gray-600" title={actualBodyHint}>
								{t('sentBody')}
							</h3>
							<pre className={`${codeBlockClass} leading-6`}>{actualBodyJson ?? '—'}</pre>
						</div>
					</AdminInspector>
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
							className="inline-flex items-center justify-center gap-1.5 rounded-md admin-primary px-3.5 py-1.5 text-sm font-medium text-white hover:bg-gray-800 focus:outline-none focus:ring-2 focus:ring-gray-500 disabled:cursor-not-allowed disabled:opacity-50"
						>
							<PaperAirplaneIcon className="h-4 w-4" />
							{tCommon('send')}
						</button>
					)}
				</div>
			</div>

			{bodyDirtyHint ? (
				<p className="text-xs text-amber-800">{t(llmFamily ? 'bodyDirtyHintLlm' : 'bodyDirtyHint')}</p>
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
					method={selectedUsesRealtime ? 'WebSocket' : undefined}
					url={requestTargetUrl}
					emptyHint={
						requestTargetMissing
							? t('requestTargetUrlMissing', { target: requestTargetMissing })
							: t('requestTargetUrlEmpty')
					}
				/>
				{selected ? (
					<p className="text-xs text-gray-400">
						{t(selectedUsesRealtime ? 'requestTargetUrlRealtimeHint' : 'requestTargetUrlHint')}
					</p>
				) : null}
			</div>

			{selectedIsAudio && !audioSendBlocked ? (
				<div className="space-y-2">
					<p className="text-xs text-gray-500">
						{t(
							selectedUsesElevenLabsRealtime
								? selectedIsAudioTranscription
									? 'audioRealtimeElevenLabsAsrHint'
									: 'audioRealtimeElevenLabsTtsHint'
								: selectedUsesDashScopeRealtime
								? 'audioRealtimeDashScopeHint'
								: selected?.adapter === 'elevenlabs-tts'
								? 'audioSpeechElevenLabsOpenAiHint'
								: selected?.upstream_protocol === 'elevenlabs' && selectedIsAudioTranscription
								? 'audioTranscriptionsElevenLabsHint'
								: selected?.upstream_protocol === 'elevenlabs'
								? 'audioSpeechElevenLabsHint'
								: selected?.adapter === 'minimax-tts'
								? 'audioSpeechMiniMaxOpenAiHint'
								: selected?.upstream_protocol === 'minimax' && !selectedIsAudioTranscription
								? 'audioSpeechMiniMaxHint'
								: selected?.adapter === 'passthrough' &&
								  selectedAudioUsesDashScope &&
								  !selectedIsAudioTranscription
								? 'audioSpeechPassthroughHint'
								: selectedAudioUsesDashScope
								? selectedIsAudioTranscription
									? 'audioTranscriptionsDashScopeHint'
									: 'audioSpeechHint'
								: selectedIsAudioTranscription
								? 'audioTranscriptionsHint'
								: 'audioSpeechHint'
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
									className="text-gray-800 focus:ring-gray-500"
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
									className="text-gray-800 focus:ring-gray-500"
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
								className={`${inputClass} file:mr-3 file:rounded file:border-0 file:bg-gray-50 file:px-2 file:py-1 file:text-xs file:font-medium file:text-gray-800`}
								onChange={(e) => onAudioFileChange(e.target.files?.[0] ?? null)}
							/>
							<p className="mt-1 text-xs text-gray-400">
								{t(
									selectedUsesElevenLabsRealtime
										? 'audioRealtimeFileElevenLabsHint'
										: selectedUsesDashScopeRealtime
										? 'audioRealtimeFileDashScopeHint'
										: selectedAudioUsesDashScope
										? 'audioFileDashScopeHint'
										: 'audioFileHint'
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
					{selected?.adapter === 'minimax-image' ? (
						<p className="text-xs text-gray-500">{t('imageMiniMaxOpenAiHint')}</p>
					) : selected?.upstream_protocol === 'minimax' ? (
						<p className="text-xs text-gray-500">{t('imageMiniMaxPassthroughHint')}</p>
					) : selected?.adapter === 'volcengine-image' ? (
						<p className="text-xs text-gray-500">{t('imageVolcengineOpenAiHint')}</p>
					) : selected?.upstream_protocol === 'volcengine' ? (
						<p className="text-xs text-gray-500">{t('imageVolcenginePassthroughHint')}</p>
					) : selected?.adapter === 'gemini-image' ? (
						<p className="text-xs text-gray-500">{t('imageGeminiOpenAiHint')}</p>
					) : selected?.upstream_protocol === 'gemini' ? (
						<p className="text-xs text-gray-500">{t('imageGeminiHint')}</p>
					) : selectedImageUsesDashScope ? (
						<p className="text-xs text-gray-500">
							{t(
								selected?.adapter === 'passthrough' ? 'imageDashScopePassthroughHint' : 'imageDashScopeHint'
							)}
						</p>
					) : (
						<>
							<fieldset className="flex flex-wrap items-center gap-4 rounded-md border border-gray-200 px-3 py-2 text-sm">
								<legend className="sr-only">{t('imageOperation')}</legend>
								<span className="font-medium text-gray-600">{t('imageOperation')}</span>
								<label className="inline-flex cursor-pointer items-center gap-2">
									<input
										type="radio"
										name="playgroundImageOperation"
										className="text-gray-800 focus:ring-gray-500"
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
										className="text-gray-800 focus:ring-gray-500"
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
					{imageOperation === 'edits' &&
					!selectedImageUsesDashScope &&
					selected?.upstream_protocol !== 'minimax' ? (
						<div>
							<label className={labelClass}>{t('referenceImages')}</label>
							<input
								type="file"
								accept="image/png,image/jpeg,image/webp,image/*"
								multiple
								disabled={sending}
								className={`${inputClass} file:mr-3 file:rounded file:border-0 file:bg-gray-50 file:px-2 file:py-1 file:text-xs file:font-medium file:text-gray-800`}
								onChange={(e) => {
									const list = e.target.files ? Array.from(e.target.files) : [];
									onEditFilesChange(list.slice(0, IMAGE_MAX_REFERENCE_COUNT));
								}}
							/>
							<p className="mt-1 text-xs text-gray-400">
								{t('referenceImagesHint', { max: IMAGE_MAX_REFERENCE_COUNT })}
								{editFiles.length > 0
									? ` · ${t('referenceImagesSelected', { count: editFiles.length })}`
									: ''}
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
							className="text-gray-800 focus:ring-gray-500"
							checked={geminiAction === 'generateContent'}
							onChange={() => onGeminiActionChange('generateContent')}
						/>
						generateContent
					</label>
					<label className="inline-flex cursor-pointer items-center gap-2">
						<input
							type="radio"
							name="geminiAction"
							className="text-gray-800 focus:ring-gray-500"
							checked={geminiAction === 'streamGenerateContent'}
							onChange={() => onGeminiActionChange('streamGenerateContent')}
						/>
						streamGenerateContent
					</label>
				</fieldset>
			) : null}

			<div className="flex min-h-0 flex-1 flex-col gap-2">
				<div className="flex items-center justify-between gap-2">
					<label htmlFor="playground-media-body" className={labelClass}>
						{t('inputBody')}
					</label>
					{llmSampleSwitcher}
					<button
						type="button"
						disabled={sending || !selected}
						onClick={onResetTemplate}
						className="shrink-0 rounded-lg px-2 py-1.5 text-xs text-gray-500 hover:bg-gray-100 disabled:opacity-50"
					>
						{t('applyTemplate')}
					</button>
				</div>
				<textarea
					id="playground-media-body"
					value={bodyText}
					onChange={(event) => onBodyTextChange(event.target.value)}
					rows={12}
					disabled={sending}
					spellCheck={false}
					className={`${inputClass} min-h-[280px] flex-1 resize-y font-mono text-xs leading-6 xl:resize-none`}
				/>
			</div>

			{bodyError ? (
				<div className="rounded-md border border-red-200 bg-red-50 p-2.5 text-sm text-red-600">
					{bodyError}
				</div>
			) : null}
		</section>
	);
}
