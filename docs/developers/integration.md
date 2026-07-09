# 系统集成指南

本文面向把 Octafuse Gateway 接入自有门户、后台、SaaS 或自动化脚本的开发者。

## 两个 Base URL

| 用途 | 环境变量建议 | 示例 |
|------|--------------|------|
| 用户推理入口 | `GATEWAY_URL` | `https://gateway.example.com` |
| 管理接口入口 | `GATEWAY_MASTER_URL` | `https://gateway-admin.example.com` |

不要把管理请求打到 Proxy。管理 API 由 Admin 提供，对外路径是 `/api/admin/*`。

## 两类 Key

| Key | 用途 | 风险 |
|-----|------|------|
| `GATEWAY_MASTER_KEY` / `MASTER_KEY` | 调用 `/api/admin/*`，创建用户、发 Key、读日志、改配置。 | 高权限，只能放服务端。 |
| 用户 API Key | 客户端调用 `/v1/*`、`/v1beta/*`、`/v1/me`。 | 可发给实际使用方，按用户预算和状态控制。 |

生产环境必须将开发默认 `sk-dev-admin-key` 轮换为强随机值。

## 常见集成流程

1. 在你的系统里创建或同步用户。
2. 调用 Admin API 创建 Gateway 用户。
3. 为该用户创建 API Key，并设置预算、周期和 metadata。
4. 将用户 API Key 展示给客户端，或写入你的服务端配置。
5. 客户端请求 Proxy 的推理接口。
6. 后台定期读取请求日志、审计日志或预算状态，用于对账、风控和展示。

## 最小调用示例

创建 Key 的完整字段以 [api/admin.md](./api/admin.md) 为准。下面只展示调用边界：

```bash
curl -sS "$GATEWAY_MASTER_URL/api/admin/keys" \
  -H "Authorization: Bearer $GATEWAY_MASTER_KEY" \
  -H "Content-Type: application/json" \
  -d '{"name":"customer-001","user":{"external_id":"customer-001","email":"user@example.com"}}'
```

用户侧调用：

```bash
curl -sS "$GATEWAY_URL/v1/me" \
  -H "Authorization: Bearer sk-your-api-key"
```

## 集成时优先关注的 API

| 目标 | 文档 |
|------|------|
| 创建、更新、删除用户与 Key | [api/admin.md](./api/admin.md) |
| 用户推理、模型列表、预算状态 | [api/user.md](./api/user.md) |
| 公开健康检查与目录发现 | [api/public.md](./api/public.md) |

## 数据和语义

- 用户、API Key、预算与审计模型：[architecture/user-keys-data-model.md](./architecture/user-keys-data-model.md)
- 请求生命周期、路由、熔断与 failover：[architecture/proxy-request-lifecycle.md](./architecture/proxy-request-lifecycle.md)
- 流式计费和客户端取消：[reference/streaming-billing.md](./reference/streaming-billing.md)
- 时间与业务时区：[reference/time-and-timezone.md](./reference/time-and-timezone.md)
