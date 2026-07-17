/** Provider 协议端点字段（供路由校验）。 */
export type ProviderProtocolBases = {
	id: string;
	/** `providers.endpoints` JSON */
	endpoints: string | null;
};
