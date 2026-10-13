# 0030：MCP 服务与目录快照

三库脚本：`packages/core/migrations-{d1,postgres,mysql}/0030_mcp_servers.sql`。

## 变更

- `mcp_servers`：远程 MCP 服务。`slug` 唯一且创建后不改。`url`、`auth_headers` 按密钥存储。默认计费规则（`pricing`）、超时和响应大小上限在服务行上。
- `mcp_server_items`：同步下来的 tool / prompt / resource。唯一键是服务、种类和上游键的 hash。对外名称另有 hash 唯一约束，避免 MySQL 对长 URI 建索引失败。
- 新条目默认 `disabled`。已启用条目的定义变化先写入 `pending_definition`，接受后才替换已发布定义。
- `pricing` 列存带版本与计费模式的 JSON 配置（当前仅支持 request），v2 保存标准价和用户、供应倍率，v1 独立单价继续兼容读取，结构见 [MCP 聚合入口](../../developers/architecture/mcp-gateway.md#计费)。条目上的 `pricing` 为空时继承服务默认规则，非空时整条替换。三种数据库都用文本列，读写逻辑相同。

## 步骤

1. 备份后对目标库执行对应 `0030_mcp_servers.sql`（或官方 migrate）。
2. 滚动更新 Proxy 与 Admin。旧 Proxy 不认识这两张表；新 Proxy 在表缺失时，`GET /v1/tools/pricing` 的 `mcp` 字段返回空数组。
3. 在管理后台 MCP 服务页接入上游，同步后逐条启用。

## 回滚

回退 Proxy / Admin 后，这两张表可以保留。确认不再使用后再 `DROP TABLE mcp_server_items` 与 `mcp_servers`。
