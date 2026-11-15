'use client';

/**
 * 两级多选筛选：一级是分组，二级是具体项，例如「模型厂商 → 模型」「供应商类型 → 供应商」。
 * 勾选分组即包含它的全部子项；勾选的项取并集，什么都不勾表示不限。选择状态见 `lib/grouped-selection.ts`。
 */
import { useMemo } from 'react';
import {
	EMPTY_GROUPED_SELECTION,
	groupedGroupState,
	groupedItemState,
	groupedSelectionNodes,
	toggleGroupedGroup,
	toggleGroupedItem,
	type GroupedCatalog,
	type GroupedSelection,
	type GroupedSelectionNode,
} from '@/lib/grouped-selection';
import { TreeFilterPicker, type TreeFilterNode } from './tree-filter-picker';

export type GroupedFilterGroup = {
	id: string;
	label: string;
	items: { id: string; label: string; title?: string }[];
};

const GROUP_PREFIX = 'group:';
const ITEM_PREFIX = 'item:';

export function groupedFilterCatalog(groups: readonly GroupedFilterGroup[]): GroupedCatalog {
	return groups.map((group) => ({ group: group.id, items: group.items.map((item) => item.id) }));
}

/** 已选节点的显示名。不在目录里的分组或子项用 `staleLabel` 包一层。 */
export function groupedFilterLabeler(
	groups: readonly GroupedFilterGroup[],
	staleLabel: (value: string) => string,
): (node: GroupedSelectionNode) => string {
	const groupLabels = new Map(groups.map((group) => [group.id, group.label]));
	const itemLabels = new Map(groups.flatMap((group) => group.items.map((item) => [item.id, item.label] as const)));
	return (node) => (node.type === 'group' ? groupLabels : itemLabels).get(node.id) ?? staleLabel(node.id);
}

export function GroupedFilterPicker({
	label,
	emptyLabel,
	clearLabel,
	hint,
	search,
	groups,
	value,
	onChange,
	staleLabel,
	disabled,
	title,
	className,
}: {
	label: string;
	emptyLabel: string;
	clearLabel: string;
	hint: string;
	search: { placeholder: string; empty: string };
	groups: readonly GroupedFilterGroup[];
	value: GroupedSelection;
	onChange: (next: GroupedSelection) => void;
	/** 已选但不在目录里的分组或子项的显示名。 */
	staleLabel: (value: string) => string;
	disabled?: boolean;
	title?: string;
	className?: string;
}) {
	const catalog = useMemo(() => groupedFilterCatalog(groups), [groups]);
	const selected = useMemo(() => groupedSelectionNodes(value, catalog), [value, catalog]);
	const labelOf = useMemo(() => groupedFilterLabeler(groups, staleLabel), [groups, staleLabel]);

	// 已选但不在目录里的分组和子项列在最后，这样总能看到并取消它。
	const nodes = useMemo(() => {
		const known = new Set(catalog.flatMap((entry) => entry.items));
		const tree: TreeFilterNode[] = groups.map((group) => ({
			id: `${GROUP_PREFIX}${group.id}`,
			label: group.label,
			hint: String(group.items.length),
			children: group.items.map((item) => ({
				id: `${ITEM_PREFIX}${item.id}`,
				label: item.label,
				title: item.title,
				keywords: item.id,
			})),
		}));
		for (const group of value.groups) {
			if (!catalog.some((entry) => entry.group === group)) {
				tree.push({ id: `${GROUP_PREFIX}${group}`, label: staleLabel(group) });
			}
		}
		for (const item of value.items) {
			if (!known.has(item)) tree.push({ id: `${ITEM_PREFIX}${item}`, label: staleLabel(item) });
		}
		return tree;
	}, [groups, catalog, value, staleLabel]);

	return (
		<TreeFilterPicker
			className={className}
			label={label}
			emptyLabel={emptyLabel}
			selectedLabels={selected.map(labelOf)}
			nodes={nodes}
			stateOf={(id) =>
				id.startsWith(GROUP_PREFIX)
					? groupedGroupState(value, id.slice(GROUP_PREFIX.length), catalog)
					: groupedItemState(value, id.slice(ITEM_PREFIX.length), catalog)
			}
			onToggle={(id, checked) =>
				onChange(
					id.startsWith(GROUP_PREFIX)
						? toggleGroupedGroup(value, id.slice(GROUP_PREFIX.length), checked, catalog)
						: toggleGroupedItem(value, id.slice(ITEM_PREFIX.length), checked, catalog),
				)
			}
			onClear={() => onChange(EMPTY_GROUPED_SELECTION)}
			clearLabel={clearLabel}
			hint={hint}
			search={search}
			collapsible
			disabled={disabled}
			title={title}
		/>
	);
}
