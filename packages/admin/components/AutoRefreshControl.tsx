'use client';

import { ArrowPathIcon, CheckIcon, ChevronDownIcon, ExclamationCircleIcon } from '@heroicons/react/24/outline';
import { createPortal } from 'react-dom';
import { useTranslations } from 'next-intl';
import { useEffect, useId, useLayoutEffect, useRef, useState } from 'react';
import { AUTO_REFRESH_INTERVAL_OPTIONS, type AutoRefreshIntervalMs } from '@/lib/auto-refresh-preference';
import { formatAutoRefreshCountdown, autoRefreshSeconds } from '@/lib/auto-refresh-scheduler';

export type AutoRefreshState = {
	isRefreshing: boolean;
	lastUpdatedAt: number | null;
	nextRefreshAt: number | null;
	lastRefreshResult: { finishedAt: number; status: 'success' | 'error' } | null;
};

type Props = AutoRefreshState & {
	intervalMs: AutoRefreshIntervalMs;
	onIntervalChange: (value: AutoRefreshIntervalMs) => void;
	refresh: () => Promise<void>;
	label: string;
	refreshLabel: string;
	disabled?: boolean;
	disabledHint?: string;
};

function formatAgo(elapsedMs: number): string {
	const seconds = Math.max(0, Math.floor(elapsedMs / 1000));
	if (seconds < 60) return `${seconds}s`;
	const minutes = Math.floor(seconds / 60);
	return `${minutes}m`;
}

export function AutoRefreshControl(props: Props) {
	const { intervalMs, disabled = false, disabledHint, onIntervalChange, refresh,
		label, refreshLabel, isRefreshing, lastUpdatedAt, nextRefreshAt, lastRefreshResult } = props;
	const t = useTranslations('autoRefresh');
	const menuId = useId();
	const rootRef = useRef<HTMLDivElement>(null);
	const triggerRef = useRef<HTMLButtonElement>(null);
	const menuRef = useRef<HTMLDivElement>(null);
	const optionRefs = useRef<Array<HTMLButtonElement | null>>([]);
	const [open, setOpen] = useState(false);
	const [position, setPosition] = useState<{ top: number; left: number; width: number } | null>(null);
	const visible = open && !disabled;
	const positioned = position !== null;
	const close = () => { setOpen(false); triggerRef.current?.focus(); };
	const optionLabel = (value: AutoRefreshIntervalMs) => value === 'off' ? t('off')
		: value === 60_000 ? t('every1m') : value === 300_000 ? t('every5m') : t('every10m');

	useLayoutEffect(() => {
		if (!visible) return;
		const update = () => {
			const anchor = rootRef.current?.getBoundingClientRect();
			if (!anchor) return;
			const width = Math.min(208, window.innerWidth - 32);
			const height = menuRef.current?.getBoundingClientRect().height ?? 160;
			const below = anchor.bottom + 8;
			setPosition({ width,
				left: Math.max(16, Math.min(anchor.right - width, window.innerWidth - width - 16)),
				top: Math.max(16, below + height <= window.innerHeight - 16 ? below : anchor.top - height - 8),
			});
		};
		update();
		window.addEventListener('resize', update);
		window.addEventListener('scroll', update, true);
		return () => {
			window.removeEventListener('resize', update);
			window.removeEventListener('scroll', update, true);
		};
	}, [visible]);

	useEffect(() => {
		if (!visible || !positioned) return;
		optionRefs.current[AUTO_REFRESH_INTERVAL_OPTIONS.indexOf(intervalMs)]?.focus();
		const outside = (event: PointerEvent) => {
			if (!rootRef.current?.contains(event.target as Node) && !menuRef.current?.contains(event.target as Node)) setOpen(false);
		};
		document.addEventListener('pointerdown', outside);
		return () => document.removeEventListener('pointerdown', outside);
	}, [visible, intervalMs, positioned]);
	const automatic = intervalMs !== 'off';
	const intervalLabel = intervalMs === 60_000 ? t('every1m')
		: intervalMs === 300_000 ? t('every5m') : t('every10m');
	const stateLabel = automatic ? intervalLabel : t('off');
	const [now, setNow] = useState(() => Date.now());
	useEffect(() => {
		if (disabled) return;
		const id = window.setInterval(() => {
			if (document.visibilityState === 'visible') setNow(Date.now());
		}, 1000);
		return () => window.clearInterval(id);
	}, [disabled]);

	const recentResult = lastRefreshResult && Math.max(0, now - lastRefreshResult.finishedAt) < 1800;
	const failed = lastRefreshResult?.status === 'error';
	const succeeded = recentResult && !failed;
	const remaining = autoRefreshSeconds(nextRefreshAt, now);
	const seconds = automatic && remaining != null ? Math.min(remaining, Number(intervalMs) / 1000) : null;
	const countdown = seconds == null ? '—:—' : formatAutoRefreshCountdown(seconds);
	const progress = automatic && seconds != null ? seconds / (Number(intervalMs) / 1000) : 0;
	const showCountdown = automatic && !disabled;
	const buttonLabel = disabled ? '—' : automatic ? (isRefreshing ? '—:—' : countdown) : t('offShort');
	const buttonDescription = `${refreshLabel} · ${disabled ? (disabledHint ?? label) : stateLabel}`;
	const agoLabel = lastUpdatedAt != null ? t('updatedAgo', { ago: formatAgo(now - lastUpdatedAt) }) : null;
	const tooltip = [buttonDescription,
		!disabled && failed ? t('failed') : null,
		showCountdown && nextRefreshAt != null ? t('nextIn', { time: countdown }) : null,
		!disabled ? agoLabel : null,
	].filter(Boolean).join(' · ');
	const iconTone = disabled ? 'text-gray-400' : failed ? 'text-amber-600'
		: succeeded ? 'text-emerald-600' : automatic ? 'text-blue-500' : 'text-gray-500';

	const focusOption = (index: number) => {
		const count = AUTO_REFRESH_INTERVAL_OPTIONS.length;
		optionRefs.current[(index + count) % count]?.focus();
	};

	return (
		<div ref={rootRef} role="group" aria-label={label}
			className="relative inline-flex h-9 shrink-0 items-stretch rounded-lg border border-gray-200 bg-white text-gray-600">
			<button type="button" onClick={() => void refresh()} disabled={disabled || isRefreshing}
				title={tooltip} aria-label={buttonDescription} aria-busy={isRefreshing}
				className="inline-flex w-9 shrink-0 items-center justify-center rounded-l-lg transition-colors duration-150 hover:bg-gray-50 motion-reduce:transition-none focus-visible:z-10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-gray-500 disabled:cursor-not-allowed disabled:opacity-60">
				<span className={`inline-flex h-4 w-4 items-center justify-center transition-colors duration-200 motion-reduce:transition-none ${iconTone}`} aria-hidden>
					{isRefreshing ? <ArrowPathIcon className="h-4 w-4 animate-spin motion-reduce:animate-none" />
						: failed ? <ExclamationCircleIcon className="h-4 w-4" />
							: succeeded ? <CheckIcon className="h-4 w-4" /> : <ArrowPathIcon className="h-4 w-4" />}
				</span>
				<span role="status" className="sr-only">{isRefreshing ? t('refreshing') : recentResult ? t(failed ? 'failed' : 'succeeded') : ''}</span>
			</button>
			<button ref={triggerRef} type="button" disabled={disabled} aria-haspopup="menu"
				aria-expanded={visible} aria-controls={visible ? menuId : undefined} aria-label={`${label} · ${stateLabel}`}
				title={disabled ? disabledHint : `${label} · ${stateLabel}`}
				onClick={() => setOpen(current => !current)}
				onKeyDown={event => {
					if (event.key === 'ArrowDown' || event.key === 'ArrowUp') { event.preventDefault(); setOpen(true); }
				}}
				className="relative inline-flex min-w-[4.5rem] items-center justify-center gap-2 rounded-r-lg border-l border-gray-100 px-2.5 text-xs transition-colors duration-150 hover:bg-gray-50 motion-reduce:transition-none focus-visible:z-10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-gray-500 disabled:cursor-not-allowed disabled:opacity-60">
				<ChevronDownIcon className={`h-3.5 w-3.5 shrink-0 text-gray-500 transition-transform duration-150 motion-reduce:transition-none ${visible ? 'rotate-180' : ''}`} aria-hidden />
				<span className={showCountdown ? 'w-[5ch] text-center font-mono tabular-nums' : 'min-w-[3ch] text-center'} aria-hidden>{buttonLabel}</span>
				{showCountdown && nextRefreshAt != null && !isRefreshing && (
					<span className="pointer-events-none absolute inset-x-2 bottom-0.5 h-px overflow-hidden rounded-full bg-gray-100" aria-hidden>
						<span className="absolute inset-0 origin-left bg-blue-400/70 transition-transform duration-1000 ease-linear motion-reduce:transition-none" style={{ transform: `scaleX(${progress})` }} />
					</span>
				)}
			</button>
			{visible && createPortal(
				<div ref={menuRef} id={menuId} role="menu" aria-label={label}
					style={{ ...position, visibility: position ? 'visible' : 'hidden' }}
					className="fixed z-[80] max-h-[calc(100dvh-2rem)] overflow-y-auto rounded-xl border border-gray-200 bg-white p-1 shadow-panel"
					onKeyDown={event => {
						if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); close(); }
						if (event.key === 'Tab') close();
					}}>
					{AUTO_REFRESH_INTERVAL_OPTIONS.map((value, index) => (
						<button key={value} ref={element => { optionRefs.current[index] = element; }}
							type="button" role="menuitemradio" tabIndex={-1} aria-checked={intervalMs === value}
							onClick={() => { onIntervalChange(value); close(); }}
							onKeyDown={event => {
								if (event.key === 'ArrowDown') { event.preventDefault(); focusOption(index + 1); }
								if (event.key === 'ArrowUp') { event.preventDefault(); focusOption(index - 1); }
								if (event.key === 'Home') { event.preventDefault(); focusOption(0); }
								if (event.key === 'End') { event.preventDefault(); focusOption(AUTO_REFRESH_INTERVAL_OPTIONS.length - 1); }
							}}
							className="flex min-h-9 w-full items-center gap-2.5 rounded-lg px-3 py-2 text-left text-sm text-gray-600 hover:bg-gray-50 focus-visible:bg-gray-100 focus-visible:outline-none aria-checked:font-medium aria-checked:text-gray-950">
							<span className="flex h-4 w-4 shrink-0 items-center justify-center" aria-hidden>
								{intervalMs === value && <span className="h-1.5 w-1.5 rounded-full bg-gray-900" />}
							</span>
							{optionLabel(value)}
						</button>
					))}
				</div>, document.body
			)}
		</div>
	);
}
