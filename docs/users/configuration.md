# Admin 配置指南

本页按“部署好以后要做什么”的顺序组织。它不替代 API 文档，只帮助使用者在 Admin 中建立可用配置。

## 1. 先确认实例边界

| 项目 | 说明 |
|------|------|
| Proxy URL | 客户端实际调用地址，例如 `http://localhost:8787` 或 `https://gateway.example.com`。 |
| Admin URL | 管理控制台地址，例如 `http://localhost:8789` 或 `https://gateway-admin.example.com`。 |
| Admin 登录 | 只用于打开管理 UI。 |
| MASTER_KEY | 管理 API Bearer，用于外部系统调用 `/api/admin/*`。生产必须轮换开发默认值。 |
| 用户 API Key | 发给客户端调用 Proxy 的 Key，不应与 MASTER_KEY 混用。 |

## 2. 配置 Provider

Provider 表示一个上游模型入口。配置时重点检查：

- 上游 Base URL 与协议类型是否匹配。
- 上游 API Key 是否真实可用。
- Provider 是否启用。
- 如使用导入模板，导入后仍要检查价格、协议和模型可用性。

Provider 导入模板的维护说明见 [developers/reference/provider-import-presets.md](../developers/reference/provider-import-presets.md)。

## 3. 配置 Provider API Key

同一个 Provider 可以维护多把上游 Key。建议：

- 给每把 Key 设置清晰名称，方便排查。
- 按供应商真实额度设置 RPM / TPM / 并发限制。
- 生产环境将限制设置为供应商真实上限的保守值，避免刚好撞线。
- 失效或不再使用的 Key 及时禁用或删除。

限流、熔断和 sticky 的实现细节见 [developers/architecture/proxy-request-lifecycle.md](../developers/architecture/proxy-request-lifecycle.md)。

## 4. 配置模型与 Route

Route 决定客户端请求的模型 ID 如何转到上游。

常见做法：

- 对客户端暴露稳定的模型名，例如 `gpt-4.1`、`claude-sonnet` 或团队内部命名。
- 同一模型下配置多个 Provider 路由，用优先级、权重或 route group 做切换。
- 在 Route 上配置默认参数，例如思考参数、输出长度或供应商扩展字段。
- 设置价格口径：先维护模型**目录标准价**，再在路由上设用户计费 / 供应成本的基础倍率；如需对齐供应商高峰 / 闲时价，再配置 **Daily schedule**（每日时段倍率，时区见系统配置的业务时区）。
- 在请求日志中核对三笔账：供应成本、目录标准价、用户计费是否符合业务预期。

Route 默认参数合并规则见 [developers/api/user.md](../developers/api/user.md#route-默认参数合并)；时段调价契约见 [developers/api/admin.md](../developers/api/admin.md) 中的 `price_override.schedule`。

## 5. 创建用户与 API Key

用户 API Key 是客户端真正使用的凭证。

建议：

- 为不同人、团队、客户或项目创建独立用户或独立 Key。
- 给 Key 设置可识别名称和 metadata，方便后续审计。
- 为用户设置预算与周期重置策略。
- 停用不再需要的 Key，而不是长期共享一把 Key。

用户、Key、预算和审计的数据模型见 [developers/architecture/user-keys-data-model.md](../developers/architecture/user-keys-data-model.md)。

## 6. 验证调用

最小验证：

```bash
curl -sS http://localhost:8787/health
```

用户推理与各协议客户端示例见 [connect-clients.md](./connect-clients.md)；完整 API 字段见 [developers/api/user.md](../developers/api/user.md)。

预算状态验证：

```bash
curl -sS http://localhost:8787/v1/me \
  -H "Authorization: Bearer sk-your-api-key"
```

## 7. 日常观察

日常排障优先看：

- 请求日志：是否命中正确模型、Provider、Route 和上游 Key。
- 错误状态：401 多半是认证问题；403 常见于预算或配额；502 多与路由或上游有关。
- 成本字段：区分 **供应成本**、**目录标准价**、**用户计费**（日志 / API 字段分别为 `metered_cost`、`standard_cost`、`charged_cost`）。
- 审计日志：确认预算扣减、周期重置、Key 生命周期等事件。

更细的日志和计费语义见 [developers/reference/streaming-billing.md](../developers/reference/streaming-billing.md) 与 [developers/reference/user-audit-logs.md](../developers/reference/user-audit-logs.md)。
