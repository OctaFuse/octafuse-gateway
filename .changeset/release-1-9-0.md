---
"octafuse": minor
"@octafuse/core": minor
"@octafuse/proxy": minor
"@octafuse/admin": minor
---

### Proxy / Core

- **OpenAI 生图协议**：新增图像生成上游协议支持（[#60](https://github.com/OctaFuse/octafuse-gateway/issues/60)）。
- **Tools / Web Search**：Proxy 规划工具调用路径；新增 **web-search** 工具，支持多 Provider 与调用计费。
- **Web Search Providers**：接入 Tavily、腾讯云 WSA、阿里云 Cleversee；优化计费字段命名与配置结构。
- **`GET /v1/models`**：支持可选 `kind` 参数过滤模型类型（`llm` / `image` / `all`）。

### Admin UI

- **Tools**：新增 Tools 板块，支持工具配置与工具调用查询；完善 web-search 配置页。
- **Providers**：能力徽章与导入体验增强（OpenAI / Anthropic / Gemini 端点）；`baseUrl` 改造。
- **Models**：新建/编辑表单同时支持 LLM 与 image 模型；修正 image 模型 pricing / 计费文案；卡片布局紧凑化。
- **Routes**：编辑页调整「Provider model name」与「Upstream protocol」字段顺序。
- **Analytics**：Provider 分析页增加缓存命中率统计列；成功率 / 缓存命中率样式区分；计费相关列名国际化（Std → Standard）。

### 模型预设

- **新增 / 修正**：kimi-k3、step-3.7-flash；修正多模型 `context-window` / `max-token` 数据。

### 文档

- 完善计费说明（supplier cost / catalog list price / user charge、日时段调价）。
- 优化本地开发与 Cloudflare 部署文档、README 快速上手。
