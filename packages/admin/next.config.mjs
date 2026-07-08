import createNextIntlPlugin from 'next-intl/plugin';
import path from 'path';
import { fileURLToPath } from 'url';

const withNextIntl = createNextIntlPlugin('./lib/i18n.ts');

const __dirname = path.dirname(fileURLToPath(import.meta.url));
/** npm workspace 根（`octafuse/`），与 hoist 的 `next` 一致 */
const workspaceRoot = path.join(__dirname, '../..');

/** @type {import('next').NextConfig} */
const nextConfig = {
	output: 'standalone',
	transpilePackages: ['@octafuse/core'],
	images: {
		unoptimized: true,
	},
	// 与 `turbopack.root` 必须相同（npm workspaces 下 Next 会从 monorepo 根解析 `next`）
	outputFileTracingRoot: workspaceRoot,
	turbopack: {
		root: workspaceRoot,
	},
};

export default withNextIntl(nextConfig);
