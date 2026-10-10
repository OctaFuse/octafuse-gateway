'use client';

import { useId, useState } from 'react';
import { useTranslations } from 'next-intl';
import { ToolPriceTripleInputs } from '@/app/gateway/tools/components/tool-price-triple-inputs';
import type { CatalogItem, ServerDetail } from '../mcp-types';

export function McpCatalogItemRow({
	currency,
	item,
	server,
	busy,
	selected,
	onSelect,
	onToggle,
	onAccept,
	onSavePrice,
}: {
	currency: string;
	item: CatalogItem;
	server: ServerDetail['server'];
	busy: boolean;
	selected: boolean;
	onSelect: (selected: boolean) => void;
	onToggle: (enabled: boolean) => void;
	onAccept: () => void;
	onSavePrice: (item: CatalogItem, clear: boolean) => Promise<boolean>;
}) {
	const t = useTranslations('mcp');
	const common = useTranslations('common');
	const priceId = useId();
	const [pricing, setPricing] = useState(false);
	const [draft, setDraft] = useState({ metered: '', standard: '', charged: '' });
	const [priceError, setPriceError] = useState(false);
	const [expandedDescription, setExpandedDescription] = useState(false);
	const description = item.definition?.description || item.definition?.title || t('noDescription');
	const longDescription = description.length > 160 || description.split('\n').length > 2;
	const effective = {
		metered: item.metered ?? server.metered,
		standard: item.standard ?? server.standard,
		charged: item.charged ?? server.charged,
	};
	const custom = item.metered != null || item.standard != null || item.charged != null;

	return (
		<li
			className={`rounded-xl border p-4 transition ${
				selected ? 'border-blue-200 bg-blue-50/30' : 'border-gray-200 bg-white'
			} ${item.status === 'removed' ? 'opacity-60' : ''}`}
		>
			<div className="flex items-start gap-3">
				<input
					type="checkbox"
					checked={selected}
					disabled={busy || item.status === 'removed'}
					onChange={(e) => onSelect(e.target.checked)}
					aria-label={t('selectItem', { name: item.exposedName })}
					className="mt-1 h-4 w-4 shrink-0 rounded border-gray-300 accent-blue-600"
				/>
				<div className="min-w-0 flex-1">
					<div className="flex flex-wrap items-center gap-2">
						<span className="break-all font-mono text-sm font-semibold text-gray-900">
							{item.upstreamKey}
						</span>
						{item.reviewState === 'new' && item.status !== 'removed' ? (
							<span className="rounded-md bg-amber-50 px-2 py-0.5 text-xs font-medium text-amber-700">
								{t('reviewNew')}
							</span>
						) : null}
						{item.reviewState === 'changed' && item.status !== 'removed' ? (
							<span className="rounded-md bg-sky-50 px-2 py-0.5 text-xs font-medium text-sky-700">
								{t('reviewChanged')}
							</span>
						) : null}
					</div>
					<p className="mt-1 break-all font-mono text-xs text-gray-400">{item.exposedName}</p>
					<p
						className={`mt-2 whitespace-pre-wrap break-words text-sm leading-6 text-gray-600 ${
							expandedDescription ? '' : 'line-clamp-2'
						}`}
					>
						{description}
					</p>
					{longDescription ? (
						<button
							type="button"
							aria-expanded={expandedDescription}
							onClick={() => setExpandedDescription(!expandedDescription)}
							className="mt-1 text-xs font-medium text-gray-400 hover:text-gray-700"
						>
							{t(expandedDescription ? 'collapseDescription' : 'expandDescription')}
						</button>
					) : null}
				</div>
				<div className="flex shrink-0 flex-col items-end gap-2">
					<span className={`text-xs ${item.status === 'enabled' ? 'text-emerald-600' : 'text-gray-400'}`}>
						{t(item.status === 'enabled' ? 'enabled' : item.status === 'removed' ? 'removed' : 'disabled')}
					</span>
					{item.status !== 'removed' ? (
						<button
							type="button"
							role="switch"
							aria-label={t('toggleItem', { name: item.exposedName })}
							aria-checked={item.status === 'enabled'}
							disabled={busy}
							onClick={() => onToggle(item.status !== 'enabled')}
							className={`relative h-5 w-9 rounded-full transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 focus-visible:ring-offset-2 ${
								item.status === 'enabled' ? 'bg-gray-900' : 'bg-gray-300'
							} disabled:opacity-50`}
						>
							<span
								className={`absolute top-0.5 h-4 w-4 rounded-full bg-white transition-transform ${
									item.status === 'enabled' ? 'left-0.5 translate-x-4' : 'left-0.5'
								}`}
							/>
						</button>
					) : null}
				</div>
			</div>
			{item.reviewState === 'changed' && item.pendingDefinition && item.status !== 'removed' ? (
				<div className="mt-4 rounded-lg border border-sky-100 bg-sky-50/50 p-3">
					<p className="mb-3 text-xs leading-5 text-sky-800">{t('changeHint')}</p>
					<div className="grid gap-3 sm:grid-cols-2">
						<div>
							<p className="text-xs font-medium text-gray-500">{t('currentDescription')}</p>
							<p className="mt-1 whitespace-pre-wrap break-words text-sm text-gray-700">
								{item.definition?.description || '—'}
							</p>
						</div>
						<div>
							<p className="text-xs font-medium text-sky-700">{t('pendingDescription')}</p>
							<p className="mt-1 whitespace-pre-wrap break-words text-sm text-sky-900">
								{item.pendingDefinition.description || '—'}
							</p>
						</div>
					</div>
					<details className="mt-3">
						<summary className="cursor-pointer text-xs font-medium text-sky-700">
							{t('compareDefinitions')}
						</summary>
						<div className="mt-2 grid gap-2 sm:grid-cols-2">
							<pre className="max-h-64 overflow-auto rounded-lg bg-white p-3 text-xs text-gray-600">
								{JSON.stringify(item.definition, null, 2)}
							</pre>
							<pre className="max-h-64 overflow-auto rounded-lg bg-white p-3 text-xs text-sky-800">
								{JSON.stringify(item.pendingDefinition, null, 2)}
							</pre>
						</div>
					</details>
					<button
						type="button"
						disabled={busy}
						onClick={onAccept}
						className="mt-3 rounded-lg border border-sky-200 bg-white px-3 py-1.5 text-xs font-medium text-sky-800 hover:bg-sky-50 disabled:opacity-50"
					>
						{t('accept')}
					</button>
				</div>
			) : null}
			<div className="mt-4 flex flex-wrap items-center justify-between gap-3 border-t border-gray-100 pt-3">
				<details className="min-w-0">
					<summary className="cursor-pointer text-xs font-medium text-gray-500 hover:text-gray-900">
						{t('viewDefinition')}
					</summary>
					<pre className="mt-2 max-h-72 max-w-full overflow-auto rounded-lg bg-gray-50 p-3 text-xs text-gray-600">
						{JSON.stringify(item.definition, null, 2)}
					</pre>
				</details>
				{item.kind === 'tool' && item.status !== 'removed' ? (
					<div className="flex flex-wrap items-center gap-3 text-xs text-gray-500">
						<span
							title={t('priceLegend', {
								standard: effective.standard,
								charged: effective.charged,
								metered: effective.metered,
								currency,
							})}
						>
							{t('charged')}:{' '}
							<span className="font-mono text-gray-700">
								{effective.charged} {currency}
							</span>
						</span>
						<span className="rounded bg-gray-100 px-1.5 py-0.5 text-[11px]">
							{t(custom ? 'custom' : 'inheritedPrice')}
						</span>
						<button
							type="button"
							disabled={busy}
							aria-expanded={pricing}
							aria-controls={priceId}
							onClick={() => {
								if (!pricing) {
									setDraft({
										metered: String(effective.metered),
										standard: String(effective.standard),
										charged: String(effective.charged),
									});
									setPriceError(false);
								}
								setPricing(!pricing);
							}}
							className="font-medium text-blue-600 hover:underline disabled:opacity-50"
						>
							{t(pricing ? 'collapsePrice' : 'customPrice')}
						</button>
					</div>
				) : null}
			</div>
			{pricing ? (
				<form
					id={priceId}
					className="mt-3 rounded-lg border border-gray-200 bg-gray-50 p-4"
					onSubmit={async (e) => {
						e.preventDefault();
						const prices = Object.fromEntries(
							Object.entries(draft).map(([key, value]) => [key, value.trim() === '' ? null : Number(value)])
						) as Pick<CatalogItem, 'metered' | 'standard' | 'charged'>;
						if (
							Object.values(prices).some((value) => value != null && (!Number.isFinite(value) || value < 0))
						) {
							setPriceError(true);
							return;
						}
						if (await onSavePrice({ ...item, ...prices }, false)) setPricing(false);
					}}
				>
					<fieldset disabled={busy}>
						<p className="text-xs font-medium text-gray-700">
							{t('effectivePrice')} · {currency}
						</p>
						<p className="mt-1 text-xs text-gray-400">{t('priceDraftHint')}</p>
						<ToolPriceTripleInputs
							step="any"
							value={draft}
							onChange={(patch) => setDraft({ ...draft, ...patch })}
						/>
						{priceError ? (
							<p role="alert" className="mb-2 text-xs text-red-600">
								{t('invalidPrice')}
							</p>
						) : null}
						<div className="mt-2 flex flex-wrap gap-2">
							<button
								type="submit"
								className="rounded-lg bg-gray-900 px-3 py-2 text-xs font-medium text-white hover:bg-gray-800"
							>
								{t('priceOverride')}
							</button>
							<button
								type="button"
								onClick={async () => {
									if (await onSavePrice(item, true)) setPricing(false);
								}}
								className="rounded-lg border border-gray-200 bg-white px-3 py-2 text-xs font-medium text-gray-700 hover:bg-gray-50"
							>
								{t('clearPrice')}
							</button>
							<button
								type="button"
								onClick={() => setPricing(false)}
								className="rounded-lg px-3 py-2 text-xs text-gray-500 hover:text-gray-900"
							>
								{common('cancel')}
							</button>
						</div>
					</fieldset>
				</form>
			) : null}
		</li>
	);
}
