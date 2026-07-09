import type {
	RequestStatsByRangeRow,
	RequestTimeseriesRow,
	ThroughputSnapshot,
	UserTokenTimeseriesRow,
} from '../storage/repository-dtos';

type StatsSqlRow = {
	total_requests?: number | string;
	success_count?: number | string;
	error_count?: number | string;
	charged_cost?: number | string;
	metered_cost?: number | string;
	standard_cost?: number | string;
	input_tokens?: number | string;
	output_tokens?: number | string;
	cache_read_tokens?: number | string;
	cache_write_tokens?: number | string;
	total_tokens?: number | string;
	avg_latency_ms?: number | string | null;
};

export function mapRequestStatsByRangeRow(row: StatsSqlRow | null | undefined): RequestStatsByRangeRow {
	return {
		totalRequests: Number(row?.total_requests ?? 0),
		successCount: Number(row?.success_count ?? 0),
		errorCount: Number(row?.error_count ?? 0),
		chargedCost: Number(row?.charged_cost ?? 0),
		meteredCost: Number(row?.metered_cost ?? 0),
		standardCost: Number(row?.standard_cost ?? 0),
		inputTokens: Number(row?.input_tokens ?? 0),
		outputTokens: Number(row?.output_tokens ?? 0),
		cacheReadTokens: Number(row?.cache_read_tokens ?? 0),
		cacheWriteTokens: Number(row?.cache_write_tokens ?? 0),
		totalTokens: Number(row?.total_tokens ?? 0),
		avgLatencyMs: row?.avg_latency_ms != null ? Number(row.avg_latency_ms) : null,
	};
}

type TimeseriesSqlRow = {
	bucket?: string;
	request_count?: number | string;
	input_tokens?: number | string;
	output_tokens?: number | string;
	cache_read_tokens?: number | string;
	cache_write_tokens?: number | string;
	total_tokens?: number | string;
	charged_cost?: number | string;
	avg_latency_ms?: number | string | null;
};

export function mapRequestTimeseriesRows(rows: TimeseriesSqlRow[]): RequestTimeseriesRow[] {
	return rows.map((row) => ({
		bucket: String(row.bucket ?? ''),
		requestCount: Number(row.request_count ?? 0),
		inputTokens: Number(row.input_tokens ?? 0),
		outputTokens: Number(row.output_tokens ?? 0),
		cacheReadTokens: Number(row.cache_read_tokens ?? 0),
		cacheWriteTokens: Number(row.cache_write_tokens ?? 0),
		totalTokens: Number(row.total_tokens ?? 0),
		chargedCost: Number(row.charged_cost ?? 0),
		avgLatencyMs: row.avg_latency_ms != null ? Number(row.avg_latency_ms) : null,
	}));
}

type UserTimeseriesSqlRow = {
	bucket?: string;
	user_email?: string;
	total_tokens?: number | string;
};

export function mapUserTokenTimeseriesRows(rows: UserTimeseriesSqlRow[]): UserTokenTimeseriesRow[] {
	return rows.map((row) => ({
		bucket: String(row.bucket ?? ''),
		userEmail: String(row.user_email ?? ''),
		totalTokens: Number(row.total_tokens ?? 0),
	}));
}

export function mapThroughputSnapshot(row: {
	request_count?: number | string;
	total_tokens?: number | string;
} | null | undefined): ThroughputSnapshot {
	return {
		rpm: Number(row?.request_count ?? 0),
		tpm: Number(row?.total_tokens ?? 0),
	};
}

export const REQUEST_STATS_SELECT_SQL = `
	COUNT(*) as total_requests,
	SUM(CASE WHEN status = 'success' THEN 1 ELSE 0 END) as success_count,
	SUM(CASE WHEN status = 'error' THEN 1 ELSE 0 END) as error_count,
	COALESCE(SUM(input_tokens), 0) as input_tokens,
	COALESCE(SUM(output_tokens), 0) as output_tokens,
	COALESCE(SUM(cache_read_tokens), 0) as cache_read_tokens,
	COALESCE(SUM(cache_write_tokens), 0) as cache_write_tokens,
	COALESCE(SUM(total_tokens), 0) as total_tokens,
	AVG(latency_ms) as avg_latency_ms`;

export const REQUEST_TIMESERIES_SELECT_SQL = `
	COUNT(*) as request_count,
	COALESCE(SUM(input_tokens), 0) as input_tokens,
	COALESCE(SUM(output_tokens), 0) as output_tokens,
	COALESCE(SUM(cache_read_tokens), 0) as cache_read_tokens,
	COALESCE(SUM(cache_write_tokens), 0) as cache_write_tokens,
	COALESCE(SUM(total_tokens), 0) as total_tokens,
	AVG(latency_ms) as avg_latency_ms`;
