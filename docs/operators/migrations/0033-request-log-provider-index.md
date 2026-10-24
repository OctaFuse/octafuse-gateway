# 0033：请求日志按 Provider 与时间检索的索引

三库脚本：`packages/core/migrations-{d1,postgres,mysql}/0033_request_log_provider_index.sql`。

## 变更

在 `api_key_request_logs` 上增加索引 `idx_api_key_request_logs_provider_created(provider_id, created_at)`。

此前只有 `created_at` 单列索引，按 Provider 加时间范围过滤时，要先扫出区间内所有 Provider 的行再逐行过滤。新增 `GET /admin/request-logs/summary`（门户对账用）和 `GET /admin/request-logs?provider_ids=` 都依赖这个索引。

## 步骤

1. 备份后对目标库执行对应 `0033_request_log_provider_index.sql`（或官方 migrate）。只加索引，不改列，新旧版本的 Proxy / Admin 都能照常读写，顺序不限。
2. 请求日志表很大时，Postgres 建索引会持有写锁。可以在低峰先手工执行同名索引再跑迁移，迁移里的 `IF NOT EXISTS` 会直接跳过：

```sql
SET search_path TO octafuse_gateway;
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_api_key_request_logs_provider_created
  ON api_key_request_logs(provider_id, created_at);
```

   `CONCURRENTLY` 不能在事务里执行，需要单独连接运行。MySQL 8 的 `CREATE INDEX` 默认在线，D1 写入会在建索引期间短暂排队。

## 回滚

`DROP INDEX idx_api_key_request_logs_provider_created`（MySQL 需 `ON api_key_request_logs`）。仅影响查询速度。
