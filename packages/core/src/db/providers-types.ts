/** 协议根 URL（无 api_key 列） */
export type ProviderProtocolBases = {
	id: string;
	base_url_openai: string | null;
	base_url_anthropic: string | null;
	base_url_gemini: string | null;
};
