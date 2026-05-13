/**
 * 浏览器内通知：管理 API 返回 401 时让根壳（AuthWrapper）回到登录态。
 */
export const ADMIN_SESSION_EXPIRED_EVENT_NAME = 'your-platform-admin-session-expired';

export function notifyAdminSessionExpired(): void {
	if (typeof window === 'undefined') {
		return;
	}
	window.dispatchEvent(new CustomEvent(ADMIN_SESSION_EXPIRED_EVENT_NAME));
}
