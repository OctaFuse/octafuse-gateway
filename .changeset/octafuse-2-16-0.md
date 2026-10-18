---
"octafuse": minor
"@octafuse/core": minor
"@octafuse/tool-engines": minor
"@octafuse/proxy": minor
"@octafuse/admin": minor
---

OctaFuse Gateway v2.16.0 重点接入 ElevenLabs 语音（文件与实时），并把 DashScope、MiniMax、火山方舟的原生路径对齐官方 SDK。管理后台可以按列表管理供应商、模型和路由；模型与供应商介绍改为静态目录，库内原介绍列改为运营备注。

### Proxy

- **ElevenLabs 文本转语音与语音转写**：新增 `elevenlabs` 协议。原生透传 `POST /elevenlabs/v1/text-to-speech/{voice_id}`（含 `/stream`、`/with-timestamps`、`/stream/with-timestamps`）和 `POST /elevenlabs/v1/speech-to-text`，额外接受 `xi-api-key`。OpenAI 兼容入口由 `elevenlabs-tts`、`elevenlabs-asr-file` 转换。合成按字符、转写按秒计费；`quota_exceeded` 改写为 402，并发或系统忙改写为 429。不含音色管理、配音、音效和音乐。详见 `docs/developers/architecture/elevenlabs-audio.md`。
- **ElevenLabs 实时 WebSocket**：新增 `GET /elevenlabs/v1/text-to-speech/{voice_id}/stream-input` 与 `GET /elevenlabs/v1/speech-to-text/realtime`。升级前完成鉴权、模型类型、余额和选路由。用量由网关估算（合成按字符，转写按音频字节折算秒数），`usage_source` 标为 `estimated`。只做会话前余额检查。
- **厂商原生路径对齐官方**：DashScope、MiniMax、火山方舟改为 `/{厂商}` 加官方路径。DashScope WebSocket 拆成 `/dashscope/api-ws/v1/inference` 与 `/dashscope/api-ws/v1/realtime?model=`。旧路径 `/v1/dashscope/*`、`/v1/minimax/*`、`/v1/volcengine/*` 及旧实时入口保留为过渡别名。协议与计费不变。
- **402 故障转移**：上游 402 与 401、403 一样切换下一供应商，熔断 5 分钟并告警。MiniMax `1008` 与 ElevenLabs `quota_exceeded` 走这条路。最后一个候选仍返回 402。
- **流空闲超时对下游可见**：超过空闲或首包阈值时写入协议原生错误事件（`code` 为 `stream_idle_timeout`），不再干净关流。阈值、记账与请求日志不变。
- **Node 实时连接**：握手同包到达的上游首帧先缓冲再回放；校验失败的 WebSocket 升级先恢复读取再发关闭帧，客户端立即收到原因。

### Admin

- **列表与弹窗**：供应商、模型、路由默认使用列表，可切回卡片。供应商和模型弹窗可搜索并单条或批量删除关联路由，清空引用后才能删除；后端拒绝仍有路由的模型删除。供应商密钥默认显示首尾，清空并保存会移除密钥，省略字段保持不变。端点分为全能力（只填 Base）与部分能力（多选后逐行填写）。
- **路由展示**：可用配置用绿色侧条和「可用」标记；自定义参数单独成列；倍率可在「实际倍率」和「原始倍率」之间切换。这些只影响展示。
- **模型现役 / 退役**：按静态目录可选 `retired` 日期筛选和展示，不落库，不影响路由与计费。导入弹窗默认只显示现役。
- **介绍与备注**：迁移 0031 把 `models.description`、`providers.description` 改名为 `note`（已有内容保留为运营备注）。导入和同步不再把目录介绍写入数据库。`GET /v1/models` 与 `GET /catalog/models` 不再返回 `description`，也不返回备注。
- **界面语言**：日语和韩语补齐侧边栏、模型目录介绍和供应商模板名称。导入按当前界面语言写入名称；已经导入的记录不会被改写。
- **额度查询**：ElevenLabs 查询官方订阅 credits；Command Code 查询 `GET /alpha/billing/credits`。Command Code 模板补上 Responses。
- **目录与模板**：新增 Open Design、金山云星流（国内与国际）、MiniMax M3.1 Flash Preview；豆包 Seed 目录更新。超算互联网、金山云、Command Code、Open Design 使用官方图形标志。缺少当前币种价格的目录行不可导入。Grok 三个模型补上按美元 ×7 的人民币占位价。

### 升级说明

- **数据库迁移**：必须应用 **0031**（`models.description`、`providers.description` 改名为 `note`，已有内容保留；D1、Postgres、MySQL 语义一致）。详见 `docs/operators/migrations/0031-catalog-notes.md`。
- **发布顺序**：先备份，用 v2.16.0 migrate 镜像或对应脚本执行 0031，再滚动更新同版本 Proxy 与 Admin。先更新应用、后改列名时，读写 `note` 会失败。
- **兼容性**：公开模型接口不再返回 `description`。厂商旧路径仍可用，但是过渡别名。流空闲超时现在会向下游写错误事件。管理后台保存供应商时，显式空密钥会清空密钥。
- **配置不自动改写**：ElevenLabs、Open Design、金山云星流需要手工导入或填写端点。已导入的供应商和模型不会被模板覆盖。MiniMax M3.1 Flash Preview 的价格是 M3 刊例占位，且上游目前只接受 M Plan 或 MiniMax Code 的订阅 Key。若干新增人民币价是美元 ×7 占位，不是官方人民币刊例。
- **建议操作**：迁移后抽查一条 ElevenLabs 合成或转写、一条厂商原生路径，并确认模型与供应商备注还在、公开接口不再带介绍字段。
