'use client';

import { useTranslations } from 'next-intl';
import { useGatewayDateTime } from '@/lib/use-gateway-datetime';
import type { ServerSummary } from '../mcp-types';

function priceSummary(server: ServerSummary): string {
	return `S ${server.standard} · C ${server.charged} · M ${server.metered}`;
}

export function McpServerTable({
	servers,
	busy,
	onOpen,
	onSync,
	onEdit,
}: {
	servers: ServerSummary[];
	busy: boolean;
	onOpen: (id: string) => void;
	onSync: (id: string) => void;
	onEdit: (server: ServerSummary) => void;
}) {
	const t = useTranslations('mcp');
	const { formatDateTime } = useGatewayDateTime();

	return (
		<div className="overflow-hidden rounded-lg border border-gray-200 bg-white shadow-sm">
			<div className="overflow-x-auto">
				<table className="min-w-full divide-y divide-gray-200 text-sm">
					<thead className="bg-gray-50">
						<tr>
							<th className="px-4 py-3 text-left font-medium text-gray-600">{t('name')}</th>
							<th className="px-4 py-3 text-left font-medium text-gray-600">{t('status')}</th>
							<th className="px-4 py-3 text-left font-medium text-gray-600">{t('catalog')}</th>
							<th className="px-4 py-3 text-left font-medium text-gray-600">{t('defaultPrices')}</th>
							<th className="px-4 py-3 text-left font-medium text-gray-600">{t('lastSync')}</th>
							<th className="px-4 py-3 text-right font-medium text-gray-600">{t('actions')}</th>
						</tr>
					</thead>
					<tbody className="divide-y divide-gray-100">
						{servers.length === 0 ? (
							<tr>
								<td className="px-4 py-10 text-center text-sm text-gray-500" colSpan={6}>{t('empty')}</td>
							</tr>
						) : servers.map((server) => (
							<tr key={server.id} className="cursor-pointer hover:bg-gray-50" onClick={() => onOpen(server.id)}>
								<td className="px-4 py-3">
									<div className="font-medium text-gray-900">{server.name}</div>
									<div className="font-mono text-xs text-gray-500">{server.slug}</div>
									<div className="max-w-xs truncate text-xs text-gray-400" title={server.urlMasked}>{server.urlMasked}</div>
								</td>
								<td className="px-4 py-3">
									<span className={server.status === 'active'
										? 'inline-flex rounded-full bg-emerald-50 px-2 py-0.5 text-xs font-medium text-emerald-800 ring-1 ring-emerald-200'
										: 'inline-flex rounded-full bg-gray-100 px-2 py-0.5 text-xs font-medium text-gray-600 ring-1 ring-gray-200'}>
										{server.status === 'active' ? t('active') : t('disabled')}
									</span>
								</td>
								<td className="px-4 py-3 text-gray-700">
									<div>{t('enabledCount')} {server.enabledCount}</div>
									{server.pendingCount > 0 ? (
										<span className="mt-1 inline-flex rounded-full bg-amber-50 px-2 py-0.5 text-xs font-medium text-amber-800 ring-1 ring-amber-200">
											{t('pendingBadge', { count: server.pendingCount })}
										</span>
									) : null}
								</td>
								<td className="px-4 py-3 font-mono text-xs text-gray-600">{priceSummary(server)}</td>
								<td className="px-4 py-3 text-gray-700">
									{server.lastSyncedAt ? formatDateTime(server.lastSyncedAt) : t('neverSynced')}
									{server.lastSyncError ? <div className="max-w-xs truncate text-xs text-red-600" title={server.lastSyncError}>{server.lastSyncError}</div> : null}
								</td>
								<td className="px-4 py-3 text-right" onClick={(event) => event.stopPropagation()}>
									<div className="flex justify-end gap-2">
										<button type="button" disabled={busy} className="rounded-md border border-gray-200 bg-white px-2.5 py-1 text-xs font-medium text-gray-700 shadow-sm hover:bg-gray-50 disabled:opacity-50" onClick={() => onSync(server.id)}>
											{t('sync')}
										</button>
										<button type="button" disabled={busy} className="rounded-md border border-gray-200 bg-white px-2.5 py-1 text-xs font-medium text-gray-700 shadow-sm hover:bg-gray-50 disabled:opacity-50" onClick={() => onEdit(server)}>
											{t('edit')}
										</button>
									</div>
								</td>
							</tr>
						))}
					</tbody>
				</table>
			</div>
		</div>
	);
}
