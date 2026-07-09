# 快速开始

目标：启动 Proxy 和 Admin，完成一次健康检查，并知道下一步去哪里配置。

## 方式 A：Docker 快速体验

适合大多数使用者。前置要求：Docker Compose v2.20+。

```bash
docker compose -f docker/compose/quickstart.yml up --build
curl -sS http://localhost:8787/health
```

默认地址：

| 服务 | 地址 / 默认值 |
|------|---------------|
| Proxy | `http://localhost:8787` |
| Admin | `http://localhost:8789` |
| Admin 登录 | `admin` / `changeme` |
| Admin API Bearer | `sk-dev-admin-key` |

打开 Admin 后按这个顺序配置：

1. 添加或导入 Provider，并填入真实上游 API Key。
2. 创建或启用 Model Route。
3. 创建用户 API Key。
4. 用用户 Key 调用 Proxy。

示例请求：

```bash
curl -sS http://localhost:8787/v1/chat/completions \
  -H "Authorization: Bearer sk-your-api-key" \
  -H "Content-Type: application/json" \
  -d '{"model":"your-route-model","messages":[{"role":"user","content":"Hello"}]}'
```

停止服务：

```bash
docker compose -f docker/compose/quickstart.yml down
```

更完整的 Docker / 自托管 / MySQL / 外置数据库说明见 [operators/deployment/docker.md](../operators/deployment/docker.md)。

## 方式 B：Cloudflare 本地 D1

适合想沿 Cloudflare Worker + D1 路径开发或部署的人。前置要求：Node.js 20+、npm。

```bash
npm install
npm run db:migrate
npm run dev:proxy
```

另开一个终端：

```bash
npm run dev:admin
```

默认地址：

| 服务 | 地址 / 位置 |
|------|-------------|
| Proxy Worker | `http://127.0.0.1:8787` |
| Admin preview | `http://127.0.0.1:8789` |
| D1 本地状态 | `./.wrangler/state` |
| Admin API Bearer | `sk-dev-admin-key` |

远程 Cloudflare 部署前，需要创建 D1、配置 Worker Build variables，并先运行远程迁移。完整流程见 [operators/deployment/cloudflare.md](../operators/deployment/cloudflare.md)。

## 生产前必须改的默认值

- 修改 Admin 登录密码。
- 将 `system_config.MASTER_KEY` 从开发种子 `sk-dev-admin-key` 轮换为强随机值。
- 为 Provider API Key、数据库连接串、Admin 密码和 Cloudflare 凭证使用部署平台的 secret / env 管理能力。

敏感信息规则见 [CONVENTIONS.md](../CONVENTIONS.md)。
