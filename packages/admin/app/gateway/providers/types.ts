import type { GatewayProvider } from '@/lib/types';
import type { ProviderEndpointsMap } from '@octafuse/core/provider-endpoints';

/** `GET /admin/providers/import/catalog` */
export type ProviderImportCatalogRow = {
	id: string;
	name: string;
	vendor_key: string;
	vendor_label: string;
	protocols: Array<'openai' | 'anthropic' | 'gemini'>;
	endpoints: string | null;
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

/** 单协议表单：base + Advanced capability 覆盖 */
export type ProtocolEndpointForm = {
	base: string;
	chat: string;
	images_generations: string;
	images_edits: string;
	messages: string;
	generateContent: string;
	streamGenerateContent: string;
};

export type ProviderFormData = {
	id: string;
	name: string;
	openai: ProtocolEndpointForm;
	anthropic: ProtocolEndpointForm;
	gemini: ProtocolEndpointForm;
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

export type EditingProviderKeyState = {
	providerId: string;
	key: ProviderKeyRow;
};

export type ProviderImportResult = {
	created: number;
	failed: Array<{ id: string; message: string }>;
};

export const EMPTY_PROTOCOL_FORM: ProtocolEndpointForm = {
	base: '',
	chat: '',
	images_generations: '',
	images_edits: '',
	messages: '',
	generateContent: '',
	streamGenerateContent: '',
};

export const EMPTY_PROVIDER_FORM: ProviderFormData = {
	id: '',
	name: '',
	openai: { ...EMPTY_PROTOCOL_FORM },
	anthropic: { ...EMPTY_PROTOCOL_FORM },
	gemini: { ...EMPTY_PROTOCOL_FORM },
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

export type { GatewayProvider, ProviderEndpointsMap };
