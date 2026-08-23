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

	it("accepts DashScope image conversion adapters for an OpenAI Images surface", () => {
		for (const adapter of ["dashscope-image-qwen", "dashscope-image-wan"]) {
			assert.equal(
				routeMatchesSurface(
					{
						adapter,
						upstreamProtocol: "dashscope",
						upstreamOperation: "images.generations.multimodal",
					},
					{ protocol: "openai", operation: "images.generations" }
				),
				true
			);
			assert.equal(
				routeMatchesSurface(
					{
						adapter,
						upstreamProtocol: "dashscope",
						upstreamOperation: "*",
					},
					{ protocol: "openai", operation: "images.generations" }
				),
				true
			);
		}
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
