#!/usr/bin/env node
/**
 * After `changeset tag`, ensure the root semver tag **vX.Y.Z** exists on origin.
 *
 * - `changesets/action` does not push tags when `createGithubReleases` is false.
 * - `changeset tag` with default config **does not** create `v*` tags for **private**
 *   workspace packages (`privatePackages.tag` defaults to false); it may create
 *   nothing or only `name@version` tags. This script always creates/pushes **vX.Y.Z**
 *   aligned with root `package.json` `version`.
 */
import { execFileSync, execSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = join(__dirname, "../..");
const pkg = JSON.parse(readFileSync(join(root, "package.json"), "utf8"));
const version = pkg.version;
const vTag = `v${version}`;

function runCapture(cmd, args) {
	return execFileSync(cmd, args, { cwd: root, encoding: "utf8" }).trim();
}

function refExists(ref) {
	try {
		runCapture("git", ["rev-parse", "-q", "--verify", `${ref}^{commit}`]);
		return true;
	} catch {
		return false;
	}
}

if (!refExists(`refs/tags/${vTag}`)) {
	const candidates = [
		`octafuse@${version}`,
		`@octafuse/core@${version}`,
		`@octafuse/proxy@${version}`,
		`@octafuse/admin@${version}`,
	];
	let commit = "";
	for (const c of candidates) {
		if (refExists(`refs/tags/${c}`)) {
			commit = runCapture("git", ["rev-parse", `${c}^{commit}`]);
			console.log(`Creating ${vTag} at ${commit} (from tag ${c})`);
			break;
		}
	}
	if (!commit) {
		commit = runCapture("git", ["rev-parse", "HEAD"]);
		console.log(
			`Creating ${vTag} at HEAD ${commit} (no per-package tag from changeset; typical for private workspaces)`,
		);
	}
	execFileSync(
		"git",
		["tag", "-a", vTag, "-m", `release ${version}`, commit],
		{ cwd: root, stdio: "inherit" },
	);
} else {
	console.log(`Local tag ${vTag} already exists.`);
}

console.log(`Pushing release tag ${vTag} to origin...`);
execSync(`git push origin "${vTag}"`, { cwd: root, stdio: "inherit" });
