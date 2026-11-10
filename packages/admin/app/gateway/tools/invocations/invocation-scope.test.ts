import assert from "node:assert/strict";
import { it } from "node:test";
import { invocationLogScope } from "./invocation-scope";
it("keeps a selected MCP service scoped in log drill-downs", () => {
	const q = invocationLogScope("mcp", "", "docs");
	assert.equal(q.get("model_id_prefix"), "mcp:docs/");
	assert.ok(q.get("provider_id"));
});
it("limits an unfiltered invocation view to both tool sources", () => {
	const q = invocationLogScope("", "", "");
	assert.equal(q.get("provider_ids")?.split(",").length, 2);
	assert.equal(q.has("model_id_prefix"), false);
});
it("ignores stale tool filters in MCP mode and stale server filters in REST mode", () => {
	assert.equal(
		invocationLogScope("mcp", "web-search", "docs").has("model_id"),
		false
	);
	assert.equal(
		invocationLogScope("rest", "", "docs").has("model_id_prefix"),
		false
	);
});
