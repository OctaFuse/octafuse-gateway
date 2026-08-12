'use client';

import { isAudioSpeechModel } from '@octafuse/core/db/model-modalities';
import type { ReactNode } from 'react';
import { useTranslations } from 'next-intl';
import type { GatewayToolDefinition } from '@/lib/gateway-tools';
import type { InvokeKind } from '@/lib/invoke-kind';
import type { SimulatorProtocol } from '@/lib/simulator/endpoint';
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
	modelIdsWithActiveRouter: Set<string>;
	selectedModelId: string;
	onSelectModel: (id: string) => void;
	routeGroup: string;
	onRouteGroupChange: (g: string) => void;
	routeGroupsForModel: string[];
	selectedModel: AdminModelRow | null;
	selectedModelIsImage?: boolean;
	selectedModelIsAudio?: boolean;
	realtimeOperation: string | null;
	realtimeOperationOptions: readonly string[];
	onRealtimeOperationChange: (operation: string) => void;
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
	modelIdsWithActiveRouter,
	selectedModelId,
	onSelectModel,
	routeGroup,
	onRouteGroupChange,
	routeGroupsForModel,
	selectedModel,
	selectedModelIsImage = false,
	selectedModelIsAudio = false,
	realtimeOperation,
	realtimeOperationOptions,
	onRealtimeOperationChange,
	modelRoutingString,
	matchingRoutes,
}: Props) {
	const t = useTranslations('simulator');
	const tRoutes = useTranslations('routes.card');
	const tTools = useTranslations('tools.catalog');
	// 模拟器复用 Audio 分类，但 TTS 的能力与计费提示不能沿用 ASR 文案。
	const selectedModelIsAudioSpeech = selectedModel
		? isAudioSpeechModel(selectedModel)
		: false;

	return (
		<section className={panelClass}>
			<h2 className="text-sm font-semibold text-gray-900">{t('routingTarget')}</h2>
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
								<span className="ml-0.5 text-[10px] text-gray-400 tabular-nums">{opt.count}</span>
							</button>
						);
					})}
				</div>
			</div>

			{isToolKind ? (
				<>
					<div>
						<label className={labelClass}>{t('tool')}</label>
						<select
							value={selectedToolId}
							onChange={(e) => onSelectTool(e.target.value)}
							className={`${inputClass} font-mono`}
						>
							{gatewayTools.map((tool) => (
								<option key={tool.id} value={tool.id}>
									{tTools(tool.nameKey)} ({tool.id})
								</option>
							))}
						</select>
						<p className="mt-1.5 text-xs text-gray-500">{t('toolHint')}</p>
					</div>
					<div className="pt-2 border-t border-gray-100 space-y-2">
						<p className="text-xs text-gray-500">{t('toolNoRoutes')}</p>
						{selectedToolId ? (
							<ReadonlyField label={t('toolEndpoint')}>
								{`/v1/tools/${selectedToolId}`}
							</ReadonlyField>
						) : null}
					</div>
				</>
			) : (
				<>
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
							{t('modelCount', { total: modelsInKindTotal, filtered: filteredModels.length })}
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
					{selectedModel ? (
						<div className="grid grid-cols-1 gap-2 pt-2 border-t border-gray-100">
							<ReadonlyField label={t('routingModelString')}>
								{modelRoutingString || '—'}
							</ReadonlyField>
							{selectedModelIsAudio ? (
								<ReadonlyField label={t('modelKind')}>
									{tRoutes(selectedModelIsAudioSpeech ? 'audioSpeechModelHint' : 'audioModelHint')}
								</ReadonlyField>
							) : selectedModelIsImage ? (
								<ReadonlyField label={t('modelKind')}>{tRoutes('imageModelHint')}</ReadonlyField>
							) : (
								<ReadonlyField label="max_tokens">
									{String(selectedModel.max_tokens ?? '—')}
								</ReadonlyField>
							)}
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
												{[
													r.provider_model_name,
													r.upstream_protocol
														? `${r.upstream_protocol}.${r.upstream_operation ?? '*'}`
														: null,
												]
													.filter(Boolean)
													.join(' · ')}
											</div>
										)}
										<div className="mt-0.5 truncate text-[10px] text-indigo-600">
											{r.pool_name ?? r.route_pool_id ?? 'legacy pool'}
										</div>
									</li>
								))}
							</ul>
						)}
					</div>
				</>
			)}
		</section>
	);
}
