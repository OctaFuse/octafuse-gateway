'use client';

import type { ReactNode } from 'react';
import { useTranslations } from 'next-intl';
import {
	formatModelOptionLabel,
	inputClass,
	labelClass,
	panelClass,
} from '../simulator-utils';
import type { AdminModelRow, RouteListRow } from '../types';

function ReadonlyField({ label, children }: { label: string; children: ReactNode }) {
	return (
		<div className="min-w-0">
			<div className="text-xs font-medium text-gray-500">{label}</div>
			<div className="mt-0.5 text-sm text-gray-900 break-words font-mono">{children}</div>
		</div>
	);
}

type Props = {
	filterModel: string;
	onFilterModelChange: (v: string) => void;
	filteredModels: AdminModelRow[];
	modelsTotal: number;
	modelIdsWithActiveRouter: Set<string>;
	selectedModelId: string;
	onSelectModel: (id: string) => void;
	routeGroup: string;
	onRouteGroupChange: (g: string) => void;
	routeGroupsForModel: string[];
	selectedModel: AdminModelRow | null;
	modelRoutingString: string;
	matchingRoutes: RouteListRow[];
};

export function SimulatorRoutingPanel({
	filterModel,
	onFilterModelChange,
	filteredModels,
	modelsTotal,
	modelIdsWithActiveRouter,
	selectedModelId,
	onSelectModel,
	routeGroup,
	onRouteGroupChange,
	routeGroupsForModel,
	selectedModel,
	modelRoutingString,
	matchingRoutes,
}: Props) {
	const t = useTranslations('simulator');

	return (
		<section className={panelClass}>
			<h2 className="text-sm font-semibold text-gray-900">{t('routingTarget')}</h2>
			<div>
				<label className={labelClass}>{t('filter')}</label>
				<input
					type="text"
					placeholder={t('modelFilterPlaceholder')}
					value={filterModel}
					onChange={(e) => onFilterModelChange(e.target.value)}
					className={inputClass}
				/>
			</div>
			<div>
				<label className={labelClass}>{t('model')}</label>
				<select
					value={selectedModelId}
					onChange={(e) => onSelectModel(e.target.value)}
					className={`${inputClass} font-mono`}
				>
					<option value="">{t('selectModel')}</option>
					{filteredModels.map((m) => (
						<option key={m.id} value={m.id}>
							{formatModelOptionLabel(m, modelIdsWithActiveRouter.has(m.id))}
						</option>
					))}
				</select>
				<p className="mt-1.5 text-xs text-gray-500">
					{t('modelCount', { total: modelsTotal, filtered: filteredModels.length })}
				</p>
			</div>
			<div>
				<label className={labelClass}>{t('routeGroupOptional')}</label>
				<select
					value={routeGroup}
					onChange={(e) => onRouteGroupChange(e.target.value)}
					className={inputClass}
					disabled={!selectedModelId}
				>
					<option value="">{t('defaultRouteGroup')}</option>
					{routeGroupsForModel.map((g) => (
						<option key={g} value={g}>
							{g}
						</option>
					))}
				</select>
				<p className="mt-1 text-xs text-gray-500">{t('routeGroupHint')}</p>
			</div>
			{selectedModel ? (
				<div className="grid grid-cols-1 gap-2 pt-2 border-t border-gray-100">
					<ReadonlyField label={t('routingModelString')}>{modelRoutingString || '—'}</ReadonlyField>
					<ReadonlyField label="max_tokens">{String(selectedModel.max_tokens ?? '—')}</ReadonlyField>
				</div>
			) : null}

			<div className="pt-2 border-t border-gray-100 space-y-2">
				<div className="text-xs font-medium text-gray-600">{t('matchingRoutes')}</div>
				{!selectedModelId ? (
					<p className="text-xs text-gray-500">{t('matchingRoutesNeedModel')}</p>
				) : matchingRoutes.length === 0 ? (
					<p className="text-xs text-amber-800">{t('matchingRoutesEmpty')}</p>
				) : (
					<ul className="max-h-40 overflow-y-auto divide-y divide-gray-100 rounded-md border border-gray-200 bg-gray-50/80 text-xs">
						{matchingRoutes.map((r) => (
							<li key={r.id} className="px-2.5 py-2 font-mono text-gray-800">
								<div className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5">
									<span className="font-semibold text-gray-900">
										{r.provider_name || r.provider_id || '—'}
									</span>
									<span className="text-gray-500">p{r.priority}</span>
									<span className="text-gray-500">{r.route_group || 'default'}</span>
								</div>
								{(r.provider_model_name || r.upstream_protocol) && (
									<div className="mt-0.5 text-gray-500 truncate">
										{[r.provider_model_name, r.upstream_protocol].filter(Boolean).join(' · ')}
									</div>
								)}
							</li>
						))}
					</ul>
				)}
			</div>
		</section>
	);
}
