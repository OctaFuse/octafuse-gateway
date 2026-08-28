'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { flushSync } from 'react-dom';
import { isAudioRouteModel, validateAudioTranscriptionFile } from '@/lib/audio-transcriptions';
import { isAudioTranscriptionModel } from '@octafuse/core/db/model-modalities';
import {
	IMAGE_EDITS_BODY_TEMPLATE,
	IMAGE_GENERATIONS_BODY_TEMPLATE,
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
import { observePlaygroundResponse } from '@/lib/playground/response-observations';
import { normalizeProtocol, parseLastStreamUsage, tryParseUsageSummary } from '@/lib/playground/usage-parsing';
import {
	dashScopeRealtimeAudioContentType,
	defaultAudioInputModeForDashScopeOperation,
	isDashScopeRealtimeOperation,
	openDashScopeRealtimeClient,
	stopDashScopeRealtimeClient,
} from '@/lib/dashscope-realtime-client';
import { readApiJson } from '@/lib/api-json';
import type { AdminModelRow } from '@/lib/services/admin/types';
import type { ApiResponse, GatewayProvider } from '@/lib/types';
import { DEFAULT_KIND_FILTER, type ModelKindFilter } from '../models/types';
import {
	BODY_TEMPLATES,
	decodeWireRequestBodyHeader,
	isPlaygroundBodyDirty,
	playgroundLlmSampleBody,
	playgroundModelHintFromRoute,
	previewPlaygroundMergedBody,
	resolvePlaygroundLlmFamily,
	resolveRouteModelKind,
	routeMatchesSearch,
	templateForRoute,
	type PlaygroundLlmSampleId,
} from './playground-utils';
import type { FilterOption, GeminiAction, PlaygroundMode, ResponseMeta, ResponseTab, RouteListRow } from './types';

function isAbortError(error: unknown): boolean {
	return (
		(error instanceof DOMException && error.name === 'AbortError') ||
		(error instanceof Error && error.name === 'AbortError')
	);
}

export function usePlaygroundPageState() {
	const t = useTranslations('playground');
	const tCommon = useTranslations('common');
	const searchParams = useSearchParams();
	const initialMode: PlaygroundMode =
		searchParams.get('mode') === 'tools' || searchParams.get('tool') ? 'tools' : 'routes';
	const initialRouteId = searchParams.get('routeId')?.trim() ?? '';
	const initialToolId = searchParams.get('tool');
	const initialProvider = searchParams.get('provider');

	const [playgroundMode, setPlaygroundMode] = useState<PlaygroundMode>(initialMode);
	const [routes, setRoutes] = useState<RouteListRow[]>([]);
	const [modelsById, setModelsById] = useState<Map<string, AdminModelRow>>(new Map());
	const [providersById, setProvidersById] = useState<Map<string, GatewayProvider>>(new Map());
	const [loadingRoutes, setLoadingRoutes] = useState(true);
	const [loadError, setLoadError] = useState<string | null>(null);

	const [filterKind, setFilterKind] = useState<ModelKindFilter>(DEFAULT_KIND_FILTER);
	const [filterModel, setFilterModel] = useState('');
	const [filterProvider, setFilterProvider] = useState('');
	const [routeSearch, setRouteSearch] = useState('');

	const [selectedId, setSelectedId] = useState('');
	const [bodyText, setBodyTextState] = useState(BODY_TEMPLATES.openai);
	const [templateBody, setTemplateBody] = useState(BODY_TEMPLATES.openai);
	const [bodyError, setBodyError] = useState<string | null>(null);
	const [bodyDirtyHint, setBodyDirtyHint] = useState(false);
	const [geminiAction, setGeminiAction] = useState<GeminiAction>('streamGenerateContent');
	const [imageOperation, setImageOperation] = useState<ImageOperation>('generations');
	const [editFiles, setEditFiles] = useState<File[]>([]);
	const [audioFile, setAudioFile] = useState<File | null>(null);
	const [audioInputMode, setAudioInputMode] = useState<'file' | 'microphone'>('microphone');
	const [audioPreviewUrl, setAudioPreviewUrl] = useState<string | null>(null);
	const realtimeAudioChunksRef = useRef<ArrayBuffer[]>([]);
	const realtimeRef = useRef<WebSocket | null>(null);
	const abortRef = useRef<AbortController | null>(null);
	const bodyDirtyRef = useRef(false);
	const appliedDeepLinkRef = useRef(false);

	const [sending, setSending] = useState(false);
	const [responseMeta, setResponseMeta] = useState<ResponseMeta | null>(null);
	const [responseText, setResponseText] = useState('');
	const [responseProtocol, setResponseProtocol] = useState<PlaygroundProtocol>('openai');
	const [responseTab, setResponseTab] = useState<ResponseTab>('merged');
	const [usageHint, setUsageHint] = useState<string | null>(null);
	const [imagePreviews, setImagePreviews] = useState<ImagePreviewItem[]>([]);
	const [lastSentWireBody, setLastSentWireBody] = useState<string | null>(null);
	const [lastSentInputSnapshot, setLastSentInputSnapshot] = useState<string | null>(null);
	const streamEndRef = useRef<HTMLSpanElement>(null);
	const mergedStreamEndRef = useRef<HTMLSpanElement>(null);

	const selected = useMemo(() => routes.find((r) => r.id === selectedId) ?? null, [routes, selectedId]);
	const currentTemplate = selected
		? templateForRoute(selected, modelsById.get(selected.model_id), imageOperation)
		: BODY_TEMPLATES.openai;
	bodyDirtyRef.current = isPlaygroundBodyDirty(bodyText, templateBody);

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

	const selectedImageUpstreamProtocol = normalizeProtocol(selected?.upstream_protocol ?? 'openai');
	const imageSendBlocked =
		selectedIsImage && selectedImageUpstreamProtocol !== 'openai' && selectedImageUpstreamProtocol !== 'dashscope';
	const selectedImageUsesDashScope = selectedIsImage && selectedImageUpstreamProtocol === 'dashscope';
	const selectedAudioUpstreamProtocol = (selected?.upstream_protocol ?? 'openai').trim().toLowerCase();
	const audioSendBlocked =
		selectedIsAudio && selectedAudioUpstreamProtocol !== 'openai' && selectedAudioUpstreamProtocol !== 'dashscope';
	const selectedAudioUsesDashScope = selectedIsAudio && selectedAudioUpstreamProtocol === 'dashscope';
	const selectedUsesDashScopeRealtime = selectedDashScopeRealtimeOperation != null;
	const selectedCanUseMicrophone =
		selectedDashScopeRealtimeOperation?.startsWith('audio.transcriptions.realtime.') ?? false;
	const selectedNeedsAudioFile =
		selectedIsAudioTranscription &&
		selected?.adapter !== 'dashscope-asr-file-async' &&
		!(selected?.adapter === 'passthrough' && selected?.upstream_operation === 'audio.transcriptions.multimodal') &&
		(!selectedCanUseMicrophone || audioInputMode === 'file');

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

	const requestTargetUrl = responseMeta?.upstreamUrl ?? previewUpstreamUrl;

	const mergedAssistantParts = useMemo(() => {
		const mode = inferPlaygroundParseMode(responseMeta?.contentType ?? null);
		if (!responseText.trim() || !mode) {
			return { reasoning: '', body: '' };
		}
		return mergeAssistantTextParts(responseText, responseProtocol, mode);
	}, [responseText, responseProtocol, responseMeta?.contentType]);

	const observationTags = useMemo(() => {
		if (selectedIsImage || selectedIsAudio) return [];
		return observePlaygroundResponse({
			raw: responseText,
			protocol: responseProtocol,
			contentType: responseMeta?.contentType,
			requestBodyText: lastSentWireBody ?? bodyText,
		});
	}, [
		selectedIsImage,
		selectedIsAudio,
		responseText,
		responseProtocol,
		responseMeta?.contentType,
		lastSentWireBody,
		bodyText,
	]);

	const { mergedReasoningDisplay, mergedBodyDisplay } = useMemo(() => {
		const hasRaw = responseText.trim().length > 0;
		if (selectedUsesDashScopeRealtime) {
			return {
				mergedReasoningDisplay: '',
				mergedBodyDisplay:
					mergedAssistantParts.body ||
					responseText.trim() ||
					(sending ? t('realtimeWaitingTaskStarted') : ''),
			};
		}
		const p = mergedAssistantParts;
		const receiving = t('receiving');
		const reasoningDisplay =
			p.reasoning || (sending && hasRaw ? receiving : '') || (!sending && hasRaw && !p.reasoning ? '—' : '');
		const bodyDisplay =
			p.body ||
			(sending && hasRaw ? receiving : '') ||
			(!sending && hasRaw && !p.body ? (!p.reasoning ? t('cannotExtractBody') : '—') : '');
		return {
			mergedReasoningDisplay: reasoningDisplay,
			mergedBodyDisplay: bodyDisplay,
		};
	}, [mergedAssistantParts, responseText, sending, selectedUsesDashScopeRealtime, t]);

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

	const routesInKind = useMemo(
		() => routes.filter((r) => resolveRouteModelKind(modelsById.get(r.model_id)) === filterKind),
		[routes, modelsById, filterKind],
	);

	const filteredRoutes = useMemo(
		() =>
			routesInKind.filter((r) => {
				if (filterModel && r.model_id !== filterModel) return false;
				if (filterProvider && r.provider_id !== filterProvider) return false;
				return routeMatchesSearch(r, routeSearch);
			}),
		[routesInKind, filterModel, filterProvider, routeSearch],
	);

	const modelOptions = useMemo(() => {
		const byId = new Map<string, FilterOption>();
		for (const r of routesInKind) {
			if (filterProvider && r.provider_id !== filterProvider) continue;
			if (byId.has(r.model_id)) continue;
			const name = (r.model_name ?? '').trim();
			byId.set(r.model_id, {
				id: r.model_id,
				label: name && name !== r.model_id ? `${name} (${r.model_id})` : r.model_id,
			});
		}
		return [...byId.values()].sort((a, b) => a.label.localeCompare(b.label));
	}, [routesInKind, filterProvider]);

	const providerOptions = useMemo(() => {
		const byId = new Map<string, FilterOption>();
		for (const r of routesInKind) {
			if (filterModel && r.model_id !== filterModel) continue;
			if (byId.has(r.provider_id)) continue;
			const name = (r.provider_name ?? '').trim();
			byId.set(r.provider_id, {
				id: r.provider_id,
				label: name && name !== r.provider_id ? `${name} (${r.provider_id})` : r.provider_id,
			});
		}
		return [...byId.values()].sort((a, b) => a.label.localeCompare(b.label));
	}, [routesInKind, filterModel]);

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

	const onFilterKindChange = useCallback(
		(next: ModelKindFilter) => {
			if (next === filterKind) return;
			setFilterKind(next);
			setFilterModel('');
			setFilterProvider('');
			setRouteSearch('');
			if (selected && resolveRouteModelKind(modelsById.get(selected.model_id)) !== next) {
				setSelectedId('');
			}
		},
		[filterKind, selected, modelsById],
	);

	const selectRoute = useCallback((id: string) => {
		setSelectedId(id);
	}, []);

	const setBodyText = useCallback((value: string) => {
		setBodyTextState(value);
		setBodyDirtyHint(false);
	}, []);

	const applyCurrentTemplate = useCallback(() => {
		if (!selected) {
			setBodyTextState(BODY_TEMPLATES.openai);
			setTemplateBody(BODY_TEMPLATES.openai);
			setBodyError(null);
			setBodyDirtyHint(false);
			return;
		}
		const next = templateForRoute(selected, modelsById.get(selected.model_id), imageOperation);
		setBodyTextState(next);
		setTemplateBody(next);
		setBodyError(null);
		setBodyDirtyHint(false);
	}, [selected, modelsById, imageOperation]);

	const applyLlmSample = useCallback(
		(sampleId: PlaygroundLlmSampleId) => {
			const family = resolvePlaygroundLlmFamily(selected);
			if (!family) return;
			const next = playgroundLlmSampleBody(family, sampleId, playgroundModelHintFromRoute(selected));
			setBodyTextState(next);
			setTemplateBody(next);
			setBodyError(null);
			setBodyDirtyHint(false);
			if (family === 'gemini' && sampleId !== 'connectivity') {
				setGeminiAction('streamGenerateContent');
			}
		},
		[selected, setGeminiAction],
	);

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
		if (appliedDeepLinkRef.current || !initialRouteId || routes.length === 0) return;
		if (initialMode === 'tools') {
			appliedDeepLinkRef.current = true;
			return;
		}
		const route = routes.find((r) => r.id === initialRouteId);
		if (!route) return;
		appliedDeepLinkRef.current = true;
		setPlaygroundMode('routes');
		setFilterKind(resolveRouteModelKind(modelsById.get(route.model_id)));
		setSelectedId(route.id);
	}, [initialRouteId, initialMode, routes, modelsById]);

	useEffect(() => {
		const r = routes.find((x) => x.id === selectedId);
		if (!r) return;
		const nextTemplate = templateForRoute(r, modelsById.get(r.model_id), 'generations');
		setImageOperation('generations');
		setEditFiles([]);
		setAudioFile(null);
		setAudioInputMode(defaultAudioInputModeForDashScopeOperation(r.upstream_operation));
		setAudioPreviewUrl(null);
		realtimeAudioChunksRef.current = [];
		if (!bodyDirtyRef.current) {
			setBodyTextState(nextTemplate);
			setBodyDirtyHint(false);
		} else {
			setBodyDirtyHint(true);
		}
		setTemplateBody(nextTemplate);
		setBodyError(null);
		setImagePreviews([]);
		setResponseMeta(null);
		setLastSentWireBody(null);
		setLastSentInputSnapshot(null);
		setResponseText('');
		setUsageHint(null);
	}, [selectedId, routes, modelsById]);

	useEffect(() => {
		return () => {
			if (audioPreviewUrl) URL.revokeObjectURL(audioPreviewUrl);
		};
	}, [audioPreviewUrl]);

	const onImageOperationChange = (next: ImageOperation) => {
		setImageOperation(next);
		if (selectedIsImage && normalizeProtocol(selected?.upstream_protocol ?? 'openai') === 'openai') {
			const nextTemplate = next === 'edits' ? IMAGE_EDITS_BODY_TEMPLATE : IMAGE_GENERATIONS_BODY_TEMPLATE;
			if (!bodyDirtyRef.current) {
				setBodyTextState(nextTemplate);
			} else {
				setBodyDirtyHint(true);
			}
			setTemplateBody(nextTemplate);
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

	const stop = useCallback(() => {
		abortRef.current?.abort();
		abortRef.current = null;
		if (realtimeRef.current) {
			stopDashScopeRealtimeClient(realtimeRef.current);
			realtimeRef.current = null;
		}
		setSending(false);
	}, []);

	const sendBlockedHint = !selected
		? tCommon('selectRouteFirst')
		: imageSendBlocked
			? t('imageOpenaiOnly')
			: audioSendBlocked
				? t('audioOpenaiOnly')
				: selectedNeedsAudioFile && !validateAudioTranscriptionFile(audioFile).ok
					? t('audioFileRequired')
					: selectedIsImage &&
						  !selectedIsAudio &&
						  !selectedImageUsesDashScope &&
						  imageOperation === 'edits' &&
						  !validateEditImageFiles(editFiles).ok
						? t('referenceImagesRequired')
						: null;

	const canSend = !sending && sendBlockedHint == null;

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
		const useImages =
			selectedIsImage && !selectedIsAudio && (proto === 'openai' || proto === 'dashscope');
		const effectiveImageOp: ImageOperation | undefined = useImages
			? proto === 'dashscope'
				? 'generations'
				: imageOperation
			: undefined;

		if (isRealtime) {
			if (selectedDashScopeRealtimeOperation.startsWith('audio.transcriptions') && selectedNeedsAudioFile) {
				const validated = validateAudioTranscriptionFile(audioFile);
				if (!validated.ok) {
					setBodyError(validated.error);
					return;
				}
			}
		} else if (useAudio && selectedIsAudioTranscription && selectedNeedsAudioFile) {
			const validated = validateAudioTranscriptionFile(audioFile);
			if (!validated.ok) {
				setBodyError(validated.error);
				return;
			}
			try {
				const dataUrl = await readFileAsDataUrl(audioFile!);
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

		abortRef.current?.abort();
		if (realtimeRef.current) {
			stopDashScopeRealtimeClient(realtimeRef.current);
			realtimeRef.current = null;
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
		setLastSentInputSnapshot(null);
		setResponseTab('merged');

		setResponseProtocol(proto);
		if (isRealtime) {
			const realtimeUrl = `${window.location.origin}/api/admin/playground/realtime?${new URLSearchParams({
				routeId: selected.id,
				operation: selectedDashScopeRealtimeOperation,
			}).toString()}`;
			const startedAt = performance.now();
			const realtimeAudioType = dashScopeRealtimeAudioContentType(JSON.stringify(bodyObj));
			const realtimePreview = previewPlaygroundMergedBody({
				bodyText: JSON.stringify(bodyObj),
				customParams: selected.custom_params,
				upstreamProtocol: selected.upstream_protocol,
				providerModelName: selected.provider_model_name,
			});
			setLastSentWireBody(
				realtimePreview.status === 'preview' ? realtimePreview.json : JSON.stringify(bodyObj, null, 2),
			);
			setLastSentInputSnapshot(bodyText);
			const waitingText = t('realtimeWaitingTaskStarted');
			setResponseText(waitingText);
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
						setResponseText(waitingText);
					},
					onMessage: (message) => {
						const text = typeof message === 'string' ? message : `[binary frame: ${message.byteLength} bytes]`;
						setResponseText((previous) =>
							!previous || previous === waitingText ? text : `${previous}\n${text}`,
						);
					},
					onAudioChunk: (chunk) => {
						if (!selectedIsAudioTranscription) realtimeAudioChunksRef.current.push(chunk);
					},
					onError: (error) =>
						setBodyError(error instanceof Error ? error.message : t('realtimeTransportError')),
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
						if (event.code !== 1000 || event.reason) {
							setBodyError(
								t('realtimeClosed', {
									code: String(event.code),
									reason: event.reason ? `: ${event.reason}` : '',
								}),
							);
						}
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
			geminiAction?: GeminiAction;
			imageOperation?: ImageOperation;
		} = { routeId: selected.id, body: bodyObj };
		if (proto === 'gemini') {
			payload.geminiAction = geminiAction;
		}
		if (effectiveImageOp) {
			payload.imageOperation = effectiveImageOp;
		}

		const ac = new AbortController();
		abortRef.current = ac;

		try {
			const res = await fetch('/api/admin/playground', {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify(payload),
				signal: ac.signal,
			});

			const latencyMs = res.headers.get('x-playground-latency-ms');
			const upstreamUrl = res.headers.get('x-playground-upstream-url');
			const ct = res.headers.get('Content-Type') ?? '';

			setLastSentWireBody(decodeWireRequestBodyHeader(res, t('decodeWireFailed')));
			setLastSentInputSnapshot(bodyText);

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
					if (ac.signal.aborted) {
						await reader.cancel();
						break;
					}
					const { done, value } = await reader.read();
					if (done) break;
					acc += dec.decode(value, { stream: true });
					flushSync(() => {
						setResponseText(acc);
					});
					scrollStreamToBottom();
				}
				acc += dec.decode();
				flushSync(() => {
					setResponseText(acc);
				});
				if (!ac.signal.aborted) {
					setUsageHint(parseLastStreamUsage(acc, proto));
				}
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
			if (isAbortError(e)) {
				return;
			}
			const raw = e instanceof Error ? e.message : tCommon('requestFailed');
			setBodyError(
				/network error|failed to fetch|fetch failed/i.test(raw)
					? t('streamDisconnected', { cause: raw })
					: raw,
			);
		} finally {
			if (abortRef.current === ac) abortRef.current = null;
			setSending(false);
		}
	};

	return {
		playgroundMode,
		setPlaygroundMode,
		initialToolId,
		initialProvider,
		loadingRoutes,
		loadError,
		filterKind,
		onFilterKindChange,
		kindCounts,
		filterModel,
		setFilterModel,
		filterProvider,
		setFilterProvider,
		routeSearch,
		setRouteSearch,
		modelOptions,
		providerOptions,
		routesInKind,
		filteredRoutes,
		selectedId,
		selectRoute,
		selected,
		bodyText,
		setBodyText,
		bodyDirtyHint,
		applyLlmSample,
		bodyError,
		geminiAction,
		setGeminiAction,
		imageOperation,
		onImageOperationChange,
		editFiles,
		setEditFiles,
		audioFile,
		setAudioFile,
		audioInputMode,
		setAudioInputMode,
		audioPreviewUrl,
		sending,
		canSend,
		sendBlockedHint,
		send,
		stop,
		responseMeta,
		responseText,
		responseTab,
		setResponseTab,
		usageHint,
		imagePreviews,
		lastSentWireBody: lastSentWireBody && lastSentInputSnapshot === bodyText ? lastSentWireBody : null,
		requestTargetUrl,
		selectedIsImage,
		selectedIsAudio,
		selectedIsAudioTranscription,
		imageSendBlocked,
		selectedImageUsesDashScope,
		audioSendBlocked,
		selectedAudioUsesDashScope,
		selectedUsesDashScopeRealtime,
		selectedCanUseMicrophone,
		selectedNeedsAudioFile,
		selectedDashScopeRealtimeOperation,
		observationTags,
		mergedReasoningDisplay,
		mergedBodyDisplay,
		streamEndRef,
		mergedStreamEndRef,
	};
}
