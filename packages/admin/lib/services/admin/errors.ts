/**
 * 管理后台业务层可预期的 HTTP 错误（400/404/409），由路由 `handleAdminRouteError` 映射为 JSON。
 */
export class AdminServiceError extends Error {
	/** HTTP 状态码，如 400 / 404 / 409 */
	status: number;

	/** @param status HTTP 状态码 @param message 返回给客户端的英文 message（与现有 API 一致） */
	constructor(status: number, message: string) {
		super(message);
		this.name = 'AdminServiceError';
		this.status = status;
	}
}

/** 构造 400 业务校验错误。 */
export function badRequest(message: string): AdminServiceError {
	return new AdminServiceError(400, message);
}

/** 构造 404 资源不存在。 */
export function notFound(message: string): AdminServiceError {
	return new AdminServiceError(404, message);
}

/** 构造 409 冲突（如主键已存在）。 */
export function conflict(message: string): AdminServiceError {
	return new AdminServiceError(409, message);
}

/** 路由层判断是否为已映射的 `AdminServiceError`。 */
export function isAdminServiceError(error: unknown): error is AdminServiceError {
	return error instanceof AdminServiceError;
}
