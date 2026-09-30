'use client';

/**
 * 列头 / 标签旁的说明浮层：点击开合，Esc 与点击外部关闭。
 */
import { useEffect, useId, useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { InformationCircleIcon } from '@heroicons/react/24/outline';

export function InfoHintPopover({
	label,
	children,
	align = 'end',
	openOnHover = false,
	panelClassName = '',
	portal = false,
}: {
	label: string;
	children: ReactNode;
	align?: 'start' | 'end';
	openOnHover?: boolean;
	panelClassName?: string;
	/** Escape clipped tables and avoid inserting a block panel inside a text label. */
	portal?: boolean;
}) {
	const [open, setOpen] = useState(false);
	const [hovered, setHovered] = useState(false);
	const visible = open || hovered;
	const rootRef = useRef<HTMLSpanElement>(null);
	const panelId = useId();
	const panelRef = useRef<HTMLDivElement>(null);
	const hoverTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
	const [position, setPosition] = useState<{ top: number; left: number; width: number } | null>(null);
	const enter = () => {
		if (hoverTimer.current) clearTimeout(hoverTimer.current);
		setHovered(true);
	};
	const leave = () => {
		if (hoverTimer.current) clearTimeout(hoverTimer.current);
		hoverTimer.current = setTimeout(() => setHovered(false), 120);
	};
	useEffect(
		() => () => {
			if (hoverTimer.current) clearTimeout(hoverTimer.current);
		},
		[]
	);
	useLayoutEffect(() => {
		if (!visible || !portal) return;
		const update = () => {
			const anchor = rootRef.current?.getBoundingClientRect();
			if (!anchor) return;
			const width = Math.min(288, window.innerWidth - 32);
			const height = Math.min(panelRef.current?.getBoundingClientRect().height ?? 0, window.innerHeight - 32);
			const left = Math.max(
				16,
				Math.min(align === 'end' ? anchor.right - width : anchor.left, window.innerWidth - width - 16)
			);
			const below = anchor.bottom + 6;
			const top = Math.max(
				16,
				Math.min(
					below + height <= window.innerHeight - 16 ? below : anchor.top - height - 6,
					window.innerHeight - height - 16
				)
			);
			setPosition({ top, left, width });
		};
		update();
		window.addEventListener('resize', update);
		window.addEventListener('scroll', update, true);
		return () => {
			window.removeEventListener('resize', update);
			window.removeEventListener('scroll', update, true);
		};
	}, [visible, portal, align]);

	useEffect(() => {
		if (!visible) return;
		const onPointer = (event: MouseEvent) => {
			if (
				!rootRef.current?.contains(event.target as Node) &&
				!panelRef.current?.contains(event.target as Node)
			) {
				setOpen(false);
				setHovered(false);
			}
		};
		const onKey = (event: KeyboardEvent) => {
			if (event.key === 'Escape') {
				event.stopPropagation();
				setOpen(false);
				setHovered(false);
			}
		};
		document.addEventListener('mousedown', onPointer);
		document.addEventListener('keydown', onKey, true);
		return () => {
			document.removeEventListener('mousedown', onPointer);
			document.removeEventListener('keydown', onKey, true);
		};
	}, [visible]);

	const panel = (
		<div
			ref={panelRef}
			id={panelId}
			role="dialog"
			aria-label={label}
			style={
				portal
					? {
							...position,
							visibility: position ? 'visible' : 'hidden',
							width: position?.width ?? 'min(288px, calc(100vw - 32px))',
					  }
					: undefined
			}
			className={`${
				portal
					? 'fixed z-[100] max-h-[calc(100dvh-32px)] overflow-y-auto'
					: `absolute top-full z-30 mt-1.5 w-72 ${align === 'end' ? 'right-0' : 'left-0'}`
			} rounded-lg border border-gray-200 bg-white p-3 text-left text-xs font-normal normal-case tracking-normal text-gray-600 shadow-lg ${panelClassName}`}
			onPointerEnter={(event) => {
				if (openOnHover && event.pointerType === 'mouse') enter();
			}}
			onPointerLeave={leave}
			onClick={(event) => event.stopPropagation()}
		>
			{children}
		</div>
	);

	return (
		<span
			ref={rootRef}
			className={`relative inline-flex items-center ${
				openOnHover ? 'after:absolute after:inset-x-0 after:top-full after:h-2' : ''
			}`}
			onPointerEnter={(event) => {
				if (openOnHover && event.pointerType === 'mouse') enter();
			}}
			onPointerLeave={leave}
			onKeyDown={(event) => {
				if (event.key === 'Escape' && visible) {
					event.stopPropagation();
					setOpen(false);
					setHovered(false);
				}
			}}
		>
			<button
				type="button"
				className="inline-flex rounded-full text-gray-400 transition-colors hover:text-gray-600 focus:outline-none focus-visible:ring-2 focus-visible:ring-sky-400"
				aria-expanded={visible}
				aria-controls={panelId}
				aria-describedby={visible ? panelId : undefined}
				aria-label={label}
				onClick={(event) => {
					event.stopPropagation();
					setOpen((prev) => !prev);
				}}
			>
				<InformationCircleIcon className="h-3.5 w-3.5" aria-hidden />
			</button>
			{visible && (portal ? createPortal(panel, document.body) : panel)}
		</span>
	);
}
