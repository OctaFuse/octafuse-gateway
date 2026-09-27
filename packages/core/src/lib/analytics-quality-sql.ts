/** Additive, consistently sampled metrics. Legacy fields retain their original meaning. */
export const ANALYTICS_FAILOVER_SELECT_SQL = `SUM(CASE WHEN rl.upstream_failover_count > 0 THEN 1 ELSE 0 END) as failover_request_count,
    100.0 * SUM(CASE WHEN rl.upstream_failover_count > 0 THEN 1 ELSE 0 END) / NULLIF(COUNT(*), 0) as failover_request_rate`;

/** Only successful requests with positive measured stream duration contribute to either side. */
export const ANALYTICS_STREAM_SELECT_SQL = `SUM(CASE WHEN rl.status = 'success' AND rl.stream_duration_ms > 0 THEN 1 ELSE 0 END) as stream_sample_count,
    1000.0 * SUM(CASE WHEN rl.status = 'success' AND rl.stream_duration_ms > 0 THEN rl.output_tokens ELSE 0 END)
    / NULLIF(SUM(CASE WHEN rl.status = 'success' AND rl.stream_duration_ms > 0 THEN rl.stream_duration_ms ELSE 0 END), 0) as stream_tokens_per_second`;
