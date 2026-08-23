# 适配器与驱动

协议适配器（Protocol adapter）是配置层的稳定 ID；驱动（driver）是运行时实现。两者经常被混称，但属于不同层：**一个驱动可以服务多个适配器**。

**相关文档**：

- 路由拓扑：[route-topology.md](./route-topology.md)
- 请求生命周期：[proxy-request-lifecycle.md](./proxy-request-lifecycle.md)
- DashScope 音频：[dashscope-audio.md](./dashscope-audio.md)

## 术语

| 层 | 名称 | 存放位置 | 例子 |
|----|------|----------|------|
| 配置 / 注册表 | 适配器 ID | `model_routes.adapter`、`packages/core/src/adapters/registry.ts` | `passthrough`、`dashscope-tts-speech` |
| 运行时 | 驱动 | `packages/proxy/src/services/egress/*-driver.ts` | `dashscope-audio-driver.ts` 同时实现四个音频适配器 |

- **适配器**描述「客户端协议 / operation 如何落到上游协议 / operation」，并携带模态、交互形态、计费口径、请求体形态与必需的供应商端点能力。
- **驱动**负责真正的 HTTP / SSE / WebSocket 调用、响应整形与 usage 解析。
- 语义变化时必须发新的适配器 ID，旧 ID 永不复用，以免存量路由被静默改写。

管理后台的路由表单按模型模态列出可选适配器；选中后自动填入四个协议 / operation 字段。展示文案走 i18n（`adapterNames.*`），注册表只承载事实。

## 单一来源

`ADAPTER_REGISTRY` 是适配器事实的唯一来源：

- `packages/core/src/route-topology.ts` 的 `ROUTE_ADAPTERS` / `ROUTE_ADAPTER_MAPPINGS` 从注册表派生，导出名与签名不变。
- 代理服务（Proxy）的 `packages/proxy/src/services/egress/dispatch-table.ts` 按适配器 ID 查实现；一致性测试要求注册表与分发表一一对应，漏实现会在 CI 失败。
- 管理后台（Admin）的 operation 下拉、客户端调用路径、不可选原因与计费口径提示都读注册表，不再手写适配器 ID。

## 新增适配器清单

按顺序做完下列步骤。漏改应在单测失败，而不是运行时才 `Unsupported ... adapter`。

1. **注册表**：在 `packages/core/src/adapters/registry.ts` 增加 `AdapterDescriptor`。至少填写：
   - `id` / `optionKey`
   - `request` / `upstream`
   - `modality` / `modelKind` / `exchange` / `billing`
   - `requestPayload` / `responsePayload`
   - `requiredUpstreamCapabilities`
   - `publicPath`
   - `roles`（是否参与请求入口 / 上游 operation 下拉）
   - 如有能力损失，写 `lossyFeatures`
2. **拓扑派生**：确认 `ROUTE_ADAPTERS` 顺序与 `isRouteAdapterCompatible` 仍符合预期；跑 `packages/core` 的 `registry.test.ts` 与 `route-topology.test.ts`。
3. **分发表**：若该适配器走 OpenAI 音频 / 多模态入口，在 `dispatch-table.ts` 增加实现，并保证一致性测试通过。
4. **驱动**：实现或扩展对应 `*-driver.ts`。一个文件可以挂多个适配器，但不要把无关协议塞进同一驱动。
5. **入口流水线**：
   - 文本类（Chat / Messages / Responses / Gemini）写一份 `ProxyEndpointSpec`，交给 `runProxyPipeline`。
   - 图 / 音频类先复用 `loadProxyRouteSurface` 与 `buildProxyFailoverOptions`；完整记账迁入流水线要等统一 usage 契约（见下文 Layer 2）。
6. **管理后台文案**：在 `packages/admin/messages/*.json` 增加 `adapterNames.<id>`，以及如有需要的计费 / 能力损失提示。
7. **文档**：更新 [route-topology.md](./route-topology.md) 的 operation 表，以及本页相关说明。

不要同时改路由匹配语义、SSE 分帧、usage 计费口径与熔断分类。

## 为后续模态预留

注册表已能表达以下形态，执行内核尚未统一：

| 方向 | 注册表怎么写 | 仍待实现 |
|------|----------------|----------|
| 视频 | `exchange: 'job'`，`responsePayload: 'binary'` | 异步任务提交 / 轮询 / 取结果内核 |
| Embeddings | `unary` + `tokens`，公开路径 `/v1/embeddings` | 入口 spec + 驱动 |
| 更多图 / 音频供应商 | 多数是 `passthrough` 或单个转换适配器 | 注册表加一行、分发表加一行 |

`dashscope-asr-file-async` 已标为 `exchange: 'job'`，是将来抽出任务内核的第一个样本。

`failover-dispatch.ts` 的 `ProxyDispatchMeta` 里多数字段目前仅用于图 / 音频记账。这是下一层统一 usage 契约的入口，本轮不改语义。

## Ingress 流水线

文本类公开入口共用 `packages/proxy/src/services/proxy-pipeline.ts` 的 `runProxyPipeline`：

1. 解析请求与模型
2. 预算预检
3. 解析请求入口与路由池
4. 解析路由策略与供应商粘性（Provider sticky）
5. 用户+模型熔断
6. `failoverDispatch`
7. 5 分钟 usage 兜底后 `recordUsage`

图与音频入口复用其中的选路与策略计算，计费段仍走各自的 `recordImageUsage` / `recordAudioUsage`。
