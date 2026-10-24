-- 按 Provider 与时间范围检索请求日志：门户对账的费用聚合、`GET /admin/request-logs?provider_ids=`
-- 都以 provider_id 加 created_at 范围过滤。此前只有 created_at 单列索引，会先扫区间内所有 Provider 的行再过滤。
CREATE INDEX idx_api_key_request_logs_provider_created
  ON api_key_request_logs(provider_id, created_at);
