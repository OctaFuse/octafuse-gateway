# `scripts/` (Octafuse)

Non-runtime helpers: smoke tests, DB migration / reconciliation tooling, and dev UX scripts. Business logic lives in **`packages/core`**, **`packages/proxy`**, **`packages/admin`**.

## Layout

| Path | Purpose |
|------|---------|
| `smoke/` | HTTP smoke against a running Node **Proxy** / **Admin** (`test:gateway:*-smoke`) plus in-process **`@octafuse/core`** write-path tests. See [smoke/README.md](./smoke/README.md). |
| `deploy/` | Cloudflare：`gen-wrangler.mjs`（从 `*.base.jsonc` + env 生成 wrangler 配置）、`wrangler-d1-cli.mjs`（按生成配置跑 D1 命令）。见 [docs/ops/deployment-cloudflare.md](../docs/ops/deployment-cloudflare.md)。 |
| `print-dev-start.mjs` | Optional banner before `wrangler dev` (local URL hints). |
| `db/` | Remote D1 export, D1↔Postgres ETL / reconciliation, Postgres diagnostics (**schema apply** lives in **`packages/core/src/migrate/`** via **`npm run db:migrate:pg`** / **`db:migrate:mysql`**) |

### `db/` layout

| Subdir | Purpose |
|--------|---------|
| `lib/` | D1 execution helpers, ETL table order, remote export helpers |
| `d1-remote-export/` | Remote D1 schema / data export (`npm run db:export:remote:*`) |
| `cutover/` | D1 → Postgres ETL, reconciliation (see [docs/ops/postgres-cutover.md](../docs/ops/postgres-cutover.md)) |
| `diag/` | e.g. `npm run db:list:pg` |

Root **`package.json`** exposes common DB commands: D1 via **`gen:wrangler`** + **`db:migrate`** / **`db:migrate:remote`** / **`db:query`** (generated **`packages/core/wrangler.d1.jsonc`**, SQL under **`packages/core/migrations-d1/`**); Cloudflare instance env: **`cloudflare-worker/`** (see **`cloudflare-worker/README.md`**). Postgres via **`db:migrate:pg`** / **`db:migrate:pg:docker`** (in-container, `DATABASE_URL` from env) / **`db:list:pg`** (SQL under **`packages/core/migrations-postgres/`**, reads **`DATABASE_URL`**). Also **`test:gateway:node-smoke`** / **`test:gateway:postgres-smoke`**, **`dev:proxy:node`** (Node Proxy after root `dotenv -c`; DB driver and URL in `.env`). Env template: **`.env.example`**. Other scripts: `npx tsx scripts/...`. See [docs/ops/postgres-cutover.md](../docs/ops/postgres-cutover.md) and [docs/ops/local-testing-environments.md](../docs/ops/local-testing-environments.md).

### In-process smoke (no Proxy)

`smoke/test-critical-write-paths.ts` exercises **`@octafuse/core`** critical write paths with mocks (`node:test`). From repo root:

```bash
npx tsx --test scripts/smoke/test-critical-write-paths.ts
```
