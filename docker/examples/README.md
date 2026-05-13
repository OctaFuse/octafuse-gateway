# Gateway v2 Docker Compose 示例

预构建镜像见 `.github/workflows/octafuse-docker-images.yml`（`ghcr.io/<owner 小写>/octafuse-{proxy,admin,migrate}`）。

**与镜像实现一致的行为**（详见 [docs/ops/deployment-docker.md](../../docs/ops/deployment-docker.md) §3、§5）：**proxy** 仅含 **已编译** 的 core/proxy（`node packages/proxy/dist/runtime/node.js`），**不**含 DB 迁移 CLI；**migrate** 使用 **`packages/core/dist/migrate/cli.js`**（与 **`octafuse-migrate`**、根目录 **`npm run db:migrate:pg`** 同源）。镜像内**不**再依赖 `tsx`。**`scripts/db/`**（D1 远程导出、`cutover/` 等）仅在宿主机克隆仓库后用于运维，**不**打入 proxy 镜像。

**宿主机端口**：示例里默认将 **proxy 映射到 `18787`、admin 映射到 `18789`**（可通过 `GATEWAY_PROXY_PORT` / `GATEWAY_ADMIN_PORT` 覆盖）；容器内进程仍为 **8787** / **8789**。

## 镜像仓库授权

部署机器需能 `docker pull` 对应镜像。请使用**你自己的** registry 账号，**勿**将 token 或密码写入仓库文档或提交到 Git。

```bash
# 海外：GHCR（示例：用 stdin 传入 token，避免出现在 shell 历史里）
printf '%s' "$GHCR_TOKEN" | docker login ghcr.io -u YOUR_GH_USERNAME --password-stdin

# 国内：阿里云 ACR（地域与命名空间以控制台为准；建议使用 RAM 子账号专用密码或临时凭证）
docker login registry.cn-shanghai.aliyuncs.com -u YOUR_ACR_USERNAME
# 按提示输入密码，或使用：printf '%s' "$ACR_PASSWORD" | docker login registry.cn-shanghai.aliyuncs.com -u YOUR_ACR_USERNAME --password-stdin
```

自托管部署步骤见 [docs/ops/deployment-docker.md](../../docs/ops/deployment-docker.md) 与 [docker/deploy/README.md](../deploy/README.md)。

## 当前保留形态

这里仅保留线上当前使用的形态：**Proxy 与 Admin 独立容器部署，共用外置 Postgres**。

| 场景 | Compose 文件 | 环境变量示例 |
|------|----------------|--------------|
| **仅 Proxy**（推理网关单独部署） | [`gateway.proxy.yml`](./gateway.proxy.yml) | [`env.proxy.example`](./env.proxy.example) |
| **仅 Admin**（管理面单独部署） | [`gateway.admin.yml`](./gateway.admin.yml) | [`env.admin.example`](./env.admin.example) |
| **同机同时启动 Proxy + Admin**（仍连接外置 Postgres） | [`gateway.compose.yml`](./gateway.compose.yml) | [`env.compose.external.example`](./env.compose.external.example) |

首次建库或发版后需要迁移时，使用 `--profile migrate`（**octafuse-migrate** 镜像，环境变量 **`GATEWAY_MIGRATE_IMAGE`**）。生产推荐固定为「**先 migrate，再启动服务**」。

### 仅 Admin（外置库）

在 **`octafuse` 仓库根目录**执行（下同）：

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

在 **`octafuse` 仓库根目录**执行以下命令。用 [`docker/deploy/.env.local`](../deploy/.env.local)（或复制 [`docker/deploy/.env.prod`](../deploy/.env.prod) 后自行调整）作为 **`--env-file`**。环境变量需包含：`GATEWAY_PROXY_IMAGE`、`GATEWAY_ADMIN_IMAGE`、`GATEWAY_MIGRATE_IMAGE`（跑 migrate profile 时）、`DATABASE_URL`、`ADMIN_USERNAME` / `ADMIN_PASSWORD`（admin 相关）、以及可选的 `GATEWAY_PROXY_PORT` / `GATEWAY_ADMIN_PORT`。本机 Postgres 在宿主机、容器连库时通常将 `DATABASE_URL` 主机写成 `host.docker.internal`（见 [`docker/deploy/README.md`](../deploy/README.md)）。

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

国内或通用轻量服务器上的 Docker 编排同上（[deployment-docker.md](../../docs/ops/deployment-docker.md) + [docker/deploy/README.md](../deploy/README.md)）。

## Nginx：Proxy 流式（SSE）反代样板

Docker 部署的 **gateway-proxy** 经 Nginx 反代时，若未关闭 `proxy_buffering` / 站点 `gzip`，`stream: true` 的接口可能表现为「不流式、一次性返回」。请直接使用下面仓库内样例（可粘贴进 `location` / `server` 块；按需改 `proxy_pass` 上游端口）。

| 文件 | 说明 |
|------|------|
| [`nginx/gateway-proxy.location.conf`](./nginx/gateway-proxy.location.conf) | 可放入 `location / { ... }` 内的指令集合（**须**写在 `location` 块里；默认 `proxy_pass` 到 `127.0.0.1:18787`） |
| [`nginx/gateway-proxy.server.conf.example`](./nginx/gateway-proxy.server.conf.example) | 完整 `server { }` 示例（`gateway.example.com` + SSL 占位） |

验证示例：

```bash
curl -N -H "Authorization: Bearer <KEY>" -H "Content-Type: application/json" \
  -d '{"model":"<id>","stream":true,"messages":[{"role":"user","content":"hi"}]}' \
  https://gateway.example.com/v1/chat/completions
```