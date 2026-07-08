'use client';

import { PlusIcon } from '@heroicons/react/24/outline';
import { useTranslations } from 'next-intl';

type Props = {
	activeFilterSummary: string[];
	onCreate: () => void;
};

export function RouteWorkspaceHeader(props: Props) {
	const { activeFilterSummary, onCreate } = props;
	const t = useTranslations('routes.workspace');

	return (
		<div className="sticky top-0 z-10 flex flex-wrap items-center justify-between gap-3 border-b border-gray-200/80 bg-white/95 px-4 py-3 backdrop-blur-sm sm:px-6">
			<div className="min-w-0">
				<h2 className="text-base font-semibold text-gray-900">{t('title')}</h2>
				{activeFilterSummary.length > 0 ? (
					<p
						className="mt-0.5 truncate text-xs text-gray-500"
						title={activeFilterSummary.join(' · ')}
					>
						{t('filteredBy', { summary: activeFilterSummary.join(' · ') })}
					</p>
				) : (
					<p className="mt-0.5 text-xs text-gray-500">{t('allModelsRoutes')}</p>
				)}
			</div>
			<button
				type="button"
				onClick={onCreate}
				className="flex shrink-0 items-center gap-2 rounded-md bg-blue-600 px-4 py-2 text-white hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-blue-500"
			>
				<PlusIcon className="h-5 w-5" />
				{t('newRoute')}
			</button>
		</div>
	);
}
