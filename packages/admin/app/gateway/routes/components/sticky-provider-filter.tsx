'use client';

import { CheckIcon, ChevronDownIcon, Squares2X2Icon } from '@heroicons/react/24/outline';
import { useTranslations } from 'next-intl';
import { useEffect, useId, useRef, useState, type KeyboardEvent, type CSSProperties } from 'react';
import { createPortal } from 'react-dom';
import type { ProviderStickyIdentity } from '../types';
import { StickyProviderIdentity } from './sticky-provider-identity';

type Target = { id: string; providerName: string; identity?: ProviderStickyIdentity };

export function StickyProviderFilter({
	targets,
	value,
	onChange,
	disabled,
}: {
	targets: Target[];
	value: string;
	onChange: (id: string) => void;
	disabled?: boolean;
}) {
	const t = useTranslations('routes.providerSticky');
	const options: Target[] = [{ id: '', providerName: t('usersAllProviders') }, ...targets];
	const selectedIndex = Math.max(
		0,
		options.findIndex((option) => option.id === value)
	);
	const selected = options[selectedIndex];
	const [open, setOpen] = useState(false);
	const [activeIndex, setActiveIndex] = useState(selectedIndex);
	const [position, setPosition] = useState<CSSProperties>({
		left: 0,
		top: 0,
		width: 0,
		maxHeight: 0,
	});
	const triggerRef = useRef<HTMLButtonElement>(null);
	const panelRef = useRef<HTMLDivElement>(null);
	const listId = useId();

	useEffect(() => {
		if (!open) return;
		const place = () => {
			const rect = triggerRef.current?.getBoundingClientRect();
			if (!rect) return;
			const below = window.innerHeight - rect.bottom - 14;
			const above = rect.top - 14;
			const desired = Math.min(280, options.length * 64 + 8);
			const upwards = below < desired && above > below;
			const height = Math.max(0, Math.min(desired, upwards ? above : below));
			const width = Math.min(rect.width, window.innerWidth - 16);
			setPosition({
				left: Math.max(8, Math.min(rect.left, window.innerWidth - width - 8)),
				...(upwards ? { bottom: window.innerHeight - rect.top + 6 } : { top: rect.bottom + 6 }),
				width,
				maxHeight: height,
			});
		};
		const outside = (event: PointerEvent) => {
			const target = event.target as Node;
			if (!triggerRef.current?.contains(target) && !panelRef.current?.contains(target)) {
				setOpen(false);
			}
		};
		place();
		window.addEventListener('resize', place);
		window.addEventListener('scroll', place, true);
		document.addEventListener('pointerdown', outside);
		return () => {
			window.removeEventListener('resize', place);
			window.removeEventListener('scroll', place, true);
			document.removeEventListener('pointerdown', outside);
		};
	}, [open, options.length]);

	useEffect(() => {
		if (!open) return;
		panelRef.current
			?.querySelector(`[data-option-index="${activeIndex}"]`)
			?.scrollIntoView({ block: 'nearest' });
	}, [open, activeIndex, position.maxHeight]);

	const choose = (index: number) => {
		setOpen(false);
		onChange(options[index].id);
	};
	const expand = () => {
		setActiveIndex(selectedIndex);
		setOpen(true);
	};
	const onKeyDown = (event: KeyboardEvent<HTMLButtonElement>) => {
		if (event.key === 'Escape' && open) {
			event.preventDefault();
			event.stopPropagation();
			setOpen(false);
		} else if (event.key === 'Tab') {
			setOpen(false);
		} else if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
			event.preventDefault();
			if (!open) expand();
			else
				setActiveIndex(
					(index) =>
						(index + (event.key === 'ArrowDown' ? 1 : -1) + options.length) % options.length
				);
		} else if (event.key === 'Home' || event.key === 'End') {
			event.preventDefault();
			setOpen(true);
			setActiveIndex(event.key === 'Home' ? 0 : options.length - 1);
		} else if (event.key === 'Enter' || event.key === ' ') {
			event.preventDefault();
			if (open) choose(activeIndex);
			else expand();
		}
	};
	const identity = (option: Target) =>
		option.id ? (
			<StickyProviderIdentity identity={option.identity} fallbackName={option.providerName} wrap />
		) : (
			<div className="flex min-w-0 items-center gap-2 text-xs font-medium text-gray-800">
				<span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md bg-gray-100 text-gray-500">
					<Squares2X2Icon className="h-4 w-4" aria-hidden />
				</span>
				<span className="[overflow-wrap:anywhere]">{option.providerName}</span>
			</div>
		);

	return (
		<div className="min-w-0 flex-1 sm:w-64 sm:flex-none">
			<button
				ref={triggerRef}
				type="button"
				role="combobox"
				aria-label={`${t('usersFilterProvider')}: ${selected.providerName}`}
				aria-haspopup="listbox"
				aria-expanded={open}
				aria-controls={open ? listId : undefined}
				aria-activedescendant={open ? `${listId}-${activeIndex}` : undefined}
				disabled={disabled}
				onClick={() => (open ? setOpen(false) : expand())}
				onKeyDown={onKeyDown}
				onBlur={() => setOpen(false)}
				className="flex min-h-12 w-full min-w-0 items-center gap-2 rounded-md border border-gray-300 bg-white px-2.5 py-1.5 text-left hover:border-gray-400 focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-500/30 disabled:cursor-not-allowed disabled:bg-gray-50 disabled:opacity-60"
			>
				<div className="min-w-0 flex-1">{identity(selected)}</div>
				<ChevronDownIcon
					className={`h-4 w-4 shrink-0 text-gray-400 ${open ? 'rotate-180' : ''}`}
					aria-hidden
				/>
			</button>
			{open &&
				!disabled &&
				createPortal(
					<div
						ref={panelRef}
						id={listId}
						role="listbox"
						aria-label={t('usersFilterProvider')}
						style={position}
						className="fixed z-[70] overflow-y-auto overscroll-contain rounded-lg border border-gray-200 bg-white p-1 shadow-lg"
						onMouseDown={(event) => event.preventDefault()}
					>
						{options.map((option, index) => (
							<div
								key={option.id}
								id={`${listId}-${index}`}
								data-option-index={index}
								role="option"
								aria-label={option.providerName}
								aria-selected={option.id === value}
								onMouseMove={() => setActiveIndex(index)}
								onClick={() => choose(index)}
								className={`flex min-h-12 cursor-pointer items-center gap-2 rounded-md px-2 py-2 ${
									index === activeIndex ? 'bg-blue-50' : 'hover:bg-gray-50'
								}`}
							>
								<div className="min-w-0 flex-1">{identity(option)}</div>
								<span className="w-4 shrink-0">
									{option.id === value ? (
										<CheckIcon className="h-4 w-4 text-blue-600" aria-hidden />
									) : null}
								</span>
							</div>
						))}
					</div>,
					document.body
				)}
		</div>
	);
}
