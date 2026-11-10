'use client';
import { AdminContentMark } from '@/components/admin-content-mark';

import { useTranslations } from 'next-intl';
import { ModelVendorIcon } from '@/components/model-vendor-icon';
import type { GatewayToolDefinition } from '@/lib/gateway-tools';
import type { InvokeKind } from '@/lib/invoke-kind';
import type { KeyboardEvent } from 'react';
import { AdminInspector } from '@/components/admin-inspector';
import { CheckIcon, ArrowsRightLeftIcon } from '@heroicons/react/24/outline';
import type { SimulatorProtocol } from '@/lib/simulator/endpoint';
import { inputClass, labelClass, panelClass } from '../simulator-utils';
import type { AdminModelRow, RouteListRow } from '../types';

function onListboxKeyDown(event: KeyboardEvent<HTMLButtonElement>) {
	const buttons = Array.from(
		event.currentTarget.parentElement?.querySelectorAll<HTMLButtonElement>('button[role="option"]') ?? []
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
}

type Props = {
	disabled: boolean;
	filterKind: InvokeKind;
	protocol: SimulatorProtocol;
	onFilterKindChange: (kind: InvokeKind) => void;
	kindCounts: { llm: number; image: number; asr: number; tts: number; embedding: number; tool: number };
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
	providerLabelFor: (route: { provider_id: string; provider_name?: string | null }) => string;
};

export function SimulatorRoutingPanel({
	disabled,
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
	providerLabelFor,
}: Props) {
	const t = useTranslations('simulator');
	const tTools = useTranslations('tools.catalog');

	return (
		<section className={`${panelClass} flex min-h-0 flex-1 flex-col`}>
			<div className="flex items-center justify-between gap-2">
				<h2 className="flex items-center gap-2 text-sm font-medium text-gray-900"><AdminContentMark icon={ArrowsRightLeftIcon} compact />{t('routingTarget')}</h2>
				<span className="truncate font-mono text-xs text-gray-500" title={modelRoutingString}>
					{isToolKind ? (selectedToolId ? `/v1/tools/${selectedToolId}` : '') : modelRoutingString || ''}
				</span>
			</div>
			<div role="group" aria-label={t('kind')} className="flex flex-wrap gap-1">
				{(['llm', 'image', 'asr', 'tts', 'embedding', 'tool'] as const).map((kind) => (
					<button
						key={kind}
						type="button"
						disabled={disabled}
						aria-pressed={filterKind === kind}
						onClick={() => onFilterKindChange(kind)}
						className={`inline-flex items-center gap-1.5 rounded-lg px-2 py-2 text-xs disabled:opacity-50 ${
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
								tool: 'kindTool',
							}[kind]
						)}
						<span className="font-mono tabular-nums opacity-60">{kindCounts[kind]}</span>
					</button>
				))}
			</div>

			{isToolKind ? (
				<div className="flex min-h-0 flex-1 flex-col">
					<div
						className="h-56 min-h-0 flex-none overflow-y-auto overscroll-contain rounded-lg bg-white xl:h-auto xl:flex-1"
						role="listbox"
						aria-label={t('tool')}
					>
						{gatewayTools.map((tool) => {
							const active = selectedToolId === tool.id;
							return (
								<button
									key={tool.id}
									type="button"
									disabled={disabled}
									role="option"
									aria-selected={active}
									onKeyDown={onListboxKeyDown}
									tabIndex={
										active ||
										(!gatewayTools.some((tool) => tool.id === selectedToolId) &&
											tool.id === gatewayTools[0]?.id)
											? 0
											: -1
									}
									onClick={() => onSelectTool(tool.id)}
									className={
										active
											? 'flex w-full flex-col items-start gap-0.5 rounded-lg bg-gray-100 px-3 py-3 ring-1 ring-inset ring-gray-200 text-left last:border-b-0'
											: 'flex w-full flex-col items-start gap-0.5 rounded-lg px-3 py-3 text-left last:border-b-0 hover:bg-gray-50'
									}
								>
									<span className="text-sm font-medium text-gray-900">{tTools(tool.nameKey)}</span>
									<span className="font-mono text-xs text-gray-500">/v1/tools/{tool.id}</span>
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
							disabled={disabled}
							placeholder={t('modelFilterPlaceholder')}
							value={filterModel}
							onChange={(e) => onFilterModelChange(e.target.value)}
							className={`${inputClass} mb-2`}
							autoComplete="off"
							aria-label={t('model')}
						/>
						<div
							className="h-56 min-h-0 flex-none overflow-y-auto overscroll-contain rounded-lg bg-white xl:h-auto xl:flex-1"
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
											disabled={disabled}
											role="option"
											aria-selected={active}
											onKeyDown={onListboxKeyDown}
											tabIndex={
												active ||
												(!filteredModels.some((model) => model.id === selectedModelId) &&
													m.id === filteredModels[0]?.id)
													? 0
													: -1
											}
											onClick={() => onSelectModel(m.id)}
											className={
												active
													? 'flex w-full items-center gap-2.5 rounded-lg bg-gray-100 px-3 py-3 ring-1 ring-inset ring-gray-200 text-left last:border-b-0'
													: 'flex w-full items-center gap-2.5 rounded-lg px-3 py-3 text-left last:border-b-0 hover:bg-gray-50'
											}
										>
											<ModelVendorIcon vendor={m.vendor} size="compact" />
											<span className="min-w-0 flex-1">
												<span className="block truncate text-sm font-medium text-gray-900">{name}</span>
												<span className="block truncate font-mono text-xs text-gray-500">{m.id}</span>
											</span>
											{active && <CheckIcon className="h-4 w-4 shrink-0 text-gray-700" aria-hidden />}
										</button>
									);
								})
							)}
						</div>
						<p className="mt-1 text-xs text-gray-500">
							{t('modelCount', { total: modelsInKindTotal, filtered: filteredModels.length })}
						</p>
					</div>

					<div className="shrink-0 space-y-2 border-t border-gray-100 pt-2">
						<div>
							<label className={labelClass} htmlFor="simulator-route-group">
								{t('routeGroupOptional')}
							</label>
							<select
								id="simulator-route-group"
								value={routeGroup === 'default' ? '' : routeGroup}
								onChange={(e) => onRouteGroupChange(e.target.value)}
								className={inputClass}
								disabled={disabled || !selectedModelId}
							>
								<option value="">{t('defaultRouteGroup')}</option>
								{routeGroupsForModel
									.filter((group) => group && group !== 'default')
									.map((g) => (
										<option key={g} value={g}>
											{g}
										</option>
									))}
							</select>
						</div>
						{(protocol === 'dashscope' || protocol === 'elevenlabs') &&
						selectedModelIsAudio &&
						realtimeOperationOptions.length > 0 ? (
							<div>
								<label className={labelClass} htmlFor="simulator-realtime-operation">
									{t('realtimeOperation')}
								</label>
								<select
									id="simulator-realtime-operation"
									disabled={disabled}
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
						<AdminInspector
							label={t('matchingRoutesSummary', { count: matchingRoutes.length })}
							size="md"
							hint={t('matchingRoutesHint')}
							disabled={!selectedModelId}
						>
							{matchingRoutes.length ? (
								<ul className="divide-y divide-gray-100">
									{matchingRoutes.map((route) => (
										<li
											key={route.id}
											className="flex flex-wrap items-center justify-between gap-2 py-3 text-sm"
										>
											<span>{providerLabelFor(route) || '—'}</span>
											<span className="font-mono text-xs text-gray-500">
												P{route.priority} · {route.route_group || 'default'}
											</span>
										</li>
									))}
								</ul>
							) : (
								<p className="text-sm text-gray-500">{t('matchingRoutesEmpty')}</p>
							)}
						</AdminInspector>
					</div>
				</>
			)}
		</section>
	);
}
