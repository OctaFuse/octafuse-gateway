'use client';

import { GlobeAltIcon } from '@heroicons/react/24/outline';
import { useLocale, useTranslations } from 'next-intl';
import { useRouter } from 'next/navigation';
import { useTransition } from 'react';
import { locales, type Locale } from '@/lib/locale';

type Variant = 'sidebar' | 'login';

const rootClass = 'flex items-center gap-2';

const iconClass: Record<Variant, string> = {
	sidebar: 'shrink-0 text-gray-500',
	login: 'shrink-0 text-gray-400',
};

const segmentGroupClass: Record<Variant, string> = {
	sidebar:
		'flex flex-1 min-w-0 gap-0.5 rounded-lg border border-gray-700/80 bg-gray-800/60 p-1',
	login:
		'flex flex-1 min-w-0 gap-0.5 rounded-lg border border-gray-200 bg-gray-50 p-1',
};

const segmentBase: Record<Variant, string> = {
	sidebar:
		'flex-1 rounded-md px-2.5 py-1.5 text-xs font-medium transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 focus-visible:ring-offset-2 focus-visible:ring-offset-gray-900 disabled:cursor-not-allowed disabled:opacity-50',
	login:
		'flex-1 rounded-md px-2.5 py-1.5 text-xs font-medium transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50',
};

const segmentActive: Record<Variant, string> = {
	sidebar: 'bg-gray-700 text-white shadow-sm',
	login: 'bg-white text-gray-900 shadow-sm ring-1 ring-gray-200/80',
};

const segmentInactive: Record<Variant, string> = {
	sidebar: 'text-gray-400 hover:bg-gray-700/60 hover:text-gray-200',
	login: 'text-gray-500 hover:bg-white/90 hover:text-gray-800',
};

function localeButtonLabel(locale: Locale, t: (key: 'en' | 'zh') => string): string {
	return locale === 'en' ? 'EN' : t('zh');
}

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
		<div className={rootClass} role="group" aria-label={t('label')}>
			<GlobeAltIcon
				className={`h-4 w-4 ${iconClass[variant]}`}
				aria-hidden
			/>
			<div className={segmentGroupClass[variant]}>
				{locales.map((code) => {
					const isActive = code === locale;
					return (
						<button
							key={code}
							type="button"
							disabled={isPending}
							aria-pressed={isActive}
							aria-label={`${t('label')}: ${t(code)}`}
							onClick={() => onSelect(code)}
							className={`${segmentBase[variant]} ${isActive ? segmentActive[variant] : segmentInactive[variant]}`}
						>
							{localeButtonLabel(code, t)}
						</button>
					);
				})}
			</div>
		</div>
	);
}
