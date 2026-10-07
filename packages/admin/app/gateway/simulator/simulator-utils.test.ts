import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
	AUDIO_SPEECH_BODY_TEMPLATE,
	AUDIO_TRANSCRIPTIONS_BODY_TEMPLATE,
	MINIMAX_OPENAI_SPEECH_BODY_TEMPLATE,
} from "../../../lib/audio-transcriptions";
import {
	VOLCENGINE_IMAGE_BODY_TEMPLATE,
	imageBodyTemplateFor,
} from "../../../lib/image-generations";
import {
	OPENAI_RESPONSES_BODY_TEMPLATE,
	bodyTemplateForSelection,
	buildModelRoutingString,
	buildRequestLogsHref,
	filterMatchingActiveRoutes,
	isBodyDirty,
	listDashScopeAudioClientOperations,
	listDashScopeRealtimeOperations,
	listSupportedClientSurfaces,
	redactAuthHeader,
	routeGroupMatchesSelection,
} from "./simulator-utils";
import type { RouteListRow } from "./types";
import {
	inferPlaygroundParseMode,
	mergeAssistantTextParts,
} from "../../../lib/playground/merge-assistant-text";
import { tryParseUsageSummary } from "../../../lib/playground/usage-parsing";

describe("simulator-utils", () => {
	it("buildModelRoutingString omits default group", () => {
		assert.equal(buildModelRoutingString("gpt-4", ""), "gpt-4");
		assert.equal(buildModelRoutingString("gpt-4", "default"), "gpt-4");
		assert.equal(buildModelRoutingString("gpt-4", "vip"), "gpt-4:vip");
	});

	it("routeGroupMatchesSelection treats empty as default", () => {
		assert.equal(routeGroupMatchesSelection("default", ""), true);
		assert.equal(routeGroupMatchesSelection("", ""), true);
		assert.equal(routeGroupMatchesSelection("vip", ""), false);
		assert.equal(routeGroupMatchesSelection("vip", "vip"), true);
	});

	it("filterMatchingActiveRoutes filters and sorts by priority desc", () => {
		const routes: RouteListRow[] = [
			{
				id: "a",
				model_id: "m1",
				provider_id: "p1",
				priority: 1,
				status: "active",
				route_group: "default",
			},
			{
				id: "b",
				model_id: "m1",
				provider_id: "p2",
				priority: 10,
				status: "active",
				route_group: "default",
			},
			{
				id: "c",
				model_id: "m1",
				provider_id: "p3",
				priority: 5,
				status: "inactive",
				route_group: "default",
			},
			{
				id: "d",
				model_id: "m1",
				provider_id: "p4",
				priority: 99,
				status: "active",
				route_group: "vip",
			},
		];
		const matched = filterMatchingActiveRoutes(routes, "m1", "");
		assert.deepEqual(
			matched.map((r) => r.id),
			["b", "a"]
		);
	});

	it("filterMatchingActiveRoutes resolves exact and migrated wildcard surfaces", () => {
		const makeRoute = (id: string, operation: string): RouteListRow => ({
			id,
			model_id: "m1",
			provider_id: id,
			priority: 1,
			status: "active",
			route_group: "default",
			surfaces: JSON.stringify([
				{
					request_protocol: "openai",
					request_operation: operation,
					status: "active",
				},
			]),
		});
		const matched = filterMatchingActiveRoutes(
			[
				makeRoute("chat", "chat"),
				makeRoute("responses", "responses"),
				makeRoute("legacy", "*"),
			],
			"m1",
			"default",
			"openai",
			"chat"
		);
		assert.deepEqual(
			matched.map((route) => route.id),
			["chat", "legacy"]
		);
	});

	it("filterMatchingActiveRoutes keeps DashScope image conversion on the OpenAI Images surface", () => {
		const surfaces = JSON.stringify([
			{
				request_protocol: "openai",
				request_operation: "images.generations",
				status: "active",
			},
		]);
		const matched = filterMatchingActiveRoutes(
			[
				{
					id: "wan",
					model_id: "wan2.7-image",
					provider_id: "aliyun",
					priority: 1,
					status: "active",
					route_group: "default",
					adapter: "dashscope-image-wan",
					upstream_protocol: "dashscope",
					upstream_operation: "images.generations.multimodal",
					surfaces,
				},
				{
					id: "passthrough",
					model_id: "wan2.7-image",
					provider_id: "aliyun",
					priority: 0,
					status: "active",
					route_group: "default",
					adapter: "passthrough",
					upstream_protocol: "dashscope",
					upstream_operation: "images.generations.multimodal",
					surfaces,
				},
			],
			"wan2.7-image",
			"default",
			"openai",
			"images.generations"
		);
		assert.deepEqual(
			matched.map((route) => route.id),
			["wan"]
		);
	});

	it("filterMatchingActiveRoutes matches DashScope image passthrough on the native surface", () => {
		const matched = filterMatchingActiveRoutes(
			[
				{
					id: "conversion",
					model_id: "qwen-image-3.0-pro",
					provider_id: "aliyun",
					priority: 1,
					status: "active",
					route_group: "default",
					adapter: "dashscope-image-qwen",
					upstream_protocol: "dashscope",
					upstream_operation: "images.generations.multimodal",
					surfaces: JSON.stringify([
						{
							request_protocol: "openai",
							request_operation: "images.generations",
							status: "active",
						},
					]),
				},
				{
					id: "passthrough",
					model_id: "qwen-image-3.0-pro",
					provider_id: "aliyun",
					priority: 0,
					status: "active",
					route_group: "default",
					adapter: "passthrough",
					upstream_protocol: "dashscope",
					upstream_operation: "images.generations.multimodal",
					surfaces: JSON.stringify([
						{
							request_protocol: "dashscope",
							request_operation: "images.generations.multimodal",
							status: "active",
						},
					]),
				},
			],
			"qwen-image-3.0-pro",
			"default",
			"dashscope",
			"images.generations.multimodal"
		);
		assert.deepEqual(
			matched.map((route) => route.id),
			["passthrough"]
		);
	});

	it("listSupportedClientSurfaces keeps only public protocols and endpoints", () => {
		const routes: RouteListRow[] = [
			{
				id: "chat",
				model_id: "m1",
				provider_id: "p1",
				priority: 1,
				status: "active",
				route_group: "default",
				surfaces: JSON.stringify([
					{ request_protocol: "openai", request_operation: "chat", status: "active" },
				]),
			},
			{
				id: "gemini",
				model_id: "m1",
				provider_id: "p2",
				priority: 1,
				status: "active",
				route_group: "vip",
				surfaces: JSON.stringify([
					{ request_protocol: "gemini", request_operation: "models.generate", status: "active" },
				]),
			},
			{
				id: "disabled",
				model_id: "m1",
				provider_id: "p3",
				priority: 1,
				status: "active",
				route_group: "default",
				surfaces: JSON.stringify([
					{ request_protocol: "anthropic", request_operation: "messages", status: "disabled" },
				]),
			},
		];
		assert.deepEqual(listSupportedClientSurfaces(routes, "m1", ""), {
			protocols: ["openai"],
			openaiLlmOperations: ["chat"],
			geminiActions: [],
			imageOperations: [],
		});
		assert.deepEqual(listSupportedClientSurfaces(routes, "m1", "vip"), {
			protocols: ["gemini"],
			openaiLlmOperations: [],
			geminiActions: ["generateContent", "streamGenerateContent"],
			imageOperations: [],
		});
	});

	it("listSupportedClientSurfaces expands wildcard openai surfaces", () => {
		const routes: RouteListRow[] = [
			{
				id: "legacy",
				model_id: "m1",
				provider_id: "p1",
				priority: 1,
				status: "active",
				route_group: "default",
				upstream_protocol: "openai",
			},
		];
		assert.deepEqual(listSupportedClientSurfaces(routes, "m1", ""), {
			protocols: ["openai"],
			openaiLlmOperations: ["chat", "responses"],
			geminiActions: [],
			imageOperations: ["generations", "edits"],
		});
	});

	it("lists DashScope realtime operations from public route surfaces", () => {
		const base = {
			model_id: "m1",
			provider_id: "p1",
			priority: 1,
			status: "active",
			route_group: "default",
			upstream_protocol: "dashscope",
		};
		const routes: RouteListRow[] = [
			{
				...base,
				id: "inference",
				upstream_operation: "audio.transcriptions.realtime.inference",
				surfaces: JSON.stringify([
					{
						request_protocol: "dashscope",
						request_operation: "audio.transcriptions.realtime.inference",
						status: "active",
					},
				]),
			},
			{
				...base,
				id: "session",
				upstream_operation: "audio.transcriptions.realtime.session",
				surfaces: JSON.stringify([
					{
						request_protocol: "dashscope",
						request_operation: "audio.transcriptions.realtime.session",
						status: "active",
					},
				]),
			},
		];
		assert.deepEqual(
			listDashScopeRealtimeOperations(routes, "m1", "default", "transcriptions"),
			[
				"audio.transcriptions.realtime.inference",
				"audio.transcriptions.realtime.session",
			]
		);
	});

	it("lists DashScope HTTP multimodal alongside realtime operations", () => {
		const routes: RouteListRow[] = [
			{
				id: "http",
				model_id: "m1",
				provider_id: "p1",
				priority: 1,
				status: "active",
				route_group: "default",
				upstream_protocol: "dashscope",
				upstream_operation: "audio.transcriptions.multimodal",
				adapter: "passthrough",
				surfaces: JSON.stringify([
					{
						request_protocol: "dashscope",
						request_operation: "audio.transcriptions.multimodal",
						status: "active",
					},
				]),
			},
		];
		assert.deepEqual(listDashScopeAudioClientOperations(routes, "m1", "default", "transcriptions"), [
			"audio.transcriptions.multimodal",
		]);
	});

	it("redactAuthHeader masks sk keys", () => {
		assert.match(
			redactAuthHeader("Bearer sk-abcdefghijklmnop1234"),
			/^Bearer sk-abcdefghi…1234$/
		);
	});

	it("buildRequestLogsHref includes filters", () => {
		assert.equal(
			buildRequestLogsHref({
				apiKeyId: "k1",
				modelId: "m1",
				routeGroup: "vip",
				protocol: "openai",
			}),
			"/gateway/request-logs?api_key_id=k1&model_id=m1&route_group=vip&protocol=openai"
		);
		assert.equal(
			buildRequestLogsHref({ routeGroup: "default" }),
			"/gateway/request-logs"
		);
	});

	it("isBodyDirty detects edits", () => {
		assert.equal(
			isBodyDirty(
				`{
  "model": "<auto>",
  "messages": [{ "role": "user", "content": "Hello" }],
  "max_tokens": 256,
  "stream": true,
  "stream_options": { "include_usage": true }
}`,
				"openai"
			),
			false
		);
		assert.equal(isBodyDirty('{ "messages": [] }', "openai"), true);
		const gptTemplate = imageBodyTemplateFor({
			protocol: "openai",
			providerModelName: "gpt-image-2",
		});
		assert.equal(
			isBodyDirty(
				gptTemplate,
				"openai",
				true,
				"generations",
				null,
				null,
				null,
				"gpt-image-2",
			),
			false
		);
		assert.equal(isBodyDirty(gptTemplate, "openai", false), true);
	});

	it("bodyTemplateForSelection uses OpenAI Responses template", () => {
		assert.equal(
			bodyTemplateForSelection(
				"openai",
				false,
				"generations",
				null,
				undefined,
				undefined,
				undefined,
				"responses"
			),
			OPENAI_RESPONSES_BODY_TEMPLATE
		);
		assert.equal(
			isBodyDirty(
				OPENAI_RESPONSES_BODY_TEMPLATE,
				"openai",
				false,
				"generations",
				null,
				undefined,
				undefined,
				undefined,
				"responses"
			),
			false
		);
		assert.equal(
			isBodyDirty(
				OPENAI_RESPONSES_BODY_TEMPLATE,
				"openai",
				false,
				"generations",
				null,
				undefined,
				undefined,
				undefined,
				"chat"
			),
			true
		);
	});

	it("bodyTemplateForSelection switches image generations/edits templates", () => {
		const unknown = JSON.parse(bodyTemplateForSelection("openai", true)) as { size?: string; n?: number };
		assert.equal(unknown.size, undefined);
		assert.equal(unknown.n, 1);
		const gptEdits = JSON.parse(
			bodyTemplateForSelection("openai", true, "edits", null, null, null, "gpt-image-2"),
		) as { prompt?: string; size?: string; quality?: string };
		assert.equal(gptEdits.prompt, "make the apple green");
		assert.equal(gptEdits.size, "1024x1024");
		assert.equal(gptEdits.quality, "low");
		assert.notEqual(bodyTemplateForSelection("openai", false), bodyTemplateForSelection("openai", true));
		const seedreamLite = JSON.parse(
			bodyTemplateForSelection(
				"openai",
				true,
				"generations",
				null,
				null,
				null,
				"doubao-seedream-5-0-260128",
			),
		) as { size?: string; quality?: string };
		assert.equal(seedreamLite.size, "2K");
		assert.equal(seedreamLite.quality, undefined);
		const seedreamPro = JSON.parse(
			bodyTemplateForSelection("openai", true, "generations", null, null, null, "doubao-seedream-5-0-pro"),
		) as { size?: string };
		assert.equal(seedreamPro.size, "1K");
		const seedreamFlash = JSON.parse(
			bodyTemplateForSelection("openai", true, "generations", null, null, null, "doubao-seedream-5-0-flash"),
		) as { size?: string };
		assert.equal(seedreamFlash.size, "1K");
		const nativePro = JSON.parse(
			bodyTemplateForSelection(
				"volcengine",
				true,
				"generations",
				null,
				null,
				null,
				"doubao-seedream-5-0-pro",
			),
		) as { size?: string };
		assert.equal(nativePro.size, "1K");
		assert.equal(bodyTemplateForSelection("volcengine", true), VOLCENGINE_IMAGE_BODY_TEMPLATE);
		assert.equal(
			isBodyDirty(
				bodyTemplateForSelection("openai", true, "generations", null, null, null, "gpt-image-2"),
				"openai",
				true,
				"generations",
				null,
				null,
				null,
				"gpt-image-2",
			),
			false,
		);
	});

	it("bodyTemplateForSelection uses audio transcriptions template", () => {
		assert.equal(
			bodyTemplateForSelection(
				"openai",
				false,
				"generations",
				"transcriptions"
			),
			AUDIO_TRANSCRIPTIONS_BODY_TEMPLATE
		);
		assert.equal(
			isBodyDirty(
				AUDIO_TRANSCRIPTIONS_BODY_TEMPLATE,
				"openai",
				false,
				"generations",
				"transcriptions"
			),
			false
		);
		assert.equal(
			bodyTemplateForSelection("openai", false, "generations", "speech"),
			AUDIO_SPEECH_BODY_TEMPLATE
		);
		assert.equal(
			JSON.parse(
				bodyTemplateForSelection(
					"openai",
					false,
					"generations",
					"speech",
					undefined,
					undefined,
					"cosyvoice-v2"
				)
			).voice,
			"longxiaochun_v2"
		);
		assert.equal(
			isBodyDirty(
				bodyTemplateForSelection(
					"openai",
					false,
					"generations",
					"speech",
					undefined,
					undefined,
					"cosyvoice-v2"
				),
				"openai",
				false,
				"generations",
				"speech",
				undefined,
				undefined,
				"cosyvoice-v2"
			),
			false
		);
		assert.equal(
			JSON.parse(AUDIO_SPEECH_BODY_TEMPLATE).response_format,
			"wav"
		);
		assert.equal(
			bodyTemplateForSelection(
				"openai",
				false,
				"generations",
				"speech",
				undefined,
				undefined,
				"speech-2.8-turbo"
			),
			MINIMAX_OPENAI_SPEECH_BODY_TEMPLATE
		);
		const minimax = JSON.parse(
			bodyTemplateForSelection(
				"openai",
				true,
				"generations",
				null,
				undefined,
				undefined,
				"image-01"
			),
		) as { aspect_ratio?: string; size?: string };
		assert.equal(minimax.aspect_ratio, "1:1");
		assert.equal(minimax.size, undefined);
		const sessionTemplate = JSON.parse(
			bodyTemplateForSelection(
				"dashscope",
				false,
				"generations",
				"transcriptions",
				null,
				"audio.transcriptions.realtime.session"
			)
		) as { type?: string; session?: { input_audio_format?: string } };
		assert.equal(sessionTemplate.type, "session.update");
		assert.equal(sessionTemplate.session?.input_audio_format, "pcm");
	});

	it("mergeAssistantTextParts extracts transcription and DashScope audio text", () => {
		assert.deepEqual(
			mergeAssistantTextParts('{"text":"hello"}', "openai", "json"),
			{ reasoning: "", body: "hello" }
		);
		assert.deepEqual(
			mergeAssistantTextParts('{"output":{"text":"你好"}}', "openai", "json"),
			{ reasoning: "", body: "你好" }
		);
	});

	it("mergeAssistantTextParts extracts OpenAI Responses JSON and SSE", () => {
		assert.deepEqual(
			mergeAssistantTextParts(
				JSON.stringify({
					output: [
						{
							type: "reasoning",
							summary: [{ type: "summary_text", text: "think" }],
						},
						{
							type: "message",
							content: [{ type: "output_text", text: "hi" }],
						},
					],
				}),
				"openai",
				"json"
			),
			{ reasoning: "think", body: "hi" }
		);
		assert.deepEqual(
			mergeAssistantTextParts(
				JSON.stringify({ output: [], output_text: "fallback" }),
				"openai",
				"json"
			),
			{ reasoning: "", body: "fallback" }
		);
		assert.deepEqual(
			mergeAssistantTextParts(
				[
					'data: {"type":"response.reasoning_summary_text.delta","delta":"think"}',
					'data: {"type":"response.output_text.delta","delta":"hi"}',
				].join("\n"),
				"openai",
				"sse"
			),
			{ reasoning: "think", body: "hi" }
		);
	});

	it("mergeAssistantTextParts replaces cumulative DashScope realtime NDJSON sentences", () => {
		const raw = [
			JSON.stringify({ header: { event: "task-started" }, payload: {} }),
			JSON.stringify({
				header: { event: "result-generated" },
				payload: { output: { sentence: { sentence_id: 1, text: "123" }, text: "123" } },
			}),
			JSON.stringify({
				header: { event: "result-generated" },
				payload: {
					output: {
						sentence: { sentence_id: 1, text: "123四五。", sentence_end: true },
						text: "123四五。",
					},
				},
			}),
			JSON.stringify({ header: { event: "task-finished" }, payload: { output: {} } }),
		].join("\n");

		assert.equal(inferPlaygroundParseMode("application/x-ndjson"), "ndjson");
		assert.deepEqual(
			mergeAssistantTextParts(raw, "dashscope", "ndjson"),
			{ reasoning: "", body: "123四五。" }
		);
	});

	it("tryParseUsageSummary displays DashScope audio duration", () => {
		assert.equal(
			tryParseUsageSummary('{"usage":{"duration":4}}', "dashscope"),
			"duration: 4s"
		);
	});
});
