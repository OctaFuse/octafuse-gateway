# Compose 环境文件目录

本目录用于存放 **不提交到 Git** 的 Docker Compose 环境文件（镜像名、`DATABASE_URL`、`ADMIN_*` 等）。

## 用法

1. 从 [`docker/examples/`](../examples/) 复制对应模板，例如：
   - `docker/examples/env.compose.external.example`
   - `docker/examples/env.admin.example`
2. 在本目录保存为 **`.env.local`**、**`.env.gateway`** 等（任选文件名；勿提交密钥）。
3. 在仓库根执行：

```bash
docker compose --env-file docker/deploy/.env.local -f docker/examples/gateway.compose.yml --profile migrate run --rm migrate
docker compose --env-file docker/deploy/.env.local -f docker/examples/gateway.compose.yml up -d
```

模板字段说明见各 `docker/examples/env.*.example` 内注释。完整部署见 **[docs/operators/deployment/docker.md](../../docs/operators/deployment/docker.md)**。

**Zeabur**：环境变量可从 [`docker/examples/env.zeabur.example`](../examples/env.zeabur.example) 复制；migrate 为一次性 Job，见 **[docs/operators/deployment/zeabur.md](../../docs/operators/deployment/zeabur.md)**。

## 参考

- 已纳入版本控制的占位示例：**[`.env.example`](./.env.example)**（勿含真实密钥）。
