/**
 * Provider 与内置官方模板（`provider-import-presets.json`）的差异计算与应用。
 *
 * 纯函数：只做结构化比对，不读库、不依赖运行时。
 * 比对 `endpoints`，以协议为单位（`endpoints.<protocol>`）。
 * 类型介绍由 `kind` 运行时解析，不入库。`note` 是运营备注，不参与比对。
 *
 * 不比对：`name`（用户别名）、`api_key`、`status`；图标 / 链接 / 展示名由 `kind` 运行时解析，不会过期。
 *
 * 模板里的部署占位符填好之后视为与官方一致，不进入差异：
 * - `YOUR_PROJECT_ID`（Vertex 项目）
 * - `YOUR_RESOURCE_NAME`（Azure OpenAI 资源名；`openai.azure.com` 与 Foundry 的 `services.ai.azure.com` 视为同一模板）
 * - Vertex 模板中的 `locations/global`（改成具体区域也算已对齐）
 * 官方路径本身变化时仍报差异；采用官方时会把当前已填写的项目、资源名和区域写回新 URL。
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

export type ProviderSyncFieldKey = `endpoints.${UpstreamProtocol}`;

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

export type ProviderSyncField = ProviderSyncEndpointField;

/** 参与比对的模板字段（`StaticProviderImportPresetRow` 的子集）。 */
export type ProviderSyncPresetInput = {
	endpoints: ProviderEndpointsSource['endpoints'];
};

/** 参与比对的 provider 字段（`providers` 行的子集）。 */
export type ProviderSyncProviderInput = {
	endpoints?: ProviderEndpointsSource['endpoints'];
};

function statusOf(current: string | null, official: string | null): ProviderSyncStatus | null {
	if (current === official) return null;
	if (current === null) return 'added';
	if (official === null) return 'removed';
	return 'changed';
}

/** 占位符换成实际值之后仍是单个 URL 段，不能改写路径。 */
const DEPLOYMENT_TOKEN = /^[A-Za-z0-9](?:[A-Za-z0-9-]{0,127})$/;

type DeploymentSlots = {
	projectId: string | null;
	location: string | null;
	azureResource: string | null;
	/** 仅在当前地址使用 Foundry 主机时保留；模板本体仍是 `openai.azure.com`。 */
	azureHost: 'services.ai.azure.com' | null;
};

function isFilledToken(value: string, placeholder: string): boolean {
	return value !== placeholder && !value.startsWith('YOUR_') && DEPLOYMENT_TOKEN.test(value);
}

function readDeploymentSlots(urls: readonly (string | null | undefined)[]): DeploymentSlots {
	const slots: DeploymentSlots = { projectId: null, location: null, azureResource: null, azureHost: null };
	for (const url of urls) {
		if (!url) continue;
		const project = url.match(/\/projects\/([^/?#]+)\/locations\//)?.[1];
		if (project && isFilledToken(project, 'YOUR_PROJECT_ID')) slots.projectId ??= project;
		const location = url.match(/\/locations\/([^/?#]+)\//)?.[1];
		if (location && isFilledToken(location, 'global')) slots.location ??= location;
		const azure = url.match(
			/^https:\/\/([^./?#]+)\.(openai\.azure\.com|services\.ai\.azure\.com)(?=[/?#]|$)/i
		);
		if (azure && isFilledToken(azure[1], 'YOUR_RESOURCE_NAME')) {
			slots.azureResource ??= azure[1];
			if (azure[2].toLowerCase() === 'services.ai.azure.com') slots.azureHost ??= 'services.ai.azure.com';
		}
	}
	return slots;
}

function materializeOfficialUrl(official: string, slots: DeploymentSlots): string {
	let next = official;
	if (slots.projectId && next.includes('YOUR_PROJECT_ID')) {
		next = next.replaceAll('YOUR_PROJECT_ID', slots.projectId);
	}
	if (slots.azureResource && next.includes('YOUR_RESOURCE_NAME.openai.azure.com')) {
		const host = slots.azureHost ?? 'openai.azure.com';
		next = next.replaceAll('YOUR_RESOURCE_NAME.openai.azure.com', `${slots.azureResource}.${host}`);
	} else if (slots.azureResource && next.includes('YOUR_RESOURCE_NAME')) {
		next = next.replaceAll('YOUR_RESOURCE_NAME', slots.azureResource);
	}
	if (slots.location && official.includes('YOUR_PROJECT_ID') && next.includes('/locations/global/')) {
		next = next.replaceAll('/locations/global/', `/locations/${slots.location}/`);
	}
	return next;
}

/** 当前 URL 只是把模板部署位填实（项目、资源名、Vertex 区域）时，与官方模板等价。 */
function endpointUrlsMatch(current: string | null, official: string | null): boolean {
	if (current === official) return true;
	if (!current || !official) return false;
	if (!official.includes('YOUR_')) return false;
	return materializeOfficialUrl(official, readDeploymentSlots([current])) === current;
}

function statusOfEndpointUrl(current: string | null, official: string | null): ProviderSyncStatus | null {
	if (endpointUrlsMatch(current, official)) return null;
	return statusOf(current, official);
}

function protocolUrls(config: ProtocolEndpointsConfig | undefined): string[] {
	if (!config) return [];
	return [config.base, ...Object.values(config.endpoints ?? {})].filter((url): url is string => Boolean(url));
}

/** 用当前协议里已经填好的部署位，把官方 URL 中的占位符写回；路径仍以官方为准。 */
function materializeProtocol(
	current: ProtocolEndpointsConfig | undefined,
	official: ProtocolEndpointsConfig
): ProtocolEndpointsConfig {
	const fallback = readDeploymentSlots(protocolUrls(current));
	const next = structuredClone(official);
	const fill = (officialUrl: string, currentUrl: string | null | undefined) => {
		const own = readDeploymentSlots([currentUrl]);
		return materializeOfficialUrl(officialUrl, {
			projectId: own.projectId ?? fallback.projectId,
			location: own.location ?? fallback.location,
			azureResource: own.azureResource ?? fallback.azureResource,
			azureHost: own.azureHost ?? fallback.azureHost,
		});
	};
	if (next.base) next.base = fill(next.base, current?.base);
	if (next.endpoints) {
		for (const capability of Object.keys(next.endpoints) as (keyof NonNullable<ProtocolEndpointsConfig['endpoints']>)[]) {
			const officialUrl = next.endpoints[capability];
			if (!officialUrl) continue;
			next.endpoints[capability] = fill(officialUrl, current?.endpoints?.[capability]);
		}
	}
	return next;
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
	const pushUrl = (slot: string, cur: string | null, off: string | null) => {
		const status = statusOfEndpointUrl(cur, off);
		if (status) rows.push({ slot, status, current: cur, official: off });
	};
	pushUrl('base', current?.base ?? null, official?.base ?? null);
	push('auth', current?.auth ?? null, official?.auth ?? null);
	const capabilities = new Set<string>([
		...Object.keys(current?.endpoints ?? {}),
		...Object.keys(official?.endpoints ?? {}),
	]);
	for (const capability of [...capabilities].sort()) {
		const cur = (current?.endpoints as Record<string, string> | undefined)?.[capability] ?? null;
		const off = (official?.endpoints as Record<string, string> | undefined)?.[capability] ?? null;
		pushUrl(capability, cur, off);
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

	const protocols = UPSTREAM_PROTOCOLS.filter((p) => selected.has(`endpoints.${p}`) && diffKeys.has(`endpoints.${p}`));
	if (protocols.length > 0) {
		const next: ProviderEndpointsMap = { ...parseProviderEndpoints({ endpoints: provider.endpoints }) };
		const officialMap = parseProviderEndpoints({ endpoints: preset.endpoints });
		for (const protocol of protocols) {
			const official = officialMap[protocol];
			if (official) next[protocol] = materializeProtocol(next[protocol], official);
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
	label_ja: string;
	label_ko: string;
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
	label_ja: string;
	label_ko: string;
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
