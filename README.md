# Octafuse Gateway

[![License: AGPL v3](https://img.shields.io/badge/License-AGPL%20v3-blue.svg)](./LICENSE)
[![Release](https://img.shields.io/github/v/release/OctaFuse/octafuse-gateway?sort=semver&display_name=tag&color=2f80ed)](https://github.com/OctaFuse/octafuse-gateway/releases)
[![Package Versions](https://github.com/OctaFuse/octafuse-gateway/actions/workflows/verify-package-versions.yml/badge.svg)](https://github.com/OctaFuse/octafuse-gateway/actions/workflows/verify-package-versions.yml)
[![Node.js](https://img.shields.io/badge/Node.js-20%2B-339933?logo=node.js&logoColor=white)](./.nvmrc)
[![Cloudflare Workers](https://img.shields.io/badge/Cloudflare-Workers%20%2B%20D1-F38020?logo=cloudflare&logoColor=white)](./docs/operators/deployment/cloudflare-quickstart.md)
[![Docker](https://img.shields.io/badge/Docker-optional-2496ED?logo=docker&logoColor=white)](./docs/operators/deployment/docker.md)

**Octafuse Gateway** 是面向 Agent 的可自托管开源 AI 网关。它将不同供应商的文本、图像、语音与工具能力汇聚到统一入口，支持 Chat Completions、OpenAI Responses API、图像生成与编辑、ASR、TTS、实时语音和智能体工具（Agent Tools），也可以接入自建或私有部署的 AI 服务。通过统一的路由、密钥、预算、计费和审计，Octafuse 帮助个人与团队集中管理和调度分散的 AI 资源。它不只是转发模型请求，更是面向 Agent 的可发现、可调用、可治理、可持续扩展的 AI 能力底座。

**语言：** [中文](./README.md) · [English](./README.en.md) · [日本語](./README.ja.md) · [한국어](./README.ko.md) · **官网：** [octafuse.dev](https://octafuse.dev/)

## 核心能力

Octafuse Gateway 的核心目标是**构建统一超级个体（OPC）或企业内部的 AI 能力中枢**。通过 Octafuse 将你所持有的各种模态的 AI 能力和多种多样的工具能力实现统一接入、分发、计费等企业级管理控制。

所以它具备以下这些核心能力：

1. 供应商（Provider）接入：支持接入任意模型厂商或聚合平台的模型服务。同时，内置大量导入模板（含各种 Coding/Token Plan），无需复制黏贴各平台的接入端点，直接一键导入，然后复制对应的 API 密钥（ApiKey）即可完成接入。支持一键导入的完整列表见官网 [Providers Catalog](https://octafuse.dev/zh/catalog/providers/)，若有希望加入预置供应商的厂商，欢迎提交 PR。
2. AI 模型接入：可直接从预置目录导入模型，无需逐项填写常用参数和价格。支持一键导入的模型列表见官网 [Models Catalog](https://octafuse.dev/zh/catalog/models/)；若希望接入新的模型，欢迎提交 PR。
3. 多协议接入：AI 模型全协议接入，目前支持:
    - OpenAI 端点：
      - Chat Completions：`POST /v1/chat/completions`
      - Responses：`POST /v1/responses`
      - Images：`POST /v1/images/generations`、`POST /v1/images/edits`
      - Audio：`POST /v1/audio/transcriptions`、`POST /v1/audio/speech`
      - Models：`GET /v1/models`
    - Anthropic 端点：`POST /v1/messages`
    - Google Gemini 端点：`POST /v1beta/models/{model}:generateContent`（含 `streamGenerateContent`）
    - DashScope 同步多模态 ASR：`POST /v1/dashscope/services/aigc/multimodal-generation/generation`
    - DashScope 实时音频：`GET /v1/dashscope/realtime`
4. 协议适配与转换：可在路由中选择客户端与上游的协议转换关系，让应用继续使用熟悉的调用方式接入不同供应商。例如，可直接用 OpenAI 图片接口调用阿里云百炼的千问 / 万相图像模型。
5. 智能体工具接入：通过 `/v1/tools/*` 统一接入各种供 Agent 使用的工具，并提供日志、计费、成本管控，以方便 Agent 同时从 Gateway 接入模型和工具。当前预置工具如下：
    - 联网搜索（`POST /v1/tools/web-search`）：博查、Tavily、阿里云 CleverSee、腾讯云联网搜索 WSA
    - 网页抓取（`POST /v1/tools/web-fetch`）：Firecrawl、Tavily Extract、Jina Reader
    - 深度搜索（`POST /v1/tools/web-deep-search`，搜+读一体）：Firecrawl Search、Jina Search
    - AI 率检测（`POST /v1/tools/ai-detection`）：当前已实现腾讯云 TMS，并预留多引擎扩展目录
    - 更多工具持续接入中，也欢迎 PR 继续丰富智能体常用工具。
6. AI 能力统一出口：所有接入的模型、平台和工具都通过 Octafuse Gateway 的 Base URL 对外提供服务。客户端只需配置一个网关地址，不必分别记住每个平台和工具的访问地址。
7. 多样的路由策略：当一个模型我们有多个资源的时候，为了更高效的使用资源，可以根据情况配置不同的路由策略。目前支持四种策略：
    - hash_affinity：默认策略；同用户、模型、协议稳定首选上游，**缓存命中率高**，适合依赖 Prompt Cache、会话连续性的场景；短时流量不一定完全均匀
    - weighted_random：按权重加权随机分流，**负载均衡性高**，适合按比例分摊成本或 A/B；同一用户可能频繁切换供应商，缓存命中率较低
    - weight_priority：按权重从高到低固定排序，结果可预测，适合同层明确主备；首选供应商会承担大部分流量
    - weighted_round_robin：按权重轮转分摊，流量更均匀；计数器按运行实例维护，多实例间不保证全局同步
8. 用户管理与记账一体化：统一接入后，可继续在 Gateway 中完成用户、额度和成本管理，包括：
    - 外部系统（External system）、用户（User）、API 密钥三层结构：通过 External system 区分不同系统或团队，再通过用户下的 API 密钥完成调用鉴权、扣费和审计
    - 双额度体系：周期额度适合订阅套餐，永久额度适合加油包或人工加额，两种额度可以同时使用
    - 三账本设计：每一个调用对于计费涵盖三个费用计算，包括：目录价（模型/工具标准价）、成本价（实际采购价格）、用户价（用户扣除额度）
    - 峰谷计价：支持按模型和路由设置峰谷价格、区分工作日与周末，并预览不同时间段的实际价格
    - 用户级模型倍率：可为单个用户按目录模型设置折扣、加价或免单；只改变最终用户计费与预算累加，不影响目录价和供应成本
9. 管理后台（Admin）与管理 API：
    - 具备完善的管理后台和管理接口，可以手工维护也可以接入其他系统门户使用
    - 可观测性与数据分析：详细记录了请求细节和各类数据，可以方便查看、统计、分析
    - 测试与联调：提供调试台（Playground）/ 模拟器（Simulator），可快速检查供应商、模型、路由和客户端配置，也支持调试实时语音识别
10. 灵活的部署方式：
    - 支持 **Cloudflare Workers + D1 免费部署**
    - 支持 Docker + Postgres / MySQL 部署

## 管理后台一览

| 供应商接入 | 请求入口（Request Surface）→ 策略 → 上游目标（Upstream Target） 路由拓扑 |
|---|---|
| ![供应商：卡片网格展示密钥状态、协议能力与路由数](./docs/assets/screenshots/providers.webp) | ![路由：按请求入口、路由组与上游分层展示策略、粘滞与故障转移](./docs/assets/screenshots/routes.webp) |

供应商页面负责接入上游账号与协议端点；路由页面把客户端请求入口、路由策略和上游目标放在一条可视链路中。完整配置顺序见 [管理后台配置指南](./docs/users/configuration.md)。

## 与其他开源 AI Gateway 的差异

[New API](https://github.com/QuantumNous/new-api)、[LiteLLM](https://github.com/BerriAI/litellm)、[Sub2API](https://github.com/Wei-Shaw/sub2api) 和 [Bifrost](https://github.com/maximhq/bifrost) 都是成熟且各有所长的开源 AI Gateway。Octafuse 更关注 **Agent 能力交付与 AI 资源运营**，主要差异集中在以下五个方向：

| 重点方向 | Octafuse 内建机制 | 适合场景 |
|---|---|---|
| Agent 能力 | 联网搜索、网页抓取、深度搜索，以及工具调用日志与计费 | 为 Agent 同时提供模型与工具 |
| 资源接入 | 供应商 / 模型预设、多协议端点和一键导入 | 统一管理分散的 AI 资源 |
| 精细路由 | 独立路由池、分层策略、缓存亲和、主备与熔断 | 在稳定性、缓存命中率和成本间平衡 |
| 运营计费 | 目录价、供应成本、用户扣费三账本，支持分时与多模态计价 | 内部核算、额度管理或对外运营 |
| 灵活部署 | Docker + 多数据库，或 Cloudflare Workers + D1 | 自托管、边缘部署与低成本起步 |

**评级说明：**

- **✅ 完善**：公开版本已形成覆盖该维度主要场景的完整机制
- **🟡 良好**：具备成熟的核心能力，但覆盖范围或运营深度相对有限
- **🟠 基础**：具备可用的基础实现，仍需较多外部组件或二次开发
- **⚪ 无**：官方公开文档未将其列为同类内建能力

<details>
<summary><strong>展开完整能力对比（24 项）</strong></summary>

### 能力接入与 Agent

| 细分能力 | Octafuse | New API | LiteLLM | Sub2API | Bifrost |
|---|:---:|:---:|:---:|:---:|:---:|
| 供应商 / 模型预设与一键导入 | ✅ | 🟡 | 🟡 | 🟡 | 🟡 |
| OpenAI、Anthropic、Gemini 主流协议接入 | ✅ | ✅ | ✅ | ✅ | ✅ |
| DashScope 原生同步 / 实时音频与跨协议路由 | ✅¹ | ⚪ | ⚪ | ⚪ | ⚪ |
| 文本、图像、语音与视频等多模态覆盖 | 🟡² | ✅ | ✅ | 🟡 | ✅ |
| 内置联网搜索、抓取与深度搜索 | ✅ | ⚪ | 🟠 | 🟠 | 🟠 |
| 工具供应商配置、调用日志与计费 | ✅ | ⚪ | 🟡 | 🟠 | 🟠 |

### 路由与治理

| 细分能力 | Octafuse | New API | LiteLLM | Sub2API | Bifrost |
|---|:---:|:---:|:---:|:---:|:---:|
| 协议 / operation 级请求入口与独立路由池 | ✅ | 🟠 | 🟡 | 🟡 | 🟡 |
| 多策略分流与分层覆盖 | ✅ | 🟡 | ✅ | 🟡 | 🟡 |
| Prompt Cache 亲和路由 | ✅ | 🟡 | ✅ | ✅ | ✅ |
| 优先级主备、故障转移与供应商熔断 | ✅ | 🟡 | ✅ | 🟡 | ✅ |
| 外部系统、用户与 API 密钥分层治理 | ✅ | 🟡 | ✅ | 🟡 | ✅ |
| 周期预算、状态与模型访问控制 | ✅ | ✅ | ✅ | ✅ | ✅ |

### 计费

| 细分能力 | Octafuse | New API | LiteLLM | Sub2API | Bifrost |
|---|:---:|:---:|:---:|:---:|:---:|
| 目录价、供应成本、用户扣费三账本 | ✅ | ⚪ | ⚪ | ✅ | ⚪ |
| 按业务时区的分时计价倍率 | ✅ | ⚪ | ⚪ | 🟡 | ⚪ |
| 图像 / 语音差异化计价 | ✅ | 🟡 | 🟡 | 🟡 | 🟠 |
| 智能体工具按次计费 | ✅ | ⚪ | 🟡 | 🟠 | 🟠 |

### 运维与部署

| 细分能力 | Octafuse | New API | LiteLLM | Sub2API | Bifrost |
|---|:---:|:---:|:---:|:---:|:---:|
| 管理后台 | ✅ | ✅ | ✅ | ✅ | ✅ |
| 管理 API | ✅ | ✅ | ✅ | ✅ | ✅ |
| 可观测性 | ✅ | ✅ | ✅ | ✅ | ✅ |
| SQLite / D1 | ✅ | ✅ | ⚪ | ⚪ | ✅ |
| PostgreSQL | ✅ | ✅ | ✅ | ✅ | ✅ |
| MySQL | ✅ | ✅ | ⚪ | ⚪ | ⚪ |
| Docker 自托管部署 | ✅ | ✅ | ✅ | ✅ | ✅ |
| Cloudflare Workers 边缘部署 | ✅ | ⚪ | ⚪ | ⚪ | ⚪ |

<sup>1</sup> Octafuse 支持 DashScope 原生同步 ASR、实时 ASR / TTS，并可将 OpenAI 兼容的 ASR / TTS 请求跨协议路由至 DashScope。
<br />
<sup>2</sup> Octafuse 当前已覆盖文本、图像、ASR、TTS 与实时语音；视频等能力尚未纳入统一请求入口。

</details>

评价基于各项目当前公开仓库与官方文档，重点衡量“是否内建并形成完整机制”，不评价性能、社区规模、商业支持或二次开发潜力。这是围绕 Octafuse 产品定位的能力比较，不是对各项目全部功能的综合排名。各项目持续演进，具体能力和授权范围请以其最新官方文档为准。


## 快速开始

需要 **Node.js 20+**。代理服务（Proxy）与管理后台需**两个终端**同时运行。

```bash
git clone https://github.com/OctaFuse/octafuse-gateway.git
cd octafuse-gateway
npm install
npm run db:migrate
```

终端 1 — 代理服务（`:8787`）：

```bash
npm run dev:proxy
```

终端 2 — 管理后台（`:8789`）：

```bash
npm run dev:admin
```

| 服务 | 地址 | 说明 |
|------|------|------|
| 代理服务 | http://127.0.0.1:8787 | 推理入口 |
| 管理后台 | http://127.0.0.1:8789 | 控制台；本地默认账号 **`admin` / `admin`** |

首次运行 `dev:admin` 会生成 `packages/admin/.dev.vars`。打开管理后台，配置供应商、路由和用户 API 密钥，然后使用该密钥调用代理服务。详细步骤与 `curl` 示例见 [docs/users/quickstart.md](./docs/users/quickstart.md)。

### 部署到 Cloudflare

```bash
npx wrangler login
npm run bootstrap:cloudflare
```

详见 [Cloudflare 快速部署](./docs/operators/deployment/cloudflare-quickstart.md)。用于生产环境前，请修改默认管理后台密码，并为外部集成创建独立、最小权限的 Admin API Key。

Docker 自托管及 Postgres / MySQL 数据库方案见 [部署文档索引](./docs/operators/deployment/README.md)。

## 文档

| 任务 | 链接 |
|------|------|
| 功能地图、管理后台配置、客户端接入 | [docs/users/](./docs/users/) |
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
