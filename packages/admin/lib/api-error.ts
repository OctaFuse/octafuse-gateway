/**
 * `/api/admin/*` 等 BFF 的兜底错误处理：打结构化日志并返回 500（响应体含 `requestId` 便于对齐日志）。
 */
type GatewayApiErrorOptions = {
  /** 用于日志定位，如 `gateway.keys.GET` */
  route: string;
  error: unknown;
  context?: Record<string, unknown>;
};

/** 将 `unknown` 规范为可序列化日志字段。 */
function toErrorDetails(error: unknown): { name: string; message: string; stack?: string } {
  if (error instanceof Error) {
    return {
      name: error.name,
      message: error.message,
      stack: error.stack,
    };
  }

  return {
    name: 'UnknownError',
    message: typeof error === 'string' ? error : JSON.stringify(error),
  };
}

/** 统一 500 JSON，不向客户端暴露堆栈；详情见服务端日志。 */
export function handleGatewayApiError({ route, error, context }: GatewayApiErrorOptions) {
  const requestId = crypto.randomUUID();
  const details = toErrorDetails(error);

  console.error('Gateway API error', {
    requestId,
    route,
    error: details,
    ...(context ? { context } : {}),
  });

  return Response.json(
    {
      success: false,
      message: 'Internal server error',
      error: { requestId },
    },
    { status: 500 }
  );
}
