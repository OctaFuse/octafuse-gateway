# 可选部署：Docker + SQL（Postgres 或 MySQL）（gateway-proxy + gateway-admin）

本文描述在容器环境同时运行 **`@octafuse/proxy`**（对外推理）与 **`@octafuse/admin`**（管理 UI + `/api/admin/*`），二者**共用同一关系型库**（Postgres 或 **MySQL 8**）。默认生产仍以 Cloudflare 为主（见 [deployment-cloudflare.md](./deployment-cloudflare.md)）。

## 1. 部署模式对照

|模式|Proxy|Admin|数据库|
|------|------|------|------|
|Cloudflare 全托管（默认）|Worker|Pages/OpenNext|D1|
|Hybrid|Node（容器）|Pages/OpenNext|Proxy=Postgres，Admin=D1|
|Full self-hosted PG（本文 §2–§5）|Node 容器|Next.js 容器|同一 Postgres|
|Full self-hosted MySQL（本文 §8）|Node 容器|Next.js 容器|同一 MySQL 8|

> Proxy 不暴露 `/admin/*`；管理 HTTP 全部由 Admin 在 **`/api/admin/*`** 提供。

## 2. 环境变量

### gateway-proxy 容器

|变量|必填|说明|
|------|------|------|
|`DATABASE_DRIVER`|否|与 `DATABASE_URL` 命名对齐。省略默认 `postgres`；MySQL 须 `mysql`（或 `mysql2`）。|
|`DATABASE_URL`|是|Postgres 或 **`mysql://`** 连接串（与所选驱动一致）|
|`PORT`|否|默认 `8787`|
|迁移方式|—|统一使用 **`docker/build/Dockerfile.migrate`** 对应镜像，通过 `docker compose --profile migrate run --rm migrate` 执行。|

### gateway-admin 容器

|变量|必填|说明|
|------|------|------|
|`DATABASE_DRIVER`|否|与 Proxy 一致；Node 下省略默认 `postgres`，连 **MySQL 时必须 `mysql`**。|
|`DATABASE_URL`|是|与 Proxy **同一** Postgres 或 MySQL|
|`PORT`|否|默认 Dockerfile 内为 `8789`|
|`ADMIN_USERNAME`|是|控制台登录用户名|
|`ADMIN_PASSWORD`|是|控制台登录密码|
|迁移方式|—|与 Proxy 一致：迁移由 `migrate` 服务独立执行，admin 仅负责应用进程。|

`MASTER_KEY` 仍以数据库 `system_config.MASTER_KEY` 为准（迁移 `0002_seed.sql` 写入的默认值、管理配置页或 SQL）。

### 时区与时间查询（重要）

- **统一目标**：Gateway 的时间存储与查询窗口都按 **UTC** 口径运行。
- **Postgres**：建议在 `DATABASE_URL` 增加 `options=-c timezone=UTC`，例如：
  - `postgresql://user:pass@host:5432/db?options=-c%20timezone%3DUTC`
  - 这样可避免数据库实例默认时区不是 UTC 时，`created_at` 相关查询出现时间窗错位。
- **MySQL**：当前 Gateway 主写路径多数由应用层写入 `new Date().toISOString()`（UTC），因此通常不容易出现与 Postgres 相同的错位。
  - 但若你依赖数据库侧 `CURRENT_TIMESTAMP`（手工 SQL、临时脚本、后续新表默认值），仍会受 MySQL 会话/实例 `time_zone` 影响。
  - 建议将 MySQL 实例（或会话）时区设置为 UTC，保持与 Gateway 查询窗口一致。

## 3. 本仓库镜像（本地构建）

**`docker/build/`** 下提供三个 **多阶段** Dockerfile（**`node:22-alpine`**；运行层不含全量 monorepo 源码与「三 workspace 全量」`node_modules`；**不含** `tsx` / 仓库根 `scripts/db/*`；健康检查用 **Node 内嵌 `fetch`**，不装 `curl`）：

|文件|进程|默认端口|运行层说明|
|------|------|--------|----------|
|`docker/build/Dockerfile.proxy`|`node packages/proxy/dist/runtime/node.js`（构建阶段已 `npm run build` **core + proxy**）|`8787`|**已编译** `packages/{core,proxy}/dist` + 生产 `node_modules`（**仅** core、proxy 两个 workspace）；由 `CMD` 直接启动运行时入口。|
|`docker/build/Dockerfile.admin`|Next **standalone**（`node packages/admin/server.js`）|`8789`|**`.next/standalone` + `.next/static` + `public`**；另含运行所需的 `@octafuse/core` 构建产物与 **`postgres` / `mysql2`** 依赖子集；仅负责应用进程。|
|`docker/build/Dockerfile.migrate`|一次性迁移 Job：`node packages/core/dist/migrate/cli.js`（无参数时由入口按 `DATABASE_DRIVER` 选择 `--driver`）|—|仅 **`@octafuse/core`** 构建产物与 SQL 目录；**`ENTRYPOINT`** [`docker/entrypoint.migrate.sh`](../../docker/entrypoint.migrate.sh)；供 **`--profile migrate`** / **`GATEWAY_MIGRATE_IMAGE`**。|

典型未压缩体积：**proxy** 常见约 **一百多 MB**；**admin** 因 Next standalone 与 trace 较大，常见约 **两百 MB 量级**；**migrate** 最小。若仍见 **~1GB+** 单层或总量异常，多为旧版单阶段镜像或本地缓存标签，请 `docker build --no-cache` 重建后对比 `docker image ls` / `docker history`。

```bash
cd octafuse
docker build -f docker/build/Dockerfile.proxy -t octafuse-proxy:local .
docker build -f docker/build/Dockerfile.admin -t octafuse-admin:local .
docker build -f docker/build/Dockerfile.migrate -t octafuse-migrate:local .
```

单独运行示例：

```bash
docker run --rm -p 8787:8787 \
  -e DATABASE_DRIVER=postgres \
  -e DATABASE_URL='postgres://user:pass@host:5432/octafuse' \
  octafuse-proxy:local

docker run --rm -p 8789:8789 \
  -e DATABASE_DRIVER=postgres \
  -e DATABASE_URL='postgres://user:pass@host:5432/octafuse' \
  -e ADMIN_USERNAME=admin \
  -e ADMIN_PASSWORD='replace-me' \
  octafuse-admin:local
```

（首次使用前须对该库执行 [§5](#5-数据库迁移与校验postgres)。）

## GitHub Actions（GHCR 构建与推送；可选阿里云 ACR 双推）

**CI 镜像发布入口（本仓约定）**：向 **GHCR**（及可选 **阿里云 ACR**）推送 **octafuse** 的 **proxy/admin/migrate** 镜像由 **[`.github/workflows/octafuse-docker-images.yml`](../../.github/workflows/octafuse-docker-images.yml)** 负责：**`runs-on: ubuntu-latest`**，使用 **QEMU + Buildx** 支持多架构。

本地 `docker build` / `docker compose build` 仍可用于开发与验证，但不替代上述 CI 发版路径。

该 workflow 在 **`workflow_dispatch`** 下用 **Docker Buildx** 按勾选构建 **proxy**、**admin**、**migrate** 镜像。**GHCR** 始终作为推送目标之一；若在仓库 **Variables** 中配置 **`ACR_REGISTRY`**、**`ACR_NAMESPACE`**、**`ACR_USERNAME`**，并在 **Secrets** 中配置 **`ACR_PASSWORD`**，则同一次 **`docker/build-push-action`** 会将 **相同 tag** 额外推送到 **`${ACR_REGISTRY}/${ACR_NAMESPACE}/octafuse-{proxy,admin,migrate}`**（与 workflow 文件头注释一致）。运行时可选择目标架构 **`linux/amd64`**、**`linux/arm64`**（默认仅 **amd64**；**arm64** 需手动勾选），且须至少勾选一种架构。标签策略与 legacy **`octafuse`** 的 **`gateway-node-image.yml`** 一致：`main` 上含 **`latest`**，另有 **commit sha**、**分支名**、**semver**（推送版本 tag 时）。

推送后的镜像名（`owner/repo` 会转小写以符合 GHCR 约定）：

- `ghcr.io/<owner>/octafuse-proxy:<tag>`
- `ghcr.io/<owner>/octafuse-admin:<tag>`
- `ghcr.io/<owner>/octafuse-migrate:<tag>`

国内从 **阿里云 ACR** 拉取时，各 `docker/examples/env.*.example` 内 **国内阿里云 ACR** 注释给出了与发版一致的示例镜像名（固定 tag），例如：

- `registry.cn-shanghai.aliyuncs.com/example-org/octafuse-proxy:v1.0.0`
- `registry.cn-shanghai.aliyuncs.com/example-org/octafuse-admin:v1.0.0`
- `registry.cn-shanghai.aliyuncs.com/example-org/octafuse-migrate:v1.0.0`

在 GitHub：**Actions** → 选择 **Octafuse Docker Images (GH hosted Ubuntu)** → **Run workflow**。该 workflow 已声明 **`permissions: packages: write`**；若组织策略限制默认 `GITHUB_TOKEN`，请在仓库 **Settings → Actions → General** 中放行对 **Packages** 的写入，或改用具备 `write:packages` 的 **PAT** 并配置为 secret。

`docker/examples/env.*.example` 里 **GHCR** 示例前缀请按你的 **`ghcr.io/<owner>/...`** 实际替换；**国内 ACR** 按同目录各模板文件内 **国内阿里云 ACR** 注释替换为 `registry.cn-shanghai.aliyuncs.com/example-org/...`，一般只随版本改 **tag**。

## 4. Docker Compose 样例

### 4.1 本地构建镜像 + 内置 Postgres

**`docker/compose/node-pg.yml`** 会构建 **proxy、admin、migrate（profile）** 镜像并启动 **proxy + admin**：

```bash
docker compose -f docker/compose/node-pg.yml up -d postgres
docker compose -f docker/compose/node-pg.yml --profile migrate run --rm migrate
docker compose -f docker/compose/node-pg.yml up -d gateway-proxy gateway-admin
```

### 4.1b 本地构建镜像 + 内置 MySQL 8

**`docker/compose/node-mysql.yml`** 编排 **MySQL 8.4 + migrate + proxy + admin**（迁移链 `packages/core/migrations-mysql/`）。宿主机 MySQL 端口默认 **`3306`**，可用环境变量 **`MYSQL_HOST_PORT`** 改映射以避免与本机冲突。

```bash
docker compose -f docker/compose/node-mysql.yml up -d mysql
docker compose -f docker/compose/node-mysql.yml --profile migrate run --rm migrate
docker compose -f docker/compose/node-mysql.yml up -d gateway-proxy gateway-admin
```

Proxy / Admin / migrate 均注入 **`DATABASE_DRIVER=mysql`** 与 **`DATABASE_URL=mysql://…`**（见该 compose 文件）。首次使用前须成功执行 migrate（与 Postgres 流程相同，命令改为 **`db:migrate:mysql:docker`**）。

主机端口与 **`8787` / `8789`** 冲突时，可在 `docker/examples/` 或 `docker/deploy/` 的 Compose 对应 `.env` 中设置 **`GATEWAY_PROXY_PORT`**、**`GATEWAY_ADMIN_PORT`**（仅控制宿主机映射；容器内进程仍为 `8787`/`8789`）。

### 4.2 预构建镜像（GHCR / 私有仓 / 阿里云 ACR）

`docker/examples/` 下仅保留当前线上使用的预构建镜像部署形态：Proxy / Admin 独立容器，共用外置 Postgres。索引见该目录 **[README.md](../../docker/examples/README.md)**：

- **仅 proxy**（外置库）：`gateway.proxy.yml` + `env.proxy.example`
- **仅 admin**（外置库）：`gateway.admin.yml` + `env.admin.example`
- **外置 Postgres 且同机同时起 proxy + admin**：`gateway.compose.yml` + `env.compose.external.example`
- **国内阿里云 ACR**（固定 tag，与 `registry.cn-shanghai.aliyuncs.com/example-org/...` 对齐）：任选一个与上相同的 `gateway.*.yml` 及对应 `env.*.example`，按文件内 **国内阿里云 ACR** 注释配置镜像（详见 **[docker/deploy/README.md](../../docker/deploy/README.md)** §国内服务器）

外置 Postgres 同机启动示例：

```bash
cd docker/examples
cp env.compose.external.example .env.gateway
# 编辑镜像标签、DATABASE_URL、ADMIN_PASSWORD 等
docker compose --env-file .env.gateway -f gateway.compose.yml --profile migrate run --rm migrate
docker compose --env-file .env.gateway -f gateway.compose.yml up -d
```

## 5. 数据库迁移（Postgres 与 MySQL）

### Postgres

`system_config` 默认值由迁移 **`packages/core/migrations-postgres/0002_seed.sql`** 写入；无需单独 seed 命令。

本机（可读 `.env`）：

```bash
cd octafuse
export DATABASE_URL='postgres://...'
npm run db:migrate:pg
```

容器内 **`DATABASE_URL` 已由 Compose / `docker run -e` 注入**，无需 `dotenv-cli`，请使用：

```bash
npm run db:migrate:pg:docker
```

在 Compose 中 `migrate` 服务使用 **`docker/build/Dockerfile.migrate` 对应镜像**（**`GATEWAY_MIGRATE_IMAGE`**）：镜像内为 **`packages/core/dist/migrate/cli.js`** + **`migrations-postgres`** / **`migrations-mysql`** + core 生产依赖（与本地 **`npm run db:migrate:*:docker`** 同源，均为编译后的 CLI）。生产建议固定流程为：**先 migrate，再启动 proxy/admin**。

仅部署 Admin（`docker/examples/gateway.admin.yml`）时，迁移方式保持一致：使用 compose 的 **`migrate` 服务**（镜像为 **`GATEWAY_MIGRATE_IMAGE`**），再启动 admin。`.env` 中需配置 **`GATEWAY_MIGRATE_IMAGE`** 与 `DATABASE_URL`。

### MySQL 8

与 Postgres 对称：**Proxy / Admin / 一次性 migrate** 共用 **`DATABASE_URL`**；Node 连接 MySQL 时须设置 **`DATABASE_DRIVER=mysql`**（省略时默认为 `postgres`）。

`system_config` 默认值由迁移 **`packages/core/migrations-mysql/0002_seed.sql`** 写入。

时区建议（避免 `created_at` 查询窗口错位）：

- 推荐将 MySQL 实例/会话统一到 **UTC**（`time_zone = '+00:00'`）。
- 当前 Gateway 关键写路径多数由应用层写入 UTC ISO 字符串，但只要存在数据库侧 `CURRENT_TIMESTAMP`（例如手工 SQL、临时脚本、后续新增默认值），仍会受 MySQL 时区影响。
- 部署后建议做一次自检：

```sql
SELECT @@global.time_zone AS global_tz, @@session.time_zone AS session_tz;
SELECT NOW() AS now_local, UTC_TIMESTAMP() AS now_utc;
```

若 `global_tz` / `session_tz` 不是 `'+00:00'`（或 `UTC`），请先调整实例或连接初始化策略，再进行时间窗口相关排障。

本机（可读 `.env`）：

```bash
cd octafuse
export DATABASE_URL='mysql://user:pass@host:3306/octafuse'
export DATABASE_DRIVER=mysql
npm run db:migrate:mysql
```

容器内（`DATABASE_URL` / `DATABASE_DRIVER` 已由 Compose 或 `docker run -e` 注入）：

```bash
npm run db:migrate:mysql:docker
```

Compose 中 `migrate` 服务使用 **migrate 专用镜像**执行 `npm run db:migrate:mysql:docker`。本地构建一体化见 §4.1b（`docker/compose/node-mysql.yml`）；`docker/examples/` 不再保留预构建镜像的 MySQL 示例。

## 6. 非 Docker：本机 Node + Postgres（开发）

仍可直接用 npm 启动（不经过镜像），与 [local-testing-environments.md](./local-testing-environments.md) 一致。

## 7. 发布后最小验证

1. Proxy：`GET /health` 成功。
2. Proxy：`GET /v1/models`（有效 `sk-`）抽样成功。
3. Admin：`GET /api/admin/config` 等（`Authorization: Bearer <MASTER_KEY>`）。
4. Admin：浏览器打开根路径 `/` 或 `/dashboard`，确认静态资源与页面可加载（standalone 已包含 `HOSTNAME=0.0.0.0` 监听）。

### 7.1 镜像体积与层（可选）

瘦身生效时，`docker history <image>` 中 **不应再出现 ~1GB 的 `npm ci` 单层**；proxy 运行层为 **双 workspace 生产依赖 + `dist`**，不含 admin、不含 `tsx` / 迁移源码树。可用 `docker run --rm <proxy-tag> ls node_modules/tsx` 验证应 **不存在**（与旧版对比）。

### 7.2 与 `docker/compose/node-pg.yml` 对齐的示例

完成迁移后（迁移 `0002_seed.sql` 写入的默认 `MASTER_KEY` 与 D1 一致，示例为 **`sk-dev-admin-key`**）：

```bash
curl -fsS http://127.0.0.1:8787/health
curl -fsS http://127.0.0.1:8789/api/admin/config \
  -H 'Authorization: Bearer sk-dev-admin-key'
```

---

**相关文档**：[部署索引](./deployment.md) · [D1 ↔ Postgres 切换](./postgres-cutover.md) · [本地测试](./local-testing-environments.md) · Nginx 流式反代样例：[docker/examples/nginx/](../../docker/examples/nginx/)
