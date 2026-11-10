'use client';

import { AdminPageTitle } from '@/components/admin-page-title';

/**
 * 集成密钥：
 * - 点击行 / 创建：模态框编辑；密钥轮换在表单内预生成，保存后才生效
 * - STATUS 列切换 active/revoked
 * - Key 列右侧：显示密钥 / 复制
 */
import { useCallback, useEffect, useState, type MouseEvent } from 'react';
import { useTranslations } from 'next-intl';
import {
	ArrowPathIcon,
	ClipboardDocumentIcon,
	EyeIcon,
	EyeSlashIcon,
	PlusIcon,
} from '@heroicons/react/24/outline';
import { AdminDialog } from '@/components/admin-dialog';
import { useFeedback } from '@/components/feedback';
import { MagnifyingGlassIcon } from '@heroicons/react/24/outline';
import { ADMIN_PERMISSIONS, type AdminPermission } from '@/lib/admin-principal';
import { generateAdminApiKey } from '@/lib/auth';
import { readApiJson } from '@/lib/api-json';
import { useGatewayDateTime } from '@/lib/use-gateway-datetime';

type AccessKey = {
	id: string;
	name: string;
	description: string | null;
	key: string;
	key_prefix: string;
	permissions: AdminPermission[];
	status: 'active' | 'revoked';
	last_used_at: string | null;
	created_at: string;
	updated_at: string;
	revoked_at: string | null;
};

type EditorMode = { kind: 'create' } | { kind: 'edit'; key: AccessKey };

const DELEGABLE_PERMISSIONS = ADMIN_PERMISSIONS.filter((permission) => permission !== '*');
const DEFAULT_PERMISSIONS: AdminPermission[] = ['routes.read', 'routes.write', 'analytics.read'];

export default function AdminApiKeysPage() {
	const t = useTranslations('adminApiKeys');
	const tCommon = useTranslations('common');
	const ui = useTranslations('remainingUi');
	const { confirm } = useFeedback();
	const [query, setQuery] = useState('');
	const [filter, setFilter] = useState('all');
	const [initialDraft, setInitialDraft] = useState('');
	const { formatDateTime } = useGatewayDateTime();
	const [keys, setKeys] = useState<AccessKey[]>([]);
	const [loading, setLoading] = useState(true);
	const [busy, setBusy] = useState(false);
	const [statusBusyId, setStatusBusyId] = useState<string | null>(null);
	const [error, setError] = useState('');
	const [editorError, setEditorError] = useState('');
	const [editor, setEditor] = useState<EditorMode | null>(null);
	const [name, setName] = useState('');
	const [description, setDescription] = useState('');
	const [permissions, setPermissions] = useState<AdminPermission[]>(DEFAULT_PERMISSIONS);
	const [draftSecret, setDraftSecret] = useState('');
	const [originalSecret, setOriginalSecret] = useState('');
	const [secretVisible, setSecretVisible] = useState(false);
	const [copiedId, setCopiedId] = useState<string | null>(null);
	const [revealedSecrets, setRevealedSecrets] = useState<Record<string, string>>({});
	const [visibleKeyIds, setVisibleKeyIds] = useState<Set<string>>(new Set());

	const load = useCallback(async () => {
		setLoading(true);
		try {
			const response = await fetch('/api/admin/access-keys');
			const data = await readApiJson<AccessKey[]>(response);
			if (!response.ok || !data.success || !Array.isArray(data.data)) {
				throw new Error(data.message || tCommon('requestFailed'));
			}
			setKeys(data.data);
			setError('');
		} catch (cause) {
			setError(cause instanceof Error ? cause.message : tCommon('requestFailed'));
		} finally {
			setLoading(false);
		}
	}, [tCommon]);

	useEffect(() => {
		void load();
	}, [load]);

	const openCreate = () => {
		setError('');
		setEditorError('');
		setEditor({ kind: 'create' });
		setName('');
		setDescription('');
		setPermissions(DEFAULT_PERMISSIONS);
		const secret = generateAdminApiKey();
		setDraftSecret(secret);
		setOriginalSecret(secret);
		setInitialDraft(JSON.stringify({ name: '', description: '', permissions: DEFAULT_PERMISSIONS, secret }));
		setSecretVisible(false);
	};

	const openEdit = async (key: AccessKey) => {
		setError('');
		setEditorError('');
		setEditor({ kind: 'edit', key });
		setName(key.name);
		setDescription(key.description ?? '');
		setPermissions(key.permissions.length > 0 ? [...key.permissions] : DEFAULT_PERMISSIONS);
		setSecretVisible(false);
		setDraftSecret('');
		setOriginalSecret('');
		setBusy(true);
		try {
			const cached = revealedSecrets[key.id];
			if (cached) {
				setDraftSecret(cached);
				setOriginalSecret(cached);
				setInitialDraft(
					JSON.stringify({
						name: key.name,
						description: key.description ?? '',
						permissions: key.permissions.length ? [...key.permissions] : DEFAULT_PERMISSIONS,
						secret: cached,
					})
				);
				return;
			}
			const response = await fetch(`/api/admin/access-keys/${encodeURIComponent(key.id)}/secret`);
			const data = await readApiJson<{ key: string }>(response);
			if (!response.ok || !data.success || !data.data) {
				throw new Error(data.message || tCommon('requestFailed'));
			}
			setDraftSecret(data.data.key);
			setOriginalSecret(data.data.key);
			setInitialDraft(
				JSON.stringify({
					name: key.name,
					description: key.description ?? '',
					permissions: key.permissions.length ? [...key.permissions] : DEFAULT_PERMISSIONS,
					secret: data.data.key,
				})
			);
			setRevealedSecrets((prev) => ({ ...prev, [key.id]: data.data!.key }));
		} catch (cause) {
			setError(cause instanceof Error ? cause.message : tCommon('requestFailed'));
			setEditor(null);
		} finally {
			setBusy(false);
		}
	};

	const closeEditor = async () => {
		if (busy) return;
		const draft = JSON.stringify({ name, description, permissions, secret: draftSecret });
		if (
			draft !== initialDraft &&
			!(await confirm({
				title: ui('discardTitle'),
				message: ui('discardHint'),
				confirmLabel: ui('discard'),
				cancelLabel: tCommon('cancel'),
			}))
		)
			return;
		setEditor(null);
		setEditorError('');
	};

	const togglePermission = (permission: AdminPermission) => {
		setPermissions((current) => {
			if (permission === '*') return current.includes('*') ? [] : ['*'];
			const withoutAll = current.filter((item) => item !== '*');
			return withoutAll.includes(permission)
				? withoutAll.filter((item) => item !== permission)
				: [...withoutAll, permission];
		});
	};

	const regenerateDraftSecret = () => {
		setDraftSecret(generateAdminApiKey());
		setSecretVisible(false);
	};

	const secretChanged = draftSecret !== originalSecret;

	const saveEditor = async () => {
		if (!editor || !name.trim() || permissions.length === 0 || !draftSecret) return;
		setBusy(true);
		setEditorError('');
		try {
			if (editor?.kind === 'create') {
				const response = await fetch('/api/admin/access-keys', {
					method: 'POST',
					headers: { 'Content-Type': 'application/json' },
					body: JSON.stringify({
						name: name.trim(),
						description: description.trim() || null,
						permissions,
						secret_key: draftSecret,
					}),
				});
				const data = await readApiJson<AccessKey>(response);
				if (!response.ok || !data.success || !data.data) {
					throw new Error(data.message || tCommon('createFailed'));
				}
				setRevealedSecrets((prev) => ({ ...prev, [data.data!.id]: draftSecret }));
			} else {
				const body: Record<string, unknown> = {
					name: name.trim(),
					description: description.trim() || null,
					permissions,
				};
				if (secretChanged) body.secret_key = draftSecret;
				const response = await fetch(`/api/admin/access-keys/${encodeURIComponent(editor.key.id)}`, {
					method: 'PATCH',
					headers: { 'Content-Type': 'application/json' },
					body: JSON.stringify(body),
				});
				const data = await readApiJson(response);
				if (!response.ok || !data.success) {
					throw new Error(data.message || tCommon('updateFailed'));
				}
				if (secretChanged) {
					setRevealedSecrets((prev) => ({ ...prev, [editor.key.id]: draftSecret }));
				}
			}
			setEditor(null);
			setEditorError('');
			await load();
		} catch (cause) {
			setEditorError(cause instanceof Error ? cause.message : tCommon('saveFailed'));
		} finally {
			setBusy(false);
		}
	};

	const toggleStatus = async (key: AccessKey, event: MouseEvent) => {
		event.stopPropagation();
		const nextStatus = key.status === 'active' ? 'revoked' : 'active';
		setStatusBusyId(key.id);
		setError('');
		try {
			const response = await fetch(`/api/admin/access-keys/${encodeURIComponent(key.id)}`, {
				method: 'PATCH',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ status: nextStatus }),
			});
			const data = await readApiJson(response);
			if (!response.ok || !data.success) {
				throw new Error(data.message || tCommon('updateFailed'));
			}
			await load();
		} catch (cause) {
			setError(cause instanceof Error ? cause.message : tCommon('updateFailed'));
		} finally {
			setStatusBusyId(null);
		}
	};

	const ensureSecret = async (key: AccessKey): Promise<string | null> => {
		const cached = revealedSecrets[key.id];
		if (cached) return cached;
		const response = await fetch(`/api/admin/access-keys/${encodeURIComponent(key.id)}/secret`);
		const data = await readApiJson<{ key: string }>(response);
		if (!response.ok || !data.success || !data.data) {
			throw new Error(data.message || tCommon('requestFailed'));
		}
		setRevealedSecrets((prev) => ({ ...prev, [key.id]: data.data!.key }));
		return data.data.key;
	};

	const revealInRow = async (key: AccessKey, event: MouseEvent) => {
		event.stopPropagation();
		setError('');
		if (visibleKeyIds.has(key.id)) {
			setVisibleKeyIds((prev) => {
				const next = new Set(prev);
				next.delete(key.id);
				return next;
			});
			return;
		}
		try {
			await ensureSecret(key);
			setVisibleKeyIds((prev) => new Set(prev).add(key.id));
		} catch (cause) {
			setError(cause instanceof Error ? cause.message : tCommon('requestFailed'));
		}
	};

	const copyKeySecret = async (key: AccessKey, event: MouseEvent) => {
		event.stopPropagation();
		setError('');
		try {
			const secret = await ensureSecret(key);
			if (!secret) return;
			await navigator.clipboard.writeText(secret);
			setCopiedId(key.id);
			window.setTimeout(() => setCopiedId((current) => (current === key.id ? null : current)), 1500);
		} catch (cause) {
			setError(cause instanceof Error ? cause.message : tCommon('requestFailed'));
		}
	};

	const copyDraftSecret = async () => {
		if (!draftSecret) return;
		try {
			await navigator.clipboard.writeText(draftSecret);
		} catch {
			setEditorError(tCommon('requestFailed'));
			return;
		}
		setCopiedId('draft');
		window.setTimeout(() => setCopiedId((current) => (current === 'draft' ? null : current)), 1500);
	};

	const visibleKeys = keys.filter(
		(key) =>
			(filter === 'all' || key.status === filter) &&
			[key.name, key.description].some((text) => text?.toLowerCase().includes(query.trim().toLowerCase()))
	);
	return (
		<div className="admin-content-workspace content-tone-inference min-w-0 p-4 sm:p-6 lg:p-8">
			<div className="mb-6 flex flex-wrap items-start justify-between gap-4">
				<div>
					<AdminPageTitle>{t('title')}</AdminPageTitle>
					<p className="mt-1 max-w-3xl text-sm text-gray-500">{t('subtitle')}</p>
					<p className="mt-2 max-w-3xl text-xs text-gray-500">{ui('integrationHint')}</p>
				</div>
				<button
					type="button"
					onClick={openCreate}
					className="inline-flex items-center gap-2 rounded-lg admin-primary px-4 py-2 text-sm font-medium text-white hover:bg-gray-800"
				>
					<PlusIcon className="h-4 w-4" />
					{t('create')}
				</button>
			</div>

			{error && (
				<div className="mb-4 rounded-lg bg-red-50 p-3 text-sm text-red-700" role="alert">
					{error}
				</div>
			)}

			<div className="mb-4 flex flex-wrap items-center gap-2">
				<div className="relative w-full sm:max-w-sm">
					<MagnifyingGlassIcon
						className="pointer-events-none absolute left-3 top-3 h-4 w-4 text-gray-400"
						aria-hidden="true"
					/>
					<input
						type="search"
						aria-label={ui('searchKeys')}
						placeholder={ui('searchKeys')}
						value={query}
						onChange={(e) => setQuery(e.target.value)}
						className="h-10 w-full rounded-lg border border-gray-200 bg-white pl-9 pr-3 text-sm"
					/>
				</div>
				<select
					aria-label={tCommon('status')}
					value={filter}
					onChange={(e) => setFilter(e.target.value)}
					className="h-10 rounded-lg border border-gray-200 bg-white px-3 text-sm"
				>
					<option value="all">{ui('allStatuses')}</option>
					<option value="active">{t('status.active')}</option>
					<option value="revoked">{t('status.revoked')}</option>
				</select>
			</div>
			<div className="admin-content-panel overflow-x-auto rounded-xl border border-gray-200 bg-white">
				<table className="admin-data-table min-w-full divide-y">
					<thead className="bg-gray-50 text-left text-xs normal-case text-gray-500">
						<tr>
							<th className="px-4 py-3">{t('name')}</th>
							<th className="px-4 py-3">{t('key')}</th>
							<th className="px-4 py-3">{t('permissions')}</th>
							<th className="px-4 py-3">{tCommon('status')}</th>
							<th className="px-4 py-3">{t('lastUsed')}</th>
						</tr>
					</thead>
					<tbody className="divide-y text-sm">
						{visibleKeys.map((key) => {
							const revealed = visibleKeyIds.has(key.id) ? revealedSecrets[key.id] : undefined;
							return (
								<tr
									key={key.id}
									onClick={() => void openEdit(key)}
									className={`cursor-pointer hover:bg-gray-50 ${
										key.status === 'revoked' ? 'bg-gray-50 text-gray-500' : ''
									}`}
								>
									<td className="px-4 py-3">
										<button
											type="button"
											aria-haspopup="dialog"
											onClick={(event) => {
												event.stopPropagation();
												void openEdit(key);
											}}
											className="rounded text-left font-medium text-gray-900 focus-visible:ring-2 focus-visible:ring-gray-500"
										>
											{key.name}
										</button>
										{key.description ? <p className="mt-1 text-xs text-gray-500">{key.description}</p> : null}
									</td>
									<td className="px-4 py-3">
										<div className="flex items-center gap-2">
											<code className="font-mono text-xs">{revealed ?? key.key}</code>
											<button
												type="button"
												onClick={(event) => void revealInRow(key, event)}
												className="rounded p-1 text-gray-500 hover:bg-gray-100 hover:text-gray-800"
												title={revealed ? t('hideSecret') : t('reveal')}
											>
												{revealed ? <EyeSlashIcon className="h-4 w-4" /> : <EyeIcon className="h-4 w-4" />}
											</button>
											<button
												type="button"
												onClick={(event) => void copyKeySecret(key, event)}
												className="rounded p-1 text-gray-500 hover:bg-gray-100 hover:text-gray-800"
												title={tCommon('copy')}
											>
												<ClipboardDocumentIcon className="h-4 w-4" />
											</button>
											{copiedId === key.id && (
												<span className="text-xs text-emerald-600">{tCommon('copied')}</span>
											)}
										</div>
									</td>
									<td className="max-w-sm px-4 py-3">
										<div className="flex flex-wrap gap-1">
											{key.permissions.slice(0, 3).map((permission) => (
												<code key={permission} className="rounded bg-gray-100 px-1.5 py-0.5 text-xs">
													{permission}
												</code>
											))}
											{key.permissions.length > 3 ? (
												<span title={key.permissions.join(', ')} className="text-xs text-gray-500">
													+{key.permissions.length - 3}
												</span>
											) : null}
										</div>
									</td>
									<td className="px-4 py-3" onClick={(event) => event.stopPropagation()}>
										<button
											type="button"
											disabled={statusBusyId === key.id}
											onClick={(event) => void toggleStatus(key, event)}
											className={`relative inline-flex h-6 w-11 flex-shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors duration-200 focus:outline-none focus:ring-2 focus:ring-gray-500 focus:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50 ${
												key.status === 'active' ? 'bg-gray-950' : 'bg-gray-200'
											}`}
											role="switch"
											aria-checked={key.status === 'active'}
											aria-label={key.status === 'active' ? t('deactivate') : t('activate')}
											title={key.status === 'active' ? t('deactivate') : t('activate')}
										>
											<span
												className={`pointer-events-none inline-block h-4 w-4 transform rounded-full bg-white shadow ring-0 transition duration-200 ${
													key.status === 'active' ? 'translate-x-5' : 'translate-x-0'
												}`}
											/>
										</button>
									</td>
									<td className="whitespace-nowrap px-4 py-3 text-xs text-gray-500">
										{formatDateTime(key.last_used_at)}
									</td>
								</tr>
							);
						})}
					</tbody>
				</table>
				{!loading && visibleKeys.length === 0 && (
					<div className="p-8 text-center text-sm text-gray-500">{t('empty')}</div>
				)}
				{loading && <div className="p-8 text-center text-sm text-gray-500">{tCommon('loading')}</div>}
			</div>

			<AdminDialog
				open={editor !== null}
				title={editor?.kind === 'create' ? t('createTitle') : t('editTitle')}
				hint={t('rotateHint')}
				busy={busy}
				onClose={() => void closeEditor()}
				footer={
					<div className="flex justify-end gap-2 ">
						<button
							type="button"
							onClick={() => void closeEditor()}
							disabled={busy}
							className="rounded border px-4 py-2 text-sm disabled:opacity-50"
						>
							{tCommon('cancel')}
						</button>
						<button
							type="button"
							disabled={busy || !name.trim() || permissions.length === 0}
							onClick={() => void saveEditor()}
							className="rounded admin-primary px-4 py-2 text-sm text-white disabled:opacity-50"
						>
							{busy ? (editor?.kind === 'create' ? tCommon('creating') : tCommon('saving')) : tCommon('save')}
						</button>
					</div>
				}
			>
				{editor ? (
					<>
						<fieldset disabled={busy} className="min-w-0">
							{editorError && (
								<div
									className="mb-4 rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-700"
									role="alert"
								>
									{editorError}
								</div>
							)}

							<div className="grid gap-4 md:grid-cols-2">
								<label className="text-sm font-medium text-gray-700">
									{t('name')}
									<input
										value={name}
										onChange={(event) => setName(event.target.value)}
										className="mt-1 w-full rounded-lg border px-3 py-2 font-normal"
									/>
								</label>
								<label className="text-sm font-medium text-gray-700">
									{t('description')}
									<input
										value={description}
										onChange={(event) => setDescription(event.target.value)}
										className="mt-1 w-full rounded-lg border px-3 py-2 font-normal"
									/>
								</label>
							</div>

							<div className="mt-4">
								<div className="text-sm font-medium text-gray-700">{t('key')}</div>
								<p className="mt-1 text-xs text-gray-500">{t('secretDraftHint')}</p>
								<div className="mt-2 flex flex-wrap items-center gap-2">
									<code className="min-w-0 flex-1 basis-full break-all rounded-lg border border-gray-200 bg-gray-50 px-3 py-2 font-mono text-sm sm:basis-auto">
										{secretVisible ? draftSecret : `${draftSecret.slice(0, 12)}••••••••`}
									</code>
									<button
										type="button"
										onClick={() => setSecretVisible((value) => !value)}
										className="inline-flex items-center gap-1 rounded border px-3 py-2 text-sm"
										title={secretVisible ? tCommon('hide') : tCommon('show')}
									>
										{secretVisible ? <EyeSlashIcon className="h-4 w-4" /> : <EyeIcon className="h-4 w-4" />}
									</button>
									<button
										type="button"
										onClick={() => void copyDraftSecret()}
										className="inline-flex items-center gap-1 rounded border px-3 py-2 text-sm"
										title={tCommon('copy')}
									>
										<ClipboardDocumentIcon className="h-4 w-4" />
										{copiedId === 'draft' ? tCommon('copied') : null}
									</button>
									<button
										type="button"
										onClick={regenerateDraftSecret}
										className="inline-flex items-center gap-1 rounded border border-amber-300 bg-amber-50 px-3 py-2 text-sm text-amber-900"
									>
										<ArrowPathIcon className="h-4 w-4" />
										{t('regenerate')}
									</button>
								</div>
								{secretChanged && editor?.kind === 'edit' && (
									<p className="mt-2 text-xs text-amber-700">{t('secretPendingHint')}</p>
								)}
							</div>

							<div className="mt-5 text-sm font-medium text-gray-700">{t('permissions')}</div>
							<p className="mt-1 text-xs leading-5 text-gray-500">{ui('writeIncludesRead')}</p>
							<div className="mt-3 grid gap-3 sm:grid-cols-2">
								{[...new Set(DELEGABLE_PERMISSIONS.map((p) => p.split('.')[0]))].map((resource) => (
									<fieldset key={resource} className="min-w-0 rounded-lg border border-gray-200 p-3">
										<legend className="px-1 text-xs font-medium text-gray-700">
											{ui(`resources.${resource}`)}
										</legend>
										<div className="flex flex-wrap gap-3">
											{DELEGABLE_PERMISSIONS.filter((p) => p.split('.')[0] === resource).map((permission) => (
												<label
													key={permission}
													title={permission}
													className="inline-flex items-center gap-2 text-xs text-gray-600"
												>
													<input
														type="checkbox"
														aria-label={permission}
														checked={permissions.includes(permission)}
														onChange={() => togglePermission(permission)}
														className="h-4 w-4 accent-gray-950"
													/>
													{ui(
														permission.endsWith('.secrets.read')
															? 'secrets'
															: permission.endsWith('.write')
															? 'write'
															: permission.endsWith('.execute')
															? 'execute'
															: 'read'
													)}
												</label>
											))}
										</div>
									</fieldset>
								))}
							</div>
							<label className="mt-4 flex items-center gap-2 rounded-lg bg-amber-50 px-3 py-2 text-xs text-amber-800">
								<input
									type="checkbox"
									aria-label="*"
									checked={permissions.includes('*')}
									onChange={() => togglePermission('*')}
									className="h-4 w-4 accent-gray-950"
								/>
								{ui('allPermissions')}
							</label>
						</fieldset>
					</>
				) : null}
			</AdminDialog>
		</div>
	);
}
