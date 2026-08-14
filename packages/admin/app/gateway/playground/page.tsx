'use client';

/**
 * Playground：选定单条 model_route，编辑 JSON 请求体，直连上游验证连通性（不计费、不入库）。
 */
import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode, Suspense } from 'react';
import { useSearchParams } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { flushSync } from 'react-dom';
import { PaperAirplaneIcon } from '@heroicons/react/24/outline';
import { ImageGenerationsPreview } from '@/components/image-generations-preview';
import { RequestTargetUrl } from '@/components/request-target-url';
import { readApiJson } from '@/lib/api-json';
import { PlaygroundToolsPanel } from './playground-tools-panel';
import {
	AUDIO_SPEECH_BODY_TEMPLATE,
	AUDIO_TRANSCRIPTIONS_BODY_TEMPLATE,
	isAudioRouteModel,
	validateAudioTranscriptionFile,
} from '@/lib/audio-transcriptions';
import { isAudioTranscriptionModel } from '@octafuse/core/db/model-modalities';
import {
	IMAGE_EDITS_BODY_TEMPLATE,
	IMAGE_GENERATIONS_BODY_TEMPLATE,
	IMAGE_MAX_REFERENCE_COUNT,
	imageRequestMetaFromBody,
	isImageRouteModel,
	parseImagesGenerationsResponse,
	readFileAsDataUrl,
	validateEditImageFiles,
	type ImageOperation,
	type ImagePreviewItem,
} from '@/lib/image-generations';
import {
	inferPlaygroundParseMode,
	mergeAssistantTextParts,
	type PlaygroundProtocol,
} from '@/lib/playground/merge-assistant-text';
import { previewPlaygroundUpstreamUrl } from '@/lib/playground/preview-upstream-url';
import { normalizeProtocol, parseLastStreamUsage, tryParseUsageSummary } from '@/lib/playground/usage-parsing';
import {
	buildDashScopeRealtimeTtsTemplate,
	buildDashScopeRealtimeAsrTemplate,
	buildDashScopeSpeechBodyTemplate,
	dashScopeRealtimeAudioContentType,
	isDashScopeRealtimeOperation,
	openDashScopeRealtimeClient,
	stopDashScopeRealtimeClient,
} from '@/lib/dashscope-realtime-client';
import type { AdminModelRow } from '@/lib/services/admin/types';
import type { ApiResponse, GatewayProvider } from '@/lib/types';
import { DEFAULT_KIND_FILTER, type ModelKindFilter } from '../models/types';

const inputClass =
	'w-full px-3 py-2 border border-gray-300 rounded-md text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 bg-white';
const labelClass = 'block text-xs font-medium text-gray-500 uppercase tracking-wider mb-1';

function resolveRouteModelKind(m: AdminModelRow | undefined): ModelKindFilter {
	if (!m) return 'llm';
	if (isAudioRouteModel(m)) return 'audio';
	if (isImageRouteModel(m)) return 'image';
	return 'llm';
}

function ReadonlyField({ label, children }: { label: string; children: ReactNode }) {
	return (
		<div className="min-w-0">
			<div className="text-xs font-medium text-gray-500">{label}</div>
			<div className="mt-0.5 text-sm text-gray-900 break-words">{children}</div>
		</div>
	);
}

type RouteListRow = {
	id: string;
	model_id: string;
	provider_id: string;
	provider_model_name: string;
	priority: number;
	status: string;
	route_group: string;
	price_override: string | null;
	custom_params: string | null;
	upstream_protocol: string;
	upstream_operation?: string | null;
	adapter?: string | null;
	route_pool_id?: string | null;
	pool_name?: string | null;
	surfaces?: string | null;
	model_name: string | null;
	provider_name: string | null;
};

const BODY_TEMPLATES: Record<string, string> = {
	openai: `{
  "messages": [{ "role": "user", "content": "Hello" }],
  "max_tokens": 256,
  "stream": true,
  "stream_options": { "include_usage": true }
}`,
	openai_responses: `{
  "input": [{ "role": "user", "content": "Hello" }],
  "max_output_tokens": 256,
  "store": false,
  "stream": true
}`,
	anthropic: `{
  "messages": [{ "role": "user", "content": "Hello" }],
  "max_tokens": 256,
  "stream": true
}`,
	gemini: `{
  "contents": [{ "role": "user", "parts": [{ "text": "Hello" }] }]
}`,
};

function formatRouteLabel(r: RouteListRow): string {
	const m = r.model_name || r.model_id;
	const p = r.provider_name || r.provider_id;
	return `${m} · ${p} · ${r.provider_model_name} · ${r.route_group} · ${r.upstream_protocol}.${
		r.upstream_operation ?? '*'
	}`;
}

/** 下拉项开头：active → 🟢，否则 🔴（不拼 status 文案，避免与 emoji 重复）。 */
function routeActiveIndicator(status: string): string {
	return status.trim().toLowerCase() === 'active' ? '🟢' : '🔴';
}

/** 路由表 JSON 列：可解析则 pretty-print，否则原文。 */
function formatRouteJsonColumn(raw: string | null | undefined): string {
	if (raw == null || String(raw).trim() === '') {
		return '—';
	}
	const t = String(raw).trim();
	try {
		return JSON.stringify(JSON.parse(t), null, 2);
	} catch {
		return t;
	}
}

const codeBlockClass =
	'p-3 text-xs overflow-x-auto whitespace-pre-wrap bg-gray-50 border border-gray-200 rounded-md font-mono text-gray-900';

/** Route 卡片内 JSON 预览：限制高度避免长内容撑满视口 */
const routeJsonPreClass = `${codeBlockClass} max-h-56 overflow-y-auto`;

function decodeWireRequestBodyHeader(res: Response): string | null {
	const raw = res.headers.get('x-playground-request-body');
	if (raw == null || raw === '') return null;
	try {
		const decoded = decodeURIComponent(raw);
		try {
			return JSON.stringify(JSON.parse(decoded), null, 2);
		} catch {
			return decoded;
		}
	} catch {
		return '（无法解码 x-playground-request-body）';
	}
}

function PlaygroundPageInner() {
	const t = useTranslations('playground');
	const tBrand = useTranslations('brand');
	const tCommon = useTranslations('common');
	const searchParams = useSearchParams();
	const initialMode = searchParams.get('mode') === 'tools' || searchParams.get('tool') ? 'tools' : 'routes';
	const [playgroundMode, setPlaygroundMode] = useState<'routes' | 'tools'>(initialMode);
	const initialToolId = searchParams.get('tool');
	const initialProvider = searchParams.get('provider');

	const [routes, setRoutes] = useState<RouteListRow[]>([]);
	const [modelsById, setModelsById] = useState<Map<string, AdminModelRow>>(new Map());
	const [providersById, setProvidersById] = useState<Map<string, GatewayProvider>>(new Map());
	const [loadingRoutes, setLoadingRoutes] = useState(true);
	const [loadError, setLoadError] = useState<string | null>(null);

	/** 调试台按单一 Kind 拆分模型列表，不提供模型目录的 All 视图。 */
	const [filterKind, setFilterKind] = useState<ModelKindFilter>(DEFAULT_KIND_FILTER);
	const [filterModel, setFilterModel] = useState('');
	const [filterProvider, setFilterProvider] = useState('');
	const [filterProtocol, setFilterProtocol] = useState('');
	const [filterGroup, setFilterGroup] = useState('');

	const [selectedId, setSelectedId] = useState('');
	const [bodyText, setBodyText] = useState(BODY_TEMPLATES.openai);
	const [bodyError, setBodyError] = useState<string | null>(null);
	const [geminiAction, setGeminiAction] = useState<'generateContent' | 'streamGenerateContent'>(
		'streamGenerateContent',
	);
	const [imageOperation, setImageOperation] = useState<ImageOperation>('generations');
	const [editFiles, setEditFiles] = useState<File[]>([]);
	const [audioFile, setAudioFile] = useState<File | null>(null);
	const [audioInputMode, setAudioInputMode] = useState<'file' | 'microphone'>('file');
	const [audioPreviewUrl, setAudioPreviewUrl] = useState<string | null>(null);
	const realtimeAudioChunksRef = useRef<ArrayBuffer[]>([]);
	const realtimeRef = useRef<WebSocket | null>(null);

	const [sending, setSending] = useState(false);
	const [responseMeta, setResponseMeta] = useState<{
		status: number;
		latencyMs: string | null;
		upstreamUrl: string | null;
		contentType: string | null;
	} | null>(null);
	const [responseText, setResponseText] = useState('');
	/** 与最后一次 Send 时的路由协议一致，避免切换下拉后拼接错乱 */
	const [responseProtocol, setResponseProtocol] = useState<PlaygroundProtocol>('openai');
	const [usageHint, setUsageHint] = useState<string | null>(null);
	const [imagePreviews, setImagePreviews] = useState<ImagePreviewItem[]>([]);
	/** Send 成功后由响应头 `x-playground-request-body` 解析（服务端合并后的实际上游 JSON）。 */
	const [lastSentWireBody, setLastSentWireBody] = useState<string | null>(null);
	const streamEndRef = useRef<HTMLSpanElement>(null);
	const mergedStreamEndRef = useRef<HTMLSpanElement>(null);

	const selected = useMemo(() => routes.find((r) => r.id === selectedId) ?? null, [routes, selectedId]);

	const selectedIsImage = useMemo(() => {
		if (!selected) return false;
		const m = modelsById.get(selected.model_id);
		return m ? isImageRouteModel(m) : false;
	}, [selected, modelsById]);

	const selectedIsAudio = useMemo(() => {
		if (!selected) return false;
		const m = modelsById.get(selected.model_id);
		return m ? isAudioRouteModel(m) : false;
	}, [selected, modelsById]);
	const selectedIsAudioTranscription = useMemo(
		() => (selected ? isAudioTranscriptionModel(modelsById.get(selected.model_id) ?? {}) : false),
		[selected, modelsById],
	);
	const selectedDashScopeRealtimeOperation =
		selectedIsAudio &&
		selected?.upstream_protocol === 'dashscope' &&
		isDashScopeRealtimeOperation(selected?.upstream_operation ?? '')
			? (selected?.upstream_operation as
					| 'audio.transcriptions.realtime.inference'
					| 'audio.transcriptions.realtime.session'
					| 'audio.speech.realtime.inference')
			: null;

	const imageSendBlocked = selectedIsImage && normalizeProtocol(selected?.upstream_protocol ?? 'openai') !== 'openai';
	const selectedAudioUpstreamProtocol = (selected?.upstream_protocol ?? 'openai').trim().toLowerCase();
	// 调试台支持 OpenAI multipart、DashScope 同步 ASR Adapter，以及 DashScope 实时 WS。
	const audioSendBlocked =
		selectedIsAudio && selectedAudioUpstreamProtocol !== 'openai' && selectedAudioUpstreamProtocol !== 'dashscope';
	const selectedAudioUsesDashScope = selectedIsAudio && selectedAudioUpstreamProtocol === 'dashscope';
	const selectedUsesDashScopeRealtime = selectedDashScopeRealtimeOperation != null;
	const selectedCanUseMicrophone =
		selectedDashScopeRealtimeOperation?.startsWith('audio.transcriptions.realtime.') ?? false;
	// DashScope 的 inference 与 session ASR 都支持浏览器麦克风，区别在于音频事件格式。
	const selectedNeedsAudioFile =
		selectedIsAudioTranscription && (!selectedCanUseMicrophone || audioInputMode === 'file');

	const previewUpstreamUrl = useMemo(() => {
		if (!selected) return null;
		return previewPlaygroundUpstreamUrl({
			provider: providersById.get(selected.provider_id),
			upstreamProtocol: selected.upstream_protocol,
			upstreamOperation: selected.upstream_operation,
			providerModelName: selected.provider_model_name,
			isImageModel: selectedIsImage && !selectedIsAudio,
			imageOperation: selectedIsImage && !selectedIsAudio ? imageOperation : undefined,
			isAudioModel: selectedIsAudio,
			geminiAction,
		});
	}, [selected, providersById, selectedIsImage, selectedIsAudio, imageOperation, geminiAction]);

	/** 发送后以上游实际 URL 为准；否则展示与 Send 同规则的预览。 */
	const requestTargetUrl = responseMeta?.upstreamUrl ?? previewUpstreamUrl;

	const mergedAssistantParts = useMemo(() => {
		const mode = inferPlaygroundParseMode(responseMeta?.contentType ?? null);
		if (!responseText.trim() || !mode) {
			return { reasoning: '', body: '' };
		}
		return mergeAssistantTextParts(responseText, responseProtocol, mode);
	}, [responseText, responseProtocol, responseMeta?.contentType]);

	const { mergedReasoningDisplay, mergedBodyDisplay } = useMemo(() => {
		const hasRaw = responseText.trim().length > 0;
		const p = mergedAssistantParts;
		const reasoningDisplay =
			p.reasoning || (sending && hasRaw ? '（接收中…）' : '') || (!sending && hasRaw && !p.reasoning ? '—' : '');
		const bodyDisplay =
			p.body ||
			(sending && hasRaw ? '（接收中…）' : '') ||
			(!sending && hasRaw && !p.body ? (!p.reasoning ? '（无法从报文提取正文）' : '—') : '');
		return {
			mergedReasoningDisplay: reasoningDisplay,
			mergedBodyDisplay: bodyDisplay,
		};
	}, [mergedAssistantParts, responseText, sending]);

	const matchesFilters = useCallback(
		(r: RouteListRow, omit: 'model' | 'provider' | 'protocol' | 'group' | null = null) => {
			if (resolveRouteModelKind(modelsById.get(r.model_id)) !== filterKind) return false;
			if (omit !== 'model' && filterModel && r.model_id !== filterModel) return false;
			if (omit !== 'provider' && filterProvider && r.provider_id !== filterProvider) return false;
			if (omit !== 'protocol' && filterProtocol && r.upstream_protocol !== filterProtocol) return false;
			if (omit !== 'group' && filterGroup && r.route_group !== filterGroup) return false;
			return true;
		},
		[modelsById, filterKind, filterModel, filterProvider, filterProtocol, filterGroup],
	);

	const kindCounts = useMemo(() => {
		const counts = { llm: 0, image: 0, audio: 0 };
		const seen = new Set<string>();
		for (const r of routes) {
			if (seen.has(r.model_id)) continue;
			seen.add(r.model_id);
			counts[resolveRouteModelKind(modelsById.get(r.model_id))] += 1;
		}
		return counts;
	}, [routes, modelsById]);

	const onFilterKindChange = useCallback(
		(next: ModelKindFilter) => {
			if (next === filterKind) return;
			setFilterKind(next);
			setFilterModel('');
			setSelectedId('');
		},
		[filterKind],
	);

	const routesInKind = useMemo(
		() => routes.filter((r) => resolveRouteModelKind(modelsById.get(r.model_id)) === filterKind),
		[routes, modelsById, filterKind],
	);

	const filteredRoutes = useMemo(() => routes.filter((r) => matchesFilters(r)), [routes, matchesFilters]);

	/** Model 下拉：按当前其它筛选项联动（不含 model 自身）。 */
	const modelOptions = useMemo(() => {
		const pool = routes.filter((r) => matchesFilters(r, 'model'));
		const byId = new Map<string, { id: string; label: string }>();
		for (const r of pool) {
			if (byId.has(r.model_id)) continue;
			const name = (r.model_name ?? '').trim();
			byId.set(r.model_id, {
				id: r.model_id,
				label: name && name !== r.model_id ? `${name} (${r.model_id})` : r.model_id,
			});
		}
		return [...byId.values()].sort((a, b) => a.label.localeCompare(b.label));
	}, [routes, matchesFilters]);

	/** Provider 下拉：按当前其它筛选项联动（不含 provider 自身）。 */
	const providerOptions = useMemo(() => {
		const pool = routes.filter((r) => matchesFilters(r, 'provider'));
		const byId = new Map<string, { id: string; label: string }>();
		for (const r of pool) {
			if (byId.has(r.provider_id)) continue;
			const name = (r.provider_name ?? '').trim();
			byId.set(r.provider_id, {
				id: r.provider_id,
				label: name && name !== r.provider_id ? `${name} (${r.provider_id})` : r.provider_id,
			});
		}
		return [...byId.values()].sort((a, b) => a.label.localeCompare(b.label));
	}, [routes, matchesFilters]);

	const protocolOptions = useMemo(() => {
		const set = new Set<string>();
		for (const r of routes) {
			if (!matchesFilters(r, 'protocol')) continue;
			if (r.upstream_protocol) set.add(r.upstream_protocol);
		}
		return [...set].sort((a, b) => a.localeCompare(b));
	}, [routes, matchesFilters]);

	const groupOptions = useMemo(() => {
		const set = new Set<string>();
		for (const r of routes) {
			if (!matchesFilters(r, 'group')) continue;
			if (r.route_group) set.add(r.route_group);
		}
		return [...set].sort((a, b) => a.localeCompare(b));
	}, [routes, matchesFilters]);

	useEffect(() => {
		if (filterModel && !modelOptions.some((o) => o.id === filterModel)) {
			setFilterModel('');
		}
	}, [filterModel, modelOptions]);

	useEffect(() => {
		if (filterProvider && !providerOptions.some((o) => o.id === filterProvider)) {
			setFilterProvider('');
		}
	}, [filterProvider, providerOptions]);

	useEffect(() => {
		if (filterProtocol && !protocolOptions.includes(filterProtocol)) {
			setFilterProtocol('');
		}
	}, [filterProtocol, protocolOptions]);

	useEffect(() => {
		if (filterGroup && !groupOptions.includes(filterGroup)) {
			setFilterGroup('');
		}
	}, [filterGroup, groupOptions]);

	useEffect(() => {
		if (selectedId && !filteredRoutes.some((r) => r.id === selectedId)) {
			setSelectedId('');
		}
	}, [selectedId, filteredRoutes]);

	useEffect(() => {
		let cancelled = false;
		(async () => {
			setLoadingRoutes(true);
			setLoadError(null);
			try {
				const [rRes, mRes, pRes] = await Promise.all([
					fetch('/api/admin/routes'),
					fetch('/api/admin/models'),
					fetch('/api/admin/providers'),
				]);
				const data = await readApiJson<RouteListRow[]>(rRes);
				const modelsData = await readApiJson<AdminModelRow[]>(mRes);
				const providersData = await readApiJson<GatewayProvider[]>(pRes);
				if (cancelled) return;
				if (data.success && Array.isArray(data.data)) {
					setRoutes(data.data);
				} else {
					setLoadError(data.message ?? tCommon('failedToLoadRoutes'));
				}
				if (modelsData.success && Array.isArray(modelsData.data)) {
					setModelsById(new Map(modelsData.data.map((m) => [m.id, m])));
				}
				if (providersData.success && Array.isArray(providersData.data)) {
					setProvidersById(new Map(providersData.data.map((p) => [p.id, p])));
				}
			} catch (e) {
				if (!cancelled) setLoadError(e instanceof Error ? e.message : tCommon('failedToLoadRoutes'));
			} finally {
				if (!cancelled) setLoadingRoutes(false);
			}
		})();
		return () => {
			cancelled = true;
		};
	}, [tCommon]);

	useEffect(() => {
		const r = routes.find((x) => x.id === selectedId);
		if (!r) return;
		const proto = normalizeProtocol(r.upstream_protocol);
		const m = modelsById.get(r.model_id);
		const isImage = m ? isImageRouteModel(m) : false;
		const isAudio = m ? isAudioRouteModel(m) : false;
		// DashScope 非实时音频由调试台转换后直连 HTTP，上游协议不是 OpenAI 也要使用音频模板。
		const isAudioHttp = proto === 'openai' || proto === 'dashscope';
		setImageOperation('generations');
		setEditFiles([]);
		setAudioFile(null);
		setAudioInputMode('file');
		setAudioPreviewUrl(null);
		realtimeAudioChunksRef.current = [];
		const realtime = isAudio && proto === 'dashscope' && isDashScopeRealtimeOperation(r.upstream_operation ?? '');
		setBodyText(
			realtime
				? r.upstream_operation?.startsWith('audio.speech.')
					? buildDashScopeRealtimeTtsTemplate(r.provider_model_name)
					: buildDashScopeRealtimeAsrTemplate(
							(r.upstream_operation ?? 'audio.transcriptions.realtime.inference') as
								| 'audio.transcriptions.realtime.inference'
								| 'audio.transcriptions.realtime.session',
					  )
				: isAudio && isAudioHttp
				? selectedIsAudioTranscription
					? AUDIO_TRANSCRIPTIONS_BODY_TEMPLATE
					: proto === 'dashscope' && r.upstream_operation === 'audio.speech'
					? buildDashScopeSpeechBodyTemplate(r.provider_model_name)
					: AUDIO_SPEECH_BODY_TEMPLATE
				: isImage && proto === 'openai'
				? IMAGE_GENERATIONS_BODY_TEMPLATE
				: proto === 'openai' && r.upstream_operation === 'responses'
				? BODY_TEMPLATES.openai_responses
				: BODY_TEMPLATES[proto] ?? BODY_TEMPLATES.openai,
		);
		setBodyError(null);
		setImagePreviews([]);
		setResponseMeta(null);
		setLastSentWireBody(null);
		setResponseText('');
		setUsageHint(null);
	}, [selectedId, routes, modelsById, selectedIsAudioTranscription]);

	useEffect(() => {
		return () => {
			if (audioPreviewUrl) URL.revokeObjectURL(audioPreviewUrl);
		};
	}, [audioPreviewUrl]);

	const onImageOperationChange = (next: ImageOperation) => {
		setImageOperation(next);
		if (selectedIsImage && normalizeProtocol(selected?.upstream_protocol ?? 'openai') === 'openai') {
			setBodyText(next === 'edits' ? IMAGE_EDITS_BODY_TEMPLATE : IMAGE_GENERATIONS_BODY_TEMPLATE);
			setBodyError(null);
		}
		if (next === 'generations') {
			setEditFiles([]);
		}
	};

	const scrollStreamToBottom = useCallback(() => {
		streamEndRef.current?.scrollIntoView({ behavior: 'smooth' });
		mergedStreamEndRef.current?.scrollIntoView({ behavior: 'smooth' });
	}, []);

	const stopRealtime = () => {
		if (realtimeRef.current) stopDashScopeRealtimeClient(realtimeRef.current);
		realtimeRef.current = null;
	};

	const send = async () => {
		if (!selected) {
			setBodyError(tCommon('selectRouteFirst'));
			return;
		}
		if (imageSendBlocked) {
			setBodyError(t('imageOpenaiOnly'));
			return;
		}
		if (audioSendBlocked) {
			setBodyError(t('audioOpenaiOnly'));
			return;
		}
		let bodyObj: Record<string, unknown>;
		try {
			bodyObj = JSON.parse(bodyText) as Record<string, unknown>;
			if (bodyObj === null || typeof bodyObj !== 'object' || Array.isArray(bodyObj)) {
				setBodyError(tCommon('bodyMustBeJsonObject'));
				return;
			}
		} catch {
			setBodyError(tCommon('invalidJson'));
			return;
		}

		const proto = normalizeProtocol(selected.upstream_protocol);
		const isRealtime = selectedDashScopeRealtimeOperation != null;
		const useAudio =
			selectedIsAudio &&
			!isRealtime &&
			(selectedAudioUpstreamProtocol === 'openai' || selectedAudioUpstreamProtocol === 'dashscope');
		const useImages = selectedIsImage && !selectedIsAudio && proto === 'openai';
		const effectiveImageOp: ImageOperation | undefined = useImages ? imageOperation : undefined;

		if (isRealtime) {
			if (selectedDashScopeRealtimeOperation.startsWith('audio.transcriptions') && selectedNeedsAudioFile) {
				const validated = validateAudioTranscriptionFile(audioFile);
				if (!validated.ok) {
					setBodyError(validated.error);
					return;
				}
			}
		} else if (useAudio && selectedIsAudioTranscription) {
			const validated = validateAudioTranscriptionFile(audioFile);
			if (!validated.ok) {
				setBodyError(validated.error);
				return;
			}
			try {
				const dataUrl = await readFileAsDataUrl(audioFile!);
				// file_name：供服务端拼 multipart 文件名（勿丢扩展名；中文名服务端会规范为 audio.<ext>）
				bodyObj = { ...bodyObj, file: dataUrl, file_name: audioFile!.name };
			} catch (e) {
				setBodyError(e instanceof Error ? e.message : tCommon('requestFailed'));
				return;
			}
		}

		if (effectiveImageOp === 'edits') {
			const validated = validateEditImageFiles(editFiles);
			if (!validated.ok) {
				setBodyError(validated.error);
				return;
			}
			try {
				const dataUrls = await Promise.all(editFiles.map((f) => readFileAsDataUrl(f)));
				bodyObj = {
					...bodyObj,
					image: dataUrls.length === 1 ? dataUrls[0] : dataUrls,
				};
			} catch (e) {
				setBodyError(e instanceof Error ? e.message : tCommon('requestFailed'));
				return;
			}
		}

		setBodyError(null);
		setSending(true);
		setResponseText('');
		setUsageHint(null);
		setImagePreviews([]);
		setAudioPreviewUrl(null);
		realtimeAudioChunksRef.current = [];
		setResponseMeta(null);
		setLastSentWireBody(null);

		setResponseProtocol(proto);
		if (isRealtime) {
			const realtimeUrl = `${window.location.origin}/api/admin/playground/realtime?${new URLSearchParams({
				routeId: selected.id,
				operation: selectedDashScopeRealtimeOperation,
			}).toString()}`;
			const startedAt = performance.now();
			const realtimeAudioType = dashScopeRealtimeAudioContentType(JSON.stringify(bodyObj));
			setLastSentWireBody(JSON.stringify(bodyObj, null, 2));
			try {
				const socket = openDashScopeRealtimeClient({
					url: realtimeUrl,
					operation: selectedDashScopeRealtimeOperation,
					initialMessage: JSON.stringify(bodyObj),
					audioInput: selectedCanUseMicrophone ? audioInputMode : 'file',
					audioFile: selectedNeedsAudioFile ? audioFile : undefined,
					onOpen: () => {
						setResponseMeta({
							status: 101,
							latencyMs: String(Math.round(performance.now() - startedAt)),
							upstreamUrl: previewUpstreamUrl,
							contentType: 'application/x-ndjson',
						});
					},
					onMessage: (message) => {
						const text = typeof message === 'string' ? message : `[binary frame: ${message.byteLength} bytes]`;
						setResponseText((previous) => (previous ? `${previous}\n${text}` : text));
					},
					onAudioChunk: (chunk) => {
						if (!selectedIsAudioTranscription) realtimeAudioChunksRef.current.push(chunk);
					},
					onError: (error) =>
						setBodyError(error instanceof Error ? error.message : 'Realtime WebSocket transport error'),
					onClose: (event) => {
						if (!selectedIsAudioTranscription && realtimeAudioChunksRef.current.length > 0) {
							const blob = new Blob(realtimeAudioChunksRef.current, {
								type: realtimeAudioType,
							});
							setAudioPreviewUrl(URL.createObjectURL(blob));
							realtimeAudioChunksRef.current = [];
						}
						setSending(false);
						realtimeRef.current = null;
						setResponseMeta(
							(previous) =>
								previous ?? {
									status: 101,
									latencyMs: String(Math.round(performance.now() - startedAt)),
									upstreamUrl: previewUpstreamUrl,
									contentType: 'application/x-ndjson',
								},
						);
						if (event.code !== 1000 && event.reason) setBodyError(event.reason);
					},
				});
				realtimeRef.current = socket;
			} catch (error) {
				setSending(false);
				setBodyError(error instanceof Error ? error.message : tCommon('requestFailed'));
			}
			return;
		}
		const payload: {
			routeId: string;
			body: Record<string, unknown>;
			geminiAction?: 'generateContent' | 'streamGenerateContent';
			imageOperation?: ImageOperation;
		} = { routeId: selected.id, body: bodyObj };
		if (proto === 'gemini') {
			payload.geminiAction = geminiAction;
		}
		if (effectiveImageOp) {
			payload.imageOperation = effectiveImageOp;
		}

		try {
			const res = await fetch('/api/admin/playground', {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify(payload),
			});

			const latencyMs = res.headers.get('x-playground-latency-ms');
			const upstreamUrl = res.headers.get('x-playground-upstream-url');
			const ct = res.headers.get('Content-Type') ?? '';

			setLastSentWireBody(decodeWireRequestBodyHeader(res));

			setResponseMeta({
				status: res.status,
				latencyMs,
				upstreamUrl,
				contentType: ct,
			});

			if (
				selectedIsAudio &&
				!selectedIsAudioTranscription &&
				res.ok &&
				(ct.toLowerCase().startsWith('audio/') || ct.toLowerCase().startsWith('application/octet-stream'))
			) {
				const blob = await res.blob();
				setAudioPreviewUrl(URL.createObjectURL(blob));
				setResponseText(t('audioResponseReceived', { bytes: blob.size }));
				setSending(false);
				return;
			}

			const jsonErr = ct.includes('application/json') && !ct.includes('text/event-stream');
			if (jsonErr) {
				const j = (await res.json()) as ApiResponse<unknown> & {
					error?: string | { message?: string };
					message?: string;
				};
				setResponseText(JSON.stringify(j, null, 2));
				if (!res.ok) {
					setUsageHint(null);
					const errObj = j.error;
					const nested =
						errObj && typeof errObj === 'object' && 'message' in errObj
							? String((errObj as { message?: unknown }).message ?? '')
							: '';
					let msg = (j.message ?? '').trim();
					if (!msg && typeof errObj === 'string') msg = errObj;
					if (!msg) msg = nested.trim();
					if (!msg) msg = tCommon('requestFailed');
					setBodyError(msg);
				} else if (useImages) {
					const parsedImg = parseImagesGenerationsResponse(JSON.stringify(j), imageRequestMetaFromBody(bodyObj));
					setImagePreviews(parsedImg.images);
					setUsageHint(parsedImg.usageHint);
				} else {
					const summary = tryParseUsageSummary(JSON.stringify(j), proto);
					setUsageHint(summary);
				}
				setSending(false);
				return;
			}

			if (ct.includes('text/event-stream') && res.body) {
				const reader = res.body.getReader();
				const dec = new TextDecoder();
				let acc = '';
				while (true) {
					const { done, value } = await reader.read();
					if (done) break;
					acc += dec.decode(value, { stream: true });
					// 避免 React 18 批处理把多次更新合成一次渲染，导致「拼接内容」只在流结束后才出现
					flushSync(() => {
						setResponseText(acc);
					});
					scrollStreamToBottom();
				}
				acc += dec.decode();
				flushSync(() => {
					setResponseText(acc);
				});
				setUsageHint(parseLastStreamUsage(acc, proto));
				setSending(false);
				return;
			}

			const text = await res.text();
			setResponseText(text);
			if (useImages && res.ok) {
				const parsedImg = parseImagesGenerationsResponse(text, imageRequestMetaFromBody(bodyObj));
				setImagePreviews(parsedImg.images);
				setUsageHint(parsedImg.usageHint);
			} else {
				let summary: string | null = null;
				try {
					summary = tryParseUsageSummary(text, proto);
				} catch {
					summary = null;
				}
				setUsageHint(summary);
			}
		} catch (e) {
			setResponseText('');
			setBodyError(e instanceof Error ? e.message : tCommon('requestFailed'));
		} finally {
			setSending(false);
		}
	};

	if (loadingRoutes && playgroundMode === 'routes') {
		return (
			<div className="flex items-center justify-center h-full min-h-[240px]">
				<div className="text-gray-600">{tCommon('loading')}</div>
			</div>
		);
	}

	return (
		<div className="p-8">
			<div className="mb-6">
				<h1 className="text-3xl font-bold text-gray-900">{t('title')}</h1>
				<p className="text-sm text-gray-500 mt-1">
					{playgroundMode === 'tools'
						? t('toolsSubtitle', { product: tBrand('product') })
						: t('subtitle', { product: tBrand('product') })}
					<span className="text-gray-400"> · </span>
					{t('usageNote')}
				</p>
				<div
					className="mt-4 inline-flex rounded-md border border-gray-200 bg-gray-50 p-0.5"
					role="group"
					aria-label={t('mode')}
				>
					{(
						[
							{ id: 'routes' as const, label: t('modeRoutes') },
							{ id: 'tools' as const, label: t('modeTools') },
						] as const
					).map((opt) => {
						const active = playgroundMode === opt.id;
						return (
							<button
								key={opt.id}
								type="button"
								onClick={() => setPlaygroundMode(opt.id)}
								className={
									active
										? 'rounded px-3 py-1.5 text-sm font-medium bg-white text-gray-900 shadow-sm'
										: 'rounded px-3 py-1.5 text-sm font-medium text-gray-600 hover:text-gray-900'
								}
							>
								{opt.label}
							</button>
						);
					})}
				</div>
			</div>

			{playgroundMode === 'tools' ? (
				<div className="max-w-3xl">
					<PlaygroundToolsPanel initialToolId={initialToolId} initialProvider={initialProvider} />
				</div>
			) : loadError ? (
				<div className="p-3 bg-red-50 border border-red-200 rounded-md text-red-600 text-sm max-w-3xl">{loadError}</div>
			) : (
				<div className="flex flex-col gap-6">
					<div className="grid grid-cols-1 xl:grid-cols-2 xl:items-stretch gap-6">
						<div className="min-w-0 flex flex-col h-full">
							<div className="bg-white rounded-lg shadow-md p-6 space-y-4 flex flex-col h-full min-h-0">
								<h2 className="text-lg font-semibold text-gray-900 border-b border-gray-100 pb-3">
									{t('routeSection')}
								</h2>
								<div>
									<label className={labelClass}>{t('kind')}</label>
									<div
										className="inline-flex w-full sm:w-auto rounded-md border border-gray-200 bg-gray-50 p-0.5"
										role="group"
										aria-label={t('kind')}
									>
										{(
											[
												{
													id: 'llm' as const,
													label: t('kindLlm'),
													count: kindCounts.llm,
												},
												{
													id: 'image' as const,
													label: t('kindImage'),
													count: kindCounts.image,
												},
												{
													id: 'audio' as const,
													label: t('kindAudio'),
													count: kindCounts.audio,
												},
											] as const
										).map((opt) => {
											const active = filterKind === opt.id;
											return (
												<button
													key={opt.id}
													type="button"
													onClick={() => onFilterKindChange(opt.id)}
													className={
														active
															? 'flex-1 sm:flex-none rounded px-3 py-1.5 text-sm font-medium bg-white text-gray-900 shadow-sm'
															: 'flex-1 sm:flex-none rounded px-3 py-1.5 text-sm font-medium text-gray-600 hover:text-gray-900'
													}
												>
													{opt.label}
													<span className="ml-1.5 text-xs text-gray-400 tabular-nums">{opt.count}</span>
												</button>
											);
										})}
									</div>
								</div>
								<div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
									<div>
										<label className={labelClass}>{t('modelId')}</label>
										<select value={filterModel} onChange={(e) => setFilterModel(e.target.value)} className={inputClass}>
											<option value="">{t('placeholders.allModels')}</option>
											{modelOptions.map((o) => (
												<option key={o.id} value={o.id}>
													{o.label}
												</option>
											))}
										</select>
									</div>
									<div>
										<label className={labelClass}>{t('provider')}</label>
										<select
											value={filterProvider}
											onChange={(e) => setFilterProvider(e.target.value)}
											className={inputClass}
										>
											<option value="">{t('placeholders.allProviders')}</option>
											{providerOptions.map((o) => (
												<option key={o.id} value={o.id}>
													{o.label}
												</option>
											))}
										</select>
									</div>
									<div>
										<label className={labelClass}>{t('protocol')}</label>
										<select
											value={filterProtocol}
											onChange={(e) => setFilterProtocol(e.target.value)}
											className={inputClass}
										>
											<option value="">{t('placeholders.allProtocols')}</option>
											{protocolOptions.map((p) => (
												<option key={p} value={p}>
													{p}
												</option>
											))}
										</select>
									</div>
									<div>
										<label className={labelClass}>{t('routeGroup')}</label>
										<select value={filterGroup} onChange={(e) => setFilterGroup(e.target.value)} className={inputClass}>
											<option value="">{t('placeholders.allRouteGroups')}</option>
											{groupOptions.map((g) => (
												<option key={g} value={g}>
													{g}
												</option>
											))}
										</select>
									</div>
								</div>
								<div>
									<label className={labelClass}>{t('selectRoute')}</label>
									<select
										value={selectedId}
										onChange={(e) => setSelectedId(e.target.value)}
										className={`${inputClass} font-mono`}
										size={Math.min(10, Math.max(6, Math.min(filteredRoutes.length, 10) || 6))}
									>
										<option value="">{t('selectRouteOption')}</option>
										{filteredRoutes.map((r) => (
											<option key={r.id} value={r.id}>
												{routeActiveIndicator(r.status)} {formatRouteLabel(r)} · {r.id.slice(0, 8)}…
											</option>
										))}
									</select>
									<p className="mt-2 text-xs text-gray-500">
										{t('routeCount', {
											total: routesInKind.length,
											filtered: filteredRoutes.length,
										})}
									</p>
								</div>
							</div>
						</div>

						<div className="min-w-0 flex flex-col h-full">
							<div className="bg-white rounded-lg shadow-md p-6 space-y-4 flex flex-col h-full min-h-0">
								<h2 className="text-lg font-semibold text-gray-900 border-b border-gray-100 pb-3 break-words">
									{selected ? (
										<>
											{t('selected')}：<span className="font-mono text-base font-normal">{selected.id}</span>
										</>
									) : (
										t('selectedRoute')
									)}
								</h2>
								{selected ? (
									<>
										<div className="grid grid-cols-1 sm:grid-cols-2 gap-x-6 gap-y-3">
											<ReadonlyField label={t('modelId')}>{selected.model_id}</ReadonlyField>
											<ReadonlyField label={t('modelName')}>{selected.model_name ?? '—'}</ReadonlyField>
											<ReadonlyField label={t('providerId')}>{selected.provider_id}</ReadonlyField>
											<ReadonlyField label={t('providerName')}>{selected.provider_name ?? '—'}</ReadonlyField>
											<ReadonlyField label={t('upstreamProtocol')}>{selected.upstream_protocol}</ReadonlyField>
											<ReadonlyField label="Upstream operation">{selected.upstream_operation ?? '*'}</ReadonlyField>
											<ReadonlyField label={t('providerModel')}>{selected.provider_model_name}</ReadonlyField>
											<ReadonlyField label={t('routeGroup')}>{selected.route_group}</ReadonlyField>
											<ReadonlyField label="Routing pool">
												{selected.pool_name ?? selected.route_pool_id ?? 'legacy'}
											</ReadonlyField>
											<ReadonlyField label="Public surfaces">{formatRouteJsonColumn(selected.surfaces)}</ReadonlyField>
											<ReadonlyField label={t('priorityStatus')}>
												{selected.priority} /{' '}
												<span
													className={
														selected.status === 'active' ? 'text-green-700 font-medium' : 'text-amber-700 font-medium'
													}
												>
													{selected.status}
												</span>
											</ReadonlyField>
										</div>
										<div className="grid grid-cols-1 sm:grid-cols-2 gap-3 pt-3 border-t border-gray-100 min-w-0">
											<div className="min-w-0 flex flex-col">
												<div className="block text-xs font-medium text-gray-600 mb-1">custom_params</div>
												<pre className={routeJsonPreClass}>{formatRouteJsonColumn(selected.custom_params)}</pre>
											</div>
											<div className="min-w-0 flex flex-col">
												<div className="block text-xs font-medium text-gray-600 mb-1">price_override</div>
												<pre className={routeJsonPreClass}>{formatRouteJsonColumn(selected.price_override)}</pre>
											</div>
										</div>
									</>
								) : (
									<p className="text-sm text-gray-500">{t('chooseRouteHint')}</p>
								)}
							</div>
						</div>
					</div>

					<div className="grid grid-cols-1 xl:grid-cols-2 gap-6">
						<div className="min-w-0">
							<div className="bg-white rounded-lg shadow-md p-6 space-y-4">
								<div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-3 border-b border-gray-100 pb-3">
									<h2 className="text-lg font-semibold text-gray-900">{t('requestBody')}</h2>
									{sending && selectedDashScopeRealtimeOperation ? (
										<button
											type="button"
											onClick={stopRealtime}
											className="inline-flex items-center justify-center gap-2 px-4 py-2 bg-amber-600 text-white text-sm font-medium rounded-md hover:bg-amber-700"
										>
											{tCommon('stop')}
										</button>
									) : (
										<button
											type="button"
											onClick={() => void send()}
											disabled={
												sending ||
												!selected ||
												imageSendBlocked ||
												audioSendBlocked ||
												(selectedNeedsAudioFile && !validateAudioTranscriptionFile(audioFile).ok) ||
												(selectedIsImage &&
													!selectedIsAudio &&
													imageOperation === 'edits' &&
													!validateEditImageFiles(editFiles).ok)
											}
											className="inline-flex items-center justify-center gap-2 px-4 py-2 bg-blue-600 text-white text-sm font-medium rounded-md hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-blue-500 disabled:opacity-50 disabled:cursor-not-allowed shrink-0"
										>
											<PaperAirplaneIcon className="h-4 w-4" />
											{sending ? tCommon('sending') : tCommon('send')}
										</button>
									)}
								</div>
								{imageSendBlocked ? (
									<div className="p-3 bg-amber-50 border border-amber-200 rounded-md text-amber-900 text-sm">
										{t('imageOpenaiOnly')}
									</div>
								) : null}
								{audioSendBlocked ? (
									<div className="p-3 bg-amber-50 border border-amber-200 rounded-md text-amber-900 text-sm">
										{t('audioOpenaiOnly')}
									</div>
								) : null}
								<div className="space-y-1">
									<RequestTargetUrl
										label={t('requestTargetUrl')}
										method={selectedUsesDashScopeRealtime ? 'WebSocket' : undefined}
										url={requestTargetUrl}
										emptyHint={t('requestTargetUrlEmpty')}
									/>
									{selected ? (
										<p className="text-[11px] text-gray-400">
											{t(selectedUsesDashScopeRealtime ? 'requestTargetUrlRealtimeHint' : 'requestTargetUrlHint')}
										</p>
									) : null}
								</div>
								{selectedIsAudio && !audioSendBlocked ? (
									<div className="space-y-2">
										<p className="text-xs text-gray-500">
											{t(
												selectedUsesDashScopeRealtime
													? 'audioRealtimeDashScopeHint'
													: selectedAudioUsesDashScope
													? selectedIsAudioTranscription
														? 'audioTranscriptionsDashScopeHint'
														: 'audioSpeechHint'
													: selectedIsAudioTranscription
													? 'audioTranscriptionsHint'
													: 'audioSpeechHint',
											)}
										</p>
										{selectedCanUseMicrophone ? (
											<fieldset className="flex flex-wrap items-center gap-4 rounded-md border border-gray-200 px-3 py-2 text-sm">
												<legend className="sr-only">{t('audioInputMode')}</legend>
												<span className="font-medium text-gray-600">{t('audioInputMode')}</span>
												<label className="inline-flex cursor-pointer items-center gap-2">
													<input
														type="radio"
														name="playgroundAudioInput"
														className="text-blue-600 focus:ring-blue-500"
														checked={audioInputMode === 'file'}
														onChange={() => setAudioInputMode('file')}
														disabled={sending}
													/>
													{t('audioInputFile')}
												</label>
												<label className="inline-flex cursor-pointer items-center gap-2">
													<input
														type="radio"
														name="playgroundAudioInput"
														className="text-blue-600 focus:ring-blue-500"
														checked={audioInputMode === 'microphone'}
														onChange={() => setAudioInputMode('microphone')}
														disabled={sending}
													/>
													{t('audioInputMicrophone')}
												</label>
											</fieldset>
										) : null}
										{selectedNeedsAudioFile ? (
											<div>
												<label className={labelClass}>{t('audioFile')}</label>
												<input
													type="file"
													accept="audio/*,.mp3,.wav,.m4a,.webm,.ogg,.flac"
													disabled={sending}
													className={`${inputClass} file:mr-3 file:rounded file:border-0 file:bg-blue-50 file:px-2 file:py-1 file:text-xs file:font-medium file:text-blue-700`}
													onChange={(e) => {
														const f = e.target.files?.[0] ?? null;
														setAudioFile(f);
													}}
												/>
												<p className="mt-1 text-[11px] text-gray-400">
													{t(
														selectedUsesDashScopeRealtime
															? 'audioRealtimeFileDashScopeHint'
															: selectedAudioUsesDashScope
															? 'audioFileDashScopeHint'
															: 'audioFileHint',
													)}
												</p>
												{!audioFile ? (
													<p className="mt-1 text-xs text-amber-700">{t('audioFileRequired')}</p>
												) : (
													<p className="mt-1 text-xs text-gray-600">
														{audioFile.name} ({audioFile.size} bytes)
													</p>
												)}
												{(() => {
													if (!audioFile) return null;
													const validated = validateAudioTranscriptionFile(audioFile);
													if (validated.ok) return null;
													return <p className="mt-1 text-xs text-red-600">{validated.error}</p>;
												})()}
											</div>
										) : null}
									</div>
								) : null}
								{selectedIsImage && !selectedIsAudio && !imageSendBlocked ? (
									<>
										<fieldset className="flex flex-wrap items-center gap-4 text-sm border border-gray-200 rounded-md px-3 py-2">
											<legend className="sr-only">{t('imageOperation')}</legend>
											<span className="text-gray-600 font-medium">{t('imageOperation')}</span>
											<label className="inline-flex items-center gap-2 cursor-pointer">
												<input
													type="radio"
													name="playgroundImageOperation"
													className="text-blue-600 focus:ring-blue-500"
													checked={imageOperation === 'generations'}
													onChange={() => onImageOperationChange('generations')}
													disabled={sending}
												/>
												generations
											</label>
											<label className="inline-flex items-center gap-2 cursor-pointer">
												<input
													type="radio"
													name="playgroundImageOperation"
													className="text-blue-600 focus:ring-blue-500"
													checked={imageOperation === 'edits'}
													onChange={() => onImageOperationChange('edits')}
													disabled={sending}
												/>
												edits
											</label>
										</fieldset>
										<p className="text-xs text-gray-500">
											{imageOperation === 'edits' ? t('imageEditsHint') : t('imageGenerationsHint')}
										</p>
										{imageOperation === 'edits' ? (
											<div>
												<label className={labelClass}>{t('referenceImages')}</label>
												<input
													type="file"
													accept="image/png,image/jpeg,image/webp,image/*"
													multiple
													disabled={sending}
													className={`${inputClass} file:mr-3 file:rounded file:border-0 file:bg-blue-50 file:px-2 file:py-1 file:text-xs file:font-medium file:text-blue-700`}
													onChange={(e) => {
														const list = e.target.files ? Array.from(e.target.files) : [];
														setEditFiles(list.slice(0, IMAGE_MAX_REFERENCE_COUNT));
													}}
												/>
												<p className="mt-1 text-[11px] text-gray-400">
													{t('referenceImagesHint', {
														max: IMAGE_MAX_REFERENCE_COUNT,
													})}
													{editFiles.length > 0
														? ` · ${t('referenceImagesSelected', {
																count: editFiles.length,
														  })}`
														: ''}
												</p>
												{editFiles.length === 0 ? (
													<p className="mt-1 text-xs text-amber-700">{t('referenceImagesRequired')}</p>
												) : null}
												{(() => {
													if (editFiles.length === 0) return null;
													const validated = validateEditImageFiles(editFiles);
													if (validated.ok) return null;
													return <p className="mt-1 text-xs text-red-600">{validated.error}</p>;
												})()}
												{editFiles.length > 0 ? (
													<ul className="mt-1 text-xs text-gray-600 list-disc list-inside">
														{editFiles.map((f) => (
															<li key={`${f.name}-${f.size}-${f.lastModified}`}>
																{f.name} ({f.size} bytes)
															</li>
														))}
													</ul>
												) : null}
											</div>
										) : null}
									</>
								) : null}
								{normalizeProtocol(selected?.upstream_protocol ?? 'openai') === 'gemini' &&
									!selectedIsImage &&
									!selectedIsAudio && (
										<fieldset className="flex flex-wrap items-center gap-4 text-sm border border-gray-200 rounded-md px-3 py-2">
											<legend className="sr-only">{t('geminiAction')}</legend>
											<span className="text-gray-600 font-medium">{t('geminiAction')}</span>
											<label className="inline-flex items-center gap-2 cursor-pointer">
												<input
													type="radio"
													name="geminiAction"
													className="text-blue-600 focus:ring-blue-500"
													checked={geminiAction === 'generateContent'}
													onChange={() => setGeminiAction('generateContent')}
												/>
												generateContent
											</label>
											<label className="inline-flex items-center gap-2 cursor-pointer">
												<input
													type="radio"
													name="geminiAction"
													checked={geminiAction === 'streamGenerateContent'}
													onChange={() => setGeminiAction('streamGenerateContent')}
												/>
												streamGenerateContent
											</label>
										</fieldset>
									)}
								<div>
									<label className={labelClass}>JSON</label>
									<textarea
										value={bodyText}
										onChange={(e) => setBodyText(e.target.value)}
										rows={8}
										className={`${inputClass} font-mono text-sm min-h-[100px]`}
										spellCheck={false}
									/>
								</div>
								{bodyError && (
									<div className="p-3 bg-red-50 border border-red-200 rounded-md text-red-600 text-sm">{bodyError}</div>
								)}
								{lastSentWireBody != null && lastSentWireBody !== '' && (
									<div className="pt-2 border-t border-gray-100 space-y-2">
										<div>
											<div className="text-xs font-medium text-gray-600 mb-1">
												{t('sentBody')}
												<span className="font-normal text-gray-500 normal-case tracking-normal">
													{' '}
													{t('sentBodyHint')}
												</span>
											</div>
											<pre className={codeBlockClass}>{lastSentWireBody}</pre>
										</div>
									</div>
								)}
							</div>
						</div>

						<div className="min-w-0">
							<div className="bg-white rounded-lg shadow-md p-6 space-y-4">
								<div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-2 border-b border-gray-100 pb-3">
									<h2 className="text-lg font-semibold text-gray-900 shrink-0">{t('response')}</h2>
									{responseMeta && (
										<div className="flex flex-wrap items-center justify-end gap-2 text-xs min-w-0">
											<span className="inline-flex items-center rounded-full bg-gray-100 px-2.5 py-1 font-medium text-gray-800">
												HTTP {responseMeta.status}
											</span>
											{responseMeta.latencyMs != null && (
												<span className="inline-flex items-center rounded-full bg-gray-100 px-2.5 py-1 font-medium text-gray-800">
													{responseMeta.latencyMs} ms
												</span>
											)}
											{responseMeta.contentType && (
												<span
													className="inline-flex items-center rounded-full bg-gray-100 px-2.5 py-1 font-medium text-gray-700 max-w-full truncate"
													title={responseMeta.contentType}
												>
													{responseMeta.contentType}
												</span>
											)}
										</div>
									)}
								</div>
								{responseMeta || responseText || imagePreviews.length > 0 || audioPreviewUrl ? (
									<>
										{responseMeta?.upstreamUrl && (
											<div className="text-xs text-gray-500 break-all">
												<span className="font-medium text-gray-600">{t('upstream')}</span>
												{responseMeta.upstreamUrl}
											</div>
										)}
										{usageHint && (
											<div className="p-3 rounded-md bg-green-50 border border-green-200 text-sm text-green-900">
												<span className="font-semibold">{t('usageDisplayOnly')}</span>
												{usageHint}
											</div>
										)}
										{imagePreviews.length > 0 ? (
											<ImageGenerationsPreview images={imagePreviews} label={t('imagePreview')} />
										) : null}
										{audioPreviewUrl ? (
											<div className="rounded-md border border-slate-200 bg-slate-50 p-4 space-y-3">
												<div className="text-sm font-medium text-gray-800">{t('audioPreview')}</div>
												<audio className="w-full" controls src={audioPreviewUrl} />
												<a
													href={audioPreviewUrl}
													download="speech-output"
													className="inline-flex text-xs font-medium text-blue-700 hover:text-blue-900 hover:underline"
												>
													{t('downloadAudio')}
												</a>
											</div>
										) : null}
										<div className="space-y-3">
											{imagePreviews.length === 0 ? (
												<div>
													<div className="text-xs font-medium text-gray-600 mb-1">{t('mergedContent')}</div>
													<div className="rounded-md border border-slate-200 overflow-hidden divide-y divide-slate-200">
														<div>
															<div className="text-[11px] font-semibold text-amber-900/85 uppercase tracking-wide px-3 py-1.5 bg-amber-50 border-b border-amber-100">
																{t('thinking')}
															</div>
															<pre className="max-h-[min(220px,32vh)] overflow-auto p-3 bg-amber-50/60 text-sm text-gray-900 font-mono whitespace-pre-wrap break-words">
																{mergedReasoningDisplay}
															</pre>
														</div>
														<div>
															<div className="text-[11px] font-semibold text-slate-600 uppercase tracking-wide px-3 py-1.5 bg-slate-50 border-b border-slate-100">
																{t('body')}
															</div>
															<pre className="max-h-[min(280px,38vh)] overflow-auto p-3 bg-slate-50 text-sm text-gray-900 font-mono whitespace-pre-wrap break-words">
																{mergedBodyDisplay}
																<span
																	ref={mergedStreamEndRef}
																	className="inline-block w-0 h-0 overflow-hidden"
																	aria-hidden
																/>
															</pre>
														</div>
													</div>
												</div>
											) : null}
											<div>
												<div className="text-xs font-medium text-gray-600 mb-1">{t('rawPayload')}</div>
												<pre className="max-h-[min(520px,50vh)] overflow-auto p-4 bg-gray-50 border border-gray-200 rounded-md text-xs text-gray-900 font-mono whitespace-pre-wrap break-words">
													{responseText}
													<span ref={streamEndRef} className="inline-block w-0 h-0 overflow-hidden" aria-hidden />
												</pre>
											</div>
										</div>
									</>
								) : (
									<p className="text-sm text-gray-500">{t('emptyResponseHint')}</p>
								)}
							</div>
						</div>
					</div>
				</div>
			)}
		</div>
	);
}

export default function PlaygroundPage() {
	return (
		<Suspense
			fallback={
				<div className="flex items-center justify-center h-full min-h-[240px]">
					<div className="text-gray-600">Loading…</div>
				</div>
			}
		>
			<PlaygroundPageInner />
		</Suspense>
	);
}
