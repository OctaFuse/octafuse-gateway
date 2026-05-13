/**
 * route_group 展示：与 gateway/routes、gateway/request-logs 等页一致的规范化与 badge 配色。
 */

export function normalizeRouteGroup(g: string | null | undefined): string {
  const t = (g ?? '').trim();
  return t || 'default';
}

/** Badge styles for route group chips (list + filters legend). */
export function routeGroupBadgeClass(group: string): string {
  const key = normalizeRouteGroup(group).toLowerCase();
  const known: Record<string, string> = {
    default: 'bg-slate-100 text-slate-800 ring-slate-200/90',
    free: 'bg-emerald-100 text-emerald-900 ring-emerald-200/90',
    paid: 'bg-violet-100 text-violet-900 ring-violet-200/90',
    pro: 'bg-amber-100 text-amber-950 ring-amber-200/90',
    preview: 'bg-cyan-100 text-cyan-900 ring-cyan-200/90',
    beta: 'bg-indigo-100 text-indigo-900 ring-indigo-200/90',
  };
  if (known[key]) {
    return `ring-1 ring-inset ${known[key]}`;
  }
  const palette = [
    'bg-sky-100 text-sky-900 ring-sky-200/90',
    'bg-orange-100 text-orange-950 ring-orange-200/90',
    'bg-fuchsia-100 text-fuchsia-900 ring-fuchsia-200/90',
    'bg-teal-100 text-teal-900 ring-teal-200/90',
    'bg-rose-100 text-rose-900 ring-rose-200/90',
  ];
  let h = 0;
  for (let i = 0; i < key.length; i++) {
    h = (h * 31 + key.charCodeAt(i)) >>> 0;
  }
  return `ring-1 ring-inset ${palette[h % palette.length]}`;
}

/** Sort route_group keys for card sections: default → free → others A–Z. */
export function compareRouteGroupsForDisplay(a: string, b: string): number {
  const na = normalizeRouteGroup(a);
  const nb = normalizeRouteGroup(b);
  const order = ['default', 'free'];
  const ra = order.indexOf(na.toLowerCase());
  const rb = order.indexOf(nb.toLowerCase());
  const ua = ra === -1 ? order.length : ra;
  const ub = rb === -1 ? order.length : rb;
  if (ua !== ub) return ua - ub;
  return na.localeCompare(nb, undefined, { sensitivity: 'base' });
}
