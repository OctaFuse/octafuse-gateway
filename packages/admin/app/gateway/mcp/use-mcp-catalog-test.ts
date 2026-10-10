'use client';

import { useEffect, useRef, useState } from 'react';
import { useTranslations } from 'next-intl';
import { readApiJson } from '@/lib/api-json';
import type { AdminKeyListItem } from '@/lib/services/admin/types';
import {
	MCP_CATALOG_PROXY_STORAGE,
	SIMULATOR_PROXY_STORAGE,
	buildMcpCatalogRequest,
	mcpProxyBaseUrl,
	normalizeMcpApiKey,
	parseMcpCatalogResponse,
	redactMcpRequest,
	type McpCatalogMethod,
	type McpCatalogRequest,
} from './mcp-catalog-test-utils';

export type McpCatalogTestResponse = {
	request: McpCatalogRequest;
	status: number;
	elapsedMs: number;
	receivedAt: string;
	headers: Record<string, string>;
	rawText: string;
	parsed: ReturnType<typeof parseMcpCatalogResponse>;
	ok: boolean;
};

export function useMcpCatalogTest(initialSlug: string) {
	const t = useTranslations('mcp.catalogTest');
	const [baseUrl, setBaseUrl] = useState('');
	const [slug, setSlug] = useState(initialSlug);
	const [method, setMethod] = useState<McpCatalogMethod>('tools/list');
	const [protocolVersion, setProtocolVersion] = useState('2025-06-18');
	const [apiKey, setApiKey] = useState('');
	const [visibleKey, setVisibleKey] = useState(false);
	const [sending, setSending] = useState(false);
	const [error, setError] = useState<string | null>(null);
	const [response, setResponse] = useState<McpCatalogTestResponse | null>(null);
	const [sentRequest, setSentRequest] = useState<McpCatalogRequest | null>(null);
	const [view, setView] = useState<'raw' | 'grouped'>('raw');
	const requestId = useRef(0);
	const activeRequest = useRef<AbortController | null>(null);
	const keyRequest = useRef<AbortController | null>(null);
	const keysRequest = useRef<AbortController | null>(null);
	const [keys, setKeys] = useState<AdminKeyListItem[]>([]);
	const [keysLoaded, setKeysLoaded] = useState(false);
	const [loadingKeys, setLoadingKeys] = useState(false);
	const [keysError, setKeysError] = useState<string | null>(null);
	const [keyFilter, setKeyFilter] = useState('');
	const [selectedKeyId, setSelectedKeyId] = useState('');
	const [loadingKey, setLoadingKey] = useState(false);

	useEffect(() => {
		let saved: string | null = null;
		try {
			saved =
				localStorage.getItem(MCP_CATALOG_PROXY_STORAGE) || localStorage.getItem(SIMULATOR_PROXY_STORAGE);
		} catch {
			/* Storage can be unavailable in private contexts. */
		}
		if (saved && mcpProxyBaseUrl(saved)) setBaseUrl(saved);
		else if (['localhost', '127.0.0.1', '[::1]'].includes(window.location.hostname)) {
			const local = new URL(window.location.origin);
			local.port = '8787';
			setBaseUrl(local.origin);
		}
		return () => {
			activeRequest.current?.abort();
			activeRequest.current = null;
			keyRequest.current?.abort();
			keysRequest.current?.abort();
		};
	}, []);

	function invalidate() {
		setResponse(null);
		setSentRequest(null);
		setError(null);
	}
	function updateApiKey(value: string) {
		keyRequest.current?.abort();
		setSelectedKeyId('');
		setLoadingKey(false);
		setKeysError(null);
		setApiKey(value);
		invalidate();
	}

	async function loadKeys() {
		keysRequest.current?.abort();
		const controller = new AbortController();
		keysRequest.current = controller;
		setLoadingKeys(true);
		setKeysError(null);
		try {
			const params = new URLSearchParams({ page: '1', page_size: '100' });
			if (keyFilter.trim()) params.set('email', keyFilter.trim());
			const result = await readApiJson<AdminKeyListItem[]>(
				await fetch(`/api/admin/keys?${params}`, { signal: controller.signal })
			);
			if (controller.signal.aborted) return;
			if (!result.success || !Array.isArray(result.data)) throw new Error(result.message || t('keysFailed'));
			setKeys(result.data);
			setKeysLoaded(true);
		} catch (cause) {
			if (!controller.signal.aborted) setKeysError(cause instanceof Error ? cause.message : t('keysFailed'));
		} finally {
			if (!controller.signal.aborted) setLoadingKeys(false);
		}
	}

	async function selectKey(id: string) {
		keyRequest.current?.abort();
		const controller = new AbortController();
		keyRequest.current = controller;
		setSelectedKeyId(id);
		setApiKey('');
		setKeysError(null);
		invalidate();
		setLoadingKey(Boolean(id));
		if (!id) return;
		try {
			const result = await readApiJson<{ key: string }>(
				await fetch(`/api/admin/keys/${encodeURIComponent(id)}`, { signal: controller.signal })
			);
			if (controller.signal.aborted) return;
			if (!result.success || !result.data?.key) throw new Error(result.message || t('keysFailed'));
			setApiKey(result.data.key);
		} catch (cause) {
			if (!controller.signal.aborted) setKeysError(cause instanceof Error ? cause.message : t('keysFailed'));
		} finally {
			if (!controller.signal.aborted) setLoadingKey(false);
		}
	}

	async function send() {
		if (activeRequest.current || loadingKey) return;
		const base = mcpProxyBaseUrl(baseUrl);
		if (!base) {
			setError(t('invalidUrl'));
			return;
		}
		const key = normalizeMcpApiKey(apiKey);
		if (!key || /[\r\n]/.test(key)) {
			setError(t('keyRequired'));
			return;
		}
		const controller = new AbortController();
		activeRequest.current = controller;
		const request = buildMcpCatalogRequest({
			baseUrl: base,
			slug,
			method,
			protocolVersion,
			apiKey: key,
			id: ++requestId.current,
		});
		setSentRequest(redactMcpRequest(request));
		setResponse(null);
		setError(null);
		setSending(true);
		try {
			localStorage.setItem(MCP_CATALOG_PROXY_STORAGE, base);
		} catch {
			/* Only the URL is persisted. */
		}
		const started = performance.now();
		const timer = setTimeout(() => controller.abort('timeout'), 30_000);
		try {
			const result = await fetch(request.url, {
				method: request.method,
				headers: request.headers,
				body: request.bodyText,
				signal: controller.signal,
				credentials: 'omit',
				redirect: 'error',
				cache: 'no-store',
			});
			const rawText = await result.text();
			if (activeRequest.current !== controller) return;
			const parsed = parseMcpCatalogResponse(rawText, request);
			const ok = result.ok && parsed.valid;
			setResponse({
				request: redactMcpRequest(request),
				status: result.status,
				elapsedMs: Math.round(performance.now() - started),
				receivedAt: new Date().toISOString(),
				headers: Object.fromEntries(result.headers.entries()),
				rawText,
				parsed,
				ok,
			});
			if (!result.ok) setError(t('httpError', { status: result.status }));
			else if (parsed.rpcError) setError(t('rpcError', { message: parsed.rpcError }));
			else if (!parsed.valid) setError(t('invalidResponse'));
		} catch {
			if (activeRequest.current !== controller) return;
			setError(
				controller.signal.aborted
					? t(controller.signal.reason === 'timeout' ? 'timeout' : 'cancelled')
					: t('networkError')
			);
		} finally {
			clearTimeout(timer);
			if (activeRequest.current === controller) {
				activeRequest.current = null;
				setSending(false);
			}
		}
	}

	const preview = buildMcpCatalogRequest({
		baseUrl: mcpProxyBaseUrl(baseUrl) ?? baseUrl.trim().replace(/\/+$/, ''),
		slug,
		method,
		protocolVersion,
		apiKey: '',
		id: requestId.current + 1,
	});
	return {
		baseUrl,
		setBaseUrl: (value: string) => {
			setBaseUrl(value);
			invalidate();
		},
		slug,
		setSlug: (value: string) => {
			setSlug(value);
			invalidate();
		},
		method,
		setMethod: (value: McpCatalogMethod) => {
			setMethod(value);
			invalidate();
		},
		protocolVersion,
		setProtocolVersion: (value: string) => {
			setProtocolVersion(value);
			invalidate();
		},
		apiKey,
		setApiKey: updateApiKey,
		visibleKey,
		setVisibleKey,
		sending,
		error,
		response,
		view,
		setView,
		request: sentRequest ?? redactMcpRequest(preview),
		send,
		stop: () => activeRequest.current?.abort('cancelled'),
		keys,
		keysLoaded,
		loadingKeys,
		keysError,
		keyFilter,
		setKeyFilter,
		selectedKeyId,
		loadingKey,
		loadKeys,
		selectKey,
	};
}
