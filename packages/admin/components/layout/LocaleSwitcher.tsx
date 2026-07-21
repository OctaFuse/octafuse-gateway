'use client';

import { ChevronUpDownIcon, GlobeAltIcon } from '@heroicons/react/24/outline';
import { useLocale, useTranslations } from 'next-intl';
import { useRouter } from 'next/navigation';
import { useTransition } from 'react';
import { locales, type Locale } from '@/lib/locale';

type Variant = 'sidebar' | 'login';

const shellClass: Record<Variant, string> = {
	sidebar:
		'flex w-full items-center gap-2 rounded-xl border border-gray-700/70 bg-gray-950/50 p-1 shadow-inner shadow-black/20',
	login:
		'flex w-full items-center gap-2 rounded-xl border border-gray-200 bg-gray-50 p-1',
};

const iconWrapClass: Record<Variant, string> = {
	sidebar:
		'flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-gray-800/80 text-gray-400',
	login:
		'flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-white text-gray-500 shadow-sm ring-1 ring-gray-200/80',
};

const selectClass: Record<Variant, string> = {
	sidebar:
		'h-8 w-full cursor-pointer appearance-none rounded-lg bg-transparent py-1 pl-2 pr-8 text-sm font-medium text-gray-200 outline-none transition-colors hover:bg-gray-800/70 focus-visible:ring-2 focus-visible:ring-blue-500 focus-visible:ring-offset-2 focus-visible:ring-offset-gray-900 disabled:cursor-not-allowed',
	login:
		'h-8 w-full cursor-pointer appearance-none rounded-lg bg-transparent py-1 pl-2 pr-8 text-sm font-medium text-gray-800 outline-none transition-colors hover:bg-white focus-visible:ring-2 focus-visible:ring-blue-500 focus-visible:ring-offset-2 disabled:cursor-not-allowed',
};

const chevronClass: Record<Variant, string> = {
	sidebar: 'text-gray-500',
	login: 'text-gray-400',
};

export default function LocaleSwitcher({ variant }: { variant: Variant }) {
	const t = useTranslations('locale');
	const locale = useLocale() as Locale;
	const router = useRouter();
	const [isPending, startTransition] = useTransition();

	const onSelect = (next: Locale) => {
		if (next === locale || isPending) return;
		startTransition(async () => {
			await fetch('/api/locale', {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ locale: next }),
			});
			router.refresh();
		});
	};

	return (
		<div
			className={`${shellClass[variant]} ${isPending ? 'opacity-70' : ''}`}
			aria-busy={isPending}
		>
			<span className={iconWrapClass[variant]} aria-hidden>
				<GlobeAltIcon className="h-3.5 w-3.5" />
			</span>
			<div className="relative min-w-0 flex-1">
				<select
					value={locale}
					disabled={isPending}
					aria-label={t('label')}
					onChange={(event) => onSelect(event.target.value as Locale)}
					className={`${selectClass[variant]} ${isPending ? 'opacity-60' : ''}`}
				>
					{locales.map((code) => (
						<option key={code} value={code}>
							{t(code)}
						</option>
					))}
				</select>
				<ChevronUpDownIcon
					className={`pointer-events-none absolute right-2.5 top-1/2 h-4 w-4 -translate-y-1/2 ${chevronClass[variant]}`}
					aria-hidden
				/>
			</div>
		</div>
	);
}
