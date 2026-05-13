/**
 * 路由选择策略：按 **有效路由组** 过滤活跃行。
 * 客户端未带 `baseId:group` 后缀时，有效组为 **`default`**；显式后缀则有效组为 trim 后的后缀。
 * 同组匹配为 **字符串相等（忽略大小写）**；行内空 `route_group` 在比较时规范为 `default`。
 */
import type { ModelRouteRow } from '@octafuse/core';

function normalizeRowRouteGroup(row: ModelRouteRow): string {
  const g = row.route_group;
  if (typeof g === 'string' && g.trim() !== '') {
    return g.trim();
  }
  return 'default';
}

/**
 * 从 active 路由行中选出本次请求可用的集合（供 failover 排序使用）。
 * @param activeRows 已为 `status = active` 且按 priority 排好序的行
 */
export function selectActiveRouteRows(
  activeRows: ModelRouteRow[],
  explicitGroup: string | null = null
): ModelRouteRow[] {
  const effective = explicitGroup?.trim() ? explicitGroup.trim() : 'default';
  const want = effective.toLowerCase();
  return activeRows.filter((r) => normalizeRowRouteGroup(r).toLowerCase() === want);
}
