# Octafuse Gateway

[![License: AGPL v3](https://img.shields.io/badge/License-AGPL%20v3-blue.svg)](./LICENSE)

**Octafuse Gateway** 是一个可自托管的开源 **AI Gateway**。它把分散在不同模型供应商、账号计划和 API Key 后面的模型能力，统一成 **一个 Base URL、一个 API Key**，并提供路由、预算、计费、日志与审计能力。

**English:** [README.en.md](./README.en.md) · **官网：** [octafuse.dev/zh](https://octafuse.dev/zh/)

## 它能做什么

- **把多个模型入口合成一个入口**：客户端只需要配置一个 Gateway Base URL 和一个 Key，即可通过 OpenAI / Anthropic / Gemini 风格接口访问背后的多个上游 Provider。
- **把模型选择从业务代码里移出来**：在 Admin 里维护 Provider、Model 和 Route；同一个模型 ID 可以按 route group、优先级、权重或可用性路由到不同上游，便于切换、灰度和故障转移。
- **按用户、客户或团队发放独立 Key**：为不同使用方创建 API Key，设置预算、启停状态和周期重置；客户端可通过 `GET /v1/me` 查询自己的额度与身份信息。
- **沉淀统一的计费口径**：同时记录 `metered_cost`、`standard_cost`、`charged_cost`，便于区分上游实际成本、标准价格和最终扣费金额，支持后续对账或接入自有 billing。
- **集中观测请求与成本**：在管理台查看请求日志、错误、延迟、Token、模型用量、Provider 用量、用户用量和可靠性指标，排查问题时不需要来回切多个供应商控制台。
- **提供运维与自动化接口**：Admin UI 适合人工配置，`/api/admin/*` 适合门户、后台或脚本自动创建用户、发 Key、同步预算和读取配置。
- **支持上线前联调**：Playground 可针对单条路由试调用上游，不计入用户 Key 账单；Simulator 可在浏览器里模拟客户端调用流程。

## 适用场景

- **个人用户汇总自己的 AI / Coding 资源**：把不同平台上的 Coding plan、模型账号、本地模型或备用 Provider 接到 Octafuse，再用自己的统一 Gateway URL 和 API Key 接入各种 Coding 工具、IDE 插件、命令行工具或其它 AI 应用。后续新增、替换或临时切换上游时，不需要逐个修改客户端配置。
- **独立开发者或小团队统一管理 Token 成本**：把多个项目、成员或客户的调用统一经过 Gateway，为每个使用方发独立 Key，按预算和日志区分使用情况。这样既能复用团队持有的模型资源，也能看清谁在用、用了多少、成本落在哪里。
- **企业或平台接入自有业务系统**：通过 User 和 API Key 管理，把 Gateway 接到内部后台、SaaS 门户或客户系统中，自动开通用户、分配预算、同步额度、审计请求，并用统一的成本口径支持计费、对账、风控和资源分配。
- **多供应商容灾与灰度**：为同一个模型入口配置多个上游 Provider，在某个供应商不可用、额度不足、价格变化或需要测试新模型时，通过路由策略切换，而不是推动所有客户端改配置。

## 界面预览

| 运营概览 | Provider 管理 |
|---|---|
| ![Octafuse Gateway 管理台仪表盘，展示用量、成本、延迟和最近请求](./docs/assets/screenshots/dashboard.png) | ![Octafuse Gateway Provider 页面，展示上游端点卡片和 Key 状态](./docs/assets/screenshots/providers.png) |

| 模型路由 | Playground |
|---|---|
| ![Octafuse Gateway 模型路由页面，展示 Provider 优先级和 route group](./docs/assets/screenshots/routes.png) | ![Octafuse Gateway Playground 页面，用于不计入用户 Key 账单的单路由测试](./docs/assets/screenshots/playground.png) |

## 快速开始

先 clone 仓库：

```bash
git clone https://github.com/OctaFuse/octafuse-gateway.git
cd octafuse-gateway
```

本地体验推荐 Docker；开发 Cloudflare Worker / D1 路径时再使用 npm + Wrangler。

### 方式 A：Docker

前置要求：Docker Compose **v2.20+**。

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

打开 Admin 后，按这个顺序完成配置：

1. 添加或导入 **Provider**，填入真实上游 API Key。
2. 创建或启用 **Model Route**。
3. 创建用户 **API Key**。
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

> Docker quickstart 不需要复制 `.env.example`。如需 MySQL、外置数据库、预构建镜像或 Nginx 流式反代，见 [Docker 部署文档](./docs/ops/deployment-docker.md)。

### 方式 B：Cloudflare 本地 D1

前置要求：Node.js **20+**、npm。此路径使用本地 Wrangler 和本地 D1，不需要先登录 Cloudflare。

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
| Admin 预览 | `http://127.0.0.1:8789` |
| D1 本地状态 | `./.wrangler/state` |
| Admin API Bearer | `sk-dev-admin-key` |

远程 Cloudflare 部署前，需要先创建 D1、设置 Worker Build variables，并在部署依赖新表结构的代码前运行远程迁移。完整流程见 [Cloudflare 部署文档](./docs/ops/deployment-cloudflare.md)。

## 文档入口

| 主题 | 链接 |
|------|------|
| 部署总览 | [docs/ops/deployment.md](./docs/ops/deployment.md) |
| Cloudflare 部署 | [docs/ops/deployment-cloudflare.md](./docs/ops/deployment-cloudflare.md) |
| Docker / 自托管 | [docs/ops/deployment-docker.md](./docs/ops/deployment-docker.md) |
| 本地测试环境 | [docs/ops/local-testing-environments.md](./docs/ops/local-testing-environments.md) |
| API 文档 | [docs/api/README.md](./docs/api/README.md) |
| 架构与运行时矩阵 | [docs/architecture/runtime-data.md](./docs/architecture/runtime-data.md) |
| HTTP 示例 | [examples/README.md](./examples/README.md) |

## 常用命令

```bash
npm install
npm run db:migrate          # 本地 D1
npm run dev:proxy           # Proxy Worker :8787
npm run dev:admin           # Admin preview :8789

npm run db:migrate:pg       # Postgres
npm run db:migrate:mysql    # MySQL 8
npm run dev:proxy:node      # Node + SQL Proxy
npm run dev:admin:node      # Node + SQL Admin
```

## 贡献与安全

- [CONTRIBUTING.md](./CONTRIBUTING.md)
- [CODE_OF_CONDUCT.md](./CODE_OF_CONDUCT.md)
- [SECURITY.md](./SECURITY.md)
- [docs/CONVENTIONS.md](./docs/CONVENTIONS.md)

## 开源协议

本仓库使用 **GNU Affero General Public License v3.0（AGPLv3）** 授权，详见 [LICENSE](./LICENSE)。
