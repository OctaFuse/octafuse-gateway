# Octafuse Gateway 文档

这套文档按读者任务组织。先选择自己的角色，再进入对应目录。

## 读者入口

| 你是谁 | 入口 | 主要内容 |
|--------|------|----------|
| 使用者 / 管理员 | [users/](./users/) | 快速部署、功能地图、Admin 配置、客户端接入 |
| 开发者 / 集成方 | [developers/](./developers/) | API 契约、系统集成、本地开发、架构与行为语义 |
| 部署 / 运维者 | [operators/](./operators/) | Cloudflare、Docker、Zeabur、数据库迁移与切换 |
| 项目维护者 | [maintainers/](./maintainers/) | 发版、Changesets、镜像发布、文档规范 |

## 推荐路径

| 目标 | 从这里开始 |
|------|------------|
| 先跑起来并完成一次调用（本地 D1 → Cloudflare 上云） | [users/quickstart.md](./users/quickstart.md) |
| 理解 Gateway 能力和核心概念 | [users/features.md](./users/features.md) |
| 部署后在 Admin 里配置 Provider、Route、用户 Key | [users/configuration.md](./users/configuration.md) |
| 把已有 AI 客户端接到 Gateway | [users/connect-clients.md](./users/connect-clients.md) |
| 用 Gateway 接入自己的门户、后台或 SaaS | [developers/integration.md](./developers/integration.md) |
| 查 Proxy / Admin API | [developers/api/README.md](./developers/api/README.md) |
| 本地二开或贡献代码 | [developers/local-development.md](./developers/local-development.md) |
| 部署到生产环境 | [operators/deployment/README.md](./operators/deployment/) |
| Cloudflare 外部一键上云 | [operators/deployment/cloudflare-quickstart.md](./operators/deployment/cloudflare-quickstart.md) |

## Canonical 文档（改一处即可）

| 主题 | 权威文档 |
|------|----------|
| 运行时 × 数据库矩阵 | [developers/architecture/runtime-data.md](./developers/architecture/runtime-data.md) |
| 使用者最短路径 | [users/quickstart.md](./users/quickstart.md) |
| CF 首次上云 | [operators/deployment/cloudflare-quickstart.md](./operators/deployment/cloudflare-quickstart.md) |
| CF 运维 / Workers Builds | [operators/deployment/cloudflare.md](./operators/deployment/cloudflare.md) |
| Docker / PG / MySQL 自托管 | [operators/deployment/docker.md](./operators/deployment/docker.md) |
| 下游集成 env | [developers/integration.md](./developers/integration.md) |
| 文生图模型（gpt-image-2 / Seedream） | [developers/reference/image-models.md](./developers/reference/image-models.md) |
| 文档规范 | [CONVENTIONS.md](./CONVENTIONS.md) |

## 文档规范

- 文档边界、敏感信息和占位符规则见 [CONVENTIONS.md](./CONVENTIONS.md)。
- 官网仓库 `octafuse-website` 负责展示与轻量摘要；技术参考入口由官网的 `sync/contract.json` 从本仓白名单生成。
- 示例 HTTP 请求集中放在 [examples/](../examples/)；文档中只保留最小必要片段。
- 截图等静态资源放在 [assets/](./assets/)。
