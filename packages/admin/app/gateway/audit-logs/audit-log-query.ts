import {
  API_KEY_BUDGET_AUDIT_ACTOR_TYPES,
  API_KEY_BUDGET_AUDIT_EVENT_TYPES,
  API_KEY_BUDGET_AUDIT_SOURCE_CHANNELS,
} from '@/lib/types';
import {
  createRangeValue,
  detectRollingPreset,
  type GatewayTimeRangeValue,
} from '@/lib/analytics-range';

export const DEFAULT_EVENTS = API_KEY_BUDGET_AUDIT_EVENT_TYPES.filter(
  (type) => type !== 'usage_charge'
);
export const ACTOR_KINDS = ['console', 'admin_key', 'system', 'service'] as const;
export function sameSelection(left: readonly string[], right: readonly string[]) {
  return left.length === right.length && left.every((value) => right.includes(value));
}
function values(params: URLSearchParams, key: string, allowed?: readonly string[]) {
  return [
    ...new Set(
      params
        .getAll(key)
        .flatMap((value) => value.split(','))
        .map((value) => value.trim())
        .filter((value) => value && (!allowed || allowed.includes(value)))
    ),
  ];
}
export type AuditFilters = {
  page: number;
  events: string[];
  actors: string[];
  kinds: string[];
  sources: string[];
  reasons: string[] | null;
  actorId: string;
  userId: string;
  email: string;
  apiKeyId: string;
  correlationId: string;
  range: GatewayTimeRangeValue;
};
export function readAuditFilters(search: string, timeZone: string): AuditFilters {
  const params = new URLSearchParams(search);
  const get = (key: string) => params.get(key) || '';
  const events = values(params, 'event_type', API_KEY_BUDGET_AUDIT_EVENT_TYPES);
  const actors = values(params, 'actor_type', API_KEY_BUDGET_AUDIT_ACTOR_TYPES);
  const kinds = values(params, 'actor_kind', ACTOR_KINDS);
  const sources = values(params, 'source', API_KEY_BUDGET_AUDIT_SOURCE_CHANNELS);
  const reasons = values(params, 'reason_code');
  const start = params.get('start_date');
  const end = params.get('end_date');
  const hasBounds = start !== null || end !== null;
  const linkedIdentity = Boolean(get('user_id') || get('api_key_id') || get('correlation_id'));
  const page = Number(get('page') || 1);
  return {
    page: Number.isInteger(page) && page >= 1 ? page : 1,
    events: events.length ? events : [...DEFAULT_EVENTS],
    actors: actors.length ? actors : [...API_KEY_BUDGET_AUDIT_ACTOR_TYPES],
    kinds: kinds.length ? kinds : [...ACTOR_KINDS],
    sources: sources.length ? sources : [...API_KEY_BUDGET_AUDIT_SOURCE_CHANNELS],
    reasons: reasons.length ? reasons : null,
    actorId: get('actor_id'),
    userId: get('user_id'),
    email: get('user_email'),
    apiKeyId: get('api_key_id'),
    correlationId: get('correlation_id'),
    range:
      hasBounds || linkedIdentity
        ? {
            preset: start && end ? detectRollingPreset(start, end) ?? 'custom' : 'custom',
            start_date: start || '',
            end_date: end || '',
          }
        : createRangeValue('today', timeZone),
  };
}
/** URL defaults differ from API defaults: omission in the API means all event types. */
export function auditQuery(filters: AuditFilters, target: 'url' | 'api'): URLSearchParams {
  const params = new URLSearchParams({
    page: String(filters.page),
    page_size: '50',
    start_date: filters.range.start_date,
    end_date: filters.range.end_date,
  });
  const eventDefault = target === 'url' ? DEFAULT_EVENTS : API_KEY_BUDGET_AUDIT_EVENT_TYPES;
  if (!sameSelection(filters.events, eventDefault))
    filters.events.forEach((value) => params.append('event_type', value));
  for (const [key, selected, all] of [
    ['actor_type', filters.actors, API_KEY_BUDGET_AUDIT_ACTOR_TYPES],
    ['actor_kind', filters.kinds, ACTOR_KINDS],
    ['source', filters.sources, API_KEY_BUDGET_AUDIT_SOURCE_CHANNELS],
  ] as const) {
    if (!sameSelection(selected, all)) selected.forEach((value) => params.append(key, value));
  }
  filters.reasons?.forEach((value) => params.append('reason_code', value));
  for (const [key, value] of Object.entries({
    actor_id: filters.actorId,
    user_id: filters.userId,
    user_email: filters.email,
    api_key_id: filters.apiKeyId,
    correlation_id: filters.correlationId,
  }))
    if (value) params.set(key, value);
  return params;
}
