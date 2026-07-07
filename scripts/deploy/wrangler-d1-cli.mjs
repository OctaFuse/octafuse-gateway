#!/usr/bin/env node
/**
 * Run wrangler d1 against the generated wrangler.d1.jsonc (database name from config).
 * Usage: node scripts/deploy/wrangler-d1-cli.mjs migrations apply --remote
 */
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, "../..");
const D1_CONFIG = join(ROOT, "packages/core/wrangler.d1.jsonc");

function loadDatabaseName() {
	let config;
	try {
		config = JSON.parse(readFileSync(D1_CONFIG, "utf8"));
	} catch {
		console.error(
			"wrangler-d1-cli: missing packages/core/wrangler.d1.jsonc — run npm run gen:wrangler first",
		);
		process.exit(1);
	}
	const name = config?.d1_databases?.[0]?.database_name;
	if (!name) {
		console.error("wrangler-d1-cli: database_name not found in wrangler.d1.jsonc");
		process.exit(1);
	}
	return name;
}

const databaseName = loadDatabaseName();
const wranglerArgs = process.argv.slice(2);

if (wranglerArgs.length === 0) {
	console.error(
		"wrangler-d1-cli: usage: node scripts/deploy/wrangler-d1-cli.mjs migrations apply [--remote|--local ...]",
	);
	process.exit(1);
}

const args = [
	"d1",
	...wranglerArgs,
	databaseName,
	"--config",
	"./packages/core/wrangler.d1.jsonc",
];

const result = spawnSync("npx", ["wrangler", ...args], {
	cwd: ROOT,
	stdio: "inherit",
	shell: true,
});

process.exit(result.status ?? 1);
