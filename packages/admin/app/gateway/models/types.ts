import type { GatewayModel } from '@/lib/types';

/** API returns models with tags parsed as string[] */
export type ModelListItem = Omit<GatewayModel, 'tags'> & {
	tags: string[];
	routes_count: number;
	active_routes_count: number;
};

/** `GET /admin/models/import/catalog` */
export type PresetCatalogRow = {
	id: string;
	display_name: string | null;
	vendor: string;
	/** `llm` | `image` | `audio` — same Kind as Models list filter */
	kind: 'llm' | 'image' | 'audio';
	context_window: number | null;
	max_tokens: number | null;
	description: string | null;
	i18n: {
		en: string;
		zh: string;
	} | null;
	/** Tier count for the billing-currency catalog branch. */
	tier_count: number;
	/** Short cell label (USD/CNY branch per `BILLING_CURRENCY`). */
	pricing_label: string | null;
	pricing_preview: string | null;
};

export type ModelFormData = {
	id: string;
	display_name: string;
	vendor: string;
	context_window: string;
	max_tokens: string;
	input_modalities: string[];
	output_modalities: string[];
	released_at: string;
	tags: string[];
	description: string;
	metadata: string;
};

export type MetadataSummary =
	| { kind: 'empty' }
	| { kind: 'object'; keyCount: number; keyPreview: string[]; formatted: string }
	| { kind: 'raw'; formatted: string; label: string };

export type MetadataPreviewState = {
	model: ModelListItem;
	summary: Exclude<MetadataSummary, { kind: 'empty' }>;
};

export type ModelImportResult = {
	billing_currency_used: string;
	created: number;
	skipped_existing: string[];
	failed: Array<{ id: string; message: string }>;
};

/** Sidebar filter: show models from every vendor (`?vendor=all`). */
export const ALL_VENDORS_KEY = 'all';

/**
 * 模型目录 Kind 视图（`?kind=all|llm|image|audio`）。
 * 模型目录允许跨类型浏览；调试台继续使用 `@/lib/invoke-kind` 中不含 All 的模型类型。
 */
export const MODEL_LIST_KIND_FILTERS = ['all', 'llm', 'image', 'audio'] as const;
export type ModelListKindFilter = (typeof MODEL_LIST_KIND_FILTERS)[number];
export const DEFAULT_MODEL_LIST_KIND_FILTER: ModelListKindFilter = 'all';

export function parseModelListKindFilterParam(value: string | null): ModelListKindFilter {
	if (value == null || value.trim() === '') return DEFAULT_MODEL_LIST_KIND_FILTER;
	const normalized = value.trim().toLowerCase();
	return (MODEL_LIST_KIND_FILTERS as readonly string[]).includes(normalized)
		? (normalized as ModelListKindFilter)
		: DEFAULT_MODEL_LIST_KIND_FILTER;
}

/** 调试台 / 旧模型类型联合，保持不含 All 的既有语义。 */
export {
	DEFAULT_KIND_FILTER,
	type ModelKindFilter,
	parseKindFilterParam,
} from '@/lib/invoke-kind';

export const EMPTY_MODEL_FORM: ModelFormData = {
	id: '',
	display_name: '',
	vendor: 'other',
	context_window: '',
	max_tokens: '8192',
	input_modalities: ['text'],
	output_modalities: ['text'],
	released_at: '',
	tags: [],
	description: '',
	metadata: '',
};

/** 手工新建 Image 模型时的模态默认值（对齐 gpt-image-2：text+image → image）。 */
export const EMPTY_IMAGE_MODEL_FORM: ModelFormData = {
	...EMPTY_MODEL_FORM,
	max_tokens: '',
	input_modalities: ['text', 'image'],
	output_modalities: ['image'],
};

/** 手工新建 Audio 转写模型时的模态默认值（对齐 whisper-1：audio → text）。 */
export const EMPTY_AUDIO_MODEL_FORM: ModelFormData = {
	...EMPTY_MODEL_FORM,
	max_tokens: '',
	context_window: '',
	input_modalities: ['audio'],
	output_modalities: ['text'],
};

export type ModelFormKind = 'llm' | 'image' | 'audio';
