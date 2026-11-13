/** Move existing rows down and bring new rows in, without scrolling the reader's viewport. */
export function animateRequestLogRows(
	table: HTMLElement, previousPositions: ReadonlyMap<string, number>, incomingIds: readonly string[]
) {
	if (!incomingIds.length || window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
	const incoming = new Set(incomingIds);
	const easing = 'cubic-bezier(0.2, 0.7, 0.3, 1)';
	let index = 0;
	for (const row of table.querySelectorAll<HTMLElement>('[data-request-log-id]')) {
		const id = row.dataset.requestLogId!;
		if (incoming.has(id)) {
			const delay = Math.min(index++, 7) * 24;
			row.animate([{ opacity: 0, transform: 'translateY(-12px)' }, { opacity: 1, transform: 'translateY(0)' }], { duration: 360, delay, easing });
			for (const cell of row.children) {
				cell.animate([{ backgroundColor: '#eff6ff' }, { backgroundColor: getComputedStyle(cell).backgroundColor }], { duration: 1800, delay, easing });
			}
		} else {
			const before = previousPositions.get(id);
			if (before == null) continue;
			const delta = Math.max(-160, Math.min(160, before - row.getBoundingClientRect().top));
			if (Math.abs(delta) > 1) row.animate([{ transform: `translateY(${delta}px)` }, { transform: 'translateY(0)' }], { duration: 360, easing });
		}
	}
}
