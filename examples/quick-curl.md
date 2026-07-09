# Quick `curl` checks

Assume the Proxy listens on `http://127.0.0.1:8787` (default for local Worker or Node). Replace placeholders with real values from your Admin / database.

## Health

```bash
curl -sS http://127.0.0.1:8787/health
```

## Chat completion (OpenAI-compatible)

Use an API key you created in Admin (`sk-…`) and a **route model id** that matches your configured model route.

```bash
curl -sS http://127.0.0.1:8787/v1/chat/completions \
  -H "Authorization: Bearer sk-your-api-key" \
  -H "Content-Type: application/json" \
  -d '{"model":"your-route-model","messages":[{"role":"user","content":"Hello"}]}'
```

## Admin API (master key)

`MASTER_KEY` must match `system_config.MASTER_KEY` in the database. The development seed (`packages/core/migrations-{d1,postgres,mysql}/0002_seed.sql`) writes the placeholder `sk-dev-admin-key` for local Docker quickstart only. Admin app default in Docker quickstart is often `http://127.0.0.1:8789`.

```bash
curl -sS http://127.0.0.1:8789/api/admin/health \
  -H "Authorization: Bearer sk-dev-admin-key"
```

> Production: rotate `MASTER_KEY` to a strong random value via the Admin Config page or direct SQL, then update any `GATEWAY_MASTER_KEY` consumers. See [docs/CONVENTIONS.md §2.3](../docs/CONVENTIONS.md#23-关于-sk-dev-admin-key) and [docs/developers/api/admin.md](../docs/developers/api/admin.md).

Adjust host, port, and Bearer tokens for your environment.
