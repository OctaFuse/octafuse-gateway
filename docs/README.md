# Octafuse Gateway 文档

这套文档按读者任务组织，而不是按文件类型堆放。先选择自己的角色，再进入对应目录。

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
| 先跑起来并完成一次调用 | [users/quickstart.md](./users/quickstart.md) |
| 理解 Gateway 能力和核心概念 | [users/features.md](./users/features.md) |
| 部署后在 Admin 里配置 Provider、Route、用户 Key | [users/configuration.md](./users/configuration.md) |
| 把已有 AI 客户端接到 Gateway | [users/connect-clients.md](./users/connect-clients.md) |
| 用 Gateway 接入自己的门户、后台或 SaaS | [developers/integration.md](./developers/integration.md) |
| 查 Proxy / Admin API | [developers/api/README.md](./developers/api/README.md) |
| 本地二开或贡献代码 | [developers/local-development.md](./developers/local-development.md) |
| 部署到生产环境 | [operators/deployment/README.md](./operators/deployment/) |

## 内容取舍

这次重构保留了现有文档里与代码强绑定的部分：API、架构、运行时矩阵、审计、计费、时间语义和部署细节。这些内容仍然有价值，只是移动到了更适合的读者路径下。

面向纯使用者的内容此前不足，所以新增了 `users/` 下的快速开始、功能地图、配置流程和客户端接入指南。它们故意不展开代码实现，目标是让使用者能完成部署、配置和日常排障。

## 文档规范

- 文档边界、敏感信息和占位符规则见 [CONVENTIONS.md](./CONVENTIONS.md)。
- 示例 HTTP 请求集中放在 [examples/](../examples/)；文档中只保留最小必要片段。
- 截图等静态资源放在 [assets/](./assets/)。
