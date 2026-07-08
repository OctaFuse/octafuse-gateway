/**
 * TTFT analytics SELECT fragments for `api_key_request_logs` (alias `rl`).
 * Shared across D1 / Postgres / MySQL admin analytics queries.
 */
export const ANALYTICS_TTFT_SELECT_SQL = `AVG(rl.first_reasoning_token_ms) as avg_first_reasoning_token_ms,
				AVG(rl.first_token_ms) as avg_first_token_ms,
				AVG(COALESCE(rl.first_reasoning_token_ms, rl.first_token_ms)) as avg_effective_ttft_ms,
				AVG(CASE WHEN rl.first_reasoning_token_ms IS NOT NULL AND rl.first_token_ms IS NOT NULL AND rl.first_token_ms >= rl.first_reasoning_token_ms THEN rl.first_token_ms - rl.first_reasoning_token_ms END) as avg_reasoning_phase_ms,
				CASE WHEN COUNT(*) > 0 THEN 100.0 * SUM(CASE WHEN rl.first_reasoning_token_ms IS NOT NULL THEN 1 ELSE 0 END) / COUNT(*) ELSE 0 END as reasoning_ttft_rate,
				CASE WHEN COUNT(*) > 0 THEN 100.0 * SUM(CASE WHEN rl.first_token_ms IS NOT NULL THEN 1 ELSE 0 END) / COUNT(*) ELSE 0 END as content_ttft_rate`;
