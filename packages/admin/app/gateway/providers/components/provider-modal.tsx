'use client';

import { DocumentDuplicateIcon, TrashIcon } from '@heroicons/react/24/outline';
import { useTranslations } from 'next-intl';
import { useState } from 'react';
import { protocolFormHasOverrides } from '../provider-utils';
import type { GatewayProvider, ProtocolEndpointForm, ProviderFormData } from '../types';

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
	'w-full rounded-md border border-gray-300 bg-white px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500';

function ProtocolFields(props: {
	protocolLabel: string;
	basePlaceholder: string;
	baseHint?: string;
	form: ProtocolEndpointForm;
	protocol: 'openai' | 'anthropic' | 'gemini';
	advancedToggle: string;
	advancedHint: string;
	capLabels: {
		chat: string;
		imagesGenerations: string;
		imagesEdits: string;
		messages: string;
		generateContent: string;
		streamGenerateContent: string;
	};
	onChange: (next: ProtocolEndpointForm) => void;
}) {
	const {
		protocolLabel,
		basePlaceholder,
		baseHint,
		form,
		protocol,
		advancedToggle,
		advancedHint,
		capLabels,
		onChange,
	} = props;
	const [advancedOpen, setAdvancedOpen] = useState(() => protocolFormHasOverrides(protocol, form));

	return (
		<div className="space-y-2">
			<label className="block text-sm font-medium text-gray-800">{protocolLabel}</label>
			<input
				type="url"
				value={form.base}
				onChange={(e) => onChange({ ...form, base: e.target.value })}
				className={inputClass}
				placeholder={basePlaceholder}
				autoComplete="off"
			/>
			{baseHint ? <p className="text-xs text-gray-500">{baseHint}</p> : null}
			<button
				type="button"
				className="text-xs font-medium text-blue-600 hover:text-blue-800"
				onClick={() => setAdvancedOpen((v) => !v)}
			>
				{advancedOpen ? `▾ ${advancedToggle}` : `▸ ${advancedToggle}`}
			</button>
			{advancedOpen ? (
				<div className="space-y-2 border-l-2 border-gray-200 pl-3">
					<p className="text-xs text-gray-500">{advancedHint}</p>
					{protocol === 'openai' ? (
						<>
							<div>
								<label className="mb-1 block text-xs text-gray-600">{capLabels.chat}</label>
								<input
									type="url"
									value={form.chat}
									onChange={(e) => onChange({ ...form, chat: e.target.value })}
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
									onChange={(e) => onChange({ ...form, images_generations: e.target.value })}
									className={inputClass}
									autoComplete="off"
								/>
							</div>
							<div>
								<label className="mb-1 block text-xs text-gray-600">{capLabels.imagesEdits}</label>
								<input
									type="url"
									value={form.images_edits}
									onChange={(e) => onChange({ ...form, images_edits: e.target.value })}
									className={inputClass}
									autoComplete="off"
								/>
							</div>
						</>
					) : null}
					{protocol === 'anthropic' ? (
						<div>
							<label className="mb-1 block text-xs text-gray-600">{capLabels.messages}</label>
							<input
								type="url"
								value={form.messages}
								onChange={(e) => onChange({ ...form, messages: e.target.value })}
								className={inputClass}
								autoComplete="off"
							/>
						</div>
					) : null}
					{protocol === 'gemini' ? (
						<>
							<div>
								<label className="mb-1 block text-xs text-gray-600">
									{capLabels.generateContent}
								</label>
								<input
									type="url"
									value={form.generateContent}
									onChange={(e) => onChange({ ...form, generateContent: e.target.value })}
									className={inputClass}
									placeholder="https://…/models/{model}:generateContent"
									autoComplete="off"
								/>
							</div>
							<div>
								<label className="mb-1 block text-xs text-gray-600">
									{capLabels.streamGenerateContent}
								</label>
								<input
									type="url"
									value={form.streamGenerateContent}
									onChange={(e) => onChange({ ...form, streamGenerateContent: e.target.value })}
									className={inputClass}
									placeholder="https://…/models/{model}:streamGenerateContent"
									autoComplete="off"
								/>
							</div>
						</>
					) : null}
				</div>
			) : null}
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

	const t = useTranslations('providers.modal');
	const tCommon = useTranslations('common');

	if (!open) return null;

	const capLabels = {
		chat: t('capChat'),
		imagesGenerations: t('capImagesGenerations'),
		imagesEdits: t('capImagesEdits'),
		messages: t('capMessages'),
		generateContent: t('capGenerateContent'),
		streamGenerateContent: t('capStreamGenerateContent'),
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
				className={`flex max-h-[90vh] w-full flex-col overflow-hidden rounded-lg bg-white shadow-xl ${editingProvider ? 'max-w-3xl' : 'max-w-2xl'}`}
			>
				<div className="flex shrink-0 items-center justify-between border-b px-6 py-4">
					<div>
						<h2 className="text-xl font-bold text-gray-900">
							{editingProvider ? t('editTitle') : t('newTitle')}
						</h2>
						{!editingProvider && duplicateSourceId && (
							<p className="mt-1 text-xs text-gray-500">
								{t('prefilledFrom', { id: duplicateSourceId })}
							</p>
						)}
					</div>
					<button
						type="button"
						onClick={onClose}
						className="text-gray-400 hover:text-gray-600"
						disabled={isSaving || isDeleting}
						aria-label={tCommon('close')}
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
								<h3 className="text-sm font-semibold text-gray-900">{t('general')}</h3>
								<p className="mt-0.5 text-xs text-gray-500">{t('generalHint')}</p>
							</div>
							{!editingProvider && (
								<div>
									<label className="mb-1 block text-sm font-medium text-gray-700">{t('id')}</label>
									<input
										type="text"
										value={formData.id}
										onChange={(e) => onFormChange({ ...formData, id: e.target.value })}
										className={`${inputClass} font-mono`}
										placeholder={t('idPlaceholder')}
										autoComplete="off"
									/>
									<p className="mt-1 text-xs text-gray-500">{t('idHint')}</p>
								</div>
							)}
							<div>
								<label className="mb-1 block text-sm font-medium text-gray-700">
									{t('nameRequired')}
								</label>
								<input
									type="text"
									value={formData.name}
									onChange={(e) => onFormChange({ ...formData, name: e.target.value })}
									className={inputClass}
									placeholder={t('namePlaceholder')}
									autoComplete="off"
									required
								/>
							</div>
						</section>

						<section className="space-y-5 border-t border-gray-100 pt-6">
							<div>
								<h3 className="text-sm font-semibold text-gray-900">{t('endpoints')}</h3>
								<p className="mt-0.5 text-xs text-gray-500">{t('endpointsHint')}</p>
							</div>
							<ProtocolFields
								protocolLabel={t('openaiOptional')}
								basePlaceholder={t('openaiPlaceholder')}
								form={formData.openai}
								protocol="openai"
								advancedToggle={t('advancedToggle')}
								advancedHint={t('advancedHint')}
								capLabels={capLabels}
								onChange={(openai) => onFormChange({ ...formData, openai })}
							/>
							<ProtocolFields
								protocolLabel={t('anthropicOptional')}
								basePlaceholder={t('anthropicPlaceholder')}
								form={formData.anthropic}
								protocol="anthropic"
								advancedToggle={t('advancedToggle')}
								advancedHint={t('advancedHint')}
								capLabels={capLabels}
								onChange={(anthropic) => onFormChange({ ...formData, anthropic })}
							/>
							<ProtocolFields
								protocolLabel={t('geminiOptional')}
								basePlaceholder={t('geminiPlaceholder')}
								baseHint={t('geminiHint')}
								form={formData.gemini}
								protocol="gemini"
								advancedToggle={t('advancedToggle')}
								advancedHint={t('advancedHint')}
								capLabels={capLabels}
								onChange={(gemini) => onFormChange({ ...formData, gemini })}
							/>
						</section>

						<section className="space-y-3 border-t border-gray-100 pt-6">
							<div>
								<h3 id="provider-description-heading" className="text-sm font-semibold text-gray-900">
									{t('description')}
								</h3>
								<p className="mt-0.5 text-xs text-gray-500">{t('descriptionHint')}</p>
							</div>
							<textarea
								rows={3}
								value={formData.description}
								onChange={(e) => onFormChange({ ...formData, description: e.target.value })}
								className={inputClass}
								placeholder={t('descriptionPlaceholder')}
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
								{isDeleting ? tCommon('deleting') : t('deleteProvider')}
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
							{tCommon('cancel')}
						</button>
						{editingProvider && (
							<button
								type="button"
								onClick={() => onDuplicate(editingProvider)}
								disabled={isSaving || isDeleting}
								className="inline-flex items-center gap-1.5 rounded-md border border-gray-300 bg-white px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50 disabled:cursor-not-allowed disabled:opacity-50"
							>
								<DocumentDuplicateIcon className="h-4 w-4" aria-hidden />
								{tCommon('duplicate')}
							</button>
						)}
						<button
							type="button"
							onClick={() => void onSave()}
							disabled={isSaving || isDeleting}
							className="rounded-md bg-blue-600 px-4 py-2 text-white hover:bg-blue-700 disabled:cursor-not-allowed disabled:opacity-50"
						>
							{isSaving ? tCommon('saving') : editingProvider ? tCommon('save') : tCommon('create')}
						</button>
					</div>
				</div>
			</div>
		</div>
	);
}
