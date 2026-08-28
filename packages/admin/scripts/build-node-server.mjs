/**
 * 把 Admin Node 自定义入口打进 standalone，供 Docker `node packages/admin/node-server.mjs` 使用。
 * `@octafuse/*` 打进 bundle（镜像 runner 没有 core 子路径的 `.ts`）；`next` / `ws` 保持 external。
 */
import * as esbuild from 'esbuild';
import { mkdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const pkgRoot = join(__dirname, '..');
const outfile = join(pkgRoot, '.next/standalone/packages/admin/node-server.mjs');

const bundleWorkspacePackages = {
	name: 'bundle-workspace-packages',
	setup(build) {
		build.onResolve({ filter: /^@\// }, (args) => ({
			path: join(pkgRoot, args.path.slice(2)),
		}));
		build.onResolve({ filter: /^[^./]/ }, (args) => {
			if (args.path.startsWith('@octafuse/')) {
				return undefined;
			}
			return { path: args.path, external: true };
		});
	},
};

mkdirSync(dirname(outfile), { recursive: true });

await esbuild.build({
	entryPoints: [join(pkgRoot, 'runtime/node-server.ts')],
	bundle: true,
	platform: 'node',
	format: 'esm',
	outfile,
	logLevel: 'warning',
	plugins: [bundleWorkspacePackages],
});

const source = readFileSync(outfile, 'utf8');
const re = /(?:from\s+|import\s*\(\s*)["'](@octafuse\/[^"']+)["']/g;
const found = new Set();
for (const m of source.matchAll(re)) {
	found.add(m[1]);
}
if (found.size > 0) {
	console.error('[admin/build-node-server] bundle still references @octafuse/* as external:');
	for (const id of [...found].sort()) {
		console.error(`  ${id}`);
	}
	process.exit(1);
}
console.log('[admin/build-node-server] OK:', outfile);
