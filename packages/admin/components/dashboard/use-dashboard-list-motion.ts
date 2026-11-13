'use client';

import { useLayoutEffect, useRef, type RefObject } from 'react';

/** Relative coordinates make list motion independent of the page's scroll position. */
export function useDashboardListMotion(ref: RefObject<HTMLElement>, scope: string, identity: string) {
	const beforeRef = useRef<{ scope: string; width: number; rowHeight: number; positions: Map<string, number> } | null>(null);
	useLayoutEffect(() => {
		const root = ref.current;
		if (!root) return;
		const top = root.getBoundingClientRect().top;
		const items = [...root.querySelectorAll<HTMLElement>('[data-dashboard-item]')];
		const positions = new Map(items.map(item => [item.dataset.dashboardItem!, item.getBoundingClientRect().top - top]));
		const before = beforeRef.current;
		const width = root.clientWidth;
		const rowHeight = items[0]?.getBoundingClientRect().height ?? 0;
		beforeRef.current = { scope, width, rowHeight, positions };
		if (!before?.positions.size || before.scope !== scope || before.width !== width || Math.abs(before.rowHeight - rowHeight) > 1 || window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
		for (const item of items) {
			const key = item.dataset.dashboardItem!;
			const previous = before.positions.get(key);
			if (previous == null) {
				item.animate([{ opacity: 0, transform: 'translateY(-8px)', backgroundColor: '#eff6ff' }, { opacity: 1, transform: 'translateY(0)', backgroundColor: 'transparent' }], { duration: 500, easing: 'ease-out' });
			} else {
				const delta = previous - positions.get(key)!;
				if (Math.abs(delta) > 1) item.animate([{ transform: `translateY(${Math.max(-120, Math.min(120, delta))}px)` }, { transform: 'translateY(0)' }], { duration: 400, easing: 'ease-out' });
			}
		}
	}, [ref, scope, identity]);
}
