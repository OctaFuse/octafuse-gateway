#!/usr/bin/env node
/**
 * 生产依赖审计：等价于 `npm audit --omit=dev --audit-level=moderate`，
 * 但允许对「上游暂无修复版本」的通告做带过期时间的精确豁免。
 *
 * 豁免只按通告 ID（GHSA）匹配，不按包名，避免同一个包后续出现新漏洞时被一并放过。
 * 豁免过期后本脚本会重新失败，提醒复查上游是否已发布修复。
 */
import { spawnSync } from 'node:child_process';

const REGISTRY = 'https://registry.npmjs.org';
const FAIL_LEVELS = new Set(['moderate', 'high', 'critical']);

/** @type {{ id: string; until: string; reason: string }[]} */
const IGNORED_ADVISORIES = [
	{
		id: 'GHSA-fc5q-39xc-vjpf',
		until: '2027-01-31',
		reason:
			'picomatch <=4.0.7 ReDoS，npm 上尚无修复版本（first_patched_version=null）。' +
			'仅由 next-intl → @parcel/watcher 在构建 / 开发期处理 glob 时使用，不在网关请求路径上。',
	},
];

const result = spawnSync(
	'npm',
	['audit', '--omit=dev', '--audit-level=moderate', `--registry=${REGISTRY}`, '--json'],
	{ encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 },
);

let report;
try {
	report = JSON.parse(result.stdout);
} catch {
	console.error('无法解析 npm audit 输出：');
	console.error(result.stdout || result.stderr);
	process.exit(1);
}
if (report.error) {
	console.error('npm audit 失败：', report.error.summary ?? report.error);
	process.exit(1);
}

const today = new Date().toISOString().slice(0, 10);
const activeIgnores = new Map();
for (const item of IGNORED_ADVISORIES) {
	if (item.until < today) {
		console.error(`豁免已过期（${item.until}）：${item.id}。请复查上游是否已修复。`);
		continue;
	}
	activeIgnores.set(item.id, item);
}

const vulns = report.vulnerabilities ?? {};
const advisoryId = (via) => via.url?.split('/').pop();

// 一个漏洞被豁免 = 它引用的所有通告都在豁免表里，且它依赖的其他漏洞包也都被豁免（传递依赖）。
const ignored = new Set();
let changed = true;
while (changed) {
	changed = false;
	for (const [name, vuln] of Object.entries(vulns)) {
		if (ignored.has(name)) continue;
		const covered = vuln.via.every((via) =>
			typeof via === 'string' ? ignored.has(via) : activeIgnores.has(advisoryId(via)),
		);
		if (covered) {
			ignored.add(name);
			changed = true;
		}
	}
}

const blocking = Object.entries(vulns).filter(
	([name, vuln]) => FAIL_LEVELS.has(vuln.severity) && !ignored.has(name),
);

for (const name of ignored) {
	const ids = vulns[name].via.filter((via) => typeof via !== 'string').map(advisoryId);
	for (const id of ids) {
		const item = activeIgnores.get(id);
		console.log(`已豁免 ${name}（${id}，至 ${item.until}）：${item.reason}`);
	}
}

if (blocking.length > 0) {
	console.error('\n存在未豁免的生产依赖漏洞：');
	for (const [name, vuln] of blocking) {
		const titles = vuln.via
			.filter((via) => typeof via !== 'string')
			.map((via) => `${via.title} (${via.url})`);
		console.error(`- ${name} [${vuln.severity}] ${titles.join('; ') || `依赖 ${vuln.via.join(', ')}`}`);
	}
	console.error('\n完整报告请运行：npm audit --omit=dev');
	process.exit(1);
}

console.log('生产依赖审计通过。');
