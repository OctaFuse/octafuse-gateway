# Examples

Short pointers for calling the gateway after you define at least one **provider** and **model route** (Admin UI or `POST /api/admin/*`).

| Doc / asset | What it covers |
|-------------|----------------|
| [quick-curl.md](./quick-curl.md) | Minimal `curl` against Proxy health and chat completions |
| [README.md](../README.md) (repo root) | ~60s Docker quickstart and inline chat `curl` |
| [docs/api/admin.md](../docs/api/admin.md) | Admin HTTP API (providers, routes, keys) |
| [docs/api/user.md](../docs/api/user.md) | End-user key usage (`/v1/me`, spend) |
| [docker/examples/](../docker/examples/) | Compose snippets and nginx fragments for streaming |

For environment variables, start from [`.env.example`](../.env.example) at the repository root.
