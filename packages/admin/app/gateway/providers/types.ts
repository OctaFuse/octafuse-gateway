import type { GatewayProvider } from '@/lib/types';
import type {
	ProviderEndpointCapability,
	ProviderEndpointsMap,
} from '@octafuse/core/provider-endpoints';
import type { GeminiUpstreamAuthScheme } from '@octafuse/core/gemini-upstream-url';
import type { UpstreamProtocol } from '@octafuse/core/upstream-protocol';

/** 表单鉴权：`auto` 表示省略 `endpoints.gemini.auth`，运行时默认 `query-key`。 */
export type GeminiAuthFormMode = 'auto' | GeminiUpstreamAuthScheme;

/** 卡片上紧凑展示的能力标签（OpenAI images.* 合并为 images；audio.transcriptions → audio）。 */
export type ProviderCapabilityBadge =
	| 'chat'
	| 'responses'
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
	responses: string;
	images_generations: string;
	images_generations_multimodal: string;
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
	/** Gemini only. `auto` omits `auth` on save. */
	auth: GeminiAuthFormMode;
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
	responses: '',
	images_generations: '',
	images_generations_multimodal: '',
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
	auth: 'auto',
};

export const EMPTY_PROVIDER_FORM: ProviderFormData = {
	id: '',
	name: '',
	api_key: '',
	status: 'disabled',
	openai: { ...EMPTY_PROTOCOL_FORM },
	anthropic: { ...EMPTY_PROTOCOL_FORM },
	gemini: { ...EMPTY_PROTOCOL_FORM },
	dashscope: { ...EMPTY_PROTOCOL_FORM },
	description: '',
};

export type { GatewayProvider, ProviderEndpointsMap };

/** Providers 页列表筛选（URL `?filter=`）。 */
export type ProviderListFilter =
	| 'all'
	| 'active'
	| 'disabled'
	| 'pending'
	| 'no_key'
	| 'openai'
	| 'anthropic'
	| 'gemini'
	| 'dashscope';

export const DEFAULT_PROVIDER_LIST_FILTER: ProviderListFilter = 'all';

export const PROVIDER_LIST_FILTERS: readonly ProviderListFilter[] = [
	'all',
	'active',
	'disabled',
	'pending',
	'no_key',
	'openai',
	'anthropic',
	'gemini',
	'dashscope',
] as const;

export function parseProviderListFilterParam(raw: string | null): ProviderListFilter {
	if (!raw) return DEFAULT_PROVIDER_LIST_FILTER;
	return (PROVIDER_LIST_FILTERS as readonly string[]).includes(raw)
		? (raw as ProviderListFilter)
		: DEFAULT_PROVIDER_LIST_FILTER;
}

/** 卡片状态行：密钥 / 启停摘要。 */
export type ProviderKeyStatusKind = 'pending' | 'disabled' | 'no_key' | 'key_set';
