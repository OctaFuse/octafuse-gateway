/** `provider_api_keys.status` 枚举。 */
export type ProviderApiKeyStatus = 'active' | 'disabled';

/** `provider_api_keys` 表行（含明文密钥，仅服务端）。 */
export interface ProviderApiKeyRow {
	id: string;
	provider_id: string;
	label: string;
	api_key: string;
	status: string;
	weight: number;
	priority: number;
	created_at: string;
	updated_at: string;
}

/** Proxy 调度使用的 active key（明文）。 */
export interface ActiveProviderApiKeyRow {
	id: string;
	label: string;
	api_key: string;
	weight: number;
	priority: number;
}

/** Admin 列表：脱敏，不含明文 api_key。 */
export interface ProviderApiKeyAdminRow {
	id: string;
	provider_id: string;
	label: string;
	status: string;
	weight: number;
	priority: number;
	fingerprint: string;
	created_at: string;
	updated_at: string;
}

export type InsertProviderApiKeyParams = {
	id: string;
	providerId: string;
	label: string;
	apiKey: string;
	status?: ProviderApiKeyStatus;
	weight?: number;
	priority?: number;
};

export type UpdateProviderApiKeyPatch = {
	label?: string;
	apiKey?: string;
	status?: ProviderApiKeyStatus;
	weight?: number;
	priority?: number;
};
