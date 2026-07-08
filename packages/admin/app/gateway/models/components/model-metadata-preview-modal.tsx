'use client';

import { useTranslations } from 'next-intl';
import type { MetadataPreviewState } from '../types';

type Props = {
	preview: MetadataPreviewState;
	onClose: () => void;
};

export function ModelMetadataPreviewModal(props: Props) {
	const { preview, onClose } = props;
	const t = useTranslations('models.metadata');
	const tCommon = useTranslations('common');
	const displayName = preview.model.display_name || preview.model.id;

	return (
		<div
			className="fixed inset-0 z-[55] flex items-center justify-center bg-black/50 p-4"
			onClick={onClose}
		>
			<div
				className="flex max-h-[90vh] w-full max-w-2xl flex-col overflow-hidden rounded-lg bg-white shadow-xl"
				role="dialog"
				aria-modal="true"
				aria-labelledby="metadata-preview-title"
				onClick={(e) => e.stopPropagation()}
			>
				<div className="flex shrink-0 items-start justify-between gap-4 border-b px-6 py-4">
					<div className="min-w-0">
						<h2 id="metadata-preview-title" className="text-lg font-bold text-gray-900">
							{t('title')}
						</h2>
						<p className="mt-1 truncate text-sm text-gray-700" title={displayName}>
							{displayName}
						</p>
						<p className="truncate font-mono text-xs text-gray-500" title={preview.model.id}>
							{preview.model.id}
						</p>
					</div>
					<button
						type="button"
						onClick={onClose}
						className="shrink-0 text-gray-400 hover:text-gray-600"
						aria-label={tCommon('close')}
					>
						×
					</button>
				</div>
				<div className="min-h-0 flex-1 overflow-y-auto px-6 py-4">
					<pre className="whitespace-pre-wrap break-words rounded-md border border-gray-200 bg-gray-50 p-4 font-mono text-xs leading-relaxed text-gray-800">
						{preview.summary.formatted}
					</pre>
				</div>
				<div className="flex shrink-0 justify-end border-t bg-gray-50 px-6 py-4">
					<button
						type="button"
						onClick={onClose}
						className="rounded-md border border-gray-300 px-4 py-2 text-sm text-gray-700 hover:bg-white"
					>
						{tCommon('close')}
					</button>
				</div>
			</div>
		</div>
	);
}
