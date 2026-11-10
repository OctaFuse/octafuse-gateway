'use client';

import { ArrowDownTrayIcon, PlusIcon } from '@heroicons/react/24/outline';
import { useTranslations } from 'next-intl';

type ModelAddCardProps = {
	compact?: boolean;
	importSubmitting: boolean;
	createTitle: string;
	onImport: () => void;
	onCreate: () => void;
};

export function ModelAddCard(props: ModelAddCardProps) {
	const { importSubmitting, createTitle, onImport, onCreate, compact = false } = props;
	const t = useTranslations('models.addCard');
	const tCommon = useTranslations('common');

	return (
		<article className={`flex rounded-xl border-gray-200 p-4 ${compact ? 'mb-3 flex-col gap-3 border bg-white sm:flex-row sm:items-center sm:justify-between' : 'h-full min-h-[8.5rem] flex-col justify-between border bg-white shadow-sm'}`}>
			<div className="flex items-center gap-2.5">
				<span className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-full admin-primary">
					<PlusIcon className="h-5 w-5" aria-hidden />
				</span>
				<div className="min-w-0">
					<h2 className="truncate text-sm font-medium text-gray-950">{t('title')}</h2>
					<p className="mt-0.5 truncate text-xs text-gray-900/70">{t('subtitle')}</p>
				</div>
			</div>
			<div className={`grid shrink-0 grid-cols-2 gap-2 ${compact ? 'sm:min-w-56' : 'mt-3'}`}>
				<button
					type="button"
					onClick={onImport}
					disabled={importSubmitting}
					className="inline-flex items-center justify-center gap-1.5 rounded-lg border border-gray-200 bg-white px-2.5 py-2 text-xs font-medium text-gray-900 hover:bg-gray-50 focus:outline-none focus-visible:ring-2 focus-visible:ring-gray-500 disabled:opacity-50"
				>
					<ArrowDownTrayIcon className="h-4 w-4 shrink-0" aria-hidden />
					{tCommon('import')}
				</button>
				<button
					type="button"
					onClick={onCreate}
					className="inline-flex items-center justify-center gap-1.5 rounded-lg admin-primary px-2.5 py-2 text-xs font-medium text-white hover:bg-gray-800 focus:outline-none focus-visible:ring-2 focus-visible:ring-gray-500"
					title={createTitle}
				>
					<PlusIcon className="h-4 w-4 shrink-0" aria-hidden />
					{tCommon('new')}
				</button>
			</div>
		</article>
	);
}
