/**
 * 把请求日志的类型项（`kinds`，见 `lib/request-log-kind.ts`）换算成仓储的「任一组命中」条件。
 * 模型类型不落库，由仓储按日志的计费类型、操作名推断，推断不出时查这里传下去的模型目录，
 * 规则与列表的类型标签相同（core `requestLogModelKindCase`）。
 */
import type { ModelKind } from '@octafuse/core/db/model-kind';
import type { RequestLogMatchGroup, RequestLogModelKindCatalog } from '@octafuse/core/db/request-log-filters';
import { GATEWAY_TOOLS_PROVIDER_ID } from '@/lib/gateway-tools';
import { MCP_REQUEST_LOG_PROVIDER_ID } from '@/lib/invoke-kind';
import { mcpServerModelPrefix, normalizeRequestLogKinds, serializeRequestLogKinds } from '@/lib/request-log-kind';

const INVOCATION_PROVIDER_IDS = [GATEWAY_TOOLS_PROVIDER_ID, MCP_REQUEST_LOG_PROVIDER_ID];

export function requestLogKindsNeedCatalog(kinds: readonly string[]): boolean {
	return kinds.some((term) => term.startsWith('model:'));
}

/** 返回 `undefined` 表示不限类型。 */
export function requestLogKindMatchGroups(
	kinds: readonly string[],
	catalog: readonly { id: string; kind: ModelKind }[],
): RequestLogMatchGroup[] | undefined {
	if (serializeRequestLogKinds(kinds) === '') return undefined;
	const terms = normalizeRequestLogKinds(kinds);
	const groups: RequestLogMatchGroup[] = [];

	const modelKinds = terms.filter((term) => term.startsWith('model:')).map((term) => term.slice('model:'.length));
	if (terms.includes('model')) {
		groups.push({ excludeProviderIds: INVOCATION_PROVIDER_IDS });
	} else if (modelKinds.length > 0) {
		const byKind: RequestLogModelKindCatalog = {};
		for (const model of catalog) {
			if (model.kind !== 'llm') (byKind[model.kind] ??= []).push(model.id);
		}
		groups.push({ excludeProviderIds: INVOCATION_PROVIDER_IDS, modelKinds: { kinds: modelKinds, catalog: byKind } });
	}

	if (terms.includes('tool')) {
		groups.push({ providerIds: [GATEWAY_TOOLS_PROVIDER_ID] });
	} else {
		const toolModelIds = terms.filter((term) => term.startsWith('tool:'));
		if (toolModelIds.length > 0) groups.push({ providerIds: [GATEWAY_TOOLS_PROVIDER_ID], modelIds: toolModelIds });
	}

	if (terms.includes('mcp')) {
		groups.push({ providerIds: [MCP_REQUEST_LOG_PROVIDER_ID] });
	} else {
		for (const term of terms.filter((item) => item.startsWith('mcp:'))) {
			groups.push({
				providerIds: [MCP_REQUEST_LOG_PROVIDER_ID],
				modelIdPrefix: mcpServerModelPrefix(term.slice('mcp:'.length)),
			});
		}
	}
	return groups;
}
