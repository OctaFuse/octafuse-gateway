/**
 * 兼容入口：历史脚本名。实现见 `test-node-core-routes.ts`（Postgres / MySQL 等 Node SQL 通用）。
 */
import { runNodeGatewaySmoke } from './test-node-core-routes.ts';

runNodeGatewaySmoke().catch((err) => {
	console.error(err);
	process.exit(1);
});
