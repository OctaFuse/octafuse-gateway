# 0031：介绍改为静态目录，库内列改为备注

三库脚本：`packages/core/migrations-{d1,postgres,mysql}/0031_catalog_notes.sql`。

## 变更

- `models.description`、`providers.description` 改名为 `note`。已有内容保留，作为运营手写备注。
- 目录介绍不再写入这两列。管理后台按界面语言只读展示静态目录里的介绍。
- `GET /v1/models` 与 `GET /catalog/models` 不再返回 `description`，也不返回 `note`。

## 步骤

1. 备份后对目标库执行对应 `0031_catalog_notes.sql`（或官方 migrate）。
2. 再滚动更新 Proxy 与 Admin。先更新应用、后改列名时，读写 `note` 会失败。

## 回滚

回退 Proxy / Admin 之前，把 `models.note`、`providers.note` 改回 `description`。旧版本仍读取 `description`，列名不改回去会读不到原内容。
