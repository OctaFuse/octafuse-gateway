/**
 * `fetch` 响应体 JSON 解析小工具；用于前端调用 `/api/admin/*` 后的类型断言。
 */
import { notifyAdminSessionExpired } from '@/lib/admin-session-events';
import type { ApiResponse } from '@/lib/types';

/** 期望 Worker 返回 `{ success, data?, message? }` 形态。 */
export async function readApiJson<T>(response: Response): Promise<ApiResponse<T>> {
	if (response.status === 401 && response.url.includes('/api/admin')) {
		notifyAdminSessionExpired();
	}
	return (await response.json()) as ApiResponse<T>;
}

/** 任意 JSON 体直接断言为 `T`（无 `success` 包装时使用）。 */
export async function readJson<T>(response: Response): Promise<T> {
  return (await response.json()) as T;
}
