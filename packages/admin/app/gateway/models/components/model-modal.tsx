'use client';

import {
	cloneElement,
	isValidElement,
	useEffect,
	useId,
	useMemo,
	useRef,
	useState,
	type KeyboardEvent,
	type ReactNode,
} from 'react';
import {
	AdjustmentsHorizontalIcon,
	CodeBracketIcon,
	DocumentDuplicateIcon,
	InformationCircleIcon,
	ShareIcon,
	TrashIcon,
	XMarkIcon,
} from '@heroicons/react/24/outline';
import { useLocale, useTranslations } from 'next-intl';
import {
	MODEL_INPUT_MODALITIES,
	MODEL_OUTPUT_MODALITIES,
} from '@octafuse/core/db/model-modalities';
import { InfoHintPopover } from '@/components/InfoHintPopover';
import { VendorIcon } from '@/components/model-vendor-icon';
import { ModelModalitiesBadgeFromRaw } from '@/components/model-modalities-badge';
import { MODEL_VENDOR_OPTIONS } from '@/lib/model-vendor';
import {
	createDefaultImagePerImageDraft,
	formatCatalogPricingProfilePreview,
	type AudioPricingDraftState,
	type CatalogScheduleFormWindow,
	type ImageBillingModeDraft,
	type ImagePerImageDraft,
	type PricingTierDraftRow,
} from '@/lib/pricing-tiers-draft';
import { tagBadgeClass } from '../model-utils';
import type { ModelFormData, ModelFormKind, ModelListItem } from '../types';
import { RelatedRoutesPanel } from '@/components/related-routes-panel';
import { useModelRoutes } from '../use-model-routes';
import { ModelPricingPanel } from './model-pricing-panel';
import { ModelPricingJsonPreview } from './model-pricing-json-preview';

export type ModelModalProps = {
	open: boolean;
	editingModel: ModelListItem | null;
	duplicateSourceModelId: string | null;
	formData: ModelFormData;
	/** 当前 Kind（含 audio；由父级 formKind 驱动，避免仅靠 modalities 误判） */
	formKind: ModelFormKind;
	pricingTierRows: PricingTierDraftRow[];
	catalogScheduleWindows?: CatalogScheduleFormWindow[];
	onCatalogScheduleWindowsChange?: (
		windows: CatalogScheduleFormWindow[]
	) => void;
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
	onToggleModality: (
		kind: 'input_modalities' | 'output_modalities',
		modality: string
	) => void;
	/** 切换 LLM / Image / Audio Kind（同步 modalities 与默认 pricing） */
	onKindChange: (kind: ModelFormKind) => void;
	onSave: () => void;
	onDelete: (id: string) => void;
	onDuplicate: () => void;
	onRoutesChanged: () => Promise<void>;
};

const inputClass =
	'h-10 w-full min-w-0 rounded-lg border border-gray-200 bg-white px-3 text-sm text-gray-900 outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-500/10 disabled:bg-gray-50 disabled:text-gray-500';
type Tab = 'basic' | 'pricing' | 'metadata' | 'routes';

function Field({ label, children }: { label: string; children: ReactNode }) {
	const id = useId();
	return (
		<div className="min-w-0">
			<label
				htmlFor={id}
				className="mb-1.5 block text-xs font-medium text-gray-600"
			>
				{label}
			</label>
			{isValidElement<{ id?: string; 'aria-label'?: string }>(children)
				? cloneElement(children, { id, 'aria-label': label })
				: children}
		</div>
	);
}

export function ModelModal(props: ModelModalProps) {
	const {
		open,
		editingModel,
		duplicateSourceModelId,
		formData,
		formKind,
		pricingTierRows,
		catalogScheduleWindows = [],
		imageBillingMode = 'token',
		imagePerImageDraft,
		audioPricingDraft,
		tagInput,
		saveError,
		isSaving,
		isDeleting,
		onClose,
		onFormChange,
		onTagInputChange,
		onAddTag,
		onRemoveTag,
		onToggleModality,
		onKindChange,
		onSave,
		onDelete,
		onDuplicate,
	} = props;
	const t = useTranslations('models.modal');
	const tCommon = useTranslations('common');
	const locale = useLocale();
	const dialogRef = useRef<HTMLDivElement>(null);
	const contentRef = useRef<HTMLDivElement>(null);
	const id = useId();
	const routesState = useModelRoutes(
		open && editingModel ? editingModel.id : null,
		props.onRoutesChanged
	);
	const busy = isSaving || isDeleting || routesState.isDeleting;
	const deleteDisabled =
		busy || !routesState.ready || routesState.routes.length > 0;
	const deleteReason = routesState.error
		? t('relatedRoutes.loadFailed')
		: !routesState.ready
		? tCommon('loading')
		: routesState.routes.length
		? t('routesBlocked', { count: routesState.routes.length })
		: busy
		? isSaving
			? tCommon('saving')
			: tCommon('deleting')
		: undefined;
	const sessionKey = `${open}:${editingModel?.id ?? 'new'}:${
		duplicateSourceModelId ?? ''
	}`;
	const [session, setSession] = useState(sessionKey);
	const [activeTab, setActiveTab] = useState<Tab>('basic');
	const [showPricingJson, setShowPricingJson] = useState(false);
	if (session !== sessionKey) {
		setSession(sessionKey);
		setActiveTab('basic');
		setShowPricingJson(false);
	}
	const isImageModel = formKind === 'image';
	const isAudioModel = formKind === 'asr' || formKind === 'tts';
	const hideTokenLimits = isImageModel || isAudioModel;
	const catalog = editingModel?.catalog_i18n;
	const intro = catalog
		? locale.toLowerCase().startsWith('zh')
			? catalog.zh || catalog.en
			: catalog.en || catalog.zh
		: '';
	const kinds = [
		{ id: 'llm', label: t('kindLlm'), hint: t('kindHintLlm') },
		{ id: 'image', label: t('kindImage'), hint: t('kindHintImage') },
		{ id: 'asr', label: t('kindAsr'), hint: t('kindHintAsr') },
		{ id: 'tts', label: t('kindTts'), hint: t('kindHintTts') },
		{
			id: 'embedding',
			label: t('kindEmbedding'),
			hint: t('kindHintEmbedding'),
		},
	] as const;
	const selectedKind = kinds.find((kind) => kind.id === formKind)!;
	const tabs = [
		{ key: 'basic', label: t('basicTab'), icon: InformationCircleIcon },
		{
			key: 'pricing',
			label: t('pricingProfile'),
			icon: AdjustmentsHorizontalIcon,
		},
		{ key: 'metadata', label: t('metadataTab'), icon: CodeBracketIcon },
		...(editingModel
			? [
					{
						key: 'routes',
						label: t('relatedRoutes.title'),
						icon: ShareIcon,
					} as const,
			  ]
			: []),
	] as const;
	const pricingPreview = useMemo(
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

	useEffect(() => {
		if (!open) return;
		const previous =
			document.activeElement instanceof HTMLElement
				? document.activeElement
				: null;
		const previousOverflow = document.body.style.overflow;
		document.body.style.overflow = 'hidden';
		const autofocus = dialogRef.current?.querySelector<HTMLInputElement>(
			'[data-duplicate-id]'
		);
		(autofocus ?? dialogRef.current)?.focus();
		return () => {
			document.body.style.overflow = previousOverflow;
			previous?.focus();
		};
	}, [open, duplicateSourceModelId]);
	useEffect(() => {
		contentRef.current?.scrollTo(0, 0);
	}, [activeTab, showPricingJson, sessionKey]);

	useEffect(() => {
		if (open && !busy && document.activeElement === document.body)
			dialogRef.current?.focus();
	}, [open, busy]);

	const selectTab = (key: Tab) => {
		setActiveTab(key);
		setShowPricingJson(false);
	};
	const navigateTabs = (event: KeyboardEvent<HTMLButtonElement>, key: Tab) => {
		if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return;
		event.preventDefault();
		const index = tabs.findIndex((tab) => tab.key === key);
		const next =
			event.key === 'Home'
				? 0
				: event.key === 'End'
				? tabs.length - 1
				: (index + (event.key === 'ArrowLeft' ? -1 : 1) + tabs.length) %
				  tabs.length;
		selectTab(tabs[next].key);
		document.getElementById(`${id}-${tabs[next].key}-tab`)?.focus();
	};
	const handleKeys = (event: KeyboardEvent<HTMLDivElement>) => {
		if (document.querySelector('[role="alertdialog"]')) return;
		if (event.key === 'Escape' && !busy) {
			event.stopPropagation();
			onClose();
		}
		if (event.key !== 'Tab') return;
		const focusable = Array.from(
			event.currentTarget.querySelectorAll<HTMLElement>(
				'button:not(:disabled), input:not(:disabled), select:not(:disabled), textarea:not(:disabled), a[href], [tabindex="0"]'
			)
		).filter(
			(element) => element.tabIndex >= 0 && element.getClientRects().length > 0
		);
		const first = focusable[0],
			last = focusable[focusable.length - 1];
		if (
			event.shiftKey &&
			(document.activeElement === first ||
				document.activeElement === event.currentTarget)
		) {
			event.preventDefault();
			last?.focus();
		} else if (
			!event.shiftKey &&
			(document.activeElement === last ||
				document.activeElement === event.currentTarget)
		) {
			event.preventDefault();
			first?.focus();
		}
	};
	const deleteButton = editingModel ? (
		<button
			type="button"
			onClick={() => {
				if (!deleteDisabled) onDelete(editingModel.id);
			}}
			disabled={deleteDisabled}
			className="inline-flex items-center gap-1.5 rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm font-medium text-red-700 hover:bg-red-100 disabled:pointer-events-none disabled:opacity-50"
		>
			<TrashIcon className="h-4 w-4" aria-hidden />
			{isDeleting ? tCommon('deleting') : t('deleteModel')}
		</button>
	) : null;
	if (!open) return null;

	return (
		<div
			className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/50 p-2 sm:p-6"
			onMouseDown={(event) => {
				if (event.target === event.currentTarget && !busy) onClose();
			}}
		>
			<div
				ref={dialogRef}
				role="dialog"
				aria-modal="true"
				aria-labelledby={`${id}-title`}
				tabIndex={-1}
				onKeyDown={handleKeys}
				className="flex h-[min(760px,90dvh)] max-h-[calc(100dvh-1rem)] w-full max-w-5xl flex-col overflow-hidden rounded-2xl bg-white shadow-2xl outline-none"
			>
				<header className="flex shrink-0 items-start justify-between gap-4 px-5 pb-5 pt-6 sm:px-7">
					<div className="min-w-0">
						<h2
							id={`${id}-title`}
							className="text-lg font-semibold text-gray-900"
						>
							{editingModel ? t('editTitle') : t('newTitle')}
						</h2>
						<p className="mt-1.5 text-sm text-gray-500">{t('editHint')}</p>
						{!editingModel && duplicateSourceModelId ? (
							<p className="mt-1 text-xs text-gray-500">
								{t('prefilledFrom', { id: duplicateSourceModelId })}
							</p>
						) : null}
					</div>
					<button
						type="button"
						onClick={onClose}
						disabled={busy}
						aria-label={tCommon('close')}
						className="rounded-lg p-2 text-gray-400 hover:bg-gray-100 hover:text-gray-600 disabled:opacity-50"
					>
						<XMarkIcon className="h-5 w-5" aria-hidden />
					</button>
				</header>
				<div className="flex shrink-0 items-center justify-between gap-3 border-b border-gray-200 px-5 sm:px-7">
					<div
						role="tablist"
						aria-label={t('settingsLabel')}
						className="flex min-w-0 flex-1 gap-5 overflow-x-auto [scrollbar-width:none]"
					>
						{tabs.map(({ key, label, icon: Icon }) => (
							<button
								key={key}
								id={`${id}-${key}-tab`}
								type="button"
								role="tab"
								aria-selected={activeTab === key}
								aria-controls={`${id}-${key}-panel`}
								tabIndex={activeTab === key ? 0 : -1}
								onClick={() => selectTab(key)}
								onKeyDown={(event) => navigateTabs(event, key)}
								className={`inline-flex items-center gap-2 whitespace-nowrap border-b-2 pb-3 text-sm outline-none focus-visible:ring-2 focus-visible:ring-blue-300 ${
									activeTab === key
										? 'border-blue-600 font-medium text-blue-600'
										: 'border-transparent text-gray-500 hover:text-gray-800'
								}`}
							>
								<Icon className="h-4 w-4" aria-hidden />
								{label}
								{key === 'routes' ? (
									<span className="rounded-full bg-gray-100 px-2 py-0.5 text-[10px] tabular-nums text-gray-500">
										{routesState.ready ? routesState.routes.length : '…'}
									</span>
								) : null}
							</button>
						))}
					</div>
					{activeTab === 'pricing' ? (
						<button
							type="button"
							onClick={() => setShowPricingJson((value) => !value)}
							aria-label={
								showPricingJson
									? t('hidePricingProfileJson')
									: t('viewPricingProfileJson')
							}
							aria-pressed={showPricingJson}
							className={`mb-2 inline-flex shrink-0 items-center gap-1.5 rounded-md px-2.5 py-1.5 text-xs font-medium ${
								showPricingJson
									? 'bg-blue-50 text-blue-600'
									: 'text-gray-500 hover:bg-gray-50 hover:text-gray-800'
							}`}
						>
							<CodeBracketIcon className="h-4 w-4" aria-hidden />
							{showPricingJson ? t('backToForm') : 'JSON'}
						</button>
					) : null}
				</div>
				{saveError ? (
					<div
						role="alert"
						className="mx-5 mt-4 shrink-0 rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-600 sm:mx-7"
					>
						{saveError}
					</div>
				) : null}
				<div
					ref={contentRef}
					className="min-h-0 flex-1 overflow-y-auto overscroll-contain"
				>
					<fieldset disabled={busy} className="m-0 h-full min-w-0 border-0 p-0">
						<section
							id={`${id}-${activeTab}-panel`}
							role="tabpanel"
							aria-labelledby={`${id}-${activeTab}-tab`}
							className={`min-h-full px-5 py-6 sm:px-7 ${
								activeTab === 'basic' ? 'md:h-full md:min-h-0' : ''
							} ${
								activeTab === 'metadata' ||
								(activeTab === 'pricing' && showPricingJson)
									? 'flex flex-col'
									: ''
							}`}
						>
							{activeTab === 'basic' ? (
								<div className="grid min-h-full gap-7 md:h-full md:min-h-0 md:grid-cols-[1.1fr_1fr]">
									<div className="min-w-0 space-y-3 md:min-h-0 md:overflow-y-auto md:overscroll-contain md:pr-1">
										<div className="flex items-start gap-3">
											<div className="min-w-0 flex-1">
												<div className="mb-1.5 flex items-center gap-1.5">
													<span className="text-xs font-medium text-gray-600">
														{t('kind')}
													</span>
													<InfoHintPopover
														label={t('kind')}
														openOnHover
														openOnFocus
														portal
														align="start"
													>
														<p className="leading-6">{selectedKind.hint}</p>
													</InfoHintPopover>
												</div>
												{editingModel ? (
													<p className="text-sm font-medium leading-6 text-gray-900">
														{selectedKind.label}
													</p>
												) : (
													<div
														role="group"
														aria-label={t('kind')}
														className="flex flex-wrap gap-1.5"
													>
														{kinds.map((kind) => (
															<button
																key={kind.id}
																type="button"
																aria-pressed={formKind === kind.id}
																onClick={() => {
																	if (formKind !== kind.id)
																		onKindChange(kind.id);
																}}
																className={`rounded-md border px-2.5 py-1.5 text-xs font-medium ${
																	formKind === kind.id
																		? 'border-blue-200 bg-blue-50 text-blue-700'
																		: 'border-gray-200 text-gray-600 hover:bg-gray-50'
																}`}
															>
																{kind.label}
															</button>
														))}
													</div>
												)}
											</div>
											<VendorIcon vendor={formData.vendor} size="identity" />
										</div>
										<div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
											<Field label={t('modelIdRequired')}>
												<input
													type="text"
													value={formData.id}
													onChange={(event) =>
														onFormChange({
															...formData,
															id: event.target.value,
														})
													}
													disabled={!!editingModel}
													data-duplicate-id={
														!editingModel && duplicateSourceModelId
															? ''
															: undefined
													}
													className={`${inputClass} font-mono`}
													placeholder={t('modelIdPlaceholder')}
													required
												/>
											</Field>
											<Field label={t('displayName')}>
												<input
													type="text"
													value={formData.display_name}
													onChange={(event) =>
														onFormChange({
															...formData,
															display_name: event.target.value,
														})
													}
													className={inputClass}
													placeholder={t('displayNamePlaceholder')}
												/>
											</Field>
										</div>
										<div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
											<Field label={t('vendor')}>
												<select
													value={
														MODEL_VENDOR_OPTIONS.some(
															(option) => option.key === formData.vendor
														)
															? formData.vendor
															: 'other'
													}
													onChange={(event) =>
														onFormChange({
															...formData,
															vendor: event.target.value,
														})
													}
													className={inputClass}
												>
													{MODEL_VENDOR_OPTIONS.map((option) => (
														<option key={option.key} value={option.key}>
															{option.label}
														</option>
													))}
												</select>
											</Field>
											<Field label={t('released')}>
												<input
													type="date"
													value={formData.released_at}
													onChange={(event) =>
														onFormChange({
															...formData,
															released_at: event.target.value,
														})
													}
													className={inputClass}
												/>
											</Field>
										</div>
										{!hideTokenLimits ? (
											<div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
												<Field label={t('contextWindow')}>
													<input
														type="number"
														min="0"
														value={formData.context_window}
														onChange={(event) =>
															onFormChange({
																...formData,
																context_window: event.target.value,
															})
														}
														className={`${inputClass} font-mono`}
														placeholder={t('contextWindowPlaceholder')}
													/>
												</Field>
												{formKind !== 'embedding' ? (
													<Field label={t('maxTokens')}>
														<input
															type="number"
															min="0"
															value={formData.max_tokens}
															onChange={(event) =>
																onFormChange({
																	...formData,
																	max_tokens: event.target.value,
																})
															}
															className={`${inputClass} font-mono`}
															placeholder={t('maxTokensPlaceholder')}
														/>
													</Field>
												) : null}
											</div>
										) : null}
										<div className="rounded-xl border border-gray-200">
											<div className="flex items-center justify-between gap-3 border-b border-gray-100 px-3 py-2.5">
												<span className="inline-flex items-center gap-1.5 text-xs font-medium text-gray-700">
													{t('modalities')}
													<InfoHintPopover
														label={t('modalities')}
														openOnHover
														openOnFocus
														portal
														align="start"
													>
														<p className="leading-6">{selectedKind.hint}</p>
													</InfoHintPopover>
												</span>
												<ModelModalitiesBadgeFromRaw
													inputRaw={JSON.stringify(formData.input_modalities)}
													outputRaw={JSON.stringify(formData.output_modalities)}
													size="sm"
													spacing="relaxed"
												/>
											</div>
											<div className="space-y-2.5 p-3">
												{(
													['input_modalities', 'output_modalities'] as const
												).map((direction) => (
													<div
														role="group"
														aria-label={t(
															direction === 'input_modalities'
																? 'input'
																: 'output'
														)}
														key={direction}
														className="flex min-w-0 flex-wrap items-center gap-x-3 gap-y-2"
													>
														<span className="w-6 shrink-0 text-xs text-gray-500">
															{t(
																direction === 'input_modalities'
																	? 'input'
																	: 'output'
															)}
														</span>
														<div className="flex flex-wrap gap-1.5">
															{(direction === 'input_modalities'
																? MODEL_INPUT_MODALITIES
																: MODEL_OUTPUT_MODALITIES
															).map((modality) => (
																<label
																	key={modality}
																	className={`inline-flex items-center gap-1.5 rounded-md border px-2 py-1 text-xs ${
																		formData[direction].includes(modality)
																			? 'border-blue-200 bg-blue-50/70 text-blue-700'
																			: 'border-gray-200 text-gray-500'
																	} ${
																		isAudioModel
																			? 'opacity-60'
																			: 'cursor-pointer'
																	}`}
																>
																	<input
																		type="checkbox"
																		checked={formData[direction].includes(
																			modality
																		)}
																		onChange={() =>
																			onToggleModality(direction, modality)
																		}
																		disabled={isAudioModel}
																		className="h-3.5 w-3.5 rounded border-gray-300 text-blue-600 focus:ring-blue-500"
																	/>
																	{t(`modalityLabels.${modality}`)}
																</label>
															))}
														</div>
													</div>
												))}
											</div>
										</div>
										<div>
											<label
												htmlFor={`${id}-tag`}
												className="mb-1.5 block text-xs font-medium text-gray-600"
											>
												{t('tags')}
											</label>
											{formData.tags.length ? (
												<div className="mb-2 flex flex-wrap gap-1.5">
													{formData.tags.map((tag) => (
														<span
															key={tag}
															className={`inline-flex items-center gap-1 rounded-md px-2 py-1 text-xs ${tagBadgeClass(
																tag
															)}`}
														>
															{tag}
															<button
																type="button"
																onClick={() => onRemoveTag(tag)}
																aria-label={t('removeTag', { tag })}
																className="rounded text-gray-400 hover:text-red-600"
															>
																<XMarkIcon
																	className="h-3.5 w-3.5"
																	aria-hidden
																/>
															</button>
														</span>
													))}
												</div>
											) : null}
											<div className="flex gap-2">
												<input
													id={`${id}-tag`}
													type="text"
													value={tagInput}
													onChange={(event) =>
														onTagInputChange(event.target.value)
													}
													onKeyDown={(event) => {
														if (event.key === 'Enter' || event.key === ',') {
															event.preventDefault();
															onAddTag();
														}
													}}
													className={inputClass}
													placeholder={t('tagsPlaceholder')}
												/>
												<button
													type="button"
													onClick={onAddTag}
													disabled={!tagInput.trim()}
													className="shrink-0 whitespace-nowrap rounded-lg border border-gray-200 px-3 text-sm text-gray-600 hover:bg-gray-50 disabled:opacity-40"
												>
													{tCommon('add')}
												</button>
											</div>
										</div>
									</div>
									<div className="flex min-w-0 flex-col gap-5 md:h-full md:min-h-0">
										{intro ? (
											<div className="flex flex-col rounded-xl border border-gray-200 bg-gray-50/40 p-4 md:min-h-0 md:flex-1">
												<h3 className="shrink-0 text-xs font-medium text-gray-500">
													{t('catalogIntro')}
												</h3>
												<p
													tabIndex={0}
													className="mt-2 max-h-40 md:min-h-0 md:max-h-none md:flex-1 overflow-y-auto overscroll-contain whitespace-pre-wrap break-words text-sm leading-6 text-gray-700 outline-none focus-visible:ring-2 focus-visible:ring-blue-200"
												>
													{intro}
												</p>
											</div>
										) : null}
										<div className="shrink-0">
											<label
												htmlFor={`${id}-note`}
												className="mb-2 block text-xs font-medium text-gray-700"
											>
												{t('note')}
											</label>
											<textarea
												id={`${id}-note`}
												value={formData.note}
												onChange={(event) =>
													onFormChange({
														...formData,
														note: event.target.value,
													})
												}
												rows={4}
												className="block h-32 max-h-32 w-full resize-none overflow-y-auto overscroll-contain rounded-lg border border-gray-200 bg-white p-3 text-sm leading-6 outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-500/10"
												placeholder={t('notePlaceholder')}
											/>
										</div>
									</div>
								</div>
							) : activeTab === 'pricing' ? (
								showPricingJson ? (
									<ModelPricingJsonPreview preview={pricingPreview} />
								) : (
									<ModelPricingPanel {...props} />
								)
							) : activeTab === 'routes' ? (
								<RelatedRoutesPanel
									key={editingModel?.id}
									state={routesState}
									perspective="model"
									disabled={busy}
								/>
							) : (
								<div className="flex min-h-80 flex-1 flex-col overflow-hidden rounded-xl border border-gray-200">
									<div className="flex items-center gap-2 border-b border-gray-200 bg-gray-50/70 px-4 py-3">
										<label
											htmlFor={`${id}-metadata`}
											className="text-sm font-semibold text-gray-800"
										>
											{t('metadataJson')}
										</label>
										<InfoHintPopover
											label={t('metadataTab')}
											openOnHover
											openOnFocus
											portal
											align="start"
										>
											<p className="leading-6">{t('metadataHint')}</p>
										</InfoHintPopover>
									</div>
									<textarea
										id={`${id}-metadata`}
										value={formData.metadata}
										onChange={(event) =>
											onFormChange({
												...formData,
												metadata: event.target.value,
											})
										}
										className="min-h-64 w-full flex-1 resize-none bg-gray-50/30 p-4 font-mono text-xs leading-6 text-gray-800 outline-none focus:ring-2 focus:ring-inset focus:ring-blue-200"
										placeholder={t('metadataPlaceholder')}
										spellCheck={false}
									/>
								</div>
							)}
						</section>
					</fieldset>
				</div>
				<footer className="flex shrink-0 flex-wrap items-center justify-between gap-3 border-t border-gray-200 bg-gray-50/80 px-5 py-4 sm:px-7">
					<div>
						{editingModel ? (
							deleteReason ? (
								<InfoHintPopover
									label={t('deleteModel')}
									disabledTrigger={deleteButton}
									openOnHover
									openOnFocus
									portal
									align="start"
								>
									<p className="leading-5">{deleteReason}</p>
								</InfoHintPopover>
							) : (
								deleteButton
							)
						) : null}
					</div>
					<div className="ml-auto flex gap-2">
						<button
							type="button"
							onClick={onClose}
							disabled={busy}
							className="rounded-md border border-gray-300 px-4 py-2 text-sm text-gray-700 hover:bg-gray-100 disabled:opacity-50"
						>
							{tCommon('cancel')}
						</button>
						{editingModel ? (
							<button
								type="button"
								onClick={onDuplicate}
								disabled={busy}
								className="inline-flex items-center gap-1.5 rounded-md border border-gray-300 px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-100 disabled:opacity-50"
							>
								<DocumentDuplicateIcon className="h-4 w-4" aria-hidden />
								{tCommon('duplicate')}
							</button>
						) : null}
						<button
							type="button"
							onClick={onSave}
							disabled={busy}
							className="rounded-md bg-blue-600 px-4 py-2 text-sm text-white hover:bg-blue-700 disabled:opacity-50"
						>
							{isSaving ? tCommon('savingDots') : tCommon('save')}
						</button>
					</div>
				</footer>
			</div>
		</div>
	);
}
