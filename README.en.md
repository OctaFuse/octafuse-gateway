# Octafuse Gateway

[![License: AGPL v3](https://img.shields.io/badge/License-AGPL%20v3-blue.svg)](./LICENSE)

**Octafuse Gateway** is an npm-workspaces monorepo: shared **`@octafuse/core`**, a public **inference Proxy** (OpenAI / Anthropic / Gemini–compatible), and an **Admin** app (Next.js 16 + OpenNext) for operators and **`/api/admin/*`** automation.

Typical deployments: **Cloudflare** (Proxy Worker + Admin Pages + **D1**) or **self-hosted** (Proxy + Admin + **Postgres** or **MySQL**).

**中文说明：** [README.md](./README.md) · **Website:** [octafuse.dev](https://octafuse.dev/en/)

## What is OctaFuse

**OctaFuse** is an open-source **AI Gateway** that consolidates model access scattered across vendors and plans into **one Base URL and one API Key**.

It uses a **Proxy + Admin + Core** split so model access, routing, budgets, metering, and audit/observability live in one infrastructure layer—individuals consolidate coding / token plans and keys; teams issue separate keys for departments or customers with budgets and audit. More scenarios on [octafuse.dev](https://octafuse.dev/en/).

- **Proxy (`packages/proxy`)** — OpenAI / Anthropic / Gemini–compatible inference endpoints
- **Admin (`packages/admin`)** — operator UI and **`/api/admin/*`** automation APIs
- **Core (`packages/core`)** — shared storage, types, migrations, and drivers for **D1 / Postgres / MySQL**

## Why OctaFuse

Model supply keeps fragmenting—endpoints, API keys, quotas, invoices, and logs sit in different vendor consoles. Switching models or debugging means touching many places.

Many open-source and commercial gateways share the same pain points: **narrow provider coverage**; **OpenAI-only surfaces**; and **shallow billing and audit** that make per-route or per-user cost modeling awkward.

OctaFuse addresses that as a gateway you can **own and evolve**:

- Wire in more upstream vendors—including plans and local / internal models—and expose multiple client protocols from one place
- Define routing, billing lenses, and audit the way your workflow needs
- Integrate portals and apps through a stable **Admin API** with less coupling to vendor details

## Features

- **One access surface** — one Base URL and one API Key for clients; OpenAI / Anthropic / Gemini shapes route to any configured upstream
- **Keys and budgets** — users / API keys, caps and period resets, **`GET /v1/me`**
- **Routing and failover** — providers, models, routes; **route groups** and priority-based **failover**
- **Billing and reconciliation** — **`metered_cost`**, **`standard_cost`**, **`charged_cost`**
- **Audit and observability** — global and per-key request logs, user-level audit trails
- **Error alerts** — optional Feishu (Lark) and WeChat Work webhooks when Proxy forwarding fails
- **Usage analytics** — time-range views for model, provider, user usage, and reliability in Admin
- **Debug and rehearsal** — Playground (single-route tests without spending user budgets); Simulator (browser client rehearsal)
- **Flexible deployment** — Cloudflare (Worker + Pages + **D1**) or self-hosted (**Docker / Node + Postgres or MySQL**)
- **Admin API integration** — portals and apps hook in via **`/api/admin/*`** to provision users, keys, and budgets

## Product tour

These screenshots come from a local Admin instance and show the main operator workflows: observe gateway usage, connect upstream providers, route model IDs to providers, and safely test a single route before exposing it to users.

| Operations overview | Upstream providers |
|---|---|
| ![Octafuse Gateway dashboard with usage, cost, latency, and recent requests](./docs/assets/screenshots/dashboard.png) | ![Octafuse Gateway providers page with upstream endpoint cards and key status](./docs/assets/screenshots/providers.png) |

| Model routing | Playground |
|---|---|
| ![Octafuse Gateway model routes page with provider priorities and route groups](./docs/assets/screenshots/routes.png) | ![Octafuse Gateway playground page for testing one route without billing an API key](./docs/assets/screenshots/playground.png) |

## Quick Start

The steps below are for **local development only**. For production or staging deployment, see **[Deployment](#deployment)**. Start by cloning the repo and running all commands from the repository root:

```bash
git clone https://github.com/OctaFuse/octafuse-gateway.git
cd octafuse-gateway
```

You do not need to copy `.env.example` for the Docker quickstart or the Cloudflare local D1 path. Use `.env` / `.env.local` only when you run the Node + Postgres/MySQL scripts or customize a deployment.

| Path | Best for | Runtime | Database |
|------|----------|---------|----------|
| **Docker** | Fastest end-to-end demo; no local Node setup | Node containers | Postgres container |
| **Cloudflare local D1** | Worker / OpenNext development before Cloudflare deploy | Wrangler local Worker + Admin preview | Local D1 under `./.wrangler/state` |

### Option A: Docker (fastest path)

Prerequisite: Docker Compose **v2.20+** (for `service_completed_successfully`). This compose file starts Postgres, runs one-shot migrations, then starts Proxy and Admin.

```bash
docker compose -f docker/compose/quickstart.yml up --build
curl -sS http://localhost:8787/health
```

Local endpoints and defaults:

| Item | Default |
|------|---------|
| Proxy | `http://localhost:8787` |
| Admin | `http://localhost:8789` |
| Admin login | `admin` / `changeme` |
| Postgres | `postgres://postgres:postgres@localhost:5432/octafuse` |
| Admin API Bearer | `sk-dev-admin-key` from the local seed |

You can change host ports without editing YAML:

```bash
GATEWAY_PROXY_HOST_PORT=18787 \
GATEWAY_ADMIN_HOST_PORT=18789 \
POSTGRES_HOST_PORT=15432 \
docker compose -f docker/compose/quickstart.yml up --build
```

First run checklist:

1. Open Admin and sign in with `admin` / `changeme`.
2. Add or import at least one **Provider** and replace any placeholder upstream API key.
3. Create or enable a **Model Route** for the model ID your client will call.
4. Create a user **API Key**.
5. Call Proxy with that user API key.

The Postgres seed sets default `MASTER_KEY` to `sk-dev-admin-key` (Bearer for `POST /api/admin/*`). Rotate it before any shared environment — see [docs/api/admin.md](./docs/api/admin.md).

Example chat (after routing and a real user key exist):

```bash
curl -sS http://localhost:8787/v1/chat/completions \
  -H "Authorization: Bearer sk-..." \
  -H "Content-Type: application/json" \
  -d '{"model":"your-route-model","messages":[{"role":"user","content":"Hello"}]}'
```

Stop the demo with:

```bash
docker compose -f docker/compose/quickstart.yml down
```

Add `-v` if you want to delete the local Postgres volume and start from a clean database.

MySQL, split compose profiles, and prebuilt images: [docker/compose/node-pg.yml](./docker/compose/node-pg.yml), [docker/compose/node-mysql.yml](./docker/compose/node-mysql.yml), [docs/ops/deployment-docker.md](./docs/ops/deployment-docker.md).

### Option B: Cloudflare (local D1)

Prerequisites: **Node.js 20+**, npm. This path uses Wrangler locally; it does **not** require `cloudflare-worker/*.env`, a remote D1 database, or a Cloudflare login for local development. Local state persists under `./.wrangler/state`.

```bash
npm install
npm run db:migrate          # apply D1 migrations locally
npm run dev:proxy           # Proxy Worker → http://127.0.0.1:8787
```

In a second terminal:

```bash
npm run dev:admin           # Admin OpenNext preview → http://127.0.0.1:8789
```

Local Cloudflare defaults:

| Item | Default / location |
|------|--------------------|
| Proxy Worker | `http://127.0.0.1:8787` |
| Admin preview | `http://127.0.0.1:8789` |
| D1 state | `./.wrangler/state` |
| Wrangler templates | `packages/*/wrangler.base.jsonc` and `packages/core/wrangler.d1.base.jsonc` |
| Generated config | `packages/*/wrangler.jsonc` and `packages/core/wrangler.d1.jsonc` (gitignored) |
| Admin API Bearer | D1 `system_config.MASTER_KEY`; local seed is `sk-dev-admin-key` |

Then open Admin and configure **Provider** → **Model Route** → **API Key**. Admin API Bearer must match D1 `system_config.MASTER_KEY` (dev seed in `packages/core/migrations-d1/0002_seed.sql`).

When you are ready to connect the same code to a remote Cloudflare D1 instance:

1. Authenticate Wrangler with `npx wrangler login`, or set a scoped Cloudflare API token in your shell / CI.
2. Create a D1 database with `npx wrangler d1 create <name>`.
3. Put `PROXY_WORKER_NAME`, `ADMIN_WORKER_NAME`, `D1_DATABASE_NAME`, and `D1_DATABASE_ID` in Cloudflare Build variables or a gitignored `cloudflare-worker/<instance>.env`.
4. Run remote migrations before deploying code that depends on new schema:

```bash
npx dotenv -e ./cloudflare-worker/<instance>.env -- npm run db:migrate:remote
npx dotenv -e ./cloudflare-worker/<instance>.env -- npm run deploy:proxy
npx dotenv -e ./cloudflare-worker/<instance>.env -- npm run deploy:admin
```

**Note:** After a local remote deploy (`deploy-soloent.sh`, `db:migrate:remote`, etc.), run **`npm run gen:wrangler`** before `dev:proxy` / `dev:admin` so migrate and dev use the same local D1 — see [local-testing-environments.md §1](./docs/ops/local-testing-environments.md#️-本地-d1-与-database_id远程-deploy-后必读).

Optional paths (Node + Postgres/MySQL, multiple local D1 dirs, smoke tests): [docs/ops/local-testing-environments.md](./docs/ops/local-testing-environments.md).

## Deployment

Production and staging are documented separately — not covered in Quick Start above.

| Topic | Link |
|--------|------|
| Deployment index (modes, migrations, env files) | [docs/ops/deployment.md](./docs/ops/deployment.md) |
| Cloudflare（Proxy Worker + Admin + D1） | [cloudflare-worker/README.md](./cloudflare-worker/README.md) · [docs/ops/deployment-cloudflare.md](./docs/ops/deployment-cloudflare.md) |
| Docker / self-hosted (Postgres, MySQL, GHCR, compose) | [docs/ops/deployment-docker.md](./docs/ops/deployment-docker.md) |
| Runtime × database matrix | [docs/architecture/runtime-data.md](./docs/architecture/runtime-data.md) |
| Releases & versioning | [docs/ops/release-versioning.md](./docs/ops/release-versioning.md) |

## Contributing

Issues and PRs are welcome. Before you submit:

- [CONTRIBUTING.md](./CONTRIBUTING.md)
- [CODE_OF_CONDUCT.md](./CODE_OF_CONDUCT.md)
- [docs/CONVENTIONS.md](./docs/CONVENTIONS.md) — documentation boundaries and secret hygiene
- [SECURITY.md](./SECURITY.md) — vulnerabilities via **GitHub Security Advisories** only

## Documentation map

| Topic | Link |
|--------|------|
| Documentation boundary & secret-hygiene rules | [docs/CONVENTIONS.md](./docs/CONVENTIONS.md) |
| Architecture & runtime × database | [docs/README.md](./docs/README.md) → [docs/architecture/runtime-data.md](./docs/architecture/runtime-data.md) |
| API | [docs/api/README.md](./docs/api/README.md) |
| Deploy (Cloudflare / Docker / releases) | [docs/ops/deployment.md](./docs/ops/deployment.md) |
| HTTP examples | [examples/README.md](./examples/README.md) |

> Before changing any doc / example / compose template, read **[docs/CONVENTIONS.md](./docs/CONVENTIONS.md)**: it defines which docs must stay in this repo (API contracts, migrations, runtime behavior), which are candidates for the external `octafuse-website` site, and the placeholder rules that keep real secrets, webhooks, and connection strings out of Git.

## Packages

| Path | npm name | Role |
|------|----------|------|
| `packages/core` | `@octafuse/core` | D1 / Postgres / MySQL storage, types, migrations CLI (`octafuse-migrate`) |
| `packages/proxy` | `@octafuse/proxy` | Worker or Node: **`/v1/*`**, **`/v1beta/*`**, **`/health`**, **`/`** |
| `packages/admin` | `@octafuse/admin` | Admin UI + **`/api/admin/*`** (same DB as Proxy) |

## Database migrations

Baseline SQL for new installs lives under:

- `packages/core/migrations-d1/`
- `packages/core/migrations-postgres/`
- `packages/core/migrations-mysql/`

Apply them with the commands below or the Docker **migrate** image (see [docs/ops/deployment-docker.md](./docs/ops/deployment-docker.md)). One-off production fixes belong in your runbook or PRs that update the baseline when appropriate — see [docs/ops/deployment.md](./docs/ops/deployment.md).

## Versioning & releases

Single semver line for root `octafuse` and `@octafuse/*`. **Git tags `vX.Y.Z`** drive GHCR image builds and **GitHub Releases**. Human-readable notes are aggregated in **[CHANGELOG.md](./CHANGELOG.md)** (via [Changesets](https://github.com/changesets/changesets)).

- Add a changeset when your change should ship in the next release: `npx changeset`
- Maintainer flow: [docs/ops/release-versioning.md](./docs/ops/release-versioning.md) · [`.changeset/README.md`](./.changeset/README.md)

## Environment

- Copy **[`.env.example`](./.env.example)** → **`.env`** for Node/Postgres/Docker/smoke tests.
- **Cloudflare deploy** (Worker names, D1 id, routes): **`cloudflare-worker/`** — see [cloudflare-worker/README.md](./cloudflare-worker/README.md). Production uses Dashboard **Build variables** (not committed env files).
- **Cloudflare + D1**: Generated Wrangler config from `*.base.jsonc` + `npm run gen:wrangler`. Do not point Workers at `DATABASE_URL` for D1 mode. Set **`ADMIN_PASSWORD`** via Worker **Secret**; see [docs/ops/deployment-cloudflare.md](./docs/ops/deployment-cloudflare.md).

## Common commands (repo root)

```bash
npm install
cp .env.example .env   # configure DATABASE_* and ADMIN_* for Node paths

npm run db:migrate          # local D1 → ./.wrangler/state
npm run db:migrate:pg       # Postgres
npm run db:migrate:mysql    # MySQL 8

npm run dev:proxy           # Proxy Worker :8787 (D1)
npm run dev:proxy:node      # Proxy Node + SQL :8787
npm run dev:admin           # Admin OpenNext preview + D1 :8789
npm run dev:admin:node      # Admin Node + SQL :8789

npm run deploy:proxy        # needs cloudflare-worker/*.env or Build variables — see cloudflare-worker/README.md
npm run deploy:admin

npm run test:gateway:postgres-smoke   # optional integration smoke
```

## Portal integration (contract)

Downstream billing / user portals are **out of scope** for this repo. Call Admin over HTTPS only, for example:

| Variable (concept) | Purpose |
|--------------------|---------|
| `GATEWAY_URL` | Proxy root (user inference) |
| `GATEWAY_MASTER_URL` | Admin root; HTTP APIs under **`{GATEWAY_MASTER_URL}/api/admin/*`** |
| `GATEWAY_MASTER_KEY` | Bearer token, must match DB **`system_config.MASTER_KEY`** |

See **[docs/api/admin.md](./docs/api/admin.md)** and **[docs/api/user.md](./docs/api/user.md)**.

## Docker (reference)

**`Dockerfile.proxy`**, **`Dockerfile.admin`**, **`Dockerfile.migrate`**（仓库根目录）share one logical **`DATABASE_URL`**. Compose quickstarts: **`docker/compose/`**. Prebuilt image examples and Nginx snippets: **[`docker/examples/`](./docker/examples/)** (including **[`docker/examples/nginx/`](./docker/examples/nginx/)**). Server-side env layout for compose: **[`docker/deploy/README.md`](./docker/deploy/README.md)**. Full ops: **[docs/ops/deployment-docker.md](./docs/ops/deployment-docker.md)**.

## License

Licensed under the **GNU Affero General Public License v3.0 (AGPLv3)**. See [LICENSE](./LICENSE).
