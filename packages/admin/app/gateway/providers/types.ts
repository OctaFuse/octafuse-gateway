import type { GatewayProvider } from '@/lib/types';
import type {
	ProviderEndpointCapability,
	ProviderEndpointsMap,
} from '@octafuse/core/provider-endpoints';
import type { UpstreamProtocol } from '@octafuse/core/upstream-protocol';

/** 卡片上紧凑展示的能力标签（OpenAI images.* 合并为 images；audio.transcriptions → audio）。 */
export type ProviderCapabilityBadge =
	| 'chat'
	| 'images'
	| 'audio'
	| 'messages'
	| 'modelsGenerate'
	| 'generateContent'
	| 'streamGenerateContent';

/** `GET /admin/providers/import/catalog` */
export type ProviderImportCatalogRow = {
	id: string;
	name: string;
	vendor_key: string;
	icon_key: string;
	vendor_label: string;
	protocols: UpstreamProtocol[];
	endpoints: string | null;
	description: string | null;
};

export type ProviderProtocolSummary = {
	key: UpstreamProtocol;
	label: string;
	baseUrl: string | null;
	overrideCount: number;
	/** 与 runtime 一致的已配置 capability（完整 key）。 */
	capabilities: ProviderEndpointCapability[];
	/** 卡片紧凑标签（images.* → images）。 */
	badges: ProviderCapabilityBadge[];
	endpoints: Array<{
		capability: ProviderEndpointCapability;
		url: string;
		source: 'base' | 'override';
	}>;
};

/** Preserved when legacy per-action Gemini URLs cannot safely collapse into one `{action}` template. */
export type GeminiLegacyPerActionEndpoints = {
	generateContent: string;
	streamGenerateContent: string;
};

/** 单协议表单：base + Advanced capability 覆盖 */
export type ProtocolEndpointForm = {
	base: string;
	chat: string;
	images_generations: string;
	images_edits: string;
	audio_transcriptions: string;
	audio_transcriptions_multimodal: string;
	audio_transcriptions_tasks: string;
	audio_speech: string;
	audio_speech_multimodal: string;
	audio_realtime_inference: string;
	audio_realtime_session: string;
	audio_hotwords: string;
	audio_voices: string;
	messages: string;
	/** Canonical Gemini family override (`models.generate`, must include `{model}` + `{action}`). */
	modelsGenerate: string;
	/** @deprecated Prefer modelsGenerate; kept for display of uncollapsed legacy rows. */
	generateContent: string;
	/** @deprecated Prefer modelsGenerate; kept for display of uncollapsed legacy rows. */
	streamGenerateContent: string;
	/** When set, save must round-trip these keys unchanged (do not invent a merged template). */
	legacyPerAction?: GeminiLegacyPerActionEndpoints | null;
};

export type ProviderFormData = {
	id: string;
	name: string;
	/** 创建必填；编辑时空 = 不改 */
	api_key: string;
	/** `active` | `disabled` */
	status: 'active' | 'disabled';
	openai: ProtocolEndpointForm;
	anthropic: ProtocolEndpointForm;
	gemini: ProtocolEndpointForm;
	dashscope: ProtocolEndpointForm;
	description: string;
};

export type ProviderImportResult = {
	created: number;
	failed: Array<{ id: string; message: string }>;
};

export const EMPTY_PROTOCOL_FORM: ProtocolEndpointForm = {
	base: '',
	chat: '',
	images_generations: '',
	images_edits: '',
	audio_transcriptions: '',
	audio_transcriptions_multimodal: '',
	audio_transcriptions_tasks: '',
	audio_speech: '',
	audio_speech_multimodal: '',
	audio_realtime_inference: '',
	audio_realtime_session: '',
	audio_hotwords: '',
	audio_voices: '',
	messages: '',
	modelsGenerate: '',
	generateContent: '',
	streamGenerateContent: '',
	legacyPerAction: null,
};

export const EMPTY_PROVIDER_FORM: ProviderFormData = {
	id: '',
	name: '',
	api_key: '',
	status: 'active',
	openai: { ...EMPTY_PROTOCOL_FORM },
	anthropic: { ...EMPTY_PROTOCOL_FORM },
	gemini: { ...EMPTY_PROTOCOL_FORM },
	dashscope: { ...EMPTY_PROTOCOL_FORM },
	description: '',
};

export type { GatewayProvider, ProviderEndpointsMap };
