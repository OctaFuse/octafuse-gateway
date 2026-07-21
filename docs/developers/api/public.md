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
  "version": "1.9.0"
}
```

`version` 与 `@octafuse/proxy` 的 `package.json` 一致（发版后随 Changesets 提升）。

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

---

## 模型目录（Catalog Discovery）

Proxy 提供的 **运行时** 模型能力发现接口：仅含至少一条 **active** 路由的模型，并按 `route_group` 聚合支持的 **`upstream_protocol`**。无需 API Key，适合门户、文档站等公开展示。

```
GET /catalog/models
```

完整字段说明、与 **`GET /v1/models`** / Admin **`GET /admin/models`** 的差异见 **[用户接口 · 公开模型目录](./user.md#公开模型目录catalog-discovery)**。

### 示例

```bash
curl http://localhost:8787/catalog/models
curl "http://localhost:8787/catalog/models?route_groups=default,free"
```
