'use client';

import { useCallback, useEffect, useState } from 'react';
import { useTranslations } from 'next-intl';
import { ConfigCardShell } from '@/components/ConfigCardShell';
import { readApiJson } from '@/lib/api-json';
import type { SystemConfigRow } from '@/lib/types';
import {
	MCP_OAUTH_AUTHORIZATION_SERVER_KEY,
	MCP_OAUTH_PROTECTED_RESOURCE_PATH,
	normalizeMcpOAuthAuthorizationServer,
} from '@octafuse/core/lib/mcp-oauth-system-config';

/**
 * `system_config.MCP_OAUTH_AUTHORIZATION_SERVER`：所有 `/mcp*` 入口共用的 OAuth 授权服务器（如门户）。
 * 全局设置，不属于某个 MCP 服务；留空即关闭 OAuth 发现。
 */
export function McpOAuthSettings({ onOpenGuide }: { onOpenGuide: () => void }) {
	const t = useTranslations('mcp.oauth');
	const tUx = useTranslations('config.ux');
	const tCommon = useTranslations('common');
	const [saved, setSaved] = useState('');
	const [draft, setDraft] = useState('');
	// 开关只是本地草稿：关闭 = 保存空值；只有点保存才写入 system_config。
	const [enabled, setEnabled] = useState(false);
	const [loading, setLoading] = useState(true);
	const [saving, setSaving] = useState(false);
	const [error, setError] = useState('');
	const [notice, setNotice] = useState('');

	const load = useCallback(async () => {
		setLoading(true);
		setError('');
		try {
			const response = await fetch('/api/admin/config');
			const data = await readApiJson<SystemConfigRow[]>(response);
			if (data.success && Array.isArray(data.data)) {
				const value =
					data.data.find((row) => row.key === MCP_OAUTH_AUTHORIZATION_SERVER_KEY)?.value?.trim() ?? '';
				setSaved(value);
				setDraft(value);
				setEnabled(value !== '');
			} else {
				setError(data.message || tCommon('requestFailed'));
			}
		} catch {
			setError(tCommon('requestFailed'));
		} finally {
			setLoading(false);
		}
	}, [tCommon]);

	useEffect(() => {
		void load();
	}, [load]);

	const missing = enabled && draft.trim() === '';
	const dirty = (enabled ? draft.trim() : '') !== saved;

	useEffect(() => {
		if (!dirty) return;
		const handleBeforeUnload = (event: BeforeUnloadEvent) => {
			event.preventDefault();
			event.returnValue = '';
		};
		window.addEventListener('beforeunload', handleBeforeUnload);
		return () => window.removeEventListener('beforeunload', handleBeforeUnload);
	}, [dirty]);

	const save = async () => {
		if (missing) {
			setNotice('');
			setError(t('required'));
			return;
		}
		const normalized = enabled ? normalizeMcpOAuthAuthorizationServer(draft) : '';
		if (normalized === null) {
			setNotice('');
			setError(t('invalid'));
			return;
		}
		setSaving(true);
		setError('');
		setNotice('');
		try {
			const response = await fetch('/api/admin/config', {
				method: 'PUT',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ key: MCP_OAUTH_AUTHORIZATION_SERVER_KEY, value: normalized }),
			});
			const data = await readApiJson(response);
			if (data.success) {
				setSaved(normalized);
				setDraft(normalized);
				setEnabled(normalized !== '');
				setNotice(data.message || tCommon('configUpdated'));
			} else {
				setError(data.message || tCommon('saveFailed'));
			}
		} catch {
			setError(tCommon('requestFailed'));
		} finally {
			setSaving(false);
		}
	};

	const toggleEnabled = () => {
		setError('');
		setNotice('');
		// 重新打开时回填已保存的地址，避免用户以为配置丢了。
		if (!enabled && draft === '') setDraft(saved);
		setEnabled(!enabled);
	};

	return (
		<div className="mb-6">
			<ConfigCardShell
				id="mcp-oauth"
				title={t('title')}
				description={t('hint')}
				hint={<p>{t('description')}</p>}
				footer={
					dirty || error ? (
						<div className="flex flex-wrap items-center justify-between gap-3">
							<span className={`text-xs ${error ? 'text-red-600' : 'text-amber-700'}`} role="status">
								{error || tUx('unsaved')}
							</span>
							<div className="flex items-center gap-2">
								<button
									type="button"
									disabled={saving}
									onClick={() => {
										setDraft(saved);
										setEnabled(saved !== '');
										setError('');
									}}
									className="rounded-md border border-gray-300 px-3 py-2 text-sm text-gray-700 hover:bg-gray-50 disabled:opacity-50"
								>
									{tUx('discard')}
								</button>
								<button
									type="button"
									disabled={saving || loading || !dirty || missing}
									onClick={() => void save()}
									aria-label={t('save')}
									className="rounded-md bg-gray-900 px-4 py-2 text-sm font-medium text-white hover:bg-gray-800 disabled:cursor-not-allowed disabled:opacity-40"
								>
									{saving ? tCommon('saving') : tCommon('save')}
								</button>
							</div>
						</div>
					) : undefined
				}
			>
				<button
					type="button"
					role="switch"
					aria-label={t('enable')}
					aria-checked={enabled}
					disabled={saving || loading}
					onClick={toggleEnabled}
					className="inline-flex items-center gap-2.5 self-start rounded-lg py-1 text-sm text-gray-700 disabled:opacity-50"
				>
					<span className={`relative h-5 w-9 rounded-full ${enabled ? 'bg-gray-900' : 'bg-gray-300'}`}>
						<span
							className={`absolute left-0.5 top-0.5 h-4 w-4 rounded-full bg-white transition-transform ${
								enabled ? 'translate-x-4' : ''
							}`}
						/>
					</span>
					{t('enable')}
				</button>
				{notice && !dirty && !error ? (
					<p role="status" className="mt-2 text-xs text-gray-400">
						{notice}
					</p>
				) : null}
				{enabled ? (
					<div className="mt-4">
						<label htmlFor="mcp-oauth-input" className="mb-1 block text-sm font-medium text-gray-700">
							{t('label')}
						</label>
						<input
							id="mcp-oauth-input"
							type="url"
							disabled={saving || loading}
							value={draft}
							onChange={(e) => setDraft(e.target.value)}
							placeholder={t('placeholder')}
							spellCheck={false}
							autoComplete="off"
							className="w-full rounded-md border border-gray-300 px-3 py-2 font-mono text-sm shadow-sm"
						/>
						{saved ? (
							<p
								role="status"
								className="mt-3 rounded-md border border-emerald-200 bg-emerald-50 px-3 py-2 text-xs leading-5 text-emerald-800"
							>
								{t('statusOn', { path: `${MCP_OAUTH_PROTECTED_RESOURCE_PATH}/mcp` })}
							</p>
						) : null}
						<div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-2 text-sm">
							<button
								type="button"
								onClick={onOpenGuide}
								className="font-medium text-blue-600 hover:text-blue-700 hover:underline"
							>
								{t('openGuide')}
							</button>
							{saved ? (
								<a
									href={`${saved}/.well-known/oauth-authorization-server`}
									target="_blank"
									rel="noopener noreferrer"
									className="text-gray-500 hover:text-gray-700 hover:underline"
								>
									{t('metadataLink')} ↗
								</a>
							) : null}
						</div>
						<details className="mt-3 text-xs leading-5 text-gray-500">
							<summary className="cursor-pointer text-gray-600 hover:text-gray-800">{t('learnMore')}</summary>
							<p className="mt-2 font-medium text-gray-700">{t('howTitle')}</p>
							<ol className="mt-1 list-decimal space-y-1 pl-5">
								<li>{t('how1')}</li>
								<li>{t('how2')}</li>
								<li>{t('how3')}</li>
							</ol>
							<p className="mt-2">{t('requirement')}</p>
						</details>
					</div>
				) : null}
			</ConfigCardShell>
		</div>
	);
}
