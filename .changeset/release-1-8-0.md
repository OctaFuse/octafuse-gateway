---
"octafuse": minor
"@octafuse/core": minor
"@octafuse/proxy": minor
"@octafuse/admin": minor
---

### Proxy / Core

- **动态调价（Pricing Schedule）**：支持按日时段配置计价倍率（如高峰期 2x），计费与审计对齐（[#56](https://github.com/OctaFuse/octafuse-gateway/issues/56)）。

### Admin UI

- **Routes**：日时段调价编辑器与路由计价面板；动态调价配置体验完善。
- **国际化**：补全未翻译文案，清理无用 i18n 配置；Providers 等页面翻译优化。
- **Providers**：去掉无用顶部内容，布局精简。
- **Audio Logs**：筛选项布局与多选筛选（事件来源 / 事件原因）；用户变更详情列优化；修复 metadata 从 null 变为有值时表格不展示的问题。
- **Playground / Simulator**：页面交互与展示优化。

### 模型预设

- **新增**：gpt-5.6 系列模型静态数据。

### 文档

- 更新 README。
