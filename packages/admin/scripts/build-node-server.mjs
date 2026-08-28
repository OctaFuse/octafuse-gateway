/**
 * 把 Admin Node 自定义入口打进 standalone，供 Docker `node packages/admin/node-server.mjs` 使用。
 *
 * `@octafuse/*`、`@/`、以及纯 JS 依赖（`drizzle-orm` / `hono`）打进 bundle。
 * 仅把 runner 已提供的包标为 external：`next`（standalone）、`ws` / `postgres` / `mysql2`（Dockerfile.admin COPY）。
 */
import * as esbuild from 'esbuild';
import { mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const pkgRoot = join(__dirname, '..');
const outfile = join(pkgRoot, '.next/standalone/packages/admin/node-server.mjs');

/** 与 Dockerfile.admin 运行层 COPY / Next standalone 对齐；新增须同步镜像。 */
const RUNNER_EXTERNALS = new Set(['next', 'ws', 'postgres', 'mysql2']);

function packageName(specifier) {
	if (specifier.startsWith('node:')) {
		return specifier;
	}
	if (specifier.startsWith('@')) {
		const parts = specifier.split('/');
		return parts.slice(0, 2).join('/');
	}
	return specifier.split('/')[0];
}

const bundleWorkspacePackages = {
	name: 'bundle-workspace-packages',
	setup(build) {
		// `@/lib/foo` 必须再走 esbuild 默认解析（补 `.ts` / `index.ts`）。
		// 直接 join 成无扩展名绝对路径会被当成最终文件，Docker 构建报 Cannot read file。
		build.onResolve({ filter: /^@\// }, (args) => {
			if (args.pluginData?.octafuseAliasResolved) {
				return undefined;
			}
			return build.resolve(`./${args.path.slice(2)}`, {
				kind: args.kind,
				resolveDir: pkgRoot,
				pluginData: { octafuseAliasResolved: true },
			});
		});
		build.onResolve({ filter: /^(next|ws|postgres|mysql2)(\/|$)/ }, (args) => ({
			path: args.path,
			external: true,
		}));
	},
};

mkdirSync(dirname(outfile), { recursive: true });

const result = await esbuild.build({
	entryPoints: [join(pkgRoot, 'runtime/node-server.ts')],
	bundle: true,
	platform: 'node',
	format: 'esm',
	outfile,
	logLevel: 'warning',
	metafile: true,
	plugins: [bundleWorkspacePackages],
});

const outputMeta = Object.values(result.metafile.outputs)[0];
const externals = [...new Set((outputMeta?.imports ?? []).filter((i) => i.external).map((i) => i.path))].sort();
const octafuseFound = externals.filter((id) => id.startsWith('@octafuse/'));
const unexpectedExternals = externals.filter((id) => {
	if (id.startsWith('node:') || id.startsWith('@octafuse/')) {
		return false;
	}
	return !RUNNER_EXTERNALS.has(packageName(id));
});

if (octafuseFound.length > 0) {
	console.error('[admin/build-node-server] bundle still references @octafuse/* as external:');
	for (const id of octafuseFound) {
		console.error(`  ${id}`);
	}
	process.exit(1);
}
if (unexpectedExternals.length > 0) {
	console.error('[admin/build-node-server] bundle has externals not provided by Dockerfile.admin runner:');
	for (const id of unexpectedExternals) {
		console.error(`  ${id}`);
	}
	console.error('Bundle the package, or COPY it in Dockerfile.admin and add it to RUNNER_EXTERNALS.');
	process.exit(1);
}
console.log('[admin/build-node-server] OK:', outfile);
