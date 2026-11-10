'use client';

import { CheckIcon, ChevronDownIcon, LanguageIcon } from '@heroicons/react/24/outline';
import { useLocale, useTranslations } from 'next-intl';
import { useRouter } from 'next/navigation';
import { useEffect, useRef, useState, useTransition } from 'react';
import { locales, type Locale } from '@/lib/locale';

type Variant = 'header' | 'login';

const triggerClass: Record<Variant, string> = {
  header: 'inline-flex h-8 items-center gap-1.5 rounded-lg px-2 text-gray-500 transition-colors hover:bg-gray-100 hover:text-gray-950 disabled:cursor-not-allowed',
  login: 'inline-flex h-8 items-center gap-1.5 rounded-lg px-2 text-gray-500 transition-colors hover:bg-gray-100 hover:text-gray-950 disabled:cursor-not-allowed',
};
const codeClass: Record<Variant, string> = {
  header: 'font-mono text-xs text-gray-700',
  login: 'font-mono text-xs text-gray-700',
};
const chevronClass: Record<Variant, string> = { header: 'text-gray-500', login: 'text-gray-500' };
const menuClass: Record<Variant, string> = {
  header: 'absolute right-0 top-full z-50 mt-2 min-w-[10rem] overflow-hidden rounded-xl border border-gray-200 bg-white p-1 shadow-panel',
  login: 'absolute right-0 top-full z-50 mt-2 min-w-[10rem] overflow-hidden rounded-xl border border-gray-200 bg-white p-1 shadow-panel',
};
const optionClass: Record<Variant, string> = {
  header: 'flex min-h-9 w-full items-center justify-between gap-2 rounded-lg px-3 py-2 text-left text-sm text-gray-600 transition-colors hover:bg-gray-100 focus-visible:bg-gray-100',
  login: 'flex min-h-9 w-full items-center justify-between gap-2 rounded-lg px-3 py-2 text-left text-sm text-gray-600 transition-colors hover:bg-gray-100 focus-visible:bg-gray-100',
};
const selectedOptionClass: Record<Variant, string> = {
  header: 'bg-gray-100 font-medium text-gray-950',
  login: 'bg-gray-100 font-medium text-gray-950',
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
				<LanguageIcon className="h-4 w-4" aria-hidden />
				<span className={codeClass[variant]}>{variant === 'header' ? t(locale) : locale}</span>
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
