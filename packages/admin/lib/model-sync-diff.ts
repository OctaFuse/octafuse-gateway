/**
 * Model 与内置官方目录（`model-presets/*.json`）的差异计算与应用。
 *
 * 纯函数：只做结构化比对，不读库。按 `models.id` 与目录项一一对应；目录里没有的模型
 * （用户自建）不参与比对。
 *
 * 比对字段：display_name、vendor、context_window、max_tokens、description、released_at、
 * input_modalities、output_modalities、pricing_profile（按当前 BILLING_CURRENCY 的目录价分支）。
 * 不比对：tags、metadata、route_policy（目录不维护，由运营自行管理）。
 *
 * 官方未给出的字段（null）一律不报差异，不会建议清空本地值。
 */
import { parseModelModalitiesJson } from '@octafuse/core/db/model-modalities';
import { normalizeModelVendorInput } from '@/lib/model-vendor';

/** `added`：本地为空而官方有值；`changed`：两边都有但不同。 */
export type ModelSyncStatus = 'added' | 'changed';

export type ModelSyncScalarKey =
	| 'display_name'
	| 'vendor'
	| 'context_window'
	| 'max_tokens'
	| 'description'
	| 'released_at'
	| 'input_modalities'
	| 'output_modalities';

export type ModelSyncFieldKey = ModelSyncScalarKey | 'pricing_profile';

export type ModelSyncScalarField = {
	key: ModelSyncScalarKey;
	status: ModelSyncStatus;
	/** 用于展示的字符串；modalities 为 `text, image` 形式。 */
	current: string | null;
	official: string;
	default_apply: boolean;
};

export type ModelSyncPricingRow = {
	/** 价格 JSON 路径，如 `tiers[0].input_price`。 */
	path: string;
	/** `removed`：本地有而官方没有（如多出的档位或时段）。 */
	status: ModelSyncStatus | 'removed';
	current: string | null;
	official: string | null;
};

export type ModelSyncPricingField = {
	key: 'pricing_profile';
	status: 'changed';
	rows: ModelSyncPricingRow[];
	/** 价格直接影响计费，默认不选中，需管理员核对后再采用。 */
	default_apply: false;
};

export type ModelSyncField = ModelSyncScalarField | ModelSyncPricingField;

/** 参与比对的 `models` 行字段。 */
export type ModelSyncModelInput = {
	display_name?: string | null;
	vendor?: string | null;
	context_window?: number | null;
	max_tokens?: number | null;
	description?: string | null;
	released_at?: string | null;
	input_modalities?: string | null;
	output_modalities?: string | null;
	pricing_profile?: string | null;
};

/** 官方目录项（已按 BILLING_CURRENCY 选好价格分支并规范化）。 */
export type ModelSyncPresetInput = {
	display_name?: string | null;
	vendor?: string | null;
	context_window?: number | null;
	max_tokens?: number | null;
	description?: string | null;
	released?: string | null;
	input_modalities?: readonly string[] | null;
	output_modalities?: readonly string[] | null;
	/** 已规范化的 `pricing_profile` JSON；无法取得时为 null（不比对价格）。 */
	pricing_profile?: string | null;
};

function textOrNull(value: unknown): string | null {
	const s = String(value ?? '').trim();
	return s === '' ? null : s;
}

function numberOrNull(value: unknown): number | null {
	if (value == null || value === '') return null;
	const n = Number(value);
	return Number.isFinite(n) ? n : null;
}

function modalitiesKey(list: readonly string[] | null | undefined): string | null {
	if (!list || list.length === 0) return null;
	return [...list].sort().join(', ');
}

/** 把任意 JSON 展开为 `路径 → 叶子值` 的有序列表。 */
function flattenJson(value: unknown, path: string, out: Map<string, string>): void {
	if (Array.isArray(value)) {
		value.forEach((item, index) => flattenJson(item, `${path}[${index}]`, out));
		return;
	}
	if (value !== null && typeof value === 'object') {
		for (const [key, child] of Object.entries(value as Record<string, unknown>)) {
			flattenJson(child, path ? `${path}.${key}` : key, out);
		}
		return;
	}
	out.set(path, value === null ? 'null' : String(value));
}

function flattenPricing(raw: string | null | undefined): Map<string, string> | null {
	if (!raw) return null;
	try {
		const map = new Map<string, string>();
		flattenJson(JSON.parse(raw) as unknown, '', map);
		return map;
	} catch {
		return null;
	}
}

function pricingRows(
	current: Map<string, string>,
	official: Map<string, string>
): ModelSyncPricingRow[] {
	const rows: ModelSyncPricingRow[] = [];
	for (const [path, off] of official) {
		const cur = current.get(path) ?? null;
		if (cur === off) continue;
		rows.push({ path, status: cur === null ? 'added' : 'changed', current: cur, official: off });
	}
	for (const [path, cur] of current) {
		if (!official.has(path)) rows.push({ path, status: 'removed', current: cur, official: null });
	}
	return rows;
}

/** 逐字段比较 model 与官方目录项；无差异返回空数组。 */
export function diffModelAgainstPreset(
	model: ModelSyncModelInput,
	preset: ModelSyncPresetInput
): ModelSyncField[] {
	const fields: ModelSyncField[] = [];

	const pushScalar = (key: ModelSyncScalarKey, current: string | null, official: string | null) => {
		if (official === null || current === official) return;
		fields.push({
			key,
			status: current === null ? 'added' : 'changed',
			current,
			official,
			default_apply: true,
		});
	};

	pushScalar('display_name', textOrNull(model.display_name), textOrNull(preset.display_name));
	pushScalar(
		'vendor',
		textOrNull(model.vendor) ? normalizeModelVendorInput(model.vendor) : null,
		textOrNull(preset.vendor) ? normalizeModelVendorInput(preset.vendor) : null
	);
	pushScalar(
		'context_window',
		numberOrNull(model.context_window)?.toString() ?? null,
		numberOrNull(preset.context_window)?.toString() ?? null
	);
	pushScalar(
		'max_tokens',
		numberOrNull(model.max_tokens)?.toString() ?? null,
		numberOrNull(preset.max_tokens)?.toString() ?? null
	);
	pushScalar('description', textOrNull(model.description), textOrNull(preset.description));
	pushScalar('released_at', textOrNull(model.released_at), textOrNull(preset.released));
	pushScalar(
		'input_modalities',
		modalitiesKey(parseModelModalitiesJson(model.input_modalities ?? null)),
		modalitiesKey(preset.input_modalities)
	);
	pushScalar(
		'output_modalities',
		modalitiesKey(parseModelModalitiesJson(model.output_modalities ?? null)),
		modalitiesKey(preset.output_modalities)
	);

	const officialPricing = flattenPricing(preset.pricing_profile);
	const currentPricing = flattenPricing(model.pricing_profile);
	if (officialPricing && currentPricing) {
		const rows = pricingRows(currentPricing, officialPricing);
		if (rows.length > 0) {
			fields.push({ key: 'pricing_profile', status: 'changed', rows, default_apply: false });
		}
	}

	return fields;
}

export type ModelSyncPatch = {
	display_name?: string;
	vendor?: string;
	context_window?: number;
	max_tokens?: number;
	description?: string;
	released_at?: string;
	input_modalities?: string[];
	output_modalities?: string[];
	pricing_profile?: string;
};

/**
 * 根据选中的字段键生成 PATCH 内容。只处理当前确实存在差异的键；未知键忽略。
 * 值取自官方目录，调用方交给 `updateModelService` 做最终校验与规范化。
 */
export function buildModelSyncPatch(
	model: ModelSyncModelInput,
	preset: ModelSyncPresetInput,
	selectedKeys: readonly string[]
): ModelSyncPatch {
	const selected = new Set(selectedKeys);
	const diffKeys = new Set<string>(diffModelAgainstPreset(model, preset).map((f) => f.key));
	const want = (key: ModelSyncFieldKey) => selected.has(key) && diffKeys.has(key);
	const patch: ModelSyncPatch = {};

	if (want('display_name')) patch.display_name = textOrNull(preset.display_name) ?? undefined;
	if (want('vendor')) patch.vendor = normalizeModelVendorInput(preset.vendor);
	if (want('context_window')) patch.context_window = numberOrNull(preset.context_window) ?? undefined;
	if (want('max_tokens')) patch.max_tokens = numberOrNull(preset.max_tokens) ?? undefined;
	if (want('description')) patch.description = textOrNull(preset.description) ?? undefined;
	if (want('released_at')) patch.released_at = textOrNull(preset.released) ?? undefined;
	if (want('input_modalities') && preset.input_modalities) patch.input_modalities = [...preset.input_modalities];
	if (want('output_modalities') && preset.output_modalities) patch.output_modalities = [...preset.output_modalities];
	if (want('pricing_profile') && preset.pricing_profile) patch.pricing_profile = preset.pricing_profile;

	for (const key of Object.keys(patch) as Array<keyof ModelSyncPatch>) {
		if (patch[key] === undefined) delete patch[key];
	}
	return patch;
}

// ---------- 报告结构（`GET /admin/models/sync/diff`） ----------

export type ModelSyncModelEntry = {
	model_id: string;
	display_name: string | null;
	kind: 'llm' | 'image' | 'audio' | 'embedding';
	routes_count: number;
	active_routes_count: number;
	fields: ModelSyncField[];
};

export type ModelSyncVendorGroup = {
	vendor: string;
	vendor_label: string;
	models: ModelSyncModelEntry[];
};

export type ModelSyncReport = {
	/** 价格差异所用的目录价分支。 */
	billing_currency: string;
	groups: ModelSyncVendorGroup[];
	/** 有差异的模型总数。 */
	models_with_diff: number;
};

export type ModelSyncApplyBody = {
	items: Array<{ model_id: string; fields: string[] }>;
};

export type ModelSyncApplyOutput = {
	updated: number;
	/** 请求的字段在服务端重算后已无差异，或目录里已没有该模型。 */
	skipped: number;
	failed: Array<{ model_id: string; message: string }>;
};
