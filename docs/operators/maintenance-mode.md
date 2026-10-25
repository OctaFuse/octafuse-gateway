# 维护模式

在迁移数据、切换节点或其它维护窗口里，让推理请求收到一个友好的 503，而不是超时或半途失败。后台入口：**系统 → 维护模式**（`/gateway/maintenance`）。接口见 [Admin API · 维护模式](../developers/api/admin.md#admin-maintenance)。

## 行为

开启后：

| 对象 | 行为 |
|------|------|
| 推理入口（`/v1/chat/completions`、`/v1/messages`、`/v1/responses`、图像、音频、向量、`/v1/tools/*`、`/mcp`、Gemini `generateContent`、厂商原生路径、实时 WebSocket） | **503** + `Retry-After` + `X-OctaFuse-Error-Code: gateway.maintenance` + `X-OctaFuse-Maintenance: 1`。发生在鉴权之前：**不写请求日志、不扣费、不占 RPM** |
| `GET /`、`GET /health`、`GET /v1/models`、`GET /v1/me`、`GET /v1/tools/pricing`、`GET /catalog/*`、Gemini 模型列表 | 照常。`/health` 仍返回 200（负载均衡不会把节点判为下线），多一个 `maintenance: true` |
| Admin 写接口（`block_admin_writes` 为真，默认） | 503；`/admin/maintenance`、`/admin/access-keys/*`、`/admin/playground/*` 除外 |
| 已经开始的流式请求 | 不会被中断，结束后正常记账。这也是核心切换需要"等待在途请求"和尾部补偿的原因 |

提示文案可按语言配置（后台的中文 / 英文框，对应 `messages.zh` / `messages.en`），按请求的 `Accept-Language` 选择；没配则用内置文案：`网关维护中，预计 {minutes} 分钟后恢复，请稍后再试`。`{minutes}` 在每次请求时按剩余时间实时计算。

错误体按入口协议给出各家 SDK 能解析的形状，见 [错误码 · `gateway.maintenance`](../developers/api/error-codes.md)。各主流 SDK 对 503 会按 `Retry-After` 自动退避重试，所以短维护通常对调用方只是一次延迟。

## 生效延迟

每个 Proxy 进程缓存配置 **5 秒**，Cloudflare 上每个 isolate 各自缓存。开启或关闭后，最迟 5 秒全网生效；后台会提示这个数字。维护页保存后只让**当前 Admin 进程**立刻看到新值，其它进程仍等缓存过期。

## 安全默认

- 读配置失败（数据库抖动）时 Proxy 与 Admin 都 **fail-open**：继续正常服务。
- 键缺失、空值、JSON 非法都视为未开启。
- 关闭维护时库里只留 `{"enabled":false}`，不保留旧文案和旧结束时间，下次开启不会误带上过期值。
- 预计时长上限 7 天，文案上限 500 字符。
- 后台所有页面顶部在维护期间显示红色横幅，避免忘记关闭。

## 权限

`maintenance.read` 查看、`maintenance.write` 开关。它不包含在 `config.*` 里。需要让外部系统（例如迁移脚本）自动开关维护时，签发一把只有 `maintenance.write` 的集成密钥即可。

## 存储

`system_config.MAINTENANCE_MODE`，JSON 文本，**没有 schema 迁移**，D1、Postgres、MySQL 一致。`PUT /admin/config` 不接受这个键。

```json
{
  "enabled": true,
  "message": "",
  "messages": { "en": "Back in about {minutes} minutes", "zh": "维护中，预计 {minutes} 分钟后恢复" },
  "expected_end_at": "2026-10-25T05:30:00.000Z",
  "block_admin_writes": true
}
```

## 在数据迁移中的位置

维护模式是数据迁移"核心切换"的前提：先开启维护冻结旧端写入，等在途请求结束，再做核心表的最终同步与对账，最后切换 Proxy 流量并在目标端解除维护。日志回填不需要开启维护。
