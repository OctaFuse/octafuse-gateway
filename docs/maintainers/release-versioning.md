# 版本治理与发版（长期维护）

本文约定 **Octafuse Gateway** 单仓（`octafuse` + `@octafuse/core` / `@octafuse/proxy` / `@octafuse/admin`）的版本线、Git 标签、镜像与 GitHub Release 的关系，便于长期运维与回滚。

## 核心原则

| 项目               | 约定                                                                                                                                                    |
| ------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **版本真源**       | Git 标签 **`vX.Y.Z`**（与 `package.json` 的 `version` 字段一致，无前导 `v`）                                                                            |
| **版本线**         | **Fixed 单线**：根包与三个 workspace **同一 semver**，不独立涨版本                                                                                      |
| **稳定分支**       | **`main`** 只接收当前稳定线的修复、准备正式发布的版本，以及不影响制品的维护变更；正式 tag 只从 `main` 产生                                              |
| **开发分支**       | 长期集成分支统一为 **`develop`**；功能与外部贡献 PR 默认合入该分支，发布后继续沿用，不按版本重建                                                        |
| **发布分支**       | 需要冻结和集中验收时，从 `develop` 创建临时 **`release/X.Y.Z`**；发布完成后删除                                                                         |
| **热修分支**       | 当前稳定版 patch 从 `main` 创建临时 **`hotfix/X.Y.Z`**，完成后先合入 `main` 发版，再同步到 `develop`                                                    |
| **对外制品**       | **proxy / admin / migrate** 三镜像 **同一 tag** 发布；生产可追溯 **digest**                                                                             |
| **变更记录**       | [Changesets](https://github.com/changesets/changesets) → 合并入根目录 **`CHANGELOG.md`**                                                                |
| **npm workspaces** | 根目录 `package.json` 含 **`"."`**，使 **`octafuse`** 与 **`packages/*`** 一并被工具识别，从而纳入 Changesets **fixed** 组（与 `@octafuse/*` 同版本）。 |

详细操作入口见仓库 **[`.changeset/README.md`](../../.changeset/README.md)**。

## 分支模型

假设当前稳定版为 `v2.3.0`，下一版本为 `2.4.0`：

```mermaid
flowchart LR
  TAG230["v2.3.0"] --> MAIN["main（当前稳定线）"]
  MAIN --> DEV["develop（长期集成）"]
  FEATURE["feature/* / contributor PR"] --> DEV
  DEV -->|"简单发布"| MAIN
  DEV --> RELEASE["release/2.4.0（按需）"]
  RELEASE -->|"发布 changesets + PR"| MAIN
  MAIN --> HOTFIX["hotfix/2.3.1"]
  HOTFIX -->|"patch changeset + PR"| MAIN
  MAIN -->|"同步稳定线修复"| DEV
  MAIN --> TAG240["v2.4.0"]
```

分支约定：

1. **`main` 是发版入口，不是日常集成分支。** Release workflow 只监听 `main`，因此 `main` 上的全部代码都会进入下一次 tag；不要把仅供某个环境试用、尚未准备公开发版的功能合入 `main`。
2. **`develop` 是唯一长期开发分支。** 功能分支保持短生命周期，通过 PR 合入 `develop`；外部贡献者也以 `develop` 为 base。`develop` 与 `main` 都应开启分支保护，禁止未经评审直接推送。
3. **简单发布可直接用 `develop` → `main` PR。** 如果需要冻结版本、继续接收下一周期功能，才从 `develop` 创建 `release/X.Y.Z`；发布分支只接受发布阻断修复、版本说明和 changesets，修复同时同步回 `develop`。
4. **当前稳定线热修使用 `hotfix/X.Y.Z`**，从 `main` 创建，添加 patch changeset 后 PR 回 `main`；正式发版完成后把实际修复同步到 `develop`。
5. **每次正式发布后把 `main` 同步回 `develop`**，使 Version Packages 产生的版本号和 changelog 进入开发线。优先使用 PR 或普通 merge，不改写共享分支历史。
6. **旧版本并行维护不在当前自动化范围内。** `main` 升到 `v2.4.0` 后，如仍需单独发布 `v2.3.x`，不能直接套用本文流程；需先增加维护分支发版 workflow，避免从 `main` 错误打旧版本 tag。

### 预发验证 / 非正式部署

需要在发版前把某一提交部署到预发或其它环境试用时，直接在 **Actions → Octafuse Docker Images → Run workflow** 选择 `develop` 或指定提交运行 `workflow_dispatch`，然后部署生成的 **commit SHA tag / digest**。该路径不创建 Git tag、GitHub Release，也不消费 changeset。

不要为了临时部署把开发分支合入 `main`。否则后续从 `main` 发布的 patch 会同时包含这些未正式发布的功能，`2.3.x` 与 `2.4.0` 的版本边界将失效。若只需试用部分提交，可从目标稳定提交创建短期部署分支并 cherry-pick，仍使用 SHA/digest 部署。

## 自动化流水线

```mermaid
flowchart LR
  subgraph dev [develop / release分支]
    PR[Feature_or_contributor_PR]
    READY[Release_ready_with_changesets]
  end
  subgraph mainline [main]
    M1[Merge_to_main]
    VPR[Version_Packages_PR]
    M2[Merge_Version_PR]
  end
  subgraph ship [发布]
    TAG[changeset_tag_pushes_vX_Y_Z]
    DOCKER[Docker_build_push_GHCR]
    REL[GitHub_Release_with_digests]
  end
  PR --> READY
  READY --> M1
  M1 --> VPR
  VPR --> M2
  M2 --> TAG
  TAG --> DOCKER
  DOCKER --> REL
```

**并发**：`octafuse-docker-images.yml` 已配置 `concurrency`（`group: octafuse-docker-images-${{ github.ref }}`，`cancel-in-progress: false`）。同一 ref（如同一 `v*` tag）的重复触发会**串行**执行，避免并行推送互相覆盖 digest。

1. **`.github/workflows/release.yml`**（`push` → `main`）

   - 若有未消费的 `.changeset/*.md`：打开 **「chore: version packages」** PR（更新版本、`CHANGELOG.md`）。
   - 若无待处理 changeset 且版本已更新：`changesets/action` 的 **`publish`** 步骤执行 **`npm run ci:changeset-tag-push`**（`changeset tag` + 推送 **`vX.Y.Z`**）。
   - **不在此 workflow 创建 GitHub Release**（避免与 digest 说明重复）。
   - **Docker 触发**：若使用 **`CHANGESETS_GITHUB_TOKEN`（PAT）** 打 tag，GitHub 会把 **`push` tags** 交给下游，**`octafuse-docker-images`** 会按 tag 自动跑。若仅用默认 **`GITHUB_TOKEN`** 打 tag，**不会**自动触发其它 workflow（[官方说明](https://docs.github.com/en/actions/using-workflows/triggering-a-workflow#triggering-a-workflow-from-a-workflow)）；此时 **Release** 会在检测到 **`GITHUB_SHA` 上有 `v*` tag** 后，用 **`gh workflow run`** 主动触发 **Octafuse Docker Images**（需 workflow 已授予 **`actions: write`**，本仓已加）。

2. **`.github/workflows/octafuse-docker-images.yml`**（**`push` → `tags/v*`**，或由 Release **dispatch**；或 **`workflow_dispatch`**）

   - 构建并推送 **GHCR** 三镜像。
   - 在 **tag 发版**路径下创建/更新 **GitHub Release**：正文由 **`npm run release:notes`**（`scripts/release/render-release-notes.mjs`）生成——**本次更新 / 变更内容 / 升级说明** + **容器镜像**（三个官方 tag，不折叠）+ 相关链接；优先读取可选覆盖文件 **`docs/releases/X.Y.Z.md`**，否则从 **`CHANGELOG.md`** 对应段落规范化（去掉 `Patch Changes` 与 commit/`Thanks @` 前缀）。

3. **`.github/workflows/verify-package-versions.yml`**
   - `develop` / `release/**` / `hotfix/**` / `main` 相关 PR，以及 `main` / `develop` / `v*` 推送上校验：根与 workspace **`version` 一致**；在 **tag** 上校验 **`v` + version** 与标签名一致。

### 端到端顺序（你在 GitHub 上要做的）

| 步骤                                                                                      | 谁触发          | 结果                                                                                                                                                               |
| ----------------------------------------------------------------------------------------- | --------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| 1. 功能与贡献 PR 合并到 **`develop`**                                                     | 贡献者 / 维护者 | 下一版本持续集成；不会触发 Release workflow                                                                                                                        |
| 2. 发布前补齐并审核 `.changeset/*.md`，从 **`develop`**（或 `release/X.Y.Z`）PR 到 `main` | 维护者          | 合并后 **Release** 跑完 → 出现 **Version Packages** PR（`changeset-release/main` → `main`）                                                                        |
| 3. 审核并 **合并 Version PR** 到 **`main`**                                               | 维护者          | **Release** 再跑 → **`npm run ci:changeset-tag-push`** 推 **`vX.Y.Z`** → **Docker** 跑（PAT 直推 tag）或由 **Release** dispatch **Docker**（仅 `GITHUB_TOKEN` 时） |
| 4. 等 **Octafuse Docker Images** 绿                                                       | CI              | **GHCR** 有对应 tag 的镜像；**GitHub Release** 列出三个官方镜像 tag                                                                                                 |
| 5. 部署并回同步                                                                           | 维护者 / 运维   | 用镜像 tag 或 digest 更新环境；将 `main` 同步回 `develop`，删除已完成的 `release/X.Y.Z`                                                                            |

**仅把代码推上 `main`、且没有待处理 changeset、也没有合并 Version PR** 时：不会打新 tag，**Docker 不会为「发版」自动跑**（这是预期），但这些代码仍会进入下一次从 `main` 产生的正式版本。因此只允许明确准备随下一次稳定版发布的代码进入 `main`。日常开发和临时部署使用 `develop` + **`workflow_dispatch`**。

## Release workflow 无法创建 PR（`HttpError: ... not permitted to create or approve pull requests`）

`changesets/action` 会在远端分支 **`changeset-release/main`** 上提交版本变更，再 **调用 GitHub API 创建 PR**。若报错说明当前 **默认 `GITHUB_TOKEN` 被禁止创建 PR**（常见：仓库未勾选策略，或 **组织策略** 关闭该能力）。

### 做法 A（推荐）：放开仓库对默认 token 的 PR 权限

1. 打开仓库 **Settings** → **Actions** → **General**。
2. **Workflow permissions** 选择 **Read and write permissions**。
3. 勾选 **Allow GitHub Actions to create and approve pull requests**。
4. 保存后，重新跑一次 **Release** workflow（或对 `main` 再推一次空 commit）。

官方说明：[Preventing GitHub Actions from creating or approving pull requests](https://docs.github.com/en/repositories/managing-your-repositorys-settings-and-features/enabling-features-for-your-repository/managing-github-actions-settings-for-a-repository#preventing-github-actions-from-creating-or-approving-pull-requests)（反向理解：需要 **允许** 时勾选上述选项）。

若 **组织级** 禁止 Actions 创建 PR，做法 A 不可用，请用做法 B。

### 做法 B：使用 PAT（Repo secret `CHANGESETS_GITHUB_TOKEN`）

1. 在 GitHub 创建 **Personal Access Token**（或 machine user）：
   - **Classic**：勾选 **`repo`**（或至少 **Contents**、**Pull requests**）。
   - **Fine-grained**：该仓库 **Contents: Read and write**、**Pull requests: Read and write**、**Metadata: Read**。
2. 在仓库 **Settings** → **Secrets and variables** → **Actions** 中新增 secret：**`CHANGESETS_GITHUB_TOKEN`**，值为上述 PAT。
3. **`.github/workflows/release.yml`** 已配置：`GITHUB_TOKEN` 优先使用 **`secrets.CHANGESETS_GITHUB_TOKEN`**，未设置时回退 **`secrets.GITHUB_TOKEN`**。
4. **必读**：`changesets/action` 与 **`scripts/ci/push-root-release-tag.mjs`** 里的 `git push` 依赖 **`actions/checkout@v4` 的 `token`**。本仓已设为 `token: ${{ secrets.CHANGESETS_GITHUB_TOKEN || secrets.GITHUB_TOKEN }}`。若只把 PAT 写在 `env.GITHUB_TOKEN` 而 **checkout 仍用默认凭据**，`git push` tag 仍会走默认 **`GITHUB_TOKEN`**，**不会**链式触发 **Octafuse Docker Images**（dispatch 步骤还会因「已配 PAT」而跳过），表现为 **PAT 已配但 Docker 不跑**。

### 本次失败后的补救

若日志里已成功 **`git push origin HEAD:changeset-release/main`**，但 **创建 PR 失败**：到 GitHub 上打开分支 **`changeset-release/main`**，**手动发起 PR 合并到 `main`** 即可；合并后下一轮 Release 会尝试 **`changeset tag`**（若已无待处理 changeset）。

### Tag 未上 GitHub / Release 成功但无 `v*` 且无 Docker

1. **`changesets/action` + `createGithubReleases: false`**：上游实现里 **`git.pushTag` 与创建 GitHub Release 绑在一起**；为 false 时即使用 `changeset tag` 打出了**本地** tag，也不会替你 `git push`。本仓库用 **`npm run ci:changeset-tag-push`**（`changeset tag` + `scripts/ci/push-root-release-tag.mjs`）在 CI 里显式推送 **`vX.Y.Z`**。
   - 补充：默认 **`privatePackages.tag` 为 `false`** 时，`changeset tag` **可能不会**生成 **`v*`**（仅 private workspace 时常见）。`push-root-release-tag.mjs` 会在缺少 **`vX.Y.Z`** 时于当前 **HEAD**（或已存在的 `octafuse@X.Y.Z` 等标签指向的提交）**补打** **`vX.Y.Z`** 再推送。若希望 Changesets 自行生成 `name@version` 类标签，可在 **`.changeset/config.json`** 设置 `"privatePackages": { "tag": true }`（可选）。
2. **日志已跑 `changeset tag` 但后续仍报 HEAD 无 semver tag**：多为 **远端已有同名 `vX.Y.Z`**，`changeset tag` 会整段跳过（不写本地 tag）——需 **bump 新版本**（新 changeset + 再走 Version PR）或 **谨慎**处理远端错误 tag 后再跑一次 Release。
3. **PAT 已配但 Docker 仍未跑**：核对 **`release.yml`** 中 **`actions/checkout`** 是否传入 **`token: ${{ secrets.CHANGESETS_GITHUB_TOKEN || secrets.GITHUB_TOKEN }}`**（见上文「做法 B」第 4 条）。

## 维护者日常操作

### 1. 普通功能与贡献 PR

普通功能 PR 的 base 选择 **`develop`**，不要直接选择 `main`。用户可见的独立变更建议在 PR 中执行：

```bash
npx changeset
```

选择 **patch / minor / major**，提交生成的 `.changeset/<id>.md`。Changesets 在 `develop` 上只作为待发布记录存在，不会自动发版。

如果版本范围尚未确定，可以暂不写 changeset，但必须在发布 PR 合入 `main` 前由维护者补齐并统一审核；纯文档、测试、CI 或不影响用户的内部维护通常不需要 changeset。

**changeset 文案（供 GitHub Release 渲染）**：

1. **首段**：一句话「本次更新」摘要（面向运维 / 集成方）。
2. **分区**：用 `### Proxy` / `### Admin` / `### Core` / `### 文档` 等列出变更；每条 `**能力名称**：用户可感知的变化。`
3. **可选** `### 升级说明`：有迁移 / 配置 / 破坏性时必写；缺省时 Release 渲染为「迁移/配置/兼容性：无」。
4. **不要**依赖 `### Patch Changes` 或 commit/`Thanks @` 出现在公开发布首屏——这些由 Changesets 写入 `CHANGELOG.md`，Release 脚本会剥离。

本地预览（Version PR 合并、`CHANGELOG` 已有 `## X.Y.Z` 之后）：

```bash
npm run release:notes -- --version X.Y.Z
```

需要完全手写某版本正文时，可新增 **`docs/releases/X.Y.Z.md`**（含 `## 本次更新` / `## 变更内容` / `## 升级说明`），CI 会优先使用。

### 2. 合并开发线并生成 Version Packages PR

版本达到发布条件后，确认测试、迁移说明和 changesets 完整，再创建 **`develop` → `main`** PR。若需要冻结验收而 `develop` 继续接收新功能，则先创建 `release/X.Y.Z`，改用 **`release/X.Y.Z` → `main`** PR。合并后 **Release** workflow 会创建 **Version Packages** PR；维护者审核版本号与 `CHANGELOG.md` diff 后合并。

### 3. 打标签与镜像

合并 Version PR 再次触发 **Release** → **`npm run ci:changeset-tag-push`**（`changeset tag` + 推送 **`vX.Y.Z`**）→ **Docker**（见上文「Docker 触发」：PAT 走 tag 事件；仅 `GITHUB_TOKEN` 时由 Release **dispatch**）→ **GitHub Release** 就绪（正文含 **`CHANGELOG.md` 对应版本段** + 三个官方镜像 tag）。

### 4. 当前稳定版热修（patch）

当前稳定版为 `v2.3.0` 时：

1. 从 `main` 创建 **`hotfix/2.3.1`**；若必须从 tag 创建，使用 `git switch -c hotfix/2.3.1 v2.3.0`。
2. 在该分支完成最小修复与验证，添加 **patch** changeset，然后 PR 到 `main`。
3. 重复第 2–3 节的 Version Packages PR 与 tag 流程，得到 **`v2.3.1`**。
4. 将修复提交从 `main` 合入 `develop`；遇到较大冲突时可 cherry-pick 实际修复提交。正式发版结束后仍需把 Version Packages 产生的版本和 changelog 同步回 `develop`。

## 回滚与应急

| 场景                | 建议                                                                                                                                 |
| ------------------- | ------------------------------------------------------------------------------------------------------------------------------------ |
| **生产回滚**        | 使用上一稳定 **`vX.Y.Z`** 镜像 tag 拉取部署；需要可复现固定时，从 GHCR 包页核对 **digest** 后再按 digest 拉取。 |
| **标签错误**        | **勿**在已推送公共镜像后改写远程 tag；应发 **新版本** 或 **新 tag** 并更新部署文档。                                                 |
| **仅验证镜像**      | 仍可使用 **Actions → Octafuse Docker Images → Run workflow**（`workflow_dispatch`），不依赖发版标签；**不会**自动写 GitHub Release。 |
| **CI 版本校验失败** | 检查四个 `package.json` 的 `version` 是否一致；标签推送时检查 **`v`** + `version` 是否与 **`github.ref_name`** 一致。                |

## Semver 与破坏性变更

- **MAJOR**：不兼容的 API / 配置 / 数据迁移要求（须在 PR 与 `CHANGELOG` 中写清迁移步骤）。
- **MINOR**：向后兼容的功能与扩展。
- **PATCH**：缺陷修复与内部重构（对外行为不变）。

预发布版本（如 `1.0.0-rc.0`）若使用，镜像 **`latest`** 不会更新（见 Docker workflow 中 `latest` 条件）。

## 相关文档

- [docker.md](../operators/deployment/docker.md) — GHCR 与 Compose
- [CHANGELOG.md](../../CHANGELOG.md) — 聚合变更记录
- [`.changeset/README.md`](../../.changeset/README.md) — Changesets 快速说明
- [`docs/releases/`](../releases/) — 可选：某版本 GitHub Release 正文覆盖（如 `2.1.2.md`）
- `npm run release:notes -- --version X.Y.Z` — 本地预览 Release 正文
