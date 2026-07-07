# Octafuse Gateway

[![License: AGPL v3](https://img.shields.io/badge/License-AGPL%20v3-blue.svg)](./LICENSE)

**Octafuse Gateway** is an npm-workspaces monorepo: shared **`@octafuse/core`**, a public **inference Proxy** (OpenAI / Anthropic / Gemini–compatible), and an **Admin** app (Next.js 16 + OpenNext) for operators and **`/api/admin/*`** automation.

Typical deployments: **Cloudflare** (Proxy Worker + Admin Pages + **D1**) or **self-hosted** (Proxy + Admin + **Postgres** or **MySQL**).

**中文说明：** [README.zh-CN.md](./README.zh-CN.md) · **Website:** [octafuse.dev](https://octafuse.dev/en/)

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
