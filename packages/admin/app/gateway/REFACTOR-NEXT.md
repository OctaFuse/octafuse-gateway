# Gateway Admin UI — 后续结构优化备忘

`models/`、`routes/` 已对齐 `providers/` 的拆分模式（薄 `page.tsx` + `use-*-page-state.ts` + `*-api.ts` + `*-utils.ts` + `types.ts` + `components/`）。以下为按 ROI 排序的后续工作项。

## 已抽取的跨页共享件

| 路径 | 用途 |
|------|------|
| `app/gateway/components/filter-nav.tsx` | `FilterNavSection` / `FilterNavButton`（models、routes 侧边筛选） |
| `lib/format-compact-tokens.ts` | `formatCompactTokens` / `trimTrailingZeros`（models、routes 展示） |

## 阶段 2：列表页集群（优先）

### keys + users + users/[id]

- 抽取 `components/list-pagination.tsx` — 四页重复的分页条
- 抽取 `components/modal-shell.tsx` — 统一 `fixed inset-0` 弹窗外壳
- 抽取 `components/readonly-field.tsx` — keys、users/[id]、playground、simulator 只读行
- 抽取 `hooks/use-paginated-admin-fetch.ts` — page / filters / sort / loading
- keys 与 users/[id] 的 Key CRUD 可共享 `hooks/use-api-key-mutations.ts`

### request-logs + audit-logs

- 共用 filter bar + `useUrlSyncedFilters`（封装 `useReplaceListPageQuery` + mount 读 URL）
- 审计 payload 展示 helper → `lib/audit-log-display.ts`（audit-logs 与 users/[id] 共用）
- request-logs 展开详情 → `components/request-log-detail-panel.tsx`

## 阶段 3：Analytics

- `analytics/models` + `analytics/providers` → 共享 `useAnalyticsDrilldownTable` + layout 壳
- `analytics/users` 接入同一 layout（无 drill-down）
- `analytics/reliability` 暂缓（体量小、结构清晰）

## 阶段 4：工具页（可选）

- playground / simulator 抽取 `StreamTestPanel`（body 编辑、流式输出）
- 保留各自 API 差异在薄 wrapper

## 暂缓 / 不建议过度抽象

| 页面 | 理由 |
|------|------|
| `providers` | 已是目标形态 |
| `config` | 每卡片领域逻辑不同，拆文件收益有限 |
| 通用 CRUD Form Builder | 各页校验与字段差异大 |
| models/routes 定价重算 | 保留在各自 `*-utils.ts`，勿做「万能 pricing hook」 |
| playground ↔ simulator 合并 | 调用链不同，仅共享流式 UI |

## 推荐目录模板（新页 / 大 refactor 时）

```
gateway/<feature>/
├── page.tsx
├── use-<feature>-page-state.ts
├── <feature>-api.ts
├── <feature>-utils.ts
├── types.ts
└── components/
```

## 手动回归清单（models / routes 重构后）

- **Models**：`?vendor=` URL 同步、Import 禁选已有 id、Edit 二次 fetch、metadata/pricing 校验、Delete 级联提示
- **Routes**：四维筛选、新建默认 inactive、`price_override` 完整写入、Provider↔protocol 纠正、sticky 仅改当前 rule、Duplicate、列表 optimistic toggle
