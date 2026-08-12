import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { buildSimulatorRequest } from "./endpoint";

describe("buildSimulatorRequest tools", () => {
	it("builds /v1/tools/{id} for kind=tool", () => {
		const result = buildSimulatorRequest({
			baseUrl: "https://gateway.example.com",
			kind: "tool",
			toolId: "ai-detection",
			protocol: "openai",
			modelForRouting: "",
			body: { text: "hello" },
			apiKey: "sk-test",
		});
		assert.equal(
			result.url,
			"https://gateway.example.com/v1/tools/ai-detection"
		);
		assert.equal(result.headers["Content-Type"], "application/json");
		assert.equal(result.headers.Authorization, "Bearer sk-test");
		assert.deepEqual(JSON.parse(result.bodyText), { text: "hello" });
	});
});

describe("buildSimulatorRequest openai", () => {
	it("defaults to chat/completions", () => {
		const result = buildSimulatorRequest({
			baseUrl: "https://gateway.example.com",
			protocol: "openai",
			modelForRouting: "gpt-4o",
			body: { messages: [] },
			apiKey: "sk-test",
		});
		assert.equal(result.url, "https://gateway.example.com/v1/chat/completions");
	});

	it("uses images/generations when imagesGenerations is set", () => {
		const result = buildSimulatorRequest({
			baseUrl: "https://gateway.example.com/",
			protocol: "openai",
			modelForRouting: "gpt-image-2",
			body: { prompt: "a red apple", n: 1 },
			apiKey: "sk-test",
			imagesGenerations: true,
		});
		assert.equal(
			result.url,
			"https://gateway.example.com/v1/images/generations"
		);
		const parsed = JSON.parse(result.bodyText) as {
			model: string;
			prompt: string;
		};
		assert.equal(parsed.model, "gpt-image-2");
		assert.equal(parsed.prompt, "a red apple");
	});

	it("uses images/generations when imageOperation is generations", () => {
		const result = buildSimulatorRequest({
			baseUrl: "https://gateway.example.com",
			protocol: "openai",
			modelForRouting: "gpt-image-2",
			body: { prompt: "hi" },
			apiKey: "sk-test",
			imageOperation: "generations",
		});
		assert.equal(
			result.url,
			"https://gateway.example.com/v1/images/generations"
		);
		assert.equal(result.formData, undefined);
	});

	it("builds multipart for images/edits", () => {
		const file = new File([Uint8Array.from([137, 80, 78, 71])], "ref.png", {
			type: "image/png",
		});
		const result = buildSimulatorRequest({
			baseUrl: "https://gateway.example.com",
			protocol: "openai",
			modelForRouting: "gpt-image-2",
			body: { prompt: "make it green", n: 1, size: "1024x1024" },
			apiKey: "sk-test",
			imageOperation: "edits",
			editImages: [file],
		});
		assert.equal(result.url, "https://gateway.example.com/v1/images/edits");
		assert.ok(result.formData);
		assert.equal(result.headers["Content-Type"], undefined);
		assert.equal(result.headers.Authorization, "Bearer sk-test");
		assert.match(result.multipartSummary ?? "", /ref\.png/);
	});

	it("previews images/edits URL even when no reference files yet", () => {
		const result = buildSimulatorRequest({
			baseUrl: "https://gateway.example.com",
			protocol: "openai",
			modelForRouting: "gpt-image-2",
			body: { prompt: "make it green" },
			apiKey: "sk-test",
			imageOperation: "edits",
			editImages: [],
		});
		assert.equal(result.url, "https://gateway.example.com/v1/images/edits");
		assert.match(result.multipartSummary ?? "", /none selected/);
	});

	it("builds multipart for audio/transcriptions", () => {
		const file = new File([Uint8Array.from([1, 2, 3])], "sample.mp3", {
			type: "audio/mpeg",
		});
		const result = buildSimulatorRequest({
			baseUrl: "https://gateway.example.com",
			protocol: "openai",
			modelForRouting: "whisper-1",
			body: { language: "en", response_format: "json" },
			apiKey: "sk-test",
			audioOperation: "transcriptions",
			audioFile: file,
		});
		assert.equal(
			result.url,
			"https://gateway.example.com/v1/audio/transcriptions"
		);
		assert.ok(result.formData);
		assert.equal(result.headers["Content-Type"], undefined);
		assert.match(result.multipartSummary ?? "", /sample\.mp3/);
	});

	it("previews audio/transcriptions URL even when no file yet", () => {
		const result = buildSimulatorRequest({
			baseUrl: "https://gateway.example.com",
			protocol: "openai",
			modelForRouting: "whisper-1",
			body: { language: "zh" },
			apiKey: "sk-test",
			audioOperation: "transcriptions",
			audioFile: null,
		});
		assert.equal(
			result.url,
			"https://gateway.example.com/v1/audio/transcriptions"
		);
		assert.match(result.multipartSummary ?? "", /none selected/);
	});

	it("builds JSON for audio/speech", () => {
		const result = buildSimulatorRequest({
			baseUrl: "https://gateway.example.com",
			kind: "audio",
			protocol: "openai",
			modelForRouting: "qwen-tts:default",
			body: { input: "hello", voice: "Cherry", response_format: "mp3" },
			apiKey: "sk-test",
			audioOperation: "speech",
		});
		assert.equal(result.url, "https://gateway.example.com/v1/audio/speech");
		assert.equal(result.formData, undefined);
		assert.equal(result.headers["Content-Type"], "application/json");
		assert.deepEqual(JSON.parse(result.bodyText), {
			model: "qwen-tts:default",
			input: "hello",
			voice: "Cherry",
			response_format: "mp3",
		});
	});
});

describe("buildSimulatorRequest gemini", () => {
	it("includes alt=sse for streamGenerateContent", () => {
		const result = buildSimulatorRequest({
			baseUrl: "https://gateway.example.com",
			protocol: "gemini",
			modelForRouting: "gemini-2.5-flash",
			geminiAction: "streamGenerateContent",
			body: { contents: [] },
			apiKey: "sk-test",
		});
		const u = new URL(result.url);
		assert.equal(
			u.pathname,
			"/v1beta/models/gemini-2.5-flash:streamGenerateContent"
		);
		assert.equal(u.searchParams.get("alt"), "sse");
	});

	it("does not include alt for generateContent", () => {
		const result = buildSimulatorRequest({
			baseUrl: "https://gateway.example.com",
			protocol: "gemini",
			modelForRouting: "gemini-2.5-flash",
			geminiAction: "generateContent",
			body: { contents: [] },
			apiKey: "sk-test",
		});
		const u = new URL(result.url);
		assert.equal(u.searchParams.has("alt"), false);
	});
});
