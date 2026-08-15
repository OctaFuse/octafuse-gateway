"use client";

import { PaperAirplaneIcon, StopIcon } from "@heroicons/react/24/outline";
import { useTranslations } from "next-intl";
import { RequestTargetUrl } from "@/components/request-target-url";
import { validateAudioTranscriptionFile } from "@/lib/audio-transcriptions";
import {
	IMAGE_MAX_REFERENCE_COUNT,
	validateEditImageFiles,
	type ImageOperation,
} from "@/lib/image-generations";
import type { OpenaiLlmOperation } from "@/lib/invoke-kind";
import type { SimulatorGeminiAction, SimulatorProtocol } from "@/lib/simulator/endpoint";
import {
	codeBlockClass,
	inputClass,
	labelClass,
	prettyJsonBody,
	type SimulatorClientSurfaceOptions,
} from "../simulator-utils";
import type { WirePreview } from "../types";

type Props = {
	protocol: SimulatorProtocol;
	onProtocolChange: (p: SimulatorProtocol) => void;
	supportedSurfaces: SimulatorClientSurfaceOptions;
	hasSelectedModel: boolean;
	hideProtocolControls?: boolean;
	geminiAction: SimulatorGeminiAction;
	onGeminiActionChange: (a: SimulatorGeminiAction) => void;
	openaiLlmOperation: OpenaiLlmOperation;
	onOpenaiLlmOperationChange: (op: OpenaiLlmOperation) => void;
	bodyText: string;
	onBodyTextChange: (v: string) => void;
	bodyDirty: boolean;
	onApplyTemplate: () => void;
	infoHint: string | null;
	bodyError: string | null;
	displayWire: WirePreview | null;
	wireOpen: boolean;
	onWireOpenChange: (open: boolean) => void;
	sending: boolean;
	canSend: boolean;
	sendBlockedHint: string | null;
	onSend: () => void;
	onStop: () => void;
	/** Image catalog model selected with openai protocol. */
	showImageOperation?: boolean;
	imageOperation?: ImageOperation;
	onImageOperationChange?: (op: ImageOperation) => void;
	editFiles?: File[];
	onEditFilesChange?: (files: File[]) => void;
	/** Audio ASR model selected with openai protocol. */
	showAudioTranscriptions?: boolean;
	/** Audio TTS model selected with openai protocol. */
	showAudioSpeech?: boolean;
	/** DashScope realtime TTS uses the native WebSocket task lifecycle. */
	showAudioRealtime?: boolean;
	audioFile?: File | null;
	onAudioFileChange?: (file: File | null) => void;
	showAudioRealtimeMicrophone?: boolean;
	audioInputMode?: "file" | "microphone";
	onAudioInputModeChange?: (mode: "file" | "microphone") => void;
};

export function SimulatorRequestPanel({
	protocol,
	onProtocolChange,
	supportedSurfaces,
	hasSelectedModel,
	hideProtocolControls = false,
	geminiAction,
	onGeminiActionChange,
	openaiLlmOperation,
	onOpenaiLlmOperationChange,
	bodyText,
	onBodyTextChange,
	bodyDirty,
	onApplyTemplate,
	infoHint,
	bodyError,
	displayWire,
	wireOpen,
	onWireOpenChange,
	sending,
	canSend,
	sendBlockedHint,
	onSend,
	onStop,
	showImageOperation = false,
	imageOperation = "generations",
	onImageOperationChange,
	editFiles = [],
	onEditFilesChange,
	showAudioTranscriptions = false,
	showAudioSpeech = false,
	showAudioRealtime = false,
	audioFile = null,
	onAudioFileChange,
	showAudioRealtimeMicrophone = false,
	audioInputMode = "file",
	onAudioInputModeChange,
}: Props) {
	const t = useTranslations("simulator");
	const tCommon = useTranslations("common");

	const supportedProtocols = supportedSurfaces.protocols;
	const supportedOpenaiOps = supportedSurfaces.openaiLlmOperations;
	const supportedGeminiActions = supportedSurfaces.geminiActions;
	const supportedImageOps = supportedSurfaces.imageOperations;
	const showOpenaiOperation =
		protocol === "openai" &&
		!hideProtocolControls &&
		supportedOpenaiOps.length > 1;
	const showGeminiAction =
		protocol === "gemini" &&
		!hideProtocolControls &&
		supportedGeminiActions.length > 1;

	return (
		<section className="flex h-full min-h-0 flex-col space-y-3 rounded-xl border border-gray-200/80 bg-white p-4 shadow-sm">
			<div className="flex flex-wrap items-center justify-between gap-2">
				<h2 className="text-sm font-semibold text-gray-900">
					{t("requestBody")}
				</h2>
				<div className="flex flex-wrap items-center gap-2">
					<button
						type="button"
						onClick={onApplyTemplate}
						disabled={!bodyDirty || sending}
						className="text-xs px-2.5 py-1.5 rounded-md border border-gray-300 text-gray-700 hover:bg-gray-50 disabled:opacity-40 disabled:cursor-not-allowed"
					>
						{t("applyTemplate")}
					</button>
					{sending ? (
						<button
							type="button"
							onClick={onStop}
							className="inline-flex items-center justify-center gap-1.5 px-3.5 py-1.5 bg-amber-600 text-white text-sm font-medium rounded-md hover:bg-amber-700"
						>
							<StopIcon className="h-4 w-4" />
							{tCommon("stop")}
						</button>
					) : (
						<button
							type="button"
							onClick={onSend}
							disabled={!canSend}
							title={sendBlockedHint ?? undefined}
							className="inline-flex items-center justify-center gap-1.5 px-3.5 py-1.5 bg-blue-600 text-white text-sm font-medium rounded-md hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-blue-500 disabled:opacity-50 disabled:cursor-not-allowed"
						>
							<PaperAirplaneIcon className="h-4 w-4" />
							{tCommon("send")}
						</button>
					)}
				</div>
			</div>
			{sendBlockedHint && !sending ? (
				<p className="text-xs text-gray-500 -mt-1">{sendBlockedHint}</p>
			) : null}
			{infoHint ? (
				<div className="p-2.5 bg-blue-50 border border-blue-200 rounded-md text-blue-900 text-sm">
					{infoHint}
				</div>
			) : null}
			{hideProtocolControls ? (
				<p className="text-xs text-gray-500">{t("toolProtocolHidden")}</p>
			) : !hasSelectedModel ? null : supportedProtocols.length === 0 ? (
				<p className="text-xs text-amber-800/90">{t("supportedSurfacesEmpty")}</p>
			) : (
				<div className="flex flex-wrap items-center gap-2">
					<div
						className="inline-flex flex-wrap rounded-md border border-gray-200 bg-gray-50 p-0.5"
						role="group"
						aria-label={t("protocol")}
					>
						{supportedProtocols.map((p) => {
							const active = protocol === p;
							return (
								<button
									key={p}
									type="button"
									disabled={sending}
									onClick={() => onProtocolChange(p)}
									className={
										active
											? "rounded px-2.5 py-1 text-xs font-medium bg-white text-gray-900 shadow-sm"
											: "rounded px-2.5 py-1 text-xs font-medium text-gray-600 hover:text-gray-900"
									}
								>
									{p}
								</button>
							);
						})}
					</div>
					{showOpenaiOperation ? (
						<div
							className="inline-flex rounded-md border border-gray-200 bg-gray-50 p-0.5"
							role="group"
							aria-label={t("openaiOperation")}
							title={t("openaiOperationHint")}
						>
							{supportedOpenaiOps.map((op) => {
								const active = openaiLlmOperation === op;
								return (
									<button
										key={op}
										type="button"
										disabled={sending}
										onClick={() => onOpenaiLlmOperationChange(op)}
										className={
											active
												? "rounded px-2.5 py-1 text-xs font-medium bg-white text-gray-900 shadow-sm"
												: "rounded px-2.5 py-1 text-xs font-medium text-gray-600 hover:text-gray-900"
										}
									>
										{op}
									</button>
								);
							})}
						</div>
					) : null}
					{showGeminiAction ? (
						<div
							className="inline-flex rounded-md border border-gray-200 bg-gray-50 p-0.5"
							role="group"
							aria-label={t("geminiAction")}
						>
							{supportedGeminiActions.map((action) => {
								const active = geminiAction === action;
								return (
									<button
										key={action}
										type="button"
										disabled={sending}
										onClick={() => onGeminiActionChange(action)}
										className={
											active
												? "rounded px-2.5 py-1 font-mono text-[11px] font-medium bg-white text-gray-900 shadow-sm"
												: "rounded px-2.5 py-1 font-mono text-[11px] font-medium text-gray-600 hover:text-gray-900"
										}
									>
										{action}
									</button>
								);
							})}
						</div>
					) : null}
				</div>
			)}
			<RequestTargetUrl
				label={t("requestTargetUrl")}
			method={showAudioRealtime ? "WebSocket" : displayWire?.method ?? "POST"}
				url={displayWire?.url}
				emptyHint={t("requestTargetUrlEmpty")}
			/>
			{showAudioTranscriptions ? (
				<div className="space-y-2">
					<p className="text-xs text-gray-500">
						{showAudioRealtimeMicrophone ? t("audioRealtimeDashScopeHint") : t("audioTranscriptionsHint")}
					</p>
					{showAudioRealtimeMicrophone ? (
						<fieldset className="flex flex-wrap items-center gap-4 rounded-md border border-gray-200 px-3 py-2 text-sm">
							<legend className="sr-only">{t("audioInputMode")}</legend>
							<span className="font-medium text-gray-600">{t("audioInputMode")}</span>
							<label className="inline-flex cursor-pointer items-center gap-2">
								<input
									type="radio"
									name="simulatorAudioInput"
									className="text-blue-600 focus:ring-blue-500"
									checked={audioInputMode === "file"}
									onChange={() => onAudioInputModeChange?.("file")}
									disabled={sending}
								/>
								{t("audioInputFile")}
							</label>
							<label className="inline-flex cursor-pointer items-center gap-2">
								<input
									type="radio"
									name="simulatorAudioInput"
									className="text-blue-600 focus:ring-blue-500"
									checked={audioInputMode === "microphone"}
									onChange={() => onAudioInputModeChange?.("microphone")}
									disabled={sending}
								/>
								{t("audioInputMicrophone")}
							</label>
					</fieldset>
					) : null}
					{!showAudioRealtimeMicrophone || audioInputMode === "file" ? (
						<div>
							<label className={labelClass}>{t("audioFile")}</label>
							<input
								type="file"
								accept="audio/*,.mp3,.wav,.m4a,.webm,.ogg,.flac"
								disabled={sending}
								className={`${inputClass} file:mr-3 file:rounded file:border-0 file:bg-blue-50 file:px-2 file:py-1 file:text-xs file:font-medium file:text-blue-700`}
								onChange={(e) => {
									onAudioFileChange?.(e.target.files?.[0] ?? null);
								}}
							/>
							<p className="mt-1 text-[11px] text-gray-400">
								{showAudioRealtimeMicrophone
									? t("audioRealtimeFileDashScopeHint")
									: t("audioFileHint")}
							</p>
							{!audioFile ? (
								<p className="mt-1 text-xs text-amber-700">
									{t("audioFileRequired")}
								</p>
							) : (
								<p className="mt-1 text-xs text-gray-600">
									{audioFile.name} ({audioFile.size} bytes)
								</p>
							)}
							{(() => {
								if (!audioFile) return null;
								const validated = validateAudioTranscriptionFile(audioFile);
								if (validated.ok) return null;
								return (
									<p className="mt-1 text-xs text-red-600">{validated.error}</p>
								);
							})()}
						</div>
					) : null}
				</div>
			) : null}
			{showAudioSpeech ? (
				<p className="text-xs text-gray-500">
					{showAudioRealtime ? t("audioRealtimeSpeechHint") : t("audioSpeechHint")}
				</p>
			) : null}
			{showImageOperation ? (
				<>
					{supportedImageOps.length > 1 ? (
						<fieldset className="flex flex-wrap items-center gap-4 text-sm border border-gray-200 rounded-md px-3 py-2">
							<legend className="sr-only">{t("imageOperation")}</legend>
							<span className="text-gray-600 font-medium">
								{t("imageOperation")}
							</span>
							{supportedImageOps.map((op) => (
								<label key={op} className="inline-flex items-center gap-2 cursor-pointer">
									<input
										type="radio"
										name="simulatorImageOperation"
										className="text-blue-600 focus:ring-blue-500"
										checked={imageOperation === op}
										onChange={() => onImageOperationChange?.(op)}
										disabled={sending}
									/>
									{op}
								</label>
							))}
						</fieldset>
					) : null}
					{imageOperation === "generations" ? (
						<p className="text-xs text-gray-500">{t("imageGenerationsHint")}</p>
					) : (
						<p className="text-xs text-gray-500">{t("imageEditsHint")}</p>
					)}
					{imageOperation === "edits" ? (
						<div>
							<label className={labelClass}>{t("referenceImages")}</label>
							<input
								type="file"
								accept="image/png,image/jpeg,image/webp,image/*"
								multiple
								disabled={sending}
								className={`${inputClass} file:mr-3 file:rounded file:border-0 file:bg-blue-50 file:px-2 file:py-1 file:text-xs file:font-medium file:text-blue-700`}
								onChange={(e) => {
									const list = e.target.files ? Array.from(e.target.files) : [];
									onEditFilesChange?.(list.slice(0, IMAGE_MAX_REFERENCE_COUNT));
								}}
							/>
							<p className="mt-1 text-[11px] text-gray-400">
								{t("referenceImagesHint", { max: IMAGE_MAX_REFERENCE_COUNT })}
								{editFiles.length > 0
									? ` · ${t("referenceImagesSelected", {
											count: editFiles.length,
									  })}`
									: ""}
							</p>
							{editFiles.length === 0 ? (
								<p className="mt-1 text-xs text-amber-700">
									{t("referenceImagesRequired")}
								</p>
							) : null}
							{(() => {
								if (editFiles.length === 0) return null;
								const validated = validateEditImageFiles(editFiles);
								if (validated.ok) return null;
								return (
									<p className="mt-1 text-xs text-red-600">{validated.error}</p>
								);
							})()}
							{editFiles.length > 0 ? (
								<ul className="mt-1 text-xs text-gray-600 list-disc list-inside">
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
			<div className="flex-1 min-h-0 flex flex-col">
				<label className={labelClass}>JSON</label>
				<textarea
					value={bodyText}
					onChange={(e) => onBodyTextChange(e.target.value)}
					rows={12}
					className={`${inputClass} min-h-[220px] flex-1 font-mono text-sm xl:min-h-0`}
					spellCheck={false}
				/>
			</div>
			{bodyError ? (
				<div className="p-2.5 bg-red-50 border border-red-200 rounded-md text-red-600 text-sm">
					{bodyError}
				</div>
			) : null}

			<div className="border-t border-gray-100 pt-2">
				<button
					type="button"
					onClick={() => onWireOpenChange(!wireOpen)}
					className="flex w-full items-center justify-between text-left text-xs font-medium text-gray-600 hover:text-gray-900"
					aria-expanded={wireOpen}
				>
					<span>{t("wirePreview")}</span>
					<span className="text-gray-400">{wireOpen ? "▾" : "▸"}</span>
				</button>
				{wireOpen ? (
					displayWire ? (
						<div className="mt-2 space-y-2">
							<div className="text-xs text-gray-600">
								<span className="font-semibold text-gray-700">
									{displayWire.method}
								</span>{" "}
								<span className="font-mono break-all">{displayWire.url}</span>
							</div>
							<div>
								<div className="text-[11px] font-medium text-gray-500 mb-1">
									{t("wireHeaders")}
								</div>
								<pre className={codeBlockClass}>
									{Object.entries(displayWire.headers)
										.map(([k, v]) => `${k}: ${v}`)
										.join("\n")}
								</pre>
							</div>
							<div>
								<div className="text-[11px] font-medium text-gray-500 mb-1">
									{t("wireBody")}
								</div>
								<pre className={codeBlockClass}>
									{displayWire.isMultipart
										? displayWire.bodyText
										: prettyJsonBody(displayWire.bodyText)}
								</pre>
							</div>
						</div>
					) : (
						<p className="mt-2 text-xs text-gray-500">
							{t("wirePreviewEmpty")}
						</p>
					)
				) : null}
			</div>
		</section>
	);
}
