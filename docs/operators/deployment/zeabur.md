# Zeabur 部署（Docker + Postgres）

本文说明在 [Zeabur](https://zeabur.com) 上部署 **octafuse-gateway** 的 **Proxy**、**Admin** 与数据库迁移的正确方式。

> **推荐（方式 0）**：在 **proxy 或 admin** 常驻 Service 上设置 **`AUTO_MIGRATE=1`**，容器启动时自动执行幂等迁移，**无需**单独的 migrate Service 或 Suspend 操作。见 §3 方式 0。
>
> **备选**：`Dockerfile.migrate` 镜像设计为 **Job（跑完即退出）**，**不能**作为 Zeabur 常驻 Service 长期运行。迁移成功后进程以 exit 0 结束，平台会将其视为容器失败并进入 `BackOff restarting failed container` 循环——这与迁移是否成功无关。

## 1. 推荐架构

在同一 Zeabur Project 中部署 **2 个常驻 Service**（**推荐**在其中一个上开启 `AUTO_MIGRATE=1`）：

| 组件 | 镜像 / Dockerfile | 类型 | 端口 |
|------|-------------------|------|------|
| **gateway-proxy** | `Dockerfile.proxy` 或 GHCR `*-proxy` | 常驻 Service | 8787（HTTP） |
| **gateway-admin** | `Dockerfile.admin` 或 GHCR `*-admin` | 常驻 Service | 8789（HTTP） |
| **migrate**（可选） | `Dockerfile.migrate` 或 GHCR `*-migrate` | **一次性 Job**（非常驻；`AUTO_MIGRATE` 时可省略） | 无需暴露 |

Proxy 与 Admin **共用同一 `DATABASE_URL`**（外置 Postgres，如 Zeabur Postgres 插件或其它托管库）。

```mermaid
flowchart LR
  subgraph zeabur [Zeabur Project]
    proxySvc["gateway-proxy\nAUTO_MIGRATE=1"]
    adminSvc["gateway-admin\n常驻"]
  end
  pg[(Postgres)]
  proxySvc -->|"启动时迁移"| pg
  proxySvc --> pg
  adminSvc --> pg
```

（若未设 `AUTO_MIGRATE`，可改用 §3 方式 A/B 的独立 migrate Job。）

## 2. 为何 migrate 会「崩溃重启」

[`../../../docker/entrypoint.migrate.sh`](../../../docker/entrypoint.migrate.sh) 在无参数时执行迁移 CLI 后 **正常退出**。日志中若已出现：

```text
[migrate-postgres] 全部完成。
[docker-entrypoint:migrate] MIGRATE_DONE
```

说明迁移成功；随后的 `BackOff restarting failed container` 是因为 **Zeabur/K8s 期望 Service 内进程持续监听端口**，而非 migrate 本身失败。

## 3. 推荐发布流程

### 方式 0：启动时自迁移（**Zeabur 最推荐**）

proxy / admin 镜像内置 [`../../../docker/entrypoint.app.sh`](../../../docker/entrypoint.app.sh)。在 **一个** 常驻 Service 的环境变量中设置：

```env
AUTO_MIGRATE=1
DATABASE_DRIVER=postgres
DATABASE_URL=postgresql://user:pass@host:5432/db?options=-c%20timezone%3DUTC
```

常见做法：仅在 **gateway-proxy** 或 **gateway-admin** 之一上开启 `AUTO_MIGRATE=1`（两者同时开启也安全——迁移有 advisory lock 且幂等）。部署 / 重新部署该 Service 时，日志应先出现 `[migrate-postgres] 全部完成。` 与 `[docker-entrypoint:app] MIGRATE_DONE`，再进入应用监听。

- **默认关闭**：未设置 `AUTO_MIGRATE` 时行为与旧版完全一致。
- **无需** 创建 migrate Service、Suspend、或本地 `docker run` migrate 镜像（除非你想显式分离迁移步骤）。

### 方式 A：本地 / CI 一次性 `docker run`（备选）

不在 Zeabur 上创建 migrate 常驻 Service。每次发版或有新 SQL 迁移时，在部署 proxy/admin **之前**执行：

```bash
# 仓库根目录；镜像 tag 与 proxy/admin 保持一致
export GATEWAY_MIGRATE_IMAGE=ghcr.io/octafuse/octafuse-gateway-migrate:latest
export DATABASE_URL='postgresql://user:pass@host:5432/db?options=-c%20timezone%3DUTC'
export DATABASE_DRIVER=postgres

./scripts/deploy/zeabur-migrate-once.sh
```

脚本成功（日志含 `MIGRATE_DONE`）后，再在 Zeabur 控制台或通过 Git push **重新部署** `gateway-proxy` / `gateway-admin`。

也可直接：

```bash
docker run --rm \
  -e DATABASE_DRIVER=postgres \
  -e DATABASE_URL="$DATABASE_URL" \
  "$GATEWAY_MIGRATE_IMAGE"
```

### 方式 B：Zeabur PREBUILT 镜像 + 执行后 **Suspend**

若必须在 Zeabur 控制台操作 migrate：

1. **Add Service → Docker Images**，镜像填 GHCR 的 `*-migrate`（或自建 registry）。
2. 配置 `DATABASE_URL`、`DATABASE_DRIVER=postgres`；**不要**暴露 HTTP/TCP 端口。
3. 部署一次，确认日志含 `MIGRATE_DONE`。
4. 立即进入 **Settings → Suspend Service**，停止该 Service，避免 CrashLoop 与无意义计费。
5. 下次有新迁移：Resume → 等待 `MIGRATE_DONE` → 再次 Suspend → 再部署 proxy/admin。

> Zeabur 当前无原生 Kubernetes Job；**Suspend** 等价于「任务已完成，不再重启」。

### 方式 C：Git 仓库 + 独立 migrate Service（不推荐常驻）

若从 Git 构建 migrate Service（`ZBPACK_DOCKERFILE_PATH=Dockerfile.migrate`），**同样会在成功后反复重启**。请按方式 B 在首次成功后 **Suspend**，或改用方式 A。

**不要**尝试用 `sleep infinity` 等 hack 让 migrate 容器常驻——这只会掩盖问题并持续占用资源。

## 4. Zeabur Git 部署：多 Service 环境变量

从同一 Git 仓库部署多个 Service 时，为每个 Service 单独配置环境变量（或 `zbpack.[service].json`）。

### gateway-proxy

```env
ZBPACK_DOCKERFILE_PATH=Dockerfile.proxy
DATABASE_DRIVER=postgres
DATABASE_URL=postgresql://user:pass@host:5432/db?options=-c%20timezone%3DUTC
PORT=8787
AUTO_MIGRATE=1
```

在 Zeabur 为该 Service 暴露 **HTTP 8787**（或绑定域名）。

### gateway-admin

```env
ZBPACK_DOCKERFILE_PATH=Dockerfile.admin
DATABASE_DRIVER=postgres
DATABASE_URL=postgresql://user:pass@host:5432/db?options=-c%20timezone%3DUTC
PORT=8789
ADMIN_USERNAME=admin
ADMIN_PASSWORD=replace-me
```

暴露 **HTTP 8789**。门户侧 `GATEWAY_MASTER_URL` 指向 Admin 对外 URL。

### migrate（仅一次性，勿常驻）

```env
ZBPACK_DOCKERFILE_PATH=Dockerfile.migrate
DATABASE_DRIVER=postgres
DATABASE_URL=postgresql://user:pass@host:5432/db?options=-c%20timezone%3DUTC
```

**不配置端口**；成功后 **Suspend** 或删除该 Service。

完整变量模板见 [`../../../docker/examples/env.zeabur.example`](../../../docker/examples/env.zeabur.example)。

## 5. 使用 GHCR 预构建镜像（免 Git 构建）

若 CI 已推送镜像（见 [deployment-docker.md](./docker.md) § GitHub Actions）：

| Service | 镜像示例 |
|---------|----------|
| proxy | `ghcr.io/octafuse/octafuse-gateway-proxy:v1.1.0` |
| admin | `ghcr.io/octafuse/octafuse-gateway-admin:v1.1.0` |
| migrate | `ghcr.io/octafuse/octafuse-gateway-migrate:v1.1.0` |

在 Zeabur 选择 **Docker Images** 创建 proxy/admin 常驻 Service；migrate 按 §3 方式 A 或 B 处理。

## 6. 与 SoloEnt 门户联调

- **Proxy** 对外 URL → 门户 `GATEWAY_URL`（客户端推理）
- **Admin** 对外 URL → 门户 `GATEWAY_MASTER_URL`（`/api/admin/*`）
- `MASTER_KEY` 以库内 `system_config.MASTER_KEY` 为准（迁移 `0002_seed.sql` 默认值，生产务必修改）

Postgres 时区建议 URL 带 `options=-c%20timezone%3DUTC`，见 [deployment-docker.md](./docker.md) § 时区。

## 7. 发布后验证

1. **migrate**（若本次执行）：日志含 `[migrate-postgres] 全部完成。` 与 `MIGRATE_DONE`；**无**连续 `BackOff restarting`（migrate Service 应已 Suspend 或未创建）。
2. **proxy**：`curl -fsS https://<proxy-host>/health`
3. **admin**：`curl -fsS -o /dev/null -w '%{http_code}\n' https://<admin-host>/`
4. **admin API**（可选）：`curl -fsS https://<admin-host>/api/admin/config -H 'Authorization: Bearer <MASTER_KEY>'`

## 8. 常见错误

| 现象 | 原因 | 处理 |
|------|------|------|
| migrate 日志成功但 Pod BackOff | migrate 当常驻 Service | 改用 §3 方式 0（`AUTO_MIGRATE=1`），或 Suspend migrate Service，或改用 §3 方式 A |
| proxy/admin 启动后 500 | 未 migrate 或 `DATABASE_URL` 不一致 | 设 `AUTO_MIGRATE=1` 或先跑 migrate，核对两 Service 连接串相同 |
| Admin 无法登录 | 未设 `ADMIN_PASSWORD` | 在 Zeabur 环境变量中配置 |
| 构建用了错误 Dockerfile | `ZBPACK_DOCKERFILE_NAME` 写全名 | 用 `ZBPACK_DOCKERFILE_PATH=Dockerfile.admin` |

## 9. 相关文档

- [deployment-docker.md](./docker.md) — 镜像与 Compose 通用说明
- [docker/examples/env.zeabur.example](../../../docker/examples/env.zeabur.example) — Zeabur 环境变量模板
- [scripts/deploy/zeabur-migrate-once.sh](../../../scripts/deploy/zeabur-migrate-once.sh) — 本地/CI 一次性迁移脚本
