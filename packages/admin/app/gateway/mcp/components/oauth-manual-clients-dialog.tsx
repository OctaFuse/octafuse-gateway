'use client';

/**
 * 手工客户端：给不支持动态注册（RFC 7591）的平台签发固定 `client_id` + `client_secret`，
 * 例如在服务端托管连接器、要求填写「服务端认证」凭据的平台。secret 只在签发 / 重置时展示一次。
 */
import { useTranslations } from 'next-intl';
import { useCallback, useEffect, useState } from 'react';
import { AdminDialog } from '@/components/admin-dialog';
import { useFeedback } from '@/components/feedback';
import { readApiJson } from '@/lib/api-json';
import type { SystemConfigRow } from '@/lib/types';
import type { IssuedOAuthClient, OAuthApp, OAuthClient } from '@/lib/oauth-access-token-types';
import { useGatewayDateTime } from '@/lib/use-gateway-datetime';
import { MCP_OAUTH_ISSUER_KEY, normalizeMcpOAuthIssuer } from '@octafuse/core/lib/mcp-oauth-system-config';

const inputClass =
	'w-full rounded-md border border-gray-200 bg-white px-3 py-2 text-sm text-gray-900 placeholder:text-gray-400 focus:border-gray-500 focus:outline-none focus:ring-2 focus:ring-gray-100';

const splitLines = (value: string) =>
	value
		.split(/[\n,]/)
		.map((item) => item.trim())
		.filter(Boolean);

function CopyRow({ label, value, secret = false }: { label: string; value: string; secret?: boolean }) {
	const tCommon = useTranslations('common');
	const { notify } = useFeedback();
	const copy = async () => {
		try {
			await navigator.clipboard.writeText(value);
			notify('success', tCommon('copied'));
		} catch {
			notify('error', tCommon('requestFailed'));
		}
	};
	return (
		<div className="grid grid-cols-[7.5rem_minmax(0,1fr)_auto] items-center gap-2 text-xs">
			<span className="text-gray-500">{label}</span>
			<code className={`break-all font-mono ${secret ? 'text-amber-900' : 'text-gray-800'}`}>{value}</code>
			<button type="button" onClick={() => void copy()} className="rounded px-2 py-1 text-gray-600 hover:bg-gray-100">
				{tCommon('copy')}
			</button>
		</div>
	);
}

export function OAuthManualClientsDialog({
	open,
	app,
	onClose,
	onChanged,
}: {
	open: boolean;
	app: OAuthApp | null;
	onClose: () => void;
	/** 签发 / 删除后刷新外层统计 */
	onChanged: () => void;
}) {
	const t = useTranslations('oauthAccessTokensPage.apps.manual');
	const tCommon = useTranslations('common');
	const { notify, confirm } = useFeedback();
	const { formatDateTime } = useGatewayDateTime();
	const [clients, setClients] = useState<OAuthClient[]>([]);
	const [issuer, setIssuer] = useState('');
	const [loading, setLoading] = useState(false);
	const [busy, setBusy] = useState(false);
	const [name, setName] = useState('');
	const [uris, setUris] = useState('');
	const [issued, setIssued] = useState<IssuedOAuthClient | null>(null);

	const appId = app?.id ?? null;
	const appName = app?.name ?? '';

	const load = useCallback(async () => {
		if (!appId) return;
		setLoading(true);
		try {
			const params = new URLSearchParams({ app_id: appId, registration_method: 'manual', page_size: '100' });
			const [clientsRes, configRes] = await Promise.all([
				fetch(`/api/admin/oauth/clients?${params.toString()}`),
				fetch('/api/admin/config'),
			]);
			const clientsData = await readApiJson<{ items: OAuthClient[] }>(clientsRes);
			if (!clientsData.success || !clientsData.data) throw new Error(clientsData.message || 'Could not load clients');
			setClients(clientsData.data.items);
			const configData = await readApiJson<SystemConfigRow[]>(configRes);
			const rawIssuer = configData.success
				? configData.data?.find((row) => row.key === MCP_OAUTH_ISSUER_KEY)?.value ?? ''
				: '';
			setIssuer(normalizeMcpOAuthIssuer(rawIssuer) ?? '');
		} catch (error) {
			console.error('Load manual OAuth clients error:', error);
			notify('error', tCommon('requestFailed'));
		} finally {
			setLoading(false);
		}
	}, [appId, notify, tCommon]);

	// 只在打开或切换应用时重置：外层刷新统计会换掉 `app` 对象，不能因此清掉刚签发的 secret。
	useEffect(() => {
		if (!open) return;
		setIssued(null);
		setName(appName);
		setUris('');
		void load();
		// eslint-disable-next-line react-hooks/exhaustive-deps
	}, [open, appId]);

	const create = async () => {
		if (!appId) return;
		setBusy(true);
		try {
			const response = await fetch(`/api/admin/oauth/apps/${encodeURIComponent(appId)}/clients`, {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ client_name: name.trim(), redirect_uris: splitLines(uris) }),
			});
			const data = await readApiJson<IssuedOAuthClient>(response);
			if (!data.success || !data.data) {
				notify('error', data.message || t('createFailed'));
				return;
			}
			setIssued(data.data);
			setUris('');
			onChanged();
			await load();
		} catch (error) {
			console.error('Create manual OAuth client error:', error);
			notify('error', t('createFailed'));
		} finally {
			setBusy(false);
		}
	};

	const rotate = async (client: OAuthClient) => {
		const ok = await confirm({
			title: t('rotateTitle'),
			message: t('rotateConfirm', { name: client.client_name }),
			confirmLabel: t('rotate'),
			danger: true,
		});
		if (!ok) return;
		setBusy(true);
		try {
			const response = await fetch(`/api/admin/oauth/clients/${encodeURIComponent(client.client_id)}/secret`, {
				method: 'POST',
			});
			const data = await readApiJson<IssuedOAuthClient>(response);
			if (!data.success || !data.data) {
				notify('error', data.message || t('rotateFailed'));
				return;
			}
			setIssued(data.data);
		} catch (error) {
			console.error('Rotate OAuth client secret error:', error);
			notify('error', t('rotateFailed'));
		} finally {
			setBusy(false);
		}
	};

	const remove = async (client: OAuthClient) => {
		const ok = await confirm({
			title: t('deleteTitle'),
			message: t('deleteConfirm', { name: client.client_name, count: client.live_grant_count ?? 0 }),
			confirmLabel: tCommon('delete'),
			danger: true,
		});
		if (!ok) return;
		setBusy(true);
		try {
			const response = await fetch(`/api/admin/oauth/clients/${encodeURIComponent(client.client_id)}`, {
				method: 'DELETE',
			});
			const data = await readApiJson(response);
			if (!data.success) {
				notify('error', data.message || t('deleteFailed'));
				return;
			}
			if (issued?.client.client_id === client.client_id) setIssued(null);
			notify('success', t('deleted'));
			onChanged();
			await load();
		} catch (error) {
			console.error('Delete OAuth client error:', error);
			notify('error', t('deleteFailed'));
		} finally {
			setBusy(false);
		}
	};

	return (
		<AdminDialog
			open={open}
			title={t('title', { name: appName })}
			hint={t('hint')}
			busy={busy}
			onClose={onClose}
			footer={
				<div className="flex justify-end">
					<button
						type="button"
						onClick={onClose}
						disabled={busy}
						className="rounded-lg border border-gray-200 bg-white px-4 py-2 text-sm text-gray-700 disabled:opacity-40"
					>
						{tCommon('close')}
					</button>
				</div>
			}
		>
			<div className="space-y-5">
				{issued ? (
					<section className="space-y-2 rounded-lg border border-amber-200 bg-amber-50 p-3" aria-live="polite">
						<p className="text-sm font-medium text-amber-900">{t('issuedTitle')}</p>
						<p className="text-xs leading-5 text-amber-800">{t('issuedHint')}</p>
						<CopyRow label="client_id" value={issued.client.client_id} />
						<CopyRow label="client_secret" value={issued.client_secret} secret />
						{issuer ? (
							<>
								<CopyRow label={t('authorizeUrl')} value={`${issuer}/oauth/authorize`} />
								<CopyRow label={t('tokenUrl')} value={`${issuer}/oauth/token`} />
								<CopyRow label={t('mcpUrl')} value={`${issuer}/mcp`} />
							</>
						) : (
							<p className="text-xs text-amber-800">{t('issuerMissing')}</p>
						)}
						<CopyRow label="scope" value="mcp" />
						<p className="text-xs leading-5 text-amber-800">{t('authMethodHint')}</p>
					</section>
				) : null}

				<section className="space-y-3">
					<h4 className="text-sm font-medium text-gray-900">{t('createTitle')}</h4>
					<label className="block">
						<span className="mb-1 block text-xs font-medium text-gray-500">{t('name')}</span>
						<input className={inputClass} value={name} onChange={(e) => setName(e.target.value)} maxLength={100} />
					</label>
					<label className="block">
						<span className="mb-1 block text-xs font-medium text-gray-500">{t('redirectUris')}</span>
						<textarea
							className={`${inputClass} min-h-[4rem] font-mono`}
							value={uris}
							onChange={(e) => setUris(e.target.value)}
							spellCheck={false}
							placeholder="https://connector.example.com/oauth/callback"
						/>
						<span className="mt-1 block text-xs leading-5 text-gray-400">{t('redirectUrisHint')}</span>
					</label>
					<div className="flex justify-end">
						<button
							type="button"
							onClick={() => void create()}
							disabled={busy || !appId}
							className="rounded-lg bg-gray-900 px-4 py-2 text-sm font-medium text-white disabled:opacity-40"
						>
							{t('create')}
						</button>
					</div>
				</section>

				<section className="space-y-2 border-t border-gray-100 pt-4">
					<h4 className="text-sm font-medium text-gray-900">{t('listTitle')}</h4>
					{loading ? (
						<p role="status" className="text-xs text-gray-500">
							{tCommon('loading')}
						</p>
					) : clients.length === 0 ? (
						<p className="text-xs text-gray-500">{t('empty')}</p>
					) : (
						<ul className="divide-y divide-gray-100">
							{clients.map((client) => (
								<li key={client.client_id} className="flex flex-wrap items-start justify-between gap-3 py-2.5">
									<div className="min-w-0 flex-1 space-y-1">
										<p className="text-sm text-gray-900">{client.client_name}</p>
										<code className="block break-all font-mono text-xs text-gray-600">{client.client_id}</code>
										<p className="text-xs text-gray-500">
											{client.redirect_uris.length > 0
												? client.redirect_uris.join(', ')
												: t('inheritRedirects')}
										</p>
										<p className="text-xs text-gray-400">
											{t('createdAt', { time: formatDateTime(client.created_at) })}
											{' · '}
											{t('liveGrants', { count: client.live_grant_count ?? 0 })}
										</p>
									</div>
									<div className="flex items-center gap-1 text-xs">
										<button
											type="button"
											disabled={busy}
											onClick={() => void rotate(client)}
											className="rounded-md px-2.5 py-1.5 text-gray-600 hover:bg-gray-50 disabled:opacity-40"
										>
											{t('rotate')}
										</button>
										<button
											type="button"
											disabled={busy}
											onClick={() => void remove(client)}
											className="rounded-md px-2.5 py-1.5 text-red-600 hover:bg-red-50 disabled:opacity-40"
										>
											{tCommon('delete')}
										</button>
									</div>
								</li>
							))}
						</ul>
					)}
				</section>
			</div>
		</AdminDialog>
	);
}
