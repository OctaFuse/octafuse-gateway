'use client';

import { useId, useState } from 'react';
import { ArrowPathIcon, EyeIcon, EyeSlashIcon, ClipboardDocumentIcon } from '@heroicons/react/24/outline';
import { useTranslations } from 'next-intl';
import type { ServerSummary } from '../mcp-types';
import {
	MCP_CATALOG_METHODS,
	MCP_PROTOCOL_VERSIONS,
	groupMcpCatalog,
	mcpRequestCurl,
	type McpCatalogMethod,
} from '../mcp-catalog-test-utils';
import { useMcpCatalogTest, type McpCatalogTestResponse } from '../use-mcp-catalog-test';
import { McpDialog } from './mcp-dialog';

const INPUT =
	'mt-1.5 block w-full min-w-0 rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm text-gray-900 focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500 disabled:bg-gray-100';
const BUTTON =
	'inline-flex items-center justify-center gap-2 rounded-lg border border-gray-200 bg-white px-3 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50 disabled:opacity-50';
const CODE =
	'max-h-96 overflow-auto whitespace-pre rounded-lg bg-slate-950 p-4 font-mono text-xs leading-6 text-slate-100';

function CatalogDescription({ text }: { text: string }) {
	const t = useTranslations('mcp');
	const [expanded, setExpanded] = useState(false);
	return (
		<div>
			<p
				className={`whitespace-pre-wrap break-words text-sm leading-6 text-gray-500 ${
					expanded ? '' : 'line-clamp-2'
				}`}
			>
				{text}
			</p>
			{text.length > 180 || text.includes('\n') ? (
				<button
					type="button"
					aria-expanded={expanded}
					onClick={() => setExpanded(!expanded)}
					className="mt-1 text-xs font-medium text-gray-500 hover:text-gray-700"
				>
					{t(expanded ? 'collapseDescription' : 'expandDescription')}
				</button>
			) : null}
		</div>
	);
}

function CatalogGroups({
	response,
	servers,
}: {
	response: McpCatalogTestResponse;
	servers: ServerSummary[];
}) {
	const t = useTranslations('mcp.catalogTest');
	const [search, setSearch] = useState('');
	const query = search.trim().toLocaleLowerCase();
	const entries = response.parsed.entries ?? [];
	const groups = groupMcpCatalog(entries, response.request.rpcMethod, response.request.slug);
	const visible = groups
		.map((group) => ({
			...group,
			entries: group.entries.filter(
				(entry) =>
					!query ||
					[
						group.slug,
						servers.find((s) => s.slug === group.slug)?.name,
						entry.name,
						entry.uri,
						entry.title,
						entry.description,
					].some((text) => typeof text === 'string' && text.toLocaleLowerCase().includes(query))
			),
		}))
		.filter((group) => group.entries.length);
	return (
		<div className="space-y-3">
			<label className="block text-xs font-medium text-gray-600">
				{t('search')}
				<input
					type="search"
					value={search}
					onChange={(event) => setSearch(event.target.value)}
					className={INPUT}
				/>
			</label>
			{!entries.length ? (
				<p
					role="status"
					className="rounded-lg border border-dashed border-gray-200 p-8 text-center text-sm text-gray-500"
				>
					{t('empty')}
				</p>
			) : !visible.length ? (
				<p role="status" className="py-8 text-center text-sm text-gray-500">
					{t('noMatches')}
				</p>
			) : null}
			{visible.map((group) => (
				<section
					key={group.slug ?? '__unidentified__'}
					className="overflow-hidden rounded-xl border border-gray-200"
				>
					<div className="flex flex-wrap items-center gap-2 border-b border-gray-200 bg-gray-50 px-4 py-3">
						<h3 className="text-sm font-semibold text-gray-900">
							{servers.find((s) => s.slug === group.slug)?.name ?? group.slug ?? t('unknownService')}
						</h3>
						{group.slug ? (
							<code className="rounded bg-white px-2 py-0.5 text-xs text-gray-500">{group.slug}</code>
						) : null}
						<span className="ml-auto text-xs text-gray-500">
							{t('itemCount', { count: group.entries.length })}
						</span>
					</div>
					<div className="divide-y divide-gray-100">
						{group.entries.map((entry, index) => (
							<div key={`${String(entry.uri ?? entry.name)}-${index}`} className="space-y-2 p-4">
								<code className="block break-all text-sm font-medium text-gray-900">
									{String(entry.uri ?? entry.name)}
								</code>
								{typeof entry.title === 'string' ? (
									<p className="text-sm text-gray-700">{entry.title}</p>
								) : typeof entry.uri === 'string' && typeof entry.name === 'string' ? (
									<p className="text-sm text-gray-700">{entry.name}</p>
								) : null}
								{typeof entry.description === 'string' ? (
									<CatalogDescription text={entry.description} />
								) : null}
								{typeof entry.mimeType === 'string' ? (
									<code className="text-xs text-gray-500">{entry.mimeType}</code>
								) : null}
								<details>
									<summary className="cursor-pointer text-xs font-medium text-blue-600">
										{t('entryJson')}
									</summary>
									<pre className={`${CODE} mt-2`}>{JSON.stringify(entry, null, 2)}</pre>
								</details>
							</div>
						))}
					</div>
				</section>
			))}
		</div>
	);
}

export function McpCatalogTestModal({
	servers,
	initialSlug,
	onClose,
}: {
	servers: ServerSummary[];
	initialSlug: string;
	onClose: () => void;
}) {
	const t = useTranslations('mcp.catalogTest');
	const common = useTranslations('common');
	const state = useMcpCatalogTest(initialSlug);
	const formId = useId();
	const [copyStatus, setCopyStatus] = useState<string | null>(null);
	const response = state.response;
	const canGroup = Boolean(response?.ok && response.parsed.entries !== null);
	const rawView = state.view === 'raw' || !canGroup;
	const raw = response
		? response.parsed.json !== null
			? JSON.stringify(response.parsed.json, null, 2)
			: response.rawText
		: '';
	async function copy(value: string) {
		try {
			await navigator.clipboard.writeText(value);
			setCopyStatus(t('copied'));
		} catch {
			setCopyStatus(t('copyFailed'));
		}
	}
	return (
		<McpDialog
			wide
			closeWhileBusy
			busy={state.sending}
			title={t('title')}
			subtitle={t('subtitle')}
			onClose={onClose}
			footer={
				<div className="flex flex-wrap items-center justify-between gap-3">
					<p role="status" className="text-xs text-gray-500">
						{copyStatus ?? t('readOnly')}
					</p>
					<div className="flex items-center gap-2">
						<button type="button" onClick={onClose} className={BUTTON}>
							{common('close')}
						</button>
						{state.sending ? (
							<button type="button" onClick={state.stop} className={BUTTON}>
								{t('stop')}
							</button>
						) : null}
						<button
							type="submit"
							form={formId}
							disabled={state.sending || state.loadingKey}
							className="inline-flex items-center gap-2 rounded-lg bg-gray-900 px-4 py-2 text-sm font-medium text-white hover:bg-gray-800 disabled:opacity-50"
						>
							{state.sending ? <ArrowPathIcon aria-hidden="true" className="h-4 w-4 animate-spin" /> : null}
							{state.sending ? t('sending') : t('send')}
						</button>
					</div>
				</div>
			}
		>
			<div className="grid min-w-0 gap-5 lg:grid-cols-[minmax(0,0.85fr)_minmax(0,1.15fr)]">
				<div className="min-w-0 space-y-4">
					<form
						id={formId}
						noValidate
						onSubmit={(event) => {
							event.preventDefault();
							void state.send();
						}}
					>
						<fieldset disabled={state.sending} className="space-y-4">
							<label className="block text-sm font-medium text-gray-700">
								{t('proxyUrl')}
								<input
									type="url"
									aria-label={t('proxyUrl')}
									aria-describedby={`${formId}-proxy-hint`}
									value={state.baseUrl}
									placeholder="https://proxy.example.com"
									onChange={(event) => state.setBaseUrl(event.target.value)}
									className={INPUT}
								/>
								<span
									id={`${formId}-proxy-hint`}
									className="mt-1.5 block text-xs font-normal leading-5 text-gray-500"
								>
									{t('proxyHint')}
								</span>
							</label>
							<div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-1 xl:grid-cols-2">
								<label className="block text-sm font-medium text-gray-700">
									{t('scope')}
									<select
										aria-label={t('scope')}
										value={state.slug}
										onChange={(event) => state.setSlug(event.target.value)}
										className={INPUT}
									>
										<option value="">{t('allServices')}</option>
										{servers.map((server) => (
											<option key={server.id} value={server.slug}>
												{server.name} ({server.slug}){server.status !== 'active' ? ` · ${t('disabled')}` : ''}
											</option>
										))}
									</select>
								</label>
								<label className="block text-sm font-medium text-gray-700">
									{t('method')}
									<select
										aria-label={t('method')}
										value={state.method}
										onChange={(event) => state.setMethod(event.target.value as McpCatalogMethod)}
										className={INPUT}
									>
										{MCP_CATALOG_METHODS.map((method) => (
											<option key={method} value={method}>
												{method}
											</option>
										))}
									</select>
								</label>
							</div>
							<div>
								<label htmlFor={`${formId}-key`} className="text-sm font-medium text-gray-700">
									{t('apiKey')}
								</label>
								<div className="relative">
									<input
										id={`${formId}-key`}
										type={state.visibleKey ? 'text' : 'password'}
										value={state.apiKey}
										disabled={state.loadingKey}
										autoComplete="off"
										spellCheck={false}
										onChange={(event) => state.setApiKey(event.target.value)}
										className={`${INPUT} pr-11`}
									/>
									<button
										type="button"
										aria-label={state.visibleKey ? t('hideKey') : t('showKey')}
										aria-pressed={state.visibleKey}
										onClick={() => state.setVisibleKey(!state.visibleKey)}
										className="absolute inset-y-0 right-0 px-3 text-gray-400 hover:text-gray-700"
									>
										{state.visibleKey ? (
											<EyeSlashIcon aria-hidden="true" className="h-4 w-4" />
										) : (
											<EyeIcon aria-hidden="true" className="h-4 w-4" />
										)}
									</button>
								</div>
								<p className="mt-1.5 text-xs leading-5 text-gray-500">{t('keyHint')}</p>
							</div>
							<details
								onToggle={(event) => {
									if (event.currentTarget.open && !state.keysLoaded && !state.loadingKeys)
										void state.loadKeys();
								}}
								className="rounded-lg border border-gray-200 p-3"
							>
								<summary className="cursor-pointer text-xs font-medium text-gray-700">
									{t('existingKey')}
								</summary>
								<div className="mt-3 space-y-3">
									<div className="flex items-end gap-2">
										<label className="min-w-0 flex-1 text-xs text-gray-600">
											{t('keyFilter')}
											<input
												type="search"
												value={state.keyFilter}
												onChange={(event) => state.setKeyFilter(event.target.value)}
												className={INPUT}
											/>
										</label>
										<button
											type="button"
											disabled={state.loadingKeys}
											onClick={() => void state.loadKeys()}
											className={BUTTON}
										>
											{state.loadingKeys ? common('loading') : t('loadKeys')}
										</button>
									</div>
									<label className="block text-xs text-gray-600">
										{t('selectKey')}
										<select
											aria-label={t('selectKey')}
											value={state.selectedKeyId}
											disabled={state.loadingKeys}
											onChange={(event) => void state.selectKey(event.target.value)}
											className={INPUT}
										>
											<option value="">{t('selectKeyPlaceholder')}</option>
											{state.keys.map((key) => (
												<option key={key.id} value={key.id} disabled={key.status !== 'active'}>
													{key.name || key.id} · {key.user_email}
													{key.status !== 'active' ? ` · ${t('disabled')}` : ''}
												</option>
											))}
										</select>
									</label>
									{state.loadingKey ? (
										<p role="status" className="text-xs text-gray-500">
											{common('loading')}
										</p>
									) : null}
									{state.keysLoaded && !state.keys.length ? (
										<p className="text-xs text-gray-500">{t('noKeys')}</p>
									) : null}
									{state.keysError ? (
										<p role="alert" className="text-xs text-red-600">
											{state.keysError}
										</p>
									) : null}
									<p className="text-xs text-gray-500">{t('keysHint')}</p>
								</div>
							</details>
							<label className="block text-xs font-medium text-gray-600">
								{t('protocolVersion')}
								<select
									aria-label={t('protocolVersion')}
									value={state.protocolVersion}
									onChange={(event) => state.setProtocolVersion(event.target.value)}
									className={INPUT}
								>
									{MCP_PROTOCOL_VERSIONS.map((version) => (
										<option key={version}>{version}</option>
									))}
								</select>
							</label>
						</fieldset>
					</form>
					<details className="rounded-xl border border-gray-200 p-4">
						<summary className="cursor-pointer text-sm font-medium text-gray-700">{t('request')}</summary>
						<div className="mt-3 space-y-3">
							<p className="break-all font-mono text-xs text-gray-700">POST {state.request.url}</p>
							<pre className={CODE}>
								{JSON.stringify(state.request.headers, null, 2)}
								{'\n\n'}
								{state.request.bodyText}
							</pre>
							<button
								type="button"
								onClick={() => void copy(mcpRequestCurl(state.request))}
								className={BUTTON}
							>
								<ClipboardDocumentIcon aria-hidden="true" className="h-4 w-4" />
								{t('copyCurl')}
							</button>
							<p className="text-xs text-gray-500">{t('curlHint', { keyPlaceholder: '<YOUR_API_KEY>' })}</p>
						</div>
					</details>
				</div>
				<div className="min-w-0 space-y-3 rounded-xl border border-gray-200 p-4">
					<div className="flex flex-wrap items-center justify-between gap-2">
						<h3 className="text-sm font-semibold text-gray-900">{t('response')}</h3>
						<div role="group" aria-label={t('view')} className="inline-flex rounded-lg bg-gray-100 p-1">
							<button
								type="button"
								aria-pressed={rawView}
								onClick={() => state.setView('raw')}
								className={`rounded-md px-3 py-1.5 text-xs font-medium ${
									rawView ? 'bg-white text-gray-900 shadow-sm' : 'text-gray-500'
								}`}
							>
								{t('raw')}
							</button>
							<button
								type="button"
								disabled={!canGroup}
								aria-pressed={!rawView}
								onClick={() => state.setView('grouped')}
								className={`rounded-md px-3 py-1.5 text-xs font-medium disabled:opacity-40 ${
									!rawView ? 'bg-white text-gray-900 shadow-sm' : 'text-gray-500'
								}`}
							>
								{t('grouped')}
							</button>
						</div>
					</div>
					{state.error ? (
						<p role="alert" className="rounded-lg bg-red-50 p-3 text-sm leading-6 text-red-700">
							{state.error}
						</p>
					) : null}
					{state.sending ? (
						<div role="status" className="flex items-center justify-center gap-2 py-24 text-sm text-gray-500">
							<ArrowPathIcon aria-hidden="true" className="h-5 w-5 animate-spin" />
							{t('sending')}
						</div>
					) : response ? (
						<>
							<div className="flex flex-wrap items-center gap-2 text-xs text-gray-500">
								<span
									className={`rounded-full px-2.5 py-1 font-medium ${
										response.ok ? 'bg-emerald-50 text-emerald-700' : 'bg-red-50 text-red-700'
									}`}
								>
									HTTP {response.status}
								</span>
								<span>{response.elapsedMs} ms</span>
								{response.parsed.entries !== null ? (
									<span>{t('itemCount', { count: response.parsed.entries.length })}</span>
								) : null}
								<button
									type="button"
									onClick={() => void copy(raw)}
									className="ml-auto inline-flex items-center gap-1 font-medium text-blue-600"
								>
									<ClipboardDocumentIcon aria-hidden="true" className="h-4 w-4" />
									{t('copyResponse')}
								</button>
							</div>
							<p className="break-all font-mono text-xs text-gray-500">POST {response.request.url}</p>
							{rawView ? (
								<pre aria-label={t('raw')} className={CODE}>
									{raw || t('emptyBody')}
								</pre>
							) : (
								<CatalogGroups key={response.receivedAt} response={response} servers={servers} />
							)}
							<details>
								<summary className="cursor-pointer text-xs font-medium text-gray-500">
									{t('responseHeaders')}
								</summary>
								<pre className={`${CODE} mt-2`}>{JSON.stringify(response.headers, null, 2)}</pre>
							</details>
						</>
					) : (
						<div className="px-2 py-16 text-center text-sm leading-7 text-gray-500">{t('beforeSend')}</div>
					)}
					<p className="text-xs leading-5 text-gray-500">{t('groupHint')}</p>
				</div>
			</div>
		</McpDialog>
	);
}
