/**
 * 在仓库外临时目录启动 Admin standalone，拦住「本地假阴性、镜像 MODULE_NOT_FOUND」。
 *
 * 仓库内 `.next/standalone` 会向上解析到根 `node_modules/next`（含 compiled/webpack），
 * Docker 运行层没有这份完整 next。必须脱离仓库再 `node packages/admin/node-server.mjs`。
 */
import { cpSync, existsSync, mkdtempSync, rmSync } from 'node:fs';
import { createServer as createNetServer } from 'node:net';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawn } from 'node:child_process';

const __dirname = dirname(fileURLToPath(import.meta.url));
const pkgRoot = join(__dirname, '..');
const workspaceRoot = join(pkgRoot, '../..');
const standaloneDir = join(pkgRoot, '.next/standalone');
const staticDir = join(pkgRoot, '.next/static');
const publicDir = join(pkgRoot, 'public');
const entryRel = 'packages/admin/node-server.mjs';

/** 与 Dockerfile.admin 运行层 COPY 对齐（next 已在 standalone 内）。 */
const RUNNER_PACKAGES = [
	'postgres',
	'aws-ssl-profiles',
	'denque',
	'generate-function',
	'iconv-lite',
	'is-property',
	'long',
	'lru.min',
	'named-placeholders',
	'safer-buffer',
	'sql-escaper',
	'mysql2',
	'ws',
];

const BOOT_TIMEOUT_MS = 45_000;
const POLL_MS = 400;

function fail(message) {
	console.error(`[admin/verify-standalone-boot] ${message}`);
	process.exit(1);
}

function getFreePort() {
	return new Promise((resolve, reject) => {
		const server = createNetServer();
		server.listen(0, '127.0.0.1', () => {
			const addr = server.address();
			const port = typeof addr === 'object' && addr ? addr.port : 0;
			server.close((err) => (err ? reject(err) : resolve(port)));
		});
		server.on('error', reject);
	});
}

async function waitForDashboard(port, startedAt) {
	const url = `http://127.0.0.1:${port}/dashboard`;
	while (Date.now() - startedAt < BOOT_TIMEOUT_MS) {
		try {
			const res = await fetch(url, { redirect: 'manual' });
			if (res.status >= 200 && res.status < 400) {
				return res.status;
			}
		} catch {
			// not listening yet
		}
		await new Promise((r) => setTimeout(r, POLL_MS));
	}
	return null;
}

if (!existsSync(join(standaloneDir, entryRel))) {
	fail(`missing ${join(standaloneDir, entryRel)}; run: npm run build:docker -w @octafuse/admin`);
}

const tmpRoot = mkdtempSync(join(tmpdir(), 'octafuse-admin-standalone-'));
let child;
const logs = [];

try {
	cpSync(standaloneDir, tmpRoot, { recursive: true, dereference: false });
	if (existsSync(staticDir)) {
		cpSync(staticDir, join(tmpRoot, 'packages/admin/.next/static'), { recursive: true });
	}
	if (existsSync(publicDir)) {
		cpSync(publicDir, join(tmpRoot, 'packages/admin/public'), { recursive: true });
	}

	const destModules = join(tmpRoot, 'node_modules');
	for (const name of RUNNER_PACKAGES) {
		const src = join(workspaceRoot, 'node_modules', name);
		if (!existsSync(src)) {
			throw new Error(`missing runner package ${src} (must match Dockerfile.admin COPY)`);
		}
		cpSync(src, join(destModules, name), { recursive: true });
	}

	const port = await getFreePort();
	child = spawn(process.execPath, [entryRel], {
		cwd: tmpRoot,
		env: {
			...process.env,
			NODE_ENV: 'production',
			PORT: String(port),
			HOSTNAME: '127.0.0.1',
		},
		stdio: ['ignore', 'pipe', 'pipe'],
	});
	const onChunk = (buf) => {
		logs.push(buf.toString());
	};
	child.stdout?.on('data', onChunk);
	child.stderr?.on('data', onChunk);

	const startedAt = Date.now();
	const exitPromise = new Promise((resolve) => {
		child.on('exit', (code, signal) => resolve({ code, signal }));
	});

	const status = await Promise.race([
		waitForDashboard(port, startedAt),
		exitPromise.then(({ code, signal }) => {
			throw new Error(`node-server exited before ready (code=${code} signal=${signal})`);
		}),
	]);

	if (status == null) {
		throw new Error(`GET /dashboard did not become 2xx/3xx within ${BOOT_TIMEOUT_MS}ms`);
	}

	console.log(`[admin/verify-standalone-boot] OK: GET /dashboard -> ${status} (isolated ${tmpRoot})`);
} catch (err) {
	const message = err instanceof Error ? err.message : String(err);
	console.error(`[admin/verify-standalone-boot] ${message}`);
	if (logs.length > 0) {
		console.error('--- node-server log ---');
		console.error(logs.join('').trimEnd());
	}
	process.exitCode = 1;
} finally {
	if (child && !child.killed) {
		child.kill('SIGTERM');
		const killTimer = setTimeout(() => {
			try {
				child.kill('SIGKILL');
			} catch {
				// ignore
			}
		}, 2000);
		await new Promise((resolve) => {
			child.once('exit', () => {
				clearTimeout(killTimer);
				resolve();
			});
		});
	}
	rmSync(tmpRoot, { recursive: true, force: true });
}
