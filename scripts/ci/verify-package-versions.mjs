#!/usr/bin/env node
/**
 * Ensures root + all workspace packages share the same "version" (fixed monorepo line).
 * When GITHUB_REF_NAME is set and looks like vX.Y.Z, also assert it matches package.json.
 */
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = join(__dirname, "../..");

const paths = [
	join(root, "package.json"),
	join(root, "packages/core/package.json"),
	join(root, "packages/proxy/package.json"),
	join(root, "packages/admin/package.json"),
];

const versions = paths.map((p) => {
	const v = JSON.parse(readFileSync(p, "utf8")).version;
	if (!v || typeof v !== "string") {
		throw new Error(`Missing version in ${p}`);
	}
	return v;
});

const uniq = [...new Set(versions)];
if (uniq.length !== 1) {
	console.error("Package version mismatch. Expected one version across:");
	for (let i = 0; i < paths.length; i++) {
		console.error(`  ${paths[i]} -> ${versions[i]}`);
	}
	process.exit(1);
}

const pkgVersion = uniq[0];
const refName = process.env.GITHUB_REF_NAME ?? "";
const refType = process.env.GITHUB_REF_TYPE ?? "";
if (refType === "tag" && refName.startsWith("v")) {
	const stripped = refName.slice(1);
	if (stripped !== pkgVersion) {
		console.error(
			`Git tag ${refName} does not match package.json version ${pkgVersion}.`,
		);
		process.exit(1);
	}
}

console.log(`OK: all package versions == ${pkgVersion}`);
