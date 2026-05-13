# 手工 SQL

本目录用于放置已部署环境需要手工执行的数据库变更 SQL，例如线上定价字段调整、数据回填、一次性修复与回退脚本。

## 迁移策略

- `packages/core/migrations-d1/`、`packages/core/migrations-postgres/`、`packages/core/migrations-mysql/` 作为新安装环境的最终基线维护。
- 后续变更不再在 core 模块下追加新的迁移文件，而是把现有基线 SQL 修改到最终结果。
- 需要对已部署环境执行的变更，放在本目录并随变更提交。
- 每次涉及库表或数据变更时，同时提供 D1 与 Postgres 版本；MySQL 如不支持或暂不覆盖，需要在变更说明中明确。

## 文件约定

- 新增脚本按执行顺序编号，并在文件名中标明数据库类型，例如 `01-d1-add-budget-column.sql`、`01-postgres-add-budget-column.sql`。
- 脚本头部写清楚目标库、执行前提、是否可重复执行、回滚方式和执行后的自检 SQL。
- 生产执行前先备份或确认可回滚；执行命令建议写在脚本注释或对应变更说明中。
- 脚本执行并验证完成后，可以删除临时 `.sql` 文件；如果仍需要保留背景，沉淀为正式文档或变更记录。

## 执行示例

```bash
npx wrangler d1 execute octafuse-gateway --remote --file=docs/manual-sql/NN-d1-description.sql
```

本地 D1 验证可按需追加 `--local --persist-to .wrangler/state`。
