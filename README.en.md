# Octafuse Gateway

[![License: AGPL v3](https://img.shields.io/badge/License-AGPL%20v3-blue.svg)](./LICENSE)
[![Release](https://img.shields.io/github/v/release/OctaFuse/octafuse-gateway?sort=semver&display_name=tag&color=2f80ed)](https://github.com/OctaFuse/octafuse-gateway/releases)
[![Package Versions](https://github.com/OctaFuse/octafuse-gateway/actions/workflows/verify-package-versions.yml/badge.svg)](https://github.com/OctaFuse/octafuse-gateway/actions/workflows/verify-package-versions.yml)
[![Node.js](https://img.shields.io/badge/Node.js-20%2B-339933?logo=node.js&logoColor=white)](./.nvmrc)
[![Cloudflare Workers](https://img.shields.io/badge/Cloudflare-Workers%20%2B%20D1-F38020?logo=cloudflare&logoColor=white)](./docs/operators/deployment/cloudflare-quickstart.md)
[![Docker](https://img.shields.io/badge/Docker-optional-2496ED?logo=docker&logoColor=white)](./docs/operators/deployment/docker.md)

**Octafuse Gateway** is a self-hostable, open-source AI gateway built for agents. It brings together models from multiple providers, image generation and editing, Agent Tools, and self-hosted or privately deployed AI services behind a single endpoint. Centralized routing, key management, budgets, usage tracking, and auditing make these resources easier to operate, orchestrate, and govern. More than a model proxy, Octafuse provides a centralized, extensible foundation for discovering, invoking, and managing AI capabilities.

**Languages:** [中文](./README.md) · [English](./README.en.md) · [日本語](./README.ja.md) · [한국어](./README.ko.md) · **Website:** [octafuse.dev](https://octafuse.dev/en/)

## Core Capabilities

- Unified AI resource endpoint: Connect to models from multiple upstream providers, self-hosted or privately deployed model services, image capabilities, and Agent Tools through one Gateway URL and user API key.
- Multi-protocol compatibility: Provides endpoints compatible with the OpenAI Chat Completions, Anthropic Messages, Gemini, and OpenAI Images APIs.
- Routing and failover: Select upstreams by route group, priority, and availability; use **sticky routing** to improve prompt cache hit rates and automatically fail over on rate limits or outages.
- Upstream key pools: Centrally manage Provider API keys with priority, weight, RPM / TPM limits, concurrency limits, and circuit-breaker state, then route requests based on each key's remaining capacity in real time.
- **Provider and model presets**: Ship a large import catalog covering official model vendors, aggregation platforms, and Coding / Token Plans, with Base URLs and model catalog details prefilled so you spend less time hunting docs and hand-editing endpoints.
- User API keys and budgets: Issue separate keys for individuals, teams, customers, or projects; configure recurring budgets, status, and metadata; and let users inspect their own quota.
- Image generation and editing: Call image models through OpenAI Images-compatible endpoints, supporting both token-based and per-image pricing.
- **Agent Tools API**: Access agent tools consistently through `/v1/tools/*`, with invocation logs and per-call billing. Built-in tools currently include web search (`web-search`), web fetch (`web-fetch`), and deep search (`web-deep-search`).
- **Public capability catalog**: Discover available models, protocols, and capabilities through `/catalog/models` without a user API key, making portal and client integration straightforward.
- **Three ledgers and time-of-day pricing**: Track provider cost, catalog list price, and user charges separately, with peak / off-peak multipliers configurable in the business timezone.
- Observability and integration testing: Inspect requests, latency, token usage, cost, and audit records in one place, and validate routing or client calls with Playground / Simulator.
- Admin control plane and API: Manage Providers, models, routes, users, and configuration through the Admin console and `/api/admin/*`, or integrate your own portal and automation.
- Flexible deployment: Deploy for free on **Cloudflare Workers + D1**, or self-host with Docker + Postgres / MySQL.

See the [feature map](./docs/users/features.md) for the complete capability set, routing semantics, and billing definitions.

## How It Differs from Other Open-Source AI Gateways

[New API](https://github.com/QuantumNous/new-api), [LiteLLM](https://github.com/BerriAI/litellm), and [Bifrost](https://github.com/maximhq/bifrost) are all strong open-source AI gateways with different strengths. Their foundational capabilities overlap, but they target different users and use cases; Octafuse places greater emphasis on built-in agent capabilities and operational control over AI resources. This table compares public editions only and is not a ranking.

| Dimension | Octafuse Gateway | New API | LiteLLM | Bifrost |
|-----------|------------------|---------|---------|---------|
| Unified capability endpoint | Models, images, Agent Tools | Models, images, audio / video, document reranking | Models, images, audio, vector embeddings, document reranking | Models, multimodal inputs, MCP |
| Routing and failover | Route groups, priorities, sticky routing, circuit breakers | Weighted routing, retry on failure | Load balancing, retries, failover | Load balancing, automatic failover |
| Keys and budgets | Upstream key pools, user keys, recurring budgets | `Tokens` (API keys), quotas, users | Virtual keys, project / user budgets | Virtual keys, hierarchical budgets |
| Provider / model presets | **Official vendors + aggregators + Coding / Token Plans; one-click Base URL and catalog pricing import** | Manual channel setup | Broadest provider coverage | Basic manual setup |
| Administration and observability | Admin console and API, logs, cost, audit | Admin console, usage, billing | Admin console, logs, usage, cost | Admin console, logs, metrics, tracing |
| Docker deployment | ✓ | ✓ | ✓ | ✓ |
| Cloudflare edge deployment | ✓ | — | — | — |
| Database support | D1/SQLite, Postgres, MySQL | SQLite, Postgres, MySQL | Postgres | SQLite, Postgres |
| Agent support | Built-in Agent Tools, including web search, web fetch, and deep search | — | MCP, A2A | MCP |
| Billing capabilities | **Three ledgers, time-of-day multipliers, per-call tool billing** | Quota- and usage-based billing | Usage tracking and budgets | Hierarchical budgets and usage governance |

“—” means the project's official public documentation does not list the capability as a comparable built-in feature. It may still be possible through plugins, external services, or custom development. All projects continue to evolve; consult their repositories and official documentation for current capabilities and licensing.

## Screenshots

| Operations overview | Model routing |
|---|---|
| ![Octafuse Gateway operations overview](./docs/assets/screenshots/dashboard.png) | ![Octafuse Gateway model routing](./docs/assets/screenshots/routes.png) |

See [docs/assets/screenshots/](./docs/assets/screenshots/) for more views, including Provider management and Playground.

## Quick Start

Requires **Node.js 20+**. Run Proxy and Admin concurrently in **two terminals**.

```bash
git clone https://github.com/OctaFuse/octafuse-gateway.git
cd octafuse-gateway
npm install
npm run db:migrate
```

Terminal 1 — Proxy (`:8787`):

```bash
npm run dev:proxy
```

Terminal 2 — Admin (`:8789`):

```bash
npm run dev:admin
```

| Service | URL | Description |
|---------|-----|-------------|
| Proxy | http://127.0.0.1:8787 | Inference endpoint |
| Admin | http://127.0.0.1:8789 | Console; local default credentials: **`admin` / `admin`** |

The first `dev:admin` run creates `packages/admin/.dev.vars`. Open Admin, configure a Provider, Route, and user API key, then call Proxy with that key. See [docs/users/quickstart.md](./docs/users/quickstart.md) for detailed steps and `curl` examples.

### Deploy to Cloudflare

```bash
npx wrangler login
npm run bootstrap:cloudflare
```

See [Cloudflare quickstart](./docs/operators/deployment/cloudflare-quickstart.md). Change the default Admin password and rotate `MASTER_KEY` before production.

For Docker self-hosting and Postgres / MySQL options, see the [deployment documentation index](./docs/operators/deployment/README.md).

## Documentation

| Task | Link |
|------|------|
| Feature map, Admin setup, client integration | [docs/users/](./docs/users/) |
| Local setup and example requests | [docs/users/quickstart.md](./docs/users/quickstart.md) |
| APIs, integration, local development, architecture | [docs/developers/](./docs/developers/) |
| Cloudflare / Docker / migrations | [docs/operators/](./docs/operators/) |
| Releases and maintenance | [docs/maintainers/](./docs/maintainers/) |
| HTTP examples | [examples/README.md](./examples/README.md) |

## Contributing and Security

- [CONTRIBUTING.md](./CONTRIBUTING.md)
- [CODE_OF_CONDUCT.md](./CODE_OF_CONDUCT.md)
- [SECURITY.md](./SECURITY.md)
- [docs/CONVENTIONS.md](./docs/CONVENTIONS.md)

## License

This repository is licensed under the **GNU Affero General Public License v3.0 (AGPLv3)**. See [LICENSE](./LICENSE).
