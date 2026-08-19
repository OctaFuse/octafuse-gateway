'use client';

import { ArrowDownTrayIcon, PlusIcon } from '@heroicons/react/24/outline';
import { useTranslations } from 'next-intl';

type ModelAddCardProps = {
	importSubmitting: boolean;
	createTitle: string;
	onImport: () => void;
	onCreate: () => void;
};

export function ModelAddCard(props: ModelAddCardProps) {
	const { importSubmitting, createTitle, onImport, onCreate } = props;
	const t = useTranslations('models.addCard');
	const tCommon = useTranslations('common');

	return (
		<article className="flex h-full min-h-[8.5rem] flex-col justify-between rounded-xl border-2 border-dashed border-blue-200 bg-blue-50/50 p-4 shadow-sm">
			<div className="flex items-center gap-2.5">
				<span className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-blue-600 text-white">
					<PlusIcon className="h-5 w-5" aria-hidden />
				</span>
				<div className="min-w-0">
					<h2 className="truncate text-sm font-semibold text-blue-900">{t('title')}</h2>
					<p className="mt-0.5 truncate text-[11px] text-blue-800/70">{t('subtitle')}</p>
				</div>
			</div>
			<div className="mt-3 grid grid-cols-2 gap-2">
				<button
					type="button"
					onClick={onImport}
					disabled={importSubmitting}
					className="inline-flex items-center justify-center gap-1.5 rounded-lg border border-blue-200 bg-white px-2.5 py-2 text-xs font-medium text-blue-800 hover:bg-blue-50 focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 disabled:opacity-50"
				>
					<ArrowDownTrayIcon className="h-4 w-4 shrink-0" aria-hidden />
					{tCommon('import')}
				</button>
				<button
					type="button"
					onClick={onCreate}
					className="inline-flex items-center justify-center gap-1.5 rounded-lg bg-blue-600 px-2.5 py-2 text-xs font-medium text-white hover:bg-blue-700 focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-500"
					title={createTitle}
				>
					<PlusIcon className="h-4 w-4 shrink-0" aria-hidden />
					{tCommon('new')}
				</button>
			</div>
		</article>
	);
}
