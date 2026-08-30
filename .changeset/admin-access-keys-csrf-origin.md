---
"@octafuse/admin": patch
---

本地 Node 下集成密钥写操作不再因 rewrite 丢掉 Origin 而误报 403。

### Admin
- **集成密钥 CSRF**：同源判定改在 `/api/admin/*` rewrite 之前对原始浏览器请求进行；Node clone Request 丢掉 `Origin` 时，控制台创建/改状态不再返回 `Forbidden: invalid Origin`。
