'use client';

import { ArrowDownTrayIcon, PlusIcon } from '@heroicons/react/24/outline';
import { useTranslations } from 'next-intl';

type ProviderAddCardProps = {
	compact?: boolean;
	onImport: () => void;
	onCreate: () => void;
};

export function ProviderAddCard(props: ProviderAddCardProps) {
	const { onImport, onCreate, compact = false } = props;
	const t = useTranslations('providers.addCard');
	const tCommon = useTranslations('common');

	return (
		<article className={`flex rounded-xl border border-gray-200 bg-white p-4 transition-colors hover:border-gray-300 hover:bg-gray-50/70 ${compact ? 'mb-3 flex-col gap-3 sm:flex-row sm:items-center sm:justify-between' : 'h-full min-h-[12rem] flex-col justify-between'}`}>
			<div className="flex items-center gap-2.5">
				<span className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-gray-100 text-gray-800">
					<PlusIcon className="h-5 w-5" aria-hidden />
				</span>
				<div className="min-w-0">
					<h2 className="text-sm font-medium text-gray-950">{t('title')}</h2>
					<p className="mt-1 text-xs leading-5 text-gray-900/70">{t('subtitle')}</p>
				</div>
			</div>
			<div className={`grid shrink-0 grid-cols-2 gap-2 ${compact ? 'sm:min-w-56' : 'mt-3'}`}>
				<button
					type="button"
					onClick={onImport}
					className="inline-flex items-center justify-center gap-1.5 rounded-lg border border-gray-200 bg-white px-2.5 py-2 text-xs font-medium text-gray-900 hover:bg-gray-50 focus:outline-none focus-visible:ring-2 focus-visible:ring-gray-500"
				>
					<ArrowDownTrayIcon className="h-4 w-4 shrink-0" aria-hidden />
					{tCommon('import')}
				</button>
				<button
					type="button"
					onClick={onCreate}
					className="inline-flex items-center justify-center gap-1.5 rounded-lg admin-primary px-2.5 py-2 text-xs font-medium text-white hover:bg-gray-800 focus:outline-none focus-visible:ring-2 focus-visible:ring-gray-500"
				>
					<PlusIcon className="h-4 w-4 shrink-0" aria-hidden />
					{tCommon('new')}
				</button>
			</div>
		</article>
	);
}
