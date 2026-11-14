'use client';

import { useState } from 'react';
import { ArrowPathIcon, MagnifyingGlassIcon, PlusIcon, ServerStackIcon } from '@heroicons/react/24/outline';
import { useTranslations } from 'next-intl';
import { useProxyBaseUrl } from '@/components/proxy-connection-provider';
import { mcpConnectEndpoint } from '../mcp-connect-guide-utils';
import type { ServerSummary } from '../mcp-types';

export function McpServerDirectory({
	servers,
	selectedId,
	busy,
	loading,
	error,
	onCreate,
	onSelect,
	onRefresh,
}: {
	servers: ServerSummary[];
	selectedId: string | null;
	busy: boolean;
	loading: boolean;
	error: boolean;
	onCreate: () => void;
	onSelect: (id: string) => void;
	onRefresh: () => void;
}) {
	const t = useTranslations('mcp');
	const proxyBaseUrl = useProxyBaseUrl().url;
	const common = useTranslations('common');
	const [query, setQuery] = useState('');
	const [filter, setFilter] = useState('all');
	const search = query.trim().toLocaleLowerCase();
	const visible = servers.filter(
		(server) =>
			(!search ||
				[
					server.name,
					server.slug,
					server.description,
					server.urlMasked,
					mcpConnectEndpoint(proxyBaseUrl, server.slug),
				].some((text) => text?.toLocaleLowerCase().includes(search))) &&
			(filter === 'all' ||
				(filter === 'pending'
					? server.pendingCount > 0
					: filter === 'error'
					? !!server.lastSyncError
					: server.status === filter))
	);
	return (
		<aside className="min-w-0 space-y-3 xl:sticky xl:top-0" aria-label={t('workspace.directory')}>
			<div className="flex items-center justify-between gap-2">
				<h2 className="text-sm font-medium text-gray-900">{t('workspace.directory')}</h2>
				<div className="flex items-center gap-2">
					<span className="font-mono text-xs text-gray-400">{servers.length}</span>
					<button
						type="button"
						disabled={busy || loading}
						onClick={onRefresh}
						aria-label={t('refresh')}
						title={t('refresh')}
						className="rounded-lg p-2 text-gray-500 hover:bg-white disabled:opacity-40"
					>
						<ArrowPathIcon className={`h-4 w-4 ${loading ? 'animate-spin' : ''}`} aria-hidden="true" />
					</button>
				</div>
			</div>
			<div className="relative">
				<MagnifyingGlassIcon
					className="pointer-events-none absolute left-3 top-3 h-4 w-4 text-gray-400"
					aria-hidden="true"
				/>
				<input
					type="search"
					value={query}
					onChange={(e) => setQuery(e.target.value)}
					placeholder={t('workspace.search')}
					aria-label={t('searchServers')}
					className="h-10 w-full rounded-lg border border-gray-200 bg-white pl-9 pr-3 text-xs focus:border-gray-500 focus:outline-none focus:ring-2 focus:ring-gray-100"
				/>
			</div>
			<select
				value={filter}
				onChange={(e) => setFilter(e.target.value)}
				aria-label={t('filterServers')}
				className="h-9 w-full rounded-lg border border-gray-200 bg-white px-3 text-xs text-gray-600"
			>
				{(['all', 'active', 'pending', 'error', 'disabled'] as const).map((key) => (
					<option key={key} value={key}>
						{t(key === 'all' ? 'allServers' : key === 'pending' ? 'pendingCount' : key === 'error' ? 'syncError' : key)}
					</option>
				))}
			</select>
			{error ? (
				<div role="alert" className="rounded-lg bg-red-50 p-3 text-xs text-red-700">
					<p>{t('loadFailed')}</p>
					<button type="button" disabled={loading} onClick={onRefresh} className="mt-2 underline">
						{t('retry')}
					</button>
				</div>
			) : null}
			<div
				role="group"
				aria-label={t('workspace.selectService')}
				className="grid max-h-96 grid-cols-1 gap-2 overflow-y-auto sm:grid-cols-2 xl:max-h-[calc(100dvh-340px)] xl:grid-cols-1"
			>
				<button
					type="button"
					disabled={busy}
					onClick={onCreate}
					className="flex min-h-16 min-w-0 items-center gap-3 rounded-xl border border-dashed border-gray-300 bg-white/60 p-3 text-left text-gray-600 transition-colors hover:border-gray-400 hover:bg-white hover:text-gray-950 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-gray-500 disabled:opacity-50"
				>
					<span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-gray-100">
						<PlusIcon className="h-4 w-4" aria-hidden="true" />
					</span>
					<span className="text-sm font-medium">{t('add')}</span>
				</button>
				{loading && !servers.length ? (
					<p role="status" className="py-6 text-xs text-gray-500">
						{common('loading')}
					</p>
				) : null}
				{visible.map((server) => (
					<button
						key={server.id}
						type="button"
						disabled={busy}
						aria-pressed={selectedId === server.id}
						onClick={() => onSelect(server.id)}
						className={`flex min-w-0 items-start gap-2 rounded-xl border p-3 text-left transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-gray-500 disabled:opacity-50 ${
							selectedId === server.id ? 'border-gray-300 bg-white shadow-sm' : 'border-transparent hover:bg-white/70'
						}`}
					>
						<span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-teal-50 text-teal-700">
							<ServerStackIcon className="h-4 w-4" aria-hidden="true" />
						</span>
						<span className="min-w-0 flex-1">
							<span className="block truncate text-sm font-medium text-gray-900" title={server.name}>
								{server.name}
							</span>
							<span className="mt-0.5 block truncate font-mono text-xs text-gray-400">{server.slug}</span>
							<span
								className={`mt-2 flex flex-wrap items-center gap-1.5 text-xs ${
									server.status === 'active' ? 'text-emerald-700' : 'text-gray-500'
								}`}
							>
								<span
									className={`h-1.5 w-1.5 rounded-full ${
										server.status === 'active' ? 'bg-emerald-500' : 'bg-gray-300'
									}`}
									aria-hidden="true"
								/>
								{t(server.status === 'active' ? 'active' : 'disabled')}
								<span className="text-gray-400">
									· {server.enabledCount} {t('enabled')}
								</span>
							</span>
							{server.lastSyncError ? (
								<span className="mt-1 block text-xs text-red-600">{t('syncError')}</span>
							) : server.pendingCount ? (
								<span className="mt-1 block text-xs text-amber-700">
									{t('pendingBadge', { count: server.pendingCount })}
								</span>
							) : null}
						</span>
					</button>
				))}
			</div>
			{!visible.length && !loading && !error ? (
				<div className="py-5 text-xs text-gray-500">
					<p>{t(servers.length ? 'noResults' : 'empty')}</p>
					{servers.length ? (
						<button
							type="button"
							onClick={() => {
								setQuery('');
								setFilter('all');
							}}
							className="mt-2 text-gray-900 underline"
						>
							{t('clearFilters')}
						</button>
					) : null}
				</div>
			) : null}
		</aside>
	);
}
