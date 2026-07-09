# Octafuse Gateway

[![License: AGPL v3](https://img.shields.io/badge/License-AGPL%20v3-blue.svg)](./LICENSE)

**Octafuse Gateway** is a self-hostable open-source **AI Gateway**. It consolidates model access across vendors, plans, and API keys into **one Base URL and one API Key**, with routing, budgets, billing, logs, and audit built in.

**中文：** [README.md](./README.md) · **Website:** [octafuse.dev](https://octafuse.dev/en/)

## What It Does

- **Turn many model endpoints into one endpoint**: Clients configure one Gateway Base URL and one key, then call multiple upstream providers through OpenAI / Anthropic / Gemini-compatible APIs.
- **Move model selection out of application code**: Manage Providers, Models, and Routes in Admin. One model ID can route to different upstreams by route group, priority, weight, or availability, making switching, rollout, and failover easier.
- **Issue separate keys for users, customers, or teams**: Create API keys per consumer, set budgets, enable/disable access, configure reset periods, and let clients inspect identity and quota with `GET /v1/me`.
- **Keep billing semantics explicit**: Record `metered_cost`, `standard_cost`, and `charged_cost` so upstream cost, reference price, and final charged amount can be reconciled or connected to your own billing system.
- **Centralize observability**: Inspect request logs, errors, latency, tokens, model usage, provider usage, user usage, and reliability without jumping between vendor consoles.
- **Support both manual ops and automation**: Use Admin UI for operator workflows and `/api/admin/*` for portals, internal dashboards, or scripts that provision users, issue keys, sync budgets, and read configuration.
- **Test before exposing routes to users**: Playground tests one upstream route without billing a user key; Simulator rehearses browser-side client calls.

## Use Cases

- **Personal AI / coding resource hub**: Connect coding plans, model accounts, local models, and backup providers from different platforms to Octafuse, then use one Gateway URL and one API key across coding tools, IDE plugins, CLIs, and other AI apps. Adding, replacing, or temporarily switching upstreams no longer requires changing every client.
- **Independent developers and small teams managing token cost**: Route calls from multiple projects, teammates, or customers through one gateway. Issue separate keys per consumer, apply budgets, and inspect usage logs so you can reuse shared model resources while still seeing who used what and where the cost landed.
- **Businesses and platforms integrating with their own systems**: Use User and API Key management to connect the gateway to an internal admin system, SaaS portal, or customer platform. Provision users, allocate budgets, sync quota, audit requests, and support billing, reconciliation, risk control, and resource allocation with a unified cost model.
- **Multi-provider fallback and rollout**: Configure multiple upstream providers behind the same model entry. When a provider is unavailable, quota is exhausted, pricing changes, or a new model needs testing, switch through routing policy instead of updating every client.

## Repository Layout

| Package | Role |
|---------|------|
| `packages/proxy` | Public inference entry: `/v1/*`, `/v1beta/*`, `/health` |
| `packages/admin` | Admin UI and `/api/admin/*` |
| `packages/core` | Data model, migrations, and D1 / Postgres / MySQL storage |

Common deployment modes:

- **Cloudflare**: Proxy Worker + Admin/OpenNext + D1
- **Docker / Node**: Proxy + Admin + Postgres or MySQL

## Screenshots

| Operations overview | Provider management |
|---|---|
| ![Octafuse Gateway dashboard with usage, cost, latency, and recent requests](./docs/assets/screenshots/dashboard.png) | ![Octafuse Gateway providers page with upstream endpoint cards and key status](./docs/assets/screenshots/providers.png) |

| Model routing | Playground |
|---|---|
| ![Octafuse Gateway model routes page with provider priorities and route groups](./docs/assets/screenshots/routes.png) | ![Octafuse Gateway playground page for testing one route without billing an API key](./docs/assets/screenshots/playground.png) |

## Quick Start

Clone the repository first:

```bash
git clone https://github.com/OctaFuse/octafuse-gateway.git
cd octafuse-gateway
```

Use Docker for the fastest local demo. Use npm + Wrangler when developing the Cloudflare Worker / D1 path.

### Option A: Docker

Requirement: Docker Compose **v2.20+**.

```bash
docker compose -f docker/compose/quickstart.yml up --build
curl -sS http://localhost:8787/health
```

Defaults:

| Service | URL / default |
|---------|---------------|
| Proxy | `http://localhost:8787` |
| Admin | `http://localhost:8789` |
| Admin login | `admin` / `changeme` |
| Admin API Bearer | `sk-dev-admin-key` |

In Admin:

1. Add or import a **Provider** and set a real upstream API key.
2. Create or enable a **Model Route**.
3. Create a user **API Key**.
4. Call Proxy with that user key.

Example request:

```bash
curl -sS http://localhost:8787/v1/chat/completions \
  -H "Authorization: Bearer sk-your-api-key" \
  -H "Content-Type: application/json" \
  -d '{"model":"your-route-model","messages":[{"role":"user","content":"Hello"}]}'
```

Stop the demo:

```bash
docker compose -f docker/compose/quickstart.yml down
```

> Docker quickstart does not require copying `.env.example`. For MySQL, external databases, prebuilt images, or Nginx SSE proxying, see [Docker deployment](./docs/ops/deployment-docker.md).

### Option B: Cloudflare Local D1

Requirements: Node.js **20+**, npm. This path uses local Wrangler and local D1; Cloudflare login is not required for local development.

```bash
npm install
npm run db:migrate
npm run dev:proxy
```

In a second terminal:

```bash
npm run dev:admin
```

Defaults:

| Service | URL / location |
|---------|----------------|
| Proxy Worker | `http://127.0.0.1:8787` |
| Admin preview | `http://127.0.0.1:8789` |
| Local D1 state | `./.wrangler/state` |
| Admin API Bearer | `sk-dev-admin-key` |

Before remote Cloudflare deployment, create D1, configure Worker Build variables, and run remote migrations before deploying code that depends on new schema. See [Cloudflare deployment](./docs/ops/deployment-cloudflare.md).

## Documentation

| Topic | Link |
|-------|------|
| Deployment index | [docs/ops/deployment.md](./docs/ops/deployment.md) |
| Cloudflare deployment | [docs/ops/deployment-cloudflare.md](./docs/ops/deployment-cloudflare.md) |
| Docker / self-hosted | [docs/ops/deployment-docker.md](./docs/ops/deployment-docker.md) |
| Local test environments | [docs/ops/local-testing-environments.md](./docs/ops/local-testing-environments.md) |
| API docs | [docs/api/README.md](./docs/api/README.md) |
| Architecture and runtime matrix | [docs/architecture/runtime-data.md](./docs/architecture/runtime-data.md) |
| HTTP examples | [examples/README.md](./examples/README.md) |

## Common Commands

```bash
npm install
npm run db:migrate          # local D1
npm run dev:proxy           # Proxy Worker :8787
npm run dev:admin           # Admin preview :8789

npm run db:migrate:pg       # Postgres
npm run db:migrate:mysql    # MySQL 8
npm run dev:proxy:node      # Node + SQL Proxy
npm run dev:admin:node      # Node + SQL Admin
```

## Contributing and Security

- [CONTRIBUTING.md](./CONTRIBUTING.md)
- [CODE_OF_CONDUCT.md](./CODE_OF_CONDUCT.md)
- [SECURITY.md](./SECURITY.md)
- [docs/CONVENTIONS.md](./docs/CONVENTIONS.md)

## License

Licensed under the **GNU Affero General Public License v3.0 (AGPLv3)**. See [LICENSE](./LICENSE).
