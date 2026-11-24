/** Official model-list endpoints. Kind names are the stable provider preset names. */
export type ModelOption = { id: string; label: string; operations?: string[]; source: 'upstream' };
export type DiscoveryShape = 'data' | 'models' | 'publisherModels' | 'output' | 'array';
export type DiscoveryAuth = 'none' | 'bearer' | 'anthropic' | 'google-key' | 'vertex';
export type DiscoveryAdapter = {
	url: string;
	shape: DiscoveryShape;
	auth: DiscoveryAuth;
	pagination?: 'anthropic' | 'pageToken' | 'cohere' | 'aliyun';
};

const d = (url: string, auth: DiscoveryAuth = 'bearer', shape: DiscoveryShape = 'data', pagination?: DiscoveryAdapter['pagination']): DiscoveryAdapter => ({ url, auth, shape, pagination });

/** Exact hosts only. No URL or host comes from a browser request. */
export const PROVIDER_MODEL_ADAPTERS: Readonly<Record<string, DiscoveryAdapter>> = Object.freeze({
	'OpenRouter': d('https://openrouter.ai/api/v1/models', 'none'),
	'Vercel AI Gateway': d('https://ai-gateway.vercel.sh/v1/models', 'none'),
	'DeepInfra': d('https://api.deepinfra.com/v1/models', 'none'),
	'Modelink': d('https://api.modelink.ai/v1/models', 'none'),
	'Command Code': d('https://api.commandcode.ai/provider/v1/models', 'none'),
	'Qiniu AI': d('https://api.qnaigc.com/v1/models', 'none'),
	'Novita AI': d('https://api.novita.ai/openai/v1/models', 'none'),
	'NVIDIA NIM (integrate.api)': d('https://integrate.api.nvidia.com/v1/models', 'none'),
	'SambaNova Cloud': d('https://api.sambanova.ai/v1/models', 'none'),
	'OpenCode Zen': d('https://opencode.ai/zen/v1/models', 'none'),
	'OpenCode Go': d('https://opencode.ai/zen/go/v1/models', 'none'),
	'DeepSeek': d('https://api.deepseek.com/models'),
	'Moonshot AI': d('https://api.moonshot.cn/v1/models'),
	'Kimi Code (Coding API)': d('https://api.kimi.com/coding/v1/models'),
	'MiniMax': d('https://api.minimax.cn/v1/models'),
	'MiniMax (International)': d('https://api.minimax.io/v1/models'),
	'SiliconFlow': d('https://api.siliconflow.cn/v1/models'),
	'SiliconFlow (International)': d('https://api.siliconflow.com/v1/models'),
	'Tencent Hunyuan': d('https://tokenhub.tencentcloudmaas.com/v1/models'),
	'StepFun': d('https://api.stepfun.com/v1/models'),
	'Kingsoft StarFlow': d('https://kspmas.ksyun.com/v1/models'),
	'Kingsoft StarFlow (International)': d('https://global-kspmas.ksyun.com/v1/models'),
	'Meituan LongCat': d('https://api.longcat.chat/openai/v1/models'),
	'Baichuan AI': d('https://api.baichuan-ai.com/v1/models'),
	'Alibaba Cloud Bailian': d('https://dashscope.aliyuncs.com/api/v1/models', 'bearer', 'output', 'aliyun'),
	'Alibaba Cloud Bailian (International)': d('https://dashscope-intl.aliyuncs.com/api/v1/models', 'bearer', 'output', 'aliyun'),
	'SCNet': d('https://api.scnet.cn/api/llm/v1/models'),
	'OpenAI': d('https://api.openai.com/v1/models'),
	'Anthropic': d('https://api.anthropic.com/v1/models', 'anthropic', 'data', 'anthropic'),
	'Google Gemini (Generative Language API)': d('https://generativelanguage.googleapis.com/v1beta/models', 'google-key', 'models', 'pageToken'),
	'Google Vertex AI (Express Mode · API Key)': d('https://aiplatform.googleapis.com/v1/publishers/google/models', 'google-key', 'models', 'pageToken'),
	'Google Vertex AI': d('https://aiplatform.googleapis.com/v1/projects/{project}/locations/{region}/publishers/google/models', 'vertex', 'publisherModels', 'pageToken'),
	'Mistral AI': d('https://api.mistral.ai/v1/models'),
	'xAI (Grok)': d('https://api.x.ai/v1/models'),
	'Perplexity': d('https://api.perplexity.ai/orchestrator/v1/models'),
	'Groq (OpenAI Compatible)': d('https://api.groq.com/openai/v1/models'),
	'Together AI': d('https://api.together.xyz/v1/models', 'bearer', 'array'),
	'Cohere (OpenAI Compatibility)': d('https://api.cohere.ai/v1/models', 'bearer', 'models', 'cohere'),
	'Hugging Face Inference Providers': d('https://router.huggingface.co/v1/models'),
	'ZenMux': d('https://zenmux.ai/api/v1/models'),
	'Xiaomi MiMo': d('https://api.xiaomimimo.com/v1/models'),
	'Xiaomi MiMo (Token Plan)': d('https://token-plan-cn.xiaomimimo.com/v1/models'),
	'Cerebras': d('https://api.cerebras.ai/v1/models'),
});

export const DISCOVERY_PAGE_LIMIT = 10;
export const DISCOVERY_MODEL_LIMIT = 1000;
export const DISCOVERY_PAGE_ITEMS_LIMIT = 500;
export const DISCOVERY_BODY_LIMIT = 2 * 1024 * 1024;

export function discoveryAdapter(kind: string | null | undefined): DiscoveryAdapter | undefined {
	return kind ? PROVIDER_MODEL_ADAPTERS[kind] : undefined;
}

function record(value: unknown): Record<string, unknown> | null {
	return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : null;
}

export function normalizeModelId(kind: string, id: string): string {
	if (kind === 'Google Gemini (Generative Language API)' || kind === 'Google Vertex AI (Express Mode · API Key)') {
		return id.startsWith('models/') ? id.slice(7) : id;
	}
	if (kind === 'Google Vertex AI') return id.includes('/models/') ? id.split('/models/').pop() ?? '' : id;
	return id;
}

function operations(kind: string, row: Record<string, unknown>): string[] | undefined {
	const values: string[] = [];
	const add = (name: string) => { if (!values.includes(name)) values.push(name); };
	const type = String(row.type ?? row.sub_type ?? '').toLowerCase();
	if (kind.startsWith('SiliconFlow') || kind === 'Together AI') {
		if (/chat|text|language|code/.test(type)) { add('chat'); add('responses'); }
		if (/image/.test(type)) add('images.generations');
		if (/embed/.test(type)) add('embeddings');
		if (/audio|speech/.test(type)) add('audio.speech');
	}
	if (kind === 'Cohere (OpenAI Compatibility)' && Array.isArray(row.endpoints)) {
		for (const endpoint of row.endpoints) {
			if (endpoint === 'chat') { add('chat'); add('responses'); }
			if (endpoint === 'embed') add('embeddings');
		}
	}
	if (kind.startsWith('Google Gemini') || kind.startsWith('Google Vertex')) {
		const methods = row.supportedGenerationMethods ?? row.supportedActions;
		if (Array.isArray(methods)) {
			if (methods.includes('generateContent')) add('models.generate');
			if (methods.includes('embedContent')) add('embeddings');
		}
	}
	if (kind === 'Mistral AI') {
		const capabilities = record(row.capabilities);
		if (capabilities?.completion_chat === true) { add('chat'); add('responses'); }
	}
	if (kind === 'OpenRouter') {
		const modality = String(record(row.architecture)?.modality ?? '').toLowerCase();
		if (modality.startsWith('text') || modality.includes('->text')) { add('chat'); add('responses'); }
		if (modality.includes('->image')) add('images.generations');
	}
	if (kind === 'ZenMux') {
		const outputs = row.output_modalities;
		if (Array.isArray(outputs)) {
			if (outputs.includes('text')) { add('chat'); add('responses'); }
			if (outputs.includes('image')) add('images.generations');
			if (outputs.includes('audio')) add('audio.speech');
		}
	}
	return values.length ? values : undefined;
}

/** Reject wrong JSON shapes; never silently fall back to a display name. */
export function parseModelPage(kind: string, adapter: DiscoveryAdapter, body: unknown): { models: ModelOption[]; next: string | null; total?: number; truncated: boolean } {
	const root = record(body);
	const list = adapter.shape === 'array' ? body : adapter.shape === 'output' ? record(root?.output)?.models : root?.[adapter.shape];
	if (!Array.isArray(list)) throw new Error('upstream_invalid_response');
	const models: ModelOption[] = [];
	for (const item of list.slice(0, DISCOVERY_PAGE_ITEMS_LIMIT)) {
		const row = record(item);
		const rawId = row?.[adapter.shape === 'output' ? 'model' : adapter.shape === 'models' || adapter.shape === 'publisherModels' ? 'name' : 'id'];
		if (typeof rawId !== 'string') continue;
		const id = normalizeModelId(kind, rawId);
		if (!id || id.length > 256 || /[\u0000-\u001f\u007f]/.test(id)) continue;
		const rawLabel = row?.display_name ?? row?.name ?? id;
		const label = typeof rawLabel === 'string' && rawLabel.length <= 256 ? rawLabel : id;
		models.push({ id, label, operations: operations(kind, row!), source: 'upstream' });
	}
	let next: string | null = null;
	if (adapter.pagination === 'anthropic' && root?.has_more === true) next = typeof root.last_id === 'string' ? root.last_id : null;
	if (adapter.pagination === 'pageToken') next = typeof root?.nextPageToken === 'string' ? root.nextPageToken : null;
	if (adapter.pagination === 'cohere') next = typeof root?.next_page_token === 'string' ? root.next_page_token : null;
	if (adapter.pagination === 'aliyun') {
		const output = record(root?.output);
		const total = Number(output?.total ?? root?.total);
		if (Number.isFinite(total) && total > 0) next = String(total);
	}
	return { models, next, total: adapter.pagination === 'aliyun' ? Number(record(root?.output)?.total ?? root?.total) : undefined, truncated: list.length > DISCOVERY_PAGE_ITEMS_LIMIT };
}
