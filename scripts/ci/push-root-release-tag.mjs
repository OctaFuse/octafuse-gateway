#!/usr/bin/env node
/**
 * After `changeset tag`, push the root semver tag (vX.Y.Z) to origin.
 *
 * changesets/action only calls git.pushTag() when createGithubReleases is true;
 * we keep createGithubReleases false (Docker workflow owns GitHub Release), so we push here.
 *
 * If `changeset tag` skipped (e.g. tag already exists on origin), there is no local tag — exit 0.
 */
import { execSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = join(__dirname, "../..");
const pkg = JSON.parse(readFileSync(join(root, "package.json"), "utf8"));
const tag = `v${pkg.version}`;

function localTagPointsToCommit() {
	try {
		execSync(`git rev-parse -q --verify "refs/tags/${tag}^{commit}"`, {
			cwd: root,
			stdio: "pipe",
		});
		return true;
	} catch {
		return false;
	}
}

if (!localTagPointsToCommit()) {
	console.log(
		`No local tag ${tag} after "changeset tag". Usually: origin already has this tag (same version on a different commit), or versions were not bumped.`,
	);
	process.exit(0);
}

console.log(`Pushing release tag ${tag} to origin...`);
execSync(`git push origin "${tag}"`, { cwd: root, stdio: "inherit" });
