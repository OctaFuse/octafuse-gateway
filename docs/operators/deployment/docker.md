# 可选部署：Docker + SQL（Postgres 或 MySQL）（gateway-proxy + gateway-admin）

本文描述在容器环境同时运行 **`@octafuse/proxy`**（代理服务，对外推理）与 **`@octafuse/admin`**（管理后台，管理 UI + `/api/admin/*`），二者**共用同一关系型库**（Postgres 或 **MySQL 8**）。默认生产仍以 Cloudflare 为主（见 [cloudflare.md](./cloudflare.md)）。

## 1. 本文覆盖范围

本文聚焦 **Full self-hosted PG / MySQL**（以及 Hybrid 中代理服务侧容器）的镜像、环境变量、Compose 与迁移。完整拓扑矩阵（含 Cloudflare 全托管）见 **[runtime-data.md](../../developers/architecture/runtime-data.md)**。

> 代理服务不暴露 `/admin/*`；管理 HTTP 全部由管理后台在 **`/api/admin/*`** 提供。

## 2. 环境变量

### gateway-proxy 容器

|变量|必填|说明|
|------|------|------|
|`DATABASE_DRIVER`|否|与 `DATABASE_URL` 命名对齐。省略默认 `postgres`；MySQL 须 `mysql`（或 `mysql2`）。|
|`DATABASE_URL`|是|Postgres 或 **`mysql://`** 连接串（与所选驱动一致）|
|`PORT`|否|默认 `8787`|
|`AUTO_MIGRATE`|否|设为 `1`/`true`/`yes`/`on` 时，容器启动前自动执行幂等迁移（见 §5）。默认关闭。|
|迁移方式（备选）|—|未设 `AUTO_MIGRATE` 时，使用 **`Dockerfile.migrate`** 镜像，通过 `docker compose --profile migrate run --rm migrate` 执行。|

### gateway-admin 容器

|变量|必填|说明|
|------|------|------|
|`DATABASE_DRIVER`|否|与代理服务一致；Node 下省略默认 `postgres`，连 **MySQL 时必须 `mysql`**。|
|`DATABASE_URL`|是|与代理服务 **同一** Postgres 或 MySQL|
|`PORT`|否|默认 Dockerfile 内为 `8789`|
|`ADMIN_USERNAME`|是|控制台登录用户名|
|`ADMIN_PASSWORD`|是|控制台登录密码|
|`ADMIN_COOKIE_SECURE`|否|**可选加固**：为 `admin_session` 加上 `Secure`。默认不设（明文 HTTP / quickstart 可登录）。仅在已用 HTTPS 访问管理后台、并希望进一步限制会话 Cookie 时设 `1`/`true`/`yes`/`on`（见 [§7.3](#73-生产-https-建议)）。|
|`AUTO_MIGRATE`|否|与代理服务相同：真值时启动前自动迁移（见 §5）。默认关闭。|
|迁移方式（备选）|—|未设 `AUTO_MIGRATE` 时：迁移由 `migrate` 服务独立执行，管理后台仅负责应用进程。|

迁移会把数据库中原有 `system_config.MASTER_KEY` 复制为普通全权限集成密钥 `legacy-master`，并删除该配置行。新版认证只读取 `admin_api_keys`。部署后请登录后台，在 **系统集成 → 集成密钥（Integration Keys）** 为外部系统创建具名最小权限 Key。

### 时区与时间查询（重要）

完整约定见 [time-and-timezone.md](../../developers/reference/time-and-timezone.md)。容器侧要点：

- **统一目标**：时间存储与查询窗口按 **UTC**。
- **Postgres**：`DATABASE_URL` 建议带 `options=-c%20timezone%3DUTC`。
- **MySQL**：应用层多写 ISO UTC；若依赖库侧 `CURRENT_TIMESTAMP`，仍须把实例/会话时区设为 UTC。

## 3. 本仓库镜像（本地构建）

本地构建前除 `docker version` 与 `docker compose version` 外，还应确认 `docker buildx version` 可用。本仓 Dockerfile 使用 BuildKit 的 `RUN --mount=type=cache`，缺少 Buildx 时构建会直接失败。

**仓库根目录**提供三个 **多阶段** Dockerfile（**`node:22-alpine`**；运行层不含全量 monorepo 源码与「三 workspace 全量」`node_modules`；**不含** `tsx` / 仓库根 `scripts/db/*`；健康检查用 **Node 内嵌 `fetch`**，不装 `curl`）：

|文件|进程|默认端口|运行层说明|
|------|------|--------|----------|
|`Dockerfile.proxy`|`node packages/proxy/dist/runtime/node.js`（构建阶段已 `npm run build` **core + proxy**）|`8787`|**已编译** `packages/{core,proxy}/dist` + 生产 `node_modules`（core / tool-engines / proxy）；`@octafuse/*` 已打进 proxy bundle，运行层**不**需要 tool-engines 源码。|
|`Dockerfile.admin`|Next **standalone** + 实时 WS 入口（`node packages/admin/node-server.mjs`）|`8789`|**`.next/standalone` + `.next/static` + `public`**；另含运行所需的 `@octafuse/core` 构建产物、**`postgres` / `mysql2`** 与 **`ws`**；仅负责应用进程。调试台实时语音识别走自定义 HTTP Upgrade，不经过 Next App Router。|
|`Dockerfile.migrate`|一次性迁移 Job：`node packages/core/dist/migrate/cli.js`（无参数时由入口按 `DATABASE_DRIVER` 选择 `--driver`）|—|仅 **`@octafuse/core`** 构建产物与 SQL 目录；**`ENTRYPOINT`** [`../../../docker/entrypoint.migrate.sh`](../../../docker/entrypoint.migrate.sh)；供 **`--profile migrate`** / **`GATEWAY_MIGRATE_IMAGE`**。|

**代理服务 Node bundle 契约**：`packages/proxy/scripts/build.mjs` 用 esbuild 把所有 `@octafuse/*`（含 `@octafuse/core` 子路径与 `@octafuse/tool-engines`）打进 `dist/runtime/node.js`，仅把真实 npm 依赖（`hono`、`postgres` 等）标为 external。构建结束会校验产物中**不存在** `@octafuse/` 外部说明符；也可单独跑 `npm run verify:proxy-bundle`。

开发改 `packages/core` 或 Admin 后，提交前先跑 **`npm run typecheck:admin`**（约数秒）。`verify` 不执行 `next build`；PR 的 Docker 冒烟才会在镜像里做类型检查。

**管理后台镜像与 Cloudflare 构建分工**：`Dockerfile.admin` 在构建阶段执行 **`npm run build:docker -w @octafuse/admin`**（`next build` + `scripts/link-standalone-next.mjs` + `scripts/build-node-server.mjs`），**不**运行 `wrangler types`，因此镜像构建不依赖 **`workerd`**，可与 `npm ci --ignore-scripts` 的 CI 安装方式兼容。`build-node-server.mjs` 把 `runtime/node-server.ts` 打进 standalone 时，`@/lib/*` 必须再走 esbuild 默认解析（补 `.ts` / `index`）；不要把别名 join 成无扩展名绝对路径，否则会报 `Cannot read file: .../lib/admin-principal`。构建阶段会 **`COPY packages/tool-engines`**（调试台（Playground）Tools 与代理服务共用的引擎客户端，source-only），**不**再 COPY `packages/proxy`。部署到 Cloudflare（预览/生产）仍使用 **`npm run build:cf`** / **`npm run preview`** / **`npm run deploy`**（内含 `cf-typegen` 与 OpenNext Cloudflare 打包）。各 Dockerfile 在 `npm ci --ignore-scripts` 之后会 **`find node_modules -path '*/esbuild/install.js' -exec node {} \;`**：为树内**每一份** esbuild 执行其 `install.js`（`@octafuse/core` 与 `@opennextjs/*` 可能各带不同版本）。勿用 **`npm rebuild esbuild`**，否则多版本 esbuild 会触发「Expected 0.25.4 but got 0.27.3」类校验错误。

典型未压缩体积：**proxy** 常见约 **一百多 MB**；**admin** 因 Next standalone 与 trace 较大，常见约 **两百 MB 量级**；**migrate** 最小。若仍见 **~1GB+** 单层或总量异常，多为旧版单阶段镜像或本地缓存标签，请 `docker build --no-cache` 重建后对比 `docker image ls` / `docker history`。

```bash
docker build -f Dockerfile.proxy -t octafuse-proxy:local .
docker build -f Dockerfile.admin -t octafuse-admin:local .
docker build -f Dockerfile.migrate -t octafuse-migrate:local .
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

## GitHub Actions（GHCR 构建与推送）

**CI 镜像发布**由 **[`.github/workflows/octafuse-docker-images.yml`](../../../.github/workflows/octafuse-docker-images.yml)** 负责：**`runs-on: ubuntu-latest`**，**QEMU + Buildx** 多架构。镜像的 `org.opencontainers.image.description` 由该 workflow 里 **`docker/metadata-action` 的 `labels:`** 显式写入（避免沿用 GitHub 仓库 **About** 栏里尚未更新的历史描述）。

- **正式发布（推荐）**：合并 Version PR 后，**[`.github/workflows/release.yml`](../../../.github/workflows/release.yml)** 通过 Changesets 的 **`publish`** 步骤执行 **`npm run ci:changeset-tag-push`**（`changeset tag` + 推送 **`vX.Y.Z`**），从而触发本 workflow：构建 **proxy / admin / migrate**、`linux/amd64` + `linux/arm64`，并在 **GitHub Release** 正文中写入各镜像 **digest**。流程总览见 **[release-versioning.md](../../maintainers/release-versioning.md)**。
- **应急 / 验证**：仍可使用 **`workflow_dispatch`** 在 Actions 里手动勾选镜像与架构；**不会**自动创建 GitHub Release。

本地 `docker build` / `docker compose build` 可用于开发验证，但生产发版以 **tag → GHCR** 为准。

**手动 dispatch** 下可选择 **`linux/amd64`**、**`linux/arm64`**（默认两者均勾选），须至少勾选一种架构。标签策略：**commit sha**、**分支名**、**semver**（在版本 tag 上）、**`latest`**（`main` 上手动构建，或 **稳定版 `vX.Y.Z` tag** 推送时）。

推送后的 **GHCR** 镜像名（`github.repository` 转小写，与 workflow 中 `repository_lc` 一致）。本仓库官方镜像为：

- `ghcr.io/octafuse/octafuse-gateway-proxy:vX.Y.Z`
- `ghcr.io/octafuse/octafuse-gateway-admin:vX.Y.Z`
- `ghcr.io/octafuse/octafuse-gateway-migrate:vX.Y.Z`

fork 或其它 GitHub 仓库发布时，格式为 `ghcr.io/<owner>/<repo>-{proxy,admin,migrate}:<tag>`。

若将镜像同步到自建 Harbor 或其它私有 OCI registry，可在该侧做 **mirror / retag**，各 `docker/examples/env.*.example` 中注释给出了与发版一致的示例镜像名（固定 tag），格式如：

- `registry.example.com/example-org/octafuse-gateway-proxy:v2.0.0`
- `registry.example.com/example-org/octafuse-gateway-admin:v2.0.0`
- `registry.example.com/example-org/octafuse-gateway-migrate:v2.0.0`

在 GitHub：**Actions** → **Octafuse Docker Images (GH hosted Ubuntu)** → **Run workflow**（手动路径）。该 workflow 已声明 **`permissions: packages: write`**；若组织策略限制默认 `GITHUB_TOKEN`，请在仓库 **设置（Settings）→ Actions → General** 中放行对 **Packages** 的写入，或改用具备 `write:packages` 的 **PAT** 并配置为 secret。

`docker/examples/env.*.example` 里的 **GHCR** 示例已指向官方 `ghcr.io/octafuse/octafuse-gateway-*`；fork 或其它仓库请改前缀。若使用其它镜像仓库，按各模板文件内注释替换为 `registry.example.com/<namespace>/...`，一般只随版本改 **tag**。

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

代理服务 / 管理后台 / migrate 均注入 **`DATABASE_DRIVER=mysql`** 与 **`DATABASE_URL=mysql://…`**（见该 compose 文件）。首次使用前须成功执行 migrate（与 Postgres 流程相同，命令改为 **`db:migrate:mysql:docker`**）。

主机端口与 **`8787` / `8789`** 冲突时，仓库内置的 `docker/compose/node-pg.yml`、`node-mysql.yml` 与 `quickstart.yml` 使用 **`GATEWAY_PROXY_HOST_PORT`** / **`GATEWAY_ADMIN_HOST_PORT`**。预构建镜像模板 `docker/examples/*.yml` 则使用 **`GATEWAY_PROXY_PORT`** / **`GATEWAY_ADMIN_PORT`**；两套变量只控制宿主机映射，容器内进程仍为 `8787` / `8789`，不要混用。

### 4.2 预构建镜像（GHCR / 自建 Harbor / 任意私有 registry）

`docker/examples/` 下仅保留当前线上使用的预构建镜像部署形态：代理服务 / 管理后台独立容器，共用外置 Postgres。索引见该目录 **[README.md](../../../docker/examples/README.md)**：

- **仅代理服务**（外置库）：`gateway.proxy.yml` + `env.proxy.example`
- **仅管理后台**（外置库）：`gateway.admin.yml` + `env.admin.example`
- **外置 Postgres 且同机同时起代理服务 + 管理后台**：`gateway.compose.yml` + `env.compose.external.example`
- **第二私有 registry（自建 Harbor 等）**：任选一个与上相同的 `gateway.*.yml` 及对应 `env.*.example`，按文件内注释将镜像前缀替换为 `registry.example.com/<namespace>/...`；宿主机 env 文件放 **`docker/deploy/`**，约定见 **[docker/deploy/README.md](../../../docker/deploy/README.md)**。

外置 Postgres 同机启动示例：

```bash
cd docker/examples
cp env.compose.external.example .env.gateway
# 编辑镜像标签、DATABASE_URL、ADMIN_PASSWORD 等
docker compose --env-file .env.gateway -f gateway.compose.yml --profile migrate run --rm migrate
docker compose --env-file .env.gateway -f gateway.compose.yml up -d
```

## 5. 数据库迁移（Postgres 与 MySQL）

### 启动时自迁移（`AUTO_MIGRATE`）

代理服务 / 管理后台镜像通过 [`../../../docker/entrypoint.app.sh`](../../../docker/entrypoint.app.sh) 支持启动前迁移：

```bash
docker run --rm -p 8787:8787 \
  -e AUTO_MIGRATE=1 \
  -e DATABASE_DRIVER=postgres \
  -e DATABASE_URL='postgres://user:pass@host:5432/octafuse' \
  octafuse-proxy:local
```

- **默认关闭**：未设置 `AUTO_MIGRATE` 时，入口脚本跳过迁移，行为与旧版一致。
- **幂等且并发安全**：`schema_migrations` 记录版本 + `pg_advisory_lock`；无新 SQL 时近乎空操作。代理服务与管理后台同时开启也安全，但通常只需在一个 Service 上设 `AUTO_MIGRATE=1`。
- **Zeabur**：推荐在代理服务或管理后台环境变量中设 `AUTO_MIGRATE=1`，无需单独 migrate Service。见 [zeabur.md](./zeabur.md) §3 方式 0。

### Postgres

`system_config` 默认值由迁移 **`packages/core/migrations-postgres/0002_seed.sql`** 写入；无需单独 seed 命令。

本机（可读 `.env`）：

```bash
export DATABASE_URL='postgres://...'
npm run db:migrate:pg
```

容器内 **`DATABASE_URL` 已由 Compose / `docker run -e` 注入**，无需 `dotenv-cli`，请使用：

```bash
npm run db:migrate:pg:docker
```

在 Compose 中 `migrate` 服务使用 **`Dockerfile.migrate` 对应镜像**（**`GATEWAY_MIGRATE_IMAGE`**）：镜像内为 **`packages/core/dist/migrate/cli.js`** + **`migrations-postgres`** / **`migrations-mysql`** + core 生产依赖（与本地 **`npm run db:migrate:*:docker`** 同源，均为编译后的 CLI）。未使用 `AUTO_MIGRATE` 时，生产建议固定流程为：**先 migrate，再启动代理服务 / 管理后台**。

仅部署管理后台（`docker/examples/gateway.admin.yml`）时，迁移方式保持一致：使用 compose 的 **`migrate` 服务**（镜像为 **`GATEWAY_MIGRATE_IMAGE`**），再启动管理后台。`.env` 中需配置 **`GATEWAY_MIGRATE_IMAGE`** 与 `DATABASE_URL`。

### MySQL 8

与 Postgres 对称：**代理服务 / 管理后台 / 一次性 migrate** 共用 **`DATABASE_URL`**；Node 连接 MySQL 时须设置 **`DATABASE_DRIVER=mysql`**（省略时默认为 `postgres`）。

MySQL 8.4 会严格检查 `INSERT ... AS new ON DUPLICATE KEY UPDATE` 中的歧义列。本仓 `0002_seed.sql` 已将目标列限定为 `system_config.key` / `system_config.value`；旧 fork 若在种子迁移看到 `Column 'key' in field list is ambiguous`，请先同步该迁移修复。若失败发生在已有业务数据的库中，不要删除卷，应先备份并核对已创建对象后再恢复。

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
export DATABASE_URL='mysql://user:pass@host:3306/octafuse'
export DATABASE_DRIVER=mysql
npm run db:migrate:mysql
```

容器内（`DATABASE_URL` / `DATABASE_DRIVER` 已由 Compose 或 `docker run -e` 注入）：

```bash
npm run db:migrate:mysql:docker
```

Compose 中 `migrate` 服务使用 **migrate 专用镜像**执行 `npm run db:migrate:mysql:docker`。本地构建一体化见 §4.1b（`docker/compose/node-mysql.yml`）；`docker/examples/` 不再保留预构建镜像的 MySQL 示例。

### Zeabur（容器平台）

**推荐**：在代理服务或管理后台上设 **`AUTO_MIGRATE=1`**（见 [zeabur.md](./zeabur.md) §3 方式 0）。

若不用 `AUTO_MIGRATE`，Zeabur 将每个 **Service** 视为常驻进程；**migrate 镜像跑完即退出**，若作为 Service 长期运行会触发 `BackOff restarting failed container`（迁移成功也会如此）。备选做法：

1. 发版前在本地/CI 执行 [`scripts/deploy/zeabur-migrate-once.sh`](../../../scripts/deploy/zeabur-migrate-once.sh)，再部署代理服务 / 管理后台。
2. **或**：Zeabur PREBUILT migrate Service 跑完后 **设置（Settings）→ 暂停服务（Suspend Service）**。
3. **不要**把 migrate 与代理服务 / 管理后台一样当作 7×24 常驻 Service。

详见 **[zeabur.md](./zeabur.md)** 与 [`docker/examples/env.zeabur.example`](../../../docker/examples/env.zeabur.example)。

## 6. 非 Docker：本机 Node + Postgres（开发）

仍可直接用 npm 启动（不经过镜像），与 [local-development.md](../../developers/local-development.md) 一致。

## 7. 发布后最小验证

1. 代理服务：`GET /health` 成功。
2. 代理服务：`GET /v1/models`（有效 `sk-`）抽样成功。
3. 管理后台：`GET /api/admin/config` 等（`Authorization: Bearer <ADMIN_API_KEY>`，且 Key 具有相应权限）。
4. 管理后台：浏览器打开根路径 `/` 或 `/dashboard`，确认静态资源与页面可加载（standalone 已包含 `HOSTNAME=0.0.0.0` 监听）。

### 7.1 镜像体积与层（可选）

瘦身生效时，`docker history <image>` 中 **不应再出现 ~1GB 的 `npm ci` 单层**；代理服务运行层为 **双 workspace 生产依赖 + `dist`**，不含管理后台、不含 `tsx` / 迁移源码树。可用 `docker run --rm <proxy-tag> ls node_modules/tsx` 验证应 **不存在**（与旧版对比）。

### 7.2 与 `docker/compose/node-pg.yml` 对齐的示例

完成迁移后，先用浏览器登录后台并创建至少含 `config.read` 的具名 Admin API Key：

```bash
curl -fsS http://127.0.0.1:8787/health
curl -fsS http://127.0.0.1:8789/api/admin/config \
  -H 'Authorization: Bearer <ADMIN_API_KEY>'
```

### 7.3 生产 HTTPS 建议

管理后台会话 Cookie（`admin_session`）默认**不**带 `Secure`，因此无需额外配置即可用 `http://localhost:8789` 或局域网 IP 登录（quickstart 开箱可用）。

**生产强烈建议**将管理后台（以及对外暴露的代理服务）置于 Nginx / Caddy / Traefik 等 **TLS 反代**之后，使用 HTTPS 访问控制台，避免把管理口明文暴露到不可信网络。

若已通过 HTTPS 访问管理后台，可按需开启可选加固 **`ADMIN_COOKIE_SECURE=1`**（Compose / `.env`），让浏览器仅在 HTTPS 下保存并回传会话 Cookie。该变量不是必需项；不设不影响正常登录。

Nginx 示例（将上游与证书路径换成你的环境）：

```nginx
server {
  listen 443 ssl;
  server_name gateway-admin.example.com;

  ssl_certificate     /etc/nginx/certs/fullchain.pem;
  ssl_certificate_key /etc/nginx/certs/privkey.pem;

  location / {
    proxy_pass http://127.0.0.1:8789;
    proxy_http_version 1.1;
    proxy_set_header Host $host;
    proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
    proxy_set_header X-Forwarded-Proto $scheme;
  }
}
```

Caddy（自动申请证书时）：

```caddy
gateway-admin.example.com {
  reverse_proxy 127.0.0.1:8789
}
```

## 8. 如何更新版本

升级前阅读目标版本 [GitHub Release](https://github.com/OctaFuse/octafuse-gateway/releases) / `CHANGELOG.md` 中的 **升级说明**（破坏性变更、必做迁移、维护窗口）。推荐顺序：**先 migrate，再滚动重启代理服务 / 管理后台**；或仅在一侧开启 `AUTO_MIGRATE=1`（见 §5）。

> **升级到 v2.7.0**：必须应用迁移 **0026**。请将 Proxy、Admin 与 migrate 镜像统一升级到 v2.7.0，先执行 migrate，再启动应用；不要混用不同版本镜像。

### 8.1 预构建镜像（GHCR / 私有 registry）

1. 编辑宿主机 env（通常在 `docker/deploy/`，由 `docker/examples/env.*.example` 复制）：将 `GATEWAY_PROXY_IMAGE`、`GATEWAY_ADMIN_IMAGE`、`GATEWAY_MIGRATE_IMAGE` 的 **tag** 改为目标版本（生产钉死 `vX.Y.Z`；需要可复现固定时从 GHCR 包页核对 **digest**）。
2. 拉取 → 迁移 → 重建：

```bash
docker compose --env-file docker/deploy/.env.local -f docker/examples/gateway.compose.yml pull
docker compose --env-file docker/deploy/.env.local -f docker/examples/gateway.compose.yml --profile migrate run --rm migrate
docker compose --env-file docker/deploy/.env.local -f docker/examples/gateway.compose.yml up -d
```

仅代理服务或仅管理后台时，换成对应的 `gateway.proxy.yml` / `gateway.admin.yml` 与 env 文件即可。若已设 `AUTO_MIGRATE=1`，`pull` 后可直接 `up -d`；仍须按 Release 判断是否需要维护窗口。

### 8.2 本地构建镜像（Compose `node-pg` / `node-mysql` / `quickstart`）

```bash
git pull --ff-only
docker compose -f docker/compose/node-pg.yml --profile migrate run --rm migrate
docker compose -f docker/compose/node-pg.yml up -d --build gateway-proxy gateway-admin
```

MySQL 将 `node-pg.yml` 换成 `node-mysql.yml`。一键体验：`docker compose -f docker/compose/quickstart.yml up --build -d`。

### 8.3 升级后验收

同 [§7](#7-发布后最小验证)：`GET /health`、抽样 `GET /v1/models`、管理后台 `GET /api/admin/config` 与控制台可打开。

Cloudflare Workers 路径的升级步骤见 [cloudflare-quickstart.md §12](./cloudflare-quickstart.md#12-后续升级)。

---

**相关文档**：[部署索引](./README.md) · [D1 ↔ Postgres 切换](../migrations/d1-postgres-cutover.md) · [本地测试](../../developers/local-development.md)
