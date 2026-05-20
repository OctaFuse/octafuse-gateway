export type ListSortDir = 'asc' | 'desc';

/**
 * 列表表头排序：任意列点击均按降序（切换列亦重置为降序）。
 */
export function nextListSortState(
	_currentKey: string,
	_currentDir: ListSortDir,
	clickedKey: string,
): { sortKey: string; sortDir: ListSortDir } {
	return { sortKey: clickedKey, sortDir: 'desc' };
}

/**
 * 切换列降序；同列再次点击在升/降序间切换（API Keys 等）。
 */
export function nextListSortStateWithAscToggle(
	currentKey: string,
	currentDir: ListSortDir,
	clickedKey: string,
): { sortKey: string; sortDir: ListSortDir } {
	if (currentKey === clickedKey) {
		return { sortKey: clickedKey, sortDir: currentDir === 'desc' ? 'asc' : 'desc' };
	}
	return { sortKey: clickedKey, sortDir: 'desc' };
}
