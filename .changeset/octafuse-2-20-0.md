---
"octafuse": minor
"@octafuse/core": minor
"@octafuse/tool-engines": minor
"@octafuse/proxy": minor
"@octafuse/admin": minor
---

OctaFuse Gateway v2.20.0 让 Gateway 自己成为 MCP 的 OAuth 授权服务器：把 Gateway 的 MCP 服务对外提供时，用户不用填 Key，直接用你业务系统的账号登录授权即可访问，授权状态也不再需要业务系统保存。Web Search、Web Fetch、Web Deep Search 三个 REST 工具新增 DeepSeek 引擎。请求日志合并了原来的「调用记录」，并支持按类型、模型、供应商多选筛选。管理后台的仪表盘、MCP 服务、REST 服务等页面继续打磨，目录补上 Gemini 4 Hydrogen、Gemini 4 Carbon、Qwen4 Max Preview 和 MiniMax H3 Image。本版有一条必须先执行的新增迁移 0036，只新增表和可空列，默认不改变现有行为。

### Proxy

- **内置 OAuth 授权服务器**：设置 `MCP_OAUTH_ISSUER` 后，Gateway 直接为 MCP 客户端提供授权：元数据发现（RFC 8414）、客户端动态注册（RFC 7591）、授权、令牌（含刷新令牌轮换与重放检测）、撤销，以及内置的 API Key 确认页。业务系统只需提供登录与同意页（填 `MCP_OAUTH_CONSENT_URL`），并用带 `oauth.consent` 权限的集成密钥把用户的同意或拒绝回传给 Gateway；不填则使用内置确认页。清空 `MCP_OAUTH_ISSUER` 立即回到外部授权服务器模式，默认行为不变。切换步骤见[迁移说明](docs/operators/migrations/0036-oauth-authorization-server.md)。
- **DeepSeek 工具引擎**：Web Search、Web Fetch、Web Deep Search 新增 `deepseek` 引擎，对接 DeepSeek 独立 Search / Fetch API。在管理后台「REST 服务」页为对应工具配置 DeepSeek 供应商、填入 API Key 并保存，再在「使用状态」列启用即可，对外接口与计费方式不变；Deep Search 通过 `need_content` 一次请求取到正文。DeepSeek 的查询词最长 128 个字符，超出部分由 Gateway 截断；域名白名单 / 黑名单在能放进查询词时以 `site:` / `-site:` 下发，放不下则多取结果后本地过滤。上游刊例价为每千次成功请求 $0.75，请在计费规则中自行设置标准价与倍率；Gateway 对空结果仍按次计费。

### Admin

- **MCP 服务 · OAuth 应用与授权**：OAuth 卡片支持内置 / 外部 / 关闭三种模式。新增「应用」目录：客户端按回调地址（及可选的名称关键字）归属应用，按应用汇总用户数、实例数与授权，支持启停、编辑、删除和整应用撤销，并提供 ChatGPT、Claude、Codex、豆包、WorkBuddy 预设；旧授权显示为「未归属」，授权列表新增「可续期」状态。Admin API 新增 `/api/admin/oauth/*` 与权限 `oauth.read`、`oauth.write`、`oauth.consent`（同意页只需最后一项）。
- **MCP 服务 · 工作区与客户端接入**：服务目录与详情分栏，保留目录审核、批量启停、计费与连接测试；客户端接入按 API Key 与 OAuth 2.0 分类，集中展示范围选择、配置示例与授权管理，接入文档直接展开。OAuth 关闭时仅展示状态与配置。服务、视图和接入范围随地址恢复，兼容旧链接。
- **MCP 服务与 REST 服务 · 计费规则**：两者统一为行式布局，标准价、用户倍率、供应倍率各占一行，右侧即时显示单位和计算后的用户收费、供应成本。
- **REST 服务**：按生效概要、供应商与计费、接入文档三个区域组织。接入文档集中展示统一 URL、参数、响应和可复制的 cURL，并提供通用、OpenAI Responses / Chat Completions、Anthropic Messages 的 Agent 工具定义格式。供应商列表在使用状态列单选切换，配置弹窗仅编辑与保存；未保存修改或缺少凭证时禁止启用，切换影响提示更明确。
- **请求日志 · 合并调用记录**：「调用记录」并入「请求日志」，侧栏新增「日志」分组收纳请求日志与审计日志。工具调用行直接显示工具名、引擎与查询摘要。原 `/gateway/tools/invocations` 地址带着原有筛选跳转到请求日志，REST 服务、MCP 服务与模拟器的入口同步指向新位置。
- **请求日志 · 类型、模型与供应商筛选**：三个筛选都改为两级多选，勾选项取并集。类型分模型（LLM、图像、ASR、TTS、向量）与工具（各 REST 工具、各 MCP 服务）；模型按厂商分组，供应商按类型分组，可勾选整组或其中几个，面板内可搜索，选中项逐项列出并可单独移除。筛选之间联动：只选某几类模型时模型筛选只列这几类，范围里只有工具调用时模型、供应商、协议、路由组不可用。`GET /api/admin/request-logs` 新增 `kinds`（如 `kinds=model:image,tool:web-search,mcp:docs`）、`model_ids`、`model_vendors`、`provider_kinds` 参数，`provider_ids` 上限由 10 个放宽到 30 个。
- **请求日志 · 详情与展示**：工具调用详情按调用概览、请求、响应、记账展示：REST 工具列出引擎、请求参数与结果，MCP 工具列出服务、上游工具、调用参数与返回内容块；失败时顶部给出错误原文与排查方向，可直接打开对应工具配置或 MCP 服务。请求与响应区域统一使用右上角「预览 / 原始数据」切换，保留原始数据复制。用量与状态展示更清晰：LLM 按非缓存输入展示，图片区分参考图与生成图，音频按秒或字符展示，倍率格式统一。支持可选的自动刷新（10 秒、30 秒、1 分钟、5 分钟），新日志滑入并高亮，阅读列表时先提示新日志。
- **仪表盘**：补充费用关系、首响应与请求耗时 P95、故障转移、异常供应商及错误构成；支持等长时段对比、带时间范围的日志下钻和实时吞吐（RPM、TPM）。默认关闭的自动刷新让指标、趋势、排行和近期活动同步更新，数字平滑过渡；排行与近期活动各展示 6 条，完整记录通过分析与日志入口查看。
- **模型与路由**：模型编辑弹窗按基础、定价、路由、元数据组织；定价表修复控件对齐与档位文案，音频 Token 模式完整展示全部档位，切换计费模式保留未保存草稿。金额与倍率统一样式：金额保留币种与精度，倍率使用独立标识，计费计算本身不变。路由页移除重复入口，筛选按宽度分级展开。
- **导航、模拟器与接入地址**：导航统一使用「模型」「工具」，调试台与模拟器归入「测试」分组。模拟器顶部按模型与工具切换，切换保留连接与密钥并清除旧响应。Admin 新增运行时变量 `GATEWAY_PROXY_URL`，REST 文档、模拟器及 MCP 接入共用默认 Proxy 地址，支持浏览器覆盖与恢复默认，兼容旧地址；Docker 与 Worker 部署模板同步。
- **筛选、刷新与登录页**：用户、API Keys、请求日志及审计日志按内容区宽度展开常用条件，缩放保留已选项与键盘焦点。路由粘性与维护状态使用统一的定时刷新控件，默认关闭，手动开启后记住频率。管理登录页重新排版，补充密码显隐、错误提示与登录进度，适配手机与四种语言。

### 目录与供应商

- **Gemini 4 Hydrogen**：新增 `gemini-4-hydrogen`（2026-11-12）。上下文 1M，同步最大输出 64K，输入含文本、图像、音频、视频和文件。输入 $1.50 / 输出 $7.50 / 每百万 Token（整个 1M 窗口统一），隐式缓存读取 $0.075；思考档位 low、medium、high、xhigh，默认 high。人民币价为美元刊例 ×7 的占位价；官方未公布退役日期。
- **Gemini 4 Carbon**：新增 `gemini-4-carbon`（2026-11-10）。上下文 1M，同步最大输出 64K。按 Standard 刊例价记录（输入 $4 / 输出 $20，隐式缓存读取 $0.20）；官方限时折扣请在路由计价配置中设置供应商折扣。思考档位 low、medium、high，默认 medium，不能关闭。
- **Qwen4 Max Preview**：新增 `qwen4-max-preview`（2026-11-11）。上下文 1M，最大输出约 393K，输入含文本、图像和视频。仅在 Token Plan 订阅提供，官方尚未公布刊例价，价格暂按 `qwen3.8-max` 对齐，正式版发布后更新；`retired` 记 2026-11-26。
- **MiniMax H3 Image**：新增 `minimax-h3-image` 与 `minimax-h3-image-highspeed`（2026-11-10），按官方 Token 刊例计费。国际区标准版文本输入 $2.3、图像输入 $1.5、图像输出 $3.8；高速版 $2.3 / $3 / $7.6（每百万 Token）。中国区按官方人民币：标准版 ¥15 / ¥10 / ¥25，高速版 ¥15 / ¥20 / ¥50。官方限时折扣不写入目录价格。路由的上游模型名分别填 `MiniMax-H3-Image` 与 `MiniMax-H3-Image-Highspeed`。
- **GPT Image 2 退役日期**：`gpt-image-2` 写上 OpenAI 公布的停服日 2027-02-10，不影响路由与计费。

以上目录更新不会自动覆盖已导入的模型，也不会自动挂路由。

### 运维

- **Node 运行时安全修复**：升级 `@hono/node-server` 至 2.1.8，修复请求路径反斜杠解析及异步 WebSocket 升级期间连接重置的漏洞，并统一直接与 MCP SDK 间接依赖版本。

### 升级说明

- **数据库迁移**：必须应用 **0036**（内置 OAuth 授权服务器），先于同版本 Proxy 与 Admin 执行；D1、Postgres、MySQL 都有对应迁移，只新增表和可空列，步骤见[迁移说明](docs/operators/migrations/0036-oauth-authorization-server.md)。
- **配置变更**：新增 `MCP_OAUTH_ISSUER` 与可选的 `MCP_OAUTH_CONSENT_URL`，`MCP_OAUTH_ISSUER` 为空时行为与升级前一致；新增可选的 Admin 运行时环境变量 `GATEWAY_PROXY_URL`。
- **兼容性**：`/gateway/tools/invocations` 跳转到请求日志并保留筛选。`GET /api/admin/request-logs` 新增的参数都是可选的，原有参数照常可用。调用 `/api/admin/oauth/*` 的集成密钥需要授予 `oauth.read`、`oauth.write` 或 `oauth.consent`。DeepSeek 引擎对空结果仍按次计费，启用前请先设置计费规则。
- **切换到内置授权服务器**：升级后默认不启用。每个部署区需单独完成门户同意页、应用预设、集成密钥和反向代理转发后再切换；切换后旧授权会在访问令牌过期后失效，用户需要重新授权。
- **建议操作**：先执行 0036，再把 proxy / admin / migrate 三镜像更新到同一版本后滚动重启。升级后抽查请求日志的新筛选、工具调用详情和 MCP 服务页。
