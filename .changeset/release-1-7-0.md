---
"octafuse": minor
"@octafuse/core": minor
"@octafuse/proxy": minor
"@octafuse/admin": minor
---

### Proxy

- **5xx 熔断策略**：调整 Gateway 上游 5xx 熔断逻辑；Provider key 已熔断且用户继续请求时直接返回错误，**不再触发告警**（[#41](https://github.com/OctaFuse/octafuse-gateway/issues/41)）。
- **TTFT 记录**：区分 **reason TTFT** 与 **content TTFT**；修正此前仅按 content 首 token 记录导致 reasoning 场景 TTFT 偏大的问题。
- **请求日志**：`api_key_request_logs` 增加首 token 等**分析时间**字段；Proxy 侧写入与查询链路对齐（[#52](https://github.com/OctaFuse/octafuse-gateway/issues/52)）。

### Admin UI

- **国际化**：Admin 模块基础 i18n（**中文 + 英文**）。
- **Analytics**：用户 Usage 行展开查看模型统计；增加 reason / content **TTFT** 展示与处理；Dashboard 大盘优化并移除 **Top Users Trend**；Time range 默认去掉 **90d**，Custom 选择布局优化；业务管理时间统一按**配置的业务时区**展示。
- **Request Logs**：支持新增分析时间字段的查询与管理。
- **Reliability**：Provider 列显示 **Name** 而非 Id。
- **Routes**：左侧 Provider 过滤仅显示 **name**（去掉 id）。
- **Providers**：API Key **label** 固定宽度，为其他信息腾出空间（[#55](https://github.com/OctaFuse/octafuse-gateway/issues/55)）。
- **Models**：Import 弹窗支持按**名称搜索**（[#51](https://github.com/OctaFuse/octafuse-gateway/issues/51)）。

### 模型与 Provider 预设

- **新增/更新**：grok-4.5 静态数据；Provider import 预设更新。

### 文档

- 重构文档目录结构；完善本地开发与 Cloudflare 部署说明。
