#!/usr/bin/env node
/**
 * Build GitHub Release notes from CHANGELOG.md (Changesets output) + image digests.
 *
 * Usage:
 *   node scripts/release/render-release-notes.mjs --version 2.1.2
 *   node scripts/release/render-release-notes.mjs --version 2.1.2 \
 *     --digest proxy=sha256:… --digest admin=sha256:… --digest migrate=sha256:… \
 *     --out release-notes.md
 *
 * Optional override: docs/releases/X.Y.Z.md (full body for 本次更新 + 变更内容 + 升级说明;
 * digests / 相关链接 still appended by this script).
 */
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = join(__dirname, "../..");
const DEFAULT_REPO = "OctaFuse/octafuse-gateway";

function parseArgs(argv) {
	const out = {
		version: "",
		changelog: join(root, "CHANGELOG.md"),
		out: "",
		repo: DEFAULT_REPO,
		prevTag: "",
		digests: /** @type {Record<string, string>} */ ({}),
		ownerRepoLc: "",
	};
	for (let i = 0; i < argv.length; i++) {
		const a = argv[i];
		if (a === "--version") out.version = argv[++i] ?? "";
		else if (a === "--changelog") out.changelog = resolve(argv[++i] ?? "");
		else if (a === "--out") out.out = resolve(argv[++i] ?? "");
		else if (a === "--repo") out.repo = argv[++i] ?? DEFAULT_REPO;
		else if (a === "--prev-tag") out.prevTag = argv[++i] ?? "";
		else if (a === "--owner-repo-lc") out.ownerRepoLc = argv[++i] ?? "";
		else if (a === "--digest") {
			const raw = argv[++i] ?? "";
			const eq = raw.indexOf("=");
			if (eq <= 0) throw new Error(`Invalid --digest ${raw} (expect name=sha256:…)`);
			out.digests[raw.slice(0, eq)] = raw.slice(eq + 1).trim();
		} else if (a === "--help" || a === "-h") {
			out.help = true;
		} else {
			throw new Error(`Unknown argument: ${a}`);
		}
	}
	return out;
}

/** @param {string} changelog @param {string} version */
function extractChangelogSection(changelog, version) {
	const lines = changelog.split(/\r?\n/);
	const start = lines.findIndex((l) => l === `## ${version}`);
	if (start < 0) return null;
	const body = [];
	for (let i = start + 1; i < lines.length; i++) {
		if (/^## /.test(lines[i])) break;
		body.push(lines[i]);
	}
	return body.join("\n").replace(/^\n+/, "").replace(/\n+$/, "");
}

/** Strip Changesets wrappers: Patch/Minor/Major headers + commit/Thanks prefixes. */
function normalizeChangesetBody(section) {
	let text = section
		.replace(/^### (Patch|Minor|Major) Changes\s*\n+/gm, "")
		.trim();

	// Changesets GitHub changelog: "- [`hash`](url) Thanks [@user](url)! - rest"
	// (backticks wrap the commit markdown link; optional PR link may precede)
	text = text.replace(/^- .+?Thanks \[@[^\]]+\]\([^)]+\)! - /gm, "- ");

	// Unindent one level of content that Changesets nests under the bullet
	// (common pattern: blank line then "  ### Section" / "  - item")
	const lines = text.split("\n");
	const out = [];
	let inNested = false;
	for (const line of lines) {
		if (/^- /.test(line)) {
			inNested = true;
			const rest = line.slice(2);
			// If the bullet is only a heading or starts a section, promote it
			if (/^#{2,4}\s/.test(rest)) {
				out.push(rest);
			} else if (rest.trim() === "") {
				out.push("");
			} else {
				out.push(rest);
			}
			continue;
		}
		if (line.trim() === "") {
			out.push("");
			continue;
		}
		if (inNested && /^  /.test(line)) {
			out.push(line.slice(2));
			continue;
		}
		inNested = false;
		out.push(line);
	}
	return out.join("\n").replace(/\n{3,}/g, "\n\n").trim();
}

/**
 * Split normalized body into summary / sections / upgrade notes.
 * @param {string} body
 */
function splitReleaseParts(body) {
	const upgradeMatch = body.match(/\n### 升级说明\n([\s\S]*?)(?=\n### |\s*$)/);
	let withoutUpgrade = body;
	let upgrade = "";
	if (upgradeMatch) {
		upgrade = upgradeMatch[1].trim();
		withoutUpgrade = (body.slice(0, upgradeMatch.index) + body.slice(upgradeMatch.index + upgradeMatch[0].length)).trim();
	}

	const firstHeading = withoutUpgrade.search(/\n### /);
	let summary = "";
	let changes = withoutUpgrade;
	if (firstHeading >= 0) {
		summary = withoutUpgrade.slice(0, firstHeading).trim();
		changes = withoutUpgrade.slice(firstHeading + 1).trim(); // drop leading \n
	} else {
		// No ### sections: treat whole body as 变更内容 bullets / prose
		summary = "";
		changes = withoutUpgrade;
	}

	// If summary accidentally starts with a list-only leftover, keep empty
	if (/^### /.test(summary)) {
		changes = `${summary}\n\n${changes}`.trim();
		summary = "";
	}

	return { summary, changes, upgrade };
}

function defaultUpgradeNotes() {
	return [
		"- 数据库迁移：无",
		"- 配置变更：无",
		"- 兼容性影响：无",
		"- 建议操作：更新 proxy / admin / migrate 三镜像后滚动重启",
	].join("\n");
}

function defaultSummary(version) {
	return `OctaFuse Gateway **v${version}**。`;
}

/**
 * @param {object} opts
 * @param {string} opts.version
 * @param {string} opts.summary
 * @param {string} opts.changes
 * @param {string} opts.upgrade
 * @param {Record<string, string>} opts.digests
 * @param {string} opts.repo
 * @param {string} opts.prevTag
 * @param {string} opts.ownerRepoLc
 */
function renderNotes(opts) {
	const tag = `v${opts.version}`;
	const repoLc =
		opts.ownerRepoLc ||
		opts.repo.toLowerCase();
	const prev = opts.prevTag || "";
	const compare =
		prev.length > 0
			? `https://github.com/${opts.repo}/compare/${prev}...${tag}`
			: `https://github.com/${opts.repo}/releases/tag/${tag}`;

	const lines = [];
	lines.push("## 本次更新");
	lines.push("");
	lines.push(opts.summary || defaultSummary(opts.version));
	lines.push("");
	lines.push("## 变更内容");
	lines.push("");
	lines.push(opts.changes || "_(无 CHANGELOG 段落；请核对 Version PR。)_");
	lines.push("");
	lines.push("## 升级说明");
	lines.push("");
	lines.push(opts.upgrade || defaultUpgradeNotes());
	lines.push("");
	lines.push("<details>");
	lines.push("<summary><strong>容器镜像与 SHA256 digest</strong></summary>");
	lines.push("");
	lines.push(`Tag **${tag}** — multi-arch manifest digests：`);
	lines.push("");
	for (const name of ["proxy", "admin", "migrate"]) {
		const d = opts.digests[name];
		lines.push(`### ${name[0].toUpperCase()}${name.slice(1)}`);
		lines.push("");
		lines.push(`- 镜像：\`ghcr.io/${repoLc}-${name}:${tag}\``);
		if (d) {
			lines.push(`- Digest：\`${d}\``);
			lines.push(`- 固定拉取：\`ghcr.io/${repoLc}-${name}@${d}\``);
		} else {
			lines.push("- Digest：_(缺失)_");
		}
		lines.push("");
	}
	lines.push("可按 digest 做可复现部署，或在核对 digest 后使用 tag。");
	lines.push("");
	lines.push("</details>");
	lines.push("");
	lines.push("## 相关链接");
	lines.push("");
	lines.push(`- [完整代码差异](${compare})`);
	lines.push(
		`- [完整 CHANGELOG](https://github.com/${opts.repo}/blob/${tag}/CHANGELOG.md)`,
	);
	lines.push(
		`- [发版流程](https://github.com/${opts.repo}/blob/${tag}/docs/maintainers/release-versioning.md)`,
	);
	lines.push("");
	return lines.join("\n");
}

function guessPrevTag(changelog, version) {
	const lines = changelog.split(/\r?\n/);
	const start = lines.findIndex((l) => l === `## ${version}`);
	if (start < 0) return "";
	for (let i = start + 1; i < lines.length; i++) {
		const m = lines[i].match(/^## (\d+\.\d+\.\d+(?:-[\w.]+)?)\s*$/);
		if (m) return `v${m[1]}`;
	}
	return "";
}

function main() {
	const args = parseArgs(process.argv.slice(2));
	if (args.help || !args.version) {
		console.log(`Usage: node scripts/release/render-release-notes.mjs --version X.Y.Z [options]

Options:
  --changelog PATH       Default: ./CHANGELOG.md
  --out PATH             Write notes to file (default: stdout)
  --repo OWNER/NAME      Default: ${DEFAULT_REPO}
  --prev-tag vX.Y.Z      Compare link base (default: previous ## in CHANGELOG)
  --owner-repo-lc name   GHCR image prefix (default: lowercased --repo)
  --digest name=sha256:… Repeatable for proxy / admin / migrate
`);
		process.exit(args.help ? 0 : 1);
	}

	const overridePath = join(root, "docs", "releases", `${args.version}.md`);
	let summary = "";
	let changes = "";
	let upgrade = "";

	if (existsSync(overridePath)) {
		const override = readFileSync(overridePath, "utf8").trim();
		const parts = splitReleaseParts(
			override
				.replace(/^## 本次更新\s*\n+/m, "")
				.replace(/^## 变更内容\s*\n+/m, "### __CHANGES_ANCHOR__\n")
				.replace(/^## 升级说明\s*\n+/m, "### 升级说明\n"),
		);
		// If override used ## headings already, re-parse more simply:
		const raw = readFileSync(overridePath, "utf8");
		const sumM = raw.match(/## 本次更新\s*\n+([\s\S]*?)(?=\n## |\s*$)/);
		const chM = raw.match(/## 变更内容\s*\n+([\s\S]*?)(?=\n## |\s*$)/);
		const upM = raw.match(/## 升级说明\s*\n+([\s\S]*?)(?=\n## |\s*$)/);
		if (sumM || chM) {
			summary = (sumM?.[1] ?? "").trim();
			changes = (chM?.[1] ?? "").trim();
			upgrade = (upM?.[1] ?? "").trim();
		} else {
			({ summary, changes, upgrade } = parts);
			if (changes.startsWith("### __CHANGES_ANCHOR__")) {
				changes = changes.replace(/^### __CHANGES_ANCHOR__\n*/, "").trim();
			}
		}
	} else {
		const changelog = readFileSync(args.changelog, "utf8");
		const section = extractChangelogSection(changelog, args.version);
		if (!section) {
			summary = defaultSummary(args.version);
			changes = `_(CHANGELOG 中未找到 \`## ${args.version}\` 段落；请核对 Version PR 是否更新了 CHANGELOG。)_`;
		} else {
			const normalized = normalizeChangesetBody(section);
			({ summary, changes, upgrade } = splitReleaseParts(normalized));
		}
		if (!args.prevTag) {
			args.prevTag = guessPrevTag(readFileSync(args.changelog, "utf8"), args.version);
		}
	}

	if (!args.prevTag && existsSync(args.changelog)) {
		args.prevTag = guessPrevTag(readFileSync(args.changelog, "utf8"), args.version);
	}

	const notes = renderNotes({
		version: args.version,
		summary,
		changes,
		upgrade,
		digests: args.digests,
		repo: args.repo,
		prevTag: args.prevTag,
		ownerRepoLc: args.ownerRepoLc,
	});

	if (args.out) {
		writeFileSync(args.out, notes, "utf8");
		console.error(`Wrote ${args.out}`);
	} else {
		process.stdout.write(notes);
		if (!notes.endsWith("\n")) process.stdout.write("\n");
	}
}

main();
