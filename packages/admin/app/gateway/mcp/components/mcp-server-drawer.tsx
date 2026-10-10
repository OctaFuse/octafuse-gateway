'use client';

import Link from 'next/link';
import { useTranslations } from 'next-intl';
import { ToolProviderDrawer } from '@/app/gateway/tools/components/tool-provider-drawer';
import { MCP_REQUEST_LOG_PROVIDER_ID } from '@/lib/invoke-kind';
import type { CatalogItem, ServerDetail } from '../mcp-types';
import { McpCatalogItemRow } from './mcp-catalog-item-row';

const TABS = ['tool', 'prompt', 'resource'] as const;

export function McpServerDrawer({
	open,
	detail,
	tab,
	busy,
	revealed,
	onTab,
	onClose,
	onToggleServer,
	onTest,
	onSync,
	onReveal,
	onToggleItem,
	onEnableNew,
	onAccept,
	onPatchItem,
	onSavePrice,
	onDelete,
}: {
	open: boolean;
	detail: ServerDetail | null;
	tab: CatalogItem['kind'];
	busy: boolean;
	revealed: { url: string; authHeaders: Record<string, string> } | null;
	onTab: (tab: CatalogItem['kind']) => void;
	onClose: () => void;
	onToggleServer: () => void;
	onTest: () => void;
	onSync: () => void;
	onReveal: () => void;
	onToggleItem: (id: string, enabled: boolean) => void;
	onEnableNew: () => void;
	onAccept: (id: string) => void;
	onPatchItem: (id: string, patch: Partial<CatalogItem>) => void;
	onSavePrice: (item: CatalogItem, clear: boolean) => void;
	onDelete: () => void;
}) {
	const t = useTranslations('mcp');
	const server = detail?.server;
	const items = detail?.items.filter((item) => item.kind === tab) ?? [];
	const counts = {
		tool: detail?.items.filter((item) => item.kind === 'tool').length ?? 0,
		prompt: detail?.items.filter((item) => item.kind === 'prompt').length ?? 0,
		resource: detail?.items.filter((item) => item.kind === 'resource').length ?? 0,
	};
	const newIds = items.filter((item) => item.reviewState === 'new' && item.status === 'disabled').map((item) => item.id);

	return (
		<ToolProviderDrawer
			open={open && detail != null}
			wide
			busy={busy}
			title={server?.name ?? ''}
			onClose={onClose}
			footer={
				<button type="button" disabled={busy} onClick={onDelete} className="rounded-md border border-red-200 bg-white px-3 py-2 text-sm font-medium text-red-700 hover:bg-red-50 disabled:opacity-50">
					{t('deleteServer')}
				</button>
			}
		>
			{server && detail ? (
				<div className="space-y-5">
					<div className="flex flex-wrap items-center justify-between gap-3">
						<div>
							<p className="font-mono text-xs text-gray-500">{server.slug}</p>
							<button
								type="button"
								role="switch"
								aria-checked={server.status === 'active'}
								disabled={busy}
								onClick={onToggleServer}
								className="mt-2 inline-flex items-center gap-2 text-sm text-gray-700"
							>
								<span className={`relative h-6 w-11 rounded-full ${server.status === 'active' ? 'bg-gray-900' : 'bg-gray-300'}`}>
									<span className={`absolute top-0.5 h-5 w-5 rounded-full bg-white transition ${server.status === 'active' ? 'left-5' : 'left-0.5'}`} />
								</span>
								{server.status === 'active' ? t('active') : t('disabled')}
							</button>
						</div>
						<div className="flex flex-wrap gap-2">
							<button type="button" disabled={busy} onClick={onTest} className="rounded-md border border-gray-200 bg-white px-2.5 py-1.5 text-xs font-medium text-gray-700 shadow-sm hover:bg-gray-50 disabled:opacity-50">{t('test')}</button>
							<button type="button" disabled={busy} onClick={onSync} className="rounded-md border border-gray-200 bg-white px-2.5 py-1.5 text-xs font-medium text-gray-700 shadow-sm hover:bg-gray-50 disabled:opacity-50">{t('sync')}</button>
							<Link href={`/gateway/tools/invocations?source=mcp&server=${encodeURIComponent(server.slug)}`} className="rounded-md border border-gray-200 bg-white px-2.5 py-1.5 text-xs font-medium text-gray-700 shadow-sm hover:bg-gray-50">
								{t('viewInvocations')}
							</Link>
						</div>
					</div>
					<section className="rounded-lg border border-gray-200 p-3">
						<h3 className="text-xs font-semibold uppercase tracking-wide text-gray-500">{t('connection')}</h3>
						<dl className="mt-2 space-y-1 text-sm text-gray-700">
							<div className="break-all font-mono text-xs">{revealed?.url ?? server.urlMasked}</div>
							<div>{t('headers')}: {server.authHeaderNames.length ? server.authHeaderNames.join(', ') : '—'}</div>
							<div>{t('timeout')}: {server.timeoutMs} ms · {t('maxBytes')}: {server.maxResponseBytes}</div>
						</dl>
						<button type="button" onClick={onReveal} className="mt-2 text-xs font-medium text-blue-600 hover:underline">
							{revealed ? t('hide') : t('reveal')}
						</button>
						{revealed ? (
							<pre className="mt-2 overflow-auto rounded-md bg-gray-50 p-2 font-mono text-xs text-gray-800">{JSON.stringify(revealed.authHeaders, null, 2)}</pre>
						) : null}
					</section>
					<section>
						<div className="mb-2 flex flex-wrap items-center justify-between gap-2">
							<div className="flex gap-1">
								{TABS.map((kind) => (
									<button
										key={kind}
										type="button"
										onClick={() => onTab(kind)}
										className={`rounded-md px-2.5 py-1 text-xs font-medium ${tab === kind ? 'bg-gray-900 text-white' : 'border border-gray-200 bg-white text-gray-700'}`}
									>
										{t(kind === 'tool' ? 'tools' : kind === 'prompt' ? 'prompts' : 'resources')} {counts[kind]}
									</button>
								))}
							</div>
							<button type="button" disabled={busy || newIds.length === 0} onClick={onEnableNew} className="text-xs font-medium text-blue-600 hover:underline disabled:text-gray-400">
								{t('enableAllNew')}
							</button>
						</div>
						{items.length === 0 ? (
							<p className="rounded-lg border border-dashed border-gray-300 py-8 text-center text-sm text-gray-500">{t('noItems')}</p>
						) : (
							<ul className="divide-y divide-gray-100 rounded-lg border border-gray-200">
								{items.map((item) => (
									<McpCatalogItemRow
										key={item.id}
										item={item}
										server={server}
										busy={busy}
										onToggle={(enabled) => onToggleItem(item.id, enabled)}
										onAccept={() => onAccept(item.id)}
										onPatch={(patch) => onPatchItem(item.id, patch)}
										onSavePrice={(clear) => onSavePrice(item, clear)}
									/>
								))}
							</ul>
						)}
					</section>
					<p className="text-xs text-gray-400">
						<Link className="hover:underline" href={`/gateway/request-logs?provider_id=${MCP_REQUEST_LOG_PROVIDER_ID}`}>{t('logs')}</Link>
					</p>
				</div>
			) : null}
		</ToolProviderDrawer>
	);
}
