# 公开接口

无需认证的公开 API。

---

## 根路径

返回服务标识与版本号（便于探活或编排）。

### 请求

```
GET /
```

### 响应

```json
{
  "name": "octafuse-proxy",
  "version": "0.1.0"
}
```

### 示例

```bash
curl http://localhost:8787/
```

---

## 健康检查

检查服务是否正常运行。

### 请求

```
GET /health
```

### 响应

```json
{
  "status": "ok",
  "service": "octafuse-proxy"
}
```

### 示例

```bash
curl http://localhost:8787/health
```
