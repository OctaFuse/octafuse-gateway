---
"octafuse": patch
"@octafuse/core": patch
"@octafuse/tool-engines": patch
"@octafuse/proxy": patch
"@octafuse/admin": patch
---

优化管理后台用户列表的信息层次与扫描效率。

### Admin

**Users**：合并额度相关列为已消费/上限进度条，空的周期、Metadata、倍率不再铺满破折号；状态只在禁用时强调，筛选改为分段控件。Keys 列展示激活数 / 总数。
