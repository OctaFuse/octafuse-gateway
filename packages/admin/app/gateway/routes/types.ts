import type { GatewayModel, GatewayModelRoute, GatewayProvider } from '@/lib/types';
import type { UpstreamProtocol } from '@/lib/upstream-protocol';

export type RouteListRow = GatewayModelRoute & {
	model_name?: string;
	provider_name?: string;
};

/** Per-model card density: topology shows full provider cards; summary collapses priority tiers. */
export type RouteFlowDensity = 'summary' | 'topology';

/** Workspace layout: overview = all models on one surface flow; byModel = per-model topology. */
export type RouteWorkspaceView = 'overview' | 'byModel';

export function parseRouteWorkspaceView(value: string | null | undefined): RouteWorkspaceView {
	if (value === 'overview' || value === 'surface') return 'overview';
	return 'byModel';
}

export type RouteProtocolGroupSection<T> = {
	key: string;
	protocol: string;
	protocolLabel: string;
	requestOperation: string;
	surfaceId: string | null;
	poolId: string | null;
	poolName: string | null;
	poolStrategy: string | null;
	/** Raw JSON from `route_pools.tier_strategies` */
	poolTierStrategies: string | null;
	poolStickyEnabled: boolean;
	poolStickyIdleTtlSeconds: number;
	group: string;
	routes: T[];
};

export type ProviderStickyDialogTarget = {
	id: string;
	providerName: string;
	priority: number;
	weight: number;
};

export type ProviderStickyDialogState = {
	modelId: string;
	modelTitle: string;
	protocol: string;
	protocolLabel: string;
	group: string;
	requestOperation: string;
	poolId: string | null;
	enabled: boolean;
	idleTtlSeconds: number;
	targets: ProviderStickyDialogTarget[];
};

export type StickyBindingsSummary = {
	total_active: number;
	stale_count: number;
	targets: Array<{
		route_target_id: string;
		active_count: number;
		share: number;
		last_updated_at: string | null;
	}>;
};

export type StickyBindingLookup = {
	user_id: string;
	affinity_hash: string;
	affinity_key: string;
	binding: null | {
		route_target_id: string;
		expires_at: string;
		pool_epoch: number;
		remaining_seconds: number;
		epoch_valid: boolean;
		expired: boolean;
	};
};

export type ProviderStickyFormState = {
	enabled: boolean;
	idleTtlSeconds: number;
};

export type RouteScheduleFormWindow = {
	start: string;
	end: string;
	factor: string;
};

export type RouteScheduleFormSide = RouteScheduleFormWindow[];

export type RouteFormData = {
	model_id: string;
	provider_id: string;
	provider_model_name: string;
	request_protocol: UpstreamProtocol;
	request_operation: string;
	upstream_protocol: UpstreamProtocol;
	upstream_operation: string;
	adapter: string;
	priority: number;
	/** Same-priority weight; default 1 */
	weight: number;
	custom_params_json: string;
	route_group: string;
	charged_factor: string;
	metered_factor: string;
	schedule_charged: RouteScheduleFormSide;
	schedule_metered: RouteScheduleFormSide;
};

export type RoutePolicyDialogState = {
	modelId: string;
	modelTitle: string;
	protocol: string;
	protocolLabel: string;
	group: string;
	poolId?: string | null;
	poolStrategy?: string | null;
	/** Raw JSON from `route_pools.tier_strategies` */
	poolTierStrategies?: string | null;
	/** When set, dialog edits per-tier override for this priority */
	priority?: number;
	requestOperation?: string;
	inheritedStrategy: string;
	inheritedSource: RouteStrategySource;
	targets: RouteStrategyPreviewTarget[];
};

export type RouteStrategySource =
	| 'tier'
	| 'pool'
	| 'modelOperation'
	| 'modelProtocol'
	| 'model'
	| 'global'
	| 'default';

export type RouteStrategyPreviewTarget = {
	id: string;
	providerId: string;
	providerName: string;
	providerModelName: string;
	priority: number;
	weight: number;
	active: boolean;
};

/** '' = inherit; otherwise a RouteStrategyName */
export type RoutePolicyFormState = {
	/** Pool default strategy (or model/protocol strategy in legacy mode) */
	protocolStrategy: string;
	/** Per-tier override when dialog.priority is set; '' = inherit pool default */
	tierStrategy: string;
	capabilityStrategies: Record<string, string>;
};

export type RoutesPageData = {
	routes: RouteListRow[];
	models: GatewayModel[];
	providers: GatewayProvider[];
	globalRouteStrategy: string | null;
};

/** 路由页独立的模型类型筛选；`all` 不改变模型管理页的筛选语义。 */
export const ROUTE_KIND_FILTERS = ['all', 'llm', 'image', 'audio'] as const;
export type RouteKindFilter = (typeof ROUTE_KIND_FILTERS)[number];
export const DEFAULT_ROUTE_KIND_FILTER: RouteKindFilter = 'all';

export function parseRouteKindFilterParam(value: string | null): RouteKindFilter {
	if (value == null || value.trim() === '') return DEFAULT_ROUTE_KIND_FILTER;
	const normalized = value.trim().toLowerCase();
	return (ROUTE_KIND_FILTERS as readonly string[]).includes(normalized)
		? (normalized as RouteKindFilter)
		: DEFAULT_ROUTE_KIND_FILTER;
}

export const EMPTY_ROUTE_FORM: RouteFormData = {
	model_id: '',
	provider_id: '',
	provider_model_name: '',
	request_protocol: 'openai',
	request_operation: 'chat',
	upstream_protocol: 'openai',
	upstream_operation: 'chat',
	adapter: 'passthrough',
	priority: 0,
	weight: 1,
	custom_params_json: '',
	route_group: 'default',
	charged_factor: '1',
	metered_factor: '1',
	schedule_charged: [],
	schedule_metered: [],
};

export const PROTOCOL_DISPLAY_LABEL: Record<string, string> = {
	openai: 'OpenAI',
	anthropic: 'Anthropic',
	gemini: 'Gemini',
};

export const ROUTE_GROUP_CARD_BADGE_CLASS = 'bg-slate-100 text-slate-700 ring-1 ring-inset ring-slate-200';

export const FACTOR_CHIP_BASE =
	'inline-flex min-w-[3rem] w-auto shrink-0 justify-end whitespace-nowrap rounded-md px-1.5 py-0 text-[10px] font-semibold font-mono tabular-nums leading-4 ring-1 ring-inset';

export const routePricePanelShell: Record<'neutral' | 'charged' | 'metered', string> = {
	neutral:
		'rounded-lg border border-gray-300/90 bg-gray-50/90 p-4 shadow-sm ring-1 ring-gray-200/50',
	charged:
		'rounded-lg border border-blue-200/90 bg-blue-50/45 p-4 shadow-sm ring-1 ring-blue-100/60',
	metered:
		'rounded-lg border border-emerald-200/90 bg-emerald-50/40 p-4 shadow-sm ring-1 ring-emerald-100/60',
};

export const routePricePanelHeaderBorder: Record<'neutral' | 'charged' | 'metered', string> = {
	neutral: 'border-b border-gray-200/90',
	charged: 'border-b border-blue-200/80',
	metered: 'border-b border-emerald-200/80',
};
