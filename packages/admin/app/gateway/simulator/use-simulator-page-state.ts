'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useTranslations } from 'next-intl';
import { flushSync } from 'react-dom';
import { readApiJson } from '@/lib/api-json';
import {
	imageRequestMetaFromBody,
	isImageRouteModel,
	parseImagesGenerationsResponse,
	type ImagePreviewItem,
} from '@/lib/image-generations';
import {
	inferPlaygroundParseMode,
	mergeAssistantTextParts,
	type PlaygroundProtocol,
} from '@/lib/playground/merge-assistant-text';
import { normalizeProtocol, parseLastStreamUsage, tryParseUsageSummary } from '@/lib/playground/usage-parsing';
import {
	buildSimulatorRequest,
	type SimulatorGeminiAction,
	type SimulatorProtocol,
} from '@/lib/simulator/endpoint';
import type { AdminKeyListItem, AdminModelRow } from '@/lib/services/admin/types';
import type { ApiResponse } from '@/lib/types';
import {
	BODY_TEMPLATES,
	bodyTemplateForSelection,
	KEYS_PAGE_SIZE,
	LS_KEY_ID,
	LS_MODEL_ID,
	LS_PROTOCOL,
	LS_PROXY,
	LS_ROUTE_GROUP,
	buildModelRoutingString,
	filterMatchingActiveRoutes,
	isBodyDirty,
	redactHeaders,
	tryParseProxyBaseUrl,
} from './simulator-utils';
import type { ResponseMeta, ResponseTab, RouteListRow, SendBlockReason, WirePreview } from './types';

export function useSimulatorPageState() {
	const t = useTranslations('simulator');
	const tCommon = useTranslations('common');

	const [proxyBaseUrl, setProxyBaseUrl] = useState('');
	const [protocol, setProtocolState] = useState<SimulatorProtocol>('openai');
	const [geminiAction, setGeminiAction] = useState<SimulatorGeminiAction>('streamGenerateContent');

	const [models, setModels] = useState<AdminModelRow[]>([]);
	const [routes, setRoutes] = useState<RouteListRow[]>([]);
	const [loadingCatalog, setLoadingCatalog] = useState(true);
	const [catalogError, setCatalogError] = useState<string | null>(null);

	const [filterModel, setFilterModel] = useState('');
	const [selectedModelId, setSelectedModelId] = useState('');
	const [routeGroup, setRouteGroup] = useState('');

	const [keys, setKeys] = useState<AdminKeyListItem[]>([]);
	const [keysTotal, setKeysTotal] = useState(0);
	const [filterKeyEmail, setFilterKeyEmail] = useState('');
	const [loadingKeys, setLoadingKeys] = useState(false);
	const [keysError, setKeysError] = useState<string | null>(null);

	const [selectedKeyId, setSelectedKeyId] = useState('');
	const [revealedSk, setRevealedSk] = useState<string | null>(null);
	const [revealLoading, setRevealLoading] = useState(false);
	const [revealError, setRevealError] = useState<string | null>(null);

	const [bodyText, setBodyText] = useState(BODY_TEMPLATES.openai);
	const [bodyError, setBodyError] = useState<string | null>(null);
	const [infoHint, setInfoHint] = useState<string | null>(null);

	const [sending, setSending] = useState(false);
	const abortRef = useRef<AbortController | null>(null);
	const [responseMeta, setResponseMeta] = useState<ResponseMeta | null>(null);
	const [responseText, setResponseText] = useState('');
	const [responseProtocol, setResponseProtocol] = useState<PlaygroundProtocol>('openai');
	const [usageHint, setUsageHint] = useState<string | null>(null);
	const [wirePreview, setWirePreview] = useState<WirePreview | null>(null);
	const [wireOpen, setWireOpen] = useState(false);
	const [responseTab, setResponseTab] = useState<ResponseTab>('merged');
	const [imagePreviews, setImagePreviews] = useState<ImagePreviewItem[]>([]);
	const [hydrated, setHydrated] = useState(false);

	const streamEndRef = useRef<HTMLSpanElement>(null);
	const mergedStreamEndRef = useRef<HTMLSpanElement>(null);

	const filteredModels = useMemo(() => {
		const q = filterModel.trim().toLowerCase();
		if (!q) return models;
		return models.filter(
			(m) =>
				m.id.toLowerCase().includes(q) ||
				(m.display_name ?? '').toLowerCase().includes(q) ||
				m.vendor.toLowerCase().includes(q)
		);
	}, [models, filterModel]);

	const modelIdsWithActiveRouter = useMemo(() => {
		const s = new Set<string>();
		for (const r of routes) {
			if (r.model_id && String(r.status).toLowerCase() === 'active') {
				s.add(r.model_id);
			}
		}
		return s;
	}, [routes]);

	const routeGroupsForModel = useMemo(() => {
		if (!selectedModelId) return [] as string[];
		const set = new Set<string>();
		for (const r of routes) {
			if (r.model_id === selectedModelId && String(r.status).toLowerCase() === 'active' && r.route_group) {
				set.add(r.route_group);
			}
		}
		return Array.from(set).sort((a, b) => a.localeCompare(b));
	}, [routes, selectedModelId]);

	const selectedModel = useMemo(
		() => models.find((m) => m.id === selectedModelId) ?? null,
		[models, selectedModelId]
	);

	const selectedModelIsImage = useMemo(
		() => (selectedModel ? isImageRouteModel(selectedModel) : false),
		[selectedModel]
	);

	const modelRoutingString = useMemo(() => {
		if (!selectedModelId) return '';
		return buildModelRoutingString(selectedModelId, routeGroup);
	}, [selectedModelId, routeGroup]);

	const matchingRoutes = useMemo(
		() => filterMatchingActiveRoutes(routes, selectedModelId, routeGroup),
		[routes, selectedModelId, routeGroup]
	);

	const sendBlockReason = useMemo((): SendBlockReason => {
		const parsed = tryParseProxyBaseUrl(proxyBaseUrl);
		if (!parsed.ok) return 'proxyBaseUrl';
		if (!selectedModelId) return 'model';
		if (selectedModelIsImage && protocol !== 'openai') return 'imageProtocol';
		if (revealLoading && selectedKeyId) return 'keyLoading';
		if (!revealedSk || !revealedSk.startsWith('sk-')) return 'key';
		return null;
	}, [
		proxyBaseUrl,
		selectedModelId,
		selectedModelIsImage,
		protocol,
		revealLoading,
		selectedKeyId,
		revealedSk,
	]);

	const sendBlockedHint = useMemo(() => {
		switch (sendBlockReason) {
			case 'proxyBaseUrl':
				return t('readyNeedProxyUrl');
			case 'model':
				return t('readyNeedModel');
			case 'imageProtocol':
				return t('readyNeedOpenaiForImage');
			case 'keyLoading':
				return t('readyNeedKeyLoading');
			case 'key':
				return t('readyNeedKey');
			default:
				return null;
		}
	}, [sendBlockReason, t]);

	const liveWirePreview = useMemo((): WirePreview | null => {
		const parsed = tryParseProxyBaseUrl(proxyBaseUrl);
		if (!parsed.ok || !selectedModelId || !revealedSk?.startsWith('sk-')) return null;
		let bodyObj: Record<string, unknown>;
		try {
			bodyObj = JSON.parse(bodyText) as Record<string, unknown>;
			if (bodyObj === null || typeof bodyObj !== 'object' || Array.isArray(bodyObj)) return null;
		} catch {
			return null;
		}
		const routing = modelRoutingString;
		if (protocol === 'openai' || protocol === 'anthropic') {
			bodyObj = { ...bodyObj, model: routing };
		}
		try {
			const built = buildSimulatorRequest({
				baseUrl: parsed.base,
				protocol,
				modelForRouting: routing,
				geminiAction: protocol === 'gemini' ? geminiAction : undefined,
				body: bodyObj,
				apiKey: revealedSk,
				imagesGenerations: selectedModelIsImage && protocol === 'openai',
			});
			return {
				method: 'POST',
				url: built.url,
				headers: redactHeaders(built.headers),
				bodyText: built.bodyText,
			};
		} catch {
			return null;
		}
	}, [
		proxyBaseUrl,
		selectedModelId,
		revealedSk,
		bodyText,
		modelRoutingString,
		protocol,
		geminiAction,
		selectedModelIsImage,
	]);

	const displayWire = wirePreview ?? liveWirePreview;

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
			p.reasoning ||
			(sending && hasRaw ? t('receiving') : '') ||
			(!sending && hasRaw && !p.reasoning ? '—' : '');
		const bodyDisplay =
			p.body ||
			(sending && hasRaw ? t('receiving') : '') ||
			(!sending && hasRaw && !p.body ? (!p.reasoning ? t('couldNotExtractBody') : '—') : '');
		return { mergedReasoningDisplay: reasoningDisplay, mergedBodyDisplay: bodyDisplay };
	}, [mergedAssistantParts, responseText, sending, t]);

	const scrollStreamToBottom = useCallback(() => {
		streamEndRef.current?.scrollIntoView({ behavior: 'smooth' });
		mergedStreamEndRef.current?.scrollIntoView({ behavior: 'smooth' });
	}, []);

	useEffect(() => {
		try {
			const u = localStorage.getItem(LS_PROXY);
			if (u) setProxyBaseUrl(u);
			const p = localStorage.getItem(LS_PROTOCOL);
			if (p === 'openai' || p === 'anthropic' || p === 'gemini') {
				setProtocolState(p);
				setBodyText(BODY_TEMPLATES[p]);
			}
			const mid = localStorage.getItem(LS_MODEL_ID);
			if (mid) setSelectedModelId(mid);
			const rg = localStorage.getItem(LS_ROUTE_GROUP);
			if (rg != null) setRouteGroup(rg);
			const kid = localStorage.getItem(LS_KEY_ID);
			if (kid) setSelectedKeyId(kid);
		} catch {
			// ignore
		}
		setHydrated(true);
	}, []);

	useEffect(() => {
		if (!hydrated) return;
		try {
			localStorage.setItem(LS_PROXY, proxyBaseUrl);
		} catch {
			// ignore
		}
	}, [proxyBaseUrl, hydrated]);

	useEffect(() => {
		if (!hydrated) return;
		try {
			localStorage.setItem(LS_PROTOCOL, protocol);
		} catch {
			// ignore
		}
	}, [protocol, hydrated]);

	useEffect(() => {
		if (!hydrated) return;
		try {
			if (selectedModelId) localStorage.setItem(LS_MODEL_ID, selectedModelId);
			else localStorage.removeItem(LS_MODEL_ID);
		} catch {
			// ignore
		}
	}, [selectedModelId, hydrated]);

	useEffect(() => {
		if (!hydrated) return;
		try {
			localStorage.setItem(LS_ROUTE_GROUP, routeGroup);
		} catch {
			// ignore
		}
	}, [routeGroup, hydrated]);

	useEffect(() => {
		if (!hydrated) return;
		try {
			if (selectedKeyId) localStorage.setItem(LS_KEY_ID, selectedKeyId);
			else localStorage.removeItem(LS_KEY_ID);
		} catch {
			// ignore
		}
	}, [selectedKeyId, hydrated]);

	useEffect(() => {
		let cancelled = false;
		(async () => {
			setLoadingCatalog(true);
			setCatalogError(null);
			try {
				const [mRes, rRes] = await Promise.all([fetch('/api/admin/models'), fetch('/api/admin/routes')]);
				const mData = await readApiJson<AdminModelRow[]>(mRes);
				const rData = await readApiJson<RouteListRow[]>(rRes);
				if (cancelled) return;
				if (mData.success && Array.isArray(mData.data)) {
					setModels(mData.data);
				} else {
					setCatalogError(mData.message ?? tCommon('failedToLoadModels'));
				}
				if (rData.success && Array.isArray(rData.data)) {
					setRoutes(rData.data);
				} else if (!cancelled) {
					setCatalogError((prev) => prev ?? rData.message ?? tCommon('failedToLoadRoutes'));
				}
			} catch (e) {
				if (!cancelled) setCatalogError(e instanceof Error ? e.message : tCommon('failedToLoadModels'));
			} finally {
				if (!cancelled) setLoadingCatalog(false);
			}
		})();
		return () => {
			cancelled = true;
		};
	}, [tCommon]);

	useEffect(() => {
		if (!selectedModelId) return;
		if (routeGroup && !routeGroupsForModel.includes(routeGroup) && routeGroupsForModel.length > 0) {
			setRouteGroup('');
		}
	}, [selectedModelId, routeGroup, routeGroupsForModel]);

	const prevSelectedWasImageRef = useRef(false);

	/** Image models: force openai + generations template; leaving image restores chat template. */
	useEffect(() => {
		if (selectedModelIsImage) {
			if (protocol !== 'openai') {
				setProtocolState('openai');
			}
			setBodyText(bodyTemplateForSelection('openai', true));
			setBodyError(null);
			setImagePreviews([]);
			prevSelectedWasImageRef.current = true;
			return;
		}
		if (prevSelectedWasImageRef.current) {
			setBodyText(bodyTemplateForSelection(protocol, false));
			setBodyError(null);
			setImagePreviews([]);
			prevSelectedWasImageRef.current = false;
		}
	}, [selectedModelId, selectedModelIsImage]); // eslint-disable-line react-hooks/exhaustive-deps -- template only on model kind switch

	const loadKeys = useCallback(async () => {
		setLoadingKeys(true);
		setKeysError(null);
		try {
			const sp = new URLSearchParams({
				page: '1',
				page_size: String(KEYS_PAGE_SIZE),
			});
			if (filterKeyEmail.trim()) sp.set('email', filterKeyEmail.trim());
			const res = await fetch(`/api/admin/keys?${sp.toString()}`);
			const data = await readApiJson<AdminKeyListItem[]>(res);
			if (data.success && Array.isArray(data.data) && typeof data.total === 'number') {
				setKeys(data.data);
				setKeysTotal(data.total);
			} else {
				setKeysError(data.message ?? tCommon('failedToLoadApiKeys'));
			}
		} catch (e) {
			setKeysError(e instanceof Error ? e.message : tCommon('failedToLoadApiKeys'));
		} finally {
			setLoadingKeys(false);
		}
	}, [filterKeyEmail, tCommon]);

	useEffect(() => {
		void loadKeys();
	}, [loadKeys]);

	useEffect(() => {
		if (!selectedKeyId) {
			setRevealedSk(null);
			setRevealError(null);
			setRevealLoading(false);
			return;
		}
		let cancelled = false;
		setRevealLoading(true);
		setRevealError(null);
		setRevealedSk(null);
		void (async () => {
			try {
				const res = await fetch(`/api/admin/keys/${encodeURIComponent(selectedKeyId)}`);
				const data = await readApiJson<{ key: string }>(res);
				if (cancelled) return;
				if (data.success && data.data && typeof data.data.key === 'string') {
					setRevealedSk(data.data.key);
				} else {
					setRevealError(data.message ?? tCommon('failedToLoadApiKeys'));
				}
			} catch (e) {
				if (!cancelled) setRevealError(e instanceof Error ? e.message : tCommon('failedToLoadApiKeys'));
			} finally {
				if (!cancelled) setRevealLoading(false);
			}
		})();
		return () => {
			cancelled = true;
		};
	}, [selectedKeyId, tCommon]);

	const applyProtocolTemplate = useCallback(
		(next: SimulatorProtocol, isImage = selectedModelIsImage) => {
			setProtocolState(next);
			setBodyText(bodyTemplateForSelection(next, isImage && next === 'openai'));
			setBodyError(null);
		},
		[selectedModelIsImage]
	);

	const requestProtocolChange = useCallback(
		(next: SimulatorProtocol) => {
			if (next === protocol) return;
			if (selectedModelIsImage && next !== 'openai') {
				setInfoHint(t('readyNeedOpenaiForImage'));
				return;
			}
			if (isBodyDirty(bodyText, protocol, selectedModelIsImage)) {
				const ok = window.confirm(t('protocolSwitchConfirm'));
				if (!ok) return;
			}
			applyProtocolTemplate(next);
		},
		[protocol, bodyText, t, applyProtocolTemplate, selectedModelIsImage]
	);

	const applyCurrentTemplate = useCallback(() => {
		setBodyText(bodyTemplateForSelection(protocol, selectedModelIsImage));
		setBodyError(null);
	}, [protocol, selectedModelIsImage]);

	const stop = useCallback(() => {
		abortRef.current?.abort();
		abortRef.current = null;
	}, []);

	const send = useCallback(async () => {
		setInfoHint(null);
		const parsed = tryParseProxyBaseUrl(proxyBaseUrl);
		if (!parsed.ok) {
			setBodyError(parsed.reason === 'empty' ? t('errProxyUrlRequired') : t('errProxyUrlInvalid'));
			return;
		}
		const base = parsed.base;

		if (!selectedModelId) {
			setBodyError(t('errSelectModel'));
			return;
		}
		if (revealLoading) {
			setBodyError(t('errKeyLoading'));
			return;
		}
		if (!revealedSk || !revealedSk.startsWith('sk-')) {
			setBodyError(t('errSelectKey'));
			return;
		}

		let bodyObj: Record<string, unknown>;
		try {
			bodyObj = JSON.parse(bodyText) as Record<string, unknown>;
			if (bodyObj === null || typeof bodyObj !== 'object' || Array.isArray(bodyObj)) {
				setBodyError(t('errBodyMustBeObject'));
				return;
			}
		} catch {
			setBodyError(tCommon('invalidJson'));
			return;
		}

		const protoNorm = normalizeProtocol(protocol);
		setResponseProtocol(protoNorm);

		const routing = modelRoutingString;
		if (protocol === 'openai' || protocol === 'anthropic') {
			const prev = bodyObj.model;
			bodyObj = { ...bodyObj, model: routing };
			if (prev !== routing) {
				setInfoHint(t('infoModelOverwritten', { model: routing }));
			}
		}

		const useImages = selectedModelIsImage && protocol === 'openai';
		const built = buildSimulatorRequest({
			baseUrl: base,
			protocol,
			modelForRouting: routing,
			geminiAction: protocol === 'gemini' ? geminiAction : undefined,
			body: bodyObj,
			apiKey: revealedSk,
			imagesGenerations: useImages,
		});

		setBodyError(null);
		setSending(true);
		setResponseText('');
		setUsageHint(null);
		setImagePreviews([]);
		setResponseMeta(null);
		setResponseTab('merged');
		setWirePreview({
			method: 'POST',
			url: built.url,
			headers: redactHeaders(built.headers),
			bodyText: built.bodyText,
		});
		setWireOpen(true);

		const ac = new AbortController();
		abortRef.current = ac;
		const t0 = performance.now();

		try {
			const res = await fetch(built.url, {
				method: 'POST',
				headers: built.headers,
				body: built.bodyText,
				signal: ac.signal,
			});

			const latencyMs = String(Math.round(performance.now() - t0));
			const ct = res.headers.get('Content-Type') ?? '';

			setResponseMeta({
				status: res.status,
				latencyMs,
				requestUrl: built.url,
				contentType: ct,
			});

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
					const nestedMsg =
						errObj && typeof errObj === 'object' && 'message' in errObj
							? String((errObj as { message?: unknown }).message ?? '')
							: '';
					const nestedUrl =
						errObj && typeof errObj === 'object' && 'upstream_url' in errObj
							? String((errObj as { upstream_url?: unknown }).upstream_url ?? '')
							: '';
					let msg = (j.message ?? '').trim();
					if (!msg && typeof errObj === 'string') msg = errObj;
					if (!msg) msg = nestedMsg.trim();
					if (!msg) msg = tCommon('requestFailed');
					if (nestedUrl) msg = `${msg}\nupstream: ${nestedUrl}`;
					setBodyError(msg);
				} else if (useImages) {
					const parsedImg = parseImagesGenerationsResponse(
						JSON.stringify(j),
						imageRequestMetaFromBody(bodyObj)
					);
					setImagePreviews(parsedImg.images);
					setUsageHint(parsedImg.usageHint);
				} else {
					setUsageHint(tryParseUsageSummary(JSON.stringify(j), protoNorm));
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
					flushSync(() => {
						setResponseText(acc);
					});
					scrollStreamToBottom();
				}
				acc += dec.decode();
				flushSync(() => {
					setResponseText(acc);
				});
				setUsageHint(parseLastStreamUsage(acc, protoNorm));
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
					summary = tryParseUsageSummary(text, protoNorm);
				} catch {
					summary = null;
				}
				setUsageHint(summary);
			}
			if (!res.ok) {
				setBodyError(text.slice(0, 500) || `HTTP ${res.status}`);
			}
		} catch (e) {
			if (e instanceof DOMException && e.name === 'AbortError') {
				setBodyError(tCommon('requestCancelled'));
				setResponseText('');
			} else {
				setResponseText('');
				setBodyError(e instanceof Error ? e.message : tCommon('requestFailed'));
			}
		} finally {
			setSending(false);
			abortRef.current = null;
		}
	}, [
		proxyBaseUrl,
		selectedModelId,
		selectedModelIsImage,
		revealLoading,
		revealedSk,
		bodyText,
		protocol,
		modelRoutingString,
		geminiAction,
		t,
		tCommon,
		scrollStreamToBottom,
	]);

	const selectModel = useCallback((id: string) => {
		setSelectedModelId(id);
		setRouteGroup('');
	}, []);

	return {
		loadingCatalog,
		catalogError,
		proxyBaseUrl,
		setProxyBaseUrl,
		protocol,
		requestProtocolChange,
		applyCurrentTemplate,
		bodyDirty: isBodyDirty(bodyText, protocol, selectedModelIsImage),
		geminiAction,
		setGeminiAction,
		filterModel,
		setFilterModel,
		filteredModels,
		models,
		modelIdsWithActiveRouter,
		selectedModelId,
		selectModel,
		routeGroup,
		setRouteGroup,
		routeGroupsForModel,
		selectedModel,
		selectedModelIsImage,
		modelRoutingString,
		matchingRoutes,
		imagePreviews,
		keys,
		keysTotal,
		filterKeyEmail,
		setFilterKeyEmail,
		loadingKeys,
		keysError,
		loadKeys,
		selectedKeyId,
		setSelectedKeyId,
		revealedSk,
		revealLoading,
		revealError,
		bodyText,
		setBodyText,
		bodyError,
		infoHint,
		sending,
		send,
		stop,
		sendBlockReason,
		sendBlockedHint,
		canSend: sendBlockReason === null && !sending,
		responseMeta,
		responseText,
		usageHint,
		displayWire,
		wireOpen,
		setWireOpen,
		responseTab,
		setResponseTab,
		mergedReasoningDisplay,
		mergedBodyDisplay,
		streamEndRef,
		mergedStreamEndRef,
	};
}

export type SimulatorPageState = ReturnType<typeof useSimulatorPageState>;
