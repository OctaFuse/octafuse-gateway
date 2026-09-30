/** Only editable routing fields; endpoints and credentials always come from the stored provider. */
export type PlaygroundRouteDraft = {
	model_id: string;
	provider_id: string;
	provider_model_name: string;
	request_protocol: string;
	request_operation: string;
	upstream_protocol: string;
	upstream_operation: string;
	adapter: string;
	custom_params: string | null;
};
