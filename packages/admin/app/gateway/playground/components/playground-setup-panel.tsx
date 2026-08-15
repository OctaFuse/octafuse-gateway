'use client';

import type { ReactNode } from 'react';
import { useTranslations } from 'next-intl';
import type { ModelKindFilter } from '../../models/types';
import {
	formatRouteJsonColumn,
	inputClass,
	isRouteActive,
	labelClass,
	panelClass,
	routeJsonPreClass,
} from '../playground-utils';
import type { FilterOption, RouteListRow } from '../types';

function ReadonlyField({ label, children }: { label: string; children: ReactNode }) {
	return (
		<div className="min-w-0">
			<div className="text-xs font-medium text-gray-500">{label}</div>
			<div className="mt-0.5 text-sm text-gray-900 break-words font-mono">{children}</div>
		</div>
	);
}

type Props = {
	filterKind: ModelKindFilter;
	onFilterKindChange: (kind: ModelKindFilter) => void;
	kindCounts: { llm: number; image: number; audio: number };
	routeSearch: string;
	onRouteSearchChange: (v: string) => void;
	filterModel: string;
	onFilterModelChange: (v: string) => void;
	filterProvider: string;
	onFilterProviderChange: (v: string) => void;
	modelOptions: FilterOption[];
	providerOptions: FilterOption[];
	routesInKindTotal: number;
	filteredRoutes: RouteListRow[];
	selectedId: string;
	onSelectRoute: (id: string) => void;
	selected: RouteListRow | null;
};

export function PlaygroundSetupPanel({
	filterKind,
	onFilterKindChange,
	kindCounts,
	routeSearch,
	onRouteSearchChange,
	filterModel,
	onFilterModelChange,
	filterProvider,
	onFilterProviderChange,
	modelOptions,
	providerOptions,
	routesInKindTotal,
	filteredRoutes,
	selectedId,
	onSelectRoute,
	selected,
}: Props) {
	const t = useTranslations('playground');

	return (
		<div className="flex h-full min-h-0 flex-col gap-4">
			<section className={`${panelClass} flex min-h-0 flex-1 flex-col`}>
				<h2 className="text-sm font-semibold text-gray-900">{t('routeSection')}</h2>
				<div>
					<label className={labelClass}>{t('kind')}</label>
					<div
						className="inline-flex w-full rounded-md border border-gray-200 bg-gray-50 p-0.5"
						role="group"
						aria-label={t('kind')}
					>
						{(
							[
								{ id: 'llm' as const, label: t('kindLlm'), count: kindCounts.llm },
								{ id: 'image' as const, label: t('kindImage'), count: kindCounts.image },
								{ id: 'audio' as const, label: t('kindAudio'), count: kindCounts.audio },
							] as const
						).map((opt) => {
							const active = filterKind === opt.id;
							return (
								<button
									key={opt.id}
									type="button"
									onClick={() => onFilterKindChange(opt.id)}
									className={
										active
											? 'flex-1 rounded px-1.5 py-1.5 text-[11px] font-medium bg-white text-gray-900 shadow-sm sm:text-xs'
											: 'flex-1 rounded px-1.5 py-1.5 text-[11px] font-medium text-gray-600 hover:text-gray-900 sm:text-xs'
									}
								>
									{opt.label}
									<span className="ml-1 text-[10px] text-gray-400 tabular-nums sm:text-xs">{opt.count}</span>
								</button>
							);
						})}
					</div>
				</div>

				<div>
					<label className={labelClass} htmlFor="playground-route-search">
						{t('searchRoutes')}
					</label>
					<input
						id="playground-route-search"
						type="search"
						value={routeSearch}
						onChange={(e) => onRouteSearchChange(e.target.value)}
						placeholder={t('searchRoutesPlaceholder')}
						className={inputClass}
						autoComplete="off"
					/>
				</div>

				<details className="text-xs text-gray-600">
					<summary className="cursor-pointer select-none hover:text-gray-900">{t('moreFilters')}</summary>
					<div className="mt-3 grid grid-cols-1 gap-3">
						<div>
							<label className={labelClass}>{t('modelId')}</label>
							<select
								value={filterModel}
								onChange={(e) => onFilterModelChange(e.target.value)}
								className={inputClass}
							>
								<option value="">{t('placeholders.allModels')}</option>
								{modelOptions.map((o) => (
									<option key={o.id} value={o.id}>
										{o.label}
									</option>
								))}
							</select>
						</div>
						<div>
							<label className={labelClass}>{t('provider')}</label>
							<select
								value={filterProvider}
								onChange={(e) => onFilterProviderChange(e.target.value)}
								className={inputClass}
							>
								<option value="">{t('placeholders.allProviders')}</option>
								{providerOptions.map((o) => (
									<option key={o.id} value={o.id}>
										{o.label}
									</option>
								))}
							</select>
						</div>
					</div>
				</details>

				<div className="flex min-h-0 flex-1 flex-col">
					<label className={labelClass}>{t('selectRoute')}</label>
					<div
						className="min-h-[16rem] flex-1 overflow-y-auto rounded-md border border-gray-200 bg-white xl:min-h-0"
						role="listbox"
						aria-label={t('selectRoute')}
					>
						{filteredRoutes.length === 0 ? (
							<p className="px-3 py-4 text-sm text-gray-500">{t('noMatchingRoutes')}</p>
						) : (
							filteredRoutes.map((r) => {
								const active = selectedId === r.id;
								const modelLabel = r.model_name || r.model_id;
								const providerLabel = r.provider_name || r.provider_id;
								const operation = `${r.upstream_protocol}.${r.upstream_operation ?? '*'}`;
								return (
									<button
										key={r.id}
										type="button"
										role="option"
										aria-selected={active}
										onClick={() => onSelectRoute(r.id)}
										className={
											active
												? 'flex w-full flex-col items-start gap-0.5 border-b border-blue-100 bg-blue-50 px-3 py-2 text-left last:border-b-0'
												: 'flex w-full flex-col items-start gap-0.5 border-b border-gray-100 px-3 py-2 text-left last:border-b-0 hover:bg-gray-50'
										}
									>
										<div className="flex w-full min-w-0 items-center gap-2">
											<span
												className={
													isRouteActive(r.status)
														? 'inline-flex shrink-0 rounded-full bg-green-100 px-1.5 py-0.5 text-[10px] font-medium text-green-800'
														: 'inline-flex shrink-0 rounded-full bg-amber-100 px-1.5 py-0.5 text-[10px] font-medium text-amber-800'
												}
											>
												{isRouteActive(r.status) ? t('routeStatusActive') : t('routeStatusInactive')}
											</span>
											<span className="truncate text-sm font-medium text-gray-900">{modelLabel}</span>
										</div>
										<div className="w-full truncate text-[11px] text-gray-500">
											{providerLabel} · {operation} · {r.route_group}
										</div>
									</button>
								);
							})
						)}
					</div>
					<p className="mt-2 text-xs text-gray-500">
						{t('routeCount', {
							total: routesInKindTotal,
							filtered: filteredRoutes.length,
						})}
					</p>
				</div>
			</section>

			<section className={`${panelClass} shrink-0 xl:max-h-[40%] xl:overflow-y-auto`}>
				<h2 className="text-sm font-semibold text-gray-900">{t('selectedRoute')}</h2>
				{selected ? (
					<div className="space-y-3">
						{!isRouteActive(selected.status) ? (
							<p className="text-xs text-amber-800">{t('inactiveRouteHint')}</p>
						) : null}
						<div className="grid grid-cols-1 gap-2.5">
							<ReadonlyField label={t('modelName')}>
								{selected.model_name ?? selected.model_id}
							</ReadonlyField>
							<ReadonlyField label={t('provider')}>
								{selected.provider_name ?? selected.provider_id}
							</ReadonlyField>
							<ReadonlyField label={t('upstreamOperation')}>
								{selected.upstream_protocol}.{selected.upstream_operation ?? '*'}
							</ReadonlyField>
							<ReadonlyField label={t('routeGroup')}>{selected.route_group}</ReadonlyField>
							<ReadonlyField label={t('priorityStatus')}>
								{selected.priority} / {selected.status}
							</ReadonlyField>
						</div>
						<details className="text-xs text-gray-600">
							<summary className="cursor-pointer select-none hover:text-gray-900">{t('selectedDetails')}</summary>
							<div className="mt-3 space-y-3">
								<div className="grid grid-cols-1 gap-2.5">
									<ReadonlyField label={t('modelId')}>{selected.model_id}</ReadonlyField>
									<ReadonlyField label={t('providerId')}>{selected.provider_id}</ReadonlyField>
									<ReadonlyField label={t('providerModel')}>{selected.provider_model_name}</ReadonlyField>
									<ReadonlyField label={t('routingPool')}>
										{selected.pool_name ?? selected.route_pool_id ?? 'legacy'}
									</ReadonlyField>
									<ReadonlyField label={t('publicSurfaces')}>
										{formatRouteJsonColumn(selected.surfaces)}
									</ReadonlyField>
								</div>
								<div>
									<div className="mb-1 text-xs font-medium text-gray-600">{t('customParams')}</div>
									<pre className={routeJsonPreClass}>{formatRouteJsonColumn(selected.custom_params)}</pre>
								</div>
								<div>
									<div className="mb-1 text-xs font-medium text-gray-600">{t('priceOverride')}</div>
									<pre className={routeJsonPreClass}>{formatRouteJsonColumn(selected.price_override)}</pre>
								</div>
							</div>
						</details>
					</div>
				) : (
					<p className="text-sm text-gray-500">{t('chooseRouteHint')}</p>
				)}
			</section>
		</div>
	);
}
