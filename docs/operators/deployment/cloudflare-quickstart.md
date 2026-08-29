# 从零部署 Octafuse Gateway 到 Cloudflare Workers

本文面向第一次接触 Octafuse Gateway 的部署者，从一个 Cloudflare 账号开始，完成以下完整链路：

1. 获取并确认最新版代码；
2. 创建共享 D1 数据库；
3. 部署代理服务（Proxy）Worker 和管理后台（Admin）Worker；
4. 设置管理后台登录密码；
5. 验证 Worker、登录和 D1；
6. 配置供应商（Provider）、模型（Model）、路由（Routes）和用户 API Key；
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
    │  browser Session / named Admin API Key
Operator
```

代理服务和管理后台是两个独立 Worker，但 D1 绑定名都为 `DB`，且必须指向同一个数据库。

## 版本基线

当前仓库版本为 **Octafuse Gateway 2.8.0**，D1 迁移共 **27 个**（截至 `0027_user_wallet_credit.sql`）。跨版本升级必须按编号应用全部未执行迁移；从 1.11.x 升级先阅读 [2.0 升级指南](../migrations/single-provider-key-cutover.md)，后续版本的迁移顺序见[迁移与切换索引](../README.md#迁移与切换)。升级到 2.8.0 必须应用 0027，并遵循“先部署同版本 Proxy / Admin、再迁移、最后切换门户加额接口”的顺序。

下列构建体积来自 2026-07-24 对 `1.10.2` 的历史实测，仅用于量级参考；当前部署应以本次终端输出为准：

| 组件 | 实测版本 / 结果 |
|------|-----------------|
| Node.js | 22.15.0（项目要求 20+） |
| Wrangler | 4.107.0 |
| Next.js | 16.2.3 |
| `@opennextjs/cloudflare` | 1.19.4 |
| 代理服务 gzip | 194.31 KiB |
| 管理后台 gzip | 2925.55 KiB |
| 当时 D1 migrations | 13 个全部成功（2.8.0 当前为 27 个） |

Cloudflare Workers Free 的单 Worker gzip 上限为 3 MiB；管理后台实测低于该上限，但余量不大。部署时应检查自己终端中的 `Total Upload ... gzip`，不要只依赖本文的历史数值。限制以 [Cloudflare Workers Limits](https://developers.cloudflare.com/workers/platform/limits/#worker-size) 为准。若免费额度余量吃紧或流量上来，也推荐升级 [Workers Paid](https://developers.cloudflare.com/workers/platform/pricing/)（约 $5/月）——量大管饱，性价比极高。

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

引导脚本（bootstrap）有两个容易混淆的名字：

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

## 5. 首次引导脚本

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

密码会通过 Wrangler 写入管理后台 Worker Secret，不会写入实例 `.env`。

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

`--yes` 只接受引导脚本的默认选择；如果当前终端有 TTY，Wrangler 在执行远程 D1 migration 前仍会要求明确确认。这是刻意保留的安全检查，因为同名 D1 可能是已有实例。真正没有 TTY 的 CI 环境会由 Wrangler 按非交互模式处理。

若同时省略 `--admin-password-env`，脚本会为了避免把默认弱密码写入生产而跳过 Secret 设置；此时必须手动执行：

```bash
npx wrangler secret put ADMIN_PASSWORD --name my-octafuse-prod-admin
```

### 引导脚本实际执行了什么

脚本依次：

1. `wrangler whoami` 检查登录；
2. 按 D1 名查找已有数据库，没有则创建；
3. 写入被 `.gitignore` 排除的 `cloudflare-worker/<instance>.env`；
4. 生成三个 `wrangler*.jsonc`；
5. 请求确认后，对远程 D1 应用全部迁移；
6. 部署代理服务 Worker；
7. 构建并部署管理后台 Worker；
8. 写入 `ADMIN_PASSWORD` Secret；
9. 打印 Worker 名和后续操作提示。

首次管理后台构建通常比代理服务慢。只要命令仍在输出 Next.js / OpenNext / asset upload 进度，就让它继续运行。

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

普通引导脚本不会输出集成密钥。网页登录密码只用于建立数据库 Session；外部系统使用的具名集成密钥请在后台 **系统集成 → 集成密钥（Integration Keys）** 创建。

---

## 7. 验证部署

先设置刚才复制的地址：

```bash
export GATEWAY_URL='https://<proxy-worker>.<account-subdomain>.workers.dev'
export GATEWAY_MASTER_URL='https://<admin-worker>.<account-subdomain>.workers.dev'
```

### 7.1 代理服务健康检查

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

新数据库尚未配置已启用路由时，下面的空数组是正常结果，不是部署失败：

```json
{"object":"list","data":[],"generated_at":"..."}
```

### 7.3 管理后台首页与登录

浏览器打开：

```text
https://<admin-worker>.<account-subdomain>.workers.dev
```

使用：

```text
Username: admin
Password: 引导脚本执行时设置的 ADMIN_PASSWORD
```

登录后能打开仪表盘（Dashboard），并进入 **系统 → 配置（System → Config）**，说明以下链路都已成立：

```text
Browser → Admin Worker → D1
```

管理后台当前**没有** `/api/admin/health`。不要用这个不存在的地址判断部署失败。需要脚本化检查时，可使用一个真实且安全的只读接口，例如：

```bash
curl -sS "$GATEWAY_MASTER_URL/api/admin/business-timezone" \
  -H "Authorization: Bearer <ADMIN_API_KEY>"
```

`<ADMIN_API_KEY>` 需在 **系统集成 → 集成密钥（Integration Keys）** 创建，并至少授予 `config.read`（该接口映射到配置读取权限）。有效 Key 应返回 HTTP 200。

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

管理后台登录密码、Admin API Key 与用户推理 Key 是三套凭据：

| 凭据 | 用途 | 存储位置 |
|------|------|----------|
| `ADMIN_PASSWORD` | 浏览器登录管理后台 | Cloudflare Worker Secret |
| 具名 Admin API Key | 按权限调用 `/api/admin/*` | D1 `admin_api_keys` |
| 用户 API Key | 调用代理服务 `/v1/*` | D1，管理后台创建 |

升级迁移会将历史 `MASTER_KEY` 复制为普通全权限 Key `legacy-master`，并删除 `system_config.MASTER_KEY`。部署后立即：

1. 打开管理后台；
2. 进入 **系统集成 → 集成密钥（Integration Keys）**；
3. 为每个外部系统创建独立、最小权限 Key；
4. 把新值安全地写入对应外部系统的服务端环境变量（可继续命名为 `GATEWAY_MASTER_KEY`）；
5. 确认外部系统切换完成后，轮换或吊销 `legacy-master`；
6. 不要把它放在浏览器前端代码、公开仓库或截图里。

可以在本机生成随机值：

```bash
openssl rand -hex 32
```

吊销后确认旧占位值失效：

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

### 9.1 添加供应商

管理后台 → **推理 → 供应商（Inference → Providers）**：

1. 点击 **导入（Import）**；
2. 选择你的上游，例如 OpenAI、Anthropic、Gemini、OpenRouter 或自建 OpenAI-compatible 服务；
3. 导入后打开该供应商；
4. 确认 endpoint；
5. 添加上游 API Key；
6. 保持供应商为 active。

上游 API Key 只用于 Gateway 访问供应商，不要把它发给下游用户。

### 9.2 添加模型

管理后台 → **推理 → 模型（Inference → Models）**：

1. 点击 **导入** 选择内置模型，或手动创建；
2. 确认模型 ID；
3. 检查输入 / 输出 modality；
4. 检查计价配置和币种；
5. 保存。

客户端请求体中的 `model` 最终使用这里的模型 ID。

### 9.3 创建路由

管理后台 → **推理 → 路由（Inference → Routes）**：

1. 为模型创建或选择请求入口（Request Surface），确定客户端协议与 operation，例如 `openai.chat`；
2. 让请求入口指向一个路由池（Route Pool）；路由池可单独设置 `hash_affinity`、`weighted_random`、`weight_priority` 或 `weighted_round_robin`；
3. 在路由池中添加上游目标（Upstream Target）；
4. 为上游目标选择供应商、填写供应商实际模型名和上游 operation；
5. 设置 `route_group`（例如 `default`）、`priority` 与 `weight`；
6. 确认上游目标和供应商均为 active。

同一路由池内先按 `priority` 从高到低分层，同层再按路由策略与 `weight` 排序；失败时自动切换下一个供应商，并按供应商维度熔断。跨供应商硬主备请使用不同 `priority`。完整概念见 [Route 拓扑](../../developers/architecture/route-topology.md)。

保存后再次查看：

```bash
curl -sS "$GATEWAY_URL/catalog/models"
```

已启用路由配置正确时，模型会出现在公开目录中。

### 9.4 配置智能体工具（Agent Tools，可选）

管理后台 → **智能体工具 → 工具配置（Tools → Configuration）**：

1. 分别为 Web Search、Web Fetch 或 Web Deep Search 配置引擎 API Key 与按次单价；
2. 每种工具选择一个 Active 引擎；
3. 保存后使用用户 API Key 调用 `/v1/tools/web-search`、`/v1/tools/web-fetch` 或 `/v1/tools/web-deep-search`。

各工具支持的供应商与请求字段见 [Admin 配置指南](../../users/configuration.md#4-配置-agent-tools可选)。

### 9.5 创建用户和用户 API Key

管理后台 → **用户 → 用户（User → Users）**：

1. 新建用户；
2. 按需要设置预算周期和额度；
3. 保存后为用户创建 API Key；
4. 立即复制返回的 `sk-...`。

完整 Key 通常只展示一次。下文把它记为：

```bash
export OCTAFUSE_API_KEY='sk-your-user-key'
```

不要用主密钥代替用户 Key 调用代理服务。

---

## 10. 发出第一条请求

### 10.1 查看当前用户可用模型

```bash
curl -sS "$GATEWAY_URL/v1/models" \
  -H "Authorization: Bearer $OCTAFUSE_API_KEY"
```

### 10.2 OpenAI-compatible Chat Completions

将 `your-model-id` 替换成管理后台中配置的模型 ID：

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

### 10.3 OpenAI Responses（可选）

如果该模型已经配置 `openai.responses` 请求入口与同协议上游：

```bash
curl -sS "$GATEWAY_URL/v1/responses" \
  -H "Authorization: Bearer $OCTAFUSE_API_KEY" \
  -H 'Content-Type: application/json' \
  -d '{
    "model": "your-model-id",
    "input": [{"role": "user", "content": "Say hello from Octafuse Responses."}],
    "stream": false
  }'
```

### 10.4 智能体工具（可选）

如果已在管理后台中为 Web Search 配置 Active 引擎：

```bash
curl -sS "$GATEWAY_URL/v1/tools/web-search" \
  -H "Authorization: Bearer $OCTAFUSE_API_KEY" \
  -H 'Content-Type: application/json' \
  -d '{"query":"Octafuse Gateway","count":5}'
```

如果返回上游响应，部署与配置已经从零到一完成。随后可在管理后台的 **请求日志（Request Logs）**、**分析（Analytics）** 和用户预算页面查看这次调用。

其它协议、Images、Audio 和 Tools 示例见：

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

管理后台必须通过 HTTPS 对公网提供；还可按需通过 Cloudflare Access 增加一层访问控制。

---

## 12. 后续升级

升级前先备份重要配置并阅读 Changelog：

```bash
git pull --ff-only
npm ci
```

若目标版本没有声明特殊上线顺序，有新 D1 migration 时：

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

默认顺序是**先迁移，后部署依赖新 schema 的 Worker**。D1 migration 不会因为 Worker 重新部署而自动执行；若目标版本的 Release 给出专用顺序，应以该版本说明为准。

> **升级到 v2.8.0**：0027 会把原有剩余额度回填到永久额度。先部署同为 v2.8.0 的 Proxy 与 Admin，再单独执行远程迁移，最后让门户改用 `POST /api/admin/users/:id/wallet/credit`。不要使用带 `--migrate` 的单条命令颠倒这一顺序。

```bash
npm run deploy:cloudflare -- production
npm run deploy:cloudflare -- production --migrate-only
```

迁移前建议先运行 [0027 只读审计脚本](../migrations/0027-user-wallet-credit-audit.d1.sql) 核对回填范围。迁移后检查用户的周期额度、永久额度以及请求日志中的 `charged_wallet_cost`。

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

### 管理后台部署报 `10027` / exceeded size limit

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

这是不存在的路径，不代表管理后台故障。使用：

- 管理后台首页；
- `/api/auth/login`；
- 登录后的配置页面；
- 带有效 Console Session，或具有 `config.read` 权限 Admin API Key 的 `/api/admin/business-timezone`。

### `/catalog/models` 返回空数组

部署是正常的。请检查模型、供应商、供应商 API Key、路由是否都已创建并启用，且路由组（Route group）配置正确。

### 管理后台登录 401

`ADMIN_PASSWORD` 仅用于网页登录，与 Admin API Key 不同。重设网页登录密码：

```bash
npx wrangler secret put ADMIN_PASSWORD --name <admin-worker-name>
```

然后重新登录。

### 自定义域名部署失败

先去掉 `PROXY_CUSTOM_DOMAIN` / `ADMIN_CUSTOM_DOMAIN`，用 `workers.dev` 验证。确认 zone 在同一账号、DNS 和证书可用后再绑定。

### 引导脚本中断后重试

脚本会按 D1 名复用已创建的数据库。若实例 env 已经存在：

```bash
npm run deploy:cloudflare -- production --migrate
```

如需重新执行引导脚本，请先确认实例文件和资源名，不要盲目覆盖生产配置。

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
