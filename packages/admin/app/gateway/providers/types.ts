import type { GatewayProvider } from '@/lib/types';

/** `GET /admin/providers/import/catalog` */
export type ProviderImportCatalogRow = {
	id: string;
	name: string;
	vendor_key: string;
	vendor_label: string;
	protocols: Array<'openai' | 'anthropic' | 'gemini'>;
	base_url_openai: string | null;
	base_url_anthropic: string | null;
	base_url_gemini: string | null;
	description: string | null;
};

export type ProviderKeyRow = {
	id: string;
	provider_id: string;
	label: string;
	status: string;
	weight: number;
	priority: number;
	/** 限流配置 JSON（`{"rpm":…,"tpm":…,"max_concurrency":…}`）；null=不限流 */
	limit_config: string | null;
	masked_api_key: string;
	is_pending_import: boolean;
	created_at: string;
	updated_at: string;
};

export type ProviderProtocolSummary = {
	key: 'openai' | 'anthropic' | 'gemini';
	label: string;
	url: string;
};

export type ProviderFormData = {
	id: string;
	name: string;
	base_url_openai: string;
	base_url_anthropic: string;
	base_url_gemini: string;
	description: string;
};

export type ProviderKeyFormData = {
	label: string;
	api_key: string;
	weight: string;
	priority: string;
	rpm: string;
	tpm: string;
	max_concurrency: string;
	status: string;
};

export type ProviderOverview = {
	total: number;
	activeKeys: number;
	withoutKeys: number;
	protocols: { openai: number; anthropic: number; gemini: number };
};

export type EditingProviderKeyState = {
	providerId: string;
	key: ProviderKeyRow;
};

export type ProviderImportResult = {
	created: number;
	failed: Array<{ id: string; message: string }>;
};

export const EMPTY_PROVIDER_FORM: ProviderFormData = {
	id: '',
	name: '',
	base_url_openai: '',
	base_url_anthropic: '',
	base_url_gemini: '',
	description: '',
};

export const EMPTY_KEY_EDIT_FORM: ProviderKeyFormData = {
	label: '',
	api_key: '',
	weight: '1',
	priority: '0',
	rpm: '',
	tpm: '',
	max_concurrency: '',
	status: 'active',
};

export type { GatewayProvider };
