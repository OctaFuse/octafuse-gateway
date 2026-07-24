# 从零部署 Octafuse Gateway 到 Cloudflare Workers

本文面向第一次接触 Octafuse Gateway 的部署者，从一个 Cloudflare 账号开始，完成以下完整链路：

1. 获取并确认最新版代码；
2. 创建共享 D1 数据库；
3. 部署 Proxy Worker 和 Admin Worker；
4. 设置 Admin 登录密码；
5. 验证 Worker、登录和 D1；
6. 配置 Provider、Model、Route 和用户 API Key；
7. 发出第一条真实模型请求；
8. 掌握升级、排障和清理方法。

部署完成后的结构如下：

```text
AI client
    │  user API key
    ▼
Proxy Worker  ──────┐
                    ├── shared D1
Admin Worker  ──────┘
    ▲
    │  browser login / MASTER_KEY
Operator
```

Proxy 和 Admin 是两个独立 Worker，但 D1 绑定名都为 `DB`，且必须指向同一个数据库。

## 本文实测基线

本文在 2026-07-24 使用官方 `main` 的 **Octafuse Gateway 1.10.2** 完成真实部署：

| 组件 | 实测版本 / 结果 |
|------|-----------------|
| Node.js | 22.15.0（项目要求 20+） |
| Wrangler | 4.107.0 |
| Next.js | 16.2.3 |
| `@opennextjs/cloudflare` | 1.19.4 |
| Proxy gzip | 194.31 KiB |
| Admin gzip | 2925.55 KiB |
| D1 migrations | 13 个全部成功 |

Cloudflare Workers Free 的单 Worker gzip 上限为 3 MiB；Admin 实测低于该上限，但余量不大。部署时应检查自己终端中的 `Total Upload ... gzip`，不要只依赖本文的历史数值。限制以 [Cloudflare Workers Limits](https://developers.cloudflare.com/workers/platform/limits/#worker-size) 为准。若免费额度余量吃紧或流量上来，也推荐升级 [Workers Paid](https://developers.cloudflare.com/workers/platform/pricing/)（约 $5/月）——量大管饱，性价比极高。

更深入的多实例、Workers Builds 和运维说明见 [cloudflare.md](./cloudflare.md)。本地试用见 [用户快速开始](../../users/quickstart.md)。

---

## 1. 准备 Cloudflare 和本机环境

你需要：

- 一个可使用 Workers 和 D1 的 Cloudflare 账号；
- Git；
- Node.js **20 或更高版本**；
- npm；
- 可以打开浏览器完成 Cloudflare OAuth 登录的终端。

检查本机：

```bash
git --version
node --version
npm --version
```

如果还没有 Node.js，推荐通过 [Node.js 官网](https://nodejs.org/) 或版本管理器安装当前 LTS。不要使用 Node.js 18 或更低版本。

自定义域名不是首次部署的必要条件。建议先用免费提供的 `*.workers.dev` 地址完成验证，确认可用后再绑定域名。

---

## 2. 获取最新版并安装锁定依赖

```bash
git clone https://github.com/OctaFuse/octafuse-gateway.git
cd octafuse-gateway
npm ci
```

`npm ci` 严格按照仓库根目录的 `package-lock.json` 安装，适合部署和复现。若你正在更新一个已有目录：

```bash
git pull --ff-only
npm ci
```

确认项目和关键部署依赖：

```bash
npm pkg get version
npm ls @opennextjs/cloudflare next wrangler --depth=0
```

输出版本应与当前 `package.json` / `package-lock.json` 一致。如果 `npm ls` 出现 `invalid`，说明 `node_modules` 与源码不一致；重新执行 `npm ci`，不要直接拿旧依赖部署。

---

## 3. 登录 Cloudflare

```bash
npx wrangler login
```

Wrangler 会打开 Cloudflare OAuth 页面。授权成功后检查：

```bash
npx wrangler whoami
```

你应看到账号名称、Account ID 和 Workers / D1 相关权限。若看到 token expired 或 not logged in，重新运行 `npx wrangler login`。

---

## 4. 规划实例名称

bootstrap 有两个容易混淆的名字：

| 名称 | 作用 | 示例 |
|------|------|------|
| Instance name | 本地私有配置文件名：`cloudflare-worker/<instance>.env` | `production` |
| Prefix | Cloudflare 资源前缀 | `my-octafuse` |

如果 Prefix 为 `my-octafuse`，脚本会创建：

```text
D1:            my-octafuse
Proxy Worker:  my-octafuse-proxy
Admin Worker:  my-octafuse-admin
Migration name: my-octafuse-d1-migrations
```

最后一个名称只写入迁移配置，**不会**创建第三个 Worker。

同一账号部署测试、预发布和生产时，请使用不同 Prefix，例如：

```text
my-octafuse-test
my-octafuse-staging
my-octafuse-prod
```

---

## 5. 首次 bootstrap

### 方式 A：交互式部署（第一次最推荐）

```bash
npm run bootstrap:cloudflare
```

按提示填写：

1. **Instance name**：例如 `production`；
2. **Prefix**：例如 `my-octafuse-prod`；
3. **Custom domains**：第一次选 `N`；
4. D1 迁移确认：输入 `y`；
5. **ADMIN_PASSWORD**：输入一个强密码。

密码会通过 Wrangler 写入 Admin Worker Secret，不会写入实例 `.env`。

### 方式 B：非交互式部署

先把强密码放入当前 shell 的临时环境变量。不要把真实密码提交到 Git：

```bash
export BOOTSTRAP_ADMIN_PASSWORD='replace-with-a-long-random-password'

npm run bootstrap:cloudflare -- \
  --instance production \
  --prefix my-octafuse-prod \
  --admin-password-env BOOTSTRAP_ADMIN_PASSWORD \
  --yes

unset BOOTSTRAP_ADMIN_PASSWORD
```

`--yes` 只接受 bootstrap 的默认选择；如果当前终端有 TTY，Wrangler 在执行远程 D1 migration 前仍会要求明确确认。这是刻意保留的安全检查，因为同名 D1 可能是已有实例。真正没有 TTY 的 CI 环境会由 Wrangler 按非交互模式处理。

若同时省略 `--admin-password-env`，脚本会为了避免把默认弱密码写入生产而跳过 Secret 设置；此时必须手动执行：

```bash
npx wrangler secret put ADMIN_PASSWORD --name my-octafuse-prod-admin
```

### bootstrap 实际执行了什么

脚本依次：

1. `wrangler whoami` 检查登录；
2. 按 D1 名查找已有数据库，没有则创建；
3. 写入被 `.gitignore` 排除的 `cloudflare-worker/<instance>.env`；
4. 生成三个 `wrangler*.jsonc`；
5. 请求确认后，对远程 D1 应用全部迁移；
6. 部署 Proxy Worker；
7. 构建并部署 Admin Worker；
8. 写入 `ADMIN_PASSWORD` Secret；
9. 打印 Worker 名和后续操作提示。

首次 Admin 构建通常比 Proxy 慢。只要命令仍在输出 Next.js / OpenNext / asset upload 进度，就让它继续运行。

---

## 6. 找到两个访问地址

部署成功时，Wrangler 会分别打印：

```text
https://<prefix>-proxy.<account-subdomain>.workers.dev
https://<prefix>-admin.<account-subdomain>.workers.dev
```

例如 Prefix 为 `my-octafuse-prod`：

```env
GATEWAY_URL=https://my-octafuse-prod-proxy.<account-subdomain>.workers.dev
GATEWAY_MASTER_URL=https://my-octafuse-prod-admin.<account-subdomain>.workers.dev
```

`<account-subdomain>` 不是 Account ID。请复制 Wrangler 的真实输出，或打开 Cloudflare Dashboard → Workers & Pages → 对应 Worker 查看 URL。

普通 bootstrap **不会把 D1 中的 `MASTER_KEY` 打到终端**。这是 Admin API 的数据库凭据，不等同于 Admin 网页登录密码。

---

## 7. 验证部署

先设置刚才复制的地址：

```bash
export GATEWAY_URL='https://<proxy-worker>.<account-subdomain>.workers.dev'
export GATEWAY_MASTER_URL='https://<admin-worker>.<account-subdomain>.workers.dev'
```

### 7.1 Proxy 健康检查

```bash
curl -i "$GATEWAY_URL/health"
```

预期：

```http
HTTP/2 200
```

```json
{"status":"ok","service":"octafuse-proxy"}
```

### 7.2 公开模型目录

```bash
curl -sS "$GATEWAY_URL/catalog/models"
```

新数据库尚未配置 active route 时，下面的空数组是正常结果，不是部署失败：

```json
{"object":"list","data":[],"generated_at":"..."}
```

### 7.3 Admin 首页与登录

浏览器打开：

```text
https://<admin-worker>.<account-subdomain>.workers.dev
```

使用：

```text
Username: admin
Password: bootstrap 时设置的 ADMIN_PASSWORD
```

登录后能打开 Dashboard，并进入 **System → Config**，说明以下链路都已成立：

```text
Browser → Admin Worker → D1
```

Admin 当前**没有** `/api/admin/health`。不要用这个不存在的地址判断部署失败。需要脚本化检查时，可使用一个真实且安全的只读接口，例如：

```bash
curl -sS "$GATEWAY_MASTER_URL/api/admin/business-timezone" \
  -H "Authorization: Bearer <MASTER_KEY>"
```

`<MASTER_KEY>` 需先从 **System → Config** 取得，或在需要时显式运行 `npm run deploy:cloudflare -- <instance> --show-master-key`（普通 bootstrap 不会打印该值）。有效 `MASTER_KEY` 应返回 HTTP 200。

### 7.4 检查 D1 迁移

把实例名替换为自己的：

```bash
npx dotenv -e ./cloudflare-worker/production.env -- \
  npm run gen:wrangler -- --remote

npx dotenv -e ./cloudflare-worker/production.env -- \
  npx wrangler d1 execute my-octafuse-prod \
  --remote \
  --config ./packages/core/wrangler.d1.jsonc \
  --command 'SELECT COUNT(*) AS applied FROM d1_migrations;'
```

结果中的 `applied` 应等于当前 `packages/core/migrations-d1/` 下迁移文件数量。

---

## 8. 立即完成安全初始化

Admin 登录密码与 Admin API Master Key 是两套凭据：

| 凭据 | 用途 | 存储位置 |
|------|------|----------|
| `ADMIN_PASSWORD` | 浏览器登录 Admin | Cloudflare Worker Secret |
| `MASTER_KEY` | 调用 `/api/admin/*` | D1 `system_config` |
| 用户 API Key | 调用 Proxy `/v1/*` | D1，Admin 创建 |

首次迁移会写入公开的开发占位值 `sk-dev-admin-key`。部署后立即：

1. 打开 Admin；
2. 进入 **System → Config**；
3. 找到 **Admin API master key**；
4. 替换为强随机值并保存；
5. 把新值安全地写入需要调用 Admin API 的服务端环境变量 `GATEWAY_MASTER_KEY`；
6. 不要把它放在浏览器前端代码、公开仓库或截图里。

可以在本机生成随机值：

```bash
openssl rand -hex 32
```

轮换后确认旧占位值失效：

```bash
curl -o /dev/null -sS -w '%{http_code}\n' \
  "$GATEWAY_MASTER_URL/api/admin/business-timezone" \
  -H 'Authorization: Bearer sk-dev-admin-key'
```

预期为 `401`。

只有在明确需要恢复已有值时，才使用会把敏感值打印到当前终端的显式命令：

```bash
npm run deploy:cloudflare -- production --show-master-key
```

避免在录屏、共享终端或 CI 日志中运行它。

---

## 9. 从空数据库配置到可调用

刚部署完成的网关没有你的上游模型密钥，因此 `/catalog/models` 为空，模型请求也不会自动可用。按下面顺序配置。

### 9.1 添加 Provider

Admin → **Inference → Providers**：

1. 点击 **Import**；
2. 选择你的上游，例如 OpenAI、Anthropic、Gemini、OpenRouter 或自建 OpenAI-compatible 服务；
3. 导入后打开 Provider；
4. 确认 endpoint；
5. 添加上游 API Key；
6. 保持 Provider 和这把 Key 为 active。

上游 API Key 只用于 Gateway 访问供应商，不要把它发给下游用户。

### 9.2 添加 Model

Admin → **Inference → Models**：

1. 点击 **Import** 选择内置模型，或手动创建；
2. 确认模型 ID；
3. 检查输入 / 输出 modality；
4. 检查计价配置和币种；
5. 保存。

客户端请求体中的 `model` 最终使用这里的模型 ID。

### 9.3 创建 Route

Admin → **Inference → Routes**：

1. 新建 Route；
2. 选择刚才的 Model；
3. 选择 Provider；
4. 填写供应商实际模型名；
5. 选择正确的上游协议；
6. 将 route group 至少加入客户端会使用的组，例如 `default`；
7. 启用 Route。

一个模型可以有多个 Route，用优先级、限额和故障转移控制调度。

保存后再次查看：

```bash
curl -sS "$GATEWAY_URL/catalog/models"
```

active route 配置正确时，模型会出现在公开目录中。

### 9.4 创建用户和用户 API Key

Admin → **User → Users**：

1. 新建用户；
2. 按需要设置预算周期和额度；
3. 保存后为用户创建 API Key；
4. 立即复制返回的 `sk-...`。

完整 Key 通常只展示一次。下文把它记为：

```bash
export OCTAFUSE_API_KEY='sk-your-user-key'
```

不要用 `MASTER_KEY` 代替用户 Key 调用 Proxy。

---

## 10. 发出第一条请求

### 10.1 查看当前用户可用模型

```bash
curl -sS "$GATEWAY_URL/v1/models" \
  -H "Authorization: Bearer $OCTAFUSE_API_KEY"
```

### 10.2 OpenAI-compatible Chat Completions

将 `your-model-id` 替换成 Admin 中配置的模型 ID：

```bash
curl -sS "$GATEWAY_URL/v1/chat/completions" \
  -H "Authorization: Bearer $OCTAFUSE_API_KEY" \
  -H 'Content-Type: application/json' \
  -d '{
    "model": "your-model-id",
    "messages": [
      {
        "role": "user",
        "content": "Say hello from Octafuse Gateway."
      }
    ]
  }'
```

如果返回上游响应，部署与配置已经从零到一完成。随后可在 Admin 的 **Request Logs**、**Analytics** 和用户预算页面查看这次调用。

其它协议、Images 和 Tools 示例见：

- [用户快速开始](../../users/quickstart.md)
- [集成说明](../../developers/integration.md)
- [HTTP 示例](../../../examples/README.md)

---

## 11. 绑定自定义域名（可选）

先确保域名所在 zone 已加入同一个 Cloudflare 账号。编辑被 gitignore 的实例文件：

```env
PROXY_CUSTOM_DOMAIN=api.example.com
ADMIN_CUSTOM_DOMAIN=admin.example.com
```

重新部署：

```bash
npm run deploy:cloudflare -- production
```

脚本会把域名写入生成的 `routes`。验证证书和 DNS 状态后再把下游变量切换为：

```env
GATEWAY_URL=https://api.example.com
GATEWAY_MASTER_URL=https://admin.example.com
```

Admin 必须通过 HTTPS 对公网提供；还可按需通过 Cloudflare Access 增加一层访问控制。

---

## 12. 后续升级

升级前先备份重要配置并阅读 Changelog：

```bash
git pull --ff-only
npm ci
```

有新 D1 migration 时：

```bash
npm run deploy:cloudflare -- production --migrate
```

没有数据库变更时：

```bash
npm run deploy:cloudflare -- production
```

也可只部署一侧：

```bash
npm run deploy:cloudflare -- production --proxy-only
npm run deploy:cloudflare -- production --admin-only
```

推荐顺序是**先迁移，后部署依赖新 schema 的 Worker**。D1 migration 不会因为 Worker 重新部署而自动执行。

---

## 13. 远程部署后回到本地开发

远程 deploy 会让生成的 `wrangler.jsonc` 暂时包含远程 `database_id`。继续本地 D1 开发前，在没有导出 `D1_DATABASE_ID` 的 shell 中执行：

```bash
npm run gen:wrangler
```

然后再运行：

```bash
npm run db:migrate
npm run dev:proxy
npm run dev:admin
```

否则本地 migrate 与本地 Worker 可能落到两个不同的 SQLite identity。详见 [local-development.md](../../developers/local-development.md)。

---

## 14. 常见问题

### `Not logged in` 或 token expired

```bash
npx wrangler login
npx wrangler whoami
```

无浏览器的 CI 应使用权限最小化的 `CLOUDFLARE_API_TOKEN`，不要复制个人 OAuth 配置。

### Admin 部署报 `10027` / exceeded size limit

先检查依赖是否与锁文件一致：

```bash
npm ci
npm ls @opennextjs/cloudflare next wrangler --depth=0
```

再执行：

```bash
npm run deploy:cloudflare -- production --admin-only
```

当前仓库要求 `@opennextjs/cloudflare` 1.19.4。不要使用陈旧 `node_modules` 构建；同时检查输出中的 gzip 是否低于账号套餐限制。

### `/api/admin/health` 返回 404

这是不存在的路径，不代表 Admin 故障。使用：

- Admin 首页；
- `/api/auth/login`；
- 登录后的 Config 页面；
- 带有效 `MASTER_KEY` 的 `/api/admin/business-timezone`。

### `/catalog/models` 返回空数组

部署是正常的。请检查 Model、Provider、Provider API Key、Route 是否都已创建并启用，且 Route group 配置正确。

### Admin 登录 401

`ADMIN_PASSWORD` 与 `MASTER_KEY` 不同。重设网页登录密码：

```bash
npx wrangler secret put ADMIN_PASSWORD --name <admin-worker-name>
```

然后重新登录。

### 自定义域名部署失败

先去掉 `PROXY_CUSTOM_DOMAIN` / `ADMIN_CUSTOM_DOMAIN`，用 `workers.dev` 验证。确认 zone 在同一账号、DNS 和证书可用后再绑定。

### bootstrap 中断后重试

脚本会按 D1 名复用已创建的数据库。若实例 env 已经存在：

```bash
npm run deploy:cloudflare -- production --migrate
```

如需重新执行 bootstrap，请先确认实例文件和资源名，不要盲目覆盖生产配置。

---

## 15. 不再需要测试实例时

先确认 Worker 名和 D1 名，再依次删除两个 Worker，最后删除 D1：

```bash
npx wrangler delete <prefix>-proxy
npx wrangler delete <prefix>-admin
npx wrangler d1 delete <prefix>
```

删除 D1 会永久删除网关配置、用户、Key、日志和计费数据。生产实例应先完成备份，不要把示例清理命令直接复制到未确认的环境。

---

## 下一步

- [Cloudflare 深入运维](./cloudflare.md)
- [部署方式索引](./README.md)
- [用户配置说明](../../users/configuration.md)
- [开发者集成](../../developers/integration.md)
- [Admin API](../../developers/api/admin.md)
