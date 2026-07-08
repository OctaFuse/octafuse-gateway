'use client';

import { TrashIcon } from '@heroicons/react/24/outline';
import { useTranslations } from 'next-intl';
import type { EditingProviderKeyState, GatewayProvider, ProviderKeyFormData } from '../types';

type ProviderKeyModalProps = {
	editingProviderKey: EditingProviderKeyState | null;
	addingProviderKeyFor: GatewayProvider | null;
	form: ProviderKeyFormData;
	error: string;
	isSaving: boolean;
	isDeleting: boolean;
	onClose: () => void;
	onFormChange: (form: ProviderKeyFormData) => void;
	onSave: () => void;
	onDelete: () => void;
};

export function ProviderKeyModal(props: ProviderKeyModalProps) {
	const {
		editingProviderKey,
		addingProviderKeyFor,
		form,
		error,
		isSaving,
		isDeleting,
		onClose,
		onFormChange,
		onSave,
		onDelete,
	} = props;

	const t = useTranslations('providers.keys');
	const tCommon = useTranslations('common');

	if (!editingProviderKey && !addingProviderKeyFor) return null;

	return (
		<div
			className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4"
			onMouseDown={(e) => {
				if (e.target === e.currentTarget && !isSaving && !isDeleting) {
					onClose();
				}
			}}
		>
			<div className="flex max-h-[90vh] w-full max-w-xl flex-col overflow-hidden rounded-lg bg-white shadow-xl">
				<div className="flex shrink-0 items-center justify-between border-b px-6 py-4">
					<div className="min-w-0">
						<h2 className="text-xl font-bold text-gray-900">
							{editingProviderKey ? t('editTitle') : t('newTitle')}
						</h2>
						{editingProviderKey ? (
							<p
								className="mt-1 truncate font-mono text-xs text-gray-500"
								title={editingProviderKey.key.masked_api_key}
							>
								{editingProviderKey.key.masked_api_key}
							</p>
						) : (
							<p className="mt-1 truncate text-xs text-gray-500" title={addingProviderKeyFor?.id}>
								{addingProviderKeyFor?.name} · <span className="font-mono">{addingProviderKeyFor?.id}</span>
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
					{error && (
						<div className="mb-4 rounded-md border border-red-200 bg-red-50 p-3 text-sm text-red-600">{error}</div>
					)}
					<div className="space-y-4">
						<div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
							<div>
								<label className="mb-1 block text-sm font-medium text-gray-700">{t('label')}</label>
								<input
									type="text"
									value={form.label}
									onChange={(e) => onFormChange({ ...form, label: e.target.value })}
									className="w-full rounded-md border border-gray-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
									autoComplete="off"
								/>
							</div>
							<div className="flex items-end">
								<label className="inline-flex items-center gap-2 rounded-md border border-gray-200 bg-gray-50 px-3 py-2 text-sm text-gray-700">
									<input
										type="checkbox"
										checked={form.status === 'active'}
										onChange={(e) =>
											onFormChange({ ...form, status: e.target.checked ? 'active' : 'disabled' })
										}
										className="h-4 w-4 rounded border-gray-300 text-green-600 focus:ring-2 focus:ring-blue-500 focus:ring-offset-1"
									/>
									{tCommon('active')}
								</label>
							</div>
						</div>

						<div>
							<label className="mb-1 block text-sm font-medium text-gray-700">
								{editingProviderKey ? t('replaceApiKey') : t('apiKey')}
							</label>
							<input
								type="password"
								value={form.api_key}
								onChange={(e) => onFormChange({ ...form, api_key: e.target.value })}
								className="w-full rounded-md border border-gray-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
								placeholder={editingProviderKey ? t('leaveBlank') : t('apiKeyPlaceholder')}
								autoComplete="new-password"
							/>
						</div>

						<div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
							<div>
								<label className="mb-1 block text-sm font-medium text-gray-700">{t('priority')}</label>
								<input
									type="number"
									value={form.priority}
									onChange={(e) => onFormChange({ ...form, priority: e.target.value })}
									className="w-full rounded-md border border-gray-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
								/>
							</div>
							<div>
								<label className="mb-1 block text-sm font-medium text-gray-700">{t('weight')}</label>
								<input
									type="number"
									min={1}
									value={form.weight}
									onChange={(e) => onFormChange({ ...form, weight: e.target.value })}
									className="w-full rounded-md border border-gray-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
								/>
							</div>
						</div>

						<div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
							<div>
								<label className="mb-1 block text-sm font-medium text-gray-700">{t('rpmLimit')}</label>
								<input
									type="number"
									min={1}
									value={form.rpm}
									onChange={(e) => onFormChange({ ...form, rpm: e.target.value })}
									className="w-full rounded-md border border-gray-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
									placeholder={t('unlimited')}
								/>
							</div>
							<div>
								<label className="mb-1 block text-sm font-medium text-gray-700">{t('tpmLimit')}</label>
								<input
									type="number"
									min={1}
									value={form.tpm}
									onChange={(e) => onFormChange({ ...form, tpm: e.target.value })}
									className="w-full rounded-md border border-gray-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
									placeholder={t('unlimited')}
								/>
							</div>
							<div>
								<label className="mb-1 block text-sm font-medium text-gray-700">{t('concurrency')}</label>
								<input
									type="number"
									min={1}
									value={form.max_concurrency}
									onChange={(e) => onFormChange({ ...form, max_concurrency: e.target.value })}
									className="w-full rounded-md border border-gray-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
									placeholder={t('unlimited')}
								/>
							</div>
						</div>
					</div>
				</div>
				<div className="flex shrink-0 flex-wrap items-center justify-between gap-3 border-t bg-gray-50 px-6 py-4">
					{editingProviderKey ? (
						<button
							type="button"
							onClick={() => void onDelete()}
							className="inline-flex items-center gap-1.5 rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm font-medium text-red-700 hover:bg-red-100 disabled:cursor-not-allowed disabled:opacity-50"
							disabled={isSaving || isDeleting}
						>
							<TrashIcon className="h-4 w-4" aria-hidden />
							{isDeleting ? tCommon('deleting') : t('deleteKey')}
						</button>
					) : (
						<span />
					)}
					<div className="ml-auto flex gap-3">
						<button
							type="button"
							onClick={onClose}
							className="rounded-md border border-gray-300 px-4 py-2 text-gray-700 hover:bg-white disabled:opacity-50"
							disabled={isSaving || isDeleting}
						>
							{tCommon('cancel')}
						</button>
						<button
							type="button"
							onClick={() => void onSave()}
							disabled={isSaving || isDeleting}
							className="rounded-md bg-blue-600 px-4 py-2 text-white hover:bg-blue-700 disabled:opacity-50"
						>
							{isSaving ? tCommon('saving') : editingProviderKey ? t('saveKey') : t('createKey')}
						</button>
					</div>
				</div>
			</div>
		</div>
	);
}
