'use client';

import {
	CheckCircleIcon,
	ExclamationCircleIcon,
	InformationCircleIcon,
	XMarkIcon,
} from '@heroicons/react/24/outline';
import { useTranslations } from 'next-intl';
import {
	createContext,
	useCallback,
	useContext,
	useEffect,
	useId,
	useMemo,
	useRef,
	useState,
	type ReactNode,
} from 'react';

export type ToastKind = 'success' | 'error' | 'info';

export type ConfirmRequest = {
	title: string;
	message?: string;
	confirmLabel?: string;
	cancelLabel?: string;
	danger?: boolean;
};

type ToastItem = {
	id: number;
	kind: ToastKind;
	message: string;
	detail?: string;
	leaving?: boolean;
};

type FeedbackApi = {
	notify: (kind: ToastKind, message: string, detail?: string) => void;
	confirm: (request: ConfirmRequest) => Promise<boolean>;
};

const FeedbackContext = createContext<FeedbackApi | null>(null);
const TOAST_LIMIT = 4;
const TOAST_EXIT_MS = 220;
const TOAST_MS: Record<ToastKind, number> = {
	success: 4500,
	info: 4500,
	error: 8000,
};

let toastSeq = 0;

export function useFeedback(): FeedbackApi {
	const ctx = useContext(FeedbackContext);
	if (!ctx) {
		throw new Error('useFeedback must be used within FeedbackProvider');
	}
	return ctx;
}

export function FeedbackProvider({ children }: { children: ReactNode }) {
	const tCommon = useTranslations('common');
	const [toasts, setToasts] = useState<ToastItem[]>([]);
	const [dialog, setDialog] = useState<ConfirmRequest | null>(null);
	const pendingRef = useRef<{ resolve: (value: boolean) => void } | null>(null);
	const timersRef = useRef<Map<number, ReturnType<typeof setTimeout>>>(new Map());
	const leavingIdsRef = useRef<Set<number>>(new Set());
	const titleId = useId();
	const messageId = useId();

	const removeToast = useCallback((id: number) => {
		const timer = timersRef.current.get(id);
		if (timer) {
			clearTimeout(timer);
			timersRef.current.delete(id);
		}
		leavingIdsRef.current.delete(id);
		setToasts((prev) => prev.filter((item) => item.id !== id));
	}, []);

	const dismissToast = useCallback(
		(id: number) => {
			if (leavingIdsRef.current.has(id)) return;
			leavingIdsRef.current.add(id);
			const timer = timersRef.current.get(id);
			if (timer) {
				clearTimeout(timer);
				timersRef.current.delete(id);
			}
			setToasts((prev) =>
				prev.map((item) => (item.id === id ? { ...item, leaving: true } : item))
			);
			const exitTimer = setTimeout(() => removeToast(id), TOAST_EXIT_MS);
			timersRef.current.set(id, exitTimer);
		},
		[removeToast]
	);

	const notify = useCallback(
		(kind: ToastKind, message: string, detail?: string) => {
			const id = ++toastSeq;
			setToasts((prev) => {
				const next = [...prev, { id, kind, message, detail }];
				return next.length > TOAST_LIMIT ? next.slice(next.length - TOAST_LIMIT) : next;
			});
			const timer = setTimeout(() => dismissToast(id), TOAST_MS[kind]);
			timersRef.current.set(id, timer);
		},
		[dismissToast]
	);

	const closeDialog = useCallback((value: boolean) => {
		pendingRef.current?.resolve(value);
		pendingRef.current = null;
		setDialog(null);
	}, []);

	const confirm = useCallback((request: ConfirmRequest) => {
		return new Promise<boolean>((resolve) => {
			pendingRef.current?.resolve(false);
			pendingRef.current = { resolve };
			setDialog(request);
		});
	}, []);

	useEffect(() => {
		return () => {
			for (const timer of timersRef.current.values()) {
				clearTimeout(timer);
			}
			timersRef.current.clear();
			leavingIdsRef.current.clear();
			pendingRef.current?.resolve(false);
			pendingRef.current = null;
		};
	}, []);

	useEffect(() => {
		if (!dialog) return;
		const onKey = (event: KeyboardEvent) => {
			if (event.key === 'Escape') {
				event.preventDefault();
				closeDialog(false);
			}
		};
		window.addEventListener('keydown', onKey);
		return () => window.removeEventListener('keydown', onKey);
	}, [closeDialog, dialog]);

	const api = useMemo(() => ({ notify, confirm }), [confirm, notify]);

	return (
		<FeedbackContext.Provider value={api}>
			{children}
			<div
				className="pointer-events-none fixed right-4 top-4 z-[90] flex w-[min(24rem,calc(100vw-2rem))] flex-col gap-2 sm:right-6 sm:top-5"
				aria-live="polite"
			>
				{[...toasts].reverse().map((item) => (
					<ToastCard
						key={item.id}
						item={item}
						dismissLabel={tCommon('dismiss')}
						onDismiss={() => dismissToast(item.id)}
					/>
				))}
			</div>
			{dialog ? (
				<div
					className="fixed inset-0 z-[80] flex items-center justify-center bg-black/50 p-4"
					onMouseDown={(event) => {
						if (event.target === event.currentTarget) closeDialog(false);
					}}
				>
					<div
						className="w-full max-w-md rounded-xl bg-white shadow-xl ring-1 ring-black/5"
						role="alertdialog"
						aria-modal="true"
						aria-labelledby={titleId}
						aria-describedby={dialog.message ? messageId : undefined}
					>
						<div className="px-5 py-4">
							<h2 id={titleId} className="text-base font-semibold text-gray-900">
								{dialog.title}
							</h2>
							{dialog.message ? (
								<p id={messageId} className="mt-2 text-sm leading-relaxed text-gray-600">
									{dialog.message}
								</p>
							) : null}
						</div>
						<div className="flex justify-end gap-3 rounded-b-xl border-t border-gray-200 bg-gray-50 px-5 py-3">
							<button
								type="button"
								autoFocus={dialog.danger === true}
								onClick={() => closeDialog(false)}
								className="rounded-md border border-gray-300 bg-white px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50 focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-500"
							>
								{dialog.cancelLabel ?? tCommon('cancel')}
							</button>
							<button
								type="button"
								autoFocus={dialog.danger !== true}
								onClick={() => closeDialog(true)}
								className={
									dialog.danger
										? 'rounded-md bg-red-600 px-4 py-2 text-sm font-medium text-white hover:bg-red-700 focus:outline-none focus-visible:ring-2 focus-visible:ring-red-500'
										: 'rounded-md bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700 focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-500'
								}
							>
								{dialog.confirmLabel ?? tCommon('confirm')}
							</button>
						</div>
					</div>
				</div>
			) : null}
		</FeedbackContext.Provider>
	);
}

function ToastCard(props: {
	item: ToastItem;
	dismissLabel: string;
	onDismiss: () => void;
}) {
	const { item, dismissLabel, onDismiss } = props;
	const Icon =
		item.kind === 'success'
			? CheckCircleIcon
			: item.kind === 'error'
				? ExclamationCircleIcon
				: InformationCircleIcon;
	const tone =
		item.kind === 'success'
			? 'border-emerald-200 border-l-emerald-500'
			: item.kind === 'error'
				? 'border-red-200 border-l-red-500'
				: 'border-sky-200 border-l-sky-500';
	const iconTone =
		item.kind === 'success' ? 'text-emerald-600' : item.kind === 'error' ? 'text-red-600' : 'text-sky-600';
	const progressTone =
		item.kind === 'success' ? 'bg-emerald-500' : item.kind === 'error' ? 'bg-red-500' : 'bg-sky-500';
	return (
		<div
			className={`pointer-events-auto overflow-hidden rounded-lg border border-l-4 bg-white shadow-lg ring-1 ring-black/5 ${tone} ${
				item.leaving ? 'octafuse-toast-leaving' : 'octafuse-toast-enter'
			}`}
			role={item.kind === 'error' ? 'alert' : 'status'}
		>
			<div className="flex gap-3 px-3 py-3">
				<Icon className={`mt-0.5 h-5 w-5 shrink-0 ${iconTone}`} aria-hidden />
				<div className="min-w-0 flex-1">
					<p className="text-sm font-medium text-gray-900">{item.message}</p>
					{item.detail ? (
						<p className="mt-1 whitespace-pre-wrap break-words text-xs leading-relaxed text-gray-600">
							{item.detail}
						</p>
					) : null}
				</div>
				<button
					type="button"
					onClick={onDismiss}
					className="shrink-0 rounded-md p-1 text-gray-400 hover:bg-gray-100 hover:text-gray-600 focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-500"
					aria-label={dismissLabel}
				>
					<XMarkIcon className="h-4 w-4" aria-hidden />
				</button>
			</div>
			{item.leaving ? null : (
				<div className="h-0.5 bg-gray-100" aria-hidden>
					<div
						className={`h-full origin-left ${progressTone} octafuse-toast-progress`}
						style={{ animationDuration: `${TOAST_MS[item.kind]}ms` }}
					/>
				</div>
			)}
		</div>
	);
}
