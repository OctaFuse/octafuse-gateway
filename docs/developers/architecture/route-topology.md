# 路由拓扑：请求入口 → 路由池 → 上游目标

Octafuse Gateway 2.0 在原有 `models` / `model_routes` 之上增加显式路由拓扑，把“客户端如何进入模型”和“请求最终发往哪个上游”拆开表示：

```text
model + route_group + request protocol + operation
                    │
                    ▼
         请求入口（Request Surface）
                    │
                    ▼
            路由池（Route Pool）
                    │
                    ├── 上游目标（Upstream Target）A
                    ├── 上游目标（Upstream Target）B
                    └── 上游目标（Upstream Target）C
```

这一结构由迁移 `0016_route_surfaces_pools.sql` 引入。旧路由会自动转换为兼容的通配请求入口与路由池，不要求升级时手工重建。

## 三层对象

| 层 | 数据对象 | 作用 |
|----|----------|------|
| 请求入口（Request Surface） | `model_surfaces` | 以 `model_id + route_group + request_protocol + request_operation` 表示一个公开请求入口，并指向一个路由池。 |
| 路由池（Route Pool） | `route_pools` | 聚合一组可互相故障转移（Failover）的上游目标，并可设置路由池级路由策略。 |
| 上游目标（Upstream Target） | `model_routes` | 描述具体供应商（Provider）、上游模型、`priority`、`weight`、上游协议 / operation、adapter、计费倍率与默认参数。 |

`route_group` 仍属于客户端模型选择语法的一部分，例如 `model-id:free`；请求入口则在选定 group 后进一步区分客户端协议与 operation。

## 请求 operation

当前拓扑白名单中的 operation：

| 请求协议 | operation |
|----------|-----------|
| OpenAI | `chat`、`responses`、`images.generations`、`images.edits`、`audio.transcriptions`、`audio.speech` |
| Anthropic | `messages` |
| Gemini | **`models.generate`**（generate-content 家族，覆盖流式与非流式） |
| DashScope | `audio.transcriptions.*`、`audio.speech.*`（见 [DashScope 音频架构](./dashscope-audio.md)）、`images.generations.multimodal`（见 [DashScope 生图架构](./dashscope-image.md)） |

`*` 是迁移兼容值。运行时先查精确 operation 的请求入口，查不到时再回退同协议的 `*` 请求入口。

> **Gemini v2.2.0**：公开侧 / 上游侧配置只认 `models.generate`。客户端 URL 仍为 `POST /v1beta/models/{model}:{generateContent|streamGenerateContent}`；代理服务（Proxy）用 wire action 派生上游 URL，并把真实 action 写入 `route_trace.gemini.action`。历史 `generateContent` / `streamGenerateContent` 请求入口由迁移 `0017_gemini_models_generate.sql` 合并。详见 [gemini-models-generate-cutover.md](../../operators/migrations/gemini-models-generate-cutover.md)。

> `POST /v1/responses` 已作为 OpenAI Responses 公开入口挂载。请求入口为 `openai` + `responses`，上游同样使用 `openai` + `responses` 与 `adapter=passthrough`。`previous_response_id` 仅在单一上游目标（或不会切换目标的路由池）下透传；多目标且无法保证回到同一上游时返回 `responses.state_route_unavailable`。当前不提供 Conversations、background retrieve/cancel 或 Chat ↔ Responses 转换。

## 运行时解析

1. 从客户端 `model` 解析 `model_id` 与 `route_group`。
2. 根据入口确定 `request_protocol` 与 `request_operation`。
3. 查找 active 的精确请求入口；不存在时查通配请求入口。
4. 读取该请求入口指向的 active 路由池及其 active 上游目标。
5. 同协议、同 operation 使用 `adapter=passthrough`；OpenAI Images / ASR / TTS 转 DashScope 时，必须命中明确的跨协议适配器映射，不能根据模型名猜测。适配器 ID 与映射以 `ADAPTER_REGISTRY` 为唯一来源，见 [adapters-and-drivers.md](./adapters-and-drivers.md)。
6. 若路由池启用供应商粘性（Provider sticky），先查共享绑定；有效且可用的绑定上游目标会跨 `priority` 前置尝试。
7. 对其余候选按 `priority` 分成优先级层，并在同层内应用有效路由策略与 `weight`。
8. 跳过 disabled / 无 key / 已熔断的供应商，逐上游目标故障转移；成功后 bind / touch 粘性，供应商可归因失败时解绑并继续常规计划。

在迁移尚未应用、请求入口查询不可用的滚动发布窗口，代理服务会暂时回退旧的 `model + route_group + protocol` 查询路径，避免代码与 Schema 部署顺序造成中断。该回退只用于升级兼容，不应长期依赖。

## 策略优先级

有效策略按以下顺序解析（层内排序）：

0. `route_pools.tier_strategies[priority]`（该优先级层覆盖）
1. `route_pools.strategy`
2. `models.route_policy.rules[protocol.capability:route_group]`
3. `models.route_policy.rules[protocol:route_group]`
4. `models.route_policy.strategy`
5. `system_config.ROUTE_STRATEGY`
6. 代码默认 `hash_affinity`

路由池级策略只影响当前请求入口指向的路由池；`tier_strategies` 可在同一路由池内让高/低优先级层使用不同排序算法。完整算法见 [route-strategies.md](../reference/route-strategies.md)。

## Admin API

- `POST /admin/routes` 可传 `request_protocol`、`request_operation`、`upstream_protocol`、`upstream_operation`、`adapter`；服务端会创建或复用对应请求入口 / 路由池。
- `PATCH /admin/routes/:id` 可调整上游目标；当请求协议或 operation 改变时会重新关联对应路由池。
- `PATCH /admin/routes/pools/:poolId`，body 可为 `{ "strategy": "hash_affinity", "tier_strategies": { "10": "weight_priority" }, "sticky_routing": { "enabled": true, "idle_ttl_seconds": 3600 } }`；各字段可选；`strategy`/`tier_strategies` 的 `null` / 空值表示清空并继承下一级；`sticky_routing` 写入时递增 `sticky_epoch`。
- `GET /admin/routes` 返回 `route_pool_id`、`pool_strategy`、`pool_tier_strategies` 与序列化的 `surfaces`，供管理后台（Admin）绘制拓扑视图（Topology）。

对外调用管理后台 API 时，路径前面加 `/api`，即 `/api/admin/routes/...`。

## 请求日志与排障

迁移 0016 为 `api_key_request_logs` 增加：

- `request_operation`
- `model_surface_id`
- `route_pool_id`
- `route_target_id`
- `upstream_operation`
- `adapter`
- `route_trace`

排障时先确认请求入口是否匹配，再确认路由池是否 active、是否存在 active 上游目标，最后检查供应商状态、密钥和熔断。`route_trace` 是 JSON 快照，至少包含 `{ surface, pool, target }`；Gemini 请求另含 `gemini.action`（真实 wire action）。启用供应商粘性时还可能包含：

```json
{
  "sticky": {
    "lookup": "hit|miss|expired|invalid_epoch|invalid_target|invalid_circuit|disabled",
    "attempted_target": "model_routes.id",
    "result": "kept|cleared|bound|rebound|storage_error|unchanged"
  }
}
```

`lookup` 描述读取绑定的结果，`attempted_target` 是被前置尝试的上游目标，`result` 在 bind / touch 的 CAS 完成后记录最终绑定动作。可结合 cache read token 与故障转移次数判断供应商粘性是否提高缓存连续性。`route_trace` 记录最终选中（或最后失败）的拓扑标识和关键决策，不是完整 attempt 列表。

管理后台在删除上游目标、或上游目标迁移到新路由池后，会调用 `deleteRoutePoolIfEmpty`：若旧路由池已无任何上游目标，则删除其请求入口与路由池（避免空路由池 / 孤儿请求入口泄漏）。

## 升级兼容

迁移 0016 会按历史 `model_id + route_group + upstream_protocol` 建立路由池，为每个路由池建立 `request_operation='*'` 的兼容请求入口，并把历史 `model_routes` 关联进去。升级步骤与验收清单见 [single-provider-key-cutover.md](../../operators/migrations/single-provider-key-cutover.md)。

迁移 **0017** 将 Gemini 的 `generateContent` / `streamGenerateContent` 请求入口合并为 `models.generate`；冲突路由池降级为 inactive 并加 `[v220-conflict]` 前缀。切换步骤见 [gemini-models-generate-cutover.md](../../operators/migrations/gemini-models-generate-cutover.md)。
