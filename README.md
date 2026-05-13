# Octafuse Gateway

[![License: AGPL v3](https://img.shields.io/badge/License-AGPL%20v3-blue.svg)](./LICENSE)

**Octafuse Gateway** is an npm-workspaces monorepo: shared **`@octafuse/core`**, a public **inference Proxy** (OpenAI / Anthropic / Gemini–compatible), and an **Admin** app (Next.js 16 + OpenNext) for operators and **`/api/admin/*`** automation.

Typical deployments: **Cloudflare** (Proxy Worker + Admin Pages + **D1**) or **self-hosted** (Proxy + Admin + **Postgres** or **MySQL**).

Licensed under the **GNU Affero General Public License v3.0 (AGPLv3)**. See [LICENSE](./LICENSE).

**中文说明：** [README.zh-CN.md](./README.zh-CN.md)

## Documentation map

| Topic | Link |
|--------|------|
| Documentation boundary & secret-hygiene rules | [docs/CONVENTIONS.md](./docs/CONVENTIONS.md) |
| Architecture & runtime × database | [docs/README.md](./docs/README.md) → [docs/architecture/runtime-data.md](./docs/architecture/runtime-data.md) |
| API | [docs/api/README.md](./docs/api/README.md) |
| Deploy (Cloudflare / Docker / releases) | [docs/ops/deployment.md](./docs/ops/deployment.md) |
| HTTP examples | [examples/README.md](./examples/README.md) |

> Before changing any doc / example / compose template, read **[docs/CONVENTIONS.md](./docs/CONVENTIONS.md)**: it defines which docs must stay in this repo (API contracts, migrations, runtime behavior), which are candidates for an external `octafuse-docs` site later, and the placeholder rules that keep real secrets, webhooks, and connection strings out of Git.

## ~60 second quickstart (Docker + Postgres)

Prerequisites: Docker Compose **v2.20+** (for `service_completed_successfully`).

```bash
docker compose -f docker/compose/quickstart.yml up --build
```

When services are healthy:

```bash
curl -sS http://localhost:8787/health
```

Open **Admin** at `http://localhost:8789` (default login: `admin` / `changeme`). Configure at least one upstream **provider** and **model route**, then create an API key (UI or Admin API). The Postgres seed sets default `MASTER_KEY` to `sk-dev-admin-key` (Bearer for `POST /api/admin/*`); rotate in production — see [docs/api/admin.md](./docs/api/admin.md).

Example chat (after routing and a real user key exist):

```bash
curl -sS http://localhost:8787/v1/chat/completions \
  -H "Authorization: Bearer sk-..." \
  -H "Content-Type: application/json" \
  -d '{"model":"your-route-model","messages":[{"role":"user","content":"Hello"}]}'
```

MySQL, D1-only dev, and split compose profiles: [docker/compose/node-pg.yml](./docker/compose/node-pg.yml), [docker/compose/node-mysql.yml](./docker/compose/node-mysql.yml), [docs/ops/deployment-docker.md](./docs/ops/deployment-docker.md).

## One-click Cloudflare (Connect to Git)

Connect this repo from the Cloudflare dashboard to two **Workers** (Proxy + Admin): set **Root directory** to `packages/proxy` and `packages/admin`, bind the shared **D1** as **`DB`**, and set **`ADMIN_PASSWORD`** as a Worker **Secret** (not in Git). Details: [docs/ops/deployment-cloudflare.md](./docs/ops/deployment-cloudflare.md) (section **0**).

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

npm run deploy:proxy        # deploy Proxy Worker
npm run deploy:admin        # deploy Admin Pages

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

## Contributing & security

- **[CONTRIBUTING.md](./CONTRIBUTING.md)** — contribution licensing (AGPL + maintainer relicensing clause).
- **[CODE_OF_CONDUCT.md](./CODE_OF_CONDUCT.md)** — Contributor Covenant 2.1.
- **[SECURITY.md](./SECURITY.md)** — report vulnerabilities via **GitHub Security Advisories** only.

## Docker (reference)

**`docker/build/Dockerfile.proxy`**, **`docker/build/Dockerfile.admin`**, **`docker/build/Dockerfile.migrate`** share one logical **`DATABASE_URL`**. Compose quickstarts: **`docker/compose/`**. Prebuilt image examples and Nginx snippets: **[`docker/examples/`](./docker/examples/)** (including **[`docker/examples/nginx/`](./docker/examples/nginx/)**). Server-side env layout for compose: **[`docker/deploy/README.md`](./docker/deploy/README.md)**. Full ops: **[docs/ops/deployment-docker.md](./docs/ops/deployment-docker.md)**.
