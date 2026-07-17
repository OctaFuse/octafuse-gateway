/**
 * 管理 UI：`pricing_profile` 的 `{ tiers }` 表单行与 JSON 序列化（与 `@octafuse/core` 解析一致）。
 * 不再写入 legacy `image` 按张块。
 */
import { parsePricingProfile, type PricingTierPrices } from '@octafuse/core/db/pricing-profile';

/** 末档开放上界在表单中的占位（序列化时恒为 JSON `null`，不读此字段）。 */
export const DRAFT_UPTO_OPEN_SENTINEL = '';

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
 * 将表单行序列化为 canonical `{ "tiers": [...] }` JSON 文本。
 * **末档 `upto` 恒为 JSON `null`**（开放上界）；非末档须为有限数字 ≥ 0。
 * `rows` 为空时返回 `null`（表示清除或未设置 profile）。
 * 保存时**不**写入 legacy `image` 键（旧库内 `image` 块会被覆盖清除）。
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

/** 只读预览：合法则美化 JSON；非法或空档给提示注释行 */
export function formatPricingProfilePreview(rows: PricingTierDraftRow[]): string {
	const res = serializeDraftRowsToProfileJson(rows);
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
