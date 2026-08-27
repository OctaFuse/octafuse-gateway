'use client';

import { useMemo, useState } from 'react';
import { CodeBracketIcon, PlusIcon, TrashIcon } from '@heroicons/react/24/outline';
import { useTranslations } from 'next-intl';
import { DailyScheduleEditor } from '@/components/daily-schedule-editor';
import {
	MODEL_INPUT_MODALITIES,
	MODEL_OUTPUT_MODALITIES,
} from '@octafuse/core/db/model-modalities';
import { ModelModalitiesBadgeFromRaw } from '@/components/model-modalities-badge';
import { PricingTiersEditor } from '@/components/pricing-tiers-editor';
import { MODEL_VENDOR_OPTIONS } from '@/lib/model-vendor';
import {
	createDefaultAudioCharacterPricingDraft,
	createDefaultAudioPricingDraft,
	createDefaultAudioTokenPricingDraft,
	createDefaultImagePerImageDraft,
	formatCatalogPricingProfilePreview,
	type AudioBillingModeDraft,
	type AudioPricingDraftState,
	type CatalogScheduleFormWindow,
	type ImageBillingModeDraft,
	type ImagePerImageDraft,
	type PricingTierDraftRow,
} from '@/lib/pricing-tiers-draft';
import { tagBadgeClass } from '../model-utils';
import type { ModelFormData, ModelFormKind, ModelListItem } from '../types';

type Props = {
	open: boolean;
	editingModel: ModelListItem | null;
	formData: ModelFormData;
	/** 当前 Kind（含 audio；由父级 formKind 驱动，避免仅靠 modalities 误判） */
	formKind: ModelFormKind;
	pricingTierRows: PricingTierDraftRow[];
	catalogScheduleWindows?: CatalogScheduleFormWindow[];
	onCatalogScheduleWindowsChange?: (windows: CatalogScheduleFormWindow[]) => void;
	imageBillingMode?: ImageBillingModeDraft;
	onImageBillingModeChange?: (mode: ImageBillingModeDraft) => void;
	imagePerImageDraft?: ImagePerImageDraft;
	onImagePerImageDraftChange?: (draft: ImagePerImageDraft) => void;
	audioPricingDraft?: AudioPricingDraftState;
	onAudioPricingDraftChange?: (draft: AudioPricingDraftState) => void;
	tagInput: string;
	saveError: string;
	isSaving: boolean;
	isDeleting: boolean;
	billingCurrency: string;
	onClose: () => void;
	onFormChange: (form: ModelFormData) => void;
	onPricingTierRowsChange: (rows: PricingTierDraftRow[]) => void;
	onTagInputChange: (value: string) => void;
	onAddTag: () => void;
	onRemoveTag: (tag: string) => void;
	onToggleModality: (kind: 'input_modalities' | 'output_modalities', modality: string) => void;
	/** 切换 LLM / Image / Audio Kind（同步 modalities 与默认 pricing） */
	onKindChange: (kind: ModelFormKind) => void;
	onSave: () => void;
	onDelete: (id: string) => void;
};

export function ModelModal(props: Props) {
	const {
		open,
		editingModel,
		formData,
		formKind,
		pricingTierRows,
		catalogScheduleWindows = [],
		onCatalogScheduleWindowsChange,
		imageBillingMode = 'token',
		onImageBillingModeChange,
		imagePerImageDraft,
		onImagePerImageDraftChange,
		audioPricingDraft,
		onAudioPricingDraftChange,
		tagInput,
		saveError,
		isSaving,
		isDeleting,
		billingCurrency,
		onClose,
		onFormChange,
		onPricingTierRowsChange,
		onTagInputChange,
		onAddTag,
		onRemoveTag,
		onToggleModality,
		onKindChange,
		onSave,
		onDelete,
	} = props;

	const t = useTranslations('models.modal');
	const tCommon = useTranslations('common');
	const tRoutes = useTranslations('routes.modal');
	const isImageModel = formKind === 'image';
	const isAudioModel = formKind === 'audio';
	const pricingProfileJsonSessionKey = `${open ? '1' : '0'}:${editingModel?.id ?? 'new'}`;
	const [pricingProfileJsonSession, setPricingProfileJsonSession] = useState(pricingProfileJsonSessionKey);
	const [pricingProfileJsonOpen, setPricingProfileJsonOpen] = useState(false);
	const [pricingProfileJsonCopied, setPricingProfileJsonCopied] = useState(false);
	if (pricingProfileJsonSession !== pricingProfileJsonSessionKey) {
		setPricingProfileJsonSession(pricingProfileJsonSessionKey);
		setPricingProfileJsonOpen(false);
		setPricingProfileJsonCopied(false);
	}
	const pricingProfilePreview = useMemo(
		() =>
			formatCatalogPricingProfilePreview({
				kind: formKind,
				rows: pricingTierRows,
				imageDraft: isImageModel
					? {
							mode: imageBillingMode,
							tiers: pricingTierRows,
							perImage: imagePerImageDraft ?? createDefaultImagePerImageDraft(),
						}
					: undefined,
				audioDraft: audioPricingDraft,
				schedule: catalogScheduleWindows,
			}),
		[
			formKind,
			pricingTierRows,
			isImageModel,
			imageBillingMode,
			imagePerImageDraft,
			audioPricingDraft,
			catalogScheduleWindows,
		]
	);
	const audioCapability =
		isAudioModel && audioPricingDraft?.mode === 'per_character'
			? 'speech'
			: 'transcription';
	const hideTokenLimits = isImageModel || isAudioModel;
	// 音频能力沿用下方“音频定价”的分段控件样式，保持弹窗内的视觉一致性。
	const audioCapabilityOptions = [
		{
			id: 'transcription' as const,
			label: t('audioCapabilityTranscription'),
		},
		{
			id: 'speech' as const,
			label: t('audioCapabilitySpeech'),
		},
	] as const;

	/** 音频能力是显式配置项：同步设置模态和计费，避免保存出 TTS + 按秒这类矛盾组合。 */
	const changeAudioCapability = (next: 'transcription' | 'speech') => {
		if (!isAudioModel || !onAudioPricingDraftChange || next === audioCapability) return;
		if (next === 'speech') {
			onFormChange({
				...formData,
				input_modalities: ['text'],
				output_modalities: ['audio'],
			});
			onAudioPricingDraftChange(createDefaultAudioCharacterPricingDraft());
			return;
		}
		onFormChange({
			...formData,
			input_modalities: ['audio'],
			output_modalities: ['text'],
		});
		onAudioPricingDraftChange(createDefaultAudioPricingDraft());
	};

	if (!open) return null;

	return (
		<div
			className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4"
			onMouseDown={(e) => {
				if (e.target === e.currentTarget && !isSaving && !isDeleting) {
					onClose();
				}
			}}
		>
			<div className="flex max-h-[95vh] w-full max-w-6xl flex-col overflow-hidden rounded-xl bg-white shadow-xl ring-1 ring-black/5">
				<div className="flex shrink-0 items-center justify-between border-b border-gray-200 px-6 py-4">
					<h2 className="text-lg font-semibold text-gray-900">
						{editingModel ? t('editTitle') : t('newTitle')}
					</h2>
					<button
						type="button"
						onClick={onClose}
						className="rounded-md p-1.5 text-gray-400 transition hover:bg-gray-100 hover:text-gray-600 disabled:opacity-50"
						disabled={isSaving || isDeleting}
						aria-label={tCommon('close')}
					>
						×
					</button>
				</div>

				<div className="min-h-0 flex-1 overflow-y-auto px-6 py-5">
					{saveError && (
						<div className="mb-4 p-3 bg-red-50 border border-red-200 rounded-md text-red-600 text-sm">
							{saveError}
						</div>
					)}

					<div className="grid grid-cols-2 gap-4 lg:grid-cols-3">
						{!editingModel ? (
						<div className="col-span-2 lg:col-span-3">
							<label className="block text-sm font-medium text-gray-700 mb-1.5">
								{t('kind')}
							</label>
							<div
								className="inline-flex rounded-md border border-gray-200 bg-gray-50 p-0.5"
								role="group"
								aria-label={t('kind')}
							>
								{(
									[
										{ id: 'llm' as const, label: t('kindLlm') },
										{ id: 'image' as const, label: t('kindImage') },
										{ id: 'audio' as const, label: t('kindAudio') },
									] as const
								).map((opt) => {
									const active = formKind === opt.id;
									return (
										<button
											key={opt.id}
											type="button"
											disabled={isSaving || isDeleting}
											onClick={() => {
												if (formKind !== opt.id) onKindChange(opt.id);
											}}
											className={
												active
													? 'rounded px-3 py-1.5 text-sm font-medium bg-white text-gray-900 shadow-sm'
													: 'rounded px-3 py-1.5 text-sm font-medium text-gray-600 hover:text-gray-900'
											}
										>
											{opt.label}
										</button>
									);
								})}
							</div>
							<p className="mt-1.5 text-[11px] text-gray-500 leading-relaxed">
								{isAudioModel
									? t('kindHintAudio')
									: isImageModel
										? t('kindHintImage')
										: t('kindHintLlm')}
							</p>
						</div>
						) : null}
						{isAudioModel ? (
							<div className="col-span-2 rounded-md border border-gray-200 bg-gray-50/80 p-3 lg:col-span-3">
								<p className="text-sm font-medium text-gray-800">
									{t('audioCapability')}
								</p>
								<div
									className="mt-2 inline-flex rounded-md border border-gray-200 bg-gray-50 p-0.5"
									role="group"
									aria-label={t('audioCapability')}
								>
									{audioCapabilityOptions.map((option) => (
										<button
											key={option.id}
											type="button"
											disabled={isSaving || isDeleting}
											onClick={() => changeAudioCapability(option.id)}
											aria-pressed={audioCapability === option.id}
											className={
												audioCapability === option.id
												? 'rounded px-3 py-1.5 text-sm font-medium bg-white text-gray-900 shadow-sm'
												: 'rounded px-3 py-1.5 text-sm font-medium text-gray-600 hover:text-gray-900'
										}
										>
											{option.label}
										</button>
									))}
								</div>
								<p className="mt-2 text-[11px] leading-relaxed text-gray-500">
									{audioCapability === 'speech'
										? t('audioCapabilityHintSpeech')
										: t('audioCapabilityHintTranscription')}
								</p>
							</div>
						) : null}
						<div>
							<label className="block text-sm font-medium text-gray-700 mb-1">{t('modelIdRequired')}</label>
							<input
								type="text"
								value={formData.id}
								onChange={(e) => onFormChange({ ...formData, id: e.target.value })}
								className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
								placeholder={t('modelIdPlaceholder')}
								required
								disabled={!!editingModel}
							/>
						</div>
						<div>
							<label className="block text-sm font-medium text-gray-700 mb-1">{t('displayName')}</label>
							<input
								type="text"
								value={formData.display_name}
								onChange={(e) => onFormChange({ ...formData, display_name: e.target.value })}
								className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
								placeholder={t('displayNamePlaceholder')}
							/>
						</div>
						<div>
							<label className="block text-sm font-medium text-gray-700 mb-1">{t('vendor')}</label>
							<select
								value={
									MODEL_VENDOR_OPTIONS.some((o) => o.key === formData.vendor)
										? formData.vendor
										: 'other'
								}
								onChange={(e) => onFormChange({ ...formData, vendor: e.target.value })}
								className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500 bg-white"
							>
								{MODEL_VENDOR_OPTIONS.map((o) => (
									<option key={o.key} value={o.key}>
										{o.label}
									</option>
								))}
							</select>
						</div>
						<div>
							<label className="block text-sm font-medium text-gray-700 mb-1">{t('released')}</label>
							<input
								type="date"
								value={formData.released_at}
								onChange={(e) => onFormChange({ ...formData, released_at: e.target.value })}
								className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
							/>
						</div>
						{!hideTokenLimits ? (
							<>
								<div>
									<label className="block text-sm font-medium text-gray-700 mb-1">
										{t('contextWindow')}
									</label>
									<input
										type="number"
										value={formData.context_window}
										onChange={(e) =>
											onFormChange({ ...formData, context_window: e.target.value })
										}
										className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
										placeholder={t('contextWindowPlaceholder')}
									/>
								</div>
								<div>
									<label className="block text-sm font-medium text-gray-700 mb-1">
										{t('maxTokens')}
									</label>
									<input
										type="number"
										value={formData.max_tokens}
										onChange={(e) =>
											onFormChange({ ...formData, max_tokens: e.target.value })
										}
										className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
										placeholder={t('maxTokensPlaceholder')}
									/>
								</div>
							</>
						) : (
							<div className="col-span-2 rounded-md border border-amber-100 bg-amber-50/70 px-3 py-2 text-xs text-amber-800 lg:col-span-3">
								{isAudioModel ? t('audioNoTokenLimits') : t('imageNoTokenLimits')}
							</div>
						)}
					</div>

					<div className="mt-5 rounded-md border border-gray-200 bg-gray-50/80 px-3 py-2.5">
							<div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
								<div className="min-w-0 flex-1 space-y-2.5">
									<div className="grid gap-2 sm:grid-cols-[4.5rem_minmax(0,1fr)] sm:items-center">
										<p className="text-[11px] font-semibold uppercase tracking-wide text-gray-500">
											{t('input')}
										</p>
										<div className="flex flex-wrap gap-2">
											{MODEL_INPUT_MODALITIES.map((m) => (
												<label
													key={m}
													className="inline-flex items-center gap-1.5 rounded-md border border-gray-200 bg-white px-2 py-1 text-xs text-gray-700"
												>
											<input
												type="checkbox"
												checked={formData.input_modalities.includes(m)}
												onChange={() => onToggleModality('input_modalities', m)}
												disabled={isAudioModel || isSaving || isDeleting}
												className="h-3.5 w-3.5 rounded border-gray-300 text-blue-600 focus:ring-blue-500"
													/>
													{m}
												</label>
											))}
										</div>
									</div>
									<div className="grid gap-2 sm:grid-cols-[4.5rem_minmax(0,1fr)] sm:items-center">
										<p className="text-[11px] font-semibold uppercase tracking-wide text-gray-500">
											{t('output')}
										</p>
										<div className="flex flex-wrap gap-2">
											{MODEL_OUTPUT_MODALITIES.map((m) => (
												<label
													key={m}
													className="inline-flex items-center gap-1.5 rounded-md border border-gray-200 bg-white px-2 py-1 text-xs text-gray-700"
												>
											<input
												type="checkbox"
												checked={formData.output_modalities.includes(m)}
												onChange={() => onToggleModality('output_modalities', m)}
												disabled={isAudioModel || isSaving || isDeleting}
												className="h-3.5 w-3.5 rounded border-gray-300 text-blue-600 focus:ring-blue-500"
													/>
													{m}
												</label>
											))}
										</div>
									</div>
								</div>
								<div className="shrink-0 rounded-md border border-gray-200 bg-white px-3 py-2 sm:min-w-32">
									<p className="text-[11px] font-semibold uppercase tracking-wide text-gray-500">
										{t('preview')}
									</p>
									<div className="mt-1.5">
										<ModelModalitiesBadgeFromRaw
											inputRaw={JSON.stringify(formData.input_modalities)}
											outputRaw={JSON.stringify(formData.output_modalities)}
											size="sm"
											spacing="relaxed"
										/>
									</div>
								</div>
							</div>
						</div>

					<section className="mt-5 rounded-lg border border-sky-100 bg-sky-50 p-4">
						<div className="mb-3 flex items-center justify-between gap-2">
							<h3 className="text-sm font-medium text-gray-800">{t('pricingProfile')}</h3>
							<button
								type="button"
								onClick={() => setPricingProfileJsonOpen((openJson) => !openJson)}
								aria-expanded={pricingProfileJsonOpen}
								aria-controls="model-pricing-profile-json"
								title={
									pricingProfileJsonOpen ? t('hidePricingProfileJson') : t('viewPricingProfileJson')
								}
								className={`inline-flex shrink-0 items-center gap-1 rounded-md border px-1.5 py-0.5 text-[10px] font-semibold focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-500/30 ${
									pricingProfileJsonOpen
										? 'border-blue-300 bg-blue-50 text-blue-800'
										: 'border-gray-300 bg-white text-gray-600 hover:bg-gray-50'
								}`}
							>
								<CodeBracketIcon className="h-3.5 w-3.5" aria-hidden />
								JSON
							</button>
						</div>
						{pricingProfileJsonOpen ? (
							<div
								id="model-pricing-profile-json"
								className="mb-3 space-y-1.5 rounded-md border border-dashed border-gray-300 bg-gray-50/90 p-2"
							>
								<div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1">
									<code className="rounded bg-white px-1 py-0.5 text-[10px] font-semibold text-gray-600">
										pricing_profile
									</code>
									{pricingProfilePreview.ok ? (
										<button
											type="button"
											onClick={() => {
												if (!navigator.clipboard?.writeText) return;
												void navigator.clipboard.writeText(pricingProfilePreview.text).then(
													() => {
														setPricingProfileJsonCopied(true);
														window.setTimeout(() => setPricingProfileJsonCopied(false), 1500);
													},
													() => {},
												);
											}}
											className="text-[11px] font-medium text-blue-600 hover:text-blue-800"
										>
											{pricingProfileJsonCopied ? tCommon('copied') : tCommon('copy')}
										</button>
									) : null}
								</div>
								<textarea
									readOnly
									rows={Math.min(
										16,
										6 + pricingTierRows.length * 3 + catalogScheduleWindows.length * 3
									)}
									value={pricingProfilePreview.text}
									className={`w-full resize-y rounded-md border bg-white px-2 py-1.5 font-mono text-[11px] leading-relaxed ${
										pricingProfilePreview.ok
											? 'border-gray-200 text-gray-800'
											: 'border-red-200 text-red-700'
									}`}
									spellCheck={false}
									aria-label={t('viewPricingProfileJson')}
								/>
							</div>
						) : null}
						<div className="grid grid-cols-1 gap-4 xl:grid-cols-2">
							<div className="min-w-0 rounded-md border border-slate-200/80 bg-white p-3">
							{isAudioModel && audioPricingDraft && onAudioPricingDraftChange ? (
								<div className="space-y-3">
									<p className="text-sm font-medium text-gray-800">{t('audioPricing')}</p>
									<div className="space-y-1.5">
										<p className="text-[11px] font-medium text-gray-600">
											{t('audioBillingMode')}
										</p>
										<div
											className="inline-flex rounded-md border border-gray-200 bg-gray-50 p-0.5"
											role="group"
											aria-label={t('audioBillingMode')}
										>
										{(audioCapability === 'speech'
											? [
												{
													id: 'per_character' as const,
													label: t('audioBillingModePerCharacter'),
												},
											]
											: [
												{
													id: 'per_second' as const,
												label: t('audioBillingModePerSecond'),
											},
											{
													id: 'token' as const,
													label: t('audioBillingModeToken'),
												},
											]).map((opt) => {
												const active = audioPricingDraft.mode === opt.id;
												return (
													<button
														key={opt.id}
														type="button"
														onClick={() => {
															if (audioPricingDraft.mode === opt.id) return;
															const nextMode: AudioBillingModeDraft = opt.id;
															if (nextMode === 'per_second') {
																onAudioPricingDraftChange({
																	...createDefaultAudioPricingDraft(),
																	price_per_second:
																		audioPricingDraft.price_per_second.trim() !== ''
																			? audioPricingDraft.price_per_second
																			: createDefaultAudioPricingDraft()
																					.price_per_second,
																	minimum_seconds:
																		audioPricingDraft.minimum_seconds.trim() !== ''
																			? audioPricingDraft.minimum_seconds
																			: createDefaultAudioPricingDraft()
																					.minimum_seconds,
																});
														return;
													}
													if (nextMode === 'per_character') {
														onAudioPricingDraftChange({
															...createDefaultAudioCharacterPricingDraft(),
															price_per_character:
																audioPricingDraft.price_per_character.trim() !== ''
																	? audioPricingDraft.price_per_character
																	: '',
															minimum_characters:
																audioPricingDraft.minimum_characters.trim() !== ''
																	? audioPricingDraft.minimum_characters
																	: '0',
														});
														return;
													}
															onAudioPricingDraftChange(
																audioPricingDraft.tiers.length > 0
																	? {
																			...audioPricingDraft,
																			mode: 'token',
																		}
																	: createDefaultAudioTokenPricingDraft()
															);
														}}
														className={
															active
																? 'rounded px-3 py-1.5 text-sm font-medium bg-white text-gray-900 shadow-sm'
																: 'rounded px-3 py-1.5 text-sm font-medium text-gray-600 hover:text-gray-900'
														}
													>
														{opt.label}
													</button>
												);
											})}
										</div>
									</div>
									{audioPricingDraft.mode === 'token' ? (
										<div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
											<div>
												<label className="mb-1 block text-xs font-medium text-gray-600">
													{t('audioInputPricePerM')}
													<span className="ml-1 font-normal text-gray-400">
														({billingCurrency}/1M)
													</span>
												</label>
												<input
													type="number"
													step="any"
													min="0"
													value={audioPricingDraft.tiers[0]?.input_price ?? ''}
													onChange={(e) => {
														const base =
															audioPricingDraft.tiers[0] ??
															createDefaultAudioTokenPricingDraft().tiers[0]!;
														onAudioPricingDraftChange({
															...audioPricingDraft,
															mode: 'token',
															tiers: [
																{
																	...base,
																	input_price: e.target.value,
																},
															],
														});
													}}
													className="w-full rounded-md border border-gray-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
												/>
											</div>
											<div>
												<label className="mb-1 block text-xs font-medium text-gray-600">
													{t('audioOutputPricePerM')}
													<span className="ml-1 font-normal text-gray-400">
														({billingCurrency}/1M)
													</span>
												</label>
												<input
													type="number"
													step="any"
													min="0"
													value={audioPricingDraft.tiers[0]?.output_price ?? ''}
													onChange={(e) => {
														const base =
															audioPricingDraft.tiers[0] ??
															createDefaultAudioTokenPricingDraft().tiers[0]!;
														onAudioPricingDraftChange({
															...audioPricingDraft,
															mode: 'token',
															tiers: [
																{
																	...base,
																	output_price: e.target.value,
																},
															],
														});
													}}
													className="w-full rounded-md border border-gray-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
												/>
											</div>
										</div>
									) : audioPricingDraft.mode === 'per_character' ? (
										<div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
											<div>
												<label className="mb-1 block text-xs font-medium text-gray-600">
													{t('audioPricePerCharacter')}
													<span className="ml-1 font-normal text-gray-400">
														({billingCurrency}/char)
													</span>
												</label>
												<input
													type="number"
													step="any"
													min="0"
													value={audioPricingDraft.price_per_character}
													onChange={(e) =>
														onAudioPricingDraftChange({
															...audioPricingDraft,
															mode: 'per_character',
															price_per_character: e.target.value,
														})
													}
													className="w-full rounded-md border border-gray-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
												/>
											</div>
											<div>
												<label className="mb-1 block text-xs font-medium text-gray-600">
													{t('audioMinimumCharacters')}
												</label>
												<input
													type="number"
													step="1"
													min="0"
													value={audioPricingDraft.minimum_characters}
													onChange={(e) =>
														onAudioPricingDraftChange({
															...audioPricingDraft,
															mode: 'per_character',
															minimum_characters: e.target.value,
														})
													}
													className="w-full rounded-md border border-gray-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
												/>
											</div>
										</div>
									) : (
										<div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
											<div>
												<label className="mb-1 block text-xs font-medium text-gray-600">
													{t('audioPricePerSecond')}
													<span className="ml-1 font-normal text-gray-400">
														({billingCurrency}/s)
													</span>
												</label>
												<input
													type="number"
													step="any"
													min="0"
													value={audioPricingDraft.price_per_second}
													onChange={(e) =>
														onAudioPricingDraftChange({
															...audioPricingDraft,
															mode: 'per_second',
															price_per_second: e.target.value,
														})
													}
													className="w-full rounded-md border border-gray-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
												/>
											</div>
											<div>
												<label className="mb-1 block text-xs font-medium text-gray-600">
													{t('audioMinimumSeconds')}
												</label>
												<input
													type="number"
													step="any"
													min="0"
													value={audioPricingDraft.minimum_seconds}
													onChange={(e) =>
														onAudioPricingDraftChange({
															...audioPricingDraft,
															mode: 'per_second',
															minimum_seconds: e.target.value,
														})
													}
													className="w-full rounded-md border border-gray-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
												/>
											</div>
										</div>
									)}
								</div>
							) : isImageModel ? (
								<PricingTiersEditor
									title={t('imageTokenPricing')}
									rows={pricingTierRows}
									onChange={onPricingTierRowsChange}
									billingCurrencyCode={billingCurrency}
									minRows={0}
									variant="image"
									imageBillingMode={imageBillingMode}
									onImageBillingModeChange={onImageBillingModeChange}
									perImageDraft={imagePerImageDraft}
									onPerImageDraftChange={onImagePerImageDraftChange}
								/>
							) : (
								<PricingTiersEditor
									title={t('standardPricing')}
									rows={pricingTierRows}
									onChange={onPricingTierRowsChange}
									billingCurrencyCode={billingCurrency}
									minRows={0}
								/>
							)}
							</div>
							{onCatalogScheduleWindowsChange ? (
								<div className="min-w-0 rounded-md border border-slate-200/80 bg-white p-3">
									<div className="mb-3">
										<div className="flex items-start justify-between gap-2">
											<h4 className="text-sm font-medium text-gray-800">{t('catalogSchedule')}</h4>
											<button
												type="button"
												onClick={() =>
													onCatalogScheduleWindowsChange([
														...catalogScheduleWindows,
														{ start: '00:00', end: '08:00', factor: '1', days: [] },
													])
												}
												className="inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-md border border-dashed border-gray-400 bg-white text-gray-600 shadow-sm transition hover:border-gray-500 hover:bg-gray-50 hover:text-gray-900"
												aria-label={t('addCatalogScheduleWindow')}
												title={t('addCatalogScheduleWindow')}
											>
												<PlusIcon className="h-3.5 w-3.5" aria-hidden />
											</button>
										</div>
										<p className="mt-1 text-xs leading-5 text-slate-500">
											{t('catalogScheduleHint')}
										</p>
									</div>
									<DailyScheduleEditor
										variant="single"
										windows={catalogScheduleWindows}
										onChange={onCatalogScheduleWindowsChange}
										emptyLabel={t('catalogScheduleEmpty')}
										startLabel={tRoutes('scheduleStart')}
										endLabel={tRoutes('scheduleEnd')}
										factorLabel={t('catalogScheduleFactor')}
										removeLabel={tCommon('delete')}
										dayLabels={{
											days: tRoutes('scheduleDays'),
											everyday: tRoutes('scheduleEveryday'),
											weekdays: tRoutes('scheduleWeekdays'),
											weekend: tRoutes('scheduleWeekend'),
											weekdayShort: [
												tRoutes('weekdayMon'),
												tRoutes('weekdayTue'),
												tRoutes('weekdayWed'),
												tRoutes('weekdayThu'),
												tRoutes('weekdayFri'),
												tRoutes('weekdaySat'),
												tRoutes('weekdaySun'),
											],
										}}
									/>
								</div>
							) : null}
						</div>
					</section>

					<div className="mt-5">
						<label className="mb-1 block text-sm font-medium text-gray-700">{t('tags')}</label>
						<div className="mb-2 flex flex-wrap gap-2">
							{formData.tags.map((tag) => (
								<span
									key={tag}
									className={`inline-flex items-center gap-1 rounded-full px-2 py-1 text-sm ${tagBadgeClass(tag)}`}
								>
									{tag}
									<button
										type="button"
										onClick={() => onRemoveTag(tag)}
										className="text-gray-500 hover:text-red-600"
										aria-label={t('removeTag', { tag })}
									>
										×
									</button>
								</span>
							))}
						</div>
						<div className="flex gap-2">
							<input
								type="text"
								value={tagInput}
								onChange={(e) => onTagInputChange(e.target.value)}
								onKeyDown={(e) => {
									if (e.key === 'Enter' || e.key === ',') {
										e.preventDefault();
										onAddTag();
									}
								}}
								className="flex-1 rounded-md border border-gray-300 px-3 py-2 focus:outline-none focus:ring-2 focus:ring-blue-500"
								placeholder={t('tagsPlaceholder')}
							/>
							<button
								type="button"
								onClick={onAddTag}
								className="rounded-md border border-gray-300 px-3 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50"
							>
								{tCommon('add')}
							</button>
						</div>
					</div>
					<div className="mt-5 grid grid-cols-1 items-stretch gap-5 xl:grid-cols-2">
						<div className="flex min-h-36 flex-col">
							<label className="mb-1 block text-sm font-medium text-gray-700">{t('description')}</label>
							<textarea
								rows={4}
								value={formData.description}
								onChange={(e) => onFormChange({ ...formData, description: e.target.value })}
								className="min-h-0 w-full flex-1 rounded-md border border-gray-300 px-3 py-2 focus:outline-none focus:ring-2 focus:ring-blue-500"
								placeholder={t('descriptionPlaceholder')}
							/>
						</div>
						<div className="flex min-h-36 flex-col">
							<label className="mb-1 block text-sm font-medium text-gray-700">{t('metadataJson')}</label>
							<textarea
								rows={4}
								value={formData.metadata}
								onChange={(e) => onFormChange({ ...formData, metadata: e.target.value })}
								className="min-h-0 w-full flex-1 rounded-md border border-gray-300 px-3 py-2 font-mono text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
								placeholder={t('metadataPlaceholder')}
							/>
						</div>
					</div>
				</div>

				<div className="flex shrink-0 flex-wrap items-center justify-between gap-3 border-t border-gray-200 bg-gray-50 px-6 py-4">
					<div>
						{editingModel && (
							<button
								type="button"
								onClick={() => onDelete(editingModel.id)}
								disabled={isSaving || isDeleting}
								className="inline-flex items-center gap-1.5 px-3 py-2 border border-red-200 rounded-md text-sm font-medium text-red-700 bg-red-50 hover:bg-red-100 disabled:opacity-50 disabled:cursor-not-allowed"
							>
								<TrashIcon className="h-4 w-4" />
								{isDeleting ? tCommon('deleting') : t('deleteModel')}
							</button>
						)}
					</div>
					<div className="flex gap-3 ml-auto">
						<button
							type="button"
							onClick={onClose}
							className="px-4 py-2 border border-gray-300 rounded-md text-gray-700 hover:bg-gray-50"
							disabled={isSaving || isDeleting}
						>
							{tCommon('cancel')}
						</button>
						<button
							type="button"
							onClick={onSave}
							disabled={isSaving || isDeleting}
							className="px-4 py-2 bg-blue-600 text-white rounded-md hover:bg-blue-700 disabled:opacity-50"
						>
							{isSaving ? tCommon('savingDots') : tCommon('save')}
						</button>
					</div>
				</div>
			</div>
		</div>
	);
}
