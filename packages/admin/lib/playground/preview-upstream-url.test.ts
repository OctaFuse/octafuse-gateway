import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { describePlaygroundUpstreamUrl, previewPlaygroundUpstreamUrl } from "./preview-upstream-url";

describe("previewPlaygroundUpstreamUrl", () => {
	it("builds wangsu-style image URL without appending /images/generations", () => {
		const url = previewPlaygroundUpstreamUrl({
			provider: {
				id: "p1",
				endpoints: JSON.stringify({
					openai: {
						base: "https://aigateway.edgecloudapp.com/v1/abc/openai-image-generations",
					},
				}),
			},
			upstreamProtocol: "openai",
			providerModelName: "gpt-image-2",
			isImageModel: true,
		});
		assert.equal(
			url,
			"https://aigateway.edgecloudapp.com/v1/abc/openai-image-generations"
		);
	});

	it("appends /images/generations for standard OpenAI roots", () => {
		const url = previewPlaygroundUpstreamUrl({
			provider: {
				id: "p1",
				endpoints: JSON.stringify({
					openai: { base: "https://api.openai.com/v1" },
				}),
			},
			upstreamProtocol: "openai",
			providerModelName: "gpt-image-2",
			isImageModel: true,
		});
		assert.equal(url, "https://api.openai.com/v1/images/generations");
	});

	it("appends /images/edits when imageOperation is edits", () => {
		const url = previewPlaygroundUpstreamUrl({
			provider: {
				id: "p1",
				endpoints: JSON.stringify({
					openai: { base: "https://api.openai.com/v1" },
				}),
			},
			upstreamProtocol: "openai",
			providerModelName: "gpt-image-2",
			isImageModel: true,
			imageOperation: "edits",
		});
		assert.equal(url, "https://api.openai.com/v1/images/edits");
	});

	it("appends /audio/transcriptions for audio models", () => {
		const url = previewPlaygroundUpstreamUrl({
			provider: {
				id: "p1",
				endpoints: JSON.stringify({
					openai: { base: "https://api.openai.com/v1" },
				}),
			},
			upstreamProtocol: "openai",
			providerModelName: "whisper-1",
			isImageModel: false,
			isAudioModel: true,
		});
		assert.equal(url, "https://api.openai.com/v1/audio/transcriptions");
	});

	it("appends /audio/speech for an OpenAI TTS route", () => {
		const url = previewPlaygroundUpstreamUrl({
			provider: {
				id: "p1",
				endpoints: JSON.stringify({
					openai: { base: "https://api.openai.com/v1" },
				}),
			},
			upstreamProtocol: "openai",
			upstreamOperation: "audio.speech",
			providerModelName: "fss-cosyvoice-v2",
			isImageModel: false,
			isAudioModel: true,
		});
		assert.equal(url, "https://api.openai.com/v1/audio/speech");
	});

	it("builds the DashScope multimodal ASR URL from the selected route operation", () => {
		const url = previewPlaygroundUpstreamUrl({
			provider: {
				id: "p1",
				endpoints: JSON.stringify({
					dashscope: { base: "https://dashscope.aliyuncs.com/api/v1" },
				}),
			},
			upstreamProtocol: "dashscope",
			upstreamOperation: "audio.transcriptions.multimodal",
			providerModelName: "fun-asr-realtime",
			isImageModel: false,
			isAudioModel: true,
		});
		assert.equal(
			url,
			"https://dashscope.aliyuncs.com/api/v1/services/aigc/multimodal-generation/generation"
		);
	});

	it("builds the DashScope multimodal image URL from the selected route operation", () => {
		const url = previewPlaygroundUpstreamUrl({
			provider: {
				id: "p1",
				endpoints: JSON.stringify({
					dashscope: {
						endpoints: {
							"images.generations.multimodal":
								"https://token-plan.maas.qianwenaiapi.com/api/v1/services/aigc/multimodal-generation/generation",
						},
					},
				}),
			},
			upstreamProtocol: "dashscope",
			upstreamOperation: "images.generations.multimodal",
			providerModelName: "qwen-image-3.0-pro",
			isImageModel: true,
		});
		assert.equal(
			url,
			"https://token-plan.maas.qianwenaiapi.com/api/v1/services/aigc/multimodal-generation/generation"
		);
	});

	it("derives the MiniMax speech_to_text URL from the API base", () => {
		const url = previewPlaygroundUpstreamUrl({
			provider: {
				id: "p1",
				endpoints: JSON.stringify({
					minimax: { base: "https://api.minimaxi.com/v1" },
				}),
			},
			upstreamProtocol: "minimax",
			upstreamOperation: "audio.transcriptions",
			providerModelName: "asr-1.0",
			isImageModel: false,
			isAudioModel: true,
		});
		assert.equal(url, "https://api.minimaxi.com/v1/speech_to_text");
	});

	it("derives MiniMax t2a_v2 and image_generation URLs from the API base", () => {
		const provider = {
			id: "p1",
			endpoints: JSON.stringify({
				minimax: { base: "https://api.minimaxi.com/v1" },
			}),
		};
		assert.equal(
			previewPlaygroundUpstreamUrl({
				provider,
				upstreamProtocol: "minimax",
				upstreamOperation: "audio.speech",
				providerModelName: "speech-2.8-turbo",
				isImageModel: false,
				isAudioModel: true,
			}),
			"https://api.minimaxi.com/v1/t2a_v2",
		);
		assert.equal(
			previewPlaygroundUpstreamUrl({
				provider,
				upstreamProtocol: "minimax",
				upstreamOperation: "images.generations",
				providerModelName: "image-01",
				isImageModel: true,
				isAudioModel: false,
			}),
			"https://api.minimaxi.com/v1/image_generation",
		);
		assert.equal(
			previewPlaygroundUpstreamUrl({
				provider: {
					id: "p1",
					endpoints: JSON.stringify({
						volcengine: { base: "https://ark.cn-beijing.volces.com/api/v3" },
					}),
				},
				upstreamProtocol: "volcengine",
				upstreamOperation: "images.generations",
				providerModelName: "doubao-seedream-5-0-260128",
				isImageModel: true,
				isAudioModel: false,
			}),
			"https://ark.cn-beijing.volces.com/api/v3/images/generations",
		);
	});

	it("resolves conversion adapters from the target protocol, ignoring client-protocol endpoints", () => {
		const provider = {
			id: "p1",
			endpoints: JSON.stringify({
				openai: {
					endpoints: {
						chat: "https://ark.cn-beijing.volces.com/api/v3/chat/completions",
						"images.generations": "https://wrong.example/v1/images/generations",
					},
				},
				volcengine: { base: "https://ark.cn-beijing.volces.com/api/v3" },
				dashscope: { base: "https://dashscope.aliyuncs.com/api/v1" },
				minimax: { base: "https://api.minimaxi.com/v1" },
			}),
		};
		assert.equal(
			previewPlaygroundUpstreamUrl({
				provider,
				adapter: "volcengine-image",
				upstreamProtocol: "openai",
				upstreamOperation: "images.generations",
				providerModelName: "doubao-seedream-5-0-260128",
				isImageModel: true,
			}),
			"https://ark.cn-beijing.volces.com/api/v3/images/generations",
		);
		assert.equal(
			previewPlaygroundUpstreamUrl({
				provider,
				adapter: "dashscope-image-qwen",
				upstreamProtocol: "openai",
				upstreamOperation: "images.generations",
				providerModelName: "qwen-image-3.0",
				isImageModel: true,
			}),
			"https://dashscope.aliyuncs.com/api/v1/services/aigc/multimodal-generation/generation",
		);
		assert.equal(
			previewPlaygroundUpstreamUrl({
				provider,
				adapter: "minimax-image",
				upstreamProtocol: "openai",
				upstreamOperation: "images.generations",
				providerModelName: "image-01",
				isImageModel: true,
			}),
			"https://api.minimaxi.com/v1/image_generation",
		);
		assert.equal(
			previewPlaygroundUpstreamUrl({
				provider,
				adapter: "passthrough",
				upstreamProtocol: "openai",
				upstreamOperation: "images.generations",
				providerModelName: "gpt-image-2",
				isImageModel: true,
			}),
			"https://wrong.example/v1/images/generations",
		);
	});

	it("previews Gemini image models as generateContent", () => {
		const url = previewPlaygroundUpstreamUrl({
			provider: {
				id: "p1",
				endpoints: JSON.stringify({
					gemini: { base: "https://generativelanguage.googleapis.com/v1beta" },
				}),
			},
			adapter: "passthrough",
			upstreamProtocol: "gemini",
			upstreamOperation: "models.generate",
			providerModelName: "gemini-3.1-flash-image",
			isImageModel: true,
			geminiAction: "streamGenerateContent",
		});
		assert.match(url ?? "", /\/gemini-3\.1-flash-image:generateContent\?key=/);
		assert.equal(url?.includes("streamGenerateContent"), false);
		assert.equal(url?.includes("alt=sse"), false);
	});

	it("names the missing target endpoint instead of falling back to another protocol", () => {
		const preview = describePlaygroundUpstreamUrl({
			provider: {
				id: "p1",
				endpoints: JSON.stringify({
					openai: {
						endpoints: { chat: "https://ark.cn-beijing.volces.com/api/v3/chat/completions" },
					},
					volcengine: { base: "https://ark.cn-beijing.volces.com/api/v3" },
				}),
			},
			adapter: "passthrough",
			upstreamProtocol: "openai",
			upstreamOperation: "images.generations",
			providerModelName: "doubao-seedream-5-0-260128",
			isImageModel: true,
		});
		assert.equal(preview.url, null);
		assert.equal(preview.target, "openai/images.generations");
	});
});
