#!/usr/bin/env node
/**
 * Generate wrangler.jsonc / wrangler.d1.jsonc from *.base.jsonc + environment variables.
 *
 * Build variables (Workers Builds) or cloudflare-worker/*.env — see docs/ops/deployment-cloudflare.md
 */
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, "../..");

const REMOTE = process.argv.includes("--remote");

function trimEnv(key) {
	const v = process.env[key];
	return typeof v === "string" ? v.trim() : "";
}

function suffix(instance) {
	return instance ? `-${instance}` : "";
}

function resolveNames() {
	const instance = trimEnv("CF_INSTANCE");
	const sfx = suffix(instance);

	const d1DatabaseName =
		trimEnv("D1_DATABASE_NAME") || `octafuse-gateway${sfx}`;

	return {
		instance,
		proxyWorkerName:
			trimEnv("PROXY_WORKER_NAME") || `octafuse-gateway-proxy${sfx}`,
		adminWorkerName:
			trimEnv("ADMIN_WORKER_NAME") || `octafuse-gateway-admin${sfx}`,
		d1MigrationsWorkerName:
			trimEnv("D1_MIGRATIONS_WORKER_NAME") ||
			`octafuse-d1-migrations${sfx}`,
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

function customDomainRoutes(domain) {
	if (!domain) {
		return undefined;
	}
	return [{ pattern: domain, custom_domain: true }];
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

	console.log(
		`gen-wrangler: proxy=${names.proxyWorkerName} admin=${names.adminWorkerName} d1=${names.d1DatabaseName}` +
			(names.d1DatabaseId ? ` id=${names.d1DatabaseId}` : " (local, no database_id)"),
	);
}

main();
