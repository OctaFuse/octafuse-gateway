'use client';

import { useLayoutEffect, useRef } from 'react';
import { interpolateDashboardValue } from './dashboard-live';

/** Animate only real updates; the accessible text and tooltip always contain the exact result. */
export function DashboardNumber({ value, format, scope, className = '' }: {
	value: number | null | undefined; format: (value: number) => string; scope: string; className?: string;
}) {
	const nodeRef = useRef<HTMLSpanElement>(null);
	const beforeRef = useRef({ value, scope });
	const shownRef = useRef(value);
	const formatRef = useRef(format);
	const exact = value == null || !Number.isFinite(value) ? '—' : format(value);
	useLayoutEffect(() => { formatRef.current = format; }, [format]);
	useLayoutEffect(() => {
		const before = beforeRef.current;
		beforeRef.current = { value, scope };
		const from = shownRef.current;
		const node = nodeRef.current;
		if (!node) return;
		if (before.scope !== scope || from == null || value == null || !Number.isFinite(from) || !Number.isFinite(value)
			|| Object.is(from, value) || window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
			shownRef.current = value;
			return;
		}
		node.textContent = formatRef.current(from);
		const started = performance.now();
		let frame = 0;
		const highlight = node.animate([{ color: '#2563eb' }, { color: getComputedStyle(node).color }], { duration: 900, easing: 'ease-out' });
		const step = (now: number) => {
			const progress = Math.min(1, (now - started) / 500);
			const shown = interpolateDashboardValue(from, value, progress);
			shownRef.current = shown;
			node.textContent = formatRef.current(shown);
			if (progress < 1) frame = requestAnimationFrame(step);
		};
		frame = requestAnimationFrame(step);
		return () => { cancelAnimationFrame(frame); highlight.cancel(); };
	}, [value, scope]);
	return <span title={exact} className={className}><span ref={nodeRef} aria-hidden>{exact}</span><span className="sr-only">{exact}</span></span>;
}
