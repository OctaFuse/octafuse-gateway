/**
 * Local OpenNext preview 需要 `packages/admin/.dev.vars`（gitignore）提供
 * `ADMIN_PASSWORD`。若不存在则写入本机默认 `admin` / `admin`，避免
 * `npm run dev:admin` 起服务后无法登录。
 *
 * 不会覆盖已有文件；生产请用 Worker Secret，勿依赖此默认值。
 */
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const pkgRoot = path.join(__dirname, '..');
const target = path.join(pkgRoot, '.dev.vars');

const DEFAULT_CONTENTS = `# Auto-created for local OpenNext preview (gitignored). Do not use in production.
# Cloudflare runtime uses D1 via wrangler binding — do not set DATABASE_URL here.
ADMIN_USERNAME=admin
ADMIN_PASSWORD=admin
`;

if (fs.existsSync(target)) {
	process.exit(0);
}

try {
	fs.writeFileSync(target, DEFAULT_CONTENTS, { encoding: 'utf8', flag: 'wx' });
	console.log(
		'[ensure-dev-vars] created packages/admin/.dev.vars — console login: admin / admin (local only)',
	);
} catch (e) {
	if (e && typeof e === 'object' && 'code' in e && e.code === 'EEXIST') {
		process.exit(0);
	}
	console.error('[ensure-dev-vars] failed to create .dev.vars', e);
	process.exit(1);
}
