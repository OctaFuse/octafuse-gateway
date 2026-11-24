'use client';

import { useMemo, useRef, useState } from 'react';
import type { KeyboardEvent } from 'react';
import type { ModelOption } from '@/lib/provider-model-discovery';

const ROW_HEIGHT = 64;
const LIST_HEIGHT = 320;
const OVERSCAN = 4;

type Props = {
	id: string;
	value: string;
	onChange: (value: string) => void;
	onOpen?: () => void;
	options: ModelOption[];
	loading?: boolean;
	attempted?: boolean;
	operation: string;
	className: string;
	placeholder: string;
	labels: { noMatches: string; loading: string; search: string };
};

export function ProviderModelCombobox({ id, value, onChange, onOpen, options, loading = false, attempted = false, operation, className, placeholder, labels }: Props) {
	const [open, setOpen] = useState(false);
	const [active, setActive] = useState(0);
	const [search, setSearch] = useState('');
	const [scrollTop, setScrollTop] = useState(0);
	const composing = useRef(false);
	const suppressFocus = useRef(false);
	const input = useRef<HTMLInputElement>(null);
	const list = useRef<HTMLDivElement>(null);
	const visible = useMemo(() => {
		const query = search.trim().toLocaleLowerCase();
		return options.filter((option) => (!option.operations?.length || option.operations.includes(operation)) && (!query || option.id.toLocaleLowerCase().includes(query) || option.label.toLocaleLowerCase().includes(query)));
	}, [options, operation, search]);

	const highlighted = visible.length ? Math.min(active, visible.length - 1) : -1;
	const viewportHeight = Math.min(LIST_HEIGHT, visible.length * ROW_HEIGHT);
	const effectiveScrollTop = Math.min(scrollTop, Math.max(0, visible.length * ROW_HEIGHT - viewportHeight));
	const start = Math.max(0, Math.floor(effectiveScrollTop / ROW_HEIGHT) - OVERSCAN);
	const end = Math.min(visible.length, start + Math.ceil(LIST_HEIGHT / ROW_HEIGHT) + OVERSCAN * 2);
	const resetScroll = () => {
		if (list.current) list.current.scrollTop = 0;
		setScrollTop(0);
	};
	const moveTo = (index: number) => {
		setActive(index);
		const viewport = list.current;
		if (!viewport) return;
		const top = index * ROW_HEIGHT;
		if (top < viewport.scrollTop) viewport.scrollTop = top;
		else if (top + ROW_HEIGHT > viewport.scrollTop + viewport.clientHeight) viewport.scrollTop = top + ROW_HEIGHT - viewport.clientHeight;
		setScrollTop(viewport.scrollTop);
	};
	const closeAndFocus = () => {
		setOpen(false);
		suppressFocus.current = true;
		input.current?.focus();
		suppressFocus.current = false;
	};
	const select = (option: ModelOption) => {
		onChange(option.id);
		setSearch('');
		closeAndFocus();
	};
	const handleKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
		if (composing.current || event.nativeEvent.isComposing || event.keyCode === 229) return;
		if (event.key === 'Escape') {
			if (open) {
				event.preventDefault();
				closeAndFocus();
			}
			return;
		}
		if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
			event.preventDefault();
			setOpen(true);
			if (visible.length) moveTo(open ? Math.max(0, Math.min(visible.length - 1, highlighted + (event.key === 'ArrowDown' ? 1 : -1))) : event.key === 'ArrowDown' ? 0 : visible.length - 1);
			return;
		}
		if (event.key === 'Enter' && open) {
			if (visible[highlighted]) {
				event.preventDefault();
				select(visible[highlighted]);
			} else if (event.currentTarget !== input.current) {
				event.preventDefault();
			}
		}
	};

	return <div className="relative" onBlur={(event) => {
		const root = event.currentTarget;
		window.setTimeout(() => { if (!root.contains(document.activeElement)) setOpen(false); }, 0);
	}}>
		<input ref={input} id={id} role="combobox" aria-expanded={open} aria-controls={`${id}-options`} aria-activedescendant={open && highlighted >= start && highlighted < end ? `${id}-option-${highlighted}` : undefined} aria-autocomplete="list" autoComplete="off" type="text" required value={value} className={className} placeholder={placeholder}
			onFocus={() => { if (suppressFocus.current) return; if (!open) { setSearch(''); setActive(0); resetScroll(); } setOpen(true); onOpen?.(); }}
			onClick={() => { if (!open) { setSearch(''); setActive(0); resetScroll(); setOpen(true); } onOpen?.(); }}
			onCompositionStart={() => { composing.current = true; }} onCompositionEnd={() => { composing.current = false; }}
			onChange={(event) => { onChange(event.target.value); setOpen(true); onOpen?.(); }}
			onKeyDown={handleKeyDown} />
		{open && (options.length > 0 || visible.length > 0 || loading || attempted) && <div className="absolute z-30 mt-1 w-full rounded-lg border border-gray-200 bg-white p-1 shadow-lg dark:border-gray-700 dark:bg-gray-900">
			<input type="search" role="combobox" aria-label={labels.search} aria-expanded={open} aria-controls={`${id}-options`} aria-activedescendant={highlighted >= start && highlighted < end ? `${id}-option-${highlighted}` : undefined} aria-autocomplete="list" placeholder={labels.search} autoComplete="off" value={search}
				className="mb-1 w-full rounded-md border border-gray-200 bg-white px-3 py-2 text-sm outline-none focus-visible:ring-2 focus-visible:ring-blue-500 dark:border-gray-700 dark:bg-gray-900"
				onChange={(event) => { setSearch(event.target.value); setActive(0); resetScroll(); }}
				onCompositionStart={() => { composing.current = true; }} onCompositionEnd={() => { composing.current = false; }}
				onKeyDown={handleKeyDown} />
			{visible.length ? <div id={`${id}-options`} role="listbox" ref={list} className="overflow-y-auto" style={{ height: viewportHeight }} onScroll={(event) => setScrollTop(event.currentTarget.scrollTop)}>
				<div className="relative" style={{ height: visible.length * ROW_HEIGHT }}>
					{visible.slice(start, end).map((option, offset) => {
						const index = start + offset;
						return <button id={`${id}-option-${index}`} type="button" role="option" aria-selected={highlighted === index} aria-posinset={index + 1} aria-setsize={visible.length} tabIndex={-1} key={`${option.id}:${index}`} onMouseDown={(event) => event.preventDefault()} onClick={() => select(option)}
							className={`absolute left-0 flex w-full flex-col justify-center rounded px-3 text-left text-sm focus-visible:ring-2 focus-visible:ring-blue-500 hover:bg-gray-100 dark:hover:bg-gray-800 ${highlighted === index ? 'bg-gray-100 dark:bg-gray-800' : ''}`}
							style={{ top: index * ROW_HEIGHT, height: ROW_HEIGHT }}>
							<span className="block w-full truncate">{option.id}</span>{option.label !== option.id && <span className="block w-full truncate text-xs text-gray-500">{option.label}</span>}
						</button>;
					})}
				</div>
			</div> : <p id={`${id}-options`} role="listbox" className="px-3 py-2 text-sm text-gray-500">{loading ? labels.loading : labels.noMatches}</p>}
		</div>}
	</div>;
}
