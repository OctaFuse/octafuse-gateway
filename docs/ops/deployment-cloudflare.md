# 线上部署：Cloudflare（Proxy Worker + Admin + D1）

本文说明在 **Cloudflare** 上部署 **octafuse-gateway**：**Proxy Worker**、**Admin（OpenNext on Workers）** 与共享 **D1** 数据库。表结构以 **`packages/core/migrations-d1/`** 为准。

**生产典型域名**：Proxy `https://gateway.example.com`，Admin `https://gateway-admin.example.com`（在 Cloudflare DNS 与证书中配置；下游 **`GATEWAY_URL` / `GATEWAY_MASTER_URL`** 与之对齐）。

不使用 D1 时改走 Docker 自托管，见 [deployment-docker.md](./deployment-docker.md)。

---

## 1. 部署失败常见原因：`database_id` 仍是占位符

若日志中出现：

```text
D1 binding 'DB' references database '00000000-0000-4000-8000-000000000001' which was not found [code: 10181]
```

说明 **`wrangler.jsonc` / `wrangler.d1.jsonc` 里的 `database_id` 仍是仓库占位 UUID**。`wrangler deploy` 与 **`opennextjs-cloudflare deploy`** 会把配置文件中的 D1 绑定提交给 Cloudflare API，**API 会校验该 ID 是否存在于当前账号**。

**重要**：

- **仅**在控制台给 Worker 绑定 D1，**不能**绕过**配置文件里**无效或占位 `database_id`。
- 三处配置里的 **`database_id` 必须为同一真实 UUID**（见下表）。

| 文件 | 用途 |
|------|------|
| `packages/core/wrangler.d1.jsonc` | 根目录 `npm run db:migrate*`（勿用于 `wrangler deploy`） |
| `packages/proxy/wrangler.jsonc` | Proxy Worker 部署 |
| `packages/admin/wrangler.jsonc` | Admin OpenNext 部署 |

`database_name`（如 **`octafuse-gateway`**）须与 `wrangler d1 migrations apply` 使用的数据库名一致；一般保持默认即可。

**不想手改三处时**：见文末 **附录**（编辑器批量替换或一条 shell），**无需**在仓库里加脚本或改 `package.json`。

---

## 2. 推荐流程：Fork 与配置

1. **Fork** [octafuse-gateway](https://github.com/OctaFuse/octafuse-gateway)（或导入为自有远程），克隆到本地。
2. 按 **§3 / §4** 在 Cloudflare 创建 D1，得到 **Database ID**。
3. 将上表 **三个** 文件中的 `database_id` 全部改为该 UUID（或用 **附录** 里的一条命令）。
4. 仓库根执行：

   ```bash
   npm install
   npm run db:migrate:remote
   npm run deploy:proxy
   npm run deploy:admin
   ```

---

## 3. 方法一：Wrangler CLI 创建 D1

```bash
npx wrangler login
npx wrangler d1 create octafuse-gateway
npx wrangler d1 list   # 可选：核对 database_id
```

将输出中的 **`database_id`** 写入上表三个文件（或附录 shell）。

---

## 4. 方法二：Cloudflare 控制台创建 D1

1. [Dashboard](https://dash.cloudflare.com/) → **Workers & Pages** → **D1** → **Create database**（名称建议 **`octafuse-gateway`**）。
2. 在数据库详情页复制 **Database ID**。
3. 写入上表三个文件（或附录 shell）。

**说明**：控制台给 Worker 绑 D1 仍不能替代配置文件中的有效 `database_id`。

---

## 5. Connect to Git（Workers Builds）

关联 Git 后，**仓库内三个文件已是真实 `database_id`**（或由 CI 在构建前按附录写入）再部署，否则会重复 §1 错误。

| Worker | Root directory | 构建 / 部署命令（示例） |
|--------|----------------|-------------------------|
| **Proxy** | `packages/proxy` | `cd ../.. && npm ci && cd packages/proxy && npx wrangler deploy` |
| **Admin** | `packages/admin` | `cd ../.. && npm ci && cd packages/admin && npm run build:cf && npx wrangler deploy` |

**Admin**：`ADMIN_PASSWORD` 勿写入 Git；用控制台 **Secrets** 或 `npx wrangler secret put ADMIN_PASSWORD`。

**远程迁移**（可与 Admin 同一条流水线）：

```bash
cd ../.. && npm ci && npx wrangler d1 migrations apply octafuse-gateway --config ./packages/core/wrangler.d1.jsonc --remote && cd packages/admin && npm run build:cf && npx wrangler deploy
```

**CI 非交互**：可设 `WRANGLER_SEND_METRICS=false`（或 `CI=true`，依 Wrangler 版本）。

---

## 6. 本机前置（可选）

- 仓库根 `npm install`，`npx wrangler login`（或 `CLOUDFLARE_API_TOKEN`）。
- 完成 §2–§4 的 D1 与三文件 `database_id`。

**Postgres** 不作为 Cloudflare Worker 存储；Node + Postgres 见 [deployment-docker.md](./deployment-docker.md)。

---

## 7. 迁移与发布顺序

1. 远程 D1 有待执行迁移时，在**仓库根**：`npm run db:migrate:remote`
2. `npm run deploy:proxy`
3. `npm run deploy:admin`

先迁移、再发依赖新 schema 的 Worker。

---

## 8. `MASTER_KEY` 与 Admin 认证

- 管理接口 Bearer 须与 D1 **`system_config.MASTER_KEY`** 一致（从库读，不以 Worker Secret 为准）。
- 首次上线后应轮换 `MASTER_KEY`，并同步下游 **`GATEWAY_MASTER_KEY`**（见 [api/admin.md](../api/admin.md)）。

---

## 9. 下游环境变量

| 变量 | 说明 |
|------|------|
| `GATEWAY_URL` | Proxy 根 URL |
| `GATEWAY_MASTER_URL` | Admin 根 URL；`/api/admin/*` |
| `GATEWAY_MASTER_KEY` | 与 D1 `MASTER_KEY` 一致 |

---

## 10. 健康检查与观测

- Proxy：`GET /health`
- 日志：`npx wrangler tail`（Worker 名见各包 `wrangler.jsonc` 的 `name`）

---

## 11. 多套环境

预发 / 生产各用独立 D1 与各自 `database_id`、Worker `name` 或分支，避免混库。

---

## 附录：少改几次 `database_id` 的两种轻量做法

以下**不依赖**仓库内任何脚本或 npm 生命周期，按需自选。

### A. 编辑器「在文件中替换」

在 VS Code / Cursor：**在文件中替换**，范围限定为下面三个路径（或 `**/wrangler*.jsonc` 再人工核对只改这三份）：

- `packages/core/wrangler.d1.jsonc`
- `packages/proxy/wrangler.jsonc`
- `packages/admin/wrangler.jsonc`

将占位 UUID `00000000-0000-4000-8000-000000000001` **全部**替换为你的真实 **Database ID**（三处一致即可）。

### B. 一条 shell（本机 / CI 均可）

先设置变量，再对三个文件各替换**首个** `"database_id": "..."`（当前每个文件仅一处，满足即可）：

```bash
export D1_ID='xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx'   # 换成你的 Database ID

for f in packages/core/wrangler.d1.jsonc packages/proxy/wrangler.jsonc packages/admin/wrangler.jsonc; do
  if [ "$(uname -s)" = Darwin ]; then
    sed -i '' "s/\"database_id\": \"[^\"]*\"/\"database_id\": \"$D1_ID\"/g" "$f"
  else
    sed -i "s/\"database_id\": \"[^\"]*\"/\"database_id\": \"$D1_ID\"/g" "$f"
  fi
done
```

**注意**：若将来某文件里出现多个 `"database_id"` 字段，不要用本 `sed` 盲替换，应改回手改或收窄匹配范围。

---

### 若仍希望「仓库内自动化」

可在 **Fork 私有分支** 自行加 `predeploy` / 小脚本从 `packages/core/wrangler.d1.jsonc` 同步到 proxy/admin；上游保持零魔法、少侵入，避免所有使用者都承担隐式写文件行为。

---

**相关文档**：[部署索引](./deployment.md) · [本地测试](./local-testing-environments.md) · [Admin API](../api/admin.md)
