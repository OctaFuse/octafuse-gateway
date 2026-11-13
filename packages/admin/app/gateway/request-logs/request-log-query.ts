import { createRangeValue, detectRollingPreset, GATEWAY_CALENDAR_PRESETS, GATEWAY_TIME_RANGE_PRESETS, type GatewayTimeRangeValue } from '@/lib/analytics-range';
import { zonedInputToUtcApi } from '@/lib/business-timezone-client';
import { observedMs } from './request-log-flow-data';

export type RequestLogFilters = {
	page: number;
	status: string;
	model: string;
	provider: string;
	providerIds?: string;
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
	return {
		page: Number.isInteger(page) && page >= 1 ? page : 1,
		status: params.get('status') || '',
		model: params.get('model_id') || '',
		provider: params.get('provider_id') || '',
		...(params.get('provider_ids') ? { providerIds: params.get('provider_ids')! } : {}),
		...(params.get('model_id_prefix') ? { modelPrefix: params.get('model_id_prefix')! } : {}),
		email: params.get('user_email') || '',
		apiKey: params.get('api_key_id') || '',
		requestId,
		routeGroup: params.get('route_group') || '',
		protocol: params.get('protocol') || '',
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
	for (const [key, value] of Object.entries({
		status: filters.status,
		model_id: filters.model,
		provider_id: filters.provider,
		provider_ids: filters.providerIds,
		model_id_prefix: filters.modelPrefix,
		user_email: filters.email,
		api_key_id: filters.apiKey,
		id: filters.requestId,
		route_group: filters.routeGroup,
		protocol: filters.protocol,
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
