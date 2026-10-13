/**
 * Provider 与内置官方模板（`provider-import-presets.json`）的差异计算与应用。
 *
 * 纯函数：只做结构化比对，不读库、不依赖运行时。比对对象只有两类，因为 `kind` 之外
 * 只有这两类是导入时「拷贝」入库的：
 * - `description`
 * - `endpoints`，以协议为单位（`endpoints.<protocol>`）
 *
 * 不比对：`name`（用户别名）、`api_key`、`status`；图标 / 链接 / 展示名由 `kind` 运行时解析，不会过期。
 */
import {
	parseProviderEndpoints,
	type ProtocolEndpointsConfig,
	type ProviderEndpointsMap,
	type ProviderEndpointsSource,
} from '@octafuse/core/provider-endpoints';
import { UPSTREAM_PROTOCOLS, type UpstreamProtocol } from '@octafuse/core/upstream-protocol';

/** `added`：官方有、本地没有；`changed`：两边都有但不同；`removed`：本地有、官方没有（多为用户自加）。 */
export type ProviderSyncStatus = 'added' | 'changed' | 'removed';

export type ProviderSyncFieldKey = 'description' | `endpoints.${UpstreamProtocol}`;

export type ProviderSyncDescriptionField = {
	key: 'description';
	status: ProviderSyncStatus;
	current: string | null;
	official: string | null;
	/** 默认是否勾选「采用官方」。官方没有而本地有（removed）默认保留。 */
	default_apply: boolean;
};

/** 端点差异的一行：`base`、`auth`，或一个 capability。 */
export type ProviderSyncEndpointRow = {
	/** `base` | `auth` | capability（如 `chat`、`images.generations`）。 */
	slot: string;
	status: ProviderSyncStatus;
	current: string | null;
	official: string | null;
};

export type ProviderSyncEndpointField = {
	key: `endpoints.${UpstreamProtocol}`;
	protocol: UpstreamProtocol;
	status: ProviderSyncStatus;
	rows: ProviderSyncEndpointRow[];
	default_apply: boolean;
};

export type ProviderSyncField = ProviderSyncDescriptionField | ProviderSyncEndpointField;

/** 参与比对的模板字段（`StaticProviderImportPresetRow` 的子集）。 */
export type ProviderSyncPresetInput = {
	description?: string | null;
	endpoints: ProviderEndpointsSource['endpoints'];
};

/** 参与比对的 provider 字段（`providers` 行的子集）。 */
export type ProviderSyncProviderInput = {
	description?: string | null;
	endpoints?: ProviderEndpointsSource['endpoints'];
};

function normalizeText(value: string | null | undefined): string | null {
	const trimmed = String(value ?? '').trim();
	return trimmed === '' ? null : trimmed;
}

function statusOf(current: string | null, official: string | null): ProviderSyncStatus | null {
	if (current === official) return null;
	if (current === null) return 'added';
	if (official === null) return 'removed';
	return 'changed';
}

function protocolRows(
	current: ProtocolEndpointsConfig | undefined,
	official: ProtocolEndpointsConfig | undefined
): ProviderSyncEndpointRow[] {
	const rows: ProviderSyncEndpointRow[] = [];
	const push = (slot: string, cur: string | null, off: string | null) => {
		const status = statusOf(cur, off);
		if (status) rows.push({ slot, status, current: cur, official: off });
	};
	push('base', current?.base ?? null, official?.base ?? null);
	push('auth', current?.auth ?? null, official?.auth ?? null);
	const capabilities = new Set<string>([
		...Object.keys(current?.endpoints ?? {}),
		...Object.keys(official?.endpoints ?? {}),
	]);
	for (const capability of [...capabilities].sort()) {
		const cur = (current?.endpoints as Record<string, string> | undefined)?.[capability] ?? null;
		const off = (official?.endpoints as Record<string, string> | undefined)?.[capability] ?? null;
		push(capability, cur, off);
	}
	return rows;
}

/** 协议整体状态：本地没有 → added；官方没有 → removed；否则 changed。 */
function protocolStatus(
	current: ProtocolEndpointsConfig | undefined,
	official: ProtocolEndpointsConfig | undefined
): ProviderSyncStatus {
	if (!current) return 'added';
	if (!official) return 'removed';
	return 'changed';
}

/** 逐字段比较 provider 与官方模板；无差异返回空数组。 */
export function diffProviderAgainstPreset(
	provider: ProviderSyncProviderInput,
	preset: ProviderSyncPresetInput
): ProviderSyncField[] {
	const fields: ProviderSyncField[] = [];

	const currentDescription = normalizeText(provider.description);
	const officialDescription = normalizeText(preset.description);
	const descriptionStatus = statusOf(currentDescription, officialDescription);
	if (descriptionStatus) {
		fields.push({
			key: 'description',
			status: descriptionStatus,
			current: currentDescription,
			official: officialDescription,
			default_apply: descriptionStatus !== 'removed',
		});
	}

	const currentMap = parseProviderEndpoints({ endpoints: provider.endpoints });
	const officialMap = parseProviderEndpoints({ endpoints: preset.endpoints });
	for (const protocol of UPSTREAM_PROTOCOLS) {
		const rows = protocolRows(currentMap[protocol], officialMap[protocol]);
		if (rows.length === 0) continue;
		const status = protocolStatus(currentMap[protocol], officialMap[protocol]);
		fields.push({
			key: `endpoints.${protocol}`,
			protocol,
			status,
			rows,
			default_apply: status !== 'removed',
		});
	}

	return fields;
}

export type ProviderSyncPatch = {
	description?: string | null;
	endpoints?: ProviderEndpointsMap;
};

/**
 * 根据选中的字段键生成 PATCH 内容。只处理当前确实存在差异的键（防止前端展示后模板又变化、
 * 或传入已一致的键）；未知键忽略。
 */
export function buildProviderSyncPatch(
	provider: ProviderSyncProviderInput,
	preset: ProviderSyncPresetInput,
	selectedKeys: readonly string[]
): ProviderSyncPatch {
	const selected = new Set(selectedKeys);
	const diffKeys = new Set<string>(diffProviderAgainstPreset(provider, preset).map((f) => f.key));
	const patch: ProviderSyncPatch = {};

	if (selected.has('description') && diffKeys.has('description')) {
		patch.description = normalizeText(preset.description);
	}

	const protocols = UPSTREAM_PROTOCOLS.filter((p) => selected.has(`endpoints.${p}`) && diffKeys.has(`endpoints.${p}`));
	if (protocols.length > 0) {
		const next: ProviderEndpointsMap = { ...parseProviderEndpoints({ endpoints: provider.endpoints }) };
		const officialMap = parseProviderEndpoints({ endpoints: preset.endpoints });
		for (const protocol of protocols) {
			const official = officialMap[protocol];
			if (official) next[protocol] = structuredClone(official);
			else delete next[protocol];
		}
		patch.endpoints = next;
	}

	return patch;
}

export function providerSyncFieldKeys(fields: readonly ProviderSyncField[]): ProviderSyncFieldKey[] {
	return fields.map((f) => f.key);
}

// ---------- 报告结构（`GET /admin/providers/sync/diff`） ----------

export type ProviderSyncProviderEntry = {
	provider_id: string;
	provider_name: string;
	status: 'active' | 'disabled';
	routes_count: number;
	active_routes_count: number;
	fields: ProviderSyncField[];
};

export type ProviderSyncKindGroup = {
	/** 模板英文名（`providers.kind`）。 */
	kind: string;
	label_en: string;
	label_zh: string;
	vendor_key: string;
	icon_key: string;
	providers: ProviderSyncProviderEntry[];
};

/** `kind` 已不在官方模板中（模板被改名或移除）。 */
export type ProviderSyncOrphanEntry = {
	provider_id: string;
	provider_name: string;
	kind: string;
	routes_count: number;
	/** 按 endpoint 签名猜测的新模板名；猜不到为 null。 */
	suggested_kind: string | null;
};

export type ProviderSyncKindChoice = {
	kind: string;
	label_en: string;
	label_zh: string;
	vendor_key: string;
	icon_key: string;
};

export type ProviderSyncReport = {
	groups: ProviderSyncKindGroup[];
	orphans: ProviderSyncOrphanEntry[];
	kind_choices: ProviderSyncKindChoice[];
	/** 有差异的 provider 总数（不含 orphans）。 */
	providers_with_diff: number;
};

export type ProviderSyncApplyBody = {
	items: Array<{ provider_id: string; fields: string[] }>;
};

export type ProviderSyncApplyOutput = {
	updated: number;
	/** 请求的字段在服务端重算后已无差异，或 provider 不再有对应模板。 */
	skipped: number;
	failed: Array<{ provider_id: string; message: string }>;
};
