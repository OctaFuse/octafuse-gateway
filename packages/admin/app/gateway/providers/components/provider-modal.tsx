import { DocumentDuplicateIcon, TrashIcon } from '@heroicons/react/24/outline';
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
							{editingProvider ? 'Edit Provider' : 'New Provider'}
						</h2>
						{!editingProvider && duplicateSourceId && (
							<p className="mt-1 text-xs text-gray-500">
								Pre-filled from{' '}
								<code className="rounded border border-gray-200 bg-gray-50 px-1 py-0.5 font-mono text-[11px]">
									{duplicateSourceId}
								</code>
								. Set a new ID and review fields before saving.
							</p>
						)}
					</div>
					<button
						type="button"
						onClick={onClose}
						className="text-gray-400 hover:text-gray-600"
						disabled={isSaving || isDeleting}
						aria-label="Close"
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
								<h3 className="text-sm font-semibold text-gray-900">General</h3>
								<p className="text-xs text-gray-500 mt-0.5">
									Display name and optional custom ID (new providers only).
								</p>
							</div>
							<div className="space-y-3">
								{!editingProvider && (
									<div>
										<label className="block text-sm font-medium text-gray-700 mb-1">ID</label>
										<input
											type="text"
											value={formData.id}
											onChange={(e) => onFormChange({ ...formData, id: e.target.value })}
											className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500 font-mono bg-white"
											placeholder="Optional: custom ID (auto-generated if empty)"
											autoComplete="off"
										/>
										<p className="mt-1 text-xs text-gray-500">Leave empty to auto-generate a UUID</p>
									</div>
								)}
								<div>
									<label className="block text-sm font-medium text-gray-700 mb-1">Name *</label>
									<input
										type="text"
										value={formData.name}
										onChange={(e) => onFormChange({ ...formData, name: e.target.value })}
										className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500 bg-white"
										placeholder="e.g., OpenAI"
										autoComplete="off"
										required
									/>
								</div>
							</div>
						</section>

						<section className="rounded-lg border border-gray-200 bg-slate-50/70 p-4 space-y-3">
							<div>
								<h3 className="text-sm font-semibold text-gray-900">Endpoints</h3>
								<p className="text-xs text-gray-500 mt-0.5">
									Base URLs per upstream protocol. Model routes choose which protocol to use; the gateway calls
									OpenAI-compatible{' '}
									<code className="text-[11px] bg-white px-1 py-0.5 rounded border border-gray-200">
										/chat/completions
									</code>{' '}
									against the matching base.
								</p>
							</div>
							<div className="space-y-3">
								<div>
									<label className="block text-sm font-medium text-gray-700 mb-1">
										OpenAI <span className="ml-1 text-xs font-normal text-gray-400">(optional)</span>
									</label>
									<input
										type="url"
										value={formData.base_url_openai}
										onChange={(e) => onFormChange({ ...formData, base_url_openai: e.target.value })}
										className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500 bg-white"
										placeholder="https://api.openai.com/v1"
										autoComplete="off"
									/>
								</div>
								<div>
									<label className="block text-sm font-medium text-gray-700 mb-1">
										Anthropic <span className="ml-1 text-xs font-normal text-gray-400">(optional)</span>
									</label>
									<input
										type="url"
										value={formData.base_url_anthropic}
										onChange={(e) => onFormChange({ ...formData, base_url_anthropic: e.target.value })}
										className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500 bg-white"
										placeholder="https://api.anthropic.com"
										autoComplete="off"
									/>
								</div>
								<div>
									<label className="block text-sm font-medium text-gray-700 mb-1">
										Gemini <span className="ml-1 text-xs font-normal text-gray-400">(optional)</span>
									</label>
									<input
										type="url"
										value={formData.base_url_gemini}
										onChange={(e) => onFormChange({ ...formData, base_url_gemini: e.target.value })}
										className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500 bg-white"
										placeholder="https://generativelanguage.googleapis.com/v1beta/models"
										autoComplete="off"
									/>
									<p className="text-xs text-gray-500 mt-1">
										Include the full prefix before <code className="text-gray-600">{'{model}'}</code>
										<br />
										Developer: <code className="text-gray-600">/v1beta/models</code>; Vertex{'\u00A0'}Express:{' '}
										<code className="text-gray-600">/v1/publishers/google/models</code>.
									</p>
								</div>
							</div>
						</section>

						<section className="rounded-lg border border-gray-200 bg-slate-50/70 p-4 space-y-3">
							<div>
								<h3 id="provider-description-heading" className="text-sm font-semibold text-gray-900">
									Description
								</h3>
								<p className="text-xs text-gray-500 mt-0.5">Internal reference only; not sent to upstream.</p>
							</div>
							<div>
								<textarea
									rows={3}
									value={formData.description}
									onChange={(e) => onFormChange({ ...formData, description: e.target.value })}
									className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500 bg-white"
									placeholder="Optional internal description"
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
								{isDeleting ? 'Deleting…' : 'Delete provider'}
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
							Cancel
						</button>
						{editingProvider && (
							<button
								type="button"
								onClick={() => onDuplicate(editingProvider)}
								disabled={isSaving || isDeleting}
								className="inline-flex items-center gap-1.5 rounded-md border border-gray-300 bg-white px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50 disabled:cursor-not-allowed disabled:opacity-50"
							>
								<DocumentDuplicateIcon className="h-4 w-4" aria-hidden />
								Duplicate
							</button>
						)}
						<button
							type="button"
							onClick={() => void onSave()}
							disabled={isSaving || isDeleting}
							className="rounded-md bg-blue-600 px-4 py-2 text-white hover:bg-blue-700 disabled:opacity-50"
						>
							{isSaving ? 'Saving…' : 'Save'}
						</button>
					</div>
				</div>
			</div>
		</div>
	);
}
