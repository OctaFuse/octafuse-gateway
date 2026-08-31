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
| 接入订阅额度、永久加额与用户审计 | [Admin Users API](./api/admin.md)；[用户与密钥数据模型](./architecture/user-keys-data-model.md) |
| 新增协议适配器或理解百炼图片转换 | [适配器与驱动](./architecture/adapters-and-drivers.md)；[DashScope 生图](./architecture/dashscope-image.md) |
| 读取模型目录的峰谷价格与后续时段 | [用户模型接口](./api/user.md)；[时间与时区](./reference/time-and-timezone.md) |
| 调试 Node / Docker 下的实时 ASR | [DashScope 音频](./architecture/dashscope-audio.md)；[本地开发](./local-development.md) |
| 启动本地 D1、Node + Postgres 或 Node + MySQL 开发环境 | [local-development.md](./local-development.md) |
| 理解运行时、数据库和请求生命周期 | [architecture/](./architecture/)；2.0 路由模型见 [route-topology.md](./architecture/route-topology.md)；适配器与驱动见 [adapters-and-drivers.md](./architecture/adapters-and-drivers.md) |
| 查计费、审计、时间、Provider 参数、路由策略、文生图 / 语音转写等行为语义 | [reference/](./reference/)（含 [route-strategies.md](./reference/route-strategies.md)、[image-models.md](./reference/image-models.md)）；Audio 见 [api/user.md「语音转写」](./api/user.md#语音转写audio-transcriptions) |

## 代码边界

| 包 | 职责 |
|----|------|
| `packages/proxy` | 用户推理入口，提供 `/v1/*`、`/v1beta/*`、`/catalog/*`、`/health`。 |
| `packages/admin` | 管理 UI 与 `/api/admin/*`。Proxy 不提供管理接口。 |
| `packages/tool-engines` | Tools 上游引擎客户端（web-search / web-fetch / web-deep-search / ai-detection）；**source-only**，供 Proxy 与 Admin Playground 共用。 |
| `packages/core` | D1 / Postgres / MySQL 仓储、迁移 CLI、共享类型与领域逻辑。 |

贡献前也请阅读仓库根的 [CONTRIBUTING.md](../../CONTRIBUTING.md)、[SECURITY.md](../../SECURITY.md) 和 [docs/CONVENTIONS.md](../CONVENTIONS.md)。
