/**
 * Build Proxy-facing requests from the browser: URL, headers, and JSON body per protocol
 * (including OpenAI/Anthropic `model` field) or Agent Tools (`/v1/tools/*`).
 */
import { applyGeminiStreamQueryParams } from "@octafuse/core/gemini-upstream-url";
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

/** 构造 DashScope 原生实时入口的浏览器 WebSocket URL（鉴权在子协议中完成）。 */
export function buildSimulatorDashScopeRealtimeUrl(input: {
	baseUrl: string;
	modelForRouting: string;
	operation: string;
}): string {
	const base = stripTrailingSlash(input.baseUrl.trim());
	const url = new URL(`${base}/v1/dashscope/realtime`);
	if (url.protocol === "http:") url.protocol = "ws:";
	if (url.protocol === "https:") url.protocol = "wss:";
	url.searchParams.set("model", input.modelForRouting);
	url.searchParams.set("operation", input.operation);
	return url.toString();
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
	if (input.audioOperation) return "audio";
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
			if (kind === "audio") {
				const audioOperation = input.audioOperation ?? "transcriptions";
				if (audioOperation === "speech") {
					const merged = { ...input.body, model: input.modelForRouting };
					const path = resolveProxyPathForModelInvoke({
						kind: "audio",
						protocol: "openai",
						audioOperation,
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
					kind: "audio",
					protocol: "openai",
					audioOperation,
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
				kind: kind === "image" ? "image" : "llm",
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
			const action: SimulatorGeminiAction =
				input.geminiAction === "generateContent"
					? "generateContent"
					: "streamGenerateContent";
			const path = resolveProxyPathForModelInvoke({
				kind: "llm",
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
		case "dashscope": {
			if (input.dashscopeRequestOperation === "audio.transcriptions.multimodal") {
				const path = resolveProxyPathForModelInvoke({
					kind: "audio",
					protocol: "dashscope",
					audioOperation: "transcriptions",
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
			throw new Error(
				"DashScope realtime requests must use the WebSocket simulator path"
			);
		}
		default: {
			const _exhaustive: never = input.protocol;
			throw new Error(`Unsupported protocol: ${String(_exhaustive)}`);
		}
	}
}
