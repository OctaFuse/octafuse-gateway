---
"@octafuse/admin": patch
---

为 DeepSeek V4 预设补上官方峰谷时段，导入时随目录价一并写入。

### Admin
- **DeepSeek 峰谷预设**：`deepseek-v4-pro` / `deepseek-v4-flash` 以空闲价为目录价，工作日 09:00–12:00、14:00–18:00 官方倍率为 2；模型导入会保留 `pricing_profile.schedule`。

### 文档
- 标明 `POST /admin/models/import` 会把所选币种分支整段写入，含官方时段。
