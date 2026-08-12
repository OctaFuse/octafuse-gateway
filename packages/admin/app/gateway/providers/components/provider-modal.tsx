"use client";

import {
	ChevronDownIcon,
	ChevronRightIcon,
	DocumentDuplicateIcon,
	TrashIcon,
} from "@heroicons/react/24/outline";
import { useTranslations } from "next-intl";
import { useEffect, useId, useState } from "react";
import { protocolFormHasOverrides, protocolFormIsConfigured } from "../provider-utils";
import type { UpstreamProtocol } from "@octafuse/core/upstream-protocol";
import type {
	GatewayProvider,
	ProtocolEndpointForm,
	ProviderFormData,
	ProviderProtocolSummary,
} from "../types";
import { ProviderProtocolIcon } from "./provider-protocol-icon";

type ProviderModalProps = {
	open: boolean;
	editingProvider: GatewayProvider | null;
	duplicateSourceId: string | null;
	formData: ProviderFormData;
	saveError: string;
	isSaving: boolean;
	isDeleting: boolean;
	onClose: () => void;
	onFormChange: (form: ProviderFormData) => void;
	onSave: () => void;
	onDelete: (id: string) => void;
	onDuplicate: (provider: GatewayProvider) => void;
};

const inputClass =
	"w-full rounded-md border border-gray-300 bg-white px-3 py-2 text-sm font-mono focus:outline-none focus:ring-2 focus:ring-blue-500";

const PROTOCOL_TABS: Array<{
	key: UpstreamProtocol;
	labelKey: "openaiOptional" | "anthropicOptional" | "geminiOptional" | "dashscopeOptional";
}> = [
	{ key: "openai", labelKey: "openaiOptional" },
	{ key: "anthropic", labelKey: "anthropicOptional" },
	{ key: "gemini", labelKey: "geminiOptional" },
	{ key: "dashscope", labelKey: "dashscopeOptional" },
];

function ProtocolFields(props: {
	baseUrlLabel: string;
	basePlaceholder: string;
	baseHint?: string;
	form: ProtocolEndpointForm;
	protocol: ProviderProtocolSummary["key"];
	advancedToggle: string;
	advancedHint: string;
	capLabels: {
		chat: string;
		imagesGenerations: string;
		imagesEdits: string;
		audioTranscriptions: string;
		audioTranscriptionsMultimodal: string;
		audioTranscriptionsTasks: string;
		audioSpeech: string;
		audioSpeechMultimodal: string;
		audioRealtimeInference: string;
		audioRealtimeSession: string;
		audioHotwords: string;
		audioVoices: string;
		messages: string;
		modelsGenerate: string;
		legacyPerActionNotice: string;
	};
	onChange: (next: ProtocolEndpointForm) => void;
}) {
	const {
		baseUrlLabel,
		basePlaceholder,
		baseHint,
		form,
		protocol,
		advancedToggle,
		advancedHint,
		capLabels,
		onChange,
	} = props;
	const [advancedOpen, setAdvancedOpen] = useState(() =>
		protocolFormHasOverrides(protocol, form)
	);
	const overridesPanelId = useId();

	return (
		<div className="rounded-lg border border-gray-200 bg-white p-4 shadow-sm">
			<div className="space-y-2">
				<label className="mb-1 block text-xs font-medium text-gray-600">
					{baseUrlLabel}
				</label>
				<input
					type="url"
					value={form.base}
					onChange={(e) => onChange({ ...form, base: e.target.value })}
					className={inputClass}
					placeholder={basePlaceholder}
					autoComplete="off"
				/>
				{baseHint ? <p className="text-xs text-gray-500">{baseHint}</p> : null}
			</div>

			<div className="mt-3">
				<button
					type="button"
					className="flex w-full items-center gap-1.5 rounded-md px-1 py-1.5 text-left text-xs font-medium text-blue-600 hover:bg-blue-50 hover:text-blue-800"
					onClick={() => setAdvancedOpen((v) => !v)}
					aria-expanded={advancedOpen}
					aria-controls={overridesPanelId}
				>
					{advancedOpen ? (
						<ChevronDownIcon className="h-3.5 w-3.5 shrink-0" aria-hidden />
					) : (
						<ChevronRightIcon className="h-3.5 w-3.5 shrink-0" aria-hidden />
					)}
					<span>{advancedToggle}</span>
				</button>
				{advancedOpen ? (
					<div
						id={overridesPanelId}
						className="mt-2 space-y-3 rounded-md border border-gray-100 bg-gray-50/80 p-3"
					>
						<p className="text-xs text-gray-500">{advancedHint}</p>
						{protocol === "openai" ? (
							<>
								<div>
									<label className="mb-1 block text-xs text-gray-600">
										{capLabels.chat}
									</label>
									<input
										type="url"
										value={form.chat}
										onChange={(e) =>
											onChange({ ...form, chat: e.target.value })
										}
										className={inputClass}
										autoComplete="off"
									/>
								</div>
								<div>
									<label className="mb-1 block text-xs text-gray-600">
										{capLabels.imagesGenerations}
									</label>
									<input
										type="url"
										value={form.images_generations}
										onChange={(e) =>
											onChange({ ...form, images_generations: e.target.value })
										}
										className={inputClass}
										autoComplete="off"
									/>
								</div>
								<div>
									<label className="mb-1 block text-xs text-gray-600">
										{capLabels.imagesEdits}
									</label>
									<input
										type="url"
										value={form.images_edits}
										onChange={(e) =>
											onChange({ ...form, images_edits: e.target.value })
										}
										className={inputClass}
										autoComplete="off"
									/>
								</div>
								<div>
									<label className="mb-1 block text-xs text-gray-600">
										{capLabels.audioTranscriptions}
									</label>
									<input
										type="url"
										value={form.audio_transcriptions}
										onChange={(e) =>
											onChange({
												...form,
												audio_transcriptions: e.target.value,
											})
										}
										className={inputClass}
										autoComplete="off"
									/>
								</div>
								<div>
									<label className="mb-1 block text-xs text-gray-600">
										{capLabels.audioSpeech}
									</label>
									<input
										type="url"
										value={form.audio_speech}
										onChange={(e) =>
											onChange({ ...form, audio_speech: e.target.value })
										}
										className={inputClass}
										autoComplete="off"
									/>
								</div>
							</>
						) : null}
						{protocol === "anthropic" ? (
							<div>
								<label className="mb-1 block text-xs text-gray-600">
									{capLabels.messages}
								</label>
								<input
									type="url"
									value={form.messages}
									onChange={(e) =>
										onChange({ ...form, messages: e.target.value })
									}
									className={inputClass}
									autoComplete="off"
								/>
							</div>
						) : null}
						{protocol === "gemini" ? (
							<>
								{form.legacyPerAction ? (
									<div className="rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-900">
										<p className="font-medium">{capLabels.legacyPerActionNotice}</p>
										<ul className="mt-1 list-inside list-disc break-all">
											{form.legacyPerAction.generateContent ? (
												<li>
													generateContent: {form.legacyPerAction.generateContent}
												</li>
											) : null}
											{form.legacyPerAction.streamGenerateContent ? (
												<li>
													streamGenerateContent:{' '}
													{form.legacyPerAction.streamGenerateContent}
												</li>
											) : null}
										</ul>
									</div>
								) : (
									<div>
										<label className="mb-1 block text-xs text-gray-600">
											{capLabels.modelsGenerate}
										</label>
										<input
											type="url"
											value={form.modelsGenerate}
											onChange={(e) =>
												onChange({
													...form,
													modelsGenerate: e.target.value,
													legacyPerAction: null,
												})
											}
											className={inputClass}
											placeholder="https://…/models/{model}:{action}"
											autoComplete="off"
										/>
									</div>
								)}
							</>
						) : null}
						{protocol === "dashscope" ? (
							<>
								{(
									[
										["audio_transcriptions", capLabels.audioTranscriptions],
										[
											"audio_transcriptions_multimodal",
											capLabels.audioTranscriptionsMultimodal,
										],
										[
											"audio_transcriptions_tasks",
											capLabels.audioTranscriptionsTasks,
										],
										["audio_speech", capLabels.audioSpeech],
										[
											"audio_speech_multimodal",
											capLabels.audioSpeechMultimodal,
										],
										[
											"audio_realtime_inference",
											capLabels.audioRealtimeInference,
										],
										["audio_realtime_session", capLabels.audioRealtimeSession],
										["audio_hotwords", capLabels.audioHotwords],
										["audio_voices", capLabels.audioVoices],
									] as const
								).map(([field, label]) => (
									<div key={field}>
										<label className="mb-1 block text-xs text-gray-600">
											{label}
										</label>
										<input
											type="url"
											value={form[field]}
											onChange={(e) =>
												onChange({ ...form, [field]: e.target.value })
											}
											className={inputClass}
											autoComplete="off"
										/>
									</div>
								))}
							</>
						) : null}
					</div>
				) : null}
			</div>
		</div>
	);
}

export function ProviderModal(props: ProviderModalProps) {
	const {
		open,
		editingProvider,
		duplicateSourceId,
		formData,
		saveError,
		isSaving,
		isDeleting,
		onClose,
		onFormChange,
		onSave,
		onDelete,
		onDuplicate,
	} = props;

	const t = useTranslations("providers.modal");
	const tCommon = useTranslations("common");
	const titleId = useId();
	const [endpointTab, setEndpointTab] = useState<UpstreamProtocol>("openai");

	useEffect(() => {
		if (!open) return;
		const firstConfigured = PROTOCOL_TABS.find(({ key }) =>
			protocolFormIsConfigured(key, formData[key])
		);
		setEndpointTab(firstConfigured?.key ?? "openai");
		// 仅在打开不同供应商时选中已配置协议；输入过程中不重置 Tab。
		// eslint-disable-next-line react-hooks/exhaustive-deps
	}, [open, editingProvider?.id, duplicateSourceId]);

	if (!open) return null;

	const capLabels = {
		chat: t('capChat'),
		imagesGenerations: t('capImagesGenerations'),
		imagesEdits: t('capImagesEdits'),
		audioTranscriptions: t('capAudioTranscriptions'),
		audioTranscriptionsMultimodal: t('capAudioTranscriptionsMultimodal'),
		audioTranscriptionsTasks: t('capAudioTranscriptionsTasks'),
		audioSpeech: t('capAudioSpeech'),
		audioSpeechMultimodal: t('capAudioSpeechMultimodal'),
		audioRealtimeInference: t('capAudioRealtimeInference'),
		audioRealtimeSession: t('capAudioRealtimeSession'),
		audioHotwords: t('capAudioHotwords'),
		audioVoices: t('capAudioVoices'),
		messages: t('capMessages'),
		modelsGenerate: t('capModelsGenerate'),
		legacyPerActionNotice: t('legacyPerActionNotice'),
	};

	return (
		<div
			className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4"
			onMouseDown={(e) => {
				if (e.target === e.currentTarget && !isSaving && !isDeleting) {
					onClose();
				}
			}}
		>
			<div
				className="flex max-h-[90vh] w-full max-w-5xl flex-col overflow-hidden rounded-lg bg-white shadow-xl"
				role="dialog"
				aria-modal="true"
				aria-labelledby={titleId}
			>
				<div className="flex shrink-0 items-center justify-between border-b px-6 py-4">
					<div>
						<h2 id={titleId} className="text-xl font-bold text-gray-900">
							{editingProvider ? t("editTitle") : t("newTitle")}
						</h2>
						{!editingProvider && duplicateSourceId && (
							<p className="mt-1 text-xs text-gray-500">
								{t("prefilledFrom", { id: duplicateSourceId })}
							</p>
						)}
					</div>
					<button
						type="button"
						onClick={onClose}
						className="text-gray-400 hover:text-gray-600"
						disabled={isSaving || isDeleting}
						aria-label={tCommon("close")}
					>
						×
					</button>
				</div>

				<div className="min-h-0 flex-1 overflow-y-auto px-6 py-5">
					{saveError && (
						<div className="mb-4 rounded-md border border-red-200 bg-red-50 p-3 text-sm text-red-600">
							{saveError}
						</div>
					)}

					<div className="space-y-8">
						<section className="space-y-3">
							<div>
								<h3 className="text-sm font-semibold text-gray-900">
									{t("general")}
								</h3>
								<p className="mt-0.5 text-xs text-gray-500">
									{t("generalHint")}
								</p>
							</div>
							{!editingProvider && (
								<div>
									<label className="mb-1 block text-sm font-medium text-gray-700">
										{t("id")}
									</label>
									<input
										type="text"
										value={formData.id}
										onChange={(e) =>
											onFormChange({ ...formData, id: e.target.value })
										}
										className={`${inputClass} font-mono`}
										placeholder={t("idPlaceholder")}
										autoComplete="off"
									/>
									<p className="mt-1 text-xs text-gray-500">{t("idHint")}</p>
								</div>
							)}
							<div>
								<label className="mb-1 block text-sm font-medium text-gray-700">
									{t("nameRequired")}
								</label>
								<input
									type="text"
									value={formData.name}
									onChange={(e) =>
										onFormChange({ ...formData, name: e.target.value })
									}
									className="w-full rounded-md border border-gray-300 bg-white px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
									placeholder={t("namePlaceholder")}
									autoComplete="off"
									required
								/>
							</div>
							<div>
								<label className="mb-1 block text-sm font-medium text-gray-700">
									{editingProvider ? t("apiKeyOptional") : t("apiKeyRequired")}
								</label>
								<input
									type="password"
									value={formData.api_key}
									onChange={(e) =>
										onFormChange({ ...formData, api_key: e.target.value })
									}
									className={`${inputClass} font-mono`}
									placeholder={
										editingProvider
											? t("apiKeyEditPlaceholder")
											: t("apiKeyPlaceholder")
									}
									autoComplete="new-password"
								/>
								<p className="mt-1 text-xs text-gray-500">
									{editingProvider ? t("apiKeyEditHint") : t("apiKeyHint")}
								</p>
							</div>
							<label className="flex items-start gap-2.5">
								<input
									type="checkbox"
									checked={formData.status === "active"}
									onChange={(e) =>
										onFormChange({
											...formData,
											status: e.target.checked ? "active" : "disabled",
										})
									}
									className="mt-0.5 h-4 w-4 rounded border-gray-300 text-green-600 focus:ring-2 focus:ring-blue-500"
								/>
								<span className="text-sm text-gray-800">
									<span className="font-medium">{t("statusEnabled")}</span>
									<span className="mt-0.5 block text-xs leading-relaxed text-gray-500">
										{t("statusHint")}
									</span>
								</span>
							</label>
						</section>

						<section className="space-y-4 border-t border-gray-100 pt-6">
							<div>
								<h3 className="text-sm font-semibold text-gray-900">
									{t("endpoints")}
								</h3>
								<p className="mt-0.5 text-xs text-gray-500">
									{t("endpointsHint")}
								</p>
							</div>
							<div
								className="flex flex-wrap gap-1 rounded-lg border border-gray-200 bg-slate-50 p-1"
								role="tablist"
								aria-label={t("endpointsTabsAria")}
							>
								{PROTOCOL_TABS.map(({ key, labelKey }) => {
									const selected = endpointTab === key;
									const configured = protocolFormIsConfigured(key, formData[key]);
									return (
										<button
											key={key}
											type="button"
											role="tab"
											id={`provider-endpoint-tab-${key}`}
											aria-selected={selected}
											aria-controls={`provider-endpoint-panel-${key}`}
											onClick={() => setEndpointTab(key)}
											className={`inline-flex items-center gap-1.5 rounded-md px-2.5 py-1.5 text-sm font-medium transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 ${
												selected
													? "bg-white text-gray-900 shadow-sm ring-1 ring-gray-200"
													: "text-gray-600 hover:bg-white/70 hover:text-gray-900"
											}`}
										>
											<span className="h-4 w-4 shrink-0">
												<ProviderProtocolIcon protocol={key} />
											</span>
											{t(labelKey)}
											{configured ? (
												<span
													className="h-1.5 w-1.5 shrink-0 rounded-full bg-emerald-500"
													title={t("configured")}
													aria-label={t("configured")}
												/>
											) : null}
										</button>
									);
								})}
							</div>
							<div
								role="tabpanel"
								id={`provider-endpoint-panel-${endpointTab}`}
								aria-labelledby={`provider-endpoint-tab-${endpointTab}`}
							>
								{endpointTab === "openai" ? (
									<ProtocolFields
										baseUrlLabel={t("baseUrl")}
										basePlaceholder={t("openaiPlaceholder")}
										form={formData.openai}
										protocol="openai"
										advancedToggle={t("advancedToggle")}
										advancedHint={t("advancedHint")}
										capLabels={capLabels}
										onChange={(openai) => onFormChange({ ...formData, openai })}
									/>
								) : null}
								{endpointTab === "anthropic" ? (
									<ProtocolFields
										baseUrlLabel={t("baseUrl")}
										basePlaceholder={t("anthropicPlaceholder")}
										form={formData.anthropic}
										protocol="anthropic"
										advancedToggle={t("advancedToggle")}
										advancedHint={t("advancedHint")}
										capLabels={capLabels}
										onChange={(anthropic) =>
											onFormChange({ ...formData, anthropic })
										}
									/>
								) : null}
								{endpointTab === "gemini" ? (
									<ProtocolFields
										baseUrlLabel={t("baseUrl")}
										basePlaceholder={t("geminiPlaceholder")}
										baseHint={t("geminiHint")}
										form={formData.gemini}
										protocol="gemini"
										advancedToggle={t("advancedToggle")}
										advancedHint={t("advancedHint")}
										capLabels={capLabels}
										onChange={(gemini) => onFormChange({ ...formData, gemini })}
									/>
								) : null}
								{endpointTab === "dashscope" ? (
									<ProtocolFields
										baseUrlLabel={t("baseUrl")}
										basePlaceholder={t("dashscopePlaceholder")}
										baseHint={t("dashscopeHint")}
										form={formData.dashscope}
										protocol="dashscope"
										advancedToggle={t("advancedToggle")}
										advancedHint={t("advancedHint")}
										capLabels={capLabels}
										onChange={(dashscope) =>
											onFormChange({ ...formData, dashscope })
										}
									/>
								) : null}
							</div>
						</section>

						<section className="space-y-3 border-t border-gray-100 pt-6">
							<div>
								<h3
									id="provider-description-heading"
									className="text-sm font-semibold text-gray-900"
								>
									{t("description")}
								</h3>
								<p className="mt-0.5 text-xs text-gray-500">
									{t("descriptionHint")}
								</p>
							</div>
							<textarea
								rows={3}
								value={formData.description}
								onChange={(e) =>
									onFormChange({ ...formData, description: e.target.value })
								}
								className="w-full rounded-md border border-gray-300 bg-white px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
								placeholder={t("descriptionPlaceholder")}
								autoComplete="off"
								aria-labelledby="provider-description-heading"
							/>
						</section>
					</div>
				</div>

				<div className="flex shrink-0 flex-wrap items-center justify-between gap-3 border-t bg-gray-50 px-6 py-4">
					<div className="flex flex-wrap items-center gap-2">
						{editingProvider && (
							<button
								type="button"
								onClick={() => void onDelete(editingProvider.id)}
								disabled={isSaving || isDeleting}
								className="inline-flex items-center gap-1.5 rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm font-medium text-red-700 hover:bg-red-100 disabled:cursor-not-allowed disabled:opacity-50"
							>
								<TrashIcon className="h-4 w-4" aria-hidden />
								{isDeleting ? tCommon("deleting") : t("deleteProvider")}
							</button>
						)}
					</div>
					<div className="ml-auto flex gap-3">
						<button
							type="button"
							onClick={onClose}
							className="rounded-md border border-gray-300 px-4 py-2 text-gray-700 hover:bg-gray-50"
							disabled={isSaving || isDeleting}
						>
							{tCommon("cancel")}
						</button>
						{editingProvider && (
							<button
								type="button"
								onClick={() => onDuplicate(editingProvider)}
								disabled={isSaving || isDeleting}
								className="inline-flex items-center gap-1.5 rounded-md border border-gray-300 bg-white px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50 disabled:cursor-not-allowed disabled:opacity-50"
							>
								<DocumentDuplicateIcon className="h-4 w-4" aria-hidden />
								{tCommon("duplicate")}
							</button>
						)}
						<button
							type="button"
							onClick={() => void onSave()}
							disabled={isSaving || isDeleting}
							className="rounded-md bg-blue-600 px-4 py-2 text-white hover:bg-blue-700 disabled:cursor-not-allowed disabled:opacity-50"
						>
							{isSaving
								? tCommon("saving")
								: editingProvider
								? tCommon("save")
								: tCommon("create")}
						</button>
					</div>
				</div>
			</div>
		</div>
	);
}
