---
"octafuse": minor
"@octafuse/core": minor
"@octafuse/tool-engines": minor
"@octafuse/proxy": minor
"@octafuse/admin": minor
---

OctaFuse Gateway v2.15.0 重点新增 MCP 聚合入口与向量 Embeddings 支持。管理员可以接入远程 MCP 服务，通过 `/mcp` 向 Agent 提供统一工具目录并按调用计费；OpenAI 与 Gemini 向量请求现在可以走同一套路由、故障转移和记账。模型与供应商页新增与官方目录 / 模板的手动同步，ASR / TTS 模型类型也被拆分得更清晰。

### Proxy

- **模型列表按 ASR / TTS 过滤**：`GET /v1/models` 的 `kind` 新增 `asr`（语音识别）与 `tts`（语音合成），`kind=audio` 保留为两者的兼容别名。音频入口（MiniMax T2A、DashScope 语音合成与文件转写）会分别提示「模型类型不符」与「缺少音频计费」。无需数据库迁移。
- **向量 Embeddings**：新增 OpenAI 兼容 `POST /v1/embeddings`，以及 Gemini 原生 `POST /v1beta/models/{model}:embedContent` / `:batchEmbedContents`，均走现有路由池、故障转移、限流与记账，请求体原样透传（Gemini batch 会改写每个 `requests[].model`）。向量模型以 `output_modalities` 含 `embedding` 标识，仅按输入 token 计费（OpenAI `usage.prompt_tokens`，缺失回退 `total_tokens`；Gemini `usageMetadata.promptTokenCount`），上游无 usage 时不计费。默认 `GET /v1/models` 不含向量模型，新增 `kind=embedding`。供应商新增 `embeddings`（OpenAI）与 `models.embed`（Gemini）端点能力。无需数据库迁移。关闭 #113。
- **MCP 聚合入口**：`POST /mcp` 把管理员接入的远程 MCP 服务聚合成一个无会话 Streamable HTTP 服务，`POST /mcp/{slug}` 只暴露单个服务。工具、提示词和资源清单来自已审核快照；只有 `tools/call` 计入三本账和请求日志（`provider_id=octafuse-mcp`）。当前计费收敛为 request：每次成功工具调用固定计 1 单元，支持标准价 × 用户/供应倍率，用户倍率为 0 时免费；调用前检查余额，上游失败不扣费。计费 JSON 保留版本、模式、标准价、倍率和模式配置，后续扩展模式无需数据库迁移。`GET /v1/tools/pricing` 增加已启用 MCP 工具的 `mcp` 段，含计费单元与单价。
- **请求追踪**：聊天、消息和 Responses 的响应返回 `X-OctaFuse-Request-Id`，与请求日志主键一致，成功和失败都会带上。请求日志额外记录消息结构摘要（按角色汇总字段名和 content part 类型），不记录消息正文。

### Admin

- **模型类型拆分 ASR / TTS，判定规则收敛**：Models、Routes、调试台、模拟器的 Kind 由「音频」拆成「语音识别（ASR）」与「语音合成（TTS）」，新建 / 编辑模型直接选这两项，不再有二级「音频能力」开关；旧链接的 `?kind=audio` 落到 ASR。Kind 的判定统一为 `resolveModelKind`（有效的音频计费模式优先，其次按模态签名兜底，全模态 LLM 仍判为 LLM），Admin 与 Proxy 不再各写一套。保存模型时若计费模式与模态互相矛盾（如 TTS 但输出不含 `audio`）会被拒绝。判定规则见 `docs/developers/reference/model-kinds.md`。无需数据库迁移。
- **向量模型支持**：模型、路由、供应商、调试台、模拟器、请求日志均新增 `embedding` 类型。模型表单只保留输入价；供应商可覆盖 `embeddings` 与 `models.embed` 端点；调试台与路由快速测试提供 OpenAI / Gemini 向量请求模板，并展示向量个数、维度和用量。静态目录新增 OpenAI（`text-embedding-3-small` / `-large` / `ada-002`）、Google（`gemini-embedding-2` 文本输入价）和阿里云（`qwen3.7-text-embedding`、`text-embedding-v4`）预设；人民币价除阿里云外为美元 × 7 的占位换算。供应商导入模板中，官方文档确认提供 OpenAI 兼容 embeddings 的供应商补上了 `openai.endpoints.embeddings`：火山方舟、阿里云百炼（国内 / 国际）、腾讯混元、百度千帆、智谱 GLM、Google Gemini、Mistral、SambaNova、Together、Fireworks、DeepInfra、Novita、Cohere、NVIDIA NIM、OpenRouter、Vercel AI Gateway、SiliconFlow（国内 / 国际）、Ollama；官方不支持或未核实的（Z.AI 国际站、BytePlus、MiniMax、Qwen AI Platform 等）未写入。全能力的 OpenAI Base（OpenAI、Azure OpenAI、ZenMux）和 Gemini Base 模板会自动派生向量端点。
- **Gemini 4 Argon 目录**：静态目录新增 `gemini-4-argon`。价格按 2026-12-01 起的 Standard 刊例写入（输入 $4 / 输出 $20 / 每百万 Token，缓存读取 $0.20），不含 2026-11-30 前的入门价。上下文与长解码上限为 1,048,576 Token，同步默认输出 65,536 Token 写在介绍中。输入含文本、图像、音频、视频和 PDF。只支持隐式缓存，缓存写入价留空。`gemini-4-barium` 没有官方刊例，未入库。人民币价仍是美元 × 7 的占位换算。
- **模型与官方目录同步**：模型页右上角的「检查官方更新」按钮手动触发检查（不会自动运行），结果以 toast 和按钮旁的状态文字显示；有差异时顶部出现提示条，对应模型卡片出现「有官方更新」图标。「与官方目录同步」面板按厂商分组，逐项并排对比显示名称、厂商、上下文窗口、最大输出、介绍、发布日期、输入输出模态和价格（价格按当前计费币种的官方目录价逐项对比），每一项可选「采用官方」或「保留当前」，可单个模型同步或批量同步。官方目录未给出的字段不会被清空；价格影响计费，默认保留，应用前显示涉及的启用路由数。标签、元数据、路由及路由价格覆盖不会被修改，无需数据库迁移。
- **Azure OpenAI 导入模板**：官方 Base 改为 OpenAI v1 路径 `https://YOUR_RESOURCE_NAME.openai.azure.com/openai/v1`。Foundry 控制台的 `https://YOUR_RESOURCE_NAME.services.ai.azure.com/openai/v1` 视为同一模板。仍使用不带 `/v1` 的旧地址会提示更新；采用官方时保留已填写的资源名和当前主机。
- **供应商与官方同步**：供应商页右上角的「检查官方更新」按钮手动触发检查（不会自动运行），结果以 toast 和按钮旁的状态文字显示；有差异时顶部出现提示条，卡片和筛选栏同步出现「有官方更新」标记。「与官方同步」面板按供应商类型分组，逐项并排对比介绍与各协议端点（新增、变更、仅本地有），每一项可选「采用官方」或「保留当前」，可单个账号同步或批量同步，应用前显示涉及的启用路由数。模板里的部署占位符换成实际值后不再提示更新（Vertex 的 `YOUR_PROJECT_ID` 与默认区域 `global`、Azure OpenAI 的 `YOUR_RESOURCE_NAME`），采用官方时保留已填写的项目、资源名和区域。官方模板改名或下线后遗留的旧类型会单独列出，可迁移到新类型。API Key、启用状态和供应商名称不会被修改，无需数据库迁移。
- **Tools 导航**：原「配置」改为 REST 服务，MCP 服务紧随其后，调用记录同时包含 REST 服务与 MCP 服务的调用，并可按来源和服务筛选。
- **REST 服务**：REST 服务页改为服务列表，可按名称、标识或工具类型搜索，并按工具类型和状态筛选；每行显示配置状态与计费方式，点击后在弹窗中完成接入、启用、计费设置和测试。计费与 MCP 共用标准价、用户倍率和供应倍率，使用紧凑的收费方式切换、倍率输入和价格预览；搜索类按请求计费，AI 检测按可配置的字符单元计费；用户倍率为 0 时免费并记录供应成本。旧价格兼容，新规则存入现有 JSON，无需数据库迁移。
- **MCP 服务**：可接入远程 MCP、测试连接、同步目录、审核新增和说明变更、启停条目，并为服务或单个工具设置计费规则（统一的标准价与倍率编辑器，即时展示单次收费与供应成本；价格设置集中在计费规则中）。上游地址和鉴权头默认脱敏。服务列表支持搜索、状态筛选与刷新，目录列同时显示已启用数量和上次同步时间，同步失败以红色标出；服务详情按目录管理与连接设置分区，目录条目可按类型、状态和关键字筛选，并可批量启用 / 停用，新增条目默认停用、审核后再启用。创建与编辑弹窗分为连接设置与高级设置，已有认证头留空保留原值，关闭未保存的表单会先确认。请求日志可按 MCP 调用筛选。
- **MCP 配置导入**：新建或编辑服务时，可粘贴远程地址或常见客户端 JSON，自动填入地址和静态请求头。计费规则与超时仍在表单里确认。本地进程、旧版 SSE 和 OAuth 不会被导入。
- **MCP 接入指南**：MCP 服务页新增「接入指南」按钮，弹窗内填写 Proxy 地址并选择全部服务或单个服务，即可复制 Cursor、VS Code、Claude Code、Codex 的配置和 curl 验证命令。示例只含 `<YOUR_API_KEY>` 占位符，Proxy 地址与「对外目录测试」共用。
- **MCP 对外目录测试**：MCP 服务页新增「对外目录测试」弹窗，填写 Proxy 地址与用户 API Key（可按邮箱筛选并选择已有 Key）后，实际请求 Proxy 的 `/mcp` 或 `/mcp/{slug}`，查看 Agent 实际获得的目录与响应结构；支持原始 JSON 与按服务分组两种视图，可复制响应和 cURL（复制的命令使用 Key 占位符）。仅查询目录和协议能力，不执行工具调用。
- **请求日志**：可按请求 ID 精确筛选，用来从客户端错误直接定位到对应日志。
- **仪表盘**：「需要关注」和「近期请求」的时间显示完整的年月日和时分秒（按业务时区），跨天的记录不会再被误认成今天；修复切到 Token 页签时曲线和 Y 轴不显示、图表空白的问题，输入、输出和缓存读取三条曲线能正常绘制。
- **界面一致性**：模型、路由、供应商、请求日志、审计日志、用户、Playground 与 Simulator 的筛选区统一使用同一套分段、下拉、文本输入和平铺选项控件，筛选行为不变；模型、REST 服务与 MCP 的单价标签和价格预览改用币种符号加单位（如 `¥/1M`），不再显示 `CNY/1M` 这类币种代码，不影响计费。

### 升级说明

- **数据库迁移**：必须应用 **0030**（`mcp_servers`、`mcp_server_items` 两张表，D1、Postgres、MySQL 脚本语义一致），详见 `docs/operators/migrations/0030-mcp-servers.md`。其余变更无需新增迁移或必填配置。
- **发布顺序**：建议先备份数据库，使用 v2.15.0 migrate 镜像或对应脚本执行 0030，再滚动更新同版本 Proxy 与 Admin。新 Proxy 在表缺失时，`GET /v1/tools/pricing` 的 `mcp` 字段返回空数组；回退时可保留这两张表。
- **兼容性**：`GET /v1/models?kind=audio` 保留为 `asr` 与 `tts` 的兼容别名；默认模型列表不包含向量模型；现有 Chat / Responses / Messages / Gemini 路由与鉴权方式不变。
- **建议操作**：部署后在 MCP 服务页接入上游、同步目录并逐条启用，用「对外目录测试」验证 `/mcp`；抽查 `POST /v1/embeddings`、模型 / 供应商「检查官方更新」，并冒烟既有主要路由。
