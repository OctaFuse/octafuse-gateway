import type { DashboardOverview, DashboardOverviewWindow, DashboardPeriodMetrics, DashboardErrorCategory } from '../storage/repository-dtos';

type Row = Record<string, unknown>;
type Query = (sql: string, binds: string[]) => Promise<Row[]>;

/** Heuristic message classification; explicit HTTP statuses take precedence over keywords. */
export const DASHBOARD_ERROR_CATEGORY_SQL = `CASE
 WHEN LOWER(COALESCE(error_message, '')) LIKE '%http 429%' THEN 'rate_limit'
 WHEN LOWER(COALESCE(error_message, '')) LIKE '%http 408%' OR LOWER(COALESCE(error_message, '')) LIKE '%http 504%' THEN 'timeout'
 WHEN LOWER(COALESCE(error_message, '')) LIKE '%http 401%' OR LOWER(COALESCE(error_message, '')) LIKE '%http 403%' THEN 'auth'
 WHEN LOWER(COALESCE(error_message, '')) LIKE '%http 5__%' THEN 'upstream'
 WHEN LOWER(COALESCE(error_message, '')) LIKE '%http 4__%' THEN 'request'
 WHEN LOWER(COALESCE(error_message, '')) LIKE '%rate limit%' OR LOWER(COALESCE(error_message, '')) LIKE '%too many requests%' THEN 'rate_limit'
 WHEN LOWER(COALESCE(error_message, '')) LIKE '%timeout%' OR LOWER(COALESCE(error_message, '')) LIKE '%timed out%' THEN 'timeout'
 WHEN LOWER(COALESCE(error_message, '')) LIKE '%unauthorized%' OR LOWER(COALESCE(error_message, '')) LIKE '%invalid api key%' THEN 'auth'
 WHEN LOWER(COALESCE(error_message, '')) LIKE '%fetch failed%' OR LOWER(COALESCE(error_message, '')) LIKE '%connection%' THEN 'upstream'
 ELSE 'other' END`;

const columns = ['requests','success','errors','incomplete','cancelled','charged','metered','standard','errorCost','failoverRequests','failoverSamples','attemptsSamples'] as const;
function period(row?: Row): DashboardPeriodMetrics {
 const metrics = Object.fromEntries(columns.map(key => [key, Number(row?.[key.toLowerCase()] ?? 0)])) as unknown as DashboardPeriodMetrics;
 return { ...metrics, avgAttempts: row?.avgattempts == null ? null : Number(row.avgattempts),
 ttftSamples: 0, ttftP50: null, ttftP95: null, latencySamples: 0, latencyP50: null, latencyP95: null };
}

/** Half-open windows. Aggregation and nearest-rank percentiles execute in the database.
 * All three supported databases have CTEs and window functions; only bind syntax differs.
 * Success-only timings keep fast failures out of latency statistics. TTFT uses the same
 * first-reasoning-token fallback as the existing reliability analytics, with measured streams only.
 */
export async function queryDashboardOverview(query: Query, window: DashboardOverviewWindow): Promise<DashboardOverview> {
 const base = `WITH base AS (
 SELECT rl.status, rl.latency_ms, rl.stream_duration_ms, rl.first_reasoning_token_ms, rl.first_token_ms, rl.charged_cost, rl.metered_cost, rl.standard_cost, rl.upstream_failover_count, rl.upstream_attempt_count, 'current' AS period FROM api_key_request_logs rl WHERE created_at >= ? AND created_at < ?
 UNION ALL SELECT rl.status, rl.latency_ms, rl.stream_duration_ms, rl.first_reasoning_token_ms, rl.first_token_ms, rl.charged_cost, rl.metered_cost, rl.standard_cost, rl.upstream_failover_count, rl.upstream_attempt_count, 'previous' FROM api_key_request_logs rl WHERE created_at >= ? AND created_at < ?)`;
 const binds = [window.startDate, window.endDate, window.previousStart, window.previousEnd];
 const currentWhere = 'created_at >= ? AND created_at < ?';
 const [totals, timings, providers, categories] = await Promise.all([
 query(`${base} SELECT period, COUNT(*) AS requests,
 SUM(CASE WHEN status = 'success' THEN 1 ELSE 0 END) AS success,
 SUM(CASE WHEN status = 'error' THEN 1 ELSE 0 END) AS errors,
 SUM(CASE WHEN status = 'incomplete' THEN 1 ELSE 0 END) AS incomplete,
 SUM(CASE WHEN status = 'cancelled' THEN 1 ELSE 0 END) AS cancelled,
 SUM(charged_cost) AS charged, SUM(metered_cost) AS metered, SUM(standard_cost) AS standard,
 SUM(CASE WHEN status = 'error' THEN metered_cost ELSE 0 END) AS errorcost,
 SUM(CASE WHEN upstream_failover_count > 0 THEN 1 ELSE 0 END) AS failoverrequests,
 SUM(CASE WHEN upstream_failover_count >= 0 THEN 1 ELSE 0 END) AS failoversamples,
 SUM(CASE WHEN upstream_attempt_count >= 1 THEN 1 ELSE 0 END) AS attemptssamples,
 AVG(CASE WHEN upstream_attempt_count >= 1 THEN upstream_attempt_count END) AS avgattempts
 FROM base GROUP BY period`, binds),
 query(`${base}, samples AS (
 SELECT period, 'latency' AS metric, latency_ms AS value FROM base WHERE status = 'success' AND latency_ms >= 0
 UNION ALL
 SELECT period, 'ttft', COALESCE(first_reasoning_token_ms, first_token_ms) FROM base
 WHERE status = 'success' AND stream_duration_ms > 0 AND COALESCE(first_reasoning_token_ms, first_token_ms) >= 0),
 ranked AS (SELECT period, metric, value, ROW_NUMBER() OVER (PARTITION BY period, metric ORDER BY value) AS rn,
 COUNT(*) OVER (PARTITION BY period, metric) AS n FROM samples)
 SELECT period, metric, MAX(n) AS samples,
 MIN(CASE WHEN rn >= n * 0.50 THEN value END) AS p50,
 MIN(CASE WHEN rn >= n * 0.95 THEN value END) AS p95
 FROM ranked GROUP BY period, metric`, binds),
 query(`SELECT provider_id AS id, MAX(provider_name) AS name, COUNT(*) AS requests,
 SUM(CASE WHEN status = 'error' THEN 1 ELSE 0 END) AS errors,
 COUNT(DISTINCT CASE WHEN status = 'error' THEN user_id END) AS affectedusers
 FROM api_key_request_logs WHERE ${currentWhere}
 GROUP BY provider_id HAVING SUM(CASE WHEN status = 'error' THEN 1 ELSE 0 END) > 0
 ORDER BY errors DESC, requests DESC, provider_id ASC LIMIT 5`, binds.slice(0,2)),
 query(`SELECT ${DASHBOARD_ERROR_CATEGORY_SQL} AS category, COUNT(*) AS count
 FROM api_key_request_logs WHERE ${currentWhere} AND status = 'error'
 GROUP BY ${DASHBOARD_ERROR_CATEGORY_SQL} ORDER BY count DESC, category ASC`, binds.slice(0,2)),
 ]);
 const current = period(totals.find(row => row.period === 'current'));
 const previous = period(totals.find(row => row.period === 'previous'));
 for (const row of timings) {
 const target = row.period === 'current' ? current : previous;
 const prefix = row.metric === 'ttft' ? 'ttft' : 'latency';
 target[`${prefix}Samples`] = Number(row.samples);
 target[`${prefix}P50`] = row.p50 == null ? null : Number(row.p50);
 target[`${prefix}P95`] = row.p95 == null ? null : Number(row.p95);
 }
 return { current, previous,
 providers: providers.map(row => ({ id: String(row.id ?? ''), name: row.name == null ? null : String(row.name), requests: Number(row.requests), errors: Number(row.errors), affectedUsers: Number(row.affectedusers) })),
 errorCategories: categories.map(row => ({ category: String(row.category) as DashboardErrorCategory, count: Number(row.count) })) };
}
