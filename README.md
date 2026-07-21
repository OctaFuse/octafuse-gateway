# Octafuse Gateway

[![License: AGPL v3](https://img.shields.io/badge/License-AGPL%20v3-blue.svg)](./LICENSE)
[![Release](https://img.shields.io/github/v/release/OctaFuse/octafuse-gateway?sort=semver&display_name=tag&color=2f80ed)](https://github.com/OctaFuse/octafuse-gateway/releases)
[![Package Versions](https://github.com/OctaFuse/octafuse-gateway/actions/workflows/verify-package-versions.yml/badge.svg)](https://github.com/OctaFuse/octafuse-gateway/actions/workflows/verify-package-versions.yml)
[![Node.js](https://img.shields.io/badge/Node.js-20%2B-339933?logo=node.js&logoColor=white)](./.nvmrc)
[![Cloudflare Workers](https://img.shields.io/badge/Cloudflare-Workers%20%2B%20D1-F38020?logo=cloudflare&logoColor=white)](./docs/operators/deployment/cloudflare-quickstart.md)
[![Docker](https://img.shields.io/badge/Docker-optional-2496ED?logo=docker&logoColor=white)](./docs/operators/deployment/docker.md)

> **统一 AI 能力，掌控每一次调用。**

**Octafuse Gateway** 是可自托管的开源 **AI 能力网关与运营控制面**：统一接入 Chat、图片生成 / 编辑、可扩展 Agent Tools、私有模型服务与多上游 Provider，集中管理路由、密钥、预算、计费和审计。客户端仍然只需一个 Gateway URL 和一把用户 Key。

默认跑在 **Cloudflare Workers + D1** 上——个人与小流量通常可在免费额度内完成部署与日常使用；也支持 Docker / Postgres / MySQL 自托管（见[部署文档](./docs/operators/deployment/)）。

**English:** [README.en.md](./README.en.md) · **官网：** [octafuse.dev/zh](https://octafuse.dev/zh/)

## 为什么选 Octafuse

- **Cloudflare 可免费上云** — 一条 CLI 部署 Proxy + Admin + 共享 D1；无需自备服务器，边缘全球可用。
- **统一 AI 能力入口** — 客户端只配一个 Gateway URL 和一个 Key，即可调用 Chat、图片生成和 Agent Tools，并通过 OpenAI / Anthropic / Gemini 风格接口访问多上游。
- **可运营，不只是转发** — Admin 管理 Provider、Route、用户 Key 与预算；`/api/admin/*` 可对接门户或脚本；请求与成本可观测、可对账。

## 它能做什么

- **多模型入口合成一个入口**：同一模型 ID 可按 **route priority**、可用性与 Provider Key 池调度到不同上游，便于切换、灰度和故障转移；可按模型开启 **粘性（sticky）** 提升 prompt cache 命中（Key 池内另有 priority / headroom / **weight**，见下文边界）。
- **图片生成 / 编辑（Images）**：OpenAI 兼容 `POST /v1/images/generations` 与 `POST /v1/images/edits`；支持 token 分项与按张（`per_image`）两种目录计价。
- **Agent Tools**：面向 Agent 的可扩展产品 API 面（`/v1/tools/*`，非推理协议）。当前已提供联网类工具（`web-search` / `web-fetch` / `web-deep-search`），后续可继续接入更多工具；Admin → Tools 配置引擎 Key，**每种工具仅一个 Active 引擎**，**按次计费、失败不扣费**。
- **公开 Catalog**：`GET /catalog/models` 无需用户 Key，供门户发现运行时模型与协议能力；Agent / SDK 默认仍用需鉴权的 `GET /v1/models`。
- **按用户 / 客户 / 团队发独立 Key**：设预算与周期重置；客户端可用 `GET /v1/me` 查额度。
- **明确的计费口径**：每次请求同时记三笔账——**供应成本**（你付给上游的估算）、**目录标准价**（模型标价基准）、**用户计费**（扣用户预算的金额），便于对账或接入自有 billing。
- **按时段动态调价**：路由可按每日窗口给供应成本 / 用户计费分别设倍率（业务时区下的高峰 / 闲时），适配各家模型按时段定价。
- **集中观测**：请求日志、延迟、Token、模型 / Provider / 用户用量，不必在多个供应商控制台间切换。
- **上线前联调**：Playground 试调单路由（不计用户账单）；Simulator 模拟客户端调用（含 Images）。

### 路由边界（route priority ≠ key weight；含粘性）

| 层 | 字段 | 作用 |
|----|------|------|
| **Route** | `priority`（同 `route_group` 内数字越小越先试） | 决定先试哪条上游 route；**没有** route-level weight。 |
| **Provider Key 池** | key `priority` / headroom / `weight` | 命中某条 route 后，在该 Provider 的多把上游 Key 间调度；`weight` 仅在余量接近时加权随机。 |
| **粘性（sticky）** | 模型 `sticky_config`（按协议 × route group opt-in） | 同一用户尽量连续命中同一把上游 Key，提升上游 **prompt cache** 命中率；限流短等待、上游故障仍会 failover。 |

Tools 依赖你自备的第三方引擎 API Key；每种已接入工具**同时只有一个 Active 引擎**。行为与字段真源见 [docs/developers/api/user.md](./docs/developers/api/user.md) 与 [docs/developers/reference/image-models.md](./docs/developers/reference/image-models.md)。

## 适用场景

- **个人**：汇总各平台 Coding plan、模型账号与备用 Provider，用一把 Key 接入 IDE / CLI / 其它 AI 应用。
- **小团队**：多项目、多成员共用上游资源，用独立 Key + 预算分清用量与成本。
- **平台 / 企业**：通过 Admin API 开通用户、同步额度、审计请求，支撑计费与风控；路由层可按时段对齐上游价格策略。
- **多供应商容灾**：上游不可用或额度不足时改路由策略，而不是改遍所有客户端。

## 界面预览

| 运营概览 | Provider 管理 |
|---|---|
| ![Octafuse Gateway 管理台仪表盘，展示用量、成本、延迟和最近请求](./docs/assets/screenshots/dashboard.png) | ![Octafuse Gateway Provider 页面，展示上游端点卡片和 Key 状态](./docs/assets/screenshots/providers.png) |

| 模型路由 | Playground |
|---|---|
| ![Octafuse Gateway 模型路由页面，展示 Provider 优先级和 route group](./docs/assets/screenshots/routes.png) | ![Octafuse Gateway Playground 页面，用于不计入用户 Key 账单的单路由测试](./docs/assets/screenshots/playground.png) |

## 快速开始

本机先用本地 D1 跑起来：

```bash
git clone https://github.com/OctaFuse/octafuse-gateway.git
cd octafuse-gateway
npm install
npm run db:migrate
npm run dev:proxy    # :8787
npm run dev:admin    # :8789（另开终端）
```

| 服务 | 地址 | 说明 |
|------|------|------|
| Proxy | http://127.0.0.1:8787 | 推理入口 |
| Admin | http://127.0.0.1:8789 | 控制台；本地默认账号 **`admin` / `admin`** |

首次 `dev:admin` 会生成 `packages/admin/.dev.vars`。打开 Admin → 配 Provider / Route / 用户 Key → 再用用户 Key 调 Proxy。更完整的步骤与 curl 示例见 [docs/users/quickstart.md](./docs/users/quickstart.md)。


如果你想直接部署到 Cloudflare 云上：

```bash
npx wrangler login
npm run bootstrap:cloudflare
```

详见 [Cloudflare 快速部署](./docs/operators/deployment/cloudflare-quickstart.md)。上生产前请改掉默认 Admin 密码，并轮换 `MASTER_KEY`。

### 其他部署方式

- [Cloudflare 运维 / Workers Builds / 多实例](./docs/operators/deployment/cloudflare.md)
- [Docker（Postgres / MySQL）](./docs/operators/deployment/docker.md)
- [Zeabur 等容器平台](./docs/operators/deployment/zeabur.md)
- [部署文档索引](./docs/operators/deployment/)

## 文档入口

| 读者 / 任务 | 链接 |
|-------------|------|
| 使用者：快速开始、功能、Admin 配置、客户端接入 | [docs/users/](./docs/users/) |
| 开发者：API、集成、本地开发、架构 | [docs/developers/](./docs/developers/) |
| 部署 / 运维：Cloudflare、Docker、Zeabur、迁移 | [docs/operators/](./docs/operators/) |
| 维护者：发版、Changesets、文档规范 | [docs/maintainers/](./docs/maintainers/) |
| HTTP 示例 | [examples/README.md](./examples/README.md) |

## 常用命令

```bash
npm install
npm run db:migrate            # 本地 D1
npm run dev:proxy             # Proxy :8787
npm run dev:admin             # Admin :8789

npm run bootstrap:cloudflare  # 首次部署到 Cloudflare
npm run deploy:cloudflare -- <instance> --migrate  # 已有实例发版

npm run db:migrate:pg         # Postgres（自托管）
npm run db:migrate:mysql      # MySQL 8（自托管）
```

## 贡献与安全

- [CONTRIBUTING.md](./CONTRIBUTING.md)
- [CODE_OF_CONDUCT.md](./CODE_OF_CONDUCT.md)
- [SECURITY.md](./SECURITY.md)
- [docs/CONVENTIONS.md](./docs/CONVENTIONS.md)

## 开源协议

本仓库使用 **GNU Affero General Public License v3.0（AGPLv3）** 授权，详见 [LICENSE](./LICENSE)。
