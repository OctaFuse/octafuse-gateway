export const ETL_TABLE_ORDER = [
	'api_keys',
	'providers',
	'models',
	'model_tags',
	'model_routes',
	'api_key_request_logs',
	'system_config',
	'api_key_audit_logs',
] as const;

export type EtlTableName = (typeof ETL_TABLE_ORDER)[number];

export const ETL_TABLES_TO_TRUNCATE = [...ETL_TABLE_ORDER].reverse();

export const TABLE_CONFLICT_KEYS: Record<EtlTableName, string[]> = {
	api_keys: ['id'],
	providers: ['id'],
	models: ['id'],
	model_tags: ['model_id', 'tag'],
	model_routes: ['id'],
	api_key_request_logs: ['id'],
	system_config: ['key'],
	api_key_audit_logs: ['id'],
};
