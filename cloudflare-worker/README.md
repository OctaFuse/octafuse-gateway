# Cloudflare Worker 部署配置

本目录存放 **Wrangler / Workers Builds** 用的实例变量（Worker 名、D1、`routes`）。**不**用于 Node + Postgres 本地开发——见仓库根 [`.env.example`](../.env.example)。

| 你要做的事 | 文档 |
|------------|------|
| 自有账号首次上云 | [cloudflare-quickstart.md](../docs/operators/deployment/cloudflare-quickstart.md)（`npm run bootstrap:cloudflare`） |
| 本地 D1 开发 / `database_id` 陷阱 | [local-development.md](../docs/developers/local-development.md) §1 |
| 运维、dev 演示、Workers Builds、多实例 | [cloudflare.md](../docs/operators/deployment/cloudflare.md) |

> 本仓库**不提供**「Deploy to Cloudflare」单按钮；请用 quickstart CLI。原因见 [cloudflare-quickstart.md](../docs/operators/deployment/cloudflare-quickstart.md)。

---

## 本目录文件

| 文件 | 是否提交 Git | 用途 |
|------|--------------|------|
| [`example.env`](./example.env) | ✅ | **dev 演示** canonical（`octafuse.dev`） |
| 自建 `cloudflare-worker/<name>.env` | ❌ gitignore | **生产**本地 CLI 或 Dashboard 配置备份 |
| Cloudflare **Build variables** | ❌ 仅 Dashboard | **生产** Git 自动部署（与实例 `.env` 同名变量） |

`gen-wrangler` 只读 **环境变量**（`process.env`），不关心来自文件还是 Dashboard。

生产实例 env：复制 `example.env` 为 `cloudflare-worker/<your-instance>.env`（**勿 commit**），按账号修改 Worker 名、D1 UUID、可选自定义域。变量语义与 Build variables 见 [cloudflare.md §3–§4](../docs/operators/deployment/cloudflare.md#3-生产部署)。

### 常用 CLI

```bash
npm run bootstrap:cloudflare                          # 首次
npm run deploy:cloudflare -- <instance> --migrate     # 有新 D1 SQL 时
npm run deploy:cloudflare -- <instance>               # 仅双 Worker
```

等价手动命令与 Workers Builds Dashboard 配置见 [cloudflare.md](../docs/operators/deployment/cloudflare.md)。

---

## 环境变量一览

| 变量 | 说明 |
|------|------|
| `PROXY_WORKER_NAME` / `ADMIN_WORKER_NAME` | **须与 Dashboard Worker 名一致** |
| `D1_DATABASE_NAME` | D1 逻辑名 |
| `D1_DATABASE_ID` | 远程 deploy / migrate **必填**；proxy 与 admin **共用**。本地 CLI deploy 写入 wrangler 后，继续 `dev:proxy`/`dev:admin` 前须 `npm run gen:wrangler`（见 [local-development.md §1](../docs/developers/local-development.md#️-本地-d1-与-database_id远程-deploy-后必读)） |
| `D1_MIGRATIONS_WORKER_NAME` | 仅写入 `wrangler.d1.jsonc` 的项目名；**无需**单独建 Worker |
| `PROXY_CUSTOM_DOMAIN` / `ADMIN_CUSTOM_DOMAIN` | 可选；写入 wrangler `routes` |

实现：`npm run gen:wrangler` → [`scripts/deploy/gen-wrangler.mjs`](../scripts/deploy/gen-wrangler.mjs)。

### Proxy 工具密钥（Web Search / Web Fetch）

在 **Admin → Tools → Configuration** 写入 `system_config`：

- Web Search：`WEB_SEARCH_ACTIVE` + `WEB_SEARCH_CATALOG`（按引擎存 API Key / 单价）
- Web Fetch：`WEB_FETCH_ACTIVE` + `WEB_FETCH_CATALOG`

无需 Wrangler secret 或 Proxy 环境变量。旧全局三键仅兼容读取，新配置请用 Catalog。

---

## 与根目录 `.env.example` 的区别

| | `cloudflare-worker/` | 根 `.env.example` → `.env` |
|--|----------------------|----------------------------|
| 用途 | Cloudflare 部署 / 远程 D1 | Node + Postgres/MySQL、Docker、冒烟 |
| 典型命令 | `deploy:proxy`、`db:migrate:remote` | `dev:proxy:node`、`db:migrate:pg` |

两者互不替代。
