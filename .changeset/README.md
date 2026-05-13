# Changesets

本仓库用 [**Changesets**](https://github.com/changesets/changesets) 做 **fixed 单版本线**：根包 `octafuse` 与 `@octafuse/core` / `@octafuse/proxy` / `@octafuse/admin` **共用同一 `version`**，与 Git 标签 **`vX.Y.Z`** 及 GHCR 镜像 tag 对齐。

根目录 **`package.json`** 的 **`workspaces`** 含 **`"."`**，以便 Changesets / manypkg 将根包与其它 workspace **一并**纳入 fixed 组（勿删，否则 `octafuse` 不会出现在 Changesets 包列表中）。

## 日常开发

在包含用户可见变更的 PR 里（或合并前本地）添加一条 changeset：

```bash
npx changeset
```

按提示选择 **major / minor / patch**，并写一句摘要。会生成 `.changeset/<随机名>.md`，随 PR 提交即可。

## 发版流程（自动化）

1. 合并带 `.changeset/*.md` 的 PR 到 **`main`** 后，GitHub Action **[Release](../.github/workflows/release.yml)** 会打开 **「Version Packages」** PR（更新 `package.json` 版本、`CHANGELOG.md`、并删除已消费的 changeset 文件）。
2. **审核并合并**该 Version PR。
3. 再次触发 Release workflow：执行 **`npx changeset tag`**，推送 **`vX.Y.Z`** Git 标签。
4. 标签推送触发 **[Octafuse Docker Images](../.github/workflows/octafuse-docker-images.yml)**：构建并推送 **proxy / admin / migrate** 镜像，并创建/更新 **GitHub Release**（正文中附带各镜像 **digest**）。

应急或调试仍可使用 workflow 的 **`workflow_dispatch`** 手动构建（不替代上述正式发版）。

更多说明见 **[docs/ops/release-versioning.md](../docs/ops/release-versioning.md)**。
