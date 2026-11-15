'use client';

/**
 * 带勾选框的树形多选下拉面板。只管展示与交互：节点、勾选状态、勾选后的结果都由调用方给。
 * 请求日志的「类型」「模型」「供应商」筛选共用它。
 */
import { ChevronDownIcon, ChevronRightIcon, MagnifyingGlassIcon } from '@heroicons/react/24/outline';
import { useEffect, useId, useMemo, useRef, useState } from 'react';

export type TreeFilterNode = {
	id: string;
	label: string;
	/** 跟在名称后面的灰色小字，例如说明或子项个数。 */
	hint?: string;
	/** 鼠标悬停时显示的完整信息。 */
	title?: string;
	/** 除名称外还参与搜索的文字，例如 id。 */
	keywords?: string;
	children?: TreeFilterNode[];
	/** 子项下方的说明，例如列表还在加载。 */
	note?: string;
};

export type TreeFilterCheckState = 'checked' | 'mixed' | 'unchecked';

const PANEL_WIDTH_PX = 320;

/** 名称、说明或关键字包含搜索词的节点。上级命中时保留它的全部子项，否则只留命中的子项。 */
function filterNodes(nodes: TreeFilterNode[], query: string): TreeFilterNode[] {
	if (query === '') return nodes;
	const out: TreeFilterNode[] = [];
	for (const node of nodes) {
		if (`${node.label} ${node.hint ?? ''} ${node.keywords ?? ''}`.toLowerCase().includes(query)) {
			out.push(node);
			continue;
		}
		const children = node.children ? filterNodes(node.children, query) : [];
		if (children.length > 0) out.push({ ...node, children });
	}
	return out;
}

export function TreeFilterPicker({
	label,
	emptyLabel,
	selectedLabels,
	nodes,
	stateOf,
	onToggle,
	onClear,
	clearLabel,
	hint,
	search,
	collapsible = false,
	disabled = false,
	title,
	onOpen,
	className = '',
}: {
	/** 筛选项标题，显示在按钮上方。 */
	label: string;
	/** 什么都没选时按钮上的文字。 */
	emptyLabel: string;
	/** 已选节点的名称。按钮显示第一个，其余用 `+N` 表示。 */
	selectedLabels: readonly string[];
	nodes: TreeFilterNode[];
	stateOf: (id: string) => TreeFilterCheckState;
	onToggle: (id: string, checked: boolean) => void;
	onClear: () => void;
	clearLabel: string;
	hint: string;
	/** 给了就在面板顶部显示搜索框。 */
	search?: { placeholder: string; empty: string };
	/** 一级节点默认收起，点箭头展开；适合子项很多的树。 */
	collapsible?: boolean;
	disabled?: boolean;
	/** 按钮的悬停说明，例如为什么不可用。不给时，选了多项会列出全部已选名称。 */
	title?: string;
	/** 每次打开面板时调用，用来按需加载数据。 */
	onOpen?: () => void;
	className?: string;
}) {
	const [open, setOpen] = useState(false);
	const [alignRight, setAlignRight] = useState(false);
	const [query, setQuery] = useState('');
	const [expanded, setExpanded] = useState<ReadonlySet<string>>(new Set());
	const rootRef = useRef<HTMLDivElement>(null);
	const labelId = useId();
	const valueId = useId();
	const panelId = useId();
	const shown = open && !disabled;

	useEffect(() => {
		if (!shown) return;
		const onPointer = (event: MouseEvent) => {
			if (!rootRef.current?.contains(event.target as Node)) setOpen(false);
		};
		const onKey = (event: KeyboardEvent) => {
			if (event.key === 'Escape') setOpen(false);
		};
		document.addEventListener('mousedown', onPointer);
		document.addEventListener('keydown', onKey);
		return () => {
			document.removeEventListener('mousedown', onPointer);
			document.removeEventListener('keydown', onKey);
		};
	}, [shown]);

	const needle = query.trim().toLowerCase();
	const visible = useMemo(() => filterNodes(nodes, needle), [nodes, needle]);

	const toggleOpen = () => {
		if (open) {
			setOpen(false);
			return;
		}
		onOpen?.();
		setQuery('');
		// 只选了一部分子项的分组直接展开，打开就能看到选了什么。
		setExpanded(new Set(nodes.filter((node) => node.children?.length && stateOf(node.id) === 'mixed').map((node) => node.id)));
		const left = rootRef.current?.getBoundingClientRect().left ?? 0;
		setAlignRight(left + PANEL_WIDTH_PX > window.innerWidth - 16);
		setOpen(true);
	};

	const renderNode = (node: TreeFilterNode, depth: number) => {
		const state = stateOf(node.id);
		const foldable = collapsible && depth === 0 && Boolean(node.children?.length);
		const unfolded = !foldable || needle !== '' || expanded.has(node.id);
		const indent = collapsible
			? depth === 0
				? 'pl-2'
				: 'pl-[3.25rem]'
			: ['pl-3', 'pl-9', 'pl-[3.75rem]'][Math.min(depth, 2)];
		return (
			<div key={node.id}>
				<div className={`flex items-start pr-3 hover:bg-gray-50 ${indent}`}>
					{collapsible && depth === 0 ? (
						foldable ? (
							<button
								type="button"
								aria-label={node.label}
								aria-expanded={unfolded}
								disabled={needle !== ''}
								onClick={() =>
									setExpanded((prev) => {
										const next = new Set(prev);
										if (next.has(node.id)) next.delete(node.id);
										else next.add(node.id);
										return next;
									})
								}
								className="mt-1 flex h-6 w-6 shrink-0 items-center justify-center rounded text-gray-400 hover:text-gray-700"
							>
								<ChevronRightIcon
									className={`h-3.5 w-3.5 transition-transform ${unfolded ? 'rotate-90' : ''}`}
									aria-hidden
								/>
							</button>
						) : (
							<span className="w-6 shrink-0" aria-hidden />
						)
					) : null}
					<label className="flex min-w-0 flex-1 cursor-pointer items-start gap-2 py-1.5 text-sm" title={node.title}>
						<input
							type="checkbox"
							checked={state === 'checked'}
							ref={(element) => {
								if (element) element.indeterminate = state === 'mixed';
							}}
							onChange={() => onToggle(node.id, state !== 'checked')}
							className="mt-0.5 h-4 w-4 shrink-0 rounded border-gray-300"
						/>
						<span className="min-w-0 break-words">
							<span className={depth === 0 ? 'font-medium text-gray-900' : 'text-gray-700'}>{node.label}</span>
							{node.hint ? <span className="ml-1.5 text-xs text-gray-400">{node.hint}</span> : null}
						</span>
					</label>
				</div>
				{unfolded ? node.children?.map((child) => renderNode(child, depth + 1)) : null}
				{unfolded && node.note ? (
					<p className={`py-1 pr-3 text-xs text-gray-400 ${collapsible ? 'pl-[3.25rem]' : depth === 0 ? 'pl-9' : 'pl-[3.75rem]'}`}>
						{node.note}
					</p>
				) : null}
			</div>
		);
	};

	return (
		<div ref={rootRef} className={`block min-w-0 space-y-2 text-xs text-gray-500 ${className}`}>
			<span id={labelId} className="block">
				{label}
			</span>
			<div className="relative">
				<button
					type="button"
					aria-labelledby={`${labelId} ${valueId}`}
					aria-haspopup="true"
					aria-expanded={shown}
					aria-controls={shown ? panelId : undefined}
					disabled={disabled}
					title={title ?? (selectedLabels.length > 1 ? selectedLabels.join(' · ') : undefined)}
					onClick={toggleOpen}
					className="flex h-10 w-full min-w-0 items-center gap-2 rounded-lg border border-gray-200 bg-white px-3 text-left text-sm text-gray-600 disabled:cursor-not-allowed disabled:bg-gray-50 disabled:text-gray-400"
				>
					<span id={valueId} className="min-w-0 flex-1 truncate">
						{selectedLabels[0] ?? emptyLabel}
					</span>
					{selectedLabels.length > 1 ? (
						<span className="shrink-0 rounded bg-gray-100 px-1.5 py-0.5 text-xs tabular-nums text-gray-600">
							+{selectedLabels.length - 1}
						</span>
					) : null}
					<ChevronDownIcon
						className={`h-4 w-4 shrink-0 text-gray-400 transition-transform ${shown ? 'rotate-180' : ''}`}
						aria-hidden
					/>
				</button>
				{shown ? (
					<div
						id={panelId}
						role="group"
						aria-labelledby={labelId}
						style={{ width: PANEL_WIDTH_PX }}
						className={`absolute top-full z-40 mt-1 max-w-[calc(100vw-2rem)] rounded-lg border border-gray-200 bg-white shadow-lg ${alignRight ? 'right-0' : 'left-0'}`}
					>
						{search ? (
							<div className="relative border-b border-gray-100 p-2">
								<MagnifyingGlassIcon
									className="pointer-events-none absolute left-4 top-1/2 h-4 w-4 -translate-y-1/2 text-gray-400"
									aria-hidden
								/>
								<input
									type="search"
									autoFocus
									value={query}
									onChange={(event) => setQuery(event.target.value)}
									placeholder={search.placeholder}
									aria-label={search.placeholder}
									className="h-8 w-full rounded-md border border-gray-200 bg-white pl-8 pr-2 text-sm text-gray-900"
								/>
							</div>
						) : null}
						<div className="max-h-[min(32rem,60vh)] overflow-y-auto py-1">
							{visible.map((node) => renderNode(node, 0))}
							{search && visible.length === 0 ? (
								<p className="px-3 py-6 text-center text-xs text-gray-400">{search.empty}</p>
							) : null}
						</div>
						<div className="flex items-center justify-between gap-3 border-t border-gray-100 px-3 py-2 text-xs text-gray-500">
							<span className="min-w-0">{hint}</span>
							<button
								type="button"
								disabled={selectedLabels.length === 0}
								onClick={onClear}
								className="shrink-0 text-gray-700 hover:text-gray-950 disabled:cursor-default disabled:text-gray-300"
							>
								{clearLabel}
							</button>
						</div>
					</div>
				) : null}
			</div>
		</div>
	);
}
