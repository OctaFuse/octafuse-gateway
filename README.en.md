# Octafuse Gateway

[![License: AGPL v3](https://img.shields.io/badge/License-AGPL%20v3-blue.svg)](./LICENSE)
[![Release](https://img.shields.io/github/v/release/OctaFuse/octafuse-gateway?sort=semver&display_name=tag&color=2f80ed)](https://github.com/OctaFuse/octafuse-gateway/releases)
[![Package Versions](https://github.com/OctaFuse/octafuse-gateway/actions/workflows/verify-package-versions.yml/badge.svg)](https://github.com/OctaFuse/octafuse-gateway/actions/workflows/verify-package-versions.yml)
[![Node.js](https://img.shields.io/badge/Node.js-20%2B-339933?logo=node.js&logoColor=white)](./.nvmrc)
[![Cloudflare Workers](https://img.shields.io/badge/Cloudflare-Workers%20%2B%20D1-F38020?logo=cloudflare&logoColor=white)](./docs/operators/deployment/cloudflare-quickstart.md)
[![Docker](https://img.shields.io/badge/Docker-optional-2496ED?logo=docker&logoColor=white)](./docs/operators/deployment/docker.md)

**Octafuse Gateway** is a self-hostable open-source **AI Gateway**: consolidate vendors, accounts, and API keys into **one Base URL and one API Key**, with routing, budgets, billing, and audit.

The default runtime is **Cloudflare Workers + D1** — individuals and light traffic can usually deploy and run within the free tier. Docker / Postgres / MySQL self-hosting is also supported (see [deployment docs](./docs/operators/deployment/)).

**中文：** [README.md](./README.md) · **Website:** [octafuse.dev](https://octafuse.dev/en/)

## Why Octafuse

- **Free-tier Cloudflare deploy** — One CLI deploys Proxy + Admin + shared D1; no server to babysit, edge-native by default.
- **One endpoint** — Clients use one Gateway URL and one key across OpenAI / Anthropic / Gemini-style APIs to many upstreams.
- **Operable, not just a proxy** — Admin manages Providers, Routes, user keys, and budgets; `/api/admin/*` fits portals and scripts; requests and cost stay observable and reconcilable.

## What It Does

- **Many model endpoints → one entry**: Route one model ID by priority, weight, or availability for switching, rollout, and failover.
- **Per-user / customer / team keys**: Budgets and reset periods; clients can inspect quota via `GET /v1/me`.
- **Explicit billing semantics**: Each request records three amounts—**supplier cost** (your estimated upstream spend), **catalog list price** (model baseline), and **charged to user** (what hits their budget)—for reconciliation or your own billing.
- **Time-of-day pricing**: Per-route daily schedule multipliers for supplier cost and user charge (business timezone peak / off-peak), matching vendor time-based price strategies.
- **Centralized observability**: Logs, latency, tokens, and usage by model / provider / user — without hopping vendor consoles.
- **Safe pre-prod checks**: Playground tests one route without billing a user key; Simulator rehearses client calls.

## Use Cases

- **Personal hub**: Wire coding plans, model accounts, and backups into one key for IDEs, CLIs, and other AI apps.
- **Small teams**: Share upstream capacity across projects and people with separate keys and budgets.
- **Platforms / enterprises**: Provision users, sync quota, and audit via Admin API for billing and risk control; align route pricing with vendor time-of-day rates.
- **Multi-provider resilience**: Change routing when an upstream fails or runs out of quota — not every client config.

## Screenshots

| Operations overview | Provider management |
|---|---|
| ![Octafuse Gateway dashboard with usage, cost, latency, and recent requests](./docs/assets/screenshots/dashboard.png) | ![Octafuse Gateway providers page with upstream endpoint cards and key status](./docs/assets/screenshots/providers.png) |

| Model routing | Playground |
|---|---|
| ![Octafuse Gateway model routes page with provider priorities and route groups](./docs/assets/screenshots/routes.png) | ![Octafuse Gateway playground page for testing one route without billing an API key](./docs/assets/screenshots/playground.png) |

## Quick start

Run locally with D1 first:

```bash
git clone https://github.com/OctaFuse/octafuse-gateway.git
cd octafuse-gateway
npm install
npm run db:migrate
npm run dev:proxy    # :8787
npm run dev:admin    # :8789 (second terminal)
```

| Service | URL | Notes |
|---------|-----|--------|
| Proxy | http://127.0.0.1:8787 | Inference |
| Admin | http://127.0.0.1:8789 | Console; local default **`admin` / `admin`** |

The first `dev:admin` creates `packages/admin/.dev.vars`. Open Admin → add Provider / Route / user Key → call Proxy with that key. Full steps and curl examples: [docs/users/quickstart.md](./docs/users/quickstart.md).


If you want to deploy directly to Cloudflare:

```bash
npx wrangler login
npm run bootstrap:cloudflare
```

See [Cloudflare quickstart](./docs/operators/deployment/cloudflare-quickstart.md). Change the default Admin password and rotate `MASTER_KEY` before production.

### Other deployment options

- [Cloudflare ops / Workers Builds / multi-instance](./docs/operators/deployment/cloudflare.md)
- [Docker (Postgres / MySQL)](./docs/operators/deployment/docker.md)
- [Zeabur and similar platforms](./docs/operators/deployment/zeabur.md)
- [Deployment docs index](./docs/operators/deployment/)

## Documentation

| Reader / task | Link |
|---------------|------|
| Users: quickstart, features, Admin setup, clients | [docs/users/](./docs/users/) |
| Developers: API, integration, local dev, architecture | [docs/developers/](./docs/developers/) |
| Operators: Cloudflare, Docker, Zeabur, migrations | [docs/operators/](./docs/operators/) |
| Maintainers: releases, Changesets, docs rules | [docs/maintainers/](./docs/maintainers/) |
| HTTP examples | [examples/README.md](./examples/README.md) |

## Common Commands

```bash
npm install
npm run db:migrate            # local D1
npm run dev:proxy             # Proxy :8787
npm run dev:admin             # Admin :8789

npm run bootstrap:cloudflare  # first Cloudflare deploy
npm run deploy:cloudflare -- <instance> --migrate  # redeploy existing instance

npm run db:migrate:pg         # Postgres (self-host)
npm run db:migrate:mysql      # MySQL 8 (self-host)
```

## Contributing and Security

- [CONTRIBUTING.md](./CONTRIBUTING.md)
- [CODE_OF_CONDUCT.md](./CODE_OF_CONDUCT.md)
- [SECURITY.md](./SECURITY.md)
- [docs/CONVENTIONS.md](./docs/CONVENTIONS.md)

## License

Licensed under the **GNU Affero General Public License v3.0 (AGPLv3)**. See [LICENSE](./LICENSE).
