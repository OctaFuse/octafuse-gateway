'use client';

import { useTranslations } from 'next-intl';
import { ModelVendorIcon } from '@/components/model-vendor-icon';
import type { GatewayToolDefinition } from '@/lib/gateway-tools';
import type { InvokeKind } from '@/lib/invoke-kind';
import type { SimulatorProtocol } from '@/lib/simulator/endpoint';
import { inputClass, labelClass, panelClass } from '../simulator-utils';
import type { AdminModelRow, RouteListRow } from '../types';

type Props = {
	filterKind: InvokeKind;
	protocol: SimulatorProtocol;
	onFilterKindChange: (kind: InvokeKind) => void;
	kindCounts: { llm: number; image: number; audio: number; tool: number };
	isToolKind: boolean;
	gatewayTools: readonly GatewayToolDefinition[];
	selectedToolId: string;
	onSelectTool: (id: string) => void;
	filterModel: string;
	onFilterModelChange: (v: string) => void;
	filteredModels: AdminModelRow[];
	modelsInKindTotal: number;
	selectedModelId: string;
	onSelectModel: (id: string) => void;
	routeGroup: string;
	onRouteGroupChange: (g: string) => void;
	routeGroupsForModel: string[];
	realtimeOperation: string | null;
	realtimeOperationOptions: readonly string[];
	onRealtimeOperationChange: (operation: string) => void;
	selectedModelIsAudio?: boolean;
	modelRoutingString: string;
	matchingRoutes: RouteListRow[];
};

export function SimulatorRoutingPanel({
	filterKind,
	protocol,
	onFilterKindChange,
	kindCounts,
	isToolKind,
	gatewayTools,
	selectedToolId,
	onSelectTool,
	filterModel,
	onFilterModelChange,
	filteredModels,
	modelsInKindTotal,
	selectedModelId,
	onSelectModel,
	routeGroup,
	onRouteGroupChange,
	routeGroupsForModel,
	realtimeOperation,
	realtimeOperationOptions,
	onRealtimeOperationChange,
	selectedModelIsAudio = false,
	modelRoutingString,
	matchingRoutes,
}: Props) {
	const t = useTranslations('simulator');
	const tTools = useTranslations('tools.catalog');

	return (
		<section className={`${panelClass} flex min-h-0 flex-1 flex-col !space-y-2 !p-3`}>
			<div className="flex items-center justify-between gap-2">
				<h2 className="text-sm font-semibold text-gray-900">{t('routingTarget')}</h2>
				<span className="truncate font-mono text-[11px] text-gray-500" title={modelRoutingString}>
					{isToolKind ? (selectedToolId ? `/v1/tools/${selectedToolId}` : '') : modelRoutingString || ''}
				</span>
			</div>
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
						{ id: 'tool' as const, label: t('kindTool'), count: kindCounts.tool },
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
							<span className="ml-0.5 text-[10px] tabular-nums text-gray-400">{opt.count}</span>
						</button>
					);
				})}
			</div>

			{isToolKind ? (
				<div className="flex min-h-0 flex-1 flex-col">
					<div
						className="min-h-[12rem] flex-1 overflow-y-auto rounded-md border border-gray-200 bg-white xl:min-h-0"
						role="listbox"
						aria-label={t('tool')}
					>
						{gatewayTools.map((tool) => {
							const active = selectedToolId === tool.id;
							return (
								<button
									key={tool.id}
									type="button"
									role="option"
									aria-selected={active}
									onClick={() => onSelectTool(tool.id)}
									className={
										active
											? 'flex w-full flex-col items-start gap-0.5 border-b border-blue-100 bg-blue-50 px-3 py-2 text-left last:border-b-0'
											: 'flex w-full flex-col items-start gap-0.5 border-b border-gray-100 px-3 py-2 text-left last:border-b-0 hover:bg-gray-50'
									}
								>
									<span className="text-sm font-medium text-gray-900">{tTools(tool.nameKey)}</span>
									<span className="font-mono text-[11px] text-gray-500">/v1/tools/{tool.id}</span>
								</button>
							);
						})}
					</div>
				</div>
			) : (
				<>
					<div className="flex min-h-0 flex-1 flex-col">
						<input
							id="simulator-model-search"
							type="search"
							placeholder={t('modelFilterPlaceholder')}
							value={filterModel}
							onChange={(e) => onFilterModelChange(e.target.value)}
							className={`${inputClass} mb-2`}
							autoComplete="off"
							aria-label={t('model')}
						/>
						<div
							className="min-h-[16rem] flex-1 overflow-y-auto rounded-md border border-gray-200 bg-white xl:min-h-0"
							role="listbox"
							aria-label={t('model')}
						>
							{filteredModels.length === 0 ? (
								<p className="px-3 py-4 text-sm text-gray-500">
									{filterModel.trim() ? t('noMatchingModels') : t('noRoutedModels')}
								</p>
							) : (
								filteredModels.map((m) => {
									const active = selectedModelId === m.id;
									const name = m.display_name?.trim() || m.id;
									return (
										<button
											key={m.id}
											type="button"
											role="option"
											aria-selected={active}
											onClick={() => onSelectModel(m.id)}
											className={
												active
													? 'flex w-full items-center gap-2.5 border-b border-blue-100 bg-blue-50 px-3 py-2 text-left last:border-b-0'
													: 'flex w-full items-center gap-2.5 border-b border-gray-100 px-3 py-2 text-left last:border-b-0 hover:bg-gray-50'
											}
										>
											<ModelVendorIcon vendor={m.vendor} size="compact" />
											<span className="min-w-0 flex-1">
												<span className="block truncate text-sm font-medium text-gray-900">{name}</span>
												<span className="block truncate font-mono text-[11px] text-gray-500">
													{m.id} · {m.vendor}
												</span>
											</span>
										</button>
									);
								})
							)}
						</div>
						<p className="mt-1 text-[11px] text-gray-500">
							{t('modelCount', { total: modelsInKindTotal, filtered: filteredModels.length })}
						</p>
					</div>

					<div className="shrink-0 space-y-2 border-t border-gray-100 pt-2">
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
						</div>
						{protocol === 'dashscope' && selectedModelIsAudio && realtimeOperationOptions.length > 0 ? (
							<div>
								<label className={labelClass}>{t('realtimeOperation')}</label>
								<select
									value={realtimeOperation ?? ''}
									onChange={(e) => onRealtimeOperationChange(e.target.value)}
									className={`${inputClass} font-mono`}
								>
									{realtimeOperationOptions.map((operation) => (
										<option key={operation} value={operation}>
											{operation}
										</option>
									))}
								</select>
							</div>
						) : null}
						<details className="text-xs text-gray-600">
							<summary className="cursor-pointer select-none hover:text-gray-900">
								{t('matchingRoutesSummary', { count: matchingRoutes.length })}
							</summary>
							<div className="mt-2">
								{!selectedModelId ? (
									<p className="text-xs text-gray-500">{t('matchingRoutesNeedModel')}</p>
								) : matchingRoutes.length === 0 ? (
									<p className="text-xs text-amber-800">{t('matchingRoutesEmpty')}</p>
								) : (
									<ul className="max-h-32 divide-y divide-gray-100 overflow-y-auto rounded-md border border-gray-200 bg-gray-50/80 text-xs">
										{matchingRoutes.map((r) => (
											<li key={r.id} className="px-2.5 py-1.5 font-mono text-gray-800">
												<span className="font-semibold text-gray-900">
													{r.provider_name || r.provider_id || '—'}
												</span>
												<span className="text-gray-500">
													{' '}
													p{r.priority} · {r.route_group || 'default'}
												</span>
											</li>
										))}
									</ul>
								)}
							</div>
						</details>
					</div>
				</>
			)}
		</section>
	);
}
