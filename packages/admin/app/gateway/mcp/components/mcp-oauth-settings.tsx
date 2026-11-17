'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { useTranslations } from 'next-intl';
import { InfoHintPopover } from '@/components/InfoHintPopover';
import { ShieldCheckIcon } from '@heroicons/react/24/outline';
import { readApiJson } from '@/lib/api-json';
import type { SystemConfigRow } from '@/lib/types';
import {
	MCP_OAUTH_AUTHORIZATION_SERVER_KEY,
	MCP_OAUTH_CIMD_ENABLED_KEY,
	MCP_OAUTH_CONSENT_URL_KEY,
	MCP_OAUTH_ISSUER_KEY,
	MCP_OAUTH_PROTECTED_RESOURCE_PATH,
	normalizeMcpOAuthAuthorizationServer,
	normalizeMcpOAuthConsentUrl,
	parseMcpOAuthCimdEnabled,
	resolveMcpOAuthMode,
} from '@octafuse/core/lib/mcp-oauth-system-config';

type Mode = 'off' | 'builtin' | 'external';

interface Values {
	mode: Mode;
	/** 内置模式：本 Gateway 对外的公开根地址（授权服务器 issuer） */
	issuer: string;
	/** 内置模式：可选的外部同意页（如门户）；空 = 使用内置 API Key 确认页 */
	consentUrl: string;
	/** 外部模式：外部授权服务器地址 */
	authorizationServer: string;
	/** 内置模式：是否接受以 https URL 作为 `client_id` 的客户端元数据文档（CIMD） */
	cimd: boolean;
}

const EMPTY: Values = { mode: 'off', issuer: '', consentUrl: '', authorizationServer: '', cimd: false };

const MODES: readonly Mode[] = ['off', 'builtin', 'external'];

/**
 * MCP OAuth 的三种模式（均为全局设置，不属于某个 MCP 服务）：
 * - 内置（`MCP_OAUTH_ISSUER`）：Gateway 自己是授权服务器；可选 `MCP_OAUTH_CONSENT_URL` 指向外部登录 + 同意页。
 * - 外部（`MCP_OAUTH_AUTHORIZATION_SERVER`）：只声明外部授权服务器。设置了 issuer 时被忽略。
 * - 关闭：留空，不暴露 OAuth 发现。
 * 回滚到外部模式只需清空 issuer。
 */
export function McpOAuthSettings({
	onOpenGuide,
	onSaved,
	onDraftOffChange,
	className = '',
}: {
	className?: string;
	onOpenGuide: () => void;
	/** 当前选中的模式是否为「关闭」（含未保存的草稿），供页面收起下方依赖 OAuth 的内容 */
	onDraftOffChange?: (off: boolean) => void;
	/** 回传当前生效的授权服务器根地址（内置为 issuer，外部为外部地址，关闭为空串） */
	onSaved: (value: string) => void;
}) {
	const t = useTranslations('mcp.oauth');
	const mcp = useTranslations('mcp');
	const tUx = useTranslations('config.ux');
	const ui = useTranslations('mcp.ui');
	const tCommon = useTranslations('common');
	const [saved, setSaved] = useState<Values>(EMPTY);
	const [draft, setDraft] = useState<Values>(EMPTY);
	const [loading, setLoading] = useState(true);
	const [loadFailed, setLoadFailed] = useState(false);
	const [saving, setSaving] = useState(false);
	const [error, setError] = useState('');
	const [notice, setNotice] = useState('');

	const effectiveServer = (values: Values) =>
		values.mode === 'builtin' ? values.issuer : values.mode === 'external' ? values.authorizationServer : '';

	const load = useCallback(async () => {
		setLoading(true);
		setError('');
		try {
			const response = await fetch('/api/admin/config');
			const data = await readApiJson<SystemConfigRow[]>(response);
			if (data.success && Array.isArray(data.data)) {
				const read = (key: string) => data.data?.find((row) => row.key === key)?.value?.trim() ?? '';
				const resolved = resolveMcpOAuthMode({
					issuer: read(MCP_OAUTH_ISSUER_KEY),
					authorizationServer: read(MCP_OAUTH_AUTHORIZATION_SERVER_KEY),
					consentUrl: read(MCP_OAUTH_CONSENT_URL_KEY),
					cimdEnabled: read(MCP_OAUTH_CIMD_ENABLED_KEY),
				});
				const values: Values = {
					mode: resolved.mode,
					issuer: resolved.mode === 'builtin' ? resolved.issuer : '',
					consentUrl: resolved.mode === 'builtin' ? resolved.consentUrl ?? '' : '',
					authorizationServer:
						resolved.mode === 'external' ? resolved.authorizationServer : read(MCP_OAUTH_AUTHORIZATION_SERVER_KEY),
					cimd: parseMcpOAuthCimdEnabled(read(MCP_OAUTH_CIMD_ENABLED_KEY)),
				};
				setLoadFailed(false);
				setSaved(values);
				setDraft(values);
				onSaved(effectiveServer(values));
			} else {
				setLoadFailed(true);
				setError(data.message || tCommon('requestFailed'));
			}
		} catch {
			setLoadFailed(true);
			setError(tCommon('requestFailed'));
		} finally {
			setLoading(false);
		}
	}, [tCommon, onSaved]);

	useEffect(() => {
		void load();
	}, [load]);

	// 只比较当前模式下有意义的字段，切换到别的模式再切回来不算脏。
	const normalizeForCompare = (v: Values) => ({
		mode: v.mode,
		issuer: v.mode === 'builtin' ? v.issuer.trim() : '',
		consentUrl: v.mode === 'builtin' ? v.consentUrl.trim() : '',
		authorizationServer: v.mode === 'external' ? v.authorizationServer.trim() : '',
		cimd: v.mode === 'builtin' ? v.cimd : false,
	});
	const dirty = useMemo(
		() => JSON.stringify(normalizeForCompare(draft)) !== JSON.stringify(normalizeForCompare(saved)),
		[draft, saved]
	);
	const missing =
		(draft.mode === 'builtin' && draft.issuer.trim() === '') ||
		(draft.mode === 'external' && draft.authorizationServer.trim() === '');

	useEffect(() => {
		if (loading || loadFailed) return;
		onDraftOffChange?.(draft.mode === 'off');
	}, [draft.mode, loading, loadFailed, onDraftOffChange]);

	useEffect(() => {
		if (!dirty) return;
		const handleBeforeUnload = (event: BeforeUnloadEvent) => {
			event.preventDefault();
			event.returnValue = '';
		};
		window.addEventListener('beforeunload', handleBeforeUnload);
		return () => window.removeEventListener('beforeunload', handleBeforeUnload);
	}, [dirty]);

	const putConfig = async (key: string, value: string) => {
		const response = await fetch('/api/admin/config', {
			method: 'PUT',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify({ key, value }),
		});
		const data = await readApiJson(response);
		if (!data.success) throw new Error(data.message || tCommon('saveFailed'));
	};

	const save = async () => {
		if (loadFailed || loading) return;
		if (missing) {
			setNotice('');
			setError(t('required'));
			return;
		}
		const issuer = draft.mode === 'builtin' ? normalizeMcpOAuthAuthorizationServer(draft.issuer) : '';
		const consentUrl = draft.mode === 'builtin' ? normalizeMcpOAuthConsentUrl(draft.consentUrl) : '';
		const authorizationServer =
			draft.mode === 'external' ? normalizeMcpOAuthAuthorizationServer(draft.authorizationServer) : '';
		if (issuer === null || authorizationServer === null) {
			setNotice('');
			setError(t('invalid'));
			return;
		}
		if (consentUrl === null) {
			setNotice('');
			setError(t('consentInvalid'));
			return;
		}
		setSaving(true);
		setError('');
		setNotice('');
		try {
			// 先写 issuer：关闭内置的同时清掉它，立刻回到外部 / 关闭状态。
			await putConfig(MCP_OAUTH_ISSUER_KEY, issuer);
			await putConfig(MCP_OAUTH_CONSENT_URL_KEY, consentUrl);
			// 切到内置时保留外部地址不动，方便回滚；其余模式按草稿写入。
			if (draft.mode !== 'builtin') await putConfig(MCP_OAUTH_AUTHORIZATION_SERVER_KEY, authorizationServer);
			const cimd = draft.mode === 'builtin' && draft.cimd;
			if (cimd !== saved.cimd) await putConfig(MCP_OAUTH_CIMD_ENABLED_KEY, cimd ? 'true' : '');
			const next: Values = {
				mode: draft.mode,
				issuer,
				consentUrl,
				authorizationServer:
					draft.mode === 'builtin' ? saved.authorizationServer : authorizationServer,
				cimd,
			};
			setSaved(next);
			setDraft(next);
			onSaved(effectiveServer(next));
			setNotice(tCommon('configUpdated'));
		} catch (cause) {
			setError(cause instanceof Error && cause.message ? cause.message : tCommon('requestFailed'));
		} finally {
			setSaving(false);
		}
	};

	const savedServer = effectiveServer(saved);
	const setField = (patch: Partial<Values>) => {
		setError('');
		setNotice('');
		setDraft((current) => ({ ...current, ...patch }));
	};

	const footer = loadFailed ? (
		<div
			role="alert"
			className="flex flex-wrap items-center justify-between gap-3 text-sm text-red-700"
		>
			<span>{error}</span>
			<button
				type="button"
				disabled={loading}
				onClick={() => void load()}
				className="font-medium underline disabled:opacity-40"
			>
				{ui('retry')}
			</button>
		</div>
	) : dirty || error ? (
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
						setError('');
					}}
					className="rounded-lg border border-gray-200 px-3 py-2 text-sm text-gray-700 hover:bg-gray-50 disabled:opacity-50"
				>
					{mcp('discard')}
				</button>
				<button
					type="button"
					disabled={saving || loading || !dirty || missing}
					onClick={() => void save()}
					aria-label={t('save')}
					className="rounded-lg bg-gray-900 px-4 py-2 text-sm font-medium text-white hover:bg-gray-800 disabled:cursor-not-allowed disabled:opacity-40"
				>
					{saving ? tCommon('saving') : tCommon('save')}
				</button>
			</div>
		</div>
	) : undefined;
	return (
		<section
			id="mcp-oauth"
			aria-labelledby="mcp-oauth-title"
			className={`${className} admin-content-panel min-w-0 scroll-mt-4 border border-gray-200 bg-white p-4 sm:p-6`}
		>
			<header className="flex flex-wrap items-start justify-between gap-4">
				<div className="min-w-0 flex-1">
					<div className="flex flex-wrap items-center gap-2">
						<ShieldCheckIcon className="h-4 w-4 text-gray-500" aria-hidden="true" />
						<h2 id="mcp-oauth-title" className="text-base font-medium text-gray-900">{t('serverTitle')}</h2>
						<InfoHintPopover label={t('serverTitle')} portal openOnHover align="start">
							{t('description')}
						</InfoHintPopover>
						{!loading && !loadFailed ? (
							<span
								className={`rounded-md px-2 py-0.5 text-xs ${
									saved.mode === 'off'
										? 'bg-gray-100 text-gray-500'
										: 'bg-emerald-50 text-emerald-700'
								}`}
							>
								{t(`modes.${saved.mode}.title`)}
							</span>
						) : null}
					</div>
					{loading ? (
						<p role="status" className="mt-2 text-xs text-gray-500">
							{tCommon('loading')}
						</p>
					) : !loadFailed ? (
						<p className="mt-1.5 text-xs leading-5 text-gray-500">{t(`scope.${saved.mode}`)}</p>
					) : null}
				</div>
				{savedServer && !dirty && !loading && !loadFailed ? (
					<div className="flex shrink-0 flex-wrap items-center gap-2 text-sm">
						<a
							href={`${savedServer}/.well-known/oauth-authorization-server`}
							target="_blank"
							rel="noopener noreferrer"
							className="rounded-md px-2 py-1.5 text-xs text-gray-500 hover:bg-gray-100 hover:text-gray-800"
						>
							{t('metadataLink')} ↗
						</a>
						<button
							type="button"
							onClick={onOpenGuide}
							className="rounded-md border border-gray-200 bg-white px-3 py-1.5 text-xs font-medium text-gray-800 hover:bg-gray-50"
						>
							{t('openGuide')}
						</button>
					</div>
				) : null}
			</header>
			<div id="mcp-oauth-configuration" className="mt-5 space-y-4 border-t border-gray-100 pt-5">
				<div role="radiogroup" aria-label={t('modeLabel')} className="grid gap-3 md:grid-cols-3">
					{MODES.map((mode) => (
						<label
							key={mode}
							className={`flex cursor-pointer items-start gap-3 rounded-lg border px-3 py-2.5 ${
								draft.mode === mode
									? 'border-teal-500 bg-teal-50 ring-1 ring-teal-100'
									: 'border-gray-200 bg-white hover:border-gray-300 hover:bg-gray-50'
							} ${saving || loading || loadFailed ? 'opacity-60' : ''}`}
						>
							<input
								type="radio"
								name="mcp-oauth-mode"
								value={mode}
								checked={draft.mode === mode}
								disabled={saving || loading || loadFailed}
								onChange={() => setField({ mode })}
								className="mt-1 accent-teal-700"
							/>
							<span className="min-w-0">
								<span
									className={`block text-sm font-medium ${
										draft.mode === mode ? 'text-teal-950' : 'text-gray-900'
									}`}
								>
									{t(`modes.${mode}.title`)}
								</span>
								<span className="block text-xs leading-5 text-gray-500">
									{t(`modes.${mode}.hint`)}
								</span>
							</span>
						</label>
					))}
				</div>
				{draft.mode === 'builtin' ? (
					<div className="rounded-lg border border-gray-200 bg-gray-50/60">
						<div className="grid gap-4 p-4 md:grid-cols-2">
							<div>
								<label htmlFor="mcp-oauth-issuer" className="mb-1 block text-sm font-medium text-gray-700">
									{t('issuerLabel')}
								</label>
								<input
									id="mcp-oauth-issuer"
									type="url"
									disabled={saving || loading || loadFailed}
									value={draft.issuer}
									onChange={(e) => setField({ issuer: e.target.value })}
									placeholder={t('issuerPlaceholder')}
									spellCheck={false}
									autoComplete="off"
									className="w-full rounded-lg border border-gray-200 bg-white px-3 py-2 font-mono text-sm"
								/>
								<p className="mt-1.5 text-xs leading-5 text-gray-400">{t('issuerHint')}</p>
							</div>
							<div>
								<label htmlFor="mcp-oauth-consent" className="mb-1 block text-sm font-medium text-gray-700">
									{t('consentLabel')}
								</label>
								<input
									id="mcp-oauth-consent"
									type="url"
									disabled={saving || loading || loadFailed}
									value={draft.consentUrl}
									onChange={(e) => setField({ consentUrl: e.target.value })}
									placeholder={t('consentPlaceholder')}
									spellCheck={false}
									autoComplete="off"
									className="w-full rounded-lg border border-gray-200 bg-white px-3 py-2 font-mono text-sm"
								/>
								<p className="mt-1.5 text-xs leading-5 text-gray-400">{t('consentHint')}</p>
							</div>
						</div>
						<div className="flex items-start justify-between gap-4 border-t border-gray-200 px-4 py-3">
							<div className="min-w-0">
								<p id="mcp-oauth-cimd-label" className="text-sm font-medium text-gray-700">
									{t('cimdLabel')}
								</p>
								<p className="mt-0.5 text-xs leading-5 text-gray-400">{t('cimdHint')}</p>
							</div>
							<button
								type="button"
								role="switch"
								aria-checked={draft.cimd}
								aria-labelledby="mcp-oauth-cimd-label"
								disabled={saving || loading || loadFailed}
								onClick={() => setField({ cimd: !draft.cimd })}
								className={`relative mt-0.5 h-5 w-9 shrink-0 rounded-full transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-gray-500 focus-visible:ring-offset-2 ${
									draft.cimd ? 'bg-gray-900' : 'bg-gray-300'
								} disabled:opacity-50`}
							>
								<span
									className={`absolute left-0.5 top-0.5 h-4 w-4 rounded-full bg-white transition-transform ${
										draft.cimd ? 'translate-x-4' : ''
									}`}
								/>
							</button>
						</div>
					</div>
				) : null}
				{draft.mode === 'external' ? (
					<div className="rounded-lg border border-gray-200 bg-gray-50/60 p-4">
						<label htmlFor="mcp-oauth-input" className="mb-1 block text-sm font-medium text-gray-700">
							{t('label')}
						</label>
						<input
							id="mcp-oauth-input"
							type="url"
							disabled={saving || loading || loadFailed}
							value={draft.authorizationServer}
							onChange={(e) => setField({ authorizationServer: e.target.value })}
							placeholder={t('placeholder')}
							spellCheck={false}
							autoComplete="off"
							className="w-full rounded-lg border border-gray-200 bg-white px-3 py-2 font-mono text-sm"
						/>
					</div>
				) : null}
				{footer ? <div>{footer}</div> : null}
				{notice && !dirty && !error ? (
					<p role="status" className="text-xs text-emerald-700">
						{notice}
					</p>
				) : null}
				{draft.mode !== 'off' ? (
					<details className="group text-xs leading-5 text-gray-500">
						<summary className="cursor-pointer select-none text-gray-600 hover:text-gray-800">
							{t('learnMore')}
						</summary>
						<div className="mt-2 rounded-lg bg-gray-50 px-4 py-3">
							<p className="font-medium text-gray-700">{t('howTitle')}</p>
							<ol className="mt-1 list-decimal space-y-1 pl-5">
								<li>{t('how1')}</li>
								<li>{t('how2')}</li>
								<li>{t('how3')}</li>
							</ol>
							<p className="mt-2">{t('requirement')}</p>
							{savedServer ? (
								<p className="mt-2">{t('statusOn', { path: `${MCP_OAUTH_PROTECTED_RESOURCE_PATH}/mcp` })}</p>
							) : null}
						</div>
					</details>
				) : null}
			</div>
		</section>
	);
}
