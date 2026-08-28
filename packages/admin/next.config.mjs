import createNextIntlPlugin from 'next-intl/plugin';
import path from 'path';
import { fileURLToPath } from 'url';

const withNextIntl = createNextIntlPlugin('./lib/i18n.ts');

const __dirname = path.dirname(fileURLToPath(import.meta.url));
/** npm workspace 根（`octafuse/`），与 hoist 的 `next` 一致 */
const workspaceRoot = path.join(__dirname, '../..');

/** Admin/OpenNext 的 `node` 条件会解析到过期的 `core/dist`；强制根导入走 src。 */
const coreSrcIndex = path.join(__dirname, '../core/src/index.ts');

/** @type {import('next').NextConfig} */
const nextConfig = {
	output: 'standalone',
	transpilePackages: ['@octafuse/core', '@octafuse/tool-engines'],
	serverExternalPackages: ['ws'],
	images: {
		unoptimized: true,
	},
	// 静态跳转放在路由层，避免 `app/page.tsx` 立刻 `redirect()`。
	// Next.js 16 + Turbopack 开发态会对被 abort 的 RSC 调 `performance.measure(-Infinity)`，
	// 触发 `'HomePage' cannot have a negative time stamp` 红屏（生产不受影响）。
	async redirects() {
		return [
			{
				source: '/',
				destination: '/dashboard',
				permanent: false,
			},
		];
	},
	// 与 `turbopack.root` 必须相同（npm workspaces 下 Next 会从 monorepo 根解析 `next`）
	outputFileTracingRoot: workspaceRoot,
	turbopack: {
		root: workspaceRoot,
		resolveAlias: {
			// Turbopack alias 从 Admin 目录解析；使用相对路径避免绝对路径被误判为 server-relative import。
			'@octafuse/core': '../core/src/index.ts',
		},
	},
	webpack: (config) => {
		config.resolve.alias = {
			...config.resolve.alias,
			// Exact match (`$`) so `@octafuse/core/lib/...` still uses package exports → src.
			// Avoids OpenNext/webpack `node` condition resolving a stale `core/dist`.
			'@octafuse/core$': coreSrcIndex,
		};
		return config;
	},
};

export default withNextIntl(nextConfig);
