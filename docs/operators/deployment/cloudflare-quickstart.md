# Cloudflare 快速部署（外部用户）

面向 **自有 Cloudflare 账号** 的首次上云：一条 CLI 完成 **共享 D1 + Proxy Worker + Admin Worker**。

运维细节 / Workers Builds / 多实例生产：[cloudflare.md](./cloudflare.md) · 配置目录：[cloudflare-worker/README.md](../../../cloudflare-worker/README.md)。

> **不做「Deploy to Cloudflare」单按钮**：官方 [Deploy buttons](https://developers.cloudflare.com/workers/platform/deploy-buttons/) **不会**把 monorepo 里的多个 Worker 一次装齐；本仓库还依赖 `gen-wrangler` 注入共享 `D1_DATABASE_ID`。请用下方 CLI。

---

## 前置

- Cloudflare 账号（Workers + D1）
- Node.js **20+**（与仓库 engines / 文档一致即可）
- 本机已登录：`npx wrangler login`

本机先试用、不上云：[users/quickstart.md §1](../../users/quickstart.md)。非 Cloudflare（Docker + Postgres/MySQL）见 [docker.md](./docker.md)。

---

## 首次一键 bootstrap

```bash
git clone https://github.com/OctaFuse/octafuse-gateway.git
cd octafuse-gateway
npm install
npx wrangler login
npm run bootstrap:cloudflare
```

交互项（或用 CLI 参数跳过）：

| 项 | 说明 |
|----|------|
| Instance name | 写入 `cloudflare-worker/<name>.env`（gitignore）的文件名 |
| Prefix | 默认 `octafuse-gateway` → Worker `…-proxy` / `…-admin`，D1 同名 |
| Custom domains | **建议首次跳过**，先用 Dashboard 里的 `*.workers.dev` |
| `ADMIN_PASSWORD` | 写入 **Admin Worker Secret**（不写进 `.env`） |

非交互示例：

```bash
export BOOTSTRAP_ADMIN_PASSWORD='choose-a-strong-password'
npm run bootstrap:cloudflare -- \
  --instance mygw \
  --prefix my-gateway \
  --admin-password-env BOOTSTRAP_ADMIN_PASSWORD \
  --yes
```

**耗时**：Proxy 通常较快；Admin 为 OpenNext 构建，**首次可能数分钟**。

脚本会：

1. 检查 `wrangler whoami`
2. 创建或复用 D1，写入 `cloudflare-worker/<instance>.env`
3. `db:migrate:remote`
4. `deploy:proxy` + `deploy:admin`
5. `wrangler secret put ADMIN_PASSWORD`
6. 打印下游 `GATEWAY_*` 提示（含库内 `MASTER_KEY`；种子值为 `sk-dev-admin-key` 时须在 Admin Config **轮换**）

---

## 验证

1. Proxy：`GET https://<proxy-workers-dev-or-domain>/health`
2. Admin：打开 Admin URL，用刚才的 `ADMIN_PASSWORD` 登录（默认用户名见 wrangler `ADMIN_USERNAME`，一般为 `admin`）
3. 下游门户：

```env
GATEWAY_URL=https://<proxy>
GATEWAY_MASTER_URL=https://<admin>
GATEWAY_MASTER_KEY=<D1 system_config.MASTER_KEY>
```

读取已部署实例的 Master Key：

```bash
npm run deploy:cloudflare -- mygw --show-master-key
```

---

## 后续发版

```bash
npm run deploy:cloudflare -- mygw --migrate   # 有新 D1 SQL 时带 --migrate
npm run deploy:cloudflare -- mygw             # 仅重新部署双 Worker
npm run deploy:cloudflare -- mygw --proxy-only
npm run deploy:cloudflare -- mygw --admin-only
```

可选：把两个 Worker **Connect to Git**（Workers Builds），见 [cloudflare.md §4](./cloudflare.md#4-workers-builds-connect-to-git)。**D1 迁移不会**随 Git 构建自动跑，仍用 `deploy:cloudflare -- <instance> --migrate-only` 或 `db:migrate:remote`。

---

## 本地开发注意

远程 deploy 会在生成的 `wrangler.jsonc` 写入 `database_id`。继续本机 `dev:proxy` / `dev:admin` 前：

```bash
npm run gen:wrangler
```

详见 [local-development.md §1](../../developers/local-development.md)。

---

## 同账号多实例

改 `--prefix` / `--instance`，避免 Worker 名与 D1 名冲突。已有 D1 可传 `--d1-id <uuid>` 或依赖同名复用；仅允许已存在库时用 `--reuse-d1`。
