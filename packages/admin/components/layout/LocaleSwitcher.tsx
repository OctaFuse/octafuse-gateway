'use client';

import { CheckIcon, ChevronDownIcon } from '@heroicons/react/24/outline';
import { useLocale, useTranslations } from 'next-intl';
import { useRouter } from 'next/navigation';
import { useEffect, useRef, useState, useTransition } from 'react';
import { locales, type Locale } from '@/lib/locale';

type Variant = 'header' | 'login';

const LOCALE_FLAG: Record<Locale, string> = {
	en: '🇺🇸',
	zh: '🇨🇳',
	ja: '🇯🇵',
	ko: '🇰🇷',
};

const triggerClass: Record<Variant, string> = {
	header:
		'inline-flex items-center gap-1.5 rounded-md px-1.5 py-1 text-gray-300 outline-none transition-colors hover:bg-gray-800 hover:text-white focus-visible:ring-2 focus-visible:ring-blue-500 focus-visible:ring-offset-2 focus-visible:ring-offset-gray-950 disabled:cursor-not-allowed',
	login:
		'inline-flex items-center gap-1.5 rounded-md px-1.5 py-1 text-gray-500 outline-none transition-colors hover:bg-gray-100 hover:text-gray-900 focus-visible:ring-2 focus-visible:ring-blue-500 focus-visible:ring-offset-2 disabled:cursor-not-allowed',
};

const codeClass: Record<Variant, string> = {
	header: 'text-xs font-semibold uppercase tracking-wide text-white',
	login: 'text-xs font-semibold uppercase tracking-wide text-gray-800',
};

const chevronClass: Record<Variant, string> = {
	header: 'text-gray-500',
	login: 'text-gray-400',
};

const menuClass: Record<Variant, string> = {
	header:
		'absolute right-0 top-full z-50 mt-1.5 min-w-[9.5rem] overflow-hidden rounded-lg border border-gray-700 bg-gray-900 p-1 shadow-xl shadow-black/30 ring-1 ring-black/20',
	login:
		'absolute right-0 top-full z-50 mt-1.5 min-w-[9.5rem] overflow-hidden rounded-lg border border-gray-200 bg-white p-1 shadow-xl ring-1 ring-black/5',
};

const optionClass: Record<Variant, string> = {
	header:
		'flex w-full items-center justify-between gap-2 rounded-md px-2.5 py-2 text-left text-sm text-gray-300 outline-none transition hover:bg-gray-800 hover:text-white focus-visible:bg-gray-800 focus-visible:text-white',
	login:
		'flex w-full items-center justify-between gap-2 rounded-md px-2.5 py-2 text-left text-sm text-gray-700 outline-none transition hover:bg-gray-100 hover:text-gray-900 focus-visible:bg-gray-100 focus-visible:text-gray-900',
};

const selectedOptionClass: Record<Variant, string> = {
	header: 'bg-blue-500/15 font-semibold text-blue-200',
	login: 'bg-blue-50 font-semibold text-blue-700',
};

export default function LocaleSwitcher({ variant }: { variant: Variant }) {
	const t = useTranslations('locale');
	const locale = useLocale() as Locale;
	const router = useRouter();
	const [isPending, startTransition] = useTransition();
	const [open, setOpen] = useState(false);
	const rootRef = useRef<HTMLDivElement>(null);
	const triggerRef = useRef<HTMLButtonElement>(null);
	const optionRefs = useRef<Array<HTMLButtonElement | null>>([]);

	useEffect(() => {
		if (!open) return;

		const selectedIndex = locales.indexOf(locale);
		optionRefs.current[selectedIndex]?.focus();

		const closeOnOutsidePointer = (event: PointerEvent) => {
			if (!rootRef.current?.contains(event.target as Node)) setOpen(false);
		};
		document.addEventListener('pointerdown', closeOnOutsidePointer);
		return () => document.removeEventListener('pointerdown', closeOnOutsidePointer);
	}, [locale, open]);

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

	const chooseLocale = (next: Locale) => {
		setOpen(false);
		triggerRef.current?.focus();
		onSelect(next);
	};

	const focusOption = (index: number) => {
		const normalizedIndex = (index + locales.length) % locales.length;
		optionRefs.current[normalizedIndex]?.focus();
	};

	return (
		<div
			ref={rootRef}
			className={`relative shrink-0 ${isPending ? 'opacity-70' : ''}`}
			aria-busy={isPending}
		>
			<button
				ref={triggerRef}
				type="button"
				disabled={isPending}
				aria-label={t('label')}
				aria-haspopup="listbox"
				aria-expanded={open}
				onClick={() => setOpen((current) => !current)}
				onKeyDown={(event) => {
					if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
						event.preventDefault();
						setOpen(true);
					}
					if (event.key === 'Escape') setOpen(false);
				}}
				className={triggerClass[variant]}
			>
				<span className="text-sm leading-none" aria-hidden>
					{LOCALE_FLAG[locale]}
				</span>
				<span className={codeClass[variant]}>{locale}</span>
				<ChevronDownIcon
					className={`h-3.5 w-3.5 transition-transform ${open ? 'rotate-180' : ''} ${chevronClass[variant]}`}
					aria-hidden
				/>
			</button>
			{open ? (
				<div role="listbox" aria-label={t('label')} className={menuClass[variant]}>
					{locales.map((code, index) => {
						const selected = code === locale;
						return (
							<button
								key={code}
								ref={(element) => {
									optionRefs.current[index] = element;
								}}
								type="button"
								role="option"
								aria-selected={selected}
								onClick={() => chooseLocale(code)}
								onKeyDown={(event) => {
									if (event.key === 'ArrowDown') {
										event.preventDefault();
										focusOption(index + 1);
									} else if (event.key === 'ArrowUp') {
										event.preventDefault();
										focusOption(index - 1);
									} else if (event.key === 'Home') {
										event.preventDefault();
										focusOption(0);
									} else if (event.key === 'End') {
										event.preventDefault();
										focusOption(locales.length - 1);
									} else if (event.key === 'Escape') {
										event.preventDefault();
										setOpen(false);
										triggerRef.current?.focus();
									}
								}}
								className={`${optionClass[variant]} ${selected ? selectedOptionClass[variant] : ''}`}
							>
								<span className="inline-flex items-center gap-2">
									<span className="text-sm leading-none" aria-hidden>
										{LOCALE_FLAG[code]}
									</span>
									<span>{t(code)}</span>
								</span>
								{selected ? <CheckIcon className="h-4 w-4 shrink-0" aria-hidden /> : null}
							</button>
						);
					})}
				</div>
			) : null}
		</div>
	);
}
