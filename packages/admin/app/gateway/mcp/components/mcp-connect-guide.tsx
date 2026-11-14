'use client';

import { useId, useState } from 'react';
import { CheckIcon, ClipboardDocumentIcon } from '@heroicons/react/24/outline';
import { useTranslations } from 'next-intl';
import { useProxyBaseUrlInput } from '@/components/proxy-connection-provider';
import { ProxyConnectionHint } from '@/components/proxy-connection-hint';
import { HighlightedCode } from '@/components/highlighted-code';
import type { ServerSummary } from '../mcp-types';
import { mcpProxyBaseUrl } from '../mcp-catalog-test-utils';
import {
	MCP_CONNECT_CLIENTS,
	MCP_KEY_PLACEHOLDER,
	MCP_OAUTH_CONNECT_CLIENTS,
	buildMcpConnectSnippets,
	buildMcpOAuthSnippets,
	mcpConnectEndpoint,
	mcpConnectServerName,
	type McpConnectClient,
} from '../mcp-connect-guide-utils';
import type { McpConnectAuth } from '../mcp-workspace-location';

const INPUT =
	'mt-1.5 block w-full min-w-0 rounded-lg border border-gray-200 bg-white px-3 py-2 text-sm text-gray-900 focus:border-gray-500 focus:outline-none focus:ring-2 focus:ring-gray-100';
const BUTTON =
	'inline-flex items-center justify-center gap-2 rounded-lg border border-gray-200 bg-white px-3 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50';
const CODE = 'overflow-auto whitespace-pre rounded-lg bg-slate-950 p-4 font-mono text-xs leading-6 text-slate-100';

export function McpConnectGuide({
	servers,
	scope: slug,
	onScopeChange,
	auth,
	onAuthChange,
	oauthServer,
}: {
	servers: ServerSummary[];
	scope: string;
	onScopeChange: (scope: string) => void;
	auth: McpConnectAuth;
	onAuthChange: (auth: McpConnectAuth) => void;
	oauthServer: string | undefined;
}) {
	const t = useTranslations('mcp.connectGuide');
	const ui = useTranslations('mcp.ui');
	const guideId = useId();
	const proxyConnection = useProxyBaseUrlInput();
	const baseUrl = proxyConnection.value;
	const [client, setClient] = useState<McpConnectClient>('cursor');
	const [copyResult, setCopyResult] = useState<{ code: string; status: 'ok' | 'failed' } | null>(null);

	const normalized = mcpProxyBaseUrl(baseUrl);
	const urlInvalid = baseUrl.trim() !== '' && normalized == null;
	// Without a valid Proxy address, show a visible placeholder instead of a broken URL.
	const effectiveBase = normalized ?? 'https://<YOUR_PROXY_URL>';
	const oauthMode = auth === 'oauth';
	const snippets = oauthMode
		? buildMcpOAuthSnippets({ baseUrl: effectiveBase, slug })
		: buildMcpConnectSnippets({ baseUrl: effectiveBase, slug });
	const clients = oauthMode ? MCP_OAUTH_CONNECT_CLIENTS : MCP_CONNECT_CLIENTS;
	const active = snippets.find((s) => s.client === client) ?? snippets[0];
	const copied = copyResult?.code === active.code ? copyResult.status : null;

	function changeAuth(next: McpConnectAuth) {
		onAuthChange(next);
		setCopyResult(null);
		// ChatGPT only exists in the OAuth list; fall back when it is no longer offered.
		if (next === 'key' && client === 'chatgpt') setClient('cursor');
	}

	function changeBaseUrl(value: string) {
		proxyConnection.setValue(value);
		setCopyResult(null);
	}

	async function copy() {
		try {
			await navigator.clipboard.writeText(active.code);
			setCopyResult({ code: active.code, status: 'ok' });
		} catch {
			setCopyResult({ code: active.code, status: 'failed' });
		}
	}

	const footer = (
		<div className="flex items-center justify-between gap-3">
			<p role="status" className="text-xs text-gray-500">
				{copied === 'ok'
					? t('copied')
					: copied === 'failed'
					? t('copyFailed')
					: oauthMode
					? t('oauthSafeHint')
					: t('safeHint')}
			</p>
		</div>
	);
	const content = (
		<div className="grid min-w-0 gap-5 xl:grid-cols-[minmax(0,0.9fr)_minmax(0,1.4fr)]">
			<div className="min-w-0 space-y-5">
				<div
					role="radiogroup"
					aria-label={t('authMode')}
					className="inline-flex rounded-lg border border-gray-200 bg-gray-50 p-0.5"
				>
					{(['key', 'oauth'] as const).map((id) => (
						<button
							key={id}
							type="button"
							role="radio"
							id={`${guideId}-auth-${id}`}
							tabIndex={auth === id ? 0 : -1}
							onKeyDown={(event) => {
								if (!['ArrowRight', 'ArrowLeft', 'ArrowDown', 'ArrowUp'].includes(event.key)) return;
								event.preventDefault();
								const next = id === 'key' ? 'oauth' : 'key';
								changeAuth(next);
								document.getElementById(`${guideId}-auth-${next}`)?.focus();
							}}
							aria-checked={auth === id}
							onClick={() => changeAuth(id)}
							className={`rounded-md px-3 py-1.5 text-sm font-medium ${
								auth === id ? 'bg-white text-gray-900 shadow-sm' : 'text-gray-500 hover:text-gray-700'
							}`}
						>
							{id === 'key' ? t('authKey') : t('authOauth')}
						</button>
					))}
				</div>

				{oauthMode && oauthServer !== undefined ? (
					<p
						role="status"
						className={`rounded-lg border px-4 py-3 text-sm leading-6 ${
							oauthServer
								? 'border-emerald-200 bg-emerald-50 text-emerald-800'
								: 'border-amber-200 bg-amber-50 text-amber-800'
						}`}
					>
						{oauthServer ? t('oauthOn', { server: oauthServer }) : t('oauthOff')}
					</p>
				) : null}

				<div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-1">
					<label className="block text-sm font-medium text-gray-700">
						{t('proxyUrl')}
						<input
							type="url"
							value={baseUrl}
							placeholder="https://proxy.example.com"
							aria-invalid={urlInvalid}
							onChange={(event) => changeBaseUrl(event.target.value)}
							onBlur={proxyConnection.commit}
							className={INPUT}
						/>
						<span
							className={`mt-1.5 block text-xs font-normal leading-5 ${urlInvalid ? 'text-red-600' : 'text-gray-500'}`}
						>
							{urlInvalid ? t('proxyInvalid') : t('proxyHint')}
						</span>
					</label>
					<label className="block text-sm font-medium text-gray-700">
						{t('scope')}
						<select
							value={slug}
							onChange={(event) => {
								onScopeChange(event.target.value);
								setCopyResult(null);
							}}
							className={INPUT}
						>
							<option value="">{t('allServices')}</option>
							{slug && !servers.some((server) => server.slug === slug) ? (
								<option value={slug}>{slug}</option>
							) : null}
							{servers.map((server) => (
								<option key={server.id} value={server.slug}>
									{server.name === server.slug ? server.name : `${server.name} (${server.slug})`}
									{server.status !== 'active' ? ` · ${t('disabled')}` : ''}
								</option>
							))}
						</select>
						<span className="mt-1.5 block text-xs font-normal leading-5 text-gray-500">{t('scopeHint')}</span>
					</label>
				</div>

				<ProxyConnectionHint
					source={proxyConnection.source}
					canReset={proxyConnection.canReset}
					onReset={() => {
						proxyConnection.reset();
						setCopyResult(null);
					}}
				/>

				<div className="rounded-lg border border-gray-200 bg-gray-50 px-4 py-3 text-sm">
					<span className="text-gray-500">{t('endpoint')}</span>{' '}
					<code className="break-all font-mono text-gray-900">{mcpConnectEndpoint(effectiveBase, slug)}</code>
				</div>

			</div>
			<div className="min-w-0">
				<div role="tablist" aria-label={t('clients')} className="flex flex-wrap gap-1 border-b border-gray-200">
					{clients.map((id) => (
						<button
							key={id}
							type="button"
							role="tab"
							id={`${guideId}-client-${id}`}
							aria-controls={`${guideId}-snippet`}
							tabIndex={active.client === id ? 0 : -1}
							onKeyDown={(event) => {
								const index = clients.indexOf(id);
								const next =
									event.key === 'Home'
										? 0
										: event.key === 'End'
										? clients.length - 1
										: event.key === 'ArrowRight'
										? (index + 1) % clients.length
										: event.key === 'ArrowLeft'
										? (index + clients.length - 1) % clients.length
										: null;
								if (next == null) return;
								event.preventDefault();
								setClient(clients[next]);
								setCopyResult(null);
								document.getElementById(`${guideId}-client-${clients[next]}`)?.focus();
							}}
							aria-selected={active.client === id}
							onClick={() => {
								setClient(id);
								setCopyResult(null);
							}}
							className={`-mb-px border-b-2 px-3 py-2 text-sm font-medium ${
								active.client === id
									? 'border-gray-900 text-gray-900'
									: 'border-transparent text-gray-500 hover:text-gray-700'
							}`}
						>
							{t(`client.${id}`)}
						</button>
					))}
				</div>
				<div
					id={`${guideId}-snippet`}
					role="tabpanel"
					aria-labelledby={`${guideId}-client-${active.client}`}
					className="mt-4 space-y-3"
				>
					<div className="flex flex-wrap items-center justify-between gap-2">
						<p className="text-sm text-gray-600">
							{active.target === 'terminal'
								? t('runInTerminal')
								: active.target === 'ui'
								? t('openInUi')
								: t('saveTo', { path: active.target })}
						</p>
						<button type="button" onClick={() => void copy()} className={BUTTON}>
							{copied === 'ok' ? (
								<CheckIcon aria-hidden="true" className="h-4 w-4 text-emerald-600" />
							) : (
								<ClipboardDocumentIcon aria-hidden="true" className="h-4 w-4" />
							)}
							{t('copy')}
						</button>
					</div>
					{active.language === 'json' || active.language === 'bash' ? (
						<HighlightedCode code={active.code} language={active.language} label={t(`client.${active.client}`)} />
					) : (
						<pre aria-label={t(`client.${active.client}`)} className={CODE}>
							{active.code}
						</pre>
					)}
					<p className="text-xs leading-5 text-gray-500">
						{oauthMode
							? t(`oauthNote.${active.client}`, { name: mcpConnectServerName(slug) })
							: t(`note.${active.client}`)}
					</p>
				</div>
			</div>

			<section className="border-t border-gray-100 pt-4 text-xs text-gray-500 xl:col-span-2">
				<h3 className="font-medium text-gray-700">{ui('connectionNotes')}</h3>
				<ul className="mt-3 list-disc space-y-1 pl-5 leading-5">
					{oauthMode ? (
						<>
							<li>{t('oauthTipScope')}</li>
							<li>{t('oauthTipBoth')}</li>
							<li>{t('oauthTipPublic')}</li>
						</>
					) : (
						<li>{t('tipKey', { placeholder: MCP_KEY_PLACEHOLDER })}</li>
					)}
					<li>{t('tipTools', { pattern: '{slug}__{name}' })}</li>
					<li>{t('tipEnable')}</li>
					<li>{t('tipTransport')}</li>
				</ul>
			</section>
		</div>
	);
	return (
		<div className="min-w-0 space-y-5">
			{content}
			{footer}
		</div>
	);
}
