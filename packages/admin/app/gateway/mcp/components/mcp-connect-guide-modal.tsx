'use client';

import { useEffect, useState } from 'react';
import { CheckIcon, ClipboardDocumentIcon } from '@heroicons/react/24/outline';
import { useTranslations } from 'next-intl';
import type { ServerSummary } from '../mcp-types';
import { MCP_CATALOG_PROXY_STORAGE, SIMULATOR_PROXY_STORAGE, mcpProxyBaseUrl } from '../mcp-catalog-test-utils';
import {
	MCP_CONNECT_CLIENTS,
	MCP_KEY_PLACEHOLDER,
	buildMcpConnectSnippets,
	mcpConnectEndpoint,
	type McpConnectClient,
} from '../mcp-connect-guide-utils';
import { McpDialog } from './mcp-dialog';

const INPUT =
	'mt-1.5 block w-full min-w-0 rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm text-gray-900 focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500';
const BUTTON =
	'inline-flex items-center justify-center gap-2 rounded-lg border border-gray-200 bg-white px-3 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50';
const CODE =
	'overflow-auto whitespace-pre rounded-lg bg-slate-950 p-4 font-mono text-xs leading-6 text-slate-100';

function readSavedProxyUrl(): string {
	try {
		const saved = localStorage.getItem(MCP_CATALOG_PROXY_STORAGE) || localStorage.getItem(SIMULATOR_PROXY_STORAGE);
		if (saved && mcpProxyBaseUrl(saved)) return saved;
	} catch {
		/* Storage can be unavailable in private contexts. */
	}
	if (['localhost', '127.0.0.1', '[::1]'].includes(window.location.hostname)) {
		const local = new URL(window.location.origin);
		local.port = '8787';
		return local.origin;
	}
	return '';
}

export function McpConnectGuideModal({
	servers,
	initialSlug,
	onClose,
}: {
	servers: ServerSummary[];
	initialSlug: string;
	onClose: () => void;
}) {
	const t = useTranslations('mcp.connectGuide');
	const common = useTranslations('common');
	const [baseUrl, setBaseUrl] = useState('');
	const [slug, setSlug] = useState(initialSlug);
	const [client, setClient] = useState<McpConnectClient>('cursor');
	const [copied, setCopied] = useState<'ok' | 'failed' | null>(null);

	useEffect(() => {
		setBaseUrl(readSavedProxyUrl());
	}, []);

	const normalized = mcpProxyBaseUrl(baseUrl);
	const urlInvalid = baseUrl.trim() !== '' && normalized == null;
	// Without a valid Proxy address, show a visible placeholder instead of a broken URL.
	const effectiveBase = normalized ?? 'https://<YOUR_PROXY_URL>';
	const snippets = buildMcpConnectSnippets({ baseUrl: effectiveBase, slug });
	const active = snippets.find((s) => s.client === client) ?? snippets[0];

	function changeBaseUrl(value: string) {
		setBaseUrl(value);
		setCopied(null);
		const next = mcpProxyBaseUrl(value);
		if (next) {
			try {
				localStorage.setItem(MCP_CATALOG_PROXY_STORAGE, next);
			} catch {
				/* Persisting is best-effort. */
			}
		}
	}

	async function copy() {
		try {
			await navigator.clipboard.writeText(active.code);
			setCopied('ok');
		} catch {
			setCopied('failed');
		}
	}

	return (
		<McpDialog
			wide
			busy={false}
			title={t('title')}
			subtitle={t('subtitle')}
			onClose={onClose}
			footer={
				<div className="flex items-center justify-between gap-3">
					<p role="status" className="text-xs text-gray-500">
						{copied === 'ok' ? t('copied') : copied === 'failed' ? t('copyFailed') : t('safeHint')}
					</p>
					<button type="button" onClick={onClose} className={BUTTON}>
						{common('close')}
					</button>
				</div>
			}
		>
			<div className="space-y-5">
				<div className="grid gap-4 sm:grid-cols-2">
					<label className="block text-sm font-medium text-gray-700">
						{t('proxyUrl')}
						<input
							type="url"
							value={baseUrl}
							placeholder="https://proxy.example.com"
							aria-invalid={urlInvalid}
							onChange={(event) => changeBaseUrl(event.target.value)}
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
						<select value={slug} onChange={(event) => setSlug(event.target.value)} className={INPUT}>
							<option value="">{t('allServices')}</option>
							{servers.map((server) => (
								<option key={server.id} value={server.slug}>
									{server.name} ({server.slug}){server.status !== 'active' ? ` · ${t('disabled')}` : ''}
								</option>
							))}
						</select>
						<span className="mt-1.5 block text-xs font-normal leading-5 text-gray-500">
							{t('scopeHint')}
						</span>
					</label>
				</div>

				<div className="rounded-lg border border-gray-200 bg-gray-50 px-4 py-3 text-sm">
					<span className="text-gray-500">{t('endpoint')}</span>{' '}
					<code className="break-all font-mono text-gray-900">{mcpConnectEndpoint(effectiveBase, slug)}</code>
				</div>

				<div>
					<div role="tablist" aria-label={t('clients')} className="flex flex-wrap gap-1 border-b border-gray-200">
						{MCP_CONNECT_CLIENTS.map((id) => (
							<button
								key={id}
								type="button"
								role="tab"
								aria-selected={client === id}
								onClick={() => {
									setClient(id);
									setCopied(null);
								}}
								className={`-mb-px border-b-2 px-3 py-2 text-sm font-medium ${
									client === id
										? 'border-gray-900 text-gray-900'
										: 'border-transparent text-gray-500 hover:text-gray-700'
								}`}
							>
								{t(`client.${id}`)}
							</button>
						))}
					</div>
					<div className="mt-4 space-y-3">
						<div className="flex flex-wrap items-center justify-between gap-2">
							<p className="text-sm text-gray-600">
								{active.target === 'terminal' ? t('runInTerminal') : t('saveTo', { path: active.target })}
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
						<pre aria-label={t(`client.${active.client}`)} className={CODE}>
							{active.code}
						</pre>
						<p className="text-xs leading-5 text-gray-500">{t(`note.${active.client}`)}</p>
					</div>
				</div>

				<ul className="list-disc space-y-1 pl-5 text-xs leading-5 text-gray-500">
					<li>{t('tipKey', { placeholder: MCP_KEY_PLACEHOLDER })}</li>
					<li>{t('tipTools', { pattern: '{slug}__{name}' })}</li>
					<li>{t('tipEnable')}</li>
					<li>{t('tipTransport')}</li>
				</ul>
			</div>
		</McpDialog>
	);
}
