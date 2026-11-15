/**
 * 请求日志的「类型」筛选。模型请求、REST 工具、MCP 工具共用 `api_key_request_logs`。
 *
 * 类型可多选，写在查询参数 `kinds` 里，逗号分隔，多项取并集；页面 URL 与 Admin API 用同一个参数：
 * - `model`：全部模型请求；`model:<kind>`：某类模型请求（`llm` / `image` / `tts` / `asr` / `embedding`，与列表的类型标签同一套规则）
 * - `tool`：全部 REST 工具；`tool:<id>`：某个 REST 工具，即日志的 `model_id`（如 `tool:web-search`）
 * - `mcp`：全部 MCP 工具；`mcp:<slug>`：某个 MCP 服务
 *
 * 不带 `kinds` 的旧链接（`provider_id=octafuse-tools`、`model_id=tool:*` 等）在读取时换算成类型。
 */
import { MODEL_KINDS } from '@octafuse/core/db/model-kind';
import { findGatewayToolById, GATEWAY_TOOLS, GATEWAY_TOOLS_PROVIDER_ID } from './gateway-tools';
import { MCP_REQUEST_LOG_PROVIDER_ID } from './invoke-kind';

export const REQUEST_LOG_KIND_ROOTS = ['model', 'tool', 'mcp'] as const;
export type RequestLogKindRoot = (typeof REQUEST_LOG_KIND_ROOTS)[number];

/** 筛选面板里「工具」一级节点：REST 工具与 MCP 工具的合集。只用于勾选状态，不出现在 `kinds` 里。 */
export const REQUEST_LOG_INVOCATION_NODE = 'invocation';

/** `kinds` 一次最多带多少项。 */
export const MAX_REQUEST_LOG_KINDS = 30;

/** 请求日志列表的 `model_ids` / `provider_ids` 一次最多带多少项。筛选面板里单独勾选的模型、供应商受它限制。 */
export const MAX_REQUEST_LOG_FILTER_IDS = 30;

const INVOCATION_PROVIDER_IDS = [GATEWAY_TOOLS_PROVIDER_ID, MCP_REQUEST_LOG_PROVIDER_ID] as const;
const MODEL_KIND_TERMS: string[] = MODEL_KINDS.map((kind) => `model:${kind}`);
const TOOL_TERM_ORDER: string[] = GATEWAY_TOOLS.map((tool) => tool.modelId);
const CHILD_PATTERN: Record<RequestLogKindRoot, RegExp> = {
	model: new RegExp(`^(?:${MODEL_KINDS.join('|')})$`),
	tool: /^[a-z0-9][a-z0-9._-]{0,63}$/,
	mcp: /^[a-z0-9][a-z0-9-]{0,39}$/,
};

function isRoot(value: string): value is RequestLogKindRoot {
	return (REQUEST_LOG_KIND_ROOTS as readonly string[]).includes(value);
}

/** 这一项属于哪一类；不是合法的类型项时返回 `null`。 */
export function requestLogKindRoot(term: string): RequestLogKindRoot | null {
	const split = term.indexOf(':');
	const root = split === -1 ? term : term.slice(0, split);
	if (!isRoot(root)) return null;
	if (split === -1) return root;
	return CHILD_PATTERN[root].test(term.slice(split + 1)) ? root : null;
}

/** MCP 日志的 `model_id` 是 `mcp:{slug}/{tool}`，按服务筛选即按这个前缀筛选。 */
export function mcpServerModelPrefix(slug: string): string {
	return `mcp:${slug}/`;
}

export function mcpServerKindTerm(slug: string): string {
	return `mcp:${slug}`;
}

function childOrder(root: RequestLogKindRoot, terms: string[]): string[] {
	const known = root === 'model' ? MODEL_KIND_TERMS : root === 'tool' ? TOOL_TERM_ORDER : [];
	return [...terms].sort((a, b) => {
		const ia = known.indexOf(a);
		const ib = known.indexOf(b);
		if (ia !== -1 || ib !== -1) return (ia === -1 ? known.length : ia) - (ib === -1 ? known.length : ib);
		return a < b ? -1 : a > b ? 1 : 0;
	});
}

/**
 * 去掉非法项与重复项，按固定顺序排列。选了整类就不再保留该类下的细项；
 * 五种模型类型选全等于全部模型请求（判断不出类型的请求算 `llm`）。
 */
export function normalizeRequestLogKinds(terms: readonly string[]): string[] {
	const out: string[] = [];
	for (const root of REQUEST_LOG_KIND_ROOTS) {
		const own = [...new Set(terms.map((term) => term.trim()).filter((term) => requestLogKindRoot(term) === root))];
		if (own.length === 0) continue;
		const children = own.filter((term) => term !== root);
		const all =
			own.includes(root) || (root === 'model' && MODEL_KIND_TERMS.every((term) => children.includes(term)));
		out.push(...(all ? [root] : childOrder(root, children)));
	}
	return out;
}

/** 解析 `kinds` 参数。`invalid` 是认不出的项，由调用方决定忽略（页面）还是拒绝（API）。 */
export function parseRequestLogKinds(raw: string | null | undefined): { kinds: string[]; invalid: string[] } {
	const terms = (raw ?? '').split(',').map((term) => term.trim()).filter((term) => term !== '');
	return {
		kinds: normalizeRequestLogKinds(terms),
		invalid: terms.filter((term) => requestLogKindRoot(term) === null),
	};
}

/** 三类都整类选中，等于不筛选。 */
function coversEveryKind(kinds: readonly string[]): boolean {
	return REQUEST_LOG_KIND_ROOTS.every((root) => kinds.includes(root));
}

/** 写进 URL / API 的值。不限类型（没选或全选）时返回空串，调用方据此省略参数。 */
export function serializeRequestLogKinds(kinds: readonly string[]): string {
	const normalized = normalizeRequestLogKinds(kinds);
	return coversEveryKind(normalized) ? '' : normalized.join(',');
}

/** 当前范围里有没有模型请求、有没有工具调用。没选类型时两者都有。 */
export function requestLogKindScope(kinds: readonly string[]): { model: boolean; invocation: boolean } {
	const roots = new Set(kinds.map(requestLogKindRoot));
	if (!roots.has('model') && !roots.has('tool') && !roots.has('mcp')) return { model: true, invocation: true };
	return { model: roots.has('model'), invocation: roots.has('tool') || roots.has('mcp') };
}

/**
 * 只选了模型细类时返回这些模型类型，供模型下拉框收窄选项；否则返回 `null`（不收窄）。
 */
export function selectedModelKinds(kinds: readonly string[]): string[] | null {
	const picked = kinds.filter((term) => term.startsWith('model:')).map((term) => term.slice('model:'.length));
	return picked.length > 0 && !kinds.includes('model') ? picked : null;
}

/**
 * 筛选栏与标签上要展示的已选节点。REST 工具与 MCP 工具都整类选中时合成「工具」一个节点；
 * 不限类型（没选或三类全选）时为空。
 */
export function requestLogKindDisplayNodes(kinds: readonly string[]): string[] {
	const normalized = normalizeRequestLogKinds(kinds);
	if (coversEveryKind(normalized)) return [];
	if (!normalized.includes('tool') || !normalized.includes('mcp')) return normalized;
	return [...normalized.filter((term) => term !== 'tool' && term !== 'mcp'), REQUEST_LOG_INVOCATION_NODE];
}

/** `model_id` 是不是工具调用的标识（`tool:*` / `mcp:{slug}/{tool}`），而不是目录里的模型。 */
export function isInvocationModelId(modelId: string): boolean {
	return modelId.startsWith('tool:') || modelId.startsWith('mcp:');
}

/**
 * 已选的 `model_id` 筛选在新的类型范围里还有没有意义。类型变化后不再适用的要清掉，
 * 否则两者按 AND 组合后一条也查不到。`catalogKind` 是目录模型的类型，目录里没有的按 `llm` 算。
 */
export function modelFilterFitsKinds(modelId: string, kinds: readonly string[], catalogKind?: string): boolean {
	if (modelId === '' || kinds.length === 0) return true;
	if (modelId.startsWith('tool:')) return kinds.includes('tool') || kinds.includes(modelId);
	if (modelId.startsWith('mcp:')) {
		const slug = /^mcp:([^/]+)/.exec(modelId)?.[1] ?? '';
		return kinds.includes('mcp') || kinds.includes(mcpServerKindTerm(slug));
	}
	if (!requestLogKindScope(kinds).model) return false;
	const narrowed = selectedModelKinds(kinds);
	return narrowed === null || narrowed.includes(catalogKind ?? 'llm');
}

/** 每一类下可勾选的细项（`model:image`、`tool:web-search`、`mcp:docs` …），由筛选面板提供。 */
export type RequestLogKindChildren = Record<RequestLogKindRoot, readonly string[]>;
export type RequestLogKindCheckState = 'checked' | 'mixed' | 'unchecked';

/**
 * 细项选全是否等于选了整类。模型类型与 REST 工具是固定的几项，选全即整类；
 * MCP 服务会增删，日志里还留着已删除服务的调用，把现有服务选全并不等于「全部 MCP 工具」。
 */
function childrenCoverRoot(root: RequestLogKindRoot, own: readonly string[], children: RequestLogKindChildren): boolean {
	return root !== 'mcp' && children[root].length > 0 && children[root].every((term) => own.includes(term));
}

function rootState(kinds: readonly string[], root: RequestLogKindRoot, children: RequestLogKindChildren): RequestLogKindCheckState {
	if (kinds.includes(root)) return 'checked';
	const own = kinds.filter((term) => term !== root && requestLogKindRoot(term) === root);
	if (own.length === 0) return 'unchecked';
	return childrenCoverRoot(root, own, children) ? 'checked' : 'mixed';
}

/** 筛选面板里某个节点的勾选状态。`node` 是类型项或「工具」一级节点。 */
export function requestLogKindState(
	kinds: readonly string[],
	node: string,
	children: RequestLogKindChildren,
): RequestLogKindCheckState {
	if (node === REQUEST_LOG_INVOCATION_NODE) {
		const states = [rootState(kinds, 'tool', children), rootState(kinds, 'mcp', children)];
		if (states.every((state) => state === 'checked')) return 'checked';
		return states.every((state) => state === 'unchecked') ? 'unchecked' : 'mixed';
	}
	if (isRoot(node)) return rootState(kinds, node, children);
	const root = requestLogKindRoot(node);
	return root && (kinds.includes(root) || kinds.includes(node)) ? 'checked' : 'unchecked';
}

/**
 * 勾选或取消一个节点后的类型列表。
 * 勾上模型类型或 REST 工具的最后一个细项时收拢成整类；在整类选中的情况下取消一个细项，改为保留其余细项。
 */
export function toggleRequestLogKind(
	kinds: readonly string[],
	node: string,
	checked: boolean,
	children: RequestLogKindChildren,
): string[] {
	if (node === REQUEST_LOG_INVOCATION_NODE) {
		return toggleRequestLogKind(toggleRequestLogKind(kinds, 'tool', checked, children), 'mcp', checked, children);
	}
	const root = requestLogKindRoot(node);
	if (!root) return normalizeRequestLogKinds(kinds);
	const others = kinds.filter((term) => requestLogKindRoot(term) !== root);
	const own = kinds.filter((term) => term !== root && requestLogKindRoot(term) === root);
	if (node === root) return normalizeRequestLogKinds(checked ? [...others, root] : others);
	const before = kinds.includes(root) ? [...children[root]] : own;
	const after = checked ? [...before, node] : before.filter((term) => term !== node);
	const complete = checked && childrenCoverRoot(root, after, children);
	return normalizeRequestLogKinds([...others, ...(complete ? [root] : after)]);
}

function idList(raw: string | null): string[] {
	return (raw ?? '').split(',').map((value) => value.trim()).filter((value) => value !== '');
}

function isInvocationProviderSet(ids: string[]): boolean {
	return ids.length === INVOCATION_PROVIDER_IDS.length && INVOCATION_PROVIDER_IDS.every((id) => ids.includes(id));
}

export type AbsorbedLogParam = 'provider_id' | 'provider_ids' | 'model_id' | 'model_id_prefix';

/**
 * 从查询参数读出类型。有 `kinds` 就用它；没有时把旧的 provider / model 参数换算成类型。
 * `absorbed` 是已经由类型表达、不必再作为独立筛选保留的旧参数。
 * 指向具体 MCP 工具的 `model_id=mcp:{slug}/{tool}` 不吸收：类型只到服务一级，具体工具仍按 `model_id` 筛。
 */
export function readRequestLogKinds(params: URLSearchParams): { kinds: string[]; absorbed: AbsorbedLogParam[] } {
	if (params.has('kinds')) return { kinds: parseRequestLogKinds(params.get('kinds')).kinds, absorbed: [] };

	const provider = params.get('provider_id')?.trim() ?? '';
	const model = params.get('model_id')?.trim() ?? '';
	const prefix = params.get('model_id_prefix')?.trim() ?? '';
	const absorbed: AbsorbedLogParam[] = [];
	if (provider !== '' && provider !== GATEWAY_TOOLS_PROVIDER_ID && provider !== MCP_REQUEST_LOG_PROVIDER_ID) {
		return { kinds: [], absorbed };
	}
	if (provider !== '') absorbed.push('provider_id');
	const allowTool = provider !== MCP_REQUEST_LOG_PROVIDER_ID;
	const allowMcp = provider !== GATEWAY_TOOLS_PROVIDER_ID;

	let kinds: string[] = [];
	const mcpSlug = /^mcp:([^/]+)\//.exec(model)?.[1] ?? /^mcp:([^/]+)\/$/.exec(prefix)?.[1];
	if (allowTool && model.startsWith('tool:')) {
		if (requestLogKindRoot(model) === 'tool') {
			kinds = [model];
			absorbed.push('model_id');
		} else {
			kinds = ['tool'];
		}
	} else if (allowMcp && mcpSlug !== undefined && requestLogKindRoot(mcpServerKindTerm(mcpSlug)) === 'mcp') {
		kinds = [mcpServerKindTerm(mcpSlug)];
		if (prefix === mcpServerModelPrefix(mcpSlug)) absorbed.push('model_id_prefix');
	} else if (allowMcp && (model.startsWith('mcp:') || prefix.startsWith('mcp:'))) {
		kinds = ['mcp'];
		if (prefix === 'mcp:') absorbed.push('model_id_prefix');
	} else if (allowTool && prefix.startsWith('tool:')) {
		kinds = ['tool'];
		if (prefix === 'tool:') absorbed.push('model_id_prefix');
	} else if (provider === GATEWAY_TOOLS_PROVIDER_ID) {
		kinds = ['tool'];
	} else if (provider === MCP_REQUEST_LOG_PROVIDER_ID) {
		kinds = ['mcp'];
	}

	if (provider === '' && isInvocationProviderSet(idList(params.get('provider_ids')))) {
		absorbed.push('provider_ids');
		if (kinds.length === 0) kinds = ['tool', 'mcp'];
	}
	return { kinds, absorbed };
}

export type InvocationLogScope = {
	/** 不传表示 REST 与 MCP 都看。 */
	source?: 'rest' | 'mcp' | '';
	/** REST 工具 id 或 `tool:*` 的 `model_id`。 */
	tool?: string | null;
	/** MCP 服务 slug。 */
	server?: string | null;
};

/** 工具调用在请求日志里的查询范围。REST 工具页、MCP 服务页、模拟器和旧地址跳转共用。 */
export function invocationLogQuery(scope: InvocationLogScope = {}): URLSearchParams {
	const source = scope.source ?? '';
	const tool = source !== 'mcp' ? findGatewayToolById(scope.tool) : undefined;
	const server = source === 'mcp' ? scope.server?.trim() ?? '' : '';
	const kinds =
		source === 'mcp'
			? [server && requestLogKindRoot(mcpServerKindTerm(server)) ? mcpServerKindTerm(server) : 'mcp']
			: tool
				? [tool.modelId]
				: source === 'rest'
					? ['tool']
					: ['tool', 'mcp'];
	return new URLSearchParams({ kinds: kinds.join(',') });
}

export function invocationLogsHref(scope: InvocationLogScope = {}): string {
	return `/gateway/request-logs?${invocationLogQuery(scope)}`;
}

type LegacySearchParams = Record<string, string | string[] | undefined>;

/** 旧「调用记录」页（`/gateway/tools/invocations`）的书签转到请求日志的等价筛选。 */
export function legacyInvocationsHref(searchParams: LegacySearchParams): string {
	const first = (key: string): string | undefined => {
		const value = searchParams[key];
		return Array.isArray(value) ? value[0] : value;
	};
	const source = first('source');
	const query = invocationLogQuery({
		source: source === 'rest' || source === 'mcp' ? source : '',
		tool: first('tool'),
		server: first('server'),
	});
	const status = first('status');
	if (status) query.set('status', status);
	// 时间边界允许显式留空（不限），所以按「是否出现」而不是「是否有值」透传。
	for (const key of ['start_date', 'end_date'] as const) {
		const value = first(key);
		if (value !== undefined) query.set(key, value);
	}
	const page = Number(first('page'));
	if (Number.isSafeInteger(page) && page > 1) query.set('page', String(page));
	return `/gateway/request-logs?${query}`;
}
