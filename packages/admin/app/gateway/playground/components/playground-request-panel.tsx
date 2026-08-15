'use client';

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
import { codeBlockClass, inputClass, labelClass } from '../playground-utils';
import type { GeminiAction, RouteListRow } from '../types';

type Props = {
	bodyText: string;
	onBodyTextChange: (v: string) => void;
	bodyDirty: boolean;
	bodyDirtyHint: boolean;
	onApplyTemplate: () => void;
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
	wireOpen: boolean;
	onWireOpenChange: (open: boolean) => void;
};

export function PlaygroundRequestPanel({
	bodyText,
	onBodyTextChange,
	bodyDirty,
	bodyDirtyHint,
	onApplyTemplate,
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
	wireOpen,
	onWireOpenChange,
}: Props) {
	const t = useTranslations('playground');
	const tCommon = useTranslations('common');
	const showGemini =
		normalizeProtocol(selected?.upstream_protocol ?? 'openai') === 'gemini' && !selectedIsImage && !selectedIsAudio;

	return (
		<section className="flex min-h-0 flex-col space-y-3 rounded-xl border border-gray-200/80 bg-white p-4 shadow-sm">
			<div className="flex flex-wrap items-center justify-between gap-2">
				<h2 className="text-sm font-semibold text-gray-900">{t('requestBody')}</h2>
				<div className="flex flex-wrap items-center gap-2">
					<button
						type="button"
						onClick={onApplyTemplate}
						disabled={!bodyDirty || sending}
						className="rounded-md border border-gray-300 px-2.5 py-1.5 text-xs text-gray-700 hover:bg-gray-50 disabled:cursor-not-allowed disabled:opacity-40"
					>
						{t('applyTemplate')}
					</button>
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

			{bodyDirtyHint ? <p className="text-xs text-amber-800">{t('bodyDirtyHint')}</p> : null}
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
								accept="audio/*,.mp3,.wav,.m4a,.webm,.ogg,.flac"
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
					{imageOperation === 'edits' ? (
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

			<div className="flex min-h-0 flex-1 flex-col">
				<label className={labelClass}>JSON</label>
				<textarea
					value={bodyText}
					onChange={(e) => onBodyTextChange(e.target.value)}
					rows={12}
					className={`${inputClass} min-h-[180px] flex-1 font-mono text-sm`}
					spellCheck={false}
				/>
			</div>

			{bodyError ? (
				<div className="rounded-md border border-red-200 bg-red-50 p-2.5 text-sm text-red-600">{bodyError}</div>
			) : null}

			{lastSentWireBody ? (
				<div className="border-t border-gray-100 pt-2">
					<button
						type="button"
						onClick={() => onWireOpenChange(!wireOpen)}
						className="flex w-full items-center justify-between text-left text-xs font-medium text-gray-600 hover:text-gray-900"
						aria-expanded={wireOpen}
					>
						<span>{t('sentBody')}</span>
						<span className="text-gray-400">{wireOpen ? '▾' : '▸'}</span>
					</button>
					{wireOpen ? (
						<div className="mt-2 space-y-1">
							<p className="text-[11px] text-gray-500">{t('sentBodyHint')}</p>
							<pre className={codeBlockClass}>{lastSentWireBody}</pre>
						</div>
					) : null}
				</div>
			) : null}
		</section>
	);
}
