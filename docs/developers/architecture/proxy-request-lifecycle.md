# Proxy 请求处理逻辑

本文档描述 **octafuse-gateway** `packages/proxy` 在收到一次 AI 推理请求后，从 HTTP 入口到上游供应商调用、故障转移（Failover）、异步记账的完整处理路径。

**适用路由**（文本入口共用 `runProxyPipeline`，差异只在 spec；调度内核仍是 `failoverDispatch`）：

| 入口 | 协议 | 路由文件 |
|------|------|----------|
| `POST /v1/chat/completions` | OpenAI | `packages/proxy/src/routes/v1/chat.ts` |
| `POST /v1/responses` | OpenAI Responses | `packages/proxy/src/routes/v1/responses.ts` |
| `POST /v1/messages` | Anthropic | `packages/proxy/src/routes/v1/messages.ts` |
| `POST /v1beta/models/{model}:generateContent` 等 | Gemini | `packages/proxy/src/routes/v1/gemini.ts` |

图与音频入口复用流水线的选路与策略计算，计费仍走各自模块。适配器与驱动的边界见 [adapters-and-drivers.md](./adapters-and-drivers.md)。

**相关文档**：

- 运行时状态与配置列概览：[runtime-data.md](./runtime-data.md) § 路由调度运行时状态
- 路由拓扑：[route-topology.md](./route-topology.md)
- 路由策略详解：[../reference/route-strategies.md](../reference/route-strategies.md)
- 用户 API 故障转移摘要：[供应商故障转移](../api/user.md#提供商故障转移)（目标章节标题暂为历史「提供商」）
- 流式计费与 usage 解析：[../reference/streaming-billing.md](../reference/streaming-billing.md)

---

## 1. 入口与组件

```mermaid
flowchart TB
  subgraph entry [HTTP 入口]
    app["createProxyApp (app.ts)"]
    auth["requireApiKey (middleware/auth.ts)"]
    route["协议路由 chat / messages / responses / gemini / images / audio"]
  end

  subgraph preDispatch [调度前]
    pipeline["runProxyPipeline / loadProxyRouteSurface"]
    model["resolveModelRouting"]
    surface["resolveRoutesForSurface"]
    budget["用户 budget 校验"]
    sensitive["敏感内容熔断检查"]
    strategy["resolveRouteStrategyPlan"]
  end

  subgraph dispatch [供应商调度]
    failover["failoverDispatch"]
    planner["buildRouteAttemptPlan"]
    strategies["route-strategies/*"]
    breaker["provider-circuit-breaker"]
  end

  subgraph upstream [上游]
    driver["openai / anthropic / gemini driver"]
    provider["供应商 API"]
  end

  subgraph post [响应后]
    usage["usagePromise → describeOutcome → buildAccountingEvent → sink"]
  end

  app --> auth --> route --> pipeline
  pipeline --> model --> budget --> surface --> sensitive --> strategy --> failover
  failover --> planner
  planner --> strategies
  planner --> breaker
  failover --> driver --> provider
  driver --> usage
```

| 组件 | 文件 | 职责 |
|------|------|------|
| App 装配 | `packages/proxy/src/app.ts` | Hono 应用、路由挂载、注入 `repositories` |
| 鉴权 | `middleware/auth.ts` → `services/api-key-auth.ts` | 提取 sk、校验用户 API Key、懒重置预算周期 |
| 文本入口流水线 | `services/proxy-pipeline.ts` | Chat / Messages / Responses / Gemini 共用：模型解析、预算、选路、策略、熔断、usage 兜底；记账为 `describeOutcome` → `buildAccountingEvent` → `sink.flush` |
| 模型与请求入口路由 | `resolve-model-route-group.ts`、`model-router.ts` | 解析 `model` / `:route_group`，按 request protocol / operation 查精确或通配请求入口（Request Surface），再读取路由池（Route Pool）的上游目标（Upstream Target）、JOIN 供应商（单键 `api_key`） |
| 策略解析 | `route-strategies/index.ts` → `resolveRouteStrategyPlan` | 先解析路由池 → capability rule → protocol rule → model → global → `hash_affinity` 的 base，再叠加 `tier_strategies[priority]` |
| 代理入口 | `services/proxy.ts` | 三协议（及 Images / Audio）统一调用 `failoverDispatch` |
| 故障转移 | `services/failover-dispatch.ts` | 编排 attempt、逐供应商打上游、熔断与 429 全忙 |
| 调度计划 | `services/route-attempt-planner.ts` | `buildRouteAttemptPlan`：priority 硬序 + 层内策略排序 + 跳过熔断供应商 |
| 供应商熔断 | `services/provider-circuit-breaker.ts` | 按 `providers.id`：429 / 401 / 403 / 5xx |
| 失败分类 | `services/upstream-failure-classifier.ts` | 决定 retry（换供应商）vs fail_immediately |
| User+model 熔断 | `services/user-model-circuit-*.ts` | 敏感 / 普通 400 共用短递增（user+model）；code 区分 |
| 错误码 | `services/gateway-error-codes.ts` / `gateway-error-response.ts` | `gateway.*` / `circuit.*` / `upstream.*` + `X-OctaFuse-Error-Code` |
| 用量记账 | `services/accounting/*`、`services/usage-tracker.ts` | 纯函数合成可序列化 `AccountingEvent`（含稳定 `requestLogId`）；默认 sink 直接 `recordUsage` 写 `api_key_request_logs`、累加 `budget_spent` |

> **客户端约定**：非 2xx 时以响应头 **`X-OctaFuse-Error-Code`**（及网关自造错误 body 顶层 / 嵌套 `code`）为**分类权威**；`error` / `error.message` 仍保留人类可读原文（上游透传或固定英文短句）。集成方应优先按该 code 分类，再回退英文文案。

> **已移除**：供应商 key pool、旧 `models.sticky_config`、网关侧 RPM/TPM/并发软限流（`limit_config`）。一个供应商 = 一把 `api_key` + `status`。跨请求供应商粘性（Provider sticky）见路由池配置与 `route_pool_sticky_bindings`。

---

## 2. 请求生命周期（逐步）

以下以 `POST /v1/chat/completions` 为例；`/v1/responses`、`/v1/messages`、Gemini、Images、Audio 在「协议过滤」与 driver 处不同，调度内核一致。

### 2.1 鉴权与解析

1. **`requireApiKey`**：从 `Authorization: Bearer sk-...`、`x-api-key` 或 query `key` 提取密钥；`authenticateApiKey` 查库并注入 `c.set('apiKey')`（含 `userId`、`budgetMax`、`budgetSpent`、`walletGranted`、`walletSpent` 等）。若 Key 或用户配置了 `rate_limit.rpm`，先消耗 Key 窗口再消耗用户合计窗口（两层都是从当前时刻回溯 60 秒）；超限返回 **429** `gateway.rate_limited`。`GET /v1/me` 两层都不计入。
2. **解析 JSON body**：非法 JSON → **400**；缺少 `model` → **400**。
3. **`resolveModelRouting`**：支持 `baseModelId` 或 `baseModelId:route_group`；模型不存在 → **404**。
4. **用户额度**：`hasPositiveTotalBalance(budgetMax, budgetSpent, walletGranted, walletSpent)` 为假 → **403**。`budgetMax == null` 表示周期不限额；否则看周期剩余 + 永久余额。**`budgetMax=0` 且 wallet 仍有余额时允许请求**（勿用旧式 `budgetSpent >= budgetMax`，`0 >= 0` 会误杀）。
5. **请求入口 / 路由池查询**：
   - `resolveRoutesForSurface` 按 `modelId + routeGroup + requestProtocol + requestOperation` 查精确请求入口，未命中时回退 `request_operation='*'`
   - 请求入口命中后按 `route_pool_id` 读取 active 上游目标；滚动升级期间若 0016 尚不可用，临时回退旧的 model / group 路径
   - `resolveRouteResultsFromRows` → `RouteResult[]`（携带请求入口 / 路由池 / 上游目标、operation、`providerApiKey`、`routePriority`、`routeWeight`；**供应商 disabled / 无 api_key 的行会被跳过**）
   - 无匹配请求入口、路由池或上游目标 → **400 / 502**
6. **协议 / adapter 过滤**：`isRouteAdapterCompatible` 按注册表校验请求入口与上游目标。`passthrough` 仅允许同协议、同 operation；转换 adapter 必须精确匹配注册表声明的 request / upstream 映射。无匹配 → **502**。
7. **`resolveRouteStrategyPlan`**：解析 base（`route_pools.strategy` → `models.route_policy` → `system_config.ROUTE_STRATEGY`）以及 `route_pools.tier_strategies`；编排时每层优先用 tier override（见 [route-strategies.md](../reference/route-strategies.md)）。
8. **Adapter / Driver 出站**：文本透传入口使用对应协议 driver；Images / Audio 由 `dispatch-table.ts` 按 adapter 选择转换 driver。各 driver 再按 capability 调用 `resolveUpstreamEndpoint`；Gemini 鉴权与 `alt=sse` 仍由 `prepareGeminiUpstreamFetch` 处理。

### 2.2 User+model 熔断（调度前）

Gateway 策略统一保护供应商；**退避不区分**敏感 / 普通 400，客户端靠 code 分流。

- **`maybeBlockUserModelCircuit`**：查 `userId + baseModelId`。
  - **敏感内容**短路 → **429** `circuit.sensitive_content` + `Retry-After`
  - **普通 400**短路 → **400** `circuit.client_error`（回放缓存的上游错误原文，无 `Retry-After`）
- 上游触发（敏感词命中，或非敏感 `status === 400`）：共用递增退避 **20s → 1min → 3min → 5min → 10min**（窗口内不累加；`reason` 记最近一次触发类别）
- **2xx** → `markUserModelSuccess` 清零该 user+model 状态
- 与供应商熔断 **独立**；**不**按请求体内容区分
- **Images / Audio 例外**：`/v1/images/*`、`/v1/audio/transcriptions` 传 `clientErrorCircuitEnabled: false`——**不**因普通上游 400 写入或短路 `client_error`（尺寸/格式等可修正错误常见，agent 改参后应立即重试）；**仍**参与 `sensitive_content` 熔断。chat / messages / gemini 默认开启普通 400 熔断。

**敏感内容识别**（`sensitive-content-detector.ts`）：对上游错误原文 / 格式化摘要做**大小写不敏感**子串匹配，命中任一即记 `sensitive_content`（不限 HTTP 状态码为 400，但实务上多为 400）。关键词包括：

| 语言 | 子串（节选） |
|------|----------------|
| 英文 | `sensitive content`、`unsafe or sensitive`、`inappropriate content`、`datainspectionfailed` / `data inspection failed`、`content policy`、`policy violation`、`safety filter`、`blocked by safety`、`moderation` |
| 中文 | `敏感内容`、`不安全或敏感`、`内容安全`、`内容审核`、`违规内容`、`不适宜内容` |

实现以代码清单为准；增补关键词时同步更新本表与单测 `sensitive-content-detector.test.ts`。

### 2.3 供应商调度与上游调用

**`proxyChatCompletions` → `failoverDispatch`**：

1. 再次按 `expectedProtocol` 过滤 routes。
2. 无可用 route → **502** `No routes configured`（`gateway.no_route`）。
3. **`buildRouteAttemptPlan`**：按 priority 分层 → 层内策略排序 → 跳过熔断中的供应商（见 §3）。
4. **`plan.attempts.length === 0`**（全部熔断）→ **429** `circuit.upstream_capacity_exhausted` + `Retry-After`（**零上游调用**）。
5. **逐 attempt 执行**：
   - **循环开头复查** `getProviderCircuitRemainingMs`：本次请求内刚被熔断的同 `providerId` 多上游目标直接跳过
   - 调用协议 driver（`fetch` 上游）
   - **成功 (2xx)**：`markProviderSuccess` → 返回响应
   - **fetch 异常**：内部记 502 → **换下一供应商**（同次故障转移；**不**写跨请求熔断）
   - **非 2xx**：`classifyUpstreamHttpFailure`：
     - `fail_immediately`（400/404 等；Images abort 的合成 504）→ **直接返回该响应**，不重试
     - `retry_key` → 按类别 `markProviderFailure`（若有 `failureKind`）→ **换下一供应商**
6. 全部 attempt 失败 → 返回**最后一次**上游响应（可能是 429/5xx/4xx）。

### 2.4 响应与异步记账

1. **`materializeNonOkResponse`**：非 2xx 时物化 body 供日志与敏感内容检测。
2. **`usagePromise`** 与 **5min 超时** race：流结束解析 token；超时记 `incomplete`。
3. **`describeOutcome`**：按协议解读 usage 是否完整、错误文案、上游 request id 与额外字段（如 Gemini `gemini_wire_action`）。
4. **`buildAccountingEvent`**：纯函数合成可序列化记账事件，并在此生成 `requestLogId`（写库语义不变）。
5. **`scheduleBackgroundWork` → `sink.flush`**：默认 sink 直接 `recordUsage`，写 `api_key_request_logs`、累加 `budget_spent`；失败时可选 webhook 告警。图 / 音频入口尚未走该接缝。

```mermaid
sequenceDiagram
  participant C as Client
  participant R as ProtocolRoute
  participant F as failoverDispatch
  participant S as buildRouteAttemptPlan
  participant U as Upstream

  C->>R: POST /v1/chat/completions
  R->>R: auth, model, budget, 请求入口/路由池, strategy
  R->>R: sensitive circuit check
  R->>F: proxyChatCompletions(affinityKey, strategy)
  F->>S: buildRouteAttemptPlan
  alt attempts empty
    F-->>C: 429 upstream_capacity_exhausted
  end
  loop each RouteAttempt
    F->>U: dispatch (fetch)
    alt 2xx
      F->>F: markProviderSuccess
      F-->>C: response + stream
    else retryable
      F->>F: markProviderFailure (if failureKind)
    else fail_immediately
      F-->>C: upstream 4xx / abort
    end
  end
  R->>R: sink.flush / recordUsage (background)
```

---

## 3. 路由调度决策顺序

`buildRouteAttemptPlan`（`route-attempt-planner.ts`）是 **priority 分层、层内策略、供应商熔断** 的交汇点。

### 3.1 排序规则

1. 按 **`model_routes.priority` 降序**分成优先级层（数字越大越先试）。
2. **同层（同 priority）** 内调用当前策略（`hash_affinity` / `weighted_random` / `weight_priority` / `weighted_round_robin`）排序；策略使用 `model_routes.weight`（默认 1）。
3. 对每个候选：若 **`getProviderCircuitRemainingMs(providerId) > 0`** → 跳过，记录最早恢复时间。
4. 高优先级层全部试完（或跳过）后，才进入下一层。

策略语义、affinityKey / tierKey、六级解析见 [route-strategies.md](../reference/route-strategies.md)。

### 3.2 供应商熔断策略

熔断维度为 **`providers.id`**（单键化后不再有 per-key 熔断）。

| 失败类别 | 触发 | 冷却 |
|----------|------|------|
| `rate_limit` | 上游 **429** | 优先 `Retry-After`（封顶 15min）；否则连续 429 递增：**5s → 15s → 30s → 60s（封顶）** |
| `auth` | **401 / 403** | 固定 **5min** + 告警日志 |
| `server` | 普通 **5xx** | 连续 **3** 次后短熔断 **10s** |

- **524** 与 **fetch 抛错**：仅同次请求内故障转移，**不**写入跨请求熔断。
- `openUntil = max(现有, now + cooldown)`，短冷却不会覆盖更长冷却。
- **成功 (2xx)** → `markProviderSuccess`，清零连续 429 / server 计数。
- 熔断中的供应商 **一律跳过**。

### 3.3 粘性 / 限流说明

- 默认策略 **`hash_affinity`**（加权 Rendezvous hash）在同用户 + 模型 + group + 协议下给出稳定首选供应商，以利于上游 prompt cache。
- 可选 **供应商粘性**（路由池级）：成功后跨请求绑定上游目标（共享 DB）；有效时可跨 priority 优先尝试；见 [route-strategies.md](../reference/route-strategies.md)「供应商粘性」。
- **无**网关侧 TPM/并发软限流；旧 `limit_config` 已移除。Key / 用户 `rate_limit.rpm` 为鉴权后进程内存窗口（见 [user-keys-data-model.md](./user-keys-data-model.md)）。供应商限额仍由上游 429 与熔断间接体现。

> **调试台除外**：管理后台（Admin）的 **`playground-service`** 直连单条 route 打上游，**不经过** `failoverDispatch`，因此无故障转移 / 策略排序；生产代理服务（Proxy）路径才生效。

---

## 4. 场景分支表

### 4.1 调度前短路（不打上游）

| 场景 | HTTP | 响应要点 | 是否记账 |
|------|------|----------|----------|
| 非法 JSON | 400 | `Invalid JSON body` | 否 |
| 缺少 model | 400 | `Missing model` | 否 |
| Images edits 非 multipart Content-Type | 400 | `Unsupported Content-Type for /v1/images/edits…`（结构化 warn 日志） | 否 |
| Images edits multipart 非法 | 400 | `Invalid multipart body` | 否 |
| 模型不存在 | 404 | `Model not found` | 否 |
| 用户 budget 耗尽 | 403 | `Budget exceeded` | 否 |
| Key / 用户 RPM 超限 | 429 | `gateway.rate_limited` + `Retry-After` | 否 |
| 无匹配请求入口 / active 路由池上游目标 | 400 / 502 | `No active routes ...` / `No routes configured` 等 | 否 |
| 无协议 / adapter 匹配上游目标或无可用供应商 | 502 | `No OpenAI route ...` / `No routes configured` 等 | 否 |
| 敏感内容熔断中 | 429 | `circuit.sensitive_content` + `Retry-After`（退避档位与普通 400 相同） | 是（error） |
| 上游 400 客户端错误熔断中 | 400 | `circuit.client_error`（回放原文）；**images / audio 不短路此 reason** | 是（error） |
| 全部供应商熔断 | 429 | `circuit.upstream_capacity_exhausted` + `Retry-After` | 否 |

### 4.2 调度后 / 上游交互

| 场景 | 行为 | 客户端最终看到 |
|------|------|----------------|
| 首个 attempt 2xx | 成功返回 | 上游 2xx + stream |
| 上游 429 | 熔断该供应商，换下一 route | 若后续成功 → 2xx；全失败 → 最后上游 429 |
| 上游普通 5xx | 累计；连续 3 次后 10s 熔断，换供应商 | 最后上游 5xx 或后续成功 |
| 上游 401/403 | 5min 熔断 + warn 日志，换供应商 | 最后上游响应或后续成功 |
| 上游 400（敏感） | fail_immediately + user+model 粗粒度熔断 | 透传 400；响应头 `upstream.content_filter` |
| 上游 400（其他） | fail_immediately；chat/messages/gemini → user+model 短递增熔断；**images/audio 不记 `client_error`** | 透传 400；响应头 `upstream.invalid_request` |
| 上游 404 等 | **fail_immediately**，不重试 | 直接透传该 4xx |
| fetch 网络错误 / 524 | 同次换供应商，不跨请求熔断 | 全失败时最后 502 或上游响应 |
| Images 客户端取消 / Gateway 超时 | 合成 504，**禁止**故障转移 | 504 |
| 流式 usage 5min 未就绪 | **不**触发供应商熔断 | 2xx 仍返回；日志 `incomplete` |

### 4.3 两类 429 的区别

| 来源 | 含义 | Body 特征 |
|------|------|-----------|
| **网关生成** | Key / 用户 RPM 超限 | `code: gateway.rate_limited` + `Retry-After`，**未调用上游** |
| **网关生成** | 调度阶段无任何可试供应商 | `code: circuit.upstream_capacity_exhausted`，**未调用上游** |
| **上游返回** | 某供应商被上游限流 | 换供应商重试；全失败则**透传最后上游 429** |

---

## 5. 状态与一致性

以下为**单实例进程内存**（与敏感内容熔断相同）：

| 状态 | 作用域 | Workers 多 isolate |
|------|--------|-------------------|
| 供应商熔断 | per `providerId` | 各 isolate 独立 → **软限制** |
| Round-robin 计数 | per `tierKey` | 同上 |
| User+model 熔断 | per `userId + modelId` | 同上 |
| `ROUTE_STRATEGY` 缓存 | 全局，TTL **30s** | 各 isolate 独立缓存 |

**配置来源**（迁移 **0015 / 0016**，三库同语义）：

| 列 / 键 | 含义 |
|---------|------|
| `providers.api_key` / `providers.status` | 单键；`active` \| `disabled` |
| `model_surfaces` / `route_pools` | 请求入口映射与故障转移池；路由池可设策略 |
| `model_routes.priority` / `weight` | 优先级层（DESC）+ 层内权重（默认 1） |
| `model_routes.route_pool_id` / `upstream_operation` / `adapter` | 上游目标所属路由池、上游 operation 与转换方式 |
| `models.route_policy` | 可选 per-model / per-capability 策略覆盖 |
| `system_config.ROUTE_STRATEGY` | 全局缺省（默认 `hash_affinity`） |

---

## 6. 可观测性与日志

### 6.1 关键日志（Proxy stdout）

| 日志片段 | 含义 |
|----------|------|
| `calling provider providerId=...` | 开始 attempt |
| `provider non-OK, trying next candidate ... status=...` | 可重试失败，换供应商 |
| `fetch failed ... error=...` | 网络/fetch 异常 |
| `provider auth issue, trying next provider ...` | 401/403 告警 |
| `recordUsage failed ...` | 后台记账失败 |

### 6.2 用量日志字段

成功或失败后均异步写入 `api_key_request_logs`，含：

- `provider_key_id` / `provider_key_label` / `provider_key_fingerprint`：**现为** `providers.id` / `providers.name` / `fingerprint(api_key)`（列名历史兼容）
- `route_group`、`request_protocol`、`upstream_protocol`
- `status`：`success` / `error` / `incomplete` / `cancelled`
- `metered_cost` / `charged_cost` 等（见 streaming-billing 文档）

### 6.3 错误告警 Webhook

代理服务在 `status = error` 且用量写入成功后，可向企业微信/飞书 webhook 发送归类摘要。配置见 [admin.md](../api/admin.md)。

---

## 7. 代码索引（快速跳转）

```
packages/proxy/src/
├── app.ts                          # 路由挂载
├── middleware/auth.ts              # requireApiKey
├── routes/v1/
│   ├── chat.ts                     # OpenAI 主链路模板
│   ├── messages.ts                 # Anthropic
│   ├── gemini.ts                   # Gemini
│   ├── images.ts / audio.ts        # Images / Audio
└── services/
    ├── proxy.ts                    # → failoverDispatch
    ├── failover-dispatch.ts        # 调度执行、429 全忙
    ├── route-attempt-planner.ts    # buildRouteAttemptPlan
    ├── route-strategies/           # hash_affinity / weighted_random / weight_priority / weighted_round_robin
    ├── provider-circuit-breaker.ts
    ├── user-model-circuit-breaker.ts / user-model-circuit-route.ts
    ├── gateway-error-codes.ts / gateway-error-response.ts / upstream-error-code.ts
    ├── upstream-failure-classifier.ts
    └── usage-tracker.ts
```

单测契约见 `packages/proxy/src/services/*.test.ts`（`failover-dispatch.test.ts`、`user-model-circuit-breaker.test.ts`、`gateway-error-response.test.ts`、`route-attempt-planner.test.ts` 等）。
