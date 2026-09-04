#!/usr/bin/env node
/**
 * Generate wrangler.jsonc / wrangler.d1.jsonc from *.base.jsonc + environment variables.
 *
 * Build variables (Workers Builds) or cloudflare-worker/*.env — see docs/operators/deployment/cloudflare.md
 *
 * Local D1 identity (important):
 * - Without D1_DATABASE_ID in env → generated configs have no database_id → local dev uses D1 "(DB)".
 * - With D1_DATABASE_ID (remote deploy / db:migrate:remote) → local wrangler dev uses a *different*
 *   SQLite under .wrangler/state than npm run db:migrate (default local path).
 * After any remote deploy on this machine, run `npm run gen:wrangler` (no D1_DATABASE_ID in shell)
 * before dev:proxy / dev:admin. See docs/developers/local-development.md §1.
 */
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, "../..");

const REMOTE = process.argv.includes("--remote");

function trimEnv(key) {
	const v = process.env[key];
	return typeof v === "string" ? v.trim() : "";
}

function resolveNames() {
	const d1DatabaseName =
		trimEnv("D1_DATABASE_NAME") || "octafuse-gateway";

	return {
		proxyWorkerName:
			trimEnv("PROXY_WORKER_NAME") || "octafuse-gateway-proxy",
		adminWorkerName:
			trimEnv("ADMIN_WORKER_NAME") || "octafuse-gateway-admin",
		d1MigrationsWorkerName:
			trimEnv("D1_MIGRATIONS_WORKER_NAME") ||
			"octafuse-d1-migrations",
		d1DatabaseName,
		d1DatabaseId: trimEnv("D1_DATABASE_ID"),
		proxyCustomDomain: trimEnv("PROXY_CUSTOM_DOMAIN"),
		adminCustomDomain: trimEnv("ADMIN_CUSTOM_DOMAIN"),
	};
}

/** Strip // and block comments so JSONC base templates parse. */
function parseJsonc(text) {
	const withoutBlock = text.replace(/\/\*[\s\S]*?\*\//g, "");
	const lines = withoutBlock.split("\n").map((line) => {
		const idx = line.indexOf("//");
		return idx >= 0 ? line.slice(0, idx) : line;
	});
	return JSON.parse(lines.join("\n"));
}

function readBase(relativePath) {
	const path = join(ROOT, relativePath);
	return parseJsonc(readFileSync(path, "utf8"));
}

function writeJson(relativePath, data) {
	const path = join(ROOT, relativePath);
	writeFileSync(path, `${JSON.stringify(data, null, "\t")}\n`, "utf8");
	console.log(`gen-wrangler: wrote ${relativePath}`);
}

function applyD1Binding(binding, databaseName, databaseId) {
	const next = { ...binding, database_name: databaseName };
	if (databaseId) {
		next.database_id = databaseId;
	} else {
		delete next.database_id;
	}
	return next;
}

/**
 * Split `PROXY_CUSTOM_DOMAIN` / `ADMIN_CUSTOM_DOMAIN` into distinct hostnames.
 * Comma-separated; whitespace around hosts is ignored; empty tokens dropped;
 * duplicates are de-duped case-insensitively (first spelling kept).
 *
 * @param {string | undefined} raw
 * @returns {string[]}
 */
export function parseCustomDomains(raw) {
	if (typeof raw !== "string" || !raw.trim()) {
		return [];
	}
	const seen = new Set();
	const hosts = [];
	for (const part of raw.split(",")) {
		const host = part.trim();
		if (!host) {
			continue;
		}
		const key = host.toLowerCase();
		if (seen.has(key)) {
			continue;
		}
		seen.add(key);
		hosts.push(host);
	}
	return hosts;
}

/** First hostname, for bootstrap URL hints (`https://a,b` is not a valid URL). */
export function primaryCustomDomain(raw) {
	return parseCustomDomains(raw)[0] ?? "";
}

/**
 * Wrangler `routes` for Custom Domains. One Worker, N hostnames.
 * Returns `undefined` when the env var is empty so callers can `delete config.routes`.
 *
 * @param {string | undefined} raw
 * @returns {{ pattern: string, custom_domain: true }[] | undefined}
 */
export function customDomainRoutes(raw) {
	const hosts = parseCustomDomains(raw);
	if (hosts.length === 0) {
		return undefined;
	}
	return hosts.map((pattern) => ({ pattern, custom_domain: true }));
}

function generateProxy(names) {
	const base = readBase("packages/proxy/wrangler.base.jsonc");
	const config = {
		...base,
		name: names.proxyWorkerName,
		d1_databases: [
			applyD1Binding(
				base.d1_databases[0],
				names.d1DatabaseName,
				names.d1DatabaseId,
			),
		],
	};
	const routes = customDomainRoutes(names.proxyCustomDomain);
	if (routes) {
		config.routes = routes;
	} else {
		delete config.routes;
	}

	writeJson("packages/proxy/wrangler.jsonc", config);
}

function generateAdmin(names) {
	const base = readBase("packages/admin/wrangler.base.jsonc");
	const config = {
		...base,
		name: names.adminWorkerName,
		d1_databases: [
			applyD1Binding(
				base.d1_databases[0],
				names.d1DatabaseName,
				names.d1DatabaseId,
			),
		],
	};

	const routes = customDomainRoutes(names.adminCustomDomain);
	if (routes) {
		config.routes = routes;
	} else {
		delete config.routes;
	}

	writeJson("packages/admin/wrangler.jsonc", config);
}

function generateD1(names) {
	const base = readBase("packages/core/wrangler.d1.base.jsonc");
	const config = {
		...base,
		name: names.d1MigrationsWorkerName,
		d1_databases: [
			applyD1Binding(
				base.d1_databases[0],
				names.d1DatabaseName,
				names.d1DatabaseId,
			),
		],
	};

	writeJson("packages/core/wrangler.d1.jsonc", config);
}

function validateRemote(names) {
	if (names.d1DatabaseId) {
		return;
	}
	console.error(
		"gen-wrangler: D1_DATABASE_ID is required for remote deploy/migrate.\n" +
			"  Set it in Workers Builds › Build variables, or:\n" +
			"  npx dotenv -e ./cloudflare-worker/<instance>.env -- npm run gen:wrangler -- --remote",
	);
	process.exit(1);
}

function main() {
	const names = resolveNames();

	if (REMOTE) {
		validateRemote(names);
	}

	generateProxy(names);
	generateAdmin(names);
	generateD1(names);

	const proxyDomains = parseCustomDomains(names.proxyCustomDomain);
	const adminDomains = parseCustomDomains(names.adminCustomDomain);
	console.log(
		`gen-wrangler: proxy=${names.proxyWorkerName} admin=${names.adminWorkerName} d1=${names.d1DatabaseName}` +
			(names.d1DatabaseId ? ` id=${names.d1DatabaseId}` : " (local, no database_id)") +
			(proxyDomains.length ? ` proxyDomains=${proxyDomains.join(",")}` : "") +
			(adminDomains.length ? ` adminDomains=${adminDomains.join(",")}` : ""),
	);

	if (REMOTE && names.d1DatabaseId) {
		console.warn(
			"gen-wrangler: remote config written (includes database_id). " +
				"Before local dev:proxy/dev:admin, run `npm run gen:wrangler` without D1_DATABASE_ID in the shell.",
		);
	}
}

function isDirectRun() {
	const entry = process.argv[1];
	if (!entry) {
		return false;
	}
	return import.meta.url === pathToFileURL(entry).href;
}

if (isDirectRun()) {
	main();
}
