'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { useTranslations } from 'next-intl';
import { useFeedback } from '@/components/feedback';
import { readApiJson } from '@/lib/api-json';
import type { McpPricingRule } from '@octafuse/core';
import { pricingDraftFromRule, pricingRuleFromDraft, type PricingDraftError } from './mcp-pricing-draft';
import {
	EMPTY_FORM,
	type CatalogItem,
	type ServerDetail,
	type ServerForm,
	type ServerSummary,
} from './mcp-types';

export function useMcpServersState() {
	const t = useTranslations('mcp');
	const tCommon = useTranslations('common');
	const { notify, confirm } = useFeedback();
	const [servers, setServers] = useState<ServerSummary[]>([]);
	const [selectedId, setSelectedId] = useState<string | null>(null);
	const selected = useRef<string | null>(null);
	const [detail, setDetail] = useState<ServerDetail | null>(null);
	const [tab, setTab] = useState<CatalogItem['kind']>('tool');
	const [formMode, setFormMode] = useState<'create' | 'edit' | null>(null);
	const [editingServer, setEditingServer] = useState<ServerSummary | null>(null);
	const [form, setForm] = useState<ServerForm>(EMPTY_FORM);
	const [action, setAction] = useState<string | null>(null);
	const actionLock = useRef(false);
	const [listLoading, setListLoading] = useState(true);
	const [listError, setListError] = useState(false);
	const [detailLoading, setDetailLoading] = useState(false);
	const [detailError, setDetailError] = useState(false);
	const [revealed, setRevealed] = useState<{ url: string; authHeaders: Record<string, string> } | null>(null);
	const [testResult, setTestResult] = useState<{ ok: boolean; message: string } | null>(null);
	const detailRequest = useRef(0);
	const listRequest = useRef(0);

	const loadList = useCallback(async () => {
		const request = ++listRequest.current;
		setListLoading(true);
		try {
			const response = await readApiJson<ServerSummary[]>(await fetch('/api/admin/mcp-servers'));
			if (request !== listRequest.current) return;
			if (!response.success || !response.data) throw new Error(response.message || t('loadFailed'));
			setServers(response.data);
			setListError(false);
		} catch {
			if (request === listRequest.current) setListError(true);
		} finally {
			if (request === listRequest.current) setListLoading(false);
		}
	}, [t]);

	const loadDetail = useCallback(
		async (id: string) => {
			const request = ++detailRequest.current;
			setDetailLoading(true);
			setDetailError(false);
			try {
				const response = await readApiJson<ServerDetail>(await fetch(`/api/admin/mcp-servers/${id}`));
				if (request !== detailRequest.current || selected.current !== id) return;
				if (!response.success || !response.data) throw new Error(response.message || t('loadFailed'));
				setDetail(response.data);
			} catch {
				if (request === detailRequest.current && selected.current === id) setDetailError(true);
			} finally {
				if (request === detailRequest.current) setDetailLoading(false);
			}
		},
		[t]
	);

	useEffect(() => {
		void loadList();
	}, [loadList]);
	useEffect(() => {
		if (selectedId) void loadDetail(selectedId);
	}, [selectedId, loadDetail]);
	useEffect(
		() => () => {
			++detailRequest.current;
			++listRequest.current;
		},
		[]
	);

	function selectServer(id: string | null) {
		selected.current = id;
		++detailRequest.current;
		setSelectedId(id);
		setDetail(null);
		setRevealed(null);
		setTestResult(null);
		setDetailError(false);
		setDetailLoading(id != null);
		setTab('tool');
	}

	function openCreate() {
		setForm({ ...EMPTY_FORM, headers: [{ key: '', value: '' }] });
		setEditingServer(null);
		setFormMode('create');
	}

	function openEdit(server: ServerSummary) {
		setEditingServer(server);
		setRevealed(null);
		setForm({
			slug: server.slug,
			name: server.name,
			description: server.description ?? '',
			url: '',
			headers: server.authHeaderNames.length
				? server.authHeaderNames.map((key) => ({ key, value: '' }))
				: [{ key: '', value: '' }],
			pricing: pricingDraftFromRule(server.pricing),
			timeoutMs: String(server.timeoutMs),
			maxResponseBytes: String(server.maxResponseBytes),
		});
		setFormMode('edit');
	}

	async function perform(key: string, task: () => Promise<boolean | void>, fallback = t('actionFailed')) {
		if (actionLock.current) return false;
		actionLock.current = true;
		setAction(key);
		try {
			return (await task()) !== false;
		} catch (error) {
			notify(
				'error',
				error instanceof TypeError
					? tCommon('networkError')
					: error instanceof Error
					? error.message
					: fallback
			);
			return false;
		} finally {
			actionLock.current = false;
			setAction(null);
		}
	}

	async function mutate(path: string, method: string, body?: unknown) {
		const response = await readApiJson<unknown>(
			await fetch(`/api/admin/mcp-servers${path}`, {
				method,
				...(body === undefined
					? {}
					: { headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }),
			})
		);
		if (!response.success) throw new Error(response.message || t('actionFailed'));
		return response.data;
	}

	async function refresh(id: string) {
		setRevealed(null);
		await loadList();
		if (selected.current === id) await loadDetail(id);
	}

	async function submitForm() {
		return perform(
			'save',
			async () => {
				const pricing = pricingRuleFromDraft(form.pricing);
				if (!pricing.ok) throw new Error(pricingErrorText(pricing.error));
				const authHeaders = Object.fromEntries(
					form.headers.filter((row) => row.key.trim()).map((row) => [row.key.trim(), row.value])
				);
				const body = {
					name: form.name.trim(),
					description: form.description.trim() || null,
					authHeaders,
					pricing: pricing.rule,
					timeoutMs: Number(form.timeoutMs),
					maxResponseBytes: Number(form.maxResponseBytes),
				};
				if (formMode === 'create') {
					const created = (await mutate('', 'POST', {
						...body,
						slug: form.slug.trim(),
						url: form.url.trim(),
					})) as { id: string };
					setFormMode(null);
					await loadList();
					selectServer(created.id);
					notify('success', t('createdHint'));
				} else if (editingServer) {
					await mutate(`/${editingServer.id}`, 'PATCH', {
						...body,
						...(form.url.trim() ? { url: form.url.trim() } : {}),
					});
					setFormMode(null);
					setTestResult(null);
					await refresh(editingServer.id);
					notify('success', t('saved'));
				}
			},
			t('saveFailed')
		);
	}

	async function sync(id = selectedId) {
		if (!id) return;
		return perform(`sync:${id}`, async () => {
			try {
				const result = (await mutate(`/${id}/sync`, 'POST')) as {
					added: unknown[];
					changed: unknown[];
					removed: unknown[];
				};
				notify(
					'success',
					t('synced'),
					t('syncSummary', {
						added: result.added.length,
						changed: result.changed.length,
						removed: result.removed.length,
					})
				);
			} finally {
				// A failed sync is persisted upstream; surface that error in the list and drawer too.
				await refresh(id);
			}
		});
	}

	async function test() {
		if (!selectedId) return;
		const id = selectedId;
		setTestResult(null);
		return perform(`test:${id}`, async () => {
			try {
				const result = (await mutate(`/${id}/test`, 'POST')) as {
					counts: { tools: number; prompts: number; resources: number };
				};
				if (selected.current === id) setTestResult({ ok: true, message: t('testSummary', result.counts) });
				notify('success', t('tested'));
			} catch (error) {
				if (selected.current === id)
					setTestResult({ ok: false, message: error instanceof Error ? error.message : t('actionFailed') });
				throw error;
			}
		});
	}

	async function toggleServer() {
		if (!detail) return;
		const server = detail.server;
		return perform('status', async () => {
			await mutate(`/${server.id}`, 'PATCH', { status: server.status === 'active' ? 'disabled' : 'active' });
			await refresh(server.id);
			notify('success', t('saved'));
		});
	}

	async function setItemStatus(ids: string[], status: 'enabled' | 'disabled') {
		if (!selectedId || !ids.length) return false;
		const id = selectedId;
		if (
			ids.length > 1 &&
			!(await confirm({
				title: t(status === 'enabled' ? 'batchEnableTitle' : 'batchDisableTitle'),
				message: t('batchStatusConfirm', { count: ids.length }),
				confirmLabel: t(status === 'enabled' ? 'enable' : 'disable'),
			}))
		)
			return false;
		return perform('items', async () => {
			await mutate(`/${id}/items/status`, 'POST', { ids, status });
			await refresh(id);
			notify('success', t('saved'));
		});
	}

	async function accept(itemId: string) {
		if (!selectedId) return;
		const id = selectedId;
		return perform(`accept:${itemId}`, async () => {
			await mutate(`/${id}/items/${itemId}/accept`, 'POST');
			await refresh(id);
			notify('success', t('accepted'));
		});
	}

	function pricingErrorText(error: PricingDraftError) {
		return t(`pricing.${error}`);
	}

	/** `null` restores the server default rule. */
	async function savePricing(item: CatalogItem, pricing: Record<string, unknown> | McpPricingRule | null) {
		if (!selectedId) return false;
		const id = selectedId;
		return perform(`price:${item.id}`, async () => {
			await mutate(`/${id}/items/${item.id}`, 'PATCH', { pricing });
			await loadDetail(id);
			notify('success', t('saved'));
		});
	}

	async function reveal() {
		if (!selectedId) return;
		if (revealed) {
			setRevealed(null);
			return;
		}
		const id = selectedId;
		return perform('reveal', async () => {
			const response = await readApiJson<{ url: string; authHeaders: Record<string, string> }>(
				await fetch(`/api/admin/mcp-servers/${id}/reveal`)
			);
			if (!response.success || !response.data) throw new Error(response.message || t('revealFailed'));
			if (selected.current === id) setRevealed(response.data);
		});
	}

	async function removeServer() {
		if (!selectedId || !detail) return;
		const id = selectedId;
		if (
			!(await confirm({
				title: t('confirmDeleteTitle'),
				message: t('confirmDeleteNamed', { name: detail.server.name }),
				danger: true,
				confirmLabel: tCommon('delete'),
			}))
		)
			return;
		return perform('delete', async () => {
			await mutate(`/${id}`, 'DELETE');
			selectServer(null);
			await loadList();
			notify('success', t('deleted'));
		});
	}

	return {
		servers,
		detail,
		selectedId,
		selectServer,
		tab,
		setTab,
		formMode,
		setFormMode,
		form,
		setForm,
		editingServer,
		busy: action != null,
		action,
		listLoading,
		listError,
		detailLoading,
		detailError,
		loadList,
		loadDetail,
		revealed,
		testResult,
		openCreate,
		openEdit,
		submitForm,
		sync,
		test,
		accept,
		toggleServer,
		setItemStatus,
		savePricing,
		reveal,
		removeServer,
	};
}
