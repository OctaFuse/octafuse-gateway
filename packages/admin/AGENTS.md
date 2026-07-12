# AGENTS.md — `@octafuse/admin` (octafuse)

## Overview

Gateway **Admin** console: API keys, providers, models, routes, `system_config`, request logs, budget audit, analytics. Stack: **Next.js 16 + OpenNext on Cloudflare**.

This package lives in the **`octafuse`** monorepo and **binds to D1** via `wrangler.jsonc` (`DB`). Public admin HTTP APIs are **`/api/admin/*`** (internal Hono uses **`/admin/*`**). The **`@octafuse/proxy` Worker does not expose admin routes**.

**Out of scope for this app**: desktop client version feeds, plugin catalogs, user-growth analytics in a separate billing/portal product—the Admin here is **gateway operations only**.

## Commands

**Prefer repo root** (reads root `.env` / `.env.local`, same convention as Proxy Node+PG):

```bash
npm run dev:admin        # OpenNext preview + D1 :8789
npm run dev:admin:node   # Next + Postgres :8789 (DATABASE_URL, DATABASE_DRIVER same rules as Proxy Node + ADMIN_USERNAME / ADMIN_PASSWORD)
```

Inside **`packages/admin`** (needs `.env` here or `ln -s ../../.env .env`):

```bash
npm run dev           # :3000, no D1 (admin API returns 500; UI-only edits)
npm run dev:node      # :8789 + Postgres (same port as preview)
npm run build:cf      # OpenNext output + worker.js
npm run preview       # :8789 + D1 (--persist-to ../../.wrangler/state)
npm run deploy        # Deploy to Cloudflare
npm run cf-typegen    # Regenerate cloudflare-env.d.ts (required after fresh clone; file is gitignored)
```

For full admin API debugging use **`npm run preview`** or root **`npm run dev:admin`** (D1), or **`npm run dev:node`** / **`npm run dev:admin:node`** (Postgres). Do not rely on Proxy Worker alone.

After a remote deploy (`deploy:*` / `db:migrate:remote`) on this machine, run **`npm run gen:wrangler`** before local D1 dev so Admin/Proxy/migrate share the same local SQLite identity — see [local-development.md §1](../../docs/developers/local-development.md#️-本地-d1-与-database_id远程-deploy-后必读).

**Self-hosted Postgres + containers**: **`Dockerfile.admin`** multi-stage build runs **`npm run build:docker`**（Next standalone，**不**跑 `wrangler types`，与 CI 中 `npm ci --ignore-scripts` 兼容；类型兜底见 **`types/cloudflare-env-shim.d.ts`**），默认 **`CMD`**: `node packages/admin/server.js`，`:8789`，应用进程 only。Schema changes use the **`Dockerfile.migrate`** image (`docker compose --profile migrate run --rm migrate`). Inject **`DATABASE_URL`**, **`DATABASE_DRIVER`** (default `postgres` if omitted), and **`ADMIN_USERNAME` / `ADMIN_PASSWORD`**, same database as **`Dockerfile.proxy`**. See `../../docs/operators/deployment/docker.md`.

## Architecture

| Path | Role |
|------|------|
| `app/api/admin/[...path]/route.ts` | Cookie or Bearer (`MASTER_KEY`) auth; rewrite URL → Hono |
| `lib/admin-app.ts` | Hono: `/admin/keys`, `/admin/providers`, … |
| `lib/routes/admin/*` | Admin HTTP handlers |
| `lib/services/admin/*` | Admin services (use `@octafuse/core`) |
| `app/gateway/*` | Admin UI (`fetch('/api/admin/...')`) |
| `lib/provider-import-presets.json` + `lib/provider-import-preset.ts` | Providers 静态导入模板（预填 endpoint；占位 API Key） |
| `lib/routes/admin/playground.ts` | Playground: single-route upstream test (no `api_key_request_logs`, no billing, no failover) |

## Environment (Wrangler / `.dev.vars`)

| Variable | Purpose |
|----------|---------|
| `ADMIN_USERNAME` | Console login username; in **`wrangler.jsonc`** `vars` for Cloudflare (placeholder `admin` ok). |
| `ADMIN_PASSWORD` | Console login password; **do not** commit in `wrangler.jsonc`. Local: **`packages/admin/.dev.vars`** (see `.dev.vars.example`; `npm run preview` / `dev:admin` auto-creates with **`admin` / `admin`** via `scripts/ensure-dev-vars.mjs` if missing). Production: Worker **Secret** — `npx wrangler secret put ADMIN_PASSWORD --name <ADMIN_WORKER_NAME>`. |
| D1 `DB` | Shared logical DB `octafuse` with Proxy |
| `DATABASE_URL` | **Node / self-hosted Postgres only** (same name as `@octafuse/proxy` Node; do not use on Cloudflare Workers D1 mode) |
| `DATABASE_DRIVER` | **Node / self-hosted**: same semantics as Proxy (`@octafuse/core`); omit → `postgres`; invalid or inconsistent with `DATABASE_URL` → **error** |

Downstream portals: set **`GATEWAY_MASTER_URL`** to this app’s origin, call **`/api/admin/...`**, header **`Authorization: Bearer <MASTER_KEY>`** (must match D1 `system_config.MASTER_KEY`).

## Monorepo build notes

- `next.config.mjs` sets `output: 'standalone'`, `outputFileTracingRoot`, and `turbopack.root` to the **`octafuse` root** so hoisted `next` resolves.
- After `npm run build`, **`scripts/link-standalone-next.mjs`** fixes standalone layout for OpenNext under workspaces (nested `.next` paths).

## Response shape

Same contract as gateway admin APIs: `{ success, data?, message?, ... }`.

## Internationalization (i18n)

Admin UI uses **[next-intl](https://next-intl.dev)** in **without-i18n-routing** mode (no `middleware.ts`, URLs stay `/dashboard`, `/gateway/*`).

| Path | Role |
|------|------|
| `lib/i18n.ts` | Locales (`en`, `zh`), cookie-based `getRequestConfig` |
| `lib/locale.ts` | `LOCALE_COOKIE` (`NEXT_LOCALE`), `resolveLocale()` |
| `app/api/locale/route.ts` | `POST` sets locale cookie |
| `components/layout/LocaleSwitcher.tsx` | Language dropdown (sidebar + login) |
| `messages/en.json` | English copy |
| `messages/zh.json` | 简体中文 copy |

**Conventions for new UI copy:**

- Add strings to `messages/en.json` under the matching namespace (`sidebar`, `providers`, `config`, `common`, …).
- Client components: `useTranslations('namespace')`; server layout/metadata: `getTranslations` from `next-intl/server`.
- Do **not** hardcode user-visible English in JSX or `lib/*` UI helpers — pass `t()` or a labels object (see `lib/pricing-ui.ts` `PricingLabels`, `getBusinessTimezoneOptions`, `getBillingCurrencyOptions`).
- **Out of scope**: Hono/service error messages (display `data.message` as-is), JSON presets (`provider-import-presets.json`, `model-presets/*`), provider/model IDs.
- **Not yet implemented**: additional locales beyond `en` / `zh`.

## Docs

- [docs/README.md](../../docs/README.md)
- [docs/developers/api/admin.md](../../docs/developers/api/admin.md)
- [docs/developers/architecture/admin-layered.md](../../docs/developers/architecture/admin-layered.md)
