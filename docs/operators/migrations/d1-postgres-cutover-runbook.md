# D1 → Postgres 切换操作手册

把线上 **Cloudflare Worker + D1** 切到 **Docker + Postgres**。本页是**照着执行**的手册，所有命令可直接复制。原理、参数和注意事项见 [d1-postgres-cutover.md](./d1-postgres-cutover.md)。

**总体顺序**（先把配置、状态和全部现有日志预迁移好；维护窗口里只校验配置、重新同步状态、补日志尾部；窗口结束后没有遗留迁移。维护窗口覆盖 B → E，通常 5 到 8 分钟，其中大半是等在途请求结束和 DNS 生效）：

| 阶段 | 是否停服 | 做什么 |
|------|---------|--------|
| 0 准备 | 否 | 部署新环境、域名与证书、设置变量、对线上 D1 试跑 |
| A 预迁移 | 否 | 记下起点时间；复制配置，再复制状态和全部现有日志（日志大头），之后冻结配置 |
| B 冻结 | **开始** | 老环境开启维护模式，等在途请求结束 |
| C 补齐与对账 | 是 | 校验配置 → 重新同步状态 → 补起点之后的日志尾部 → 全量校验与对账（含日志） |
| D 验证 | 是 | 不动 DNS，直连新环境探针 |
| E 切流量 | 是 → 恢复 | 改 DNS，等证书就绪，**在新环境关闭维护模式** |
| F 收尾 | 否 | 观察，下线老环境 |

## 0. 准备（切换前一天完成）

### 0.1 新环境

按 [baota.md](../../../docker/deploy/baota.md)（或 [docker.md](../deployment/docker.md)）部署 **Postgres + gateway-proxy + gateway-admin**，要求：

- 镜像版本与 Cloudflare 上当前运行的版本**一致**（表结构要相同，否则预检会报列差异）。
- 数据库是**全新的空库**（容器首次启动以 `AUTO_MIGRATE=1` 自动建表；或在本机执行 `npm run db:migrate:pg`）。
- 为**代理服务域名**和**管理后台域名**都准备好 HTTPS 证书和反代，但**先不要**改 DNS。
- 新环境的 `ADMIN_USERNAME` / `ADMIN_PASSWORD` 已设置（`admin_sessions` 不迁移，切换后管理员用它重新登录）。

> **版本要求：线上 Cloudflare 和新环境都必须运行包含「维护模式」的版本**，否则 B 阶段的 `maint on` 会返回 `Forbidden: admin route is not registered`。该功能晚于 `v2.16.0`。两边必须是同一个版本，否则表结构和适配器取值会对不上。验证方法：`curl -sS "$ADMIN_URL/api/admin/maintenance" -H "Authorization: Bearer $OCTA_KEY"` 应返回 `"enabled":false`，新环境同理。

### 0.2 DNS TTL

把代理服务域名和管理后台域名的 TTL 调到 60 秒，并且**等一个旧 TTL 时长**再继续，确保各处已采用短 TTL。

### 0.3 执行机

需要：本仓库克隆、Node 22、`npm ci`、能连新 Postgres。数据库端口只开放给内网时，先开一条 SSH 隧道（另开一个终端保持运行），后面 `DATABASE_URL` 指向本地 `15432`：

```bash
ssh -N -L 15432:127.0.0.1:5432 <user>@<新服务器>
```

另需要：`wrangler` 已登录且能读线上 D1（`npx wrangler whoami`）。

### 0.4 设置变量与函数（每开一个新终端都要重新执行）

先把尖括号里的值换成你的，然后整段粘贴执行：

```bash
cd /path/to/octafuse-gateway

# —— 必填 ——
export DATABASE_URL='postgres://<user>:<password>@<host>:5432/<db>'   # 密码含特殊字符要 URL 编码
export PROXY_URL='https://<代理服务正式域名>'         # 例：https://gateway.example.com（切换前后同一个域名）
export ADMIN_URL='https://<管理后台正式域名>'         # 例：https://admin.example.com
# 直连新环境用的地址，必须**不经过**上面两个正式域名的解析：服务器 IP:端口，或新环境的临时域名
export NEW_PROXY_URL='http://<新服务器 IP>:18787'
export NEW_ADMIN_URL='http://<新服务器 IP>:18789'
export D1_DATABASE_NAME='octafuse-gateway'                           # D1 逻辑库名，默认即此值

# —— 可选：预检提示 D1 有废弃旧列时填，如 models.supports_images；没有就留空 ——
export SKIP_COLUMNS=''

# 集成密钥（须含 maintenance.read + maintenance.write，例如现有的全权限密钥），不回显输入
printf 'Integration key: '; read -rs OCTA_KEY; export OCTA_KEY; echo

etl() { npx tsx scripts/db/cutover/etl-d1-to-postgres.ts ${SKIP_COLUMNS:+--skip-columns="$SKIP_COLUMNS"} "$@"; }
reconcile() { npx tsx scripts/db/cutover/reconcile-d1-postgres.ts "$@"; }
d1() { npx wrangler d1 execute "$D1_DATABASE_NAME" --remote --json --command "$1"; }
latest_log() {
  d1 "SELECT COALESCE(MAX(created_at),'') AS v FROM api_key_request_logs" \
    | node -e 'let s="";process.stdin.on("data",c=>s+=c).on("end",()=>console.log(JSON.parse(s)[0].results[0].v))'
}
maint() {  # maint on|off <env: OLD|NEW>
  local base; if [ "$2" = OLD ]; then base="$ADMIN_URL"; else base="$NEW_ADMIN_URL"; fi
  local body='{"enabled":false}'
  [ "$1" = on ] && body='{"enabled":true,"duration_minutes":30,"message":"网关维护中，预计 {minutes} 分钟后恢复，请稍后再试","messages":{"en":"Gateway maintenance, back in about {minutes} minutes"}}'
  curl -fsS -X PUT "$base/api/admin/maintenance" -H "Authorization: Bearer $OCTA_KEY" -H 'Content-Type: application/json' -d "$body"; echo
}
```

> 这些变量在 zsh 和 bash 里都可用。`etl`、`reconcile`、`d1` 是函数，不要给它们的参数加引号拆分。

### 0.5 试跑（只读，不写）

```bash
npx wrangler whoami
etl --dry-run
```

`--dry-run` 同时验证了三件事：线上 D1 的批量读取可用、新库表已建好、两边列一致。

- 输出每张表的行数，说明可用。**记下日志行数**，用来估 A 阶段迁日志的时长。
- 如果报 `Preflight failed`（例如 `models: D1 有而 Postgres 没有的列 supports_images`），确认该列确已废弃后，把它填进 `SKIP_COLUMNS`（多个用逗号），重新执行 `etl --dry-run` 直到通过。
- 如果报批量读取相关错误（线上 D1 不支持多条语句），停下，不要继续。

确认密钥可用，且老环境当前**没有**处于维护模式：

```bash
curl -fsS "$ADMIN_URL/api/admin/maintenance" -H "Authorization: Bearer $OCTA_KEY"
curl -fsS "$PROXY_URL/health"
```

预期：`"enabled":false`，`/health` 里没有 `maintenance`。

## A. 预迁移（不停机，越接近窗口越好）

**1. 记下起点时间**（往前留 1 小时余量，C 阶段补日志尾部要用，别删这个文件）：

```bash
node -e 'console.log(new Date(Date.now()-3600e3).toISOString())' | tee /tmp/octafuse-cutover-since
```

**2. 复制配置并校验。** `--prune` 会先清掉新库建表时自带的种子数据：

```bash
etl --kind=config --prune
etl --kind=config --check; echo "exit=$?"
```

**3. 复制状态和全部现有日志。** 日志引用用户和密钥（外键），所以先复制状态，再复制日志。日志约 165 万行，工具读 D1 时直连 Cloudflare REST（不再每批启动一次 wrangler），同时写当前批和读下一批，预计 **15 到 25 分钟**。保持终端打开，Mac 接电源；中断后重新执行同一组命令即可（幂等）。**只开一个进程**：D1 单库是单线程的，并发查询只会排队，还会拖慢线上请求。

```bash
caffeinate -i -w $$ &
etl --kind=state
etl --kind=log --batch-size=5000
```

每批进度形如 `api_key_request_logs: 95000/858850 (等待 D1 3.3s · PG 写 0.3s)`：`等待 D1` 是写完上一批后还要等多久才拿到下一批，`PG 写` 是写入这一批的耗时。`等待 D1` 远大于 `PG 写` 说明瓶颈在 D1（正常）；`PG 写` 明显更大说明瓶颈在 Postgres 或网络，可以把 `--pg-concurrency` 从默认的 3 调到 6。

这里复制的状态只是预热：窗口里 C 阶段会在冻结之后重新同步，以冻结后的为准。日志在这期间还在增长，起点之后的部分由 C 阶段补。

**4. 通知管理员：从现在起不要再修改配置**（供应商、模型、路由、路由池、MCP、集成密钥），直到切换完成。

> 预迁移到窗口之间间隔越短，窗口里要补的日志尾部越小。

## B. 冻结（维护窗口开始）

1. 老环境开启维护模式：

   ```bash
   maint on OLD
   ```

2. 确认已生效（最迟 5 秒）：

   ```bash
   sleep 6
   curl -fsS "$PROXY_URL/health"
   curl -s -o /dev/null -w 'chat=%{http_code}\n' -X POST "$PROXY_URL/v1/chat/completions"
   ```

   预期：`/health` 带 `"maintenance":true`，`chat=503`。

3. **等在途请求结束。** 已经开始的流式请求会继续跑完并记账。下面循环在「最新日志时间连续约 3 分钟不再前进」后退出（每 30 秒查一次，需连续 6 次不变）。你的流式请求通常更短的话可以调小 `6`：

   ```bash
   prev=""; same=0
   while [ "$same" -lt 6 ]; do
     cur=$(latest_log)
     if [ "$cur" = "$prev" ]; then same=$((same+1)); else same=0; fi
     prev="$cur"; echo "$(date +%T) latest=$cur stable=$same/6"; sleep 30
   done
   ```

## C. 补齐与对账

**先配置，再状态，最后日志，顺序不能换**（粘性绑定引用路由池和路由，日志引用用户和密钥）。

```bash
# 1) 校验配置：退出码 0 一致；2 有漂移
etl --kind=config --check; echo "exit=$?"
```

退出码是 `2` 时先补同步再复检，直到为 `0`：

```bash
etl --kind=config --prune
etl --kind=config --check; echo "exit=$?"
```

然后以冻结后的为准重新同步状态（`--prune` 先删除新库里线上已不存在的行），再补起点之后的日志尾部（按主键 upsert，重叠部分不会重复）：

```bash
etl --kind=state --prune
etl --kind=log --since="$(cat /tmp/octafuse-cutover-since)" --batch-size=5000
```

最后做最终校验。**两条都必须通过，否则不要往下走**：

```bash
etl --kind=config,state --check; echo "exit=$?"
reconcile; echo "exit=$?"
```

预期：第一条 `exit=0`；对账输出 `All checks passed`，`exit=0`。对账这次包含日志：两张日志表的行数，以及请求日志的计费金额、计量金额、Token 合计和审计日志的预算变化合计。

对账不通过时：先看哪一项不一致；日志不一致就重新执行补尾部那条（幂等）再对账；状态不一致说明老环境还有写入，确认维护模式已生效、在途请求已结束，然后重做 C。

## D. 验证（不动 DNS）

新环境这时已经继承了维护状态（`system_config` 随状态一起复制），推理接口会返回 503，其余只读接口正常。`NEW_PROXY_URL` / `NEW_ADMIN_URL` 是 0.4 里设置的直连地址（服务器 `IP:端口` 或临时域名），**不能**写正式域名，否则请求还会打到老环境。

```bash
# 在新环境 Admin 上用集成密钥读状态（这也证明集成密钥已随配置迁移成功）
curl -fsS "$NEW_ADMIN_URL/api/admin/maintenance" -H "Authorization: Bearer $OCTA_KEY"

# 代理服务：等 5 秒让它读到同步后的维护状态
sleep 6
curl -fsS "$NEW_PROXY_URL/health"
curl -fsS "$NEW_PROXY_URL/v1/models" -H "Authorization: Bearer <一把真实的 sk- 用户密钥>" | head -c 400; echo
curl -s -o /dev/null -w 'chat=%{http_code}\n' -X POST "$NEW_PROXY_URL/v1/chat/completions"
```

预期：Admin 返回 `"enabled":true`；`/health` 带 `"maintenance":true`；`/v1/models` 返回模型列表；`chat=503`。

若要在改 DNS 之前验证正式域名的证书与反代，用 `--resolve` 强制指向新服务器：

```bash
curl -fsS --resolve gateway.example.com:443:<新服务器 IP> https://gateway.example.com/health
curl -fsS --resolve admin.example.com:443:<新服务器 IP> https://admin.example.com/api/admin/maintenance -H "Authorization: Bearer $OCTA_KEY"
```

（把示例域名换成你的真实域名。）

在浏览器登录新 Admin（`ADMIN_USERNAME` / `ADMIN_PASSWORD`），打开仪表盘和请求日志，确认历史数据都在。

## E. 切流量

1. **改 DNS。** 代理服务域名和管理后台域名**都要**改，指向新服务器：
   - 如果这两个域名当前是 Cloudflare **Workers 自定义域名**：先到 Cloudflare 控制台，Workers 与 Pages → 对应 Worker（代理服务、管理后台各一个）→ 设置 → 域和路由，删除该自定义域名；再到 DNS 页添加指向新服务器的 `A` / `CNAME` 记录。
   - 如果是普通 DNS 记录：直接改记录值。

2. 确认 DNS 已生效（用公共解析器验证，不看本机缓存）：

   ```bash
   dig +short @1.1.1.1 <代理服务域名>
   dig +short @1.1.1.1 <管理后台域名>
   curl -sS -o /dev/null -w 'connected=%{remote_ip} http=%{http_code}\n' "$PROXY_URL/health"
   ```

   `dig` 的结果和 `connected=` 都应是**新服务器的 IP**（此时新旧环境都处于维护模式，只看 `/health` 内容分不出来）。TTL 为 60 秒，通常 1 到 2 分钟内就绪；本机仍解析到旧地址时，等一会儿再试，或先 `sudo dscacheutil -flushcache`（macOS）。

3. **在新环境关闭维护模式**（这一步不能漏，否则所有推理请求继续返回 503）：

   ```bash
   maint off NEW
   sleep 6
   curl -fsS "$PROXY_URL/health"
   ```

   预期：`/health` 不再带 `maintenance`。

4. 做一次真实调用，确认流量已落到新环境并正常记账（`<模型名>` 用你的任一在线模型，`sk-` 用测试密钥）：

   ```bash
   curl -sS "$PROXY_URL/v1/chat/completions" \
     -H "Authorization: Bearer <测试用 sk- 密钥>" -H 'Content-Type: application/json' \
     -d '{"model":"<模型名>","messages":[{"role":"user","content":"ping"}],"max_tokens":8}'
   ```

> **老环境的 Worker 和 D1 保持维护模式，不要关**。仍指向旧地址的客户端只会收到带 `Retry-After` 的 503，SDK 会自动退避重试，不会写进旧库。

## F. 收尾

日志在 C 阶段已经迁完并对账，切换之后没有遗留迁移。

1. **观察 30 分钟以上**：5xx 比例、延迟、请求日志是否持续增长、用户 `budget_spent` 是否随请求增长；容器日志在 Dokploy 里看，或在服务器上：

   ```bash
   docker logs --since 10m <gateway-proxy 容器名> 2>&1 | tail -50
   ```

2. 通知管理员：已经切到新环境，请用新环境的管理员账号重新登录；配置可以重新开放编辑。

3. 稳定一周后：下线老环境的两个 Worker 和 D1，把 DNS TTL 调回常规值，删除临时文件：

   ```bash
   rm -f /tmp/octafuse-cutover-since
   ```

## 回滚

**在 E 的第 3 步（关闭新环境维护模式）之前**，新环境没有处理过任何请求，D1 数据完整：

```bash
# 1. DNS（和 Workers 自定义域名）改回老环境，等 TTL 生效
# 2. 老环境关闭维护模式
maint off OLD
sleep 6
curl -fsS "$PROXY_URL/health"
```

**在关闭新环境维护模式之后**，新写入只在 Postgres 里，直接切回 D1 会丢这段时间的日志和预算消耗，回滚窗口要尽量短。确实要回滚时：先让新环境重新进入维护模式（`maint on NEW`）冻结写入，评估丢失量后再决定；本工具只做 D1 → Postgres，没有反向同步。

无论哪种回滚，都保留 Postgres 与 D1 数据用于排障，修复后重新从 A 开始（需要整库重来时，可用 `etl --truncate` 清空新库全部表再迁）。

## 常见问题

| 现象 | 原因与处理 |
|------|-----------|
| `Preflight failed, nothing was written` | 表结构不一致。按提示补 `SKIP_COLUMNS`，或让新环境镜像版本与线上一致 |
| `DATABASE_URL is required` | 当前终端没有执行 0.4 的变量设置 |
| `--check` 退出码 2 | 有漂移：配置补 `etl --kind=config --prune`；状态说明老环境还在写，确认维护模式已生效再重做 C |
| 迁移后时间戳整体早了 8 小时（`created_at` 等） | 旧版本在非 UTC 机器上运行时，驱动把 D1 的 UTC 文本按本机时区解释所致，已修复。用新版本把 config、state、log 全部重新同步一遍即可覆盖（upsert 会更新所有列）；`--check` 在旧数据上会报全表 differ，同步后恢复 |
| 迁日志报外键错误 | 新库里缺用户或密钥：先执行 `etl --kind=state`（预迁移时漏了状态）。已经切换后才出现，说明有用户在新环境被删除，把报错发出来再处理 |
| 对账日志行数或汇总不一致 | 重新执行 C 的 `etl --kind=log --since=…`（幂等），再对账 |
| `/health` 没有 `maintenance:true` | 等 6 秒（读配置缓存 5 秒）；仍没有则确认是在同一个环境上开的开关 |
| 切换后所有推理请求 503 | 忘了关新环境的维护模式：`maint off NEW` |
| 管理后台打不开 `/api/admin/*` | 管理后台域名没一起改 DNS，或反代没指向新 Admin |
| wrangler 读 D1 超时 | 重试；`--batch-size=500` 降低单次返回体积 |
