# Octafuse Gateway：Docker Compose 示例

预构建镜像见 `.github/workflows/octafuse-docker-images.yml`（命名：`ghcr.io/<github.repository 小写>-{proxy,admin,migrate}`，例如 **`ghcr.io/octafuse/octafuse-gateway-proxy`**）。

**与镜像实现一致的行为**（详见 [docs/operators/deployment/docker.md](../../docs/operators/deployment/docker.md) §3、§5）：**proxy** 仅含 **已编译** 的 core/proxy（`node packages/proxy/dist/runtime/node.js`），**不**含 DB 迁移 CLI；**migrate** 使用 **`packages/core/dist/migrate/cli.js`**（与 **`octafuse-migrate`**、根目录 **`npm run db:migrate:pg`** 同源）。镜像内**不**再依赖 `tsx`。**`scripts/db/`**（D1 远程导出、`cutover/` 等）仅在宿主机克隆仓库后用于运维，**不**打入 proxy 镜像。

**宿主机端口**：示例里默认将 **proxy 映射到 `18787`、admin 映射到 `18789`**（可通过 `GATEWAY_PROXY_PORT` / `GATEWAY_ADMIN_PORT` 覆盖）；容器内进程仍为 **8787** / **8789**。

## 镜像仓库授权

部署机器需能 `docker pull` 对应镜像。请使用**你自己的** registry 账号，**勿**将 token 或密码写入仓库文档或提交到 Git。

```bash
# GHCR（示例：用 stdin 传入 token，避免出现在 shell 历史里）
printf '%s' "$GHCR_TOKEN" | docker login ghcr.io -u YOUR_GH_USERNAME --password-stdin

# 任意私有 OCI registry（如自建 Harbor 等；地域与命名空间以你的控制台为准；建议使用专用凭证或临时令牌）
docker login registry.example.com -u YOUR_REGISTRY_USERNAME
# 按提示输入密码，或使用：printf '%s' "$REGISTRY_PASSWORD" | docker login registry.example.com -u YOUR_REGISTRY_USERNAME --password-stdin
```

自托管部署步骤见 [docs/operators/deployment/docker.md](../../docs/operators/deployment/docker.md) 与 [docker/deploy/README.md](../deploy/README.md)。

## 当前保留形态

这里仅保留线上当前使用的形态：**Proxy 与 Admin 独立容器部署，共用外置 Postgres**。

| 场景 | Compose 文件 | 环境变量示例 |
|------|----------------|--------------|
| **仅 Proxy**（推理网关单独部署） | [`gateway.proxy.yml`](./gateway.proxy.yml) | [`env.proxy.example`](./env.proxy.example) |
| **仅 Admin**（管理面单独部署） | [`gateway.admin.yml`](./gateway.admin.yml) | [`env.admin.example`](./env.admin.example) |
| **同机同时启动 Proxy + Admin**（仍连接外置 Postgres） | [`gateway.compose.yml`](./gateway.compose.yml) | [`env.compose.external.example`](./env.compose.external.example) |
| **Zeabur（容器平台）** | 见 [zeabur.md](../../docs/operators/deployment/zeabur.md) | [`env.zeabur.example`](./env.zeabur.example) |

首次建库或发版后需要迁移时，使用 `--profile migrate`（**octafuse-migrate** 镜像，环境变量 **`GATEWAY_MIGRATE_IMAGE`**）。生产推荐固定为「**先 migrate，再启动服务**」。

### 仅 Admin（外置库）

在 **`octafuse-gateway` 仓库根目录**执行（下同）：

```bash
cp docker/examples/env.admin.example docker/deploy/.env.gateway
# 编辑 docker/deploy/.env.gateway：镜像、DATABASE_URL、ADMIN_PASSWORD 等
docker compose --env-file docker/deploy/.env.gateway -f docker/examples/gateway.admin.yml --profile migrate run --rm migrate
docker compose --env-file docker/deploy/.env.gateway -f docker/examples/gateway.admin.yml up -d
```

## 同机同时起 Proxy + Admin

与「仅 proxy / 仅 admin」共用同一套镜像变量，使用 `gateway.compose.yml` 即可同时起两个服务：

```bash
cp docker/examples/env.compose.external.example docker/deploy/.env.gateway
# 编辑 docker/deploy/.env.gateway：镜像、DATABASE_URL、ADMIN_PASSWORD 等
docker compose --env-file docker/deploy/.env.gateway -f docker/examples/gateway.compose.yml --profile migrate run --rm migrate
docker compose --env-file docker/deploy/.env.gateway -f docker/examples/gateway.compose.yml up -d
```

环境变量模板：[`env.compose.external.example`](./env.compose.external.example)。

## 本地测试（`docker/examples` 编排 + `docker/deploy` 环境）

在 **`octafuse-gateway` 仓库根目录**执行以下命令。将环境变量放在 **`docker/deploy/.env.local`**（从本目录 `env.*.example` 复制后编辑；勿提交密钥），或任意路径的 env 文件，作为 **`--env-file`**。变量需包含：`GATEWAY_PROXY_IMAGE`、`GATEWAY_ADMIN_IMAGE`、`GATEWAY_MIGRATE_IMAGE`（跑 migrate profile 时）、`DATABASE_URL`、`ADMIN_USERNAME` / `ADMIN_PASSWORD`（admin 相关）、以及可选的 `GATEWAY_PROXY_PORT` / `GATEWAY_ADMIN_PORT`。本机 Postgres 在宿主机、容器连库时通常将 `DATABASE_URL` 主机写成 `host.docker.internal`（见 [docker/deploy/README.md](../deploy/README.md)）。

将 `docker/deploy/.env.local` 换成你的实际 env 路径即可。

**1. 首次或发版后执行一次迁移**（`migrate` 使用 **migrate** 专用镜像；合并部署时与下面「同时起」共用同一条）：

```bash
docker compose --env-file docker/deploy/.env.local -f docker/examples/gateway.compose.yml --profile migrate run --rm migrate
```

**2. 同时启动 Proxy + Admin**（与 [`env.compose.external.example`](./env.compose.external.example) 形态一致）：

```bash
docker compose --env-file docker/deploy/.env.local -f docker/examples/gateway.compose.yml up -d
```

**3. 仅起其一**（按需二选一）：

```bash
# 仅 Proxy
docker compose --env-file docker/deploy/.env.local -f docker/examples/gateway.proxy.yml --profile migrate run --rm migrate   # 若尚未迁移
docker compose --env-file docker/deploy/.env.local -f docker/examples/gateway.proxy.yml up -d

# 仅 Admin（首次仍需 migrate：可用上一节双文件 migrate，或仅 proxy 文件跑 migrate）
docker compose --env-file docker/deploy/.env.local -f docker/examples/gateway.admin.yml --profile migrate run --rm migrate
docker compose --env-file docker/deploy/.env.local -f docker/examples/gateway.admin.yml up -d
```

**4. 本机校验**（端口以 env 中 `GATEWAY_*_PORT` 为准，未改时默认为 **18787** / **18789**）：

```bash
curl -fsS "http://127.0.0.1:18787/health"
curl -fsS -o /dev/null -w "%{http_code}\n" "http://127.0.0.1:18789/"
```

**5. 停止**：在仓库根目录执行（与启动时相同的 `-f` 与 `--env-file`）：

```bash
docker compose --env-file docker/deploy/.env.local -f docker/examples/gateway.compose.yml down
```

## 线上部署

在**已配置 `.env.gateway`** 的机器上，按场景选择 compose 文件；示例（外置 Postgres、同时起 proxy + admin）：

```bash
docker compose --env-file .env.gateway -f gateway.compose.yml pull
docker compose --env-file .env.gateway -f gateway.compose.yml --profile migrate run --rm migrate
docker compose --env-file .env.gateway -f gateway.compose.yml up -d
```

任意通用轻量服务器（无 Cloudflare 依赖）上的 Docker 编排同上（[docker.md](../../docs/operators/deployment/docker.md) + [docker/deploy/README.md](../deploy/README.md)）。

**Zeabur**：migrate 镜像为一次性 Job，**不要**作为常驻 Service（成功后进程退出会触发平台重启循环）。推荐发版前用 [`scripts/deploy/zeabur-migrate-once.sh`](../../scripts/deploy/zeabur-migrate-once.sh) 或 PREBUILT migrate 跑完后 **Suspend**；详见 **[docs/operators/deployment/zeabur.md](../../docs/operators/deployment/zeabur.md)** 与 [`env.zeabur.example`](./env.zeabur.example)。

## Nginx：Proxy 流式（SSE）反代提示

Docker 部署的 **gateway-proxy** 经 Nginx 反代时，若未关闭 `proxy_buffering` / 站点 `gzip`，`stream: true` 的接口可能表现为「不流式、一次性返回」。反代 Gateway 的 `location` 中应显式关闭响应缓冲，并确保 SSE 响应不会被压缩或缓存。

验证示例：

```bash
curl -N -H "Authorization: Bearer <KEY>" -H "Content-Type: application/json" \
  -d '{"model":"<id>","stream":true,"messages":[{"role":"user","content":"hi"}]}' \
  https://gateway.example.com/v1/chat/completions
```
