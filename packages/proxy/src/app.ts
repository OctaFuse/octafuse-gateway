import type { D1Database } from '@cloudflare/workers-types';
import type { GatewayRepositories, StorageContext } from '@octafuse/core';
import { Hono } from 'hono';
import type { Context, MiddlewareHandler } from 'hono';
import { cors } from 'hono/cors';
import { logger } from 'hono/logger';
import type { ApiKeyContext } from './middleware/auth';
import { healthRoutes } from './routes/health';
import { chatRoutes } from './routes/v1/chat';
import { responsesRoutes } from './routes/v1/responses';
import { embeddingsRoutes } from './routes/v1/embeddings';
import { geminiRoutes } from './routes/v1/gemini';
import { meRoutes } from './routes/v1/me';
import { messagesRoutes } from './routes/v1/messages';
import { catalogRoutes } from './routes/catalog';
import { modelsRoutes } from './routes/v1/models';
import { webSearchRoutes } from './routes/v1/tools/web-search';
import { webFetchRoutes } from './routes/v1/tools/web-fetch';
import { webDeepSearchRoutes } from './routes/v1/tools/web-deep-search';
import { aiDetectionRoutes } from './routes/v1/tools/ai-detection';
import { toolsPricingRoutes } from './routes/v1/tools/pricing';
import { mcpRoutes } from './routes/mcp';
import { imageRoutes } from './routes/v1/images';
import { audioRoutes } from './routes/v1/audio';
import {
	dashScopeRealtimeInferenceRoutes,
	dashScopeRealtimeRoutes,
	dashScopeRealtimeSessionRoutes,
} from './routes/v1/dashscope-realtime';
import { dashScopeMultimodalRoutes } from './routes/v1/dashscope-multimodal';
import { dashScopeSpeechRoutes } from './routes/v1/dashscope-speech';
import { dashScopeFileTranscriptionRoutes, dashScopeTaskRoutes } from './routes/v1/dashscope-file-transcription';
import { miniMaxSpeechToTextRoutes } from './routes/v1/minimax-speech-to-text';
import { miniMaxT2aRoutes } from './routes/v1/minimax-t2a';
import { elevenLabsSpeechToTextRoutes } from './routes/v1/elevenlabs-speech-to-text';
import { elevenLabsTextToSpeechRoutes } from './routes/v1/elevenlabs-text-to-speech';
import { miniMaxImageGenerationRoutes } from './routes/v1/minimax-image-generation';
import { volcengineImageGenerationRoutes } from './routes/v1/volcengine-image-generation';
import {
	DASHSCOPE_FILE_TRANSCRIPTION_PATH,
	DASHSCOPE_MULTIMODAL_GENERATION_PATH,
	DASHSCOPE_REALTIME_INFERENCE_PATH,
	DASHSCOPE_REALTIME_SESSION_PATH,
	DASHSCOPE_SPEECH_SYNTHESIZER_PATH,
	DASHSCOPE_TASKS_PATH,
	LEGACY_DASHSCOPE_FILE_TRANSCRIPTION_PATH,
	LEGACY_DASHSCOPE_MULTIMODAL_GENERATION_PATH,
	LEGACY_DASHSCOPE_REALTIME_PATH,
	LEGACY_DASHSCOPE_SPEECH_SYNTHESIZER_PATH,
	LEGACY_DASHSCOPE_TASKS_PATH,
	LEGACY_MINIMAX_IMAGE_GENERATION_PATH,
	LEGACY_MINIMAX_SPEECH_TO_TEXT_PATH,
	LEGACY_MINIMAX_T2A_PATH,
	LEGACY_VOLCENGINE_IMAGE_GENERATIONS_PATH,
	MINIMAX_IMAGE_GENERATION_PATH,
	MINIMAX_SPEECH_TO_TEXT_PATH,
	MINIMAX_T2A_PATH,
	VOLCENGINE_IMAGE_GENERATIONS_PATH,
} from '@octafuse/core/route-topology';
import { proxyAppVersion } from './app-version';
import { maintenanceGuard } from './services/maintenance-guard';
import type { DashScopeRealtimeNodeDispatch } from './services/egress/dashscope-realtime-driver';
import type { DeferredRealtimeRuntime } from './services/egress/dashscope-realtime-session';
import type { ElevenLabsRealtimeNodeDispatch } from './services/egress/elevenlabs-realtime-driver';

/** Cloudflare Worker bindings：D1 `DB`。Postgres 见 `src/runtime/node.ts`。 */
export type GatewayBindings = {
	DB?: D1Database;
	/** 可选；仅允许 `d1` 或省略。 */
	DATABASE_DRIVER?: string;
	/** Node upgrade 请求临时注入的实时 WebSocket 调度器；不作为 Worker binding。 */
	NODE_REALTIME_DISPATCH?: DashScopeRealtimeNodeDispatch;
	/** Node upgrade 请求临时注入：延迟连接上游的入口（inference）按需取下游与上游连接能力。 */
	NODE_REALTIME_DEFERRED?: () => DeferredRealtimeRuntime;
	/** Node upgrade 请求临时注入的 ElevenLabs 实时 WebSocket 调度器。 */
	NODE_ELEVENLABS_REALTIME_DISPATCH?: ElevenLabsRealtimeNodeDispatch;
	/** 可选；尚未收到非空 chunk 的等待上限（毫秒）。空则代码默认 2 分钟。 */
	STREAM_FIRST_CHUNK_TIMEOUT_MS?: string;
	/** 可选；已吐 chunk 后的空闲上限（毫秒）。空则代码默认 90 秒。 */
	STREAM_IDLE_TIMEOUT_MS?: string;
	/** 可选；usagePromise 绝对兜底（毫秒）。空则代码默认 10 分钟。 */
	USAGE_SAFETY_TIMEOUT_MS?: string;
};

export type Env = {
	Bindings: GatewayBindings;
	Variables: {
		apiKey?: ApiKeyContext;
		repositories: GatewayRepositories;
		/** 维护模式开启（仅放行的只读路径会走到这里；`/health` 据此带上标记）。 */
		maintenance?: boolean;
	};
};

export type StorageResolver = (context: Context<Env>) => Promise<StorageContext>;

export type ProxyAppOptions = {
	/**
	 * 在所有其它中间件（含 logger / CORS / 存储）之前执行。
	 * Worker 场景下用于尽早校验 D1 绑定：Cloudflare 仅在请求进入 fetch 时注入 `env`，无独立「进程启动」钩子，故最早失败点为首个请求的此处。
	 */
	beforeAll?: MiddlewareHandler<Env>;
};

export function createProxyApp(resolveStorage: StorageResolver, options?: ProxyAppOptions): Hono<Env> {
	const app = new Hono<Env>();

	if (options?.beforeAll) {
		app.use('*', options.beforeAll);
	}

	app.use('*', logger());
	app.use(
		'*',
		cors({
			origin: '*',
			allowMethods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
			allowHeaders: ['Content-Type', 'Authorization', 'Accept', 'language', 'X-DashScope-SSE', 'X-DashScope-Async', 'MCP-Protocol-Version', 'Mcp-Session-Id', 'xi-api-key'],
			exposeHeaders: ['X-OctaFuse-Request-Id', 'X-OctaFuse-Error-Code', 'Mcp-Session-Id'],
		}),
	);

	/**
	 * Log short Gateway-generated 4xx bodies (chat / images / audio / …).
	 * Skips 2xx/3xx/5xx and empty bodies; truncates to avoid flooding wrangler.
	 * Route-level diagnostics (e.g. Images rejectImageRequest) remain more specific.
	 */
	app.use('*', async (c, next) => {
		await next();
		const status = c.res.status;
		if (status < 400 || status >= 500) return;
		const contentType = c.res.headers.get('content-type') ?? '';
		if (!contentType.includes('application/json')) return;
		try {
			const cloned = c.res.clone();
			const text = await cloned.text();
			if (!text) return;
			const truncated = text.length > 200 ? `${text.slice(0, 200)}…` : text;
			console.warn('[Gateway] client error response', {
				method: c.req.method,
				path: c.req.path,
				status,
				body: truncated,
			});
		} catch {
			// best-effort; never fail the response
		}
	});

	app.use('*', async (c, next) => {
		const storage = await resolveStorage(c);
		c.set('repositories', storage.repositories);
		await next();
	});

	// 维护模式：在鉴权与任何记账之前拒绝推理请求（放行只读与探活路径）。
	app.use('*', maintenanceGuard);

	app.route('/health', healthRoutes);
	app.route('/v1/chat/completions', chatRoutes);
	app.route('/v1/responses', responsesRoutes);
	app.route('/v1/embeddings', embeddingsRoutes);
	app.route('/v1/images', imageRoutes);
	app.route('/v1/audio', audioRoutes);
	// 厂商原生透传：路径 = `/{厂商}` + 官方端点路径，官方 SDK 只需改 base_url。
	app.route(DASHSCOPE_REALTIME_SESSION_PATH, dashScopeRealtimeSessionRoutes);
	app.route(DASHSCOPE_REALTIME_INFERENCE_PATH, dashScopeRealtimeInferenceRoutes);
	app.route(DASHSCOPE_MULTIMODAL_GENERATION_PATH, dashScopeMultimodalRoutes);
	app.route(DASHSCOPE_SPEECH_SYNTHESIZER_PATH, dashScopeSpeechRoutes);
	app.route(DASHSCOPE_FILE_TRANSCRIPTION_PATH, dashScopeFileTranscriptionRoutes);
	app.route(DASHSCOPE_TASKS_PATH, dashScopeTaskRoutes);
	app.route(MINIMAX_SPEECH_TO_TEXT_PATH, miniMaxSpeechToTextRoutes);
	app.route(MINIMAX_T2A_PATH, miniMaxT2aRoutes);
	app.route(MINIMAX_IMAGE_GENERATION_PATH, miniMaxImageGenerationRoutes);
	// ElevenLabs 原生路径与官方 SDK 一致（含 `/v1`），文本转语音路径末尾的 `{voice_id}` 由子路由匹配。
	app.route('/elevenlabs/v1/speech-to-text', elevenLabsSpeechToTextRoutes);
	app.route('/elevenlabs/v1/text-to-speech', elevenLabsTextToSpeechRoutes);
	app.route(VOLCENGINE_IMAGE_GENERATIONS_PATH, volcengineImageGenerationRoutes);
	// TEMP(soloent): 旧的 `/v1/{厂商}/...` 厂商透传路径，只为兼容旧版 Agent 与已接入的外部调用方，不是公开 API。
	// 新旧路径挂同一组 handler；旧实时入口 `/v1/dashscope/realtime` 仍要求 `?model=` 与 `?operation=`，升级前选路由。
	// 删除条件：使用旧实时路径的 Agent 版本退出流通，并且外部调用方已经迁移。
	// 删除时一并去掉：下面这些别名 route、auth.ts 里旧实时路径的子协议鉴权匹配、
	// runtime/node.ts 的旧 upgrade 白名单、registry 里的 LEGACY_* 常量与对应别名测试。
	app.route(LEGACY_DASHSCOPE_REALTIME_PATH, dashScopeRealtimeRoutes);
	app.route(LEGACY_DASHSCOPE_MULTIMODAL_GENERATION_PATH, dashScopeMultimodalRoutes);
	app.route(LEGACY_DASHSCOPE_SPEECH_SYNTHESIZER_PATH, dashScopeSpeechRoutes);
	app.route(LEGACY_DASHSCOPE_FILE_TRANSCRIPTION_PATH, dashScopeFileTranscriptionRoutes);
	app.route(LEGACY_DASHSCOPE_TASKS_PATH, dashScopeTaskRoutes);
	app.route(LEGACY_MINIMAX_SPEECH_TO_TEXT_PATH, miniMaxSpeechToTextRoutes);
	app.route(LEGACY_MINIMAX_T2A_PATH, miniMaxT2aRoutes);
	app.route(LEGACY_MINIMAX_IMAGE_GENERATION_PATH, miniMaxImageGenerationRoutes);
	app.route(LEGACY_VOLCENGINE_IMAGE_GENERATIONS_PATH, volcengineImageGenerationRoutes);
	app.route('/v1/messages', messagesRoutes);
	// TEMP(soloent): 只为兼容 SoloEnt Agent 的历史拼路径，不是公开 API。
	// 0.18.0–0.18.5 + 旧 token → POST /messages
	// 0.17.x + 2026-09-17 之后签发的 token → POST /v1/v1/messages
	// 0.18.6 起 Agent 用 rootUrl 自己拼 /v1，只打 /v1/messages。
	// 删除条件：0.17.x 与 0.18.0–0.18.5 已退出，且这些版本签发的插件 JWT 已过期（30 天）。
	// 删除时一并去掉：这两条 route、auth.ts 里 isAnthropicMessagesPath 的别名分支、
	// messages-legacy-paths.test.ts。正式入口只保留 POST /v1/messages。
	app.route('/messages', messagesRoutes);
	app.route('/v1/v1/messages', messagesRoutes);
	app.route('/v1beta', geminiRoutes);
	app.route('/v1/me', meRoutes);
	app.route('/v1/models', modelsRoutes);
	app.route('/v1/tools/web-search', webSearchRoutes);
	app.route('/v1/tools/web-fetch', webFetchRoutes);
	app.route('/v1/tools/web-deep-search', webDeepSearchRoutes);
	app.route('/v1/tools/ai-detection', aiDetectionRoutes);
	app.route('/v1/tools/pricing', toolsPricingRoutes);
	app.route('/mcp', mcpRoutes);
	app.route('/catalog', catalogRoutes);

	app.get('/', (c) => c.json({ name: 'octafuse-proxy', version: proxyAppVersion }));

	return app;
}
