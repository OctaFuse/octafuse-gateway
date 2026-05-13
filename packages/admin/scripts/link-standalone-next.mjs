/**
 * npm workspaces + `outputFileTracingRoot` 时，Next standalone 输出在
 * `.next/standalone/packages/<pkg>/.next/`，而 OpenNext 期望 `.next/standalone/.next/`。
 * 在 standalone 根目录创建指向真实 `.next` 的符号链接。
 */
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const pkgRoot = path.join(__dirname, '..');
const standaloneDir = path.join(pkgRoot, '.next/standalone');
const nestedNext = path.join(standaloneDir, 'packages/admin/.next');
const linkNext = path.join(standaloneDir, '.next');

if (!fs.existsSync(nestedNext)) {
	console.warn('[link-standalone-next] skip: nested .next not found', nestedNext);
	process.exit(0);
}

try {
	if (fs.existsSync(linkNext)) {
		const st = fs.lstatSync(linkNext);
		if (st.isSymbolicLink()) {
			fs.unlinkSync(linkNext);
		} else {
			fs.rmSync(linkNext, { recursive: true, force: true });
		}
	}
	const relative = path.relative(standaloneDir, nestedNext);
	fs.symlinkSync(relative, linkNext, 'dir');
	console.log('[link-standalone-next] linked', linkNext, '->', relative);
} catch (e) {
	console.error('[link-standalone-next] failed', e);
	process.exit(1);
}
