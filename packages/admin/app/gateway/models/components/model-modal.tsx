'use client';

import { TrashIcon } from '@heroicons/react/24/outline';
import { useTranslations } from 'next-intl';
import {
	isImageGenerationModel,
	MODEL_INPUT_MODALITIES,
	MODEL_OUTPUT_MODALITIES,
} from '@octafuse/core/db/model-modalities';
import { ModelModalitiesBadgeFromRaw } from '@/components/model-modalities-badge';
import { PricingTiersEditor } from '@/components/pricing-tiers-editor';
import { MODEL_VENDOR_OPTIONS } from '@/lib/model-vendor';
import type { PricingTierDraftRow } from '@/lib/pricing-tiers-draft';
import { tagBadgeClass } from '../model-utils';
import type { ModelFormData, ModelListItem } from '../types';

type Props = {
	open: boolean;
	editingModel: ModelListItem | null;
	formData: ModelFormData;
	pricingTierRows: PricingTierDraftRow[];
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
	onSave: () => void;
	onDelete: (id: string) => void;
};

export function ModelModal(props: Props) {
	const {
		open,
		editingModel,
		formData,
		pricingTierRows,
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
		onSave,
		onDelete,
	} = props;

	const t = useTranslations('models.modal');
	const tCommon = useTranslations('common');
	const isImageModel = isImageGenerationModel({
		output_modalities: formData.output_modalities,
	});

	if (!open) return null;

	return (
		<div
			className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4"
			onMouseDown={(e) => {
				if (e.target === e.currentTarget && !isSaving && !isDeleting) {
					onClose();
				}
			}}
		>
			<div className="bg-white rounded-lg shadow-xl max-w-3xl w-full max-h-[90vh] overflow-y-auto">
				<div className="px-6 py-4 border-b flex justify-between items-center sticky top-0 bg-white">
					<h2 className="text-xl font-bold text-gray-900">
						{editingModel ? t('editTitle') : t('newTitle')}
					</h2>
					<button
						type="button"
						onClick={onClose}
						className="text-gray-400 hover:text-gray-600 disabled:opacity-50"
						disabled={isSaving || isDeleting}
						aria-label={tCommon('close')}
					>
						x
					</button>
				</div>

				<div className="p-6">
					{saveError && (
						<div className="mb-4 p-3 bg-red-50 border border-red-200 rounded-md text-red-600 text-sm">
							{saveError}
						</div>
					)}

					<div className="grid grid-cols-2 gap-4">
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
						{!isImageModel ? (
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
							<div className="col-span-2 rounded-md border border-amber-100 bg-amber-50/70 px-3 py-2 text-xs text-amber-800">
								{t('imageNoTokenLimits')}
							</div>
						)}
						<div className="col-span-2 rounded-md border border-gray-200 bg-gray-50/80 px-3 py-2.5">
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
										/>
									</div>
								</div>
							</div>
						</div>
						<div className="col-span-2">
							{isImageModel ? (
								<PricingTiersEditor
									title={t('imageTokenPricing')}
									rows={pricingTierRows}
									onChange={onPricingTierRowsChange}
									billingCurrencyCode={billingCurrency}
									minRows={0}
									variant="image"
								/>
							) : (
								<PricingTiersEditor
									title={t('pricingProfile')}
									rows={pricingTierRows}
									onChange={onPricingTierRowsChange}
									billingCurrencyCode={billingCurrency}
									minRows={0}
								/>
							)}
						</div>
						<div className="col-span-2">
							<label className="block text-sm font-medium text-gray-700 mb-1">{t('tags')}</label>
							<div className="flex flex-wrap gap-2 mb-2">
								{formData.tags.map((tag) => (
									<span
										key={tag}
										className={`inline-flex items-center gap-1 px-2 py-1 rounded-full text-sm ${tagBadgeClass(tag)}`}
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
									className="flex-1 px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
									placeholder={t('tagsPlaceholder')}
								/>
								<button
									type="button"
									onClick={onAddTag}
									className="px-3 py-2 border border-gray-300 rounded-md text-sm font-medium text-gray-700 hover:bg-gray-50"
								>
									{tCommon('add')}
								</button>
							</div>
						</div>
						<div className="col-span-2">
							<label className="block text-sm font-medium text-gray-700 mb-1">{t('description')}</label>
							<textarea
								rows={3}
								value={formData.description}
								onChange={(e) => onFormChange({ ...formData, description: e.target.value })}
								className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
								placeholder={t('descriptionPlaceholder')}
							/>
						</div>
						<div className="col-span-2">
							<label className="block text-sm font-medium text-gray-700 mb-1">{t('metadataJson')}</label>
							<textarea
								rows={6}
								value={formData.metadata}
								onChange={(e) => onFormChange({ ...formData, metadata: e.target.value })}
								className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500 font-mono text-sm"
								placeholder={t('metadataPlaceholder')}
							/>
						</div>
					</div>
				</div>

				<div className="px-6 py-4 border-t flex flex-wrap items-center justify-between gap-3 sticky bottom-0 bg-gray-50">
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
