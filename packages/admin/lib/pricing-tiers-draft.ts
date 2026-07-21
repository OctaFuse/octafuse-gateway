/**
 * 管理 UI：`pricing_profile` 的 `{ tiers }` 表单行与 JSON 序列化（与 `@octafuse/core` 解析一致）。
 * Image 双模式：`image_billing_mode` token / per_image + 可选 `image` 块。
 */
import {
	parsePricingProfile,
	profileHasImagePerImagePricing,
	profileHasImageTokenPricing,
	type PricingTierPrices,
} from '@octafuse/core/db/pricing-profile';

/** 末档开放上界在表单中的占位（序列化时恒为 JSON `null`，不读此字段）。 */
export const DRAFT_UPTO_OPEN_SENTINEL = '';

export type ImageBillingModeDraft = 'token' | 'per_image';

export type ImagePerImageDraft = {
	default: string;
	inputDefault: string;
	uncertainResultPolicy: 'requested' | 'zero' | '';
};

export type ImagePricingDraftState = {
	mode: ImageBillingModeDraft;
	tiers: PricingTierDraftRow[];
	perImage: ImagePerImageDraft;
};

/**
 * 将末档 `upto` 规范为开放上界草稿（清空输入，由 UI 显示 ∞）。
 */
export function ensureLastRowOpenUptoDraft(rows: PricingTierDraftRow[]): PricingTierDraftRow[] {
	if (rows.length === 0) {
		return rows;
	}
	const last = rows.length - 1;
	return rows.map((r, i) => (i === last ? { ...r, upto: DRAFT_UPTO_OPEN_SENTINEL } : r));
}

export type PricingTierDraftRow = {
	id: string;
	upto: string;
	input_price: string;
	output_price: string;
	cache_read_price: string;
	cache_write_price: string;
	/** Image：image input $/1M */
	image_input_price: string;
	/** Image：cached image input $/1M */
	image_input_cache_price: string;
	/** Image：image output $/1M */
	image_output_price: string;
};

let rowIdSeq = 0;
function nextRowId(): string {
	rowIdSeq += 1;
	return `tier-row-${rowIdSeq}`;
}

export function createEmptyTierRow(): PricingTierDraftRow {
	return {
		id: nextRowId(),
		upto: DRAFT_UPTO_OPEN_SENTINEL,
		input_price: '',
		output_price: '',
		cache_read_price: '',
		cache_write_price: '',
		image_input_price: '',
		image_input_cache_price: '',
		image_output_price: '',
	};
}

/** 新建模型时的默认一档（可改） */
export function createDefaultNewModelTierRow(): PricingTierDraftRow {
	return {
		id: nextRowId(),
		upto: DRAFT_UPTO_OPEN_SENTINEL,
		input_price: '2',
		output_price: '12',
		cache_read_price: '0.2',
		cache_write_price: '2',
		image_input_price: '',
		image_input_cache_price: '',
		image_output_price: '',
	};
}

/**
 * Image 模型默认 token 单价（对齐 OpenAI gpt-image-2 目录价，USD/1M；核对日见预设注释）。
 */
export function createDefaultImageTokenTierRow(): PricingTierDraftRow {
	return {
		id: nextRowId(),
		upto: DRAFT_UPTO_OPEN_SENTINEL,
		input_price: '5',
		output_price: '0',
		cache_read_price: '1.25',
		cache_write_price: '',
		image_input_price: '8',
		image_input_cache_price: '2',
		image_output_price: '30',
	};
}

export function createDefaultImagePerImageDraft(): ImagePerImageDraft {
	return {
		default: '0.05',
		inputDefault: '',
		uncertainResultPolicy: 'requested',
	};
}

function draftPricePositive(raw: string): boolean {
	const t = raw.trim();
	if (!t) return false;
	const n = Number(t);
	return Number.isFinite(n) && n > 0;
}

/** 是否已填 image_* token 单价（切换 Kind 时避免覆盖用户已填价）。 */
export function draftRowsHaveImageTokenPrices(rows: PricingTierDraftRow[]): boolean {
	return rows.some(
		(r) =>
			draftPricePositive(r.image_input_price) ||
			draftPricePositive(r.image_input_cache_price) ||
			draftPricePositive(r.image_output_price)
	);
}

/**
 * 看起来像纯 Image 档（有 image_*、无正的 LLM output）——切回 LLM 时可安全换成 LLM 默认档。
 */
export function draftRowsLookLikeImageOnly(rows: PricingTierDraftRow[]): boolean {
	if (!draftRowsHaveImageTokenPrices(rows)) return false;
	return !rows.some((r) => draftPricePositive(r.output_price));
}

export function tierPricesToDraft(t: PricingTierPrices): PricingTierDraftRow {
	return {
		id: nextRowId(),
		upto: t.upto === null ? DRAFT_UPTO_OPEN_SENTINEL : String(t.upto),
		input_price: String(t.input_price),
		output_price: String(t.output_price),
		cache_read_price: t.cache_read_price != null ? String(t.cache_read_price) : '',
		cache_write_price: t.cache_write_price != null ? String(t.cache_write_price) : '',
		image_input_price: t.image_input_price != null ? String(t.image_input_price) : '',
		image_input_cache_price:
			t.image_input_cache_price != null ? String(t.image_input_cache_price) : '',
		image_output_price: t.image_output_price != null ? String(t.image_output_price) : '',
	};
}

/** 从已存 JSON 解析为表单行；空或非法则返回 `[]` */
export function profileJsonToDraftRows(json: string | null | undefined): PricingTierDraftRow[] {
	const trimmed = json?.trim();
	if (!trimmed) {
		return [];
	}
	const p = parsePricingProfile(trimmed);
	if (!p || p.tiers.length === 0) {
		return [];
	}
	return ensureLastRowOpenUptoDraft(p.tiers.map(tierPricesToDraft));
}

function imageConfigToPerImageDraft(
	image: NonNullable<ReturnType<typeof parsePricingProfile>>['image']
): ImagePerImageDraft {
	if (!image) {
		return createDefaultImagePerImageDraft();
	}
	return {
		default: String(image.default),
		inputDefault: image.input?.default != null ? String(image.input.default) : '',
		uncertainResultPolicy: image.uncertain_result_policy ?? 'requested',
	};
}

/** 从已存 JSON 解析 Image 双模式编辑态。 */
export function profileJsonToDraftState(json: string | null | undefined): ImagePricingDraftState {
	const tiers = profileJsonToDraftRows(json);
	const trimmed = json?.trim();
	if (!trimmed) {
		return {
			mode: 'token',
			tiers,
			perImage: createDefaultImagePerImageDraft(),
		};
	}
	const p = parsePricingProfile(trimmed);
	if (!p) {
		return {
			mode: 'token',
			tiers,
			perImage: createDefaultImagePerImageDraft(),
		};
	}
	if (p.image_billing_mode === 'per_image' || profileHasImagePerImagePricing(p)) {
		return {
			mode: 'per_image',
			tiers: [],
			perImage: imageConfigToPerImageDraft(p.image),
		};
	}
	if (p.image_billing_mode === 'token' || profileHasImageTokenPricing(p)) {
		return {
			mode: 'token',
			tiers: tiers.length > 0 ? tiers : [createDefaultImageTokenTierRow()],
			perImage: createDefaultImagePerImageDraft(),
		};
	}
	return {
		mode: 'token',
		tiers,
		perImage: createDefaultImagePerImageDraft(),
	};
}

export type SerializeTiersResult =
	| { ok: true; json: string | null }
	| { ok: false; error: string };

function parseOptionalPriceField(
	raw: string,
	rowLabel: string,
	field: string
): { ok: true; value: number | null } | { ok: false; error: string } {
	const t = raw.trim();
	if (t === '') {
		return { ok: true, value: null };
	}
	const n = Number(t);
	if (!Number.isFinite(n)) {
		return { ok: false, error: `${rowLabel}: ${field} must be a finite number or empty` };
	}
	return { ok: true, value: n };
}

/**
 * 将表单行序列化为 canonical `{ "tiers": [...] }` JSON 文本（LLM / 无显式 Image mode）。
 * **末档 `upto` 恒为 JSON `null`**（开放上界）；非末档须为有限数字 ≥ 0。
 * `rows` 为空时返回 `null`（表示清除或未设置 profile）。
 */
export function serializeDraftRowsToProfileJson(rows: PricingTierDraftRow[]): SerializeTiersResult {
	let workingRows = rows;
	if (workingRows.length === 0) {
		return { ok: true, json: null };
	}
	const tiers: PricingTierPrices[] = [];
	const n = workingRows.length;
	for (let i = 0; i < n; i++) {
		const r = workingRows[i]!;
		const rowLabel = `Tier ${i + 1}`;
		const isLast = i === n - 1;
		let upto: number | null;
		if (isLast) {
			upto = null;
		} else {
			const trimmed = r.upto.trim();
			const num = Number(trimmed);
			if (!Number.isFinite(num) || num < 0) {
				return {
					ok: false,
					error: `${rowLabel}: upto must be a finite number ≥ 0 (only the last tier is open-ended ∞)`,
				};
			}
			upto = num;
		}
		const input_price = Number(r.input_price.trim());
		const output_price = Number(r.output_price.trim() || '0');
		if (!Number.isFinite(input_price) || !Number.isFinite(output_price)) {
			return { ok: false, error: `${rowLabel}: input_price and output_price must be finite numbers` };
		}
		const cr = parseOptionalPriceField(r.cache_read_price, rowLabel, 'cache_read_price');
		if (!cr.ok) {
			return cr;
		}
		const cw = parseOptionalPriceField(r.cache_write_price, rowLabel, 'cache_write_price');
		if (!cw.ok) {
			return cw;
		}
		const iin = parseOptionalPriceField(r.image_input_price, rowLabel, 'image_input_price');
		if (!iin.ok) {
			return iin;
		}
		const iic = parseOptionalPriceField(
			r.image_input_cache_price,
			rowLabel,
			'image_input_cache_price'
		);
		if (!iic.ok) {
			return iic;
		}
		const iout = parseOptionalPriceField(r.image_output_price, rowLabel, 'image_output_price');
		if (!iout.ok) {
			return iout;
		}
		tiers.push({
			upto,
			label: null,
			input_price,
			output_price,
			cache_read_price: cr.value,
			cache_write_price: cw.value,
			image_input_price: iin.value,
			image_input_cache_price: iic.value,
			image_output_price: iout.value,
		});
	}
	const body = { tiers };
	const json = JSON.stringify(body);
	if (!parsePricingProfile(json)) {
		return { ok: false, error: 'Serialized profile failed pricing validation' };
	}
	return { ok: true, json };
}

/** Image 模型：按 token / 按张序列化为完整 profile JSON。 */
export function serializeImagePricingDraft(params: ImagePricingDraftState): SerializeTiersResult {
	const { mode, tiers, perImage } = params;
	if (mode === 'token') {
		const res = serializeDraftRowsToProfileJson(tiers);
		if (!res.ok) {
			return res;
		}
		if (!res.json) {
			return { ok: true, json: null };
		}
		try {
			const obj = JSON.parse(res.json) as Record<string, unknown>;
			obj.image_billing_mode = 'token';
			delete obj.image;
			const json = JSON.stringify(obj);
			if (!parsePricingProfile(json)) {
				return { ok: false, error: 'Serialized token image profile failed pricing validation' };
			}
			return { ok: true, json };
		} catch {
			return { ok: false, error: 'Failed to serialize token image profile' };
		}
	}

	const defaultPrice = Number(perImage.default.trim());
	if (!Number.isFinite(defaultPrice) || defaultPrice < 0) {
		return { ok: false, error: 'Per-image default price must be a finite number ≥ 0' };
	}
	let inputDefault: number | undefined;
	const inputTrim = perImage.inputDefault.trim();
	if (inputTrim !== '') {
		const n = Number(inputTrim);
		if (!Number.isFinite(n) || n < 0) {
			return {
				ok: false,
				error: 'Per-image input default must be a finite number ≥ 0 or empty',
			};
		}
		inputDefault = n;
	}
	const policy = perImage.uncertainResultPolicy;
	const uncertainPolicy = policy === 'requested' || policy === 'zero' ? policy : 'requested';

	const imageBlock: Record<string, unknown> = { default: defaultPrice };
	if (inputDefault != null) {
		imageBlock.input = { default: inputDefault };
	}
	if (uncertainPolicy !== 'requested') {
		imageBlock.uncertain_result_policy = uncertainPolicy;
	}

	const body = {
		image_billing_mode: 'per_image',
		image: imageBlock,
	};
	const json = JSON.stringify(body);
	if (!parsePricingProfile(json)) {
		return { ok: false, error: 'Serialized per-image profile failed pricing validation' };
	}
	return { ok: true, json };
}

/** 只读预览：合法则美化 JSON；非法或空档给提示注释行 */
export function formatPricingProfilePreview(
	rows: PricingTierDraftRow[],
	imageDraft?: Pick<ImagePricingDraftState, 'mode' | 'perImage'>
): string {
	const res =
		imageDraft != null
			? serializeImagePricingDraft({ mode: imageDraft.mode, tiers: rows, perImage: imageDraft.perImage })
			: serializeDraftRowsToProfileJson(rows);
	if (!res.ok) {
		return `// ${res.error}`;
	}
	if (!res.json) {
		return '// No tiers — save clears pricing_profile (null)';
	}
	try {
		return JSON.stringify(JSON.parse(res.json) as { tiers: unknown }, null, 2);
	} catch {
		return res.json;
	}
}
