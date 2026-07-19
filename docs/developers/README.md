# 开发者文档

这里面向三类人：

- 想把 Gateway 接入自己门户、后台、SaaS 或自动化系统的集成开发者。
- 想基于本仓做二次开发的开发者。
- 想给 Octafuse Gateway 提交开源贡献的贡献者。

## 路线

| 任务 | 文档 |
|------|------|
| 用管理 API 接入自己的系统 | [integration.md](./integration.md) |
| 查 Proxy / Admin API 契约 | [api/README.md](./api/) |
| 启动本地 D1、Node + Postgres 或 Node + MySQL 开发环境 | [local-development.md](./local-development.md) |
| 理解运行时、数据库和请求生命周期 | [architecture/](./architecture/) |
| 查计费、审计、时间、Provider 参数、文生图模型等行为语义 | [reference/](./reference/)（含 [image-models.md](./reference/image-models.md)） |

## 代码边界

| 包 | 职责 |
|----|------|
| `packages/proxy` | 用户推理入口，提供 `/v1/*`、`/v1beta/*`、`/catalog/*`、`/health`。 |
| `packages/admin` | 管理 UI 与 `/api/admin/*`。Proxy 不提供管理接口。 |
| `packages/core` | D1 / Postgres / MySQL 仓储、迁移 CLI、共享类型与领域逻辑。 |

贡献前也请阅读仓库根的 [CONTRIBUTING.md](../../CONTRIBUTING.md)、[SECURITY.md](../../SECURITY.md) 和 [docs/CONVENTIONS.md](../CONVENTIONS.md)。
