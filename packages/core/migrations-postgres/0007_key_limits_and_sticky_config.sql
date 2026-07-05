-- Runtime scheduling configs (both JSON, NULL = feature off / unlimited):
--   provider_api_keys.limit_config — per-key rate limits, e.g. {"rpm":500,"tpm":200000,"max_concurrency":32}
--   models.sticky_config           — sticky key routing rules keyed by "{protocol}:{route_group}"
ALTER TABLE provider_api_keys ADD COLUMN limit_config TEXT;
ALTER TABLE models ADD COLUMN sticky_config TEXT;
