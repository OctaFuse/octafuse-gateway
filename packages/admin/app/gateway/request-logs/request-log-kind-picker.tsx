'use client';

/**
 * 请求日志「类型」筛选：两级分类的多选面板。
 * 模型 → 模型类型；工具 → REST 工具（各工具）与 MCP 工具（各服务）。勾选的项取并集，什么都不勾表示不限类型。
 * 类型项的含义与换算见 `lib/request-log-kind.ts`。
 */
import { MODEL_KINDS } from '@octafuse/core/db/model-kind';
import { useTranslations } from 'next-intl';
import { useMemo } from 'react';
import { TreeFilterPicker, type TreeFilterNode } from '@/components/tree-filter-picker';
import { GATEWAY_TOOLS } from '@/lib/gateway-tools';
import {
	mcpServerKindTerm,
	REQUEST_LOG_INVOCATION_NODE,
	requestLogKindDisplayNodes,
	requestLogKindState,
	toggleRequestLogKind,
	type RequestLogKindChildren,
} from '@/lib/request-log-kind';

/** 节点 id 是类型项，或「工具」一级节点。 */
export type RequestLogKindNode = TreeFilterNode;

export type RequestLogKindTree = {
	nodes: RequestLogKindNode[];
	children: RequestLogKindChildren;
	labelOf: (id: string) => string;
};

/**
 * 类型树与各节点的显示名。已选但不在当前目录里的工具或 MCP 服务（已删除、或链接带来的）也列出来，
 * 这样总能看到并取消它。`mcpServers` 为 `null` 表示还没取到。
 */
export function useRequestLogKindTree(
	selected: readonly string[],
	mcpServers: { slug: string; name: string }[] | null,
): RequestLogKindTree {
	const t = useTranslations('requestLogs');
	const tToolCatalog = useTranslations('tools.catalog');

	return useMemo(() => {
		const stale = (value: string) => t('ui.notInCatalog', { value });
		const modelNodes: RequestLogKindNode[] = MODEL_KINDS.map((kind) => ({
			id: `model:${kind}`,
			label: t(`tags.kind.${kind}`),
			hint: t(`titles.tag.${kind}`),
		}));

		const toolNodes: RequestLogKindNode[] = GATEWAY_TOOLS.map((tool) => ({
			id: tool.modelId,
			label: tToolCatalog(tool.nameKey),
		}));
		for (const term of selected) {
			if (term.startsWith('tool:') && !toolNodes.some((node) => node.id === term)) {
				toolNodes.push({ id: term, label: stale(term.slice('tool:'.length)) });
			}
		}

		const serverNodes: RequestLogKindNode[] = (mcpServers ?? []).map((server) => ({
			id: mcpServerKindTerm(server.slug),
			label: server.name && server.name !== server.slug ? server.name : server.slug,
			hint: server.name && server.name !== server.slug ? server.slug : undefined,
		}));
		for (const term of selected) {
			if (term.startsWith('mcp:') && !serverNodes.some((node) => node.id === term)) {
				const slug = term.slice('mcp:'.length);
				// 列表还没取到时先显示 slug，取到后仍找不到才提示已不在目录中。
				serverNodes.push({ id: term, label: mcpServers ? stale(slug) : slug });
			}
		}

		const nodes: RequestLogKindNode[] = [
			{ id: 'model', label: t('kindFilter.model'), children: modelNodes },
			{
				id: REQUEST_LOG_INVOCATION_NODE,
				label: t('kindFilter.invocation'),
				children: [
					{ id: 'tool', label: t('kindFilter.tool'), children: toolNodes },
					{
						id: 'mcp',
						label: t('kindFilter.mcp'),
						children: serverNodes,
						note:
							mcpServers === null
								? t('kindFilter.serversLoading')
								: mcpServers.length === 0
									? t('kindFilter.noServers')
									: undefined,
					},
				],
			},
		];

		const labels = new Map<string, string>();
		const collect = (list: RequestLogKindNode[]) => {
			for (const node of list) {
				labels.set(node.id, node.label);
				if (node.children) collect(node.children);
			}
		};
		collect(nodes);

		return {
			nodes,
			children: {
				model: modelNodes.map((node) => node.id),
				tool: toolNodes.map((node) => node.id),
				mcp: serverNodes.map((node) => node.id),
			},
			labelOf: (id: string) => labels.get(id) ?? id,
		};
	}, [selected, mcpServers, t, tToolCatalog]);
}

export function RequestLogKindPicker({
	value,
	tree,
	onChange,
	onOpen,
	className = '',
}: {
	value: readonly string[];
	tree: RequestLogKindTree;
	onChange: (kinds: string[]) => void;
	/** 打开面板时调用，用来按需加载 MCP 服务。 */
	onOpen?: () => void;
	className?: string;
}) {
	const t = useTranslations('requestLogs.kindFilter');
	return (
		<TreeFilterPicker
			className={className}
			label={t('label')}
			emptyLabel={t('all')}
			selectedLabels={requestLogKindDisplayNodes(value).map(tree.labelOf)}
			nodes={tree.nodes}
			stateOf={(id) => requestLogKindState(value, id, tree.children)}
			onToggle={(id, checked) => onChange(toggleRequestLogKind(value, id, checked, tree.children))}
			onClear={() => onChange([])}
			clearLabel={t('clear')}
			hint={t('hint')}
			onOpen={onOpen}
		/>
	);
}
