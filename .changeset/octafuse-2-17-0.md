---
"octafuse": minor
"@octafuse/core": minor
"@octafuse/tool-engines": minor
"@octafuse/proxy": minor
"@octafuse/admin": minor
---

OctaFuse Gateway v2.17.0 可以在维护窗口拒绝新的推理请求，并按供应商、模型、用户等维度汇总请求日志。DashScope 语音转换路由按系列拆开。目录补上 Kimi K3.1 Pro、Qwen-Audio 3.1 和网宿导入模板。D1 迁到 Postgres 的切换工具可以在当前表结构上跑完。

### Proxy

- **维护模式**：开启后，推理入口返回 503，错误码 `gateway.maintenance`，带 `Retry-After` 和 `X-OctaFuse-Maintenance: 1`。拒绝发生在鉴权之前，不写请求日志、不扣费、不占 RPM。`/health` 仍返回 200，并附 `maintenance: true`。模型列表、`/v1/me`、`/catalog` 等只读接口照常。错误体随入口协议给出。各 Proxy 进程缓存 5 秒，读配置失败时放行。见 `docs/operators/maintenance-mode.md`。
- **向量响应头**：`POST /v1/embeddings`、Gemini embed，以及上游非 2xx 错误体，在重新封装时去掉 `Content-Encoding`、`Content-Length`、`Transfer-Encoding` 和 `Connection`。聊天等非流式 JSON 响应同样处理，避免把已解压的正文再当成 gzip。
- **DashScope 语音适配器**：CosyVoice 仍用 `dashscope-tts-speech`。Qwen-Audio 3.0 / 3.1 语音合成改用 `dashscope-tts-qwen-audio`。异步文件转写拆成 Qwen3、Qwen-Audio、Fun-ASR、Paraformer 四个转换适配器。透传仍是 `passthrough`。
- **Qwen-Audio 3.1 用量**：同步识别、文件转写、inference 实时识别和 SpeechSynthesizer 读取上游 token 用量。`qwen-audio-3.1-realtime-plus` 与 `qwen-audio-3.1-tts-next` 仍未接入。

### Admin

- **维护模式**：后台「系统 → 维护模式」和 `GET` / `PUT /api/admin/maintenance`。可选同时冻结 Admin 写接口（默认开启；维护开关、集成密钥、调试台除外）。权限为 `maintenance.read` / `maintenance.write`，不包含在 `config.*` 里。状态存 `system_config.MAINTENANCE_MODE`。维护期间所有页面顶部显示红色横幅。
- **请求日志汇总**：新增 `GET /api/admin/request-logs/summary`。可按 `provider`、`model`、`user`、`provider_key`、`route_group`、`status` 任意组合汇总请求条数、Token 和金额。区间为半开毫秒区间。无筛选时不得超过 31 天。老版本没有这个路径，调用方收到 404 应回退到分页明细。
- **MySQL 前缀筛选**：请求日志列表带 `model_id_prefix` 时，不再把 `ESCAPE` 子句当成未闭合字符串。
- **路由时段价格**：计费规则里每个文本模型时段都可以展开本时段价格明细，包括「全部时段」和未命中窗口时的「其他时段」。
- **可靠性与用户用量**：供应商质量和按模型对比供应商增加有效首 Token 列。展开用户后的模型明细增加缓存命中率、首 Token 和平均上游，并去掉平均计费/请求。
- **路由列表**：按可用宽度切换表格、左右分栏和紧凑纵向布局。供应商表格最大宽度 1280px。请求入口可以在完整路径和单行省略之间切换，并记住选择。
- **目录与模板**：新增 `kimi-k3.1-pro`、`kimi-k3.1-pro-highspeed`、Qwen-Audio 3.1 五个预设、`qwen-image-2.1-turbo`，以及网宿 AI 网关导入模板。Kimi K3 补上 5 分钟缓存写入价。`kimi-k2.5` 标为 2026-08-31 退役，只影响展示和筛选。MiniMax M3 改为官网标准现价。`minimax-m3.1-flash` 替换预览条目。上下文和最大输出按 K=1000、M=1000000 写入。已导入的模型和供应商不会被覆盖。

### 运维

- **D1 → Postgres 切换工具**：`scripts/db/cutover/` 能在当前表结构上迁移、对账。补上 `search_path`、漏迁的表，以及时间戳按 UTC 解释。新增只读 `--check`、日志尾部 `--since`、删除 Postgres 中 D1 已不存在的行的 `--prune`。无 schema 迁移。已在非 UTC 机器上迁移过的数据需要重新同步。见 `docs/operators/migrations/d1-postgres-cutover.md`。

### 升级说明

- **数据库迁移**：必须应用 **0032** 和 **0033**。0032 改写能对上系列的 DashScope 语音转换路由；对不上的 `dashscope-asr-file-async` 留在库里，直到改成新适配器才重新可用。0033 只加请求日志索引 `(provider_id, created_at)`。D1、Postgres、MySQL 语义一致。详见 `docs/operators/migrations/0032-dashscope-audio-adapters.md` 与 `docs/operators/migrations/0033-request-log-provider-index.md`。
- **发布顺序**：先备份。执行 0032，再执行 0033，然后滚动更新同版本 Proxy 与 Admin。0032 之后，旧进程不认识新的适配器名。0033 不改列，新旧版本都能读写；Postgres 大表可在低峰先手工 `CREATE INDEX CONCURRENTLY` 同名索引。
- **兼容性**：维护模式默认关闭。公开推理接口在开启后返回 503。向量和部分 JSON 响应不再带上游的压缩和长度头。请求日志汇总是新路径。
- **配置不自动改写**：已导入的模型价格、Kimi K2.5 路由和 MiniMax M3.1 预览行不会被新目录覆盖。新模型与网宿模板需要手工导入或改路由上的上游模型名。
- **建议操作**：升级后确认 DashScope 语音路由的适配器已经拆开，抽查一条请求日志汇总，并在需要冻结写入时先打开维护模式。若之前用非 UTC 机器跑过 D1 → Postgres 迁移，重新同步时间戳。
