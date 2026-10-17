'use client';

import { ListBulletIcon, Squares2X2Icon } from '@heroicons/react/24/outline';
import { useTranslations } from 'next-intl';

export type CatalogView = 'cards' | 'list';

type CatalogViewToggleProps = {
	value: CatalogView;
	onChange: (view: CatalogView) => void;
};

export function CatalogViewToggle({ value, onChange }: CatalogViewToggleProps) {
	const t = useTranslations('catalogView');

	return (
		<div className="flex shrink-0 items-center gap-2.5" role="group" aria-label={t('label')}>
			<span className="hidden text-xs text-slate-500 sm:block">{t('label')}</span>
			<div className="inline-flex rounded-lg border border-slate-200 bg-slate-50 p-0.5">
				{([
					['cards', Squares2X2Icon],
					['list', ListBulletIcon],
				] as const).map(([view, Icon]) => (
					<button
						key={view}
						type="button"
						aria-pressed={value === view}
						aria-label={t(view)}
						title={t(view)}
						onClick={() => onChange(view)}
						className={`inline-flex h-8 w-9 items-center justify-center rounded-md transition-colors focus-visible:z-10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 ${value === view ? 'bg-white text-blue-700 shadow-sm ring-1 ring-slate-200' : 'text-slate-400 hover:bg-white hover:text-slate-700'}`}
					>
						<Icon className="h-4 w-4" aria-hidden />
					</button>
				))}
			</div>
		</div>
	);
}
