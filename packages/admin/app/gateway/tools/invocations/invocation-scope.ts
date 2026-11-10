import {
	findGatewayToolById,
	GATEWAY_TOOLS_PROVIDER_ID,
} from "../../../../lib/gateway-tools";
import { MCP_REQUEST_LOG_PROVIDER_ID } from "../../../../lib/invoke-kind";
/** The table and its request-log drill-down must use exactly the same scope. */
export function invocationLogScope(
	source: "" | "rest" | "mcp",
	toolId: string,
	server: string
): URLSearchParams {
	const q = new URLSearchParams();
	const tool = source !== "mcp" ? findGatewayToolById(toolId) : undefined;
	if (tool) {
		q.set("model_id", tool.modelId);
	} else if (source === "mcp") {
		q.set("provider_id", MCP_REQUEST_LOG_PROVIDER_ID);
		if (server) q.set("model_id_prefix", `mcp:${server}/`);
	} else if (source === "rest") q.set("provider_id", GATEWAY_TOOLS_PROVIDER_ID);
	else
		q.set(
			"provider_ids",
			`${GATEWAY_TOOLS_PROVIDER_ID},${MCP_REQUEST_LOG_PROVIDER_ID}`
		);
	return q;
}
