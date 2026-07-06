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
	context_window: number | null;
	max_tokens: number | null;
	tier_count_usd: number;
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
