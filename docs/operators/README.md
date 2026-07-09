# 部署与运维文档

这里面向负责把 Gateway 跑在生产环境、升级、迁移、排障和维护运行时的人。

## 部署

| 场景 | 文档 |
|------|------|
| 部署模式总览 | [deployment/README.md](./deployment/) |
| Cloudflare Worker + Admin + D1 | [deployment/cloudflare.md](./deployment/cloudflare.md) |
| Docker / 自托管 / Postgres / MySQL | [deployment/docker.md](./deployment/docker.md) |
| Zeabur 容器平台 | [deployment/zeabur.md](./deployment/zeabur.md) |

## 迁移与切换

| 场景 | 文档 |
|------|------|
| D1 与 Postgres 之间 ETL、对账和切换 | [migrations/d1-postgres-cutover.md](./migrations/d1-postgres-cutover.md) |
| User audit 兼容导出移除说明 | [migrations/user-audit-legacy-exports.md](./migrations/user-audit-legacy-exports.md) |

## 本地演练

本地 D1、Node + Postgres、Node + MySQL 的组合启动方式放在开发者文档中：[developers/local-development.md](../developers/local-development.md)。

发布版本、Changesets 和 GHCR 镜像发布见 [maintainers/release-versioning.md](../maintainers/release-versioning.md)。
