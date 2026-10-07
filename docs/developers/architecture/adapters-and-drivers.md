# 适配器与驱动

协议适配器（Protocol adapter）是配置层的稳定 ID；驱动（driver）是运行时实现。两者经常被混称，但属于不同层：**一个驱动可以服务多个适配器**。

**相关文档**：

- 路由拓扑：[route-topology.md](./route-topology.md)
- 请求生命周期：[proxy-request-lifecycle.md](./proxy-request-lifecycle.md)
- DashScope 音频：[dashscope-audio.md](./dashscope-audio.md)
- DashScope 生图：[dashscope-image.md](./dashscope-image.md)
- MiniMax 音频：[minimax-audio.md](./minimax-audio.md)
- MiniMax 生图：[minimax-image.md](./minimax-image.md)

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
   - `lossyFeatures` 只登记上游接口没有的能力。OpenAI 字段未映射、但上游有别的字段可传时，写 Admin 的 `adapterGuides`，不要放这里
   - OpenAI 入口的生图 / 音频转换适配器必须声明 `protectedUpstreamPaths`（可以是空数组）。`model` 由网关统一保留，不必再写。需要给路由页示例时填写 `extraBodyExample`；DashScope 语音合成若客户端无法设置 `input.*`，写 `extraBodyNote: 'dashscope_tts_input'`
2. **拓扑派生**：确认 `ROUTE_ADAPTERS` 顺序与 `isRouteAdapterCompatible` 仍符合预期；跑 `packages/core` 的 `registry.test.ts` 与 `route-topology.test.ts`。
3. **分发表**：若该适配器走 OpenAI 音频 / 多模态入口，在 `dispatch-table.ts` 增加实现，并保证一致性测试通过。
4. **驱动**：实现或扩展对应 `*-driver.ts`。一个文件可以挂多个适配器，但不要把无关协议塞进同一驱动。
5. **入口流水线**：
   - 文本类（Chat / Messages / Responses / Gemini）写一份 `ProxyEndpointSpec`，交给 `runProxyPipeline`。计费口径与脱敏写在同一 `accounting` 对象上（`describeOutcome` + `requestBodyForLog` / `upstreamWireBodyForLog`）。
   - 图 / 音频类先复用 `loadProxyRouteSurface` 与 `buildProxyFailoverOptions`；计费仍走 `recordImageUsage` / `recordAudioUsage`。把它们迁入同一 `AccountingEvent` + sink 是后续增量，本阶段不改口径。
6. **管理后台文案**：在 `packages/admin/messages/*.json` 增加 `adapterNames.<id>`，以及 `routes.modal.adapterGuides.<id>` 的 `purpose` 与 `mapping`。上游没有的能力用 `lossyFeatureNames`。
7. **文档**：更新 [route-topology.md](./route-topology.md) 的 operation 表，以及本页相关说明。

不要同时改路由匹配语义、SSE 分帧、usage 计费口径与熔断分类。

## OpenAI 入口的额外字段

生图和音频的 OpenAI 入口会把客户端额外传入的顶层字段深度合并进适配器已经建好的上游请求体。OpenAI SDK 的 `extra_body` 发到线上就是这些平铺字段，网关不要求名为 `extra_body` 的容器。curl 直接写在请求体顶层，效果相同。

入口已经解析过的 OpenAI 字段不会再原样合并。其余字段全部转发，网关不判断上游是否支持；上游不认就由上游报错。额外字段 JSON 超过 32KB 时返回 400。数组整体替换，语义与路由 `custom_params` 的深度合并相同。故障转移的每一次尝试都合并同一份额外字段。混合协议的路由池会把同一份上游结构发给不同协议，使用时需要确认这些字段在每条路由上都合法。

合并顺序（后者覆盖前者）：

1. 路由 `custom_params` 的 body 默认值
2. 适配器构建的请求体
3. 客户端额外字段
4. 路由 `custom_params` 的 `force_override.body`
5. 恢复受保护路径

`model` 始终恢复成适配器自己的值。各适配器在注册表的 `protectedUpstreamPaths` 里声明其余不能交给客户端的路径，这些路径关系到计费或响应解析。被改回的路径会记在请求日志的 `restored_upstream_paths`，额外字段记在 `extra_fields`（data URL 会脱敏）。除这些路径外，同名覆盖由调用方自己注意。

DashScope 语音合成的上游 `input` 是对象，OpenAI 的 `input` 是文本，客户端无法通过额外字段设置 `input.*`。这类参数写在路由 `custom_params`，或改走原生透传路由。

原生透传路由（`/v1/minimax/*`、`/v1/dashscope/*`）、实时 WebSocket 和异步任务入口不走这套合并。文本 Chat / Messages / Responses 本来就转发整个请求体。

## 为后续模态预留

注册表已能表达以下形态，执行内核尚未统一：

| 方向 | 注册表怎么写 | 仍待实现 |
|------|----------------|----------|
| 视频 | `exchange: 'job'`，`responsePayload: 'binary'` | 异步任务提交 / 轮询 / 取结果内核 |
| Embeddings | `unary` + `tokens`，公开路径 `/v1/embeddings` | 入口 spec + 驱动 |
| 更多图 / 音频供应商 | 多数是 `passthrough` 或单个转换适配器 | 注册表加一行、分发表加一行 |

`dashscope-asr-file-async` 已标为 `exchange: 'job'`，是将来抽出任务内核的第一个样本。

`failover-dispatch.ts` 的 `ProxyDispatchMeta` 里多数字段目前仅用于图 / 音频记账。文本入口已抽出可序列化的 `AccountingEvent` 与直接 flush 的 sink 接缝（`dispatch → describeOutcome → buildAccountingEvent → sink.flush`）；图 / 音频尚未迁入该接缝，本轮不改它们的计费口径。

## Ingress 流水线

文本类公开入口共用 `packages/proxy/src/services/proxy-pipeline.ts` 的 `runProxyPipeline`：

1. 解析请求与模型
2. 预算预检
3. 解析请求入口与路由池
4. 解析路由策略与供应商粘性（Provider sticky）
5. 用户+模型熔断
6. `failoverDispatch`
7. usage 兜底后：`describeOutcome` → `buildAccountingEvent` → `sink.flush`（默认直接 `recordUsage`）

协议转发层（parse / dispatch、SSE 分帧、熔断分类）与记账层分离：各端点只提供协议相关 hook，记账事件由纯函数合成，sink 是唯一写库接缝。

图与音频入口复用其中的选路与策略计算，计费段仍走各自的 `recordImageUsage` / `recordAudioUsage`，尚未进入上述 sink。
