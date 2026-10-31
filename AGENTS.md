# AGENTS.md

本文件给各类 coding agent。人类开发者读 [README.md](README.md) 和 [docs/README.md](docs/README.md)。

Octafuse Gateway 是 AI 网关：`packages/proxy` 是代理服务，`packages/admin` 是管理后台，共享 `@octafuse/core`。SoloEnt 国际区与中国区当前部署都是 **Docker + Postgres**（区内代理服务与管理后台共用本区库）。Cloudflare / D1 仍是本仓库支持的其他运行后端。

## 命令

在仓库根执行：

```bash
npm install
cp .env.example .env
npm run dev:proxy:node          # 代理服务 :8787
npm run dev:admin:node          # 管理后台 :8789
npm run db:migrate:pg           # 按目标环境应用 Postgres 迁移
npm run test:gateway:postgres-smoke
```

本地 D1 预览仍可用 `npm run dev:proxy` / `npm run dev:admin`。Docker 见 `docker/compose/node-pg.yml` 与 [docs/operators/deployment/docker.md](docs/operators/deployment/docker.md)。

## 改完要检查

- 改了 `packages/admin`、`packages/core`、`packages/proxy`、`Dockerfile*` 或 `docker/**`，完成前在仓库根运行 `npm run typecheck:admin`。`verify` 不包含这次检查，不要用完整 Docker 冒烟代替。
- 平时不要新增 `.changeset/*.md`。用户可见变更写根目录 `CHANGELOG.md` 开头的 `## Unreleased`。只有明确做发版准备时，才根据 Unreleased 生成 changeset，并从 `CHANGELOG.md` 删掉 Unreleased。
- 改中文用户文档时遵守 [.cursor/rules/chinese-documentation-terminology.mdc](.cursor/rules/chinese-documentation-terminology.mdc)：正文用中文，英文 UI 名在首次出现时括注，配置 ID、API 路径、字段名保持代码格式。
- 管理后台的目录、命令、国际化和 Docker 构建陷阱见 [packages/admin/AGENTS.md](packages/admin/AGENTS.md)。

## 边界

- 不要提交 `.env`、密钥或生产主密钥。
- 门户私有的 key 分类（例如 `metadata.soloent_kind`）由门户写入和解释。不要写进 Gateway 文档，也不要让代理服务解释这些键。
- 历史发布说明、迁移 runbook、`CHANGELOG.md` 里的旧事实不要改写成当前版本的语义。
