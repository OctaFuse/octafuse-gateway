import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { routeMatchesSurface } from "./model-router";

describe("routeMatchesSurface", () => {
	it("accepts the declared DashScope ASR adapter for an OpenAI surface", () => {
		assert.equal(
			routeMatchesSurface(
				{
					adapter: "dashscope-asr-qwen-file",
					upstreamProtocol: "dashscope",
					upstreamOperation: "audio.transcriptions.multimodal",
				},
				{ protocol: "openai", operation: "audio.transcriptions" }
			),
			true
		);
		assert.equal(
			routeMatchesSurface(
				{
					adapter: "dashscope-asr-qwen-audio-file",
					upstreamProtocol: "dashscope",
					upstreamOperation: "audio.transcriptions.multimodal",
				},
				{ protocol: "openai", operation: "audio.transcriptions" }
			),
			true
		);
	});

	it("rejects a cross-protocol passthrough target", () => {
		assert.equal(
			routeMatchesSurface(
				{
					adapter: "passthrough",
					upstreamProtocol: "dashscope",
					upstreamOperation: "audio.transcriptions.multimodal",
				},
				{ protocol: "openai", operation: "audio.transcriptions" }
			),
			false
		);
	});
});
