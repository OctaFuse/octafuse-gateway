import type { GatewayModel, GatewayModelRoute, GatewayProvider } from '@/lib/types';
import type { UpstreamProtocol } from '@/lib/upstream-protocol';

export type RouteListRow = GatewayModelRoute & {
	model_name?: string;
	provider_name?: string;
};

export type RouteProtocolGroupSection<T> = {
	key: string;
	protocol: string;
	protocolLabel: string;
	group: string;
	routes: T[];
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
	upstream_protocol: UpstreamProtocol;
	priority: number;
	custom_params_json: string;
	route_group: string;
	charged_factor: string;
	metered_factor: string;
	schedule_charged: RouteScheduleFormSide;
	schedule_metered: RouteScheduleFormSide;
};

export type StickyDialogState = {
	modelId: string;
	modelTitle: string;
	protocol: string;
	protocolLabel: string;
	group: string;
};

export type StickyFormState = {
	enabled: boolean;
	ttl_seconds: string;
	short_wait_ms: string;
};

export type RoutesPageData = {
	routes: RouteListRow[];
	models: GatewayModel[];
	providers: GatewayProvider[];
};

export const EMPTY_ROUTE_FORM: RouteFormData = {
	model_id: '',
	provider_id: '',
	provider_model_name: '',
	upstream_protocol: 'openai',
	priority: 0,
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
	'inline-flex w-[3rem] shrink-0 justify-end rounded-md px-1.5 py-0 text-[10px] font-semibold font-mono tabular-nums leading-4 ring-1 ring-inset';

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
