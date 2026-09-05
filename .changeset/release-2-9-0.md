---
"octafuse": minor
---

OctaFuse Gateway v2.9.0 重点完善流量治理、用量观测和管理体验：管理员可以分别限制用户与单把 API Key 的请求频率，通过密钥分析和入口域名记录定位流量来源；管理后台总览、路由调试与 Cloudflare 多域名部署也同步升级。

### Proxy

- **用户与 API Key 双层限流**：用户级 RPM 控制该用户所有 Key 的合计请求量，Key 级 RPM 控制单把密钥。两层独立执行，并按当前时刻向前回溯 60 秒，不会在 UTC 自然分钟切换时重置。
- **清晰的超限反馈**：超过任一层上限时返回 `429 gateway.rate_limited`，并通过 `Retry-After` 告知再次尝试前的等待时间；`GET /v1/me` 不参与两层计数。
- **入口与密钥观测**：请求日志新增 `ingress_host`，用于记录请求实际进入的 Host，但不参与访问控制；写入请求用量时同步更新 API Key 的 `last_used_at`。
- **路由自定义请求头**：`custom_params.headers` 作为上游 HTTP Headers 发送，不再混入 JSON 请求体；鉴权、Host、Content-Length 等受保护请求头不会被自定义值覆盖。
- **默认参数合并**：除 `headers` 外的 `custom_params` 继续作为请求体默认值，并与客户端 JSON 深度合并；客户端显式值优先，因此该配置不能作为强制参数上限。
- **计费记录一致性**：Chat、Responses、Anthropic Messages 和 Gemini 共用结构化的计费记录流程，统一整理用量、错误和上游请求 ID 后再写入日志；现有计费口径保持不变。
- **Images Edits 兼容**：单张参考图使用 `image`，多张参考图使用 `image[]`，提升不同 OpenAI 兼容上游的接收兼容性。

### Admin

- **限流配置**：用户详情可设置用户合计 RPM，用户列表会同步展示该限制，Keys 页面可设置单 Key RPM；空值表示不限，`0` 表示拒绝所有计次请求，小数和负数会被界面与 Admin API 一致拒绝。
- **运营总览**：Dashboard 集中展示请求量、成功率、平均延迟、用户费用、趋势、热门模型、活跃用户、近期请求和错误信息。
- **密钥分析**：新增按 API Key 汇总的请求量、Token、费用和最近使用时间；用户请求日志支持按 `api_key_id` 筛选，便于定位具体客户端或应用。
- **分析页面对比**：模型、供应商和用户用量页面支持同时展开多条明细，减少逐项对比时反复开合。
- **路由调试**：路由编辑将上游请求头与 JSON 默认参数分开配置；Playground 可预览最终发送的请求头和上游请求体，鉴权类敏感请求头会自动脱敏。
- **供应商与模型目录**：新增 SiliconFlow 国际站导入模板并区分国内、国际端点，在供应商导入和配置界面补充平台或密钥页面快捷入口；新增 Gemini 3.8 Flash 模型预设，为 DeepSeek V4 Pro / Flash 的内置预设补齐工作日官方高峰时段，并修正 23 个阿里云百炼模型的 USD / CNY 预设价格。
- **自托管管理后台修复**：修复 Node / Docker 管理后台经反向代理访问时，创建或修改集成密钥可能被同源校验误判为 `403` 的问题；非同源写操作仍会被拒绝。
- **交互一致性**：多处保存、删除和异常反馈统一使用页面通知与确认对话框。

### Core / 部署

- **迁移 0028**：`users.rate_limit` 保存用户共享限流，`api_keys.rate_limit` 保存单 Key 限流；`api_key_request_logs.ingress_host` 保存入口 Host，并增加 `ingress_host + created_at` 查询索引。D1、Postgres、MySQL 语义一致。
- **滚动窗口实现**：Key 与用户窗口分别维护过去 60 秒的请求时间，跨 UTC 自然分钟不会重置；实际超限层决定本次 `Retry-After`。
- **Cloudflare 多域名**：`PROXY_CUSTOM_DOMAIN` 与 `ADMIN_CUSTOM_DOMAIN` 支持以逗号分隔多个自定义域名；空白项会被忽略，重复域名会去重，单域名配置继续兼容。
- **计价展示修正**：同优先级、同权重路由在展示代表价格时优先采用当前综合倍率更低的路由，使目录折扣更贴近可用价格；实际请求仍遵循原有选路策略。

### 文档

- **限流与观测**：补充用户 / Key 双层 RPM、滚动窗口、`Retry-After`、`GET /v1/me` 豁免、单实例软上限与入口 Host 的接口和数据模型说明。
- **路由请求配置**：明确自定义 Headers、请求体默认参数、客户端值优先规则和受保护请求头边界。
- **Cloudflare 部署**：补充多域名环境变量格式、生成配置和部署行为。

### 升级说明

- **数据库迁移**：必须应用 **0028**；新列均可空，未配置 `rate_limit` 的存量用户与 API Key 保持不限流。
- **发布顺序**：备份数据库后先运行 v2.9.0 migrate，再滚动更新同版本 Proxy 与 Admin。回退旧版本时可保留新增列，无需立即删除。
- **限流边界**：RPM 计数默认保存在每个 Proxy 进程 / isolate 内存中；Node 单进程接近精确，多进程、多副本或 Cloudflare 多 isolate 场景属于软上限，重启会重置窗口状态。
- **配置兼容**：现有客户端 API 路径和鉴权方式保持不变，旧的单域名环境变量继续有效。用户级与 Key 级 RPM 不要求互相复制或满足大小关系。
- **路由参数**：`custom_params.headers` 仅用于上游请求头；其余 `custom_params` 是默认请求体参数。客户端显式参数优先，不能仅凭此配置实现强制封顶。
- **建议核验**：验证用户与 Key 两层 RPM、429 `Retry-After`、`GET /v1/me` 豁免、API Key 最近使用时间与分析数据、入口 Host 日志、自定义请求头，以及既有 Chat / Responses / Messages / Gemini / Images / Audio 路由。
