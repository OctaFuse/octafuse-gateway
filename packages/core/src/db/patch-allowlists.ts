/**
 * 各表允许通过 patch 接口更新的列名白名单（snake_case，与数据库列名一致）。
 * 所有 updateXxxByPatch 函数在拼接 `SET col = ?` 之前必须用本文件的集合过滤列名，
 * 防止传入任意字符串被拼入 SQL。
 */

export const PROVIDER_PATCH_COLS = new Set([
	'name',
	'base_url_openai',
	'base_url_anthropic',
	'base_url_gemini',
	'description',
]);

export const PROVIDER_API_KEY_PATCH_COLS = new Set([
	'label',
	'api_key',
	'status',
	'weight',
	'priority',
	'limit_config',
]);

export const MODEL_PATCH_COLS = new Set([
	'display_name',
	'vendor',
	'context_window',
	'max_tokens',
	'pricing_profile',
	'description',
	'metadata',
	'input_modalities',
	'output_modalities',
	'released_at',
	'sticky_config',
]);

export const MODEL_ROUTE_PATCH_COLS = new Set([
	'model_id',
	'provider_id',
	'provider_model_name',
	'priority',
	'status',
	'route_group',
	'price_override',
	'custom_params',
	'upstream_protocol',
]);
