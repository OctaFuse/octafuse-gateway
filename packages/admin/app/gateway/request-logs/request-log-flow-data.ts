/** Read persisted observations only; missing timings must never become zero-duration stages. */
export function readLogObject(raw: string | null | undefined): Record<string, unknown> | null {
  if (!raw?.trim()) return null;
  try {
    const value: unknown = JSON.parse(raw);
    return value !== null && typeof value === 'object' && !Array.isArray(value)
      ? value as Record<string, unknown> : null;
  } catch {
    return null;
  }
}

export function observedMs(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : null;
}

export type FlowAttempt = {
  position: number;
  index: number;
  provider: string | null;
  model: string | null;
  startMs: number | null;
  headersMs: number | null;
  headersElapsedMs: number | null;
  status: number | null;
  selected: boolean;
  failed: boolean;
  error: string | null;
  failureKind: string | null;
  raw: Record<string, unknown>;
};

function logString(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value : null;
}

export function readFlowAttempts(raw: string | null | undefined): FlowAttempt[] {
  const metadata = readLogObject(raw);
  if (!Array.isArray(metadata?.attempts)) return [];
  return metadata.attempts.flatMap((value, position) => {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return [];
    const attempt = value as Record<string, unknown>;
    const status = observedMs(attempt.status);
    const error = logString(attempt.error);
    const failureKind = logString(attempt.failure_kind);
    return [{
      position,
      index: observedMs(attempt.index) ?? position + 1,
      provider: logString(attempt.provider_name) ?? logString(attempt.provider_id),
      model: logString(attempt.model),
      startMs: observedMs(attempt.start_ms),
      headersMs: observedMs(attempt.headers_ms),
      headersElapsedMs: observedMs(attempt.headers_elapsed_ms),
      status,
      selected: attempt.selected === true,
      failed: Boolean(error || failureKind || (status !== null && status >= 400)),
      error,
      failureKind,
      raw: attempt,
    }];
  });
}

export type BodyChange = {
  path: string;
  kind: 'added' | 'removed' | 'changed';
  before?: unknown;
  after?: unknown;
};

function isObject(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function sameJson(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (Array.isArray(a) && Array.isArray(b)) {
    return a.length === b.length && a.every((value, i) => sameJson(value, b[i]));
  }
  if (isObject(a) && isObject(b)) {
    const keys = Object.keys(a);
    return keys.length === Object.keys(b).length && keys.every(key => Object.hasOwn(b, key) && sameJson(a[key], b[key]));
  }
  return false;
}

/** JSON Pointer paths keep literal dots/slashes in parameter names unambiguous. */
export function compareLogBodies(entryRaw: string | null | undefined, upstreamRaw: string | null | undefined): BodyChange[] | null {
  const entry = readLogObject(entryRaw);
  const upstream = readLogObject(upstreamRaw);
  if (!entry || !upstream) return null;
  const changes: BodyChange[] = [];
  function visit(before: Record<string, unknown>, after: Record<string, unknown>, prefix: string) {
    for (const key of [...new Set([...Object.keys(before), ...Object.keys(after)])].sort()) {
      const path = `${prefix}/${key.replace(/~/g, '~0').replace(/\//g, '~1')}`;
      if (!Object.hasOwn(before, key)) changes.push({ path, kind: 'added', after: after[key] });
      else if (!Object.hasOwn(after, key)) changes.push({ path, kind: 'removed', before: before[key] });
      else if (isObject(before[key]) && isObject(after[key])) visit(before[key], after[key], path);
      else if (!sameJson(before[key], after[key])) changes.push({ path, kind: 'changed', before: before[key], after: after[key] });
    }
  }
  visit(entry, upstream, '');
  return changes;
}

/** Include all observed endpoints: legacy latency and stream timings may have different boundaries. */
export function flowTimeExtent(latencyMs: unknown, attempts: FlowAttempt[], gatewayMs: unknown, streamMs: unknown): number {
  const selected = attempts.find(attempt => attempt.selected);
  const stream = observedMs(streamMs);
  return Math.max(1, observedMs(latencyMs) ?? 0, observedMs(gatewayMs) ?? 0,
    ...attempts.flatMap(attempt => [attempt.startMs ?? 0, attempt.headersElapsedMs ?? 0,
      attempt.startMs !== null && attempt.headersMs !== null ? attempt.startMs + attempt.headersMs : 0]),
    selected?.headersElapsedMs != null && stream !== null ? selected.headersElapsedMs + stream : 0);
}

/** Audit defaults exclude usage charges and use the current week; a drill-down must override both. */
export function requestAccountingHref(id: string, createdAt: string): string {
  const params = new URLSearchParams({ correlation_id: id, event_type: 'usage_charge' });
  const timestamp = Date.parse(createdAt);
  if (Number.isFinite(timestamp)) {
    params.set('start_date', new Date(timestamp - 86_400_000).toISOString());
    params.set('end_date', new Date(timestamp + 86_400_000).toISOString());
  }
  return `/gateway/audit-logs?${params}`;
}
