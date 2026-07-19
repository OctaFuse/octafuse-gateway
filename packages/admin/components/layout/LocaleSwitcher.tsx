'use client';

import { GlobeAltIcon } from '@heroicons/react/24/outline';
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

const segmentBase: Record<Variant, string> = {
	sidebar:
		'relative flex-1 rounded-lg px-2 py-1.5 text-xs font-medium tracking-wide transition-all duration-150 ease-out focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 focus-visible:ring-offset-2 focus-visible:ring-offset-gray-900 disabled:cursor-not-allowed',
	login:
		'relative flex-1 rounded-lg px-2 py-1.5 text-xs font-medium tracking-wide transition-all duration-150 ease-out focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 focus-visible:ring-offset-2 disabled:cursor-not-allowed',
};

const segmentActive: Record<Variant, string> = {
	sidebar:
		'bg-gray-700 text-white shadow-sm shadow-black/30 ring-1 ring-white/10',
	login:
		'bg-white text-gray-900 shadow-sm ring-1 ring-gray-200/90',
};

const segmentInactive: Record<Variant, string> = {
	sidebar: 'text-gray-500 hover:bg-gray-800/70 hover:text-gray-200',
	login: 'text-gray-500 hover:bg-white/70 hover:text-gray-800',
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
			role="group"
			aria-label={t('label')}
			aria-busy={isPending}
		>
			<span className={iconWrapClass[variant]} aria-hidden>
				<GlobeAltIcon className="h-3.5 w-3.5" />
			</span>
			<div className="flex min-w-0 flex-1 gap-0.5">
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
							className={`${segmentBase[variant]} ${isActive ? segmentActive[variant] : segmentInactive[variant]} ${isPending ? 'opacity-60' : ''}`}
						>
							<span className="relative z-10 block truncate text-center">
								{t(code)}
							</span>
						</button>
					);
				})}
			</div>
		</div>
	);
}
