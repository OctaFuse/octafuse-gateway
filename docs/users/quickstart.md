# 快速开始

目标：用 **Cloudflare 路径**（本地 D1 → 上云）跑起 Proxy 与 Admin，完成一次健康检查，并知道下一步去哪里配置。

个人与小流量通常可在 Cloudflare Workers / D1 **免费额度**内完成部署与日常使用。不用 Cloudflare 时，见 [operators/deployment/](../operators/deployment/)（含 [Docker](../operators/deployment/docker.md)）。

```bash
git clone https://github.com/OctaFuse/octafuse-gateway.git
cd octafuse-gateway
```

## 1. 本机启动（本地 D1）

前置：Node.js 20+、npm。无需 `wrangler login`。

```bash
npm install
npm run db:migrate
npm run dev:proxy
```

另开一个终端：

```bash
npm run dev:admin
```

| 服务 | 地址 / 位置 |
|------|-------------|
| Proxy Worker | `http://127.0.0.1:8787` |
| Admin preview | `http://127.0.0.1:8789` |
| 控制台登录 | `admin` / `admin`（本地默认；首次 `dev:admin` 会自动生成 `packages/admin/.dev.vars`） |
| D1 本地状态 | `./.wrangler/state` |
| Admin API Bearer | `sk-dev-admin-key`（管理 API，不是网页密码） |

## 2. 部署到 Cloudflare

把 Proxy + Admin + 共享 D1 部署到你自己的 Cloudflare 账号。前置：Cloudflare 账号、`npx wrangler login`。

```bash
npm install
npx wrangler login
npm run bootstrap:cloudflare
```

完成后按终端提示核对 `GATEWAY_URL` / `GATEWAY_MASTER_URL`，并用 `GET $GATEWAY_URL/health` 做健康检查。

完整说明：[operators/deployment/cloudflare-quickstart.md](../operators/deployment/cloudflare-quickstart.md)。运维与 Workers Builds：[operators/deployment/cloudflare.md](../operators/deployment/cloudflare.md)。

## 3. 打开 Admin 后配置

1. 添加或导入 Provider，并填入真实上游 API Key。
2. 创建或启用 Model Route。
3. 创建用户 API Key。
4. 用用户 Key 调用 Proxy。

示例请求（本地把主机换成 `127.0.0.1:8787`；已上云则换成你的 Proxy URL）：

```bash
curl -sS http://127.0.0.1:8787/v1/chat/completions \
  -H "Authorization: Bearer sk-your-api-key" \
  -H "Content-Type: application/json" \
  -d '{"model":"your-route-model","messages":[{"role":"user","content":"Hello"}]}'
```

配置细节见 [configuration.md](./configuration.md)；客户端接入见 [connect-clients.md](./connect-clients.md)。

## 生产前必须改的默认值

- 修改 Admin 登录密码（本地默认 `admin` / `admin` **仅本机**；上云用 bootstrap / Worker Secret 设强密码）。
- 将 `system_config.MASTER_KEY` 从开发种子 `sk-dev-admin-key` 轮换为强随机值。
- 为 Provider API Key、数据库连接串、Admin 密码和 Cloudflare 凭证使用部署平台的 secret / env 管理能力。

敏感信息规则见 [CONVENTIONS.md](../CONVENTIONS.md)。

## 其它部署路径

| 场景 | 文档 |
|------|------|
| Docker / Postgres / MySQL 自托管 | [operators/deployment/docker.md](../operators/deployment/docker.md) |
| Zeabur 等容器平台 | [operators/deployment/zeabur.md](../operators/deployment/zeabur.md) |
| 部署模式总览 | [operators/deployment/README.md](../operators/deployment/) |
