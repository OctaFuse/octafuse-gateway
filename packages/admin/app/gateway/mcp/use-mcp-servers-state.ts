'use client';

import { useCallback, useEffect, useState } from 'react';
import { useTranslations } from 'next-intl';
import { useFeedback } from '@/components/feedback';
import { readApiJson } from '@/lib/api-json';
import { EMPTY_FORM, type CatalogItem, type ServerDetail, type ServerForm, type ServerSummary } from './mcp-types';

function headersObject(form: ServerForm): Record<string, string> {
	const headers: Record<string, string> = {};
	for (const row of form.headers) {
		const key = row.key.trim();
		if (!key) continue;
		headers[key] = row.value;
	}
	return headers;
}

export function useMcpServersState() {
	const t = useTranslations('mcp');
	const tCommon = useTranslations('common');
	const { notify, confirm } = useFeedback();
	const [servers, setServers] = useState<ServerSummary[]>([]);
	const [selectedId, setSelectedId] = useState<string | null>(null);
	const [detail, setDetail] = useState<ServerDetail | null>(null);
	const [tab, setTab] = useState<CatalogItem['kind']>('tool');
	const [formMode, setFormMode] = useState<'create' | 'edit' | null>(null);
	const [form, setForm] = useState<ServerForm>(EMPTY_FORM);
	const [busy, setBusy] = useState(false);
	const [revealed, setRevealed] = useState<{ url: string; authHeaders: Record<string, string> } | null>(null);

	const fail = useCallback((message: string | undefined, fallback: string) => {
		notify('error', message || fallback);
	}, [notify]);

	const loadList = useCallback(async () => {
		const response = await readApiJson<ServerSummary[]>(await fetch('/api/admin/mcp-servers'));
		if (!response.success || !response.data) {
			fail(response.message, t('loadFailed'));
			return;
		}
		setServers(response.data);
	}, [fail, t]);

	const loadDetail = useCallback(async (id: string) => {
		const response = await readApiJson<ServerDetail>(await fetch(`/api/admin/mcp-servers/${id}`));
		if (!response.success || !response.data) {
			fail(response.message, t('loadFailed'));
			return null;
		}
		setDetail(response.data);
		setRevealed(null);
		return response.data;
	}, [fail, t]);

	useEffect(() => {
		void loadList();
	}, [loadList]);

	useEffect(() => {
		if (selectedId) void loadDetail(selectedId);
		else setDetail(null);
	}, [selectedId, loadDetail]);

	function openCreate() {
		setForm(EMPTY_FORM);
		setFormMode('create');
	}

	async function openEdit(server: ServerSummary) {
		const loaded = detail?.server.id === server.id ? detail : await loadDetail(server.id);
		if (!loaded) return;
		setForm({
			slug: loaded.server.slug,
			name: loaded.server.name,
			description: loaded.server.description ?? '',
			url: '',
			headers: loaded.server.authHeaderNames.length
				? loaded.server.authHeaderNames.map((key) => ({ key, value: '' }))
				: [{ key: '', value: '' }],
			metered: String(loaded.server.metered),
			standard: String(loaded.server.standard),
			charged: String(loaded.server.charged),
			timeoutMs: String(loaded.server.timeoutMs),
			maxResponseBytes: String(loaded.server.maxResponseBytes),
		});
		setFormMode('edit');
	}

	async function submitForm() {
		setBusy(true);
		try {
			const prices = {
				metered: Number(form.metered),
				standard: Number(form.standard),
				charged: Number(form.charged),
			};
			const shared = {
				name: form.name,
				description: form.description || null,
				authHeaders: headersObject(form),
				...prices,
				timeoutMs: Number(form.timeoutMs),
				maxResponseBytes: Number(form.maxResponseBytes),
			};
			if (formMode === 'create') {
				const response = await readApiJson<{ id: string }>(await fetch('/api/admin/mcp-servers', {
					method: 'POST',
					headers: { 'Content-Type': 'application/json' },
					body: JSON.stringify({ ...shared, slug: form.slug, url: form.url }),
				}));
				if (!response.success || !response.data) {
					fail(response.message, t('saveFailed'));
					return;
				}
				setFormMode(null);
				await loadList();
				setSelectedId(response.data.id);
				notify('success', t('saved'));
				return;
			}
			if (!selectedId) return;
			const body: Record<string, unknown> = { ...shared };
			if (form.url.trim()) body.url = form.url.trim();
			const response = await readApiJson<unknown>(await fetch(`/api/admin/mcp-servers/${selectedId}`, {
				method: 'PATCH',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify(body),
			}));
			if (!response.success) {
				fail(response.message, t('saveFailed'));
				return;
			}
			setFormMode(null);
			await loadList();
			await loadDetail(selectedId);
			notify('success', t('saved'));
		} catch {
			fail(undefined, t('invalidHeaders'));
		} finally {
			setBusy(false);
		}
	}

	async function runAction(path: string, success: string, id = selectedId) {
		if (!id) return;
		setBusy(true);
		try {
			const response = await readApiJson<unknown>(await fetch(`/api/admin/mcp-servers/${id}${path}`, { method: 'POST' }));
			if (!response.success) {
				fail(response.message, t('actionFailed'));
				return;
			}
			await loadList();
			await loadDetail(id);
			notify('success', success);
		} finally {
			setBusy(false);
		}
	}

	async function toggleServer() {
		if (!detail) return;
		setBusy(true);
		try {
			const response = await readApiJson<unknown>(await fetch(`/api/admin/mcp-servers/${detail.server.id}`, {
				method: 'PATCH',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ status: detail.server.status === 'active' ? 'disabled' : 'active' }),
			}));
			if (!response.success) {
				fail(response.message, t('actionFailed'));
				return;
			}
			await loadList();
			await loadDetail(detail.server.id);
		} finally {
			setBusy(false);
		}
	}

	async function setItemStatus(ids: string[], status: 'enabled' | 'disabled') {
		if (!selectedId || ids.length === 0) return;
		setBusy(true);
		try {
			const response = await readApiJson<unknown>(await fetch(`/api/admin/mcp-servers/${selectedId}/items/status`, {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ ids, status }),
			}));
			if (!response.success) fail(response.message, t('actionFailed'));
			await loadDetail(selectedId);
			await loadList();
		} finally {
			setBusy(false);
		}
	}

	function patchItem(id: string, patch: Partial<CatalogItem>) {
		setDetail((current) => current ? { ...current, items: current.items.map((item) => item.id === id ? { ...item, ...patch } : item) } : current);
	}

	async function savePrice(item: CatalogItem, clear: boolean) {
		if (!selectedId) return;
		setBusy(true);
		try {
			const response = await readApiJson<unknown>(await fetch(`/api/admin/mcp-servers/${selectedId}/items/${item.id}`, {
				method: 'PATCH',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify(clear
					? { metered: null, standard: null, charged: null }
					: { metered: item.metered ?? 0, standard: item.standard ?? 0, charged: item.charged ?? 0 }),
			}));
			if (!response.success) fail(response.message, t('actionFailed'));
			else notify('success', t('saved'));
			await loadDetail(selectedId);
		} finally {
			setBusy(false);
		}
	}

	async function reveal() {
		if (!selectedId) return;
		if (revealed) {
			setRevealed(null);
			return;
		}
		const response = await readApiJson<{ url: string; authHeaders: Record<string, string> }>(
			await fetch(`/api/admin/mcp-servers/${selectedId}/reveal`),
		);
		if (!response.success || !response.data) {
			fail(response.message, t('revealFailed'));
			return;
		}
		setRevealed(response.data);
	}

	async function removeServer() {
		if (!selectedId) return;
		const ok = await confirm({ title: t('confirmDeleteTitle'), message: t('confirmDelete'), danger: true, confirmLabel: tCommon('delete') });
		if (!ok) return;
		setBusy(true);
		try {
			const response = await readApiJson<unknown>(await fetch(`/api/admin/mcp-servers/${selectedId}`, { method: 'DELETE' }));
			if (!response.success) {
				fail(response.message, t('actionFailed'));
				return;
			}
			setSelectedId(null);
			setDetail(null);
			await loadList();
			notify('success', t('deleted'));
		} finally {
			setBusy(false);
		}
	}

	return {
		servers,
		detail,
		selectedId,
		setSelectedId,
		tab,
		setTab,
		formMode,
		setFormMode,
		form,
		setForm,
		busy,
		revealed,
		openCreate,
		openEdit,
		submitForm,
		sync: (id?: string) => runAction('/sync', t('synced'), id),
		test: () => runAction('/test', t('tested')),
		accept: (itemId: string) => runAction(`/items/${itemId}/accept`, t('accepted')),
		toggleServer,
		setItemStatus,
		patchItem,
		savePrice,
		reveal,
		removeServer,
	};
}
