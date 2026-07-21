# Octafuse Gateway

[![License: AGPL v3](https://img.shields.io/badge/License-AGPL%20v3-blue.svg)](./LICENSE)
[![Release](https://img.shields.io/github/v/release/OctaFuse/octafuse-gateway?sort=semver&display_name=tag&color=2f80ed)](https://github.com/OctaFuse/octafuse-gateway/releases)
[![Package Versions](https://github.com/OctaFuse/octafuse-gateway/actions/workflows/verify-package-versions.yml/badge.svg)](https://github.com/OctaFuse/octafuse-gateway/actions/workflows/verify-package-versions.yml)
[![Node.js](https://img.shields.io/badge/Node.js-20%2B-339933?logo=node.js&logoColor=white)](./.nvmrc)
[![Cloudflare Workers](https://img.shields.io/badge/Cloudflare-Workers%20%2B%20D1-F38020?logo=cloudflare&logoColor=white)](./docs/operators/deployment/cloudflare-quickstart.md)
[![Docker](https://img.shields.io/badge/Docker-optional-2496ED?logo=docker&logoColor=white)](./docs/operators/deployment/docker.md)

**Octafuse Gateway** 是面向 Agent 的可自托管开源 AI 网关。它汇聚多供应商模型、图像生成与编辑、Agent Tools，以及自建或私有部署的 AI 服务，将分散的 AI 资源组织为统一入口，并通过路由、密钥、预算、用量和审计，实现资源的集中管理、调度与控制。它不只是中转模型请求，而是为 Agent 集中提供可发现、可调用、可管理且可持续扩展的资源与能力支持。

**语言：** [中文](./README.md) · [English](./README.en.md) · [日本語](./README.ja.md) · [한국어](./README.ko.md) · **官网：** [octafuse.dev/zh](https://octafuse.dev/zh/)

## 核心能力

- 统一 AI 资源入口：用一个 Gateway 地址和用户 API Key 接入多上游模型、自建或私有部署的模型服务、图像能力与 Agent Tools。
- 多协议兼容：提供兼容 OpenAI Chat Completions、Anthropic Messages、Gemini 和 OpenAI Images API 的接入点。
- 路由与故障转移：按路由组、优先级和可用性选择上游；通过**粘性路由**提高提示词缓存命中率，并在遇到限流或故障时自动切换。
- 上游密钥池：集中管理多把 Provider API Key 的优先级、权重、RPM / TPM 限额、并发和熔断状态，并根据实时剩余容量进行调度。
- 用户 API Key 与预算：为个人、团队、客户或项目签发独立 Key，设置周期预算、状态和元数据，并允许用户查询自身额度。
- 图像生成与编辑：通过兼容 OpenAI Images API 的接口调用图像模型，支持按 Token 用量分项计价与按张计价。
- **Agent Tools 能力接口**：通过 `/v1/tools/*` 统一接入 Agent 工具，并提供调用日志与按次计费；当前支持联网搜索（`web-search`）、网页抓取（`web-fetch`）和深度搜索（`web-deep-search`）。
- **公开能力目录**：无需用户 API Key 即可通过 `/catalog/models` 发现当前可用模型、协议与能力，方便门户和客户端发现并接入。
- **三账本与分时计价**：分别记录供应成本、模型目录价和用户计费，并可按业务时区设置高峰 / 闲时倍率。
- 可观测性与联调：集中查看请求、延迟、Token 用量、成本和审计记录，并用 Playground / Simulator 验证路由和客户端调用。
- 管理控制面与 API：通过 Admin 管理界面和 `/api/admin/*` 管理 Provider、模型、路由、用户与配置，或接入自有门户和自动化系统。
- 灵活部署方式：支持 **Cloudflare Workers + D1 免费部署**，也可通过 Docker + Postgres / MySQL 自托管。

完整能力、路由语义与计费口径见 [功能地图](./docs/users/features.md)。

## 与其他开源 AI Gateway 的差异

[New API](https://github.com/QuantumNous/new-api)、[LiteLLM](https://github.com/BerriAI/litellm) 和 [Bifrost](https://github.com/maximhq/bifrost) 都是优秀且各有所长的开源 AI Gateway。它们的基础能力相近，但面向的用户和场景不同；Octafuse 更强调 Agent 能力交付和资源运营。下表仅比较公开版本，不代表优劣。

| 维度 | Octafuse Gateway | New API | LiteLLM | Bifrost |
|------|------------------|---------|---------|---------|
| 统一能力入口 | 模型、图像、Agent Tools | 模型、图像、音视频、文档重排 | 模型、图像、音频、向量嵌入、文档重排 | 模型、多模态、MCP |
| 路由与故障转移 | 路由组、优先级、粘性路由、熔断 | 加权路由、失败重试 | 负载均衡、重试、故障转移 | 负载均衡、自动故障转移 |
| 密钥与预算 | 上游密钥池、用户密钥、周期预算 | 令牌、额度、用户 | 虚拟密钥、项目 / 用户预算 | 虚拟密钥、分层预算 |
| 管理与可观测性 | 管理界面与 API、日志、成本、审计 | 管理界面、用量、计费 | 管理后台、日志、用量与成本 | 管理界面、日志、指标、链路追踪 |
| Docker 部署 | ✓ | ✓ | ✓ | ✓ |
| Cloudflare 边缘部署 | ✓ | — | — | — |
| 数据库支持 | D1/SQLite、Postgres、MySQL | SQLite、Postgres、MySQL | Postgres | SQLite、Postgres |
| Agent 支持 | 内置常用工具，如：联网搜索、网页抓取、深度搜索等 | — | MCP、A2A | MCP |
| 计费能力 | **三账本、分时倍率、工具按次计费** | 额度与用量计费 | 用量追踪与预算 | 分层预算与用量治理 |

“—”表示对应项目的官方公开文档未将其列为同类内建能力，不代表无法通过插件、外部服务或二次开发实现。各项目都在持续演进，具体能力和授权范围请以各自仓库与官方文档为准。

## 界面预览

| 运营概览 | 模型路由 |
|---|---|
| ![Octafuse Gateway 运营概览](./docs/assets/screenshots/dashboard.png) | ![Octafuse Gateway 模型路由](./docs/assets/screenshots/routes.png) |

更多界面见 [docs/assets/screenshots/](./docs/assets/screenshots/)（Provider 管理、Playground 等）。

## 快速开始

需要 **Node.js 20+**。Proxy 与 Admin 需**两个终端**同时运行。

```bash
git clone https://github.com/OctaFuse/octafuse-gateway.git
cd octafuse-gateway
npm install
npm run db:migrate
```

终端 1 — Proxy（`:8787`）：

```bash
npm run dev:proxy
```

终端 2 — Admin（`:8789`）：

```bash
npm run dev:admin
```

| 服务 | 地址 | 说明 |
|------|------|------|
| Proxy | http://127.0.0.1:8787 | 推理入口 |
| Admin | http://127.0.0.1:8789 | 控制台；本地默认账号 **`admin` / `admin`** |

首次运行 `dev:admin` 会生成 `packages/admin/.dev.vars`。打开 Admin，配置 Provider、Route 和用户 API Key，然后使用该 Key 调用 Proxy。详细步骤与 `curl` 示例见 [docs/users/quickstart.md](./docs/users/quickstart.md)。

### 部署到 Cloudflare

```bash
npx wrangler login
npm run bootstrap:cloudflare
```

详见 [Cloudflare 快速部署](./docs/operators/deployment/cloudflare-quickstart.md)。用于生产环境前，请修改默认 Admin 密码，并轮换 `MASTER_KEY`。

Docker 自托管及 Postgres / MySQL 数据库方案见 [部署文档索引](./docs/operators/deployment/README.md)。

## 文档

| 任务 | 链接 |
|------|------|
| 功能地图、Admin 配置、客户端接入 | [docs/users/](./docs/users/) |
| 本地上手与示例请求 | [docs/users/quickstart.md](./docs/users/quickstart.md) |
| API、集成、本地开发、架构 | [docs/developers/](./docs/developers/) |
| Cloudflare / Docker / 迁移 | [docs/operators/](./docs/operators/) |
| 发版与维护 | [docs/maintainers/](./docs/maintainers/) |
| HTTP 示例 | [examples/README.md](./examples/README.md) |

## 贡献与安全

- [CONTRIBUTING.md](./CONTRIBUTING.md)
- [CODE_OF_CONDUCT.md](./CODE_OF_CONDUCT.md)
- [SECURITY.md](./SECURITY.md)
- [docs/CONVENTIONS.md](./docs/CONVENTIONS.md)

## 开源协议

本仓库使用 **GNU Affero General Public License v3.0（AGPLv3）** 授权，详见 [LICENSE](./LICENSE)。
