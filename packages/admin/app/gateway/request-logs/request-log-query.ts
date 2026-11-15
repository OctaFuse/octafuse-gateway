import { createRangeValue, detectRollingPreset, GATEWAY_CALENDAR_PRESETS, GATEWAY_TIME_RANGE_PRESETS, type GatewayTimeRangeValue } from '@/lib/analytics-range';
import { zonedInputToUtcApi } from '@/lib/business-timezone-client';
import { parseGroupedSelection, type GroupedSelection } from '@/lib/grouped-selection';
import { isInvocationModelId, readRequestLogKinds, requestLogKindScope, serializeRequestLogKinds } from '@/lib/request-log-kind';
import { observedMs } from './request-log-flow-data';

export type RequestLogFilters = {
	page: number;
	/** 类型多选（查询参数 `kinds`），空数组表示不限。见 `lib/request-log-kind.ts`。 */
	kinds: string[];
	status: string;
	/** 模型多选：`groups` 是模型厂商（`model_vendors`），`items` 是模型（`model_ids`）。两者取并集。 */
	models: GroupedSelection;
	/** 供应商多选：`groups` 是供应商类型（`provider_kinds`），`items` 是供应商（`provider_ids`）。两者取并集。 */
	providers: GroupedSelection;
	/** 链接带来的具体工具（`model_id=tool:*` / `mcp:{slug}/{tool}`），筛选栏里没有对应的选择框。 */
	invocationModel: string;
	modelPrefix?: string;
	email: string;
	apiKey: string;
	requestId: string;
	routeGroup: string;
	protocol: string;
	range: GatewayTimeRangeValue;
};

export function readRequestLogFilters(search: string, timeZone: string): RequestLogFilters {
	const params = new URLSearchParams(search);
	const start = params.get('start_date');
	const end = params.get('end_date');
	const requestId = params.get('id') || '';
	const requestedPreset = params.get('range_preset');
	const preset = [...GATEWAY_CALENDAR_PRESETS, ...GATEWAY_TIME_RANGE_PRESETS].find(value => value === requestedPreset);
	const hasRange = start !== null || end !== null || Boolean(requestId);
	const range: GatewayTimeRangeValue = preset ? { ...createRangeValue(preset, timeZone), ...(start !== null ? { start_date: start } : {}), ...(end !== null ? { end_date: end } : {}) } : hasRange
		? {
				preset: start && end ? detectRollingPreset(start, end) ?? 'custom' : 'custom',
				start_date: start || '',
				end_date: end || '',
		  }
		: createRangeValue('today', timeZone);
	const page = Number(params.get('page') || 1);
	const { kinds, absorbed } = readRequestLogKinds(params);
	// 已经由类型表达的旧参数不再作为独立筛选保留。
	const own = (key: (typeof absorbed)[number]) => (absorbed.includes(key) ? '' : params.get(key) || '');
	// 模型、供应商、协议、路由组只对模型请求有意义；范围里只有工具调用时不保留。
	const modelScope = requestLogKindScope(kinds).model;
	const model = own('model_id');
	const invocationModel = isInvocationModelId(model) ? model : '';
	// 单值的 `model_id` / `provider_id` 是旧链接的写法，并进多选。
	const join = (...values: (string | null)[]) => (modelScope ? values.filter(Boolean).join(',') : '');
	return {
		page: Number.isInteger(page) && page >= 1 ? page : 1,
		kinds,
		status: params.get('status') || '',
		models: parseGroupedSelection(
			join(params.get('model_vendors')),
			join(params.get('model_ids'), invocationModel ? '' : model),
		),
		providers: parseGroupedSelection(
			join(params.get('provider_kinds')),
			join(own('provider_ids'), own('provider_id')),
		),
		invocationModel,
		...(own('model_id_prefix') ? { modelPrefix: own('model_id_prefix') } : {}),
		email: params.get('user_email') || '',
		apiKey: params.get('api_key_id') || '',
		requestId,
		routeGroup: modelScope ? params.get('route_group') || '' : '',
		protocol: modelScope ? params.get('protocol') || '' : '',
		range,
	};
}

/** Explicit empty bounds preserve all-time and open-ended searches on reload. */
export function requestLogQuery(filters: RequestLogFilters): URLSearchParams {
	const params = new URLSearchParams({
		page: String(filters.page),
		page_size: '50',
		start_date: filters.range.start_date,
		end_date: filters.range.end_date,
	});
	if (filters.range.preset !== 'custom') params.set('range_preset', filters.range.preset);
	const modelScope = requestLogKindScope(filters.kinds).model;
	for (const [key, value] of Object.entries({
		status: filters.status,
		kinds: serializeRequestLogKinds(filters.kinds),
		model_id: filters.invocationModel,
		model_vendors: modelScope ? filters.models.groups.join(',') : undefined,
		model_ids: modelScope ? filters.models.items.join(',') : undefined,
		provider_kinds: modelScope ? filters.providers.groups.join(',') : undefined,
		provider_ids: modelScope ? filters.providers.items.join(',') : undefined,
		model_id_prefix: filters.modelPrefix,
		user_email: filters.email,
		api_key_id: filters.apiKey,
		id: filters.requestId,
		route_group: modelScope ? filters.routeGroup : undefined,
		protocol: modelScope ? filters.protocol : undefined,
	})) {
		if (value) params.set(key, value);
	}
	return params;
}

export function customLogRange(start: string, end: string, timeZone: string): GatewayTimeRangeValue | null {
	const startUtc = start ? zonedInputToUtcApi(start, timeZone) : '';
	const endUtc = end ? zonedInputToUtcApi(end, timeZone) : '';
	if ((start && !startUtc) || (end && !endUtc) || (startUtc && endUtc && startUtc > endUtc)) return null;
	return { preset: 'custom', start_date: startUtc || '', end_date: endUtc || '' };
}

export function requestLogDuration(value: unknown): string {
	const ms = observedMs(value);
	if (ms === null) return '—';
	return ms < 1000
		? `${ms.toLocaleString('en-US', { maximumFractionDigits: 0 })} ms`
		: `${(ms / 1000).toLocaleString('en-US', { maximumFractionDigits: 2 })} s`;
}
