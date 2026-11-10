'use client';
import { AdminContentMark } from '@/components/admin-content-mark';

import type { ReactNode } from 'react';
import { useTranslations } from 'next-intl';
import type { ModelKindFilter } from '../../models/types';
import { AdminInspector } from '@/components/admin-inspector';
import { CheckIcon, MagnifyingGlassIcon, AdjustmentsHorizontalIcon } from '@heroicons/react/24/outline';
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
	disabled: boolean;
	filterKind: ModelKindFilter;
	onFilterKindChange: (kind: ModelKindFilter) => void;
	kindCounts: { llm: number; image: number; asr: number; tts: number; embedding: number };
	routeSearch: string;
	onRouteSearchChange: (v: string) => void;
	filterModel: string;
	onFilterModelChange: (v: string) => void;
	filterProvider: string;
	onFilterProviderChange: (v: string) => void;
	modelOptions: FilterOption[];
	providerOptions: FilterOption[];
	providerLabelFor: (route: { provider_id: string; provider_name?: string | null }) => string;
	routesInKindTotal: number;
	filteredRoutes: RouteListRow[];
	selectedId: string;
	onSelectRoute: (id: string) => void;
	selected: RouteListRow | null;
};

export function PlaygroundSetupPanel({
	disabled,
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
	providerLabelFor,
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
				<h2 className="flex items-center gap-2 text-sm font-medium text-gray-900"><AdminContentMark icon={AdjustmentsHorizontalIcon} compact />{t('routeSection')}</h2>
				<div role="group" aria-label={t('kind')} className="flex flex-wrap gap-1">
					{(['llm', 'image', 'asr', 'tts', 'embedding'] as const).map((kind) => (
						<button
							key={kind}
							type="button"
							disabled={disabled}
							aria-pressed={filterKind === kind}
							onClick={() => onFilterKindChange(kind)}
							className={`inline-flex items-center gap-1.5 rounded-lg px-2.5 py-2 text-xs ${
								filterKind === kind ? 'bg-gray-950 font-medium text-white' : 'text-gray-600 hover:bg-gray-100'
							}`}
						>
							{t(
								{
									llm: 'kindLlm',
									image: 'kindImage',
									asr: 'kindAsr',
									tts: 'kindTts',
									embedding: 'kindEmbedding',
								}[kind]
							)}
							<span className="font-mono tabular-nums opacity-60">{kindCounts[kind]}</span>
						</button>
					))}
				</div>

				<div className="relative">
					<MagnifyingGlassIcon
						className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-gray-400"
						aria-hidden
					/>
					<label className="sr-only" htmlFor="playground-route-search">
						{t('searchRoutes')}
					</label>
					<input
						id="playground-route-search"
						type="search"
						disabled={disabled}
						value={routeSearch}
						onChange={(e) => onRouteSearchChange(e.target.value)}
						placeholder={t('searchRoutesPlaceholder')}
						className={`${inputClass} pl-9`}
						autoComplete="off"
					/>
				</div>

				<details className="text-xs text-gray-600">
					<summary className="cursor-pointer select-none hover:text-gray-900">
						{t('moreFilters')}
						{filterModel || filterProvider ? (
							<span className="ml-2 rounded bg-gray-100 px-1.5 font-mono">
								{Number(Boolean(filterModel)) + Number(Boolean(filterProvider))}
							</span>
						) : null}
					</summary>
					<div className="mt-3 grid grid-cols-1 gap-3">
						<div>
							<label className={labelClass} htmlFor="playground-filter-model">
								{t('modelId')}
							</label>
							<select
								disabled={disabled}
								id="playground-filter-model"
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
							<label className={labelClass} htmlFor="playground-filter-provider">
								{t('provider')}
							</label>
							<select
								disabled={disabled}
								id="playground-filter-provider"
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
						className="h-56 min-h-0 flex-none overflow-y-auto overscroll-contain xl:h-auto xl:flex-1 rounded-lg bg-white xl:min-h-0"
						role="listbox"
						aria-label={t('selectRoute')}
					>
						{filteredRoutes.length === 0 ? (
							<p className="px-3 py-4 text-sm text-gray-500">{t('noMatchingRoutes')}</p>
						) : (
							filteredRoutes.map((r) => {
								const active = selectedId === r.id;
								const modelLabel = r.model_name || r.model_id;
								const providerLabel = providerLabelFor(r);
								const operation = `${r.upstream_protocol}.${r.upstream_operation ?? '*'}`;
								const routeMeta = [operation, r.route_group].filter(Boolean).join(' · ');
								return (
									<button
										key={r.id}
										type="button"
										disabled={disabled}
										role="option"
										aria-selected={active}
										tabIndex={
											active ||
											(!filteredRoutes.some((route) => route.id === selectedId) &&
												r.id === filteredRoutes[0]?.id)
												? 0
												: -1
										}
										onKeyDown={(event) => {
											const buttons = Array.from(
												event.currentTarget.parentElement?.querySelectorAll<HTMLButtonElement>(
													'button[role="option"]'
												) ?? []
											);
											const index = buttons.indexOf(event.currentTarget);
											const next =
												event.key === 'ArrowDown'
													? Math.min(index + 1, buttons.length - 1)
													: event.key === 'ArrowUp'
													? Math.max(index - 1, 0)
													: event.key === 'Home'
													? 0
													: event.key === 'End'
													? buttons.length - 1
													: null;
											if (next === null) return;
											event.preventDefault();
											buttons[next]?.focus();
											buttons[next]?.click();
										}}
										onClick={() => onSelectRoute(r.id)}
										className={
											active
												? 'flex w-full flex-col items-start gap-0.5 rounded-lg bg-gray-100 px-3 py-3 ring-1 ring-inset ring-gray-200 text-left last:border-b-0'
												: 'flex w-full flex-col items-start gap-0.5 rounded-lg px-3 py-3 text-left last:border-b-0 hover:bg-gray-50'
										}
									>
										<div className="flex w-full min-w-0 items-center gap-2">
											<span
												className={`h-1.5 w-1.5 shrink-0 rounded-full ${
													isRouteActive(r.status) ? 'bg-emerald-500' : 'bg-gray-300'
												}`}
												title={isRouteActive(r.status) ? t('routeStatusActive') : t('routeStatusInactive')}
											>
												<span className="sr-only">
													{isRouteActive(r.status) ? t('routeStatusActive') : t('routeStatusInactive')}
												</span>
											</span>
											<span className="truncate text-sm font-medium text-gray-900">{modelLabel}</span>
											{active && <CheckIcon className="ml-auto h-4 w-4 shrink-0 text-gray-700" aria-hidden />}
										</div>
										<div className="w-full truncate text-xs leading-4 text-gray-600" title={providerLabel}>
											{providerLabel}
										</div>
										<div className="w-full truncate text-xs leading-4 text-gray-400" title={routeMeta}>
											{routeMeta}
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

			<div className="admin-editor-panel admin-content-panel shrink-0 rounded-xl border border-gray-200 bg-white p-4">
				{selected ? (
					<p className="mb-3 truncate text-sm font-medium text-gray-900">
						{selected.model_name ?? selected.model_id}
					</p>
				) : null}
				{selected && (
					<p className="mb-3 truncate text-xs text-gray-500" title={providerLabelFor(selected)}>
						{providerLabelFor(selected)}
					</p>
				)}
				<AdminInspector label={t('selectedRoute')} disabled={!selected}>
					{selected ? (
						<div className="space-y-3">
							{!isRouteActive(selected.status) ? (
								<p className="text-xs text-amber-800">{t('inactiveRouteHint')}</p>
							) : null}
							<div className="grid grid-cols-1 gap-2.5">
								<ReadonlyField label={t('modelName')}>
									{selected.model_name ?? selected.model_id}
								</ReadonlyField>
								<ReadonlyField label={t('provider')}>{providerLabelFor(selected)}</ReadonlyField>
								<ReadonlyField label={t('upstreamOperation')}>
									{selected.upstream_protocol}.{selected.upstream_operation ?? '*'}
								</ReadonlyField>
								<ReadonlyField label={t('routeGroup')}>{selected.route_group}</ReadonlyField>
								<ReadonlyField label={t('priorityStatus')}>
									{selected.priority} / {isRouteActive(selected.status) ? t('routeStatusActive') : t('routeStatusInactive')}
								</ReadonlyField>
							</div>
							<details className="text-xs text-gray-600">
								<summary className="cursor-pointer select-none hover:text-gray-900">
									{t('selectedDetails')}
								</summary>
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
				</AdminInspector>
			</div>
		</div>
	);
}
