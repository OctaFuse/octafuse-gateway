'use client';

import { useRouter } from 'next/navigation';
import { useEffect } from 'react';
import { legacyInvocationsHref } from '@/lib/request-log-kind';

/**
 * 调用记录已并入「请求日志」的类型筛选；保留旧地址，把原有筛选转成等价的请求日志查询。
 * 筛选要逐项换算，写不成 `next.config.mjs` 里的静态跳转；也不在服务端组件里 `redirect()`，
 * 开发态会因此报 `cannot have a negative time stamp`（见 `next.config.mjs` 的说明）。
 */
export default function LegacyToolInvocationsPage() {
	const router = useRouter();
	useEffect(() => {
		router.replace(legacyInvocationsHref(Object.fromEntries(new URLSearchParams(window.location.search))));
	}, [router]);
	return null;
}
