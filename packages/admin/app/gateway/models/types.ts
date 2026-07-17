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
	/** `llm` | `image` — same Kind as Models list filter */
	kind: 'llm' | 'image';
	context_window: number | null;
	max_tokens: number | null;
	tier_count_usd: number;
	/** Short cell label (USD catalog branch). */
	pricing_label_usd: string | null;
	pricing_preview_usd: string | null;
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

/** Sidebar Kind filter (`?kind=all|llm|image`). */
export const ALL_KINDS_KEY = 'all';
export type ModelKindFilter = 'all' | 'llm' | 'image';

export function parseKindFilterParam(value: string | null): ModelKindFilter {
	if (value == null || value.trim() === '') return ALL_KINDS_KEY;
	const v = value.trim().toLowerCase();
	if (v === 'llm' || v === 'image') return v;
	return ALL_KINDS_KEY;
}

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

export type ModelFormKind = 'llm' | 'image';
