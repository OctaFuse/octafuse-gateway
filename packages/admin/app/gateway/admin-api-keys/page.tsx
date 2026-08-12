'use client';

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
import { ADMIN_PERMISSIONS, type AdminPermission } from '@/lib/admin-principal';
import { generateAdminApiKey } from '@/lib/auth';
import { readApiJson } from '@/lib/api-json';

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
		setSecretVisible(true);
	};

	const openEdit = async (key: AccessKey) => {
		setError('');
		setEditorError('');
		setEditor({ kind: 'edit', key });
		setName(key.name);
		setDescription(key.description ?? '');
		setPermissions(key.permissions.length > 0 ? [...key.permissions] : DEFAULT_PERMISSIONS);
		setSecretVisible(false);
		setBusy(true);
		try {
			const cached = revealedSecrets[key.id];
			if (cached) {
				setDraftSecret(cached);
				setOriginalSecret(cached);
				return;
			}
			const response = await fetch(`/api/admin/access-keys/${encodeURIComponent(key.id)}/secret`);
			const data = await readApiJson<{ key: string }>(response);
			if (!response.ok || !data.success || !data.data) {
				throw new Error(data.message || tCommon('requestFailed'));
			}
			setDraftSecret(data.data.key);
			setOriginalSecret(data.data.key);
			setRevealedSecrets((prev) => ({ ...prev, [key.id]: data.data!.key }));
		} catch (cause) {
			setError(cause instanceof Error ? cause.message : tCommon('requestFailed'));
			setEditor(null);
		} finally {
			setBusy(false);
		}
	};

	const closeEditor = () => {
		if (busy) return;
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
		setSecretVisible(true);
	};

	const secretChanged = draftSecret !== originalSecret;

	const saveEditor = async () => {
		if (!editor || !name.trim() || permissions.length === 0 || !draftSecret) return;
		setBusy(true);
		setEditorError('');
		try {
			if (editor.kind === 'create') {
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
		if (revealedSecrets[key.id]) {
			setRevealedSecrets((prev) => {
				const next = { ...prev };
				delete next[key.id];
				return next;
			});
			return;
		}
		try {
			await ensureSecret(key);
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
		await navigator.clipboard.writeText(draftSecret);
		setCopiedId('draft');
		window.setTimeout(() => setCopiedId((current) => (current === 'draft' ? null : current)), 1500);
	};

	return (
		<div className="p-8">
			<div className="mb-6 flex items-start justify-between gap-4">
				<div>
					<h1 className="text-3xl font-bold text-gray-900">{t('title')}</h1>
					<p className="mt-1 max-w-3xl text-sm text-gray-500">{t('subtitle')}</p>
					<p className="mt-2 max-w-3xl text-xs text-gray-500">{t('rotateHint')}</p>
				</div>
				<button
					type="button"
					onClick={openCreate}
					className="inline-flex items-center gap-2 rounded-md bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700"
				>
					<PlusIcon className="h-5 w-5" />
					{t('create')}
				</button>
			</div>

			{error && (
				<div className="mb-4 rounded-md bg-red-50 p-3 text-sm text-red-700" role="alert">
					{error}
				</div>
			)}

			<div className="overflow-x-auto rounded-lg border bg-white shadow-sm">
				<table className="min-w-full divide-y">
					<thead className="bg-gray-50 text-left text-xs uppercase text-gray-500">
						<tr>
							<th className="px-4 py-3">{t('name')}</th>
							<th className="px-4 py-3">{t('key')}</th>
							<th className="px-4 py-3">{t('permissions')}</th>
							<th className="px-4 py-3">{tCommon('status')}</th>
							<th className="px-4 py-3">{t('lastUsed')}</th>
						</tr>
					</thead>
					<tbody className="divide-y text-sm">
						{keys.map((key) => {
							const revealed = revealedSecrets[key.id];
							return (
								<tr
									key={key.id}
									onClick={() => void openEdit(key)}
									className={`cursor-pointer hover:bg-gray-50 ${key.status === 'revoked' ? 'bg-gray-50 text-gray-500' : ''}`}
								>
									<td className="px-4 py-3">
										<div className="font-medium text-gray-900">{key.name}</div>
										<div className="text-xs text-gray-500">{key.description || key.id}</div>
									</td>
									<td className="px-4 py-3">
										<div className="flex items-center gap-2">
											<code className="font-mono text-xs">
												{revealed ?? key.key}
											</code>
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
											{key.permissions.map((permission) => (
												<code key={permission} className="rounded bg-gray-100 px-1.5 py-0.5 text-xs">
													{permission}
												</code>
											))}
										</div>
									</td>
									<td className="px-4 py-3" onClick={(event) => event.stopPropagation()}>
										<button
											type="button"
											disabled={statusBusyId === key.id}
											onClick={(event) => void toggleStatus(key, event)}
											className={`relative inline-flex h-6 w-11 flex-shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors duration-200 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50 ${
												key.status === 'active' ? 'bg-blue-600' : 'bg-gray-200'
											}`}
											role="switch"
											aria-checked={key.status === 'active'}
											aria-label={key.status === 'active' ? t('deactivate') : t('activate')}
											title={key.status === 'active' ? t('deactivate') : t('activate')}
										>
											<span
												className={`pointer-events-none inline-block h-5 w-5 transform rounded-full bg-white shadow ring-0 transition duration-200 ${
													key.status === 'active' ? 'translate-x-5' : 'translate-x-0'
												}`}
											/>
										</button>
									</td>
									<td className="whitespace-nowrap px-4 py-3 text-xs text-gray-500">
										{key.last_used_at ? new Date(key.last_used_at).toLocaleString() : '—'}
									</td>
								</tr>
							);
						})}
					</tbody>
				</table>
				{!loading && keys.length === 0 && (
					<div className="p-8 text-center text-sm text-gray-500">{t('empty')}</div>
				)}
				{loading && (
					<div className="p-8 text-center text-sm text-gray-500">{tCommon('loading')}</div>
				)}
			</div>

			{editor && (
				<div
					className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4"
					onClick={closeEditor}
					role="presentation"
				>
					<div
						className="max-h-[90vh] w-full max-w-3xl overflow-y-auto rounded-lg bg-white shadow-xl"
						onClick={(event) => event.stopPropagation()}
						role="dialog"
						aria-modal="true"
						aria-labelledby="integration-key-editor-title"
					>
						<div className="flex items-center justify-between border-b px-6 py-4">
							<h2 id="integration-key-editor-title" className="text-xl font-bold text-gray-900">
								{editor.kind === 'create' ? t('createTitle') : t('editTitle')}
							</h2>
							<button
								type="button"
								onClick={closeEditor}
								disabled={busy}
								className="text-gray-400 hover:text-gray-600 disabled:opacity-50"
								aria-label={tCommon('close')}
							>
								×
							</button>
						</div>

						<div className="p-6">
							{editorError && (
								<div className="mb-4 rounded-md border border-red-200 bg-red-50 p-3 text-sm text-red-700" role="alert">
									{editorError}
								</div>
							)}

							<div className="grid gap-4 md:grid-cols-2">
								<label className="text-sm font-medium text-gray-700">
									{t('name')}
									<input
										value={name}
										onChange={(event) => setName(event.target.value)}
										className="mt-1 w-full rounded-md border px-3 py-2 font-normal"
									/>
								</label>
								<label className="text-sm font-medium text-gray-700">
									{t('description')}
									<input
										value={description}
										onChange={(event) => setDescription(event.target.value)}
										className="mt-1 w-full rounded-md border px-3 py-2 font-normal"
									/>
								</label>
							</div>

							<div className="mt-4">
								<div className="text-sm font-medium text-gray-700">{t('key')}</div>
								<p className="mt-1 text-xs text-gray-500">{t('secretDraftHint')}</p>
								<div className="mt-2 flex flex-wrap items-center gap-2">
									<code className="min-w-0 flex-1 break-all rounded border bg-gray-50 px-3 py-2 font-mono text-sm">
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
								{secretChanged && editor.kind === 'edit' && (
									<p className="mt-2 text-xs text-amber-700">{t('secretPendingHint')}</p>
								)}
							</div>

							<div className="mt-4 text-sm font-medium text-gray-700">{t('permissions')}</div>
							<div className="mt-2 grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
								{DELEGABLE_PERMISSIONS.map((permission) => (
									<label key={permission} className="flex items-center gap-2 rounded border px-3 py-2 text-sm">
										<input
											type="checkbox"
											checked={permissions.includes(permission)}
											onChange={() => togglePermission(permission)}
										/>
										<code>{permission}</code>
									</label>
								))}
								<label className="flex items-center gap-2 rounded border border-violet-200 bg-violet-50 px-3 py-2 text-sm">
									<input
										type="checkbox"
										checked={permissions.includes('*')}
										onChange={() => togglePermission('*')}
									/>
									<code>*</code>
								</label>
							</div>
						</div>

						<div className="flex justify-end gap-2 border-t px-6 py-4">
							<button
								type="button"
								onClick={closeEditor}
								disabled={busy}
								className="rounded border px-4 py-2 text-sm disabled:opacity-50"
							>
								{tCommon('cancel')}
							</button>
							<button
								type="button"
								disabled={busy || !name.trim() || permissions.length === 0}
								onClick={() => void saveEditor()}
								className="rounded bg-blue-600 px-4 py-2 text-sm text-white disabled:opacity-50"
							>
								{busy
									? editor.kind === 'create'
										? tCommon('creating')
										: tCommon('saving')
									: tCommon('save')}
							</button>
						</div>
					</div>
				</div>
			)}
		</div>
	);
}
