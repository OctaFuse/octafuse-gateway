'use client';

import { useState } from 'react';
import { useTranslations } from 'next-intl';
import { ToolPriceTripleInputs } from '@/app/gateway/tools/components/tool-price-triple-inputs';
import type { CatalogItem, ServerDetail } from '../mcp-types';

export function McpCatalogItemRow({
	item,
	server,
	busy,
	onToggle,
	onAccept,
	onPatch,
	onSavePrice,
}: {
	item: CatalogItem;
	server: ServerDetail['server'];
	busy: boolean;
	onToggle: (enabled: boolean) => void;
	onAccept: () => void;
	onPatch: (patch: Partial<CatalogItem>) => void;
	onSavePrice: (clear: boolean) => void;
}) {
	const t = useTranslations('mcp');
	const [pricing, setPricing] = useState(false);
	const effective = {
		metered: item.metered ?? server.metered,
		standard: item.standard ?? server.standard,
		charged: item.charged ?? server.charged,
	};
	const custom = item.metered != null || item.standard != null || item.charged != null;

	return (
		<li className="space-y-3 px-4 py-3">
			<div className="flex items-start justify-between gap-3">
				<div className="min-w-0">
					<div className="truncate font-mono text-xs text-gray-900">{item.exposedName}</div>
					<p className="mt-1 text-sm text-gray-600">{item.definition?.description || item.definition?.title || '—'}</p>
					<div className="mt-2 flex flex-wrap gap-1">
						<span className={item.status === 'enabled'
							? 'rounded-full bg-emerald-50 px-2 py-0.5 text-[10px] font-medium text-emerald-800 ring-1 ring-emerald-200'
							: 'rounded-full bg-gray-100 px-2 py-0.5 text-[10px] font-medium text-gray-600 ring-1 ring-gray-200'}>
							{item.status === 'enabled' ? t('enabled') : item.status === 'removed' ? t('removed') : t('disabled')}
						</span>
						{item.reviewState === 'new' ? <span className="rounded-full bg-amber-50 px-2 py-0.5 text-[10px] font-medium text-amber-800 ring-1 ring-amber-200">{t('reviewNew')}</span> : null}
						{item.reviewState === 'changed' ? <span className="rounded-full bg-sky-50 px-2 py-0.5 text-[10px] font-medium text-sky-800 ring-1 ring-sky-200">{t('reviewChanged')}</span> : null}
					</div>
				</div>
				{item.status !== 'removed' ? (
					<button
						type="button"
						role="switch"
						aria-checked={item.status === 'enabled'}
						disabled={busy}
						onClick={() => onToggle(item.status !== 'enabled')}
						className={`relative h-6 w-11 shrink-0 rounded-full transition ${item.status === 'enabled' ? 'bg-gray-900' : 'bg-gray-300'} disabled:opacity-50`}
					>
						<span className={`absolute top-0.5 h-5 w-5 rounded-full bg-white transition ${item.status === 'enabled' ? 'left-5' : 'left-0.5'}`} />
					</button>
				) : null}
			</div>
			{item.reviewState === 'changed' && item.pendingDefinition ? (
				<div className="rounded-md bg-sky-50 p-3 text-xs text-sky-950">
					<p className="font-medium">{t('currentDescription')}</p>
					<p className="mt-1 text-sky-900">{item.definition?.description || '—'}</p>
					<p className="mt-2 font-medium">{t('pendingDescription')}</p>
					<p className="mt-1 text-sky-900">{item.pendingDefinition.description || '—'}</p>
					<button type="button" disabled={busy} className="mt-2 rounded-md border border-sky-200 bg-white px-2.5 py-1 text-xs font-medium text-sky-900" onClick={onAccept}>
						{t('accept')}
					</button>
				</div>
			) : null}
			{item.kind === 'tool' && item.status !== 'removed' ? (
				<div className="text-xs text-gray-600">
					<div className="flex flex-wrap items-center gap-2">
						<span>{t('effectivePrice')}</span>
						<span className="font-mono">S {effective.standard} · C {effective.charged} · M {effective.metered}</span>
						{custom ? <span className="rounded-full bg-gray-100 px-1.5 py-px text-[10px] text-gray-600">{t('custom')}</span> : null}
						<button
							type="button"
							className="font-medium text-blue-600 hover:underline"
							onClick={() => {
								if (!pricing && (item.metered == null || item.standard == null || item.charged == null)) {
									onPatch({
										metered: item.metered ?? server.metered,
										standard: item.standard ?? server.standard,
										charged: item.charged ?? server.charged,
									});
								}
								setPricing((open) => !open);
							}}
						>
							{t('customPrice')}
						</button>
					</div>
					{pricing ? (
						<div className="mt-2 max-w-sm space-y-2">
							<ToolPriceTripleInputs
								value={{
									metered: item.metered == null ? '' : String(item.metered),
									standard: item.standard == null ? '' : String(item.standard),
									charged: item.charged == null ? '' : String(item.charged),
								}}
								onChange={(patch) => onPatch({
									metered: patch.metered === undefined ? item.metered : patch.metered === '' ? null : Number(patch.metered),
									standard: patch.standard === undefined ? item.standard : patch.standard === '' ? null : Number(patch.standard),
									charged: patch.charged === undefined ? item.charged : patch.charged === '' ? null : Number(patch.charged),
								})}
							/>
							<div className="flex gap-2">
								<button type="button" disabled={busy} className="rounded-md bg-gray-900 px-2.5 py-1 text-xs font-medium text-white disabled:opacity-50" onClick={() => onSavePrice(false)}>{t('priceOverride')}</button>
								<button type="button" disabled={busy} className="rounded-md border border-gray-200 bg-white px-2.5 py-1 text-xs font-medium text-gray-700 disabled:opacity-50" onClick={() => onSavePrice(true)}>{t('clearPrice')}</button>
							</div>
						</div>
					) : null}
				</div>
			) : null}
		</li>
	);
}
