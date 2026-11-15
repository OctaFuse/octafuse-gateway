/**
 * 两级多选（一级分组、二级具体项）的选择状态。请求日志的「模型」（厂商 → 模型）与
 * 「供应商」（类型 → 供应商）筛选共用。
 *
 * 选了整组就不再单独记它的子项：整组指目录里这一组现有的全部子项，以后新增的也算。
 * 不在目录里的分组或子项（已删除、或链接带来的）仍保留在选择里，由界面单独列出。
 */
export type GroupedSelection = { groups: string[]; items: string[] };

/** 当前可选的目录，顺序即展示顺序。子项 id 在整个目录里唯一。 */
export type GroupedCatalog = readonly { group: string; items: readonly string[] }[];

export type GroupedCheckState = 'checked' | 'mixed' | 'unchecked';

export type GroupedSelectionNode = { type: 'group' | 'item'; id: string };

export const EMPTY_GROUPED_SELECTION: GroupedSelection = { groups: [], items: [] };

export function isEmptyGroupedSelection(selection: GroupedSelection): boolean {
	return selection.groups.length === 0 && selection.items.length === 0;
}

function unique(values: readonly string[]): string[] {
	return [...new Set(values.map((value) => value.trim()).filter((value) => value !== ''))];
}

function itemsOf(catalog: GroupedCatalog, group: string): readonly string[] {
	return catalog.find((entry) => entry.group === group)?.items ?? [];
}

function groupOf(catalog: GroupedCatalog, item: string): string | undefined {
	return catalog.find((entry) => entry.items.includes(item))?.group;
}

/** 去重，并去掉已被整组覆盖的子项。 */
export function normalizeGroupedSelection(selection: GroupedSelection, catalog: GroupedCatalog): GroupedSelection {
	const groups = unique(selection.groups);
	const covered = new Set(groups.flatMap((group) => itemsOf(catalog, group)));
	return { groups, items: unique(selection.items).filter((item) => !covered.has(item)) };
}

export function groupedGroupState(selection: GroupedSelection, group: string, catalog: GroupedCatalog): GroupedCheckState {
	if (selection.groups.includes(group)) return 'checked';
	return itemsOf(catalog, group).some((item) => selection.items.includes(item)) ? 'mixed' : 'unchecked';
}

export function groupedItemState(selection: GroupedSelection, item: string, catalog: GroupedCatalog): GroupedCheckState {
	if (selection.items.includes(item)) return 'checked';
	const group = groupOf(catalog, item);
	return group !== undefined && selection.groups.includes(group) ? 'checked' : 'unchecked';
}

/** 勾选整组：记下分组并丢掉它的子项。取消整组：分组和它的子项都去掉。 */
export function toggleGroupedGroup(
	selection: GroupedSelection,
	group: string,
	checked: boolean,
	catalog: GroupedCatalog,
): GroupedSelection {
	const own = new Set(itemsOf(catalog, group));
	return normalizeGroupedSelection(
		{
			groups: checked ? [...selection.groups, group] : selection.groups.filter((value) => value !== group),
			items: selection.items.filter((item) => !own.has(item)),
		},
		catalog,
	);
}

/**
 * 勾选或取消一个子项。勾上一组里的最后一个子项时收拢成整组；
 * 在整组选中的情况下取消一个子项，改为保留该组其余子项。
 */
export function toggleGroupedItem(
	selection: GroupedSelection,
	item: string,
	checked: boolean,
	catalog: GroupedCatalog,
): GroupedSelection {
	const group = groupOf(catalog, item);
	if (group === undefined) {
		const items = selection.items.filter((value) => value !== item);
		return normalizeGroupedSelection({ groups: selection.groups, items: checked ? [...items, item] : items }, catalog);
	}
	const siblings = itemsOf(catalog, group);
	if (selection.groups.includes(group)) {
		if (checked) return normalizeGroupedSelection(selection, catalog);
		return normalizeGroupedSelection(
			{
				groups: selection.groups.filter((value) => value !== group),
				items: [...selection.items, ...siblings.filter((value) => value !== item)],
			},
			catalog,
		);
	}
	const items = checked ? [...selection.items, item] : selection.items.filter((value) => value !== item);
	const complete = checked && siblings.every((value) => items.includes(value));
	return normalizeGroupedSelection(
		complete
			? { groups: [...selection.groups, group], items: items.filter((value) => !siblings.includes(value)) }
			: { groups: selection.groups, items },
		catalog,
	);
}

/** 已选节点，按目录顺序排列；不在目录里的分组和子项排在最后。筛选栏与标签据此展示。 */
export function groupedSelectionNodes(selection: GroupedSelection, catalog: GroupedCatalog): GroupedSelectionNode[] {
	const { groups, items } = normalizeGroupedSelection(selection, catalog);
	const nodes: GroupedSelectionNode[] = [];
	const seenGroups = new Set<string>();
	const seenItems = new Set<string>();
	for (const entry of catalog) {
		if (groups.includes(entry.group)) {
			nodes.push({ type: 'group', id: entry.group });
			seenGroups.add(entry.group);
			continue;
		}
		for (const item of entry.items) {
			if (!items.includes(item)) continue;
			nodes.push({ type: 'item', id: item });
			seenItems.add(item);
		}
	}
	for (const group of groups) if (!seenGroups.has(group)) nodes.push({ type: 'group', id: group });
	for (const item of items) if (!seenItems.has(item)) nodes.push({ type: 'item', id: item });
	return nodes;
}

function csv(raw: string | null | undefined): string[] {
	return unique((raw ?? '').split(','));
}

/** 从逗号分隔的查询参数读出选择。 */
export function parseGroupedSelection(groups: string | null | undefined, items: string | null | undefined): GroupedSelection {
	return { groups: csv(groups), items: csv(items) };
}
