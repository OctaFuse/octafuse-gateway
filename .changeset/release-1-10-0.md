---
"octafuse": minor
"@octafuse/core": minor
"@octafuse/proxy": minor
"@octafuse/admin": minor
---

### Proxy / Core

- **Tools / Web Fetch**：新增 **web-fetch** 工具接入与调用计费（[#65](https://github.com/OctaFuse/octafuse-gateway/issues/65)）。
- **Tools / Web Deep Search**：新增 **web-deep-search** 工具接入（含 Firecrawl / Jina 等 Provider）（[#66](https://github.com/OctaFuse/octafuse-gateway/issues/66)）。
- **Image 计费**：image 模型支持按 **token** 与按 **per image** 两种计费方式（[#63](https://github.com/OctaFuse/octafuse-gateway/issues/63)）。
- **Images**：客户端取消时按预检扣费回退；上游超时拉长至 5 分钟。
- **错误排查**：model not found 时输出 model id，便于定位。

### Admin UI

- **Tools**：完善 web-fetch / web-deep-search 配置与文档对齐。
- **Providers**：新建/编辑页优化；API Key 创建与编辑时可见；OpenAI 协议下 chat/image 通用 `baseUrl` 模板；Import 价格按系统币种显示。
- **Models**：卡片布局更紧凑；Route 页可直接打开 model 编辑框。
- **Playground / Simulator**：支持 image 模型两个不同端点的请求测试。
- **Analytics**：Time range 增加今天/本周/本月快捷选择，默认 today。
- **国际化**：优化语言切换组件。

### 模型预设

- **新增**：火山方舟 Seedream 系列；千问 token plan；qwen3.8-max-preview（暂对齐 3.7-max）。
- **重构**：image 模型静态数据独立文件；Seedream 模型名称调整。

### 文档

- 更新 README 与用户/开发者文档，覆盖 web-fetch、web-deep-search 与相关配置说明。
