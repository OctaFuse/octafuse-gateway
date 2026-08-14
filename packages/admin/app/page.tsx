/**
 * 根路径兜底：正常请求由 `next.config.mjs` 的 `redirects()` 在路由层转到 `/dashboard`。
 * 保留本页以免部分运行时（如部分 OpenNext 路径）未应用 config redirect。
 */
import { redirect } from 'next/navigation';

export default function HomePage() {
	redirect('/dashboard');
}
