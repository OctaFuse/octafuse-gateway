# 宝塔 Docker 部署记录：外置 PostgreSQL + Nginx HTTPS

记录日期：2026-10-23。以下以本次使用的 `v2.14.0` 为例，升级时将两个镜像统一切换到目标版本。

## 部署结构与端口

- PostgreSQL 使用外部数据库，代理服务和管理后台连接同一个 `DATABASE_URL`。
- `gateway-proxy` 为常驻 API 服务，容器内端口 8787，宿主机端口 18787。
- `gateway-admin` 为常驻管理后台，容器内端口 8789，宿主机端口 18789。
- 两个服务都设置 `AUTO_MIGRATE=1`。容器每次启动时先在已有库中执行迁移，完成后再监听端口。
- 宿主机端口绑定到 `0.0.0.0`。宝塔 Nginx 仍反代 `127.0.0.1` 上的映射端口；若端口只允许本机访问，见第 5 节。

| 服务 | 对外访问示例 | 宝塔 Nginx 反向代理目标 |
| --- | --- | --- |
| Gateway API | https://api.example.com | http://127.0.0.1:18787 |
| 管理后台 | https://admin.example.com | http://127.0.0.1:18789 |

域名替换成自己的域名。反代目标使用宿主机映射端口 18787 / 18789。

## 1. Docker Compose

在服务器部署目录保存为 `compose.yml`；也可以将内容放入宝塔 Docker 的 Compose 编排，并为该编排配置同目录的 `.env`。

```yaml
# BaoTa deployment: external PostgreSQL, two long-running containers.
# AUTO_MIGRATE runs pending migrations before each process listens.
x-database: &database
  DATABASE_DRIVER: postgres
  DATABASE_URL: ${DATABASE_URL:?Set DATABASE_URL in .env}

x-app: &app
  restart: unless-stopped
  extra_hosts:
    - "host.docker.internal:host-gateway"
  logging:
    driver: json-file
    options:
      max-size: "10m"
      max-file: "3"

services:
  gateway-proxy:
    <<: *app
    image: ${GATEWAY_IMAGE_PREFIX:-ghcr.io/octafuse/octafuse-gateway}-proxy:${GATEWAY_VERSION:?Set GATEWAY_VERSION}
    ports:
      - "0.0.0.0:${GATEWAY_PROXY_PORT:-18787}:8787"
    environment:
      <<: *database
      AUTO_MIGRATE: "1"
      PORT: "8787"
      STREAM_FIRST_CHUNK_TIMEOUT_MS: ${STREAM_FIRST_CHUNK_TIMEOUT_MS:-120000}
      STREAM_IDLE_TIMEOUT_MS: ${STREAM_IDLE_TIMEOUT_MS:-90000}
      USAGE_SAFETY_TIMEOUT_MS: ${USAGE_SAFETY_TIMEOUT_MS:-600000}
      STREAM_HEADERS_TIMEOUT_MS: ${STREAM_HEADERS_TIMEOUT_MS:-60000}
    healthcheck:
      test: [CMD, node, -e, "fetch('http://127.0.0.1:8787/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"]
      interval: 10s
      timeout: 5s
      retries: 6
      start_period: 20s

  gateway-admin:
    <<: *app
    image: ${GATEWAY_IMAGE_PREFIX:-ghcr.io/octafuse/octafuse-gateway}-admin:${GATEWAY_VERSION:?Set GATEWAY_VERSION}
    ports:
      - "0.0.0.0:${GATEWAY_ADMIN_PORT:-18789}:8789"
    environment:
      <<: *database
      AUTO_MIGRATE: "1"
      PORT: "8789"
      ADMIN_USERNAME: ${ADMIN_USERNAME:-admin}
      ADMIN_PASSWORD: ${ADMIN_PASSWORD:?Set ADMIN_PASSWORD in .env}
      ADMIN_COOKIE_SECURE: ${ADMIN_COOKIE_SECURE:-1}
    healthcheck:
      test: [CMD, node, -e, "fetch('http://127.0.0.1:8789/').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"]
      interval: 10s
      timeout: 5s
      retries: 6
      start_period: 40s
```

## 2. 环境变量

在服务器的 `compose.yml` 同目录创建 `.env`，填入实际值。真实密码只保存在服务器或本目录下被 Git 忽略的环境文件中。

```dotenv
GATEWAY_VERSION=v2.14.0
GATEWAY_IMAGE_PREFIX=ghcr.io/octafuse/octafuse-gateway

# 两个服务连接同一个外置 PostgreSQL。
# 用户名/密码中的特殊字符需 URL 编码；单引号避免 $ 被 Compose 插值。
DATABASE_URL='postgres://postgres:REPLACE_WITH_URL_ENCODED_DB_PASSWORD@192.168.3.5:25432/postgres?options=-c%20timezone%3DUTC'

ADMIN_USERNAME=admin
ADMIN_PASSWORD='REPLACE_WITH_A_STRONG_ADMIN_PASSWORD'

# 使用宝塔 Nginx HTTPS 访问后台时设为 1。
ADMIN_COOKIE_SECURE=1

GATEWAY_PROXY_PORT=18787
GATEWAY_ADMIN_PORT=18789
```

`192.168.3.5:25432` 是本次外置 PostgreSQL 的示例地址，按实际环境调整。数据库需要允许应用容器连接；`extra_hosts` 只是提供宿主机别名，不会自动放开数据库监听或访问权限。

迁移在 `DATABASE_URL` 指向的库里建表。请先准备好这个库；示例使用 PostgreSQL 自带的 `postgres` 库。连接串末尾写成尚不存在的库名时，迁移会失败。

## 3. 首次启动与升级

在服务器部署目录执行，或在宝塔中部署 / 更新该 Compose 项目。

```bash
docker compose --env-file .env -f compose.yml pull
docker compose --env-file .env -f compose.yml up -d
docker compose --env-file .env -f compose.yml ps
```

每个应用容器启动时都会先迁移。日志中出现 `[migrate-postgres] 全部完成。` 和 `[docker-entrypoint:app] MIGRATE_DONE` 后，进程才开始监听。两个容器同时启动时，迁移由数据库锁串行执行。没有待执行的迁移时，这一步会很快结束。迁移失败时该容器退出，并按 `unless-stopped` 重试。

升级前先备份数据库，再把 `.env` 里的 `GATEWAY_VERSION` 改成目标版本，然后执行上面的 `pull` 与 `up -d`。两个镜像必须是同一版本。仅回退镜像不会回退已经执行的数据库迁移。重建或重启容器都会再次执行这次检查。只执行 `docker restart` 不会更换镜像，因此升级后需要让 Compose 按新镜像重建容器。

## 4. 宝塔配置域名反向代理（默认方案）

1. 将 API 和后台域名解析到部署服务器；局域网使用时也可以通过内部 DNS 解析到服务器内网 IP。
2. 在宝塔为两个域名分别建立站点，申请或配置 HTTPS 证书，按需开启强制 HTTPS。
3. API 域名的反代目标填写 `http://127.0.0.1:18787`。
4. 后台域名的反代目标填写 `http://127.0.0.1:18789`。
5. 确保访问路径上的防火墙、云安全组允许 443；80 按 HTTP 跳转或证书验证需要开放。家庭或办公内网服务器若需公网访问，还需要可达的公网入口及相应路由配置。

编辑宝塔生成的反向代理 `location /`，合并下列配置；已有相同指令时修改原值，避免重复创建同路径的 location。

API 站点：

```nginx
location / {
    proxy_pass http://127.0.0.1:18787;
    proxy_http_version 1.1;
    proxy_set_header Host $host;
    proxy_set_header X-Real-IP $remote_addr;
    proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
    proxy_set_header X-Forwarded-Proto $scheme;

    # 避免 SSE 被缓冲、缓存或压缩。
    proxy_buffering off;
    proxy_cache off;
    gzip off;
    proxy_set_header Accept-Encoding "";

    proxy_read_timeout 600s;
    proxy_send_timeout 600s;
}
```

后台站点：

```nginx
location / {
    proxy_pass http://127.0.0.1:18789;
    proxy_http_version 1.1;
    proxy_set_header Host $host;
    proxy_set_header X-Real-IP $remote_addr;
    proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
    proxy_set_header X-Forwarded-Proto $scheme;
}
```

保存前通过宝塔检查 Nginx 配置并重载。通过 HTTPS 访问后台时保留 `ADMIN_COOKIE_SECURE=1`。

上述配置要求 Nginx 运行在 Docker 宿主机上。如果 Nginx 也运行在容器中，它的 `127.0.0.1` 指向自身；应将它接入应用的同一 Docker 网络，分别反代到 `http://gateway-proxy:8787` 和 `http://gateway-admin:8789`。

## 5. 可选：端口只允许本机访问

第 1 节的编排把端口发布到所有网卡。其他机器可直接访问：

- API 健康检查：`http://服务器IP:18787/health`。
- 管理后台：`http://服务器IP:18789/`。

放通所需端口并限制访问来源。使用明文 HTTP 登录后台时，将 `.env` 中 `ADMIN_COOKIE_SECURE` 改为 `0`；改回 HTTPS 后再恢复为 `1`。对外开放前，确保后台密码已替换为强密码。

如果只通过宿主机 Nginx 访问，把两个服务的 `ports` 分别改为：

```yaml
# gateway-proxy 的 ports
ports:
  - "127.0.0.1:${GATEWAY_PROXY_PORT:-18787}:8787"

# gateway-admin 的 ports
ports:
  - "127.0.0.1:${GATEWAY_ADMIN_PORT:-18789}:8789"
```

以上是两个独立服务内的替换片段，勿将它们作为同一层级的重复 `ports` 粘贴。

修改端口或环境变量后，在宝塔重新部署/重建对应容器，或在服务器部署目录执行：

```bash
docker compose --env-file .env -f compose.yml up -d --force-recreate gateway-proxy gateway-admin
```

仅重启现有容器不会更新端口映射和环境变量。重建容器时会再次执行幂等迁移。

## 6. 验证与常见问题

在部署服务器本机检查：

```bash
curl -fsS http://127.0.0.1:18787/health
curl -sS -o /dev/null -w '%{http_code}\n' http://127.0.0.1:18789/
docker compose --env-file .env -f compose.yml ps
docker compose --env-file .env -f compose.yml logs --tail=100 gateway-proxy gateway-admin
```

配置反代后，从另一台机器验证（替换域名）：

```bash
curl -fsS https://api.example.com/health
curl -sS -o /dev/null -w '%{http_code}\n' https://admin.example.com/
```

在浏览器登录后台，并使用实际 API Key 和已配置模型测试流式响应：

```bash
curl -N https://api.example.com/v1/chat/completions \
  -H "Authorization: Bearer <API_KEY>" \
  -H "Content-Type: application/json" \
  -d '{"model":"<MODEL_ID>","stream":true,"messages":[{"role":"user","content":"hi"}]}'
```

| 现象 | 排查方向 |
| --- | --- |
| 其他机器用 IP + 端口无法访问 | 确认端口发布在 `0.0.0.0`、容器已重建，并检查防火墙、安全组和路由 |
| 端口不应对其他机器开放 | 按第 5 节改为 `127.0.0.1` 并重建容器 |
| 域名返回 502 | 先验证服务器本机上游，再检查 Nginx 所在位置和反代端口 |
| 后台页面能打开，但 HTTP 登录后无法保持会话 | 明文 HTTP 应设置 `ADMIN_COOKIE_SECURE=0` 并重建后台容器 |
| API 流式输出一次性返回 | 检查反代和其他中间层的缓冲、缓存、压缩设置 |
| 容器反复重启 | 查看该容器日志。常见原因是迁移失败：库不存在、地址不通或凭据错误 |
| 更新镜像后表结构没有变化 | 确认 `.env` 中 `GATEWAY_VERSION` 已修改，并且容器已按新镜像重建。日志中应有新的 `MIGRATE_DONE` |
| 应用启动失败或数据库连接报错 | 检查两个服务的数据库地址、网络访问、凭据编码，以及 `DATABASE_URL` 中的库是否已存在 |

Compose 健康检查里的 `127.0.0.1:8787/8789` 是容器内部自检地址，保持原样；需要调整对外访问范围的是 `ports` 中的宿主机地址。

## 参考

- [本目录部署环境文件说明](./README.md)
- [仓库通用 Docker 部署文档](../../docs/operators/deployment/docker.md)
- [仓库 Compose 示例与 SSE 提示](../examples/README.md)
- [Docker 官方端口发布说明](https://docs.docker.com/engine/network/port-publishing/)
