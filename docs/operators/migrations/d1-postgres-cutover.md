# D1 → Postgres 迁移、对账与切换

把网关数据面从 **Cloudflare Worker + D1** 搬到 **Docker + Postgres**（Proxy、Admin 同连一个 Postgres，见 [docker.md](../deployment/docker.md)）。工具在 **`scripts/db/cutover/`**：

| 脚本 | 作用 |
|------|------|
| `etl-d1-to-postgres.ts` | 把 D1 的数据复制到 Postgres，可重复执行；`--check` 只读校验两边内容是否一致 |
| `reconcile-d1-postgres.ts` | 对账：行数 + 账务与日志汇总 |

表清单、分组和顺序在 [`scripts/db/lib/migration-tables.ts`](../../../scripts/db/lib/migration-tables.ts)。迁移新增了表却没有登记到这里时，`npm run test:db-scripts` 会失败，不会再出现"ETL 悄悄漏表"。

> **要照着执行请看 [切换操作手册](./d1-postgres-cutover-runbook.md)**（命令可直接复制）；本页讲原理、参数和注意事项。

> 这份流程已经在本地 D1（含 2500 余条请求日志）对一个空 Postgres 完整演练过：全量预热、三组同步、`--check` 发现漂移、`--since` 增量、`--prune`、对账都通过。**生产切换前仍必须对线上 D1 先跑一次 `--dry-run` 再演练**，原因见下文「首次对线上 D1」。

## 0. 前置条件

- 目标 Postgres 已建好 schema：`npm run db:migrate:pg`（表在专用 schema `octafuse_gateway` 里，ETL 与对账自动使用同一个 `search_path`，不用手工设置）。
- 能访问源 D1。默认读**线上**（`--d1-source=remote`，需要 `wrangler login` 或 `CLOUDFLARE_API_TOKEN`）。演练用 `--d1-source=local --d1-persist-to=.wrangler/state`，本地模式需要先 `npm run gen:wrangler` 生成 `packages/core/wrangler.d1.jsonc`。
- `--d1-source` 的值写错会直接报错，**不会**回退到 remote。
- 已读 [docker.md](../deployment/docker.md) 中 Node Proxy 的边界（没有 `/admin` HTTP）。Full self-hosted 需要把 Admin 一并接到同一个 Postgres。
- 提前把 DNS 的 TTL 调小（例如 60 秒），并确认新环境的 Proxy、Admin 都已指向目标 Postgres。

### 首次对线上 D1

1. **表结构可能和仓库迁移不一致。** 仓库的迁移基线曾被重写过，线上 D1 可能还带着已不在迁移里的旧列（例如 `models.supports_images`）。ETL 在**任何写入之前**会先对所有待迁移表做预检，一次性列出全部差异并停下：

   ```text
   Preflight failed, nothing was written:
     - models: D1 有而 Postgres 没有的列 supports_images。…… 用 --skip-columns=models.supports_images 明确丢弃
   ```

   确认某列确实已废弃，再用 `--skip-columns=<表>.<列>` 明确丢弃。不加这个参数，列不一致一律报错，不会静默丢数据。
2. **批量读取尚未在线上验证。** 为了缩短窗口，脚本把多张表的查询合并成一次 `wrangler d1 execute` 调用（多条语句，结果按顺序返回）。这在本地 D1 上验证过；线上 D1 走的是 Cloudflare API，请先执行 `--dry-run`（它会走批量的列、计数路径），确认能正常返回后再继续。

## 1. 表的三个分组

分组依据是"谁会写它"，已对照代码核实（Proxy 请求路径上没有任何对配置表的写调用）：

| 分组 | 表 | 同步策略 |
|------|-----|---------|
| `config` | `providers`、`models`、`model_tags`、`route_pools`、`model_routes`、`model_surfaces`、`mcp_servers`、`mcp_server_items`、`admin_api_keys` | 只有管理员会改。预热时同步一次，窗口内**只校验**，发现漂移再补同步 |
| `state` | `users`、`api_keys`、`route_pool_sticky_bindings`、`system_config` | 会被请求或维护开关改写。**必须在冻结之后**同步（带 `--prune`） |
| `log` | `api_key_request_logs`、`user_audit_logs` | 只追加，体量大。预热时同步，窗口内用 `--since` 只补尾部 |

`system_config` 是特例：只有 Admin 会写它，但**维护模式开关本身就存在这里**。新环境要继承"冻结"状态，所以它必须在冻结之后再同步，归入 `state`。

`admin_api_keys` 属于 `config`：运行时唯一的写入是 `last_used_at`（调用 Admin API 时更新），不影响其他字段，也不影响校验结果。

## 2. 切换时间线

维护窗口只做"配置校验 + 状态与日志尾部同步 + 对账 + 切 DNS"。体量大的部分在窗口之前同步好。

| 阶段 | 是否停服 | 动作 |
|------|---------|------|
| A. 预热 | 否 | 全量 ETL（三组都同步），**约定从此刻起不再修改配置** |
| B. 冻结 | 开始 | D1 端开启维护模式，等待在途请求结束 |
| C. 最终同步 | 是 | 校验配置 → 同步状态与日志尾部 → 全量校验与对账 |
| D. 验证 | 是 | 新环境逐项探针 |
| E. 切流量 | 是 | DNS 指向新环境，关闭**新环境**的维护模式 |
| F. 观察 | 否 | 观察 5xx、延迟、请求日志写入；保留 D1 与 Worker 作回滚 |

### A. 预热（不停机）

在目标 Postgres 上建好表，然后全量复制。**只有这一次**用 `--truncate`：

```bash
export DATABASE_URL='postgres://…'
npx tsx scripts/db/cutover/etl-d1-to-postgres.ts --truncate --batch-size=1000
```

记下开始时间（UTC），阶段 C 用它推算 `--since`。**预热完成后，通知管理员不要再改配置**（供应商、模型、路由、MCP、集成密钥）。这条约定让窗口内只需校验配置，而不必重新复制。

预热期间 D1 仍在接收请求，状态与日志会继续变化，所以此时只校验配置：

```bash
npx tsx scripts/db/cutover/etl-d1-to-postgres.ts --kind=config --check
```

### B. 冻结

在 D1 对应的 Admin 里开启维护模式（**系统 → 维护模式**，见 [维护模式](../maintenance-mode.md)），或用只带 `maintenance.write` 的集成密钥调接口。5 秒内全网生效，推理入口开始返回 503，不写日志、不扣费。冻结后 Admin 写接口也被拦（默认），配置不会再变。

已经开始的流式请求会继续跑完并记账。**必须等它们结束**再进入下一步。判断方法：查最新一条请求日志时间，持续几分钟（至少超过你最长的流式请求）不再前进：

```bash
npm run db:query:remote -- "SELECT MAX(created_at) AS latest FROM api_key_request_logs"
```

### C. 最终同步与对账

**第一步：校验配置。** 只读，零写入：

```bash
npx tsx scripts/db/cutover/etl-d1-to-postgres.ts --kind=config --check
```

退出码 0 表示 Postgres 与 D1 完全一致。退出码 2 表示有漂移（管理员在预热后改过配置），会列出哪些表有几行不同、几行多余。这时补同步配置，再校验一次：

```bash
npx tsx scripts/db/cutover/etl-d1-to-postgres.ts --kind=config --prune
npx tsx scripts/db/cutover/etl-d1-to-postgres.ts --kind=config --check
```

必须先于状态表处理配置：`route_pool_sticky_bindings` 引用 `route_pools` 和 `model_routes`，配置没对齐就同步状态会触发外键错误。

**第二步：同步状态与日志尾部。** `--prune` 会先删掉 Postgres 里 D1 已不存在的行，再 upsert，这样"预热后在 D1 删掉又重建"的对象（例如用户 Key）不会残留旧行，也不会撞唯一约束。`--since` 取阶段 A 的开始时间再往前留一点余量（例如提前 1 小时），日志按主键 upsert，重叠部分不会重复：

```bash
npx tsx scripts/db/cutover/etl-d1-to-postgres.ts --kind=state,log --prune --since=2026-10-25T06:00:00Z
```

**第三步：最终校验。** 逐行内容校验配置和状态，再做对账。两者都必须通过：

```bash
npx tsx scripts/db/cutover/etl-d1-to-postgres.ts --kind=config,state --check
npx tsx scripts/db/cutover/reconcile-d1-postgres.ts
```

`--check` 逐行比对内容，包括没有 `updated_at` 的表（`providers`、`models`、`model_routes` 等）。对账覆盖：每张表的行数；`users` 的 `budget_spent`、`budget_max`、`wallet_granted`、`wallet_spent` 合计；请求日志的计费金额、计量金额、Token 合计；审计日志的预算变化合计。日志体量大，不做逐行比对，靠行数与汇总对账。任何一项不一致，脚本以非 0 退出，**不要切流量**。

### D. 验证

此时新环境从 `system_config` 里继承了 D1 的维护状态，仍处于维护模式（见下文注意事项）。推理接口会返回 503，所以先验证管理侧与只读接口，再决定是否放开：

```bash
curl -fsS https://<新环境 Proxy>/health                       # 200，且带 maintenance: true
curl -fsS https://<新环境 Admin>/api/admin/config -H 'Authorization: Bearer <集成密钥>'
curl -fsS https://<新环境 Proxy>/v1/models -H 'Authorization: Bearer sk-…'
```

### E. 切流量

1. DNS 指向新环境。
2. 在**新环境**的 Admin 关闭维护模式。维护模式的开关接口在写冻结时仍可用。

关闭后 5 秒内生效。旧的 Worker 和 D1 保持维护模式不动：还在访问旧地址的客户端只会收到带 `Retry-After` 的 503，SDK 会自动退避重试，不会写进旧库。

### F. 观察

重点看：5xx、延迟、`api_key_request_logs` 是否持续写入、`budget_spent` 是否随请求增长。

## 3. 注意事项

**维护状态会随 `system_config` 一起复制。** `MAINTENANCE_MODE` 存在 `system_config` 里，阶段 C 同步后，新环境一启动就是维护状态。这是有意为之：切换瞬间不会漏流量。代价是**忘记在新环境关闭维护模式，所有推理请求都会返回 503**，所以阶段 E 的第 2 步不能漏。

**集成密钥会一起迁移。** `admin_api_keys` 在配置表里。soloent-web 等外部系统的 `GATEWAY_MASTER_KEY` 对应其中一行，迁过去后原密钥继续有效，不需要重新签发。

**后台登录会话不迁移。** `admin_sessions` 被明确排除，切换后管理员需要重新登录。

**`--truncate` 只用于第一次预热。** 它会清空目标库全部 ETL 表（含日志），不能与 `--tables`、`--kind`、`--since`、`--prune`、`--check` 同用。

**`--check` 为什么可靠。** 它把 D1 的每一行交给 Postgres 比对（同一条 upsert 语句，加上"内容不同才命中"的条件），在一个事务里统计后**统一回滚**。比较由 Postgres 按目标列类型完成，所以 `0.1` 与 `0.100000`、`2026-08-10 15:43:50` 与 `timestamptz` 这类写法差异不会被误报。整个检查放在同一个事务里，新建的父表行对后面的子表可见，不会出现外键误报。

**`--check` 忽略的列。** `admin_api_keys.last_used_at` 在每次调用 Admin API 时被改写（维护窗口里读接口仍放行，soloent-web 会持续调用），不参与比较，否则校验永远通不过；同步时仍会照常复制。其他表没有忽略任何列。

**日志按主键 keyset 分页，不用 OFFSET。** 大表不会越往后越慢。`--since` 只过滤日志表，配置与状态表始终全量 upsert；`created_at` 为空的日志行无法判断新旧，会一并复制。

**调用次数是主要耗时。** 脚本把全部表的取列、计数、取主键、取首页各合并成一次 `wrangler` 调用，小表一次就读完，只有超过一页的大表才继续分页。本地 D1 上的实测：全量预热约 15 秒，窗口内配置校验约 6 秒、状态与日志尾部约 10 秒、最终校验加对账约 12 秒。线上读 D1 每次调用延迟更高，且日志达到数百万行时，日志分页仍是主要耗时，先用 `--dry-run` 看行数，再把预热安排在窗口之前足够早的时间。

## 4. 参数速查

| 参数 | 说明 |
|------|------|
| `--kind=all\|<列表>` | 选择分组，可逗号组合：`config`、`state`、`log`。默认 `all`。写错（包括旧的 `core`）会报错，不会退化成全量 |
| `--check` | 只读校验，零写入。有差异（不同或多余的行）退出码为 2，列出每张表的 `differ` 与 `stale` |
| `--since=<时间>` | 只同步日志表中 `created_at` 不早于该时间的行，按 UTC，如 `2026-10-25T06:00:00Z`；带时区偏移会换算。必须包含 `log` 分组。写错会报错，不会退化成全量或空集 |
| `--tables=a,b` | 只处理指定表；写了未知表名或被排除的表会报错 |
| `--prune` | 先删除 Postgres 中 D1 已不存在的行，再 upsert。只作用于 `config`、`state` 表 |
| `--truncate` | 清空目标库全部 ETL 表，仅第一次预热用 |
| `--skip-columns=t.c,…` | 明确丢弃 D1 中目标库已不存在的旧列 |
| `--dry-run` | 只做预检和统计行数，不写入 |
| `--batch-size=<n>` | 每次从 D1 取的行数，默认 500。每条 `INSERT` 的参数数量会自动限制在 Postgres 上限以内 |
| `--d1-source=remote\|local` | 默认 `remote` |
| `--d1-persist-to=<path>` | 本地 D1 数据目录 |

对账脚本支持 `--kind`（同样可逗号组合）、`--d1-source`、`--d1-persist-to`。预热阶段旧端仍在写，`state` 与 `log` 必然不一致，对账只在冻结之后做 `all`。

## 5. 回滚

- **关闭维护之前**：新环境没有处理过任何请求，D1 数据完整。把 DNS 切回旧环境并关闭 D1 端的维护模式即可。
- **关闭维护之后**：新写入只在 Postgres 里。直接切回 D1 会丢失这段时间的日志与预算消耗。回滚窗口要尽量短；确实要回滚时，先给旧环境开维护，再把 Postgres 的变更反向同步回 D1（本工具只做 D1 → Postgres，不提供反向）。

无论哪种情况，都保留 Postgres 与 D1 数据用于排障，修复后重新走增量同步和对账。

## 6. Checklist

1. Postgres 迁移完成，Proxy、Admin、集成密钥都已指向它；DNS TTL 已调小
2. 对线上 D1 跑 `--dry-run`，确认批量读取可用，并处理列差异（必要时 `--skip-columns`）
3. A：`--truncate` 全量预热，记下开始时间，`--kind=config --check`；通知管理员不再改配置
4. B：D1 端开启维护模式，等在途请求结束（最新日志时间不再前进）
5. C：`--kind=config --check`（有漂移则 `--kind=config --prune` 后复检）→ `--kind=state,log --prune --since=…` → `--kind=config,state --check` + 全量对账，全部通过
6. D：新环境健康检查、Admin、`/v1/models` 探针通过
7. E：DNS 切换，**在新环境关闭维护模式**
8. F：观察 5xx、延迟、日志写入、预算增长；确认稳定后再下线 Worker 与 D1

---

**相关文档**：[维护模式](../maintenance-mode.md) · [部署索引](../deployment/README.md) · [Docker/Node 说明](../deployment/docker.md) · [本地测试拓扑](../../developers/local-development.md)
