import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
	buildSimulatorDashScopeRealtimeUrl,
	buildSimulatorElevenLabsRealtimeUrl,
	buildSimulatorRequest,
	withDashScopeRunTaskModel,
} from "./endpoint";

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

	it("uses /v1/responses when llmOperation is responses", () => {
		const result = buildSimulatorRequest({
			baseUrl: "https://gateway.example.com",
			protocol: "openai",
			modelForRouting: "gpt-4.1",
			llmOperation: "responses",
			body: { input: [{ role: "user", content: "Hello" }], store: false },
			apiKey: "sk-test",
		});
		assert.equal(result.url, "https://gateway.example.com/v1/responses");
		const parsed = JSON.parse(result.bodyText) as { model: string; store: boolean };
		assert.equal(parsed.model, "gpt-4.1");
		assert.equal(parsed.store, false);
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
		assert.equal(result.formData?.getAll("image").length, 1);
		assert.equal(result.formData?.getAll("image[]").length, 0);
	});

	it("uses image[] for multiple images/edits files", () => {
		const a = new File([Uint8Array.from([137, 80, 78, 71])], "a.png", { type: "image/png" });
		const b = new File([Uint8Array.from([137, 80, 78, 71])], "b.png", { type: "image/png" });
		const result = buildSimulatorRequest({
			baseUrl: "https://gateway.example.com",
			protocol: "openai",
			modelForRouting: "gpt-image-2",
			body: { prompt: "fuse these" },
			apiKey: "sk-test",
			imageOperation: "edits",
			editImages: [a, b],
		});
		assert.equal(result.formData?.getAll("image").length, 0);
		assert.equal(result.formData?.getAll("image[]").length, 2);
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

	it("includes file_url in the OpenAI transcriptions multipart preview", () => {
		const result = buildSimulatorRequest({
			baseUrl: "https://gateway.example.com",
			protocol: "openai",
			modelForRouting: "qwen-audio-3.0-asr-flash-filetrans",
			body: { file_url: "https://audio.example/sample.wav", language: "zh" },
			apiKey: "sk-test",
			audioOperation: "transcriptions",
			audioFile: null,
		});
		assert.match(result.multipartSummary ?? "", /file_url: https:\/\/audio.example\/sample.wav/);
	});

	it("builds MiniMax speech_to_text passthrough multipart", () => {
		const result = buildSimulatorRequest({
			baseUrl: "https://gateway.example.com",
			kind: "asr",
			protocol: "minimax",
			modelForRouting: "minimax-asr-1.0",
			body: { language: "zh", response_format: "verbose_json" },
			apiKey: "sk-test",
			audioOperation: "transcriptions",
			audioFile: null,
		});
		assert.equal(result.url, "https://gateway.example.com/minimax/v1/speech_to_text");
		assert.equal(result.formData?.get("model"), "minimax-asr-1.0");
		assert.equal(result.formData?.get("language"), "zh");
		assert.equal(result.formData?.get("response_format"), "verbose_json");
	});

	it("builds MiniMax speech JSON for /minimax/v1/t2a_v2", () => {
		const result = buildSimulatorRequest({
			baseUrl: "https://gateway.example.com",
			kind: "tts",
			protocol: "minimax",
			modelForRouting: "minimax-speech-2.8-turbo",
			body: { text: "你好", stream: false },
			apiKey: "sk-test",
			audioOperation: "speech",
		});
		assert.equal(result.url, "https://gateway.example.com/minimax/v1/t2a_v2");
		assert.equal(result.headers["Content-Type"], "application/json");
		assert.equal(result.formData, undefined);
		assert.deepEqual(JSON.parse(result.bodyText), {
			model: "minimax-speech-2.8-turbo",
			text: "你好",
			stream: false,
		});
	});

	it("builds ElevenLabs native speech path, query, and model_id", () => {
		const result = buildSimulatorRequest({
			baseUrl: "https://gateway.example.com",
			kind: "tts",
			protocol: "elevenlabs",
			modelForRouting: "elevenlabs-flash-v2.5",
			body: {
				voice_id: "JBFqnCBsd6RMkjVDRZzb",
				variant: "stream",
				output_format: "mp3_44100_128",
				model_id: "<auto>",
				text: "hello",
			},
			apiKey: "sk-test",
			audioOperation: "speech",
		});
		assert.equal(
			result.url,
			"https://gateway.example.com/elevenlabs/v1/text-to-speech/JBFqnCBsd6RMkjVDRZzb/stream?output_format=mp3_44100_128"
		);
		assert.deepEqual(JSON.parse(result.bodyText), {
			model_id: "elevenlabs-flash-v2.5",
			text: "hello",
		});
	});

	it("builds ElevenLabs native transcription multipart", () => {
		const file = new File(["x"], "a.wav", { type: "audio/wav" });
		const result = buildSimulatorRequest({
			baseUrl: "https://gateway.example.com",
			kind: "asr",
			protocol: "elevenlabs",
			modelForRouting: "elevenlabs-scribe-v2",
			body: { diarize: true, language_code: "zh" },
			apiKey: "sk-test",
			audioOperation: "transcriptions",
			audioFile: file,
		});
		assert.equal(result.url, "https://gateway.example.com/elevenlabs/v1/speech-to-text");
		assert.equal(result.formData?.get("model_id"), "elevenlabs-scribe-v2");
		assert.equal(result.formData?.get("diarize"), "true");
		assert.equal(result.formData?.get("language_code"), "zh");
	});

	it("builds MiniMax image JSON for /minimax/v1/image_generation", () => {
		const result = buildSimulatorRequest({
			baseUrl: "https://gateway.example.com",
			kind: "image",
			protocol: "minimax",
			modelForRouting: "minimax-image-01",
			body: { prompt: "a lantern", n: 1 },
			apiKey: "sk-test",
			imageOperation: "generations",
		});
		assert.equal(result.url, "https://gateway.example.com/minimax/v1/image_generation");
		assert.equal(JSON.parse(result.bodyText).model, "minimax-image-01");
		assert.equal(JSON.parse(result.bodyText).prompt, "a lantern");
	});

	it("builds Volcengine image JSON for /volcengine/api/v3/images/generations", () => {
		const result = buildSimulatorRequest({
			baseUrl: "https://gateway.example.com",
			kind: "image",
			protocol: "volcengine",
			modelForRouting: "doubao-seedream-5-0",
			body: { prompt: "a cat", size: "2K", stream: false },
			apiKey: "sk-test",
			imageOperation: "generations",
		});
		assert.equal(result.url, "https://gateway.example.com/volcengine/api/v3/images/generations");
		assert.equal(result.headers["Content-Type"], "application/json");
		assert.deepEqual(JSON.parse(result.bodyText), {
			model: "doubao-seedream-5-0",
			prompt: "a cat",
			size: "2K",
			stream: false,
		});
	});

	it("builds DashScope multimodal HTTP transcriptions", () => {
		const result = buildSimulatorRequest({
			baseUrl: "https://gateway.example.com",
			kind: "asr",
			protocol: "dashscope",
			modelForRouting: "qwen-audio-3.0-asr-flash",
			body: { input: { messages: [] }, parameters: { format: "wav" } },
			apiKey: "sk-test",
			audioOperation: "transcriptions",
			dashscopeRequestOperation: "audio.transcriptions.multimodal",
		});
		assert.equal(
			result.url,
			"https://gateway.example.com/dashscope/api/v1/services/aigc/multimodal-generation/generation"
		);
		assert.equal(JSON.parse(result.bodyText).model, "qwen-audio-3.0-asr-flash");
	});

	it("builds JSON for audio/speech", () => {
		const result = buildSimulatorRequest({
			baseUrl: "https://gateway.example.com",
			kind: "tts",
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

	it("uses generateContent for image models even when streaming is selected", () => {
		const result = buildSimulatorRequest({
			baseUrl: "https://gateway.example.com",
			kind: "image",
			protocol: "gemini",
			modelForRouting: "gemini-3.1-flash-image",
			geminiAction: "streamGenerateContent",
			body: { contents: [] },
			apiKey: "sk-test",
		});
		const u = new URL(result.url);
		assert.equal(u.pathname, "/v1beta/models/gemini-3.1-flash-image:generateContent");
		assert.equal(u.searchParams.has("alt"), false);
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

describe("DashScope realtime simulator URL", () => {
	it("uses the official inference path without query parameters", () => {
		assert.equal(
			buildSimulatorDashScopeRealtimeUrl({
				baseUrl: "https://gateway.example.com/",
				modelForRouting: "fun-asr-realtime",
				operation: "audio.transcriptions.realtime.inference",
			}),
			"wss://gateway.example.com/dashscope/api-ws/v1/inference"
		);
	});

	it("uses the official session path with ?model= only", () => {
		assert.equal(
			buildSimulatorDashScopeRealtimeUrl({
				baseUrl: "http://localhost:8787",
				modelForRouting: "qwen3-asr-flash-realtime",
				operation: "audio.transcriptions.realtime.session",
			}),
			"ws://localhost:8787/dashscope/api-ws/v1/realtime?model=qwen3-asr-flash-realtime"
		);
	});

	it("writes the Gateway model into run-task for inference only", () => {
		const runTask = {
			header: { action: "run-task", task_id: "t1" },
			payload: { task: "asr", model: "<auto>", parameters: { format: "pcm" } },
		};
		assert.deepEqual(
			withDashScopeRunTaskModel(runTask, "audio.transcriptions.realtime.inference", "fun-asr-realtime:cn"),
			{
				header: { action: "run-task", task_id: "t1" },
				payload: { task: "asr", model: "fun-asr-realtime:cn", parameters: { format: "pcm" } },
			}
		);
		const session = { type: "session.update", session: {} };
		assert.equal(
			withDashScopeRunTaskModel(session, "audio.transcriptions.realtime.session", "qwen3"),
			session
		);
	});
});

describe("buildSimulatorElevenLabsRealtimeUrl", () => {
	it("builds the realtime STT URL with routed model_id", () => {
		const url = buildSimulatorElevenLabsRealtimeUrl({
			baseUrl: "https://gateway.example.com/",
			modelForRouting: "elevenlabs-scribe-v2",
			operation: "audio.transcriptions.realtime",
			query: { audio_format: "pcm_16000", model_id: "ignored" },
		});
		const parsed = new URL(url);
		assert.equal(parsed.protocol, "wss:");
		assert.equal(parsed.pathname, "/elevenlabs/v1/speech-to-text/realtime");
		assert.equal(parsed.searchParams.get("audio_format"), "pcm_16000");
		assert.equal(parsed.searchParams.get("model_id"), "elevenlabs-scribe-v2");
	});

	it("builds the realtime TTS stream-input URL and requires a voice id", () => {
		const url = buildSimulatorElevenLabsRealtimeUrl({
			baseUrl: "http://localhost:8787",
			modelForRouting: "elevenlabs-flash-v2.5",
			operation: "audio.speech.realtime",
			voiceId: "JBFqnCBsd6RMkjVDRZzb",
			query: { output_format: "mp3_44100_128" },
		});
		const parsed = new URL(url);
		assert.equal(parsed.protocol, "ws:");
		assert.equal(parsed.pathname, "/elevenlabs/v1/text-to-speech/JBFqnCBsd6RMkjVDRZzb/stream-input");
		assert.equal(parsed.searchParams.get("output_format"), "mp3_44100_128");
		assert.throws(() =>
			buildSimulatorElevenLabsRealtimeUrl({
				baseUrl: "http://localhost:8787",
				modelForRouting: "m",
				operation: "audio.speech.realtime",
			})
		);
	});
});
