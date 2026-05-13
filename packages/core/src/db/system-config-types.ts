/** 共享类型：system_config 仓储与 DB 层共用。 */
export type SystemConfigRow = {
	key: string;
	value: string | null;
	description: string | null;
};
