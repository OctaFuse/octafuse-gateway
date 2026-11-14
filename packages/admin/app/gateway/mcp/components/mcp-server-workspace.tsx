'use client';

import { useState } from 'react';
import { useFeedback } from '@/components/feedback';
import Link from 'next/link';
import {
	ArrowPathIcon,
	MagnifyingGlassIcon,
	PencilSquareIcon,
	SignalIcon,
	CheckCircleIcon,
	ExclamationTriangleIcon,
	ClipboardDocumentIcon,
	ClockIcon,
	LinkIcon,
	ServerStackIcon,
} from '@heroicons/react/24/outline';
import { getGatewayCurrencySymbol } from '@/lib/format-gateway-currency';
import { useTranslations } from 'next-intl';
import { useGatewayDateTime } from '@/lib/use-gateway-datetime';
import { mcpConnectEndpoint } from '../mcp-connect-guide-utils';
import type { CatalogItem, ServerDetail } from '../mcp-types';
import { McpCatalogItemRow } from './mcp-catalog-item-row';
import type { McpWorkspaceView } from '../mcp-workspace-location';
import { McpPricingDetails } from './mcp-pricing-editor';

const TABS = ['tool', 'prompt', 'resource'] as const;
const BUTTON =
	'inline-flex items-center justify-center gap-2 rounded-lg border border-gray-200 bg-white px-3 py-2 text-xs font-medium text-gray-700 hover:bg-gray-50 disabled:opacity-50';

export function McpServerWorkspace({
	section,
	onSection,
	proxyBaseUrl,
	currency,
	detail,
	loading,
	error,
	tab,
	busy,
	action,
	revealed,
	testResult,
	onTab,
	onRetry,
	onEdit,
	onToggleServer,
	onTest,
	onCatalogTest,
	onConnectGuide,
	onSync,
	onReveal,
	onSetItemStatus,
	onAccept,
	onSavePricing,
	onDelete,
}: {
	section: McpWorkspaceView;
	onSection: (section: McpWorkspaceView) => void;
	proxyBaseUrl: string;
	currency: string;
	detail: ServerDetail | null;
	loading: boolean;
	error: boolean;
	tab: CatalogItem['kind'];
	busy: boolean;
	action: string | null;
	revealed: { url: string; authHeaders: Record<string, string> } | null;
	testResult: { ok: boolean; message: string } | null;
	onTab: (tab: CatalogItem['kind']) => void;
	onRetry: () => void;
	onEdit: () => void;
	onToggleServer: () => void;
	onTest: () => void;
	onCatalogTest: () => void;
	onConnectGuide: () => void;
	onSync: () => void;
	onReveal: () => void;
	onSetItemStatus: (ids: string[], status: 'enabled' | 'disabled') => Promise<boolean>;
	onAccept: (id: string) => void;
	onSavePricing: (item: CatalogItem, pricing: Record<string, unknown> | null) => Promise<boolean>;
	onDelete: () => void;
}) {
	const t = useTranslations('mcp');
	const common = useTranslations('common');
	const { formatDateTime } = useGatewayDateTime();
	const setSection = onSection;
	const { notify } = useFeedback();
	const [query, setQuery] = useState('');
	const [filter, setFilter] = useState('all');
	const [selection, setSelection] = useState<Set<string>>(new Set());
	const server = detail?.server;
	const items = detail?.items.filter((item) => item.kind === tab) ?? [];
	const search = query.trim().toLocaleLowerCase();
	const visible = items.filter((item) => {
		const matches =
			!search ||
			[item.upstreamKey, item.exposedName, item.definition?.description, item.definition?.title].some((text) =>
				text?.toLocaleLowerCase().includes(search)
			);
		return (
			matches &&
			(filter === 'all'
				? item.status !== 'removed'
				: filter === 'pending'
				? item.reviewState !== 'none' && item.status !== 'removed'
				: item.status === filter)
		);
	});
	const selectable = visible.filter((item) => item.status !== 'removed');
	const selectedItems = selectable.filter((item) => selection.has(item.id));
	const newIds = items
		.filter((item) => item.reviewState === 'new' && item.status === 'disabled')
		.map((item) => item.id);
	const pendingCount =
		detail?.items.filter((item) => item.reviewState !== 'none' && item.status !== 'removed').length ?? 0;
	const allSelected = selectable.length > 0 && selectedItems.length === selectable.length;
	async function applyStatus(ids: string[], status: 'enabled' | 'disabled') {
		if (await onSetItemStatus(ids, status)) setSelection(new Set());
	}

	return (
		<div className="min-w-0 space-y-4" aria-busy={loading || busy}>
			{loading && !detail ? (
				<div role="status" className="flex items-center justify-center gap-2 py-24 text-sm text-gray-500">
					<ArrowPathIcon className="h-5 w-5 animate-spin" aria-hidden="true" />
					{common('loading')}
				</div>
			) : null}
			{error ? (
				<div role="alert" className="mb-4 rounded-lg border border-red-100 bg-red-50 p-4 text-sm text-red-700">
					<p>{t('loadFailed')}</p>
					<button
						type="button"
						disabled={loading || busy}
						onClick={onRetry}
						className="mt-2 font-medium underline disabled:opacity-50"
					>
						{t('retry')}
					</button>
				</div>
			) : null}
			{server && detail ? (
				<div className="min-w-0 space-y-4">
					<header className="admin-content-panel space-y-4 rounded-xl border border-gray-200 bg-white p-4 sm:p-5">
						<div className="flex flex-wrap items-start justify-between gap-3">
							<div className="flex min-w-0 items-start gap-3">
								<span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-teal-50 text-teal-700">
									<ServerStackIcon className="h-5 w-5" aria-hidden="true" />
								</span>
								<div className="min-w-0">
									<h2 className="break-words text-base font-medium text-gray-950">{server.name}</h2>
									<p className="mt-1 break-all font-mono text-xs text-gray-400">{server.slug}</p>
								</div>
							</div>
							<div className="flex flex-wrap items-center gap-2">
								<Link
									href={`/gateway/tools/invocations?source=mcp&server=${encodeURIComponent(server.slug)}`}
									className={BUTTON}
								>
									<ClockIcon className="h-4 w-4" aria-hidden="true" />
									{t('ui.invocations')}
								</Link>
								<button type="button" onClick={onConnectGuide} className={BUTTON}>
									<LinkIcon className="h-4 w-4" aria-hidden="true" />
									{t('connectGuide.button')}
								</button>
								<button type="button" disabled={busy} onClick={onCatalogTest} className={BUTTON}>
									{t('catalogTest.title')}
								</button>
								<button type="button" disabled={busy} onClick={onEdit} className={BUTTON}>
									<PencilSquareIcon className="h-4 w-4" aria-hidden="true" />
									{t('edit')}
								</button>
							</div>
						</div>
						{server.description ? (
							<p className="whitespace-pre-wrap break-words text-sm leading-6 text-gray-500">{server.description}</p>
						) : null}
						<div className="flex min-w-0 flex-wrap items-center gap-2 rounded-lg bg-gray-50 px-3 py-2.5">
							<span className="text-xs text-gray-500">{t('clientEndpoint')}</span>
							<code className="min-w-0 flex-1 break-all font-mono text-xs leading-5 text-gray-900">
								{mcpConnectEndpoint(proxyBaseUrl, server.slug)}
							</code>
							<button
								type="button"
								aria-label={t('workspace.copyEndpoint')}
								title={t('workspace.copyEndpoint')}
								onClick={async () => {
									try {
										await navigator.clipboard.writeText(mcpConnectEndpoint(proxyBaseUrl, server.slug));
										notify('success', t('connectGuide.copied'));
									} catch {
										notify('error', t('connectGuide.copyFailed'));
									}
								}}
								className="rounded-md p-1.5 text-gray-500 hover:bg-gray-200"
							>
								<ClipboardDocumentIcon className="h-4 w-4" aria-hidden="true" />
							</button>
						</div>
						<div className="flex flex-wrap items-center justify-between gap-3 border-t border-gray-100 pt-3">
							<div className="flex flex-wrap items-center gap-x-4 gap-y-2 text-xs text-gray-500">
								<button
									type="button"
									role="switch"
									aria-label={t('toggleServer')}
									aria-checked={server.status === 'active'}
									disabled={busy}
									onClick={onToggleServer}
									className="inline-flex items-center gap-2 disabled:opacity-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-gray-500"
								>
									<span
										className={`relative h-5 w-9 rounded-full ${
											server.status === 'active' ? 'bg-gray-900' : 'bg-gray-300'
										}`}
									>
										<span
											className={`absolute left-0.5 top-0.5 h-4 w-4 rounded-full bg-white transition-transform ${
												server.status === 'active' ? 'translate-x-4' : ''
											}`}
										/>
									</span>
									{t(server.status === 'active' ? 'active' : 'disabled')}
								</button>
								<span>
									{t('enabledCount')}{' '}
									<span className="font-mono text-gray-900">
										{detail.items.filter((item) => item.status === 'enabled').length}
									</span>
								</span>
								{pendingCount ? (
									<span className="text-amber-700">{t('pendingBadge', { count: pendingCount })}</span>
								) : null}
								<span>
									{t('lastSync')} · {server.lastSyncedAt ? formatDateTime(server.lastSyncedAt) : t('neverSynced')}
								</span>
							</div>
							<button
								type="button"
								disabled={busy}
								onClick={onSync}
								className={`${BUTTON} !border-gray-900 !bg-gray-900 !text-white hover:!bg-gray-800`}
							>
								<ArrowPathIcon
									className={`h-4 w-4 ${action?.startsWith('sync:') ? 'animate-spin' : ''}`}
									aria-hidden="true"
								/>
								{t(action?.startsWith('sync:') ? 'syncing' : 'syncCatalog')}
							</button>
						</div>
					</header>
					{server.status === 'disabled' ? (
						<p className="rounded-lg border border-gray-200 bg-gray-50 px-4 py-3 text-xs leading-5 text-gray-600">
							{t('disabledHint')}
						</p>
					) : null}
					{server.lastSyncError ? (
						<div role="alert" className="rounded-lg border border-red-100 bg-red-50 p-4">
							<p className="flex items-center gap-2 text-sm font-medium text-red-700">
								<ExclamationTriangleIcon className="h-4 w-4" aria-hidden="true" />
								{t('syncError')}
							</p>
							<p className="mt-2 whitespace-pre-wrap break-words text-xs leading-5 text-red-600">
								{server.lastSyncError}
							</p>
							<button
								type="button"
								disabled={busy}
								onClick={() => setSection('connection')}
								className="mt-2 text-xs font-medium text-red-700 underline"
							>
								{t('checkConnection')}
							</button>
						</div>
					) : null}
					{testResult ? (
						<div
							role="status"
							className={`flex items-start gap-2 rounded-lg border p-3 text-sm ${
								testResult.ok
									? 'border-emerald-100 bg-emerald-50 text-emerald-700'
									: 'border-red-100 bg-red-50 text-red-700'
							}`}
						>
							{testResult.ok ? (
								<CheckCircleIcon className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
							) : (
								<ExclamationTriangleIcon className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
							)}
							<p className="whitespace-pre-wrap break-words">{testResult.message}</p>
						</div>
					) : null}
					<section className="admin-content-panel min-w-0 overflow-hidden rounded-xl border border-gray-200 bg-white">
						<div
							className="flex flex-wrap gap-5 border-b border-gray-100 px-4 sm:px-5"
							role="group"
							aria-label={t('manageSections')}
						>
							{(['catalog', 'connection'] as const).map((key) => (
								<button
									key={key}
									type="button"
									aria-pressed={section === key}
									onClick={() => setSection(key)}
									className={`border-b-2 py-3 text-sm font-medium focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-gray-500 ${
										section === key
											? 'border-gray-900 text-gray-900'
											: 'border-transparent text-gray-500 hover:text-gray-900'
									}`}
								>
									{t(key === 'catalog' ? 'workspace.catalogPricing' : 'connectionSettings')}
								</button>
							))}
						</div>
						<div className="min-w-0 p-4 sm:p-5">
							{section === 'connection' ? (
								<div className="grid gap-6 lg:grid-cols-2">
									<section>
										<div className="flex items-center justify-between">
											<h3 className="text-sm font-medium text-gray-900">{t('connectionSettings')}</h3>
											<button type="button" disabled={busy} onClick={onTest} className={BUTTON}>
												<SignalIcon className="h-4 w-4" aria-hidden="true" />
												{t(action?.startsWith('test:') ? 'testing' : 'test')}
											</button>
										</div>
										<dl className="mt-4 space-y-4 text-sm">
											<div>
												<dt className="text-xs text-gray-500">{t('url')}</dt>
												<dd className="mt-1 break-all font-mono text-xs leading-6 text-gray-700">
													{revealed?.url ?? server.urlMasked}
												</dd>
											</div>
											<div>
												<dt className="text-xs text-gray-500">{t('headers')}</dt>
												<dd className="mt-1 break-all font-mono text-xs text-gray-700">
													{server.authHeaderNames.length ? server.authHeaderNames.join(', ') : t('noAuthHeaders')}
												</dd>
											</div>
											<div className="grid grid-cols-2 gap-4">
												<div>
													<dt className="text-xs text-gray-500">{t('timeout')}</dt>
													<dd className="mt-1 font-mono text-xs text-gray-700">{server.timeoutMs.toLocaleString()}</dd>
												</div>
												<div>
													<dt className="text-xs text-gray-500">{t('maxBytes')}</dt>
													<dd className="mt-1 font-mono text-xs text-gray-700">
														{server.maxResponseBytes.toLocaleString()}
													</dd>
												</div>
											</div>
										</dl>
										<button
											type="button"
											disabled={busy}
											onClick={onReveal}
											className="mt-4 text-xs font-medium text-gray-800 hover:underline disabled:opacity-50"
										>
											{t(revealed ? 'hide' : 'reveal')}
										</button>
										{revealed ? (
											<pre className="mt-3 overflow-auto rounded-lg bg-gray-50 p-3 font-mono text-xs text-gray-700">
												{JSON.stringify(revealed.authHeaders, null, 2)}
											</pre>
										) : null}
									</section>
									<section className="border-t border-gray-100 pt-6 lg:border-l lg:border-t-0 lg:pl-6 lg:pt-0">
										<h3 className="text-sm font-medium text-gray-900">
											{t('defaultPrices')} · {getGatewayCurrencySymbol(currency)}
										</h3>
										<p className="mt-1 text-xs leading-5 text-gray-400">{t('defaultPriceHint')}</p>
										{server.pricing ? (
											<McpPricingDetails rule={server.pricing} currency={currency} />
										) : (
											<p role="alert" className="mt-4 rounded-lg bg-red-50 p-3 text-xs text-red-700">
												{t('pricing.invalidStored')}
											</p>
										)}
									</section>
									<div className="flex flex-wrap items-center justify-between gap-3 border-t border-gray-100 pt-4 lg:col-span-2">
										<button type="button" disabled={busy} onClick={onEdit} className={BUTTON}>
											{t('editSettings')}
										</button>
										<button
											type="button"
											disabled={busy}
											onClick={onDelete}
											className="rounded-lg px-3 py-2 text-xs text-red-600 hover:bg-red-50 disabled:opacity-50"
										>
											{t('deleteServer')}
										</button>
									</div>
								</div>
							) : (
								<section>
									{pendingCount > 0 ? (
										<div className="mb-4 rounded-lg border border-amber-100 bg-amber-50 px-4 py-3 text-xs leading-5 text-amber-800">
											{t('reviewHint')}
										</div>
									) : null}
									<div className="mb-4 flex flex-wrap gap-2" role="group" aria-label={t('catalogKinds')}>
										{TABS.map((kind) => (
											<button
												key={kind}
												type="button"
												aria-pressed={tab === kind}
												onClick={() => {
													onTab(kind);
													setQuery('');
													setFilter('all');
													setSelection(new Set());
												}}
												className={`inline-flex items-center gap-2 rounded-lg px-3 py-2 text-sm font-medium ${
													tab === kind ? 'bg-gray-900 text-white' : 'bg-gray-100 text-gray-500 hover:bg-gray-200'
												}`}
											>
												{t(kind === 'tool' ? 'tools' : kind === 'prompt' ? 'prompts' : 'resources')}
												<span className="text-xs tabular-nums opacity-70">
													{detail.items.filter((item) => item.kind === kind && item.status !== 'removed').length}
												</span>
											</button>
										))}
									</div>
									<div className="mb-3 flex gap-2">
										<div className="relative min-w-0 flex-1">
											<MagnifyingGlassIcon
												className="pointer-events-none absolute left-3 top-2.5 h-4 w-4 text-gray-400"
												aria-hidden="true"
											/>
											<input
												type="search"
												aria-label={t('searchItems')}
												placeholder={t('searchItems')}
												value={query}
												onChange={(e) => {
													setQuery(e.target.value);
													setSelection(new Set());
												}}
												className="w-full rounded-lg border border-gray-200 py-2 pl-9 pr-3 text-sm focus:border-gray-500 focus:outline-none focus:ring-2 focus:ring-gray-100"
											/>
										</div>
										<select
											value={filter}
											aria-label={t('filterItems')}
											onChange={(e) => {
												setFilter(e.target.value);
												setSelection(new Set());
											}}
											className="max-w-[45%] rounded-lg border border-gray-200 bg-white px-2 py-2 text-sm text-gray-600"
										>
											{['all', 'pending', 'enabled', 'disabled', 'removed'].map((key) => (
												<option key={key} value={key}>
													{t(key === 'all' ? 'currentItems' : key === 'pending' ? 'pendingCount' : key)}
												</option>
											))}
										</select>
									</div>
									<div className="mb-4 flex flex-wrap items-center justify-between gap-2 rounded-lg bg-gray-50/60 px-3 py-2">
										<label className="inline-flex items-center gap-2 text-xs text-gray-500">
											<input
												type="checkbox"
												checked={allSelected}
												ref={(node) => {
													if (node) node.indeterminate = selectedItems.length > 0 && !allSelected;
												}}
												disabled={busy || selectable.length === 0}
												onChange={(e) =>
													setSelection(e.target.checked ? new Set(selectable.map((item) => item.id)) : new Set())
												}
												className="h-4 w-4 rounded accent-gray-950"
											/>
											{selectedItems.length ? t('selectedCount', { count: selectedItems.length }) : t('selectVisible')}
										</label>
										{selectedItems.length ? (
											<div className="flex gap-3">
												<button
													type="button"
													disabled={busy || !selectedItems.some((i) => i.status === 'disabled')}
													onClick={() =>
														void applyStatus(
															selectedItems.filter((i) => i.status === 'disabled').map((i) => i.id),
															'enabled'
														)
													}
													className="text-xs font-medium text-gray-800 hover:underline disabled:text-gray-400"
												>
													{t('enable')}
												</button>
												<button
													type="button"
													disabled={busy || !selectedItems.some((i) => i.status === 'enabled')}
													onClick={() =>
														void applyStatus(
															selectedItems.filter((i) => i.status === 'enabled').map((i) => i.id),
															'disabled'
														)
													}
													className="text-xs font-medium text-gray-600 hover:underline disabled:text-gray-400"
												>
													{t('disable')}
												</button>
											</div>
										) : newIds.length ? (
											<button
												type="button"
												disabled={busy}
												onClick={() => void applyStatus(newIds, 'enabled')}
												className="text-xs font-medium text-gray-800 hover:underline disabled:opacity-50"
											>
												{t('enableNewCount', { count: newIds.length })}
											</button>
										) : (
											<span className="text-xs text-gray-500">{t('itemCount', { count: visible.length })}</span>
										)}
									</div>
									{visible.length ? (
										<ul className="divide-y divide-gray-100">
											{visible.map((item) => (
												<McpCatalogItemRow
													currency={currency}
													key={item.id}
													item={item}
													server={server}
													busy={busy}
													selected={selection.has(item.id)}
													onSelect={(checked) =>
														setSelection((current) => {
															const next = new Set(current);
															if (checked) next.add(item.id);
															else next.delete(item.id);
															return next;
														})
													}
													onToggle={(enabled) => void applyStatus([item.id], enabled ? 'enabled' : 'disabled')}
													onAccept={() => onAccept(item.id)}
													onSavePricing={onSavePricing}
												/>
											))}
										</ul>
									) : (
										<div className="rounded-xl border border-dashed border-gray-200 px-4 py-12 text-center">
											<p className="text-sm text-gray-500">{t(items.length ? 'noMatchingItems' : 'noItems')}</p>
											{!items.length ? (
												<button
													type="button"
													disabled={busy}
													onClick={onSync}
													className="mt-3 text-xs font-medium text-gray-800 hover:underline disabled:opacity-50"
												>
													{t('syncCatalog')}
												</button>
											) : (
												<button
													type="button"
													onClick={() => {
														setQuery('');
														setFilter('all');
													}}
													className="mt-3 text-xs font-medium text-gray-800 hover:underline"
												>
													{t('clearFilters')}
												</button>
											)}
										</div>
									)}
								</section>
							)}
						</div>
					</section>
				</div>
			) : null}
		</div>
	);
}
