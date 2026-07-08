'use client';

import { DocumentDuplicateIcon, TrashIcon } from '@heroicons/react/24/outline';
import { useTranslations } from 'next-intl';
import type { GatewayProvider, ProviderFormData } from '../types';

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

				<div className="min-h-0 flex-1 overflow-y-auto p-6">
					{saveError && (
						<div className="mb-4 rounded-md border border-red-200 bg-red-50 p-3 text-sm text-red-600">{saveError}</div>
					)}

					<div className="space-y-6">
						<section className="rounded-lg border border-gray-200 bg-slate-50/70 p-4 space-y-3">
							<div>
								<h3 className="text-sm font-semibold text-gray-900">{t('general')}</h3>
								<p className="text-xs text-gray-500 mt-0.5">{t('generalHint')}</p>
							</div>
							<div className="space-y-3">
								{!editingProvider && (
									<div>
										<label className="block text-sm font-medium text-gray-700 mb-1">{t('id')}</label>
										<input
											type="text"
											value={formData.id}
											onChange={(e) => onFormChange({ ...formData, id: e.target.value })}
											className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500 font-mono bg-white"
											placeholder={t('idPlaceholder')}
											autoComplete="off"
										/>
										<p className="mt-1 text-xs text-gray-500">{t('idHint')}</p>
									</div>
								)}
								<div>
									<label className="block text-sm font-medium text-gray-700 mb-1">{t('nameRequired')}</label>
									<input
										type="text"
										value={formData.name}
										onChange={(e) => onFormChange({ ...formData, name: e.target.value })}
										className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500 bg-white"
										placeholder={t('namePlaceholder')}
										autoComplete="off"
										required
									/>
								</div>
							</div>
						</section>

						<section className="rounded-lg border border-gray-200 bg-slate-50/70 p-4 space-y-3">
							<div>
								<h3 className="text-sm font-semibold text-gray-900">{t('endpoints')}</h3>
								<p className="text-xs text-gray-500 mt-0.5">{t('endpointsHint')}</p>
							</div>
							<div className="space-y-3">
								<div>
									<label className="block text-sm font-medium text-gray-700 mb-1">
										{t('openaiOptional')}
									</label>
									<input
										type="url"
										value={formData.base_url_openai}
										onChange={(e) => onFormChange({ ...formData, base_url_openai: e.target.value })}
										className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500 bg-white"
										placeholder={t('openaiPlaceholder')}
										autoComplete="off"
									/>
								</div>
								<div>
									<label className="block text-sm font-medium text-gray-700 mb-1">
										{t('anthropicOptional')}
									</label>
									<input
										type="url"
										value={formData.base_url_anthropic}
										onChange={(e) => onFormChange({ ...formData, base_url_anthropic: e.target.value })}
										className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500 bg-white"
										placeholder={t('anthropicPlaceholder')}
										autoComplete="off"
									/>
								</div>
								<div>
									<label className="block text-sm font-medium text-gray-700 mb-1">
										{t('geminiOptional')}
									</label>
									<input
										type="url"
										value={formData.base_url_gemini}
										onChange={(e) => onFormChange({ ...formData, base_url_gemini: e.target.value })}
										className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500 bg-white"
										placeholder={t('geminiPlaceholder')}
										autoComplete="off"
									/>
									<p className="text-xs text-gray-500 mt-1">{t('geminiHint')}</p>
								</div>
							</div>
						</section>

						<section className="rounded-lg border border-gray-200 bg-slate-50/70 p-4 space-y-3">
							<div>
								<h3 id="provider-description-heading" className="text-sm font-semibold text-gray-900">
									{t('description')}
								</h3>
								<p className="text-xs text-gray-500 mt-0.5">{t('descriptionHint')}</p>
							</div>
							<div>
								<textarea
									rows={3}
									value={formData.description}
									onChange={(e) => onFormChange({ ...formData, description: e.target.value })}
									className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500 bg-white"
									placeholder={t('descriptionPlaceholder')}
									autoComplete="off"
									aria-labelledby="provider-description-heading"
								/>
							</div>
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
							className="rounded-md bg-blue-600 px-4 py-2 text-white hover:bg-blue-700 disabled:opacity-50"
						>
							{isSaving ? tCommon('saving') : tCommon('save')}
						</button>
					</div>
				</div>
			</div>
		</div>
	);
}
