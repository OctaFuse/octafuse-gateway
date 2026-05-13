# Octafuse Gateway

[![License: AGPL v3](https://img.shields.io/badge/License-AGPL%20v3-blue.svg)](./LICENSE)

**Octafuse Gateway** is an npm-workspaces monorepo: shared **`@octafuse/core`**, a public **inference Proxy** (OpenAI / Anthropic / Gemini–compatible), and an **Admin** app (Next.js 16 + OpenNext) for operators and **`/api/admin/*`** automation. Typical deployments: **Cloudflare** (Proxy Worker + Admin Pages + **D1**) or **self-hosted Docker** (Proxy + Admin + **Postgres** or **MySQL**).

Licensed under the **GNU Affero General Public License v3.0 (AGPLv3)**. See [LICENSE](./LICENSE).

**Chinese documentation:** [README.zh-CN.md](./README.zh-CN.md)

## ~60 second quickstart (Docker + Postgres)

Prerequisites: Docker with Compose **v2.20+** (for `service_completed_successfully`).

```bash
docker compose -f docker/compose/quickstart.yml up --build
```

When services are healthy:

```bash
curl -sS http://localhost:8787/health
```

Open **Admin** at `http://localhost:8789` (default login: `admin` / `changeme`). Add at least one upstream **provider** and **model route**, then create an API key (UI or Admin API). The Postgres seed sets default `MASTER_KEY` to `sk-dev-admin-key` (Bearer for `POST /api/admin/*`); override in production — see [docs/api/admin.md](./docs/api/admin.md).

Example chat call (after you have a real API key and routing configured):

```bash
curl -sS http://localhost:8787/v1/chat/completions \
  -H "Authorization: Bearer sk-..." \
  -H "Content-Type: application/json" \
  -d '{"model":"your-route-model","messages":[{"role":"user","content":"Hello"}]}'
```

For MySQL, D1-only dev, and split compose profiles, see **[docker/compose/node-pg.yml](./docker/compose/node-pg.yml)**, **[docker/compose/node-mysql.yml](./docker/compose/node-mysql.yml)**, and **[docs/ops/deployment-docker.md](./docs/ops/deployment-docker.md)**.

## One-click Cloudflare deploy (Connect to Git)

Fork this repo and connect it from the **Cloudflare dashboard** to two **Workers** (Proxy + Admin): set **Root directory** to `packages/proxy` and `packages/admin`, wire the shared **D1** binding as **`DB`**, and set **`ADMIN_PASSWORD`** as a Worker **Secret** (not in Git). Step-by-step build commands, optional D1 migrate-in-build, and upgrade notes are in **[docs/ops/deployment-cloudflare.md](./docs/ops/deployment-cloudflare.md)** (section **0**).

## Packages

| Path | npm name | Role |
|------|----------|------|
| `packages/core` | `@octafuse/core` | D1 / Postgres / MySQL storage, types, migrations CLI (`octafuse-migrate`) |
| `packages/proxy` | `@octafuse/proxy` | Worker or Node: **`/v1/*`**, **`/v1beta/*`**, **`/health`**, **`/`** |
| `packages/admin` | `@octafuse/admin` | Admin UI + **`/api/admin/*`** (same DB as Proxy) |

Architecture index: **[docs/README.md](./docs/README.md)**.

## Versioning & releases

The monorepo uses a **single semver line** (root `octafuse` + `@octafuse/*` share `version`). **Git tags `vX.Y.Z`** drive official **GHCR** image builds and **GitHub Releases** (with per-image digests for reproducible deploys).

- Add a changeset when your PR should ship in the next release: `npx changeset`
- Maintainer flow: merge **Version Packages** PR → `changeset tag` on `main` → Docker workflow → release notes

Details: **[docs/ops/release-versioning.md](./docs/ops/release-versioning.md)** · **[`.changeset/README.md`](./.changeset/README.md)**

## Migrations policy

`packages/core/migrations-d1/`, `migrations-postgres/`, and `migrations-mysql/` are the **baseline** for new installs; follow-up operational SQL for already-deployed environments lives under **`docs/manual-sql/`** (with D1 vs SQL variants as documented there).

## Environment

- Copy **[`.env.example`](./.env.example)** → **`.env`** and uncomment the sections you need.  
- Optional **`.env.local`** for machine-specific overrides (patterns at the top of **`.env.example`**).  
- **Node + Postgres or MySQL**: set **`DATABASE_URL`**, optional **`DATABASE_DRIVER`** (`postgres` default; use `mysql` with `mysql://`). Admin needs **`ADMIN_USERNAME`** / **`ADMIN_PASSWORD`**.  
- **Cloudflare + D1**: use Wrangler bindings in `packages/proxy` / `packages/admin` — do not point Workers at `DATABASE_URL` for D1 mode. Set **`ADMIN_PASSWORD`** via Worker **Secret** or `wrangler secret put` (not in `wrangler.jsonc`); see [docs/ops/deployment-cloudflare.md](./docs/ops/deployment-cloudflare.md) §0.

Minimal HTTP examples: **[examples/README.md](./examples/README.md)**.

## Common commands (repo root)

```bash
npm install
cp .env.example .env   # configure DATABASE_* and ADMIN_* for Node paths

npm run db:migrate          # local D1 → ./.wrangler/state
npm run db:migrate:pg       # Postgres (SQL under packages/core/migrations-postgres/)
npm run db:migrate:mysql    # MySQL 8 (migrations-mysql/)

npm run dev:proxy           # Proxy Worker :8787 (D1)
npm run dev:proxy:node      # Proxy Node + SQL :8787
npm run dev:admin           # Admin OpenNext preview + D1 :8789
npm run dev:admin:node      # Admin Node + SQL :8789

npm run test:gateway:postgres-smoke   # optional integration smoke (see script header)
```

## Portal integration (contract)

Downstream billing / user portals are **out of scope** for this repo. They should call Admin over HTTPS only, for example:

| Variable (concept) | Purpose |
|--------------------|---------|
| `GATEWAY_URL` | Proxy root (user inference) |
| `GATEWAY_MASTER_URL` | Admin root; HTTP APIs under **`{GATEWAY_MASTER_URL}/api/admin/*`** |
| `GATEWAY_MASTER_KEY` | Bearer token, must match DB **`system_config.MASTER_KEY`** |

See **[docs/api/admin.md](./docs/api/admin.md)** and **[docs/api/user.md](./docs/api/user.md)**.

## Contributing & security

- **[CONTRIBUTING.md](./CONTRIBUTING.md)** — includes contribution licensing (AGPL + maintainer relicensing clause).  
- **[CODE_OF_CONDUCT.md](./CODE_OF_CONDUCT.md)** — Contributor Covenant 2.1.  
- **[SECURITY.md](./SECURITY.md)** — report vulnerabilities via **GitHub Security Advisories** only.

Release notes: use **GitHub Releases** (no changelog file required for this repo).

## Docker (reference)

**`docker/build/Dockerfile.proxy`**, **`docker/build/Dockerfile.admin`**, and **`docker/build/Dockerfile.migrate`** share one logical **`DATABASE_URL`**. Prebuilt image examples: **`docker/examples/`** (includes **[`docker/examples/nginx/`](./docker/examples/nginx/)** for streaming-friendly reverse proxy snippets). Further ops: **[docker/deploy/README.md](./docker/deploy/README.md)**, **[docs/ops/deployment-docker.md](./docs/ops/deployment-docker.md)**.
