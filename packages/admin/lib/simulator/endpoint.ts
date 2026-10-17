/**
 * Build Proxy-facing requests from the browser: URL, headers, and JSON body per protocol
 * (including OpenAI/Anthropic `model` field) or Agent Tools (`/v1/tools/*`).
 */
import { applyGeminiStreamQueryParams } from "@octafuse/core/gemini-upstream-url";
import { requestSurfacePath } from "@octafuse/core/adapters/registry";
import {
	DASHSCOPE_REALTIME_INFERENCE_PATH,
	DASHSCOPE_REALTIME_SESSION_PATH,
	ELEVENLABS_SPEECH_TO_TEXT_REALTIME_PATH,
	ELEVENLABS_TEXT_TO_SPEECH_REALTIME_PATH,
} from "@octafuse/core/route-topology";
import {
	ELEVENLABS_TTS_VARIANTS,
	elevenLabsTtsVariantSuffix,
	isValidElevenLabsVoiceId,
	type ElevenLabsTtsVariant,
} from "@octafuse/core/elevenlabs-native";
import { splitElevenLabsTtsQuery } from "@octafuse/core/elevenlabs-openai";
import { openaiEditImageFormField, type ImageOperation } from "@/lib/image-generations";
import {
	parseGatewayToolId,
	proxyToolPath,
	resolveProxyPathForModelInvoke,
	type AudioOperation,
	type GeminiContentAction,
	type InvokeKind,
	type OpenaiLlmOperation,
	type SimulatorProtocol,
} from "@/lib/invoke-kind";

export type { SimulatorProtocol };
export type SimulatorGeminiAction = GeminiContentAction;

export type BuildSimulatorRequestInput = {
	/** Trimmed Proxy root URL without a trailing slash, e.g. https://gateway.example.com */
	baseUrl: string;
	/**
	 * Invoke kind. When `tool`, builds `POST /v1/tools/{toolId}` (protocol/model ignored).
	 * Default inferred from audio/image flags for backward compatibility.
	 */
	kind?: InvokeKind;
	/** Required when `kind === 'tool'`. */
	toolId?: string;
	protocol: SimulatorProtocol;
	/**
	 * OpenAI/Anthropic `body.model`, or the Gemini path model segment (may include `id:route_group`).
	 * Matches Proxy `resolveModelRouting`: full id, or `baseId:group`.
	 * Ignored for tools.
	 */
	modelForRouting: string;
	geminiAction?: SimulatorGeminiAction;
	/** User-edited JSON object (`model` is overwritten for OpenAI/Anthropic before send) */
	body: Record<string, unknown>;
	/** Full `sk-…` or already prefixed with Bearer */
	apiKey: string;
	/**
	 * OpenAI image models: Proxy `POST /v1/images/generations` or `/v1/images/edits`.
	 * Prefer over legacy `imagesGenerations`.
	 */
	imageOperation?: ImageOperation;
	/**
	 * @deprecated Use `imageOperation: 'generations'` instead.
	 * OpenAI only: use Proxy `POST /v1/images/generations` instead of chat completions.
	 */
	imagesGenerations?: boolean;
	/** Required when `imageOperation === 'edits'`: reference image files for multipart. */
	editImages?: File[];
	/** OpenAI LLM 入口：默认 chat（`/v1/chat/completions`），`responses` 打 `/v1/responses`。 */
	llmOperation?: OpenaiLlmOperation;
	/** OpenAI-compatible audio operation; transcriptions use multipart, speech uses JSON. */
	audioOperation?: AudioOperation;
	/** Required when `audioOperation === 'transcriptions'`: audio file for multipart. */
	audioFile?: File | null;
	/** DashScope 客户端 operation；`audio.transcriptions.multimodal` 走同步 HTTP，其余实时 WSS。 */
	dashscopeRequestOperation?: string;
};

export type BuildSimulatorRequestResult = {
	url: string;
	headers: Record<string, string>;
	/** JSON.stringify result (empty string when `formData` is set) */
	bodyText: string;
	/** Multipart body for images/edits; when set, caller must not set Content-Type. */
	formData?: FormData;
	/** Human-readable summary for wire preview when body is multipart. */
	multipartSummary?: string;
};

/**
 * 构造 DashScope 原生实时入口的浏览器 WebSocket URL（鉴权在子协议中完成），路径与官方一致：
 * - inference（run-task）：`/dashscope/api-ws/v1/inference`，不带查询参数，模型写在 run-task 的 `payload.model`；
 * - session：`/dashscope/api-ws/v1/realtime?model=`，升级前按模型选路由。
 */
export function buildSimulatorDashScopeRealtimeUrl(input: {
	baseUrl: string;
	modelForRouting: string;
	operation: string;
}): string {
	const base = stripTrailingSlash(input.baseUrl.trim());
	const isInference = input.operation.endsWith(".inference");
	const url = new URL(
		`${base}${isInference ? DASHSCOPE_REALTIME_INFERENCE_PATH : DASHSCOPE_REALTIME_SESSION_PATH}`
	);
	if (url.protocol === "http:") url.protocol = "ws:";
	if (url.protocol === "https:") url.protocol = "wss:";
	if (!isInference) url.searchParams.set("model", input.modelForRouting);
	return url.toString();
}

/**
 * 构造 ElevenLabs 原生实时入口的浏览器 WebSocket URL，路径与官方一致：
 * - 实时转写：`/elevenlabs/v1/speech-to-text/realtime?model_id=`
 * - 语音合成：`/elevenlabs/v1/text-to-speech/{voice_id}/stream-input?model_id=`
 * 模型在 query 的 `model_id`，升级前按它选路由；鉴权走 Sec-WebSocket-Protocol。
 * `query` 不应包含 `model_id`，由 `modelForRouting` 写入。
 */
export function buildSimulatorElevenLabsRealtimeUrl(input: {
	baseUrl: string;
	modelForRouting: string;
	operation: string;
	voiceId?: string;
	query?: Record<string, string>;
}): string {
	const base = stripTrailingSlash(input.baseUrl.trim());
	const isSpeech = input.operation === "audio.speech.realtime";
	if (isSpeech && !isValidElevenLabsVoiceId(input.voiceId ?? "")) {
		throw new Error("ElevenLabs speech requires body.voice_id");
	}
	const path = isSpeech
		? ELEVENLABS_TEXT_TO_SPEECH_REALTIME_PATH.replace(
				"{voice_id}",
				encodeURIComponent(input.voiceId ?? "")
			)
		: ELEVENLABS_SPEECH_TO_TEXT_REALTIME_PATH;
	const url = new URL(`${base}${path}`);
	if (url.protocol === "http:") url.protocol = "ws:";
	if (url.protocol === "https:") url.protocol = "wss:";
	for (const [key, value] of Object.entries(input.query ?? {})) {
		if (key === "model_id") continue;
		url.searchParams.set(key, value);
	}
	url.searchParams.set("model_id", input.modelForRouting);
	return url.toString();
}

/**
 * inference（run-task）入口按帧里的 `payload.model` 选路由：
 * 把 Gateway 模型 ID 写进 run-task；其它 operation（session）原样返回。
 */
export function withDashScopeRunTaskModel(
	body: Record<string, unknown>,
	operation: string,
	modelForRouting: string
): Record<string, unknown> {
	if (!operation.endsWith(".inference")) return body;
	const payload =
		body.payload != null && typeof body.payload === "object" && !Array.isArray(body.payload)
			? (body.payload as Record<string, unknown>)
			: {};
	return { ...body, payload: { ...payload, model: modelForRouting } };
}

function stripTrailingSlash(u: string): string {
	return u.replace(/\/$/, "");
}

function bearerHeader(apiKey: string): string {
	const t = apiKey.trim();
	if (t.toLowerCase().startsWith("bearer ")) return t;
	return `Bearer ${t}`;
}

function resolveImageOperation(
	input: BuildSimulatorRequestInput
): ImageOperation | null {
	if (
		input.imageOperation === "generations" ||
		input.imageOperation === "edits"
	) {
		return input.imageOperation;
	}
	if (input.imagesGenerations) return "generations";
	return null;
}

function resolveKind(input: BuildSimulatorRequestInput): InvokeKind {
	if (input.kind) return input.kind;
	if (input.audioOperation) return input.audioOperation === "speech" ? "tts" : "asr";
	if (resolveImageOperation(input) != null) return "image";
	return "llm";
}

function appendOptionalFormField(
	fd: FormData,
	key: string,
	value: unknown
): void {
	if (value == null) return;
	if (typeof value === "string") {
		const t = value.trim();
		if (t !== "") fd.append(key, t);
		return;
	}
	if (typeof value === "number" && Number.isFinite(value)) {
		fd.append(key, String(value));
	}
}

/**
 * Build `fetch` arguments for the Proxy (no `signal`).
 */
export function buildSimulatorRequest(
	input: BuildSimulatorRequestInput
): BuildSimulatorRequestResult {
	const base = stripTrailingSlash(input.baseUrl.trim());
	const auth = bearerHeader(input.apiKey);
	const kind = resolveKind(input);

	if (kind === "tool") {
		const toolId = parseGatewayToolId(input.toolId);
		if (!toolId) {
			throw new Error(`Unsupported toolId: ${String(input.toolId)}`);
		}
		return {
			url: `${base}${proxyToolPath(toolId)}`,
			headers: {
				"Content-Type": "application/json",
				Authorization: auth,
			},
			bodyText: JSON.stringify(input.body),
		};
	}

	switch (input.protocol) {
		case "openai": {
			if (kind === "asr" || kind === "tts") {
				if (kind === "tts") {
					const merged = { ...input.body, model: input.modelForRouting };
					const path = resolveProxyPathForModelInvoke({
						kind: "tts",
						protocol: "openai",
					});
					return {
						url: `${base}${path}`,
						headers: {
							"Content-Type": "application/json",
							Authorization: auth,
						},
						bodyText: JSON.stringify(merged),
					};
				}
				const file = input.audioFile ?? null;
				const fd = new FormData();
				fd.append("model", input.modelForRouting);
				appendOptionalFormField(fd, "language", input.body.language);
				appendOptionalFormField(
					fd,
					"response_format",
					input.body.response_format
				);
				appendOptionalFormField(fd, "prompt", input.body.prompt);
				appendOptionalFormField(fd, "temperature", input.body.temperature);
				appendOptionalFormField(fd, "file_url", input.body.file_url);
				const fileLines: string[] = [];
				if (file) {
					fd.append("file", file, file.name || "audio.webm");
					fileLines.push(`${file.name || "audio.webm"} (${file.size} bytes)`);
				}
				const fieldParts = ["model", "file"];
				if (input.body.language != null) fieldParts.push("language");
				if (input.body.response_format != null)
					fieldParts.push("response_format");
				if (input.body.prompt != null) fieldParts.push("prompt");
				if (input.body.temperature != null) fieldParts.push("temperature");
				if (input.body.file_url != null) fieldParts.push("file_url");
				const fileUrl =
					typeof input.body.file_url === "string" ? input.body.file_url.trim() : "";
				const fileSummary = fileUrl
					? `file_url: ${fileUrl}`
					: !file
						? "file: (none selected yet — required before Send)"
						: [`file:`, ...fileLines.map((l) => `  - ${l}`)].join("\n");
				const path = resolveProxyPathForModelInvoke({
					kind: "asr",
					protocol: "openai",
				});
				return {
					url: `${base}${path}`,
					headers: {
						Authorization: auth,
					},
					bodyText: "",
					formData: fd,
					multipartSummary: [
						`multipart/form-data fields: ${fieldParts.join(", ")}`,
						fileSummary,
					].join("\n"),
				};
			}
			const imageOp = resolveImageOperation(input);
			if (kind === "image" && imageOp === "edits") {
				// Allow empty files for live URL preview; Send path validates before fetch.
				const files = input.editImages ?? [];
				const fd = new FormData();
				fd.append("model", input.modelForRouting);
				appendOptionalFormField(fd, "prompt", input.body.prompt);
				appendOptionalFormField(fd, "n", input.body.n);
				appendOptionalFormField(fd, "size", input.body.size);
				appendOptionalFormField(fd, "quality", input.body.quality);
				appendOptionalFormField(fd, "background", input.body.background);
				const fileLines: string[] = [];
				const imageField = openaiEditImageFormField(files.length);
				for (const file of files) {
					fd.append(imageField, file, file.name || "image.png");
					fileLines.push(`${file.name || "image.png"} (${file.size} bytes)`);
				}
				const fieldParts = ["model", "prompt"];
				if (input.body.n != null) fieldParts.push("n");
				if (input.body.size != null) fieldParts.push("size");
				if (input.body.quality != null) fieldParts.push("quality");
				if (input.body.background != null) fieldParts.push("background");
				const imageSummary =
					files.length === 0
						? "images: (none selected yet — required before Send)"
						: [
								`images (${files.length}):`,
								...fileLines.map((l) => `  - ${l}`),
						  ].join("\n");
				const path = resolveProxyPathForModelInvoke({
					kind: "image",
					protocol: "openai",
					imageOperation: "edits",
				});
				return {
					url: `${base}${path}`,
					headers: {
						Authorization: auth,
					},
					bodyText: "",
					formData: fd,
					multipartSummary: [
						`multipart/form-data fields: ${fieldParts.join(", ")}`,
						imageSummary,
					].join("\n"),
				};
			}
			const merged = { ...input.body, model: input.modelForRouting };
			const path = resolveProxyPathForModelInvoke({
				kind: kind === "image" ? "image" : kind === "embedding" ? "embedding" : "llm",
				protocol: "openai",
				imageOperation: imageOp === "generations" ? "generations" : undefined,
				llmOperation: input.llmOperation,
			});
			return {
				url: `${base}${path}`,
				headers: {
					"Content-Type": "application/json",
					Authorization: auth,
				},
				bodyText: JSON.stringify(merged),
			};
		}
		case "anthropic": {
			const merged = { ...input.body, model: input.modelForRouting };
			const path = resolveProxyPathForModelInvoke({
				kind: "llm",
				protocol: "anthropic",
			});
			return {
				url: `${base}${path}`,
				headers: {
					"Content-Type": "application/json",
					Authorization: auth,
				},
				bodyText: JSON.stringify(merged),
			};
		}
		case "gemini": {
			if (kind === "embedding") {
				const embedAction = Array.isArray(input.body.requests)
					? "batchEmbedContents"
					: "embedContent";
				const embedPath = resolveProxyPathForModelInvoke({
					kind: "embedding",
					protocol: "gemini",
					geminiEmbedAction: embedAction,
					geminiModelSegment: input.modelForRouting,
				});
				return {
					url: `${base}${embedPath}`,
					headers: {
						"Content-Type": "application/json",
						Authorization: auth,
					},
					bodyText: JSON.stringify(input.body),
				};
			}
			const action: SimulatorGeminiAction =
				kind === "image"
					? "generateContent"
					: input.geminiAction === "generateContent"
						? "generateContent"
						: "streamGenerateContent";
			const path = resolveProxyPathForModelInvoke({
				kind: kind === "image" ? "image" : "llm",
				protocol: "gemini",
				geminiAction: action,
				geminiModelSegment: input.modelForRouting,
			});
			const url = new URL(`${base}${path}`);
			applyGeminiStreamQueryParams(url, action);
			return {
				url: url.toString(),
				headers: {
					"Content-Type": "application/json",
					Authorization: auth,
				},
				bodyText: JSON.stringify(input.body),
			};
		}
		case "volcengine": {
			if (kind !== "image") {
				throw new Error("Volcengine simulator currently supports image generation only");
			}
			const path = resolveProxyPathForModelInvoke({
				kind: "image",
				protocol: "volcengine",
				imageOperation: "generations",
			});
			const merged = { ...input.body, model: input.modelForRouting };
			return {
				url: `${base}${path}`,
				headers: {
					"Content-Type": "application/json",
					Authorization: auth,
				},
				bodyText: JSON.stringify(merged),
			};
		}
		case "elevenlabs": {
			if (kind === "tts") {
				// 原生入口：voice_id / variant 进路径，output_format 等进 query，其余作为 JSON body。
				const { voice_id, variant, output_format, ...rest } = input.body;
				const voiceId = typeof voice_id === "string" ? voice_id.trim() : "";
				if (!isValidElevenLabsVoiceId(voiceId)) {
					throw new Error("ElevenLabs speech requires body.voice_id");
				}
				const variantName = typeof variant === "string" && variant.trim() ? variant.trim() : "speech";
				if (!(ELEVENLABS_TTS_VARIANTS as readonly string[]).includes(variantName)) {
					throw new Error(`body.variant must be one of ${ELEVENLABS_TTS_VARIANTS.join(", ")}`);
				}
				const split = splitElevenLabsTtsQuery(rest);
				const basePath = resolveProxyPathForModelInvoke({ kind: "tts", protocol: "elevenlabs" }).replace(
					"{voice_id}",
					encodeURIComponent(voiceId)
				);
				const query: Record<string, string> = { ...split.query };
				if (typeof output_format === "string" && output_format.trim()) query.output_format = output_format.trim();
				const qs = new URLSearchParams(query).toString();
				return {
					url: `${base}${basePath}${elevenLabsTtsVariantSuffix(variantName as ElevenLabsTtsVariant)}${qs ? `?${qs}` : ""}`,
					headers: {
						"Content-Type": "application/json",
						Authorization: auth,
					},
					bodyText: JSON.stringify({ ...split.body, model_id: input.modelForRouting }),
				};
			}
			if (kind !== "asr") {
				throw new Error("ElevenLabs simulator supports speech-to-text and text-to-speech");
			}
			const file = input.audioFile ?? null;
			const fd = new FormData();
			fd.append("model_id", input.modelForRouting);
			const skip = new Set(["model", "model_id", "file", "audio", "file_name", "filename"]);
			const fieldParts = ["model_id", "file"];
			for (const [key, value] of Object.entries(input.body)) {
				if (skip.has(key)) continue;
				if (typeof value === "boolean") {
					fd.append(key, String(value));
					fieldParts.push(key);
					continue;
				}
				appendOptionalFormField(fd, key, value);
				if (value != null && String(value).trim() !== "") fieldParts.push(key);
			}
			if (file) fd.append("file", file, file.name || "audio.wav");
			return {
				url: `${base}${resolveProxyPathForModelInvoke({ kind: "asr", protocol: "elevenlabs" })}`,
				headers: {
					Authorization: auth,
				},
				bodyText: "",
				formData: fd,
				multipartSummary: [
					`multipart/form-data fields: ${fieldParts.join(", ")}`,
					file ? `file: ${file.name || "audio.wav"} (${file.size} bytes)` : "file: (none selected yet — required before Send)",
				].join("\n"),
			};
		}
		case "minimax": {
			if (kind === "image" || kind === "tts") {
				const path = resolveProxyPathForModelInvoke({
					kind: kind === "image" ? "image" : "tts",
					protocol: "minimax",
					imageOperation: kind === "image" ? "generations" : undefined,
				});
				const merged = { ...input.body, model: input.modelForRouting };
				return {
					url: `${base}${path}`,
					headers: {
						"Content-Type": "application/json",
						Authorization: auth,
					},
					bodyText: JSON.stringify(merged),
				};
			}
			if (kind !== "asr") {
				throw new Error("MiniMax simulator supports file transcriptions, speech, and image generation");
			}
			const file = input.audioFile ?? null;
			const fd = new FormData();
			fd.append("model", input.modelForRouting);
			const skip = new Set(["model", "file", "audio", "file_name", "filename"]);
			const fieldParts = ["model", "file"];
			for (const [key, value] of Object.entries(input.body)) {
				if (skip.has(key)) continue;
				appendOptionalFormField(fd, key, value);
				if (value != null && String(value).trim() !== "") fieldParts.push(key);
			}
			const fileLines: string[] = [];
			if (file) {
				fd.append("file", file, file.name || "audio.wav");
				fileLines.push(`${file.name || "audio.wav"} (${file.size} bytes)`);
			}
			const fileSummary = !file
				? "file: (none selected yet — required before Send)"
				: [`file:`, ...fileLines.map((line) => `  - ${line}`)].join("\n");
			const path = resolveProxyPathForModelInvoke({
				kind: "asr",
				protocol: "minimax",
			});
			return {
				url: `${base}${path}`,
				headers: {
					Authorization: auth,
				},
				bodyText: "",
				formData: fd,
				multipartSummary: [
					`multipart/form-data fields: ${fieldParts.join(", ")}`,
					fileSummary,
					"language is forwarded as the MiniMax language header",
				].join("\n"),
			};
		}
		case "dashscope": {
			const operation =
				input.kind === "image"
					? "images.generations.multimodal"
					: input.dashscopeRequestOperation;
			if (!operation || operation.includes(".realtime.")) {
				throw new Error(
					"DashScope realtime requests must use the WebSocket simulator path"
				);
			}
			const path = requestSurfacePath("dashscope", operation);
			const headers: Record<string, string> = {
				"Content-Type": "application/json",
				Authorization: auth,
			};
			if (operation === "audio.speech.stream") headers["X-DashScope-SSE"] = "enable";
			if (operation === "audio.transcriptions.async") headers["X-DashScope-Async"] = "enable";
			const merged = { ...input.body, model: input.modelForRouting };
			return {
				url: `${base}${path}`,
				headers,
				bodyText: JSON.stringify(merged),
			};
		}
		default: {
			const _exhaustive: never = input.protocol;
			throw new Error(`Unsupported protocol: ${String(_exhaustive)}`);
		}
	}
}
