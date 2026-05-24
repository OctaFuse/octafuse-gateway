# Octafuse Gateway

[![License: AGPL v3](https://img.shields.io/badge/License-AGPL%20v3-blue.svg)](./LICENSE)

**Octafuse Gateway** is an npm-workspaces monorepo: shared **`@octafuse/core`**, a public **inference Proxy** (OpenAI / Anthropic / Gemini–compatible), and an **Admin** app (Next.js 16 + OpenNext) for operators and **`/api/admin/*`** automation.

Typical deployments: **Cloudflare** (Proxy Worker + Admin Pages + **D1**) or **self-hosted** (Proxy + Admin + **Postgres** or **MySQL**).

**中文说明：** [README.zh-CN.md](./README.zh-CN.md)

## What is OctaFuse

**OctaFuse** is an AI gateway aimed at teams and organizations that need a single place to serve model traffic across multiple products. It uses a **Proxy + Admin + Core** split so model access, routing, budgets, metering, and audit/observability live in one infrastructure layer instead of being reimplemented in every service.

- **Proxy (`packages/proxy`)** — OpenAI / Anthropic / Gemini–compatible inference endpoints
- **Admin (`packages/admin`)** — operator UI and **`/api/admin/*`** automation APIs
- **Core (`packages/core`)** — shared storage, types, migrations, and drivers for **D1 / Postgres / MySQL**

## Why OctaFuse

OctaFuse was built to own and evolve an in-house AI gateway for several internal SaaS systems.

Many open-source and commercial gateways share a few pain points: **provider** choice is narrow, so mixing public cloud, private hosting, and internal models is awkward; several products **only expose an OpenAI-shaped surface**, which forces extra adapters if your stack already speaks Anthropic or Gemini; and **billing plus audit trails** are often rigid or shallow—hard to model per-route, per-user, or supply-side vs user-side costs the way internal products need.

OctaFuse aims to address that with more freedom:

- Wire in more providers, including models you run yourself, and expose multiple client-facing protocols from one gateway
- Define routing, billing, and how you trace and reconcile usage across teams and routes
- Integrate upstream systems through a stable Admin API with less coupling

## Features

What the codebase and docs ship today:

- **Multi-protocol surface** — `/v1/chat/completions` (OpenAI), `/v1/messages` (Anthropic), `/v1beta/*` (Gemini)
- **Keys and budgets** — users / API keys, caps and period resets, **`GET /v1/me`**
- **Routing** — providers, models, routes; **route groups** and priority-based **failover**
- **Cost layers** — **`metered_cost`**, **`standard_cost`**, **`charged_cost`** for supply vs catalog vs user charge
- **Audit and observability** — global and per-key request logs, plus user-level audit trails for traceability and investigations
- **Proxy error alerts** — optional **Feishu (Lark)** and **WeChat Work** bot webhooks (configured in Admin) so operators get notified when the Proxy surfaces forwarding failures—useful for catching upstream provider incidents, quota or rate-limit pressure, and signs that an upstream API key may need attention or top-up
- **Analytics** — in Admin, time-range views for model usage, provider usage, user usage, and reliability summaries—helpful for capacity checks, cost awareness, and comparing upstream health
- **Playground** — in Admin, send a test call for one model route to check upstream connectivity and configuration quickly; it does not spend user budgets or leave the same metering / logs as real traffic—useful for troubleshooting and pre-flight checks
- **Simulator** — in Admin, call your deployed gateway from the browser with a real user API key in OpenAI / Anthropic / Gemini shapes, so you can rehearse and validate auth, routing, billing, and logging the way production clients do
- **Runtimes** — Cloudflare (Worker + Pages + **D1**) or self-hosted (**Docker / Node + Postgres or MySQL**)
- **Decoupled from apps** — SaaS and portals integrate via **`/api/admin/*`** so product code stays focused on AI use cases

## Quick Start

The steps below are for **local development only**. For production or staging deployment, see **[Deployment](#deployment)**.

### Option A: Docker (fastest path)

Prerequisites: Docker Compose **v2.20+** (for `service_completed_successfully`).

```bash
docker compose -f docker/compose/quickstart.yml up --build
curl -sS http://localhost:8787/health
```

When healthy:

- Proxy: `http://localhost:8787`
- Admin: `http://localhost:8789` (default login `admin` / `changeme`)

In Admin: configure a **provider** → a **model route** → create an **API key**, then call the inference APIs. The Postgres seed sets default `MASTER_KEY` to `sk-dev-admin-key` (Bearer for `POST /api/admin/*`); rotate before any shared environment — see [docs/api/admin.md](./docs/api/admin.md).

Example chat (after routing and a real user key exist):

```bash
curl -sS http://localhost:8787/v1/chat/completions \
  -H "Authorization: Bearer sk-..." \
  -H "Content-Type: application/json" \
  -d '{"model":"your-route-model","messages":[{"role":"user","content":"Hello"}]}'
```

MySQL, split compose profiles, and prebuilt images: [docker/compose/node-pg.yml](./docker/compose/node-pg.yml), [docker/compose/node-mysql.yml](./docker/compose/node-mysql.yml), [docs/ops/deployment-docker.md](./docs/ops/deployment-docker.md).

### Option B: Cloudflare (local D1)

Prerequisites: **Node.js 20+**, npm. Local state persists under `./.wrangler/state`.

```bash
npm install
npm run db:migrate          # apply D1 migrations locally
npm run dev:proxy           # Proxy Worker → http://127.0.0.1:8787
```

In a second terminal:

```bash
npm run dev:admin           # Admin OpenNext preview → http://127.0.0.1:8789
```

Then configure **provider** → **model route** → **API key** in Admin. Admin API Bearer must match D1 `system_config.MASTER_KEY` (dev seed in `packages/core/migrations-d1/0002_seed.sql`).

Optional paths (Node + Postgres/MySQL, multiple local D1 dirs, smoke tests): [docs/ops/local-testing-environments.md](./docs/ops/local-testing-environments.md).

## Deployment

Production and staging are documented separately — not covered in Quick Start above.

| Topic | Link |
|--------|------|
| Deployment index (modes, migrations, env files) | [docs/ops/deployment.md](./docs/ops/deployment.md) |
| Cloudflare (Proxy Worker + Admin + D1, Connect to Git) | [docs/ops/deployment-cloudflare.md](./docs/ops/deployment-cloudflare.md) |
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

- Copy **[`.env.example`](./.env.example)** → **`.env`** and uncomment what you need.
- Optional **`.env.local`** for machine-specific overrides (patterns at the top of **`.env.example`**).
- **Node + Postgres or MySQL**: **`DATABASE_URL`**, optional **`DATABASE_DRIVER`** (`postgres` default; use `mysql` with `mysql://`). Admin needs **`ADMIN_USERNAME`** / **`ADMIN_PASSWORD`**.
- **Cloudflare + D1**: Wrangler bindings in `packages/proxy` / `packages/admin` — do not point Workers at `DATABASE_URL` for D1 mode. Set **`ADMIN_PASSWORD`** via Worker **Secret** or `wrangler secret put`; see [docs/ops/deployment-cloudflare.md](./docs/ops/deployment-cloudflare.md) §0.

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

npm run deploy:proxy        # production: see docs/ops/deployment-cloudflare.md
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
