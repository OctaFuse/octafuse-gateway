# 文档边界与敏感信息规范（Octafuse Gateway）

本文是仓库内**文档分层**与**示例脱敏**的单一参考。所有 PR 在改动 `README*.md`、`docs/**`、`examples/**`、`docker/**` 中的文档/示例时，应以本文为准。

> 目标：官网品牌与面向读者的聚合内容由独立仓库 `octafuse-website` 承载；本仓继续聚焦与代码/迁移/API 强绑定的契约文档，并在此识别可外移的 L3 内容边界；同时杜绝把任何运行环境的真实密钥、Webhook、连接串写进 Git。

## 1. 文档分层规则

仓内文档按“与代码耦合度 / 可外移性”分为三层。新增或迁移文档时请显式归类。

### L1 · 与版本/迁移/API 契约强绑定（**必须**留在本仓）

修改后会影响代码或迁移行为，必须与代码同 PR 演进、同版本发布。

| 类别 | 当前位置 |
|------|----------|
| API 契约（公开 / 用户 / 管理） | [`docs/api/`](./api/) |
| 运行时 × 数据库矩阵、分层约束 | [`docs/architecture/`](./architecture/) |
| 行为与计费/审计语义 | [`docs/reference/`](./reference/) |
| 仓内规范本身 | 本文（`docs/CONVENTIONS.md`）、[`CONTRIBUTING.md`](../CONTRIBUTING.md)、[`SECURITY.md`](../SECURITY.md) |
| 与当前 API 表面绑定的最小可执行示例 | [`examples/`](../examples/) |
| 迁移目录与 CLI | `packages/core/migrations-d1/`、`migrations-postgres/`、`migrations-mysql/` |

> 判定提示：如果一段说明在代码或迁移变更后就会过时，那它属于 L1，必须随代码一起演进，**禁止**外移。

### L2 · 通用运维/部署（暂留本仓，未来可外移）

不绑定特定环境，但与具体运行平台、镜像与密钥管理相关。可逐步抽出。

| 类别 | 当前位置 |
|------|----------|
| 部署索引、Cloudflare、Docker、本地测试 | [`docs/ops/`](./ops/) |
| Compose 编排与 Nginx 模板 | [`docker/compose/`](../docker/compose/)、[`docker/examples/`](../docker/examples/) |
| 宿主机环境文件目录约定 | [`docker/deploy/`](../docker/deploy/) |
| 发版与 Changesets 流程 | [`docs/ops/release-versioning.md`](./ops/release-versioning.md)、[`.changeset/`](../.changeset/) |

> 判定提示：内容**通用**且适用于任何采用本仓的部署者，留在本仓；若是**特定客户/区域/品牌**的 runbook，归入 L3。

### L3 · 品牌叙事 / 客户化 / 区域专属（不入本仓）

不放入本仓；适合放到独立的 `octafuse-website` 站点或外部 wiki。本仓内只保留入口或最小说明，避免污染开源仓。

| 类别 | 处置 |
|------|------|
| 品牌/营销文案、官网长文 | 不入本仓 |
| 假设某个具体下游门户/账号系统的端到端集成手册 | 本仓只描述 **`/api/admin/*` 契约**与**最小调用示例**；具体集成方流程放外部 |
| 区域专属（特定国家/网络条件/合规要求）的运维手册 | 本仓 L2 文档仅以**通用模式**呈现；区域差异放外部 |
| 运营 SOP、客服话术、内部账号/凭证清单 | 不入本仓 |

> 判定提示：如果删掉这段文档不影响开源用户独立理解和运行 Gateway，且涉及具体公司/产品/区域的细节，归入 L3。
>
> **沿革**：仓内此前散落的 `your-portal` / `your-platform-admin` 占位与"国内/境内/中国境内"地域叙事，已在 2026-05 整体中性化为"外部集成方"与"任意私有 OCI registry"等通用术语，迁出条目从此清单中移除；如需历史细节，可查询 git 历史。

### 现状速查

下表是当前仓内主要文档的归类，便于审稿对照：

| 文档 / 目录 | 层级 | 备注 |
|-------------|------|------|
| `docs/api/{public,user,admin,README}.md` | L1 | 跟随路由与表结构演进 |
| `docs/architecture/{runtime-data,admin-layered}.md` | L1 | 与 `packages/core` / 部署矩阵强相关 |
| `docs/reference/{streaming-billing,user-audit-logs,provider-thinking-configs,provider-import-presets}.md` | L1 | 行为与计费语义快照 |
| `docs/ops/deployment.md` 索引 | L2 | 入口文档 |
| `docs/ops/deployment-cloudflare.md` | L2 | 通用 CF 部署模式 |
| `docs/ops/deployment-docker.md` | L2 | 通用 Docker 部署模式 |
| `docs/ops/local-testing-environments.md` | L2 | 本地组合矩阵 |
| `docs/ops/release-versioning.md` | L2 | Changesets 流程 |
| `docs/ops/postgres-cutover.md` | L2 | D1↔PG 通用脚本 |
| `examples/` | L1 | 与当前 `/v1/*`、`/api/admin/*` 表面一致 |
| `docker/examples/*.example` 与 `docker/deploy/.env.example` | L2 | 占位模板，**不**含真实值 |
| README 中的“品牌段落 / 推广链接” | L3（候选） | 后续可拆到独立站 |

## 2. 敏感信息规范

仓内**任何**已纳入版本控制的文件（Markdown、YAML、JSON、Dockerfile、脚本注释）都必须满足以下规则。CI 与 PR 审查应据此驳回。

### 2.1 一律使用占位符

下表是**允许**的占位符；其它环境特定值都视为需要替换。

| 用途 | 推荐占位符 |
|------|------------|
| 用户 API Key（`sk-…`） | `sk-your-api-key`、`sk-xxx`、`sk-xxx...` |
| 管理 Master Key（运行时） | `<MASTER_KEY>` 或文档中明确标注的**开发种子** `sk-dev-admin-key`（见下方 §2.3） |
| 控制台密码 | `change-me`、`replace-me`、`changeme`（任选其一，跨文件保持一致） |
| Postgres / MySQL 用户名 | `gateway_user`、`postgres`、`octafuse`（仅限本机/容器内默认用户；勿写真实生产用户名） |
| Postgres / MySQL 密码 | `change-me`（与控制台密码区分）；compose 内置库可用 `postgres` / `octafuse` 等本机默认值 |
| 数据库主机 | `db.example.com`、`127.0.0.1`、`postgres`（容器服务名） |
| Proxy / Admin 公网域名 | `gateway.example.com`、`gateway-admin.example.com`（多环境/多部署可加后缀，如 `gateway-staging.example.com`） |
| 镜像仓库命名空间 | `your-org`、`your-repo`、`example-org`、`<owner>`、`<repo>` |
| Cloudflare D1 ID | Build variables 或 `cloudflare-worker/*.env`（勿提交生产 UUID）；示例见 `cloudflare-worker/example.env` |
| 邮箱 | `user@example.com`、`admin@example.com` |
| Webhook URL（企微/飞书/Slack/钉钉） | 仅以**文字描述**给出形态；**禁止**贴出含 `key=` / `hook id` 的真实 URL，必要时使用 `https://qyapi.weixin.qq.com/cgi-bin/webhook/send?key=…`、`https://open.feishu.cn/open-apis/bot/v2/hook/…` 这种**已截断带省略号**的占位 |
| 第三方上游 API Key（OpenAI/Anthropic/Gemini/智谱…） | 不出现在文档中；如需说明，写 `<PROVIDER_API_KEY>` |
| 用户名/手机号/真实姓名/工号 | 一律不出现；使用 `user-123`、`u-001` 之类合成 ID |

### 2.2 一律禁止

无论文档为 L1/L2/L3，以下值**禁止**进入 Git：

- 任何环境的真实 `MASTER_KEY` / `ADMIN_PASSWORD` / `GATEWAY_MASTER_KEY`。
- 任何上游模型供应商的真实 API Key、组织 ID、项目 ID。
- 任何完整可用的 Webhook URL（含 `key=` 查询参数或 `hook id` 路径段）。
- 任何指向真实环境的连接串：含真实主机名 / VPC 内网地址 / 真实库名 / 真实用户密码的组合。
- 任何 GitHub PAT、GHCR / 私有镜像仓库 token、Cloudflare API Token、第三方云密钥。
- 真实客户邮箱、手机号、内部员工身份。

如发现历史提交中已包含上述任一信息，按 [`SECURITY.md`](../SECURITY.md) 走 GitHub Security Advisories 报告，并在轮换密钥后再考虑历史改写策略。

### 2.3 关于 `sk-dev-admin-key`

`sk-dev-admin-key` 是本仓三套迁移种子（`packages/core/migrations-{d1,postgres,mysql}/0002_seed.sql`）写入 `system_config.MASTER_KEY` 的**开发缺省值**，仅用于：

- 仓内文档/示例中演示本机或 Docker quickstart 的最小可运行 `curl`；
- `scripts/smoke/` 与本地联调；
- 各 `docker/compose/*.yml` 内本地 Postgres / MySQL 容器默认环境。

**生产环境必须**在 Admin 的 Config 页面或直连 SQL 中将 `MASTER_KEY` 改为强随机值，并同步更新调用方 `GATEWAY_MASTER_KEY`。任何文档示例中出现 `sk-dev-admin-key` 都应附近期内已存在的“生产请轮换”提示（参见 [`docs/api/admin.md`](./api/admin.md) §认证）。

### 2.4 命令片段约定

- 演示登录注册私有 registry 时，用 `--password-stdin` + 环境变量（如 `printf '%s' "$GHCR_TOKEN" | docker login …`），**禁止**把 token 写在命令行字面里。
- `curl` / `wrangler` / `psql` 示例中需要 token / Bearer 时，使用 `<MASTER_KEY>` 或 `sk-xxx`，必要时配合一句“由 `system_config.MASTER_KEY` 决定”的引导。
- 不在示例 SQL 中写真实业务数据；演示 INSERT 时使用 `user-123` / `user@example.com` 等。

## 3. 评审清单（Docs PR Reviewer Checklist）

在 review 涉及 `README*.md`、`docs/**`、`examples/**`、`docker/**` 的 PR 时逐条核对：

- [ ] 改动是否归入 L1 / L2 / L3？是否与代码 / 迁移版本一致？
- [ ] 是否引入了未列入 §2.1 的新型占位符？若有，更新本文 §2.1 表后再合并。
- [ ] 是否出现 §2.2 列出的任一禁止值？若有，**Block** 并要求轮换 + 重写历史。
- [ ] 是否扩散了品牌/客户化叙述（L3）到 L1/L2 文档中？若有，建议下沉到独立站或本文 L3 候选清单。
- [ ] 新增示例是否可独立复现（不依赖未公开的脚本/数据）？
- [ ] 与 [`README.md`](../README.md)、[`README.zh-CN.md`](../README.zh-CN.md)、[`docs/README.md`](./README.md) 的入口与索引是否仍然一致？

## 4. 后续演进

- 当 L3 候选项足够多、或开始有外部撰稿/翻译协作时，将相关内容沉淀到独立 `octafuse-website` 仓库；本文表格即为迁移清单初稿。
- 当某条新规则在多次 PR 中被反复提示，应反向沉淀进 §2.1 / §2.2，使审查可机械化。
- 与 SECURITY 流程的关系：本文管“**写进 Git 之前**的预防”；[`SECURITY.md`](../SECURITY.md) 管“**事后**的漏洞与泄露报告”，二者互补，请勿混用。
