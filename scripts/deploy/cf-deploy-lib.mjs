/**
 * Shared helpers for Cloudflare bootstrap / instance deploy CLIs.
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";
import readline from "node:readline/promises";
import { stdin as input, stdout as output } from "node:process";

const __dirname = dirname(fileURLToPath(import.meta.url));
export const REPO_ROOT = join(__dirname, "../..");
export const CF_WORKER_DIR = join(REPO_ROOT, "cloudflare-worker");

export function log(msg) {
	console.log(`[cf-deploy] ${msg}`);
}

export function logError(msg) {
	console.error(`[cf-deploy] ERROR: ${msg}`);
}

export function envPathForInstance(instance) {
	return join(CF_WORKER_DIR, `${instance}.env`);
}

/** Parse KEY=VALUE lines from a dotenv-style file (no expansion). */
export function parseEnvFile(filePath) {
	const text = readFileSync(filePath, "utf8");
	/** @type {Record<string, string>} */
	const env = {};
	for (const rawLine of text.split("\n")) {
		const line = rawLine.trim();
		if (!line || line.startsWith("#")) {
			continue;
		}
		const eq = line.indexOf("=");
		if (eq <= 0) {
			continue;
		}
		const key = line.slice(0, eq).trim();
		let value = line.slice(eq + 1).trim();
		if (
			(value.startsWith('"') && value.endsWith('"')) ||
			(value.startsWith("'") && value.endsWith("'"))
		) {
			value = value.slice(1, -1);
		}
		env[key] = value;
	}
	return env;
}

/**
 * @param {Record<string, string>} vars
 * @param {string[]} [extraArgs]
 */
export function runNpmWithEnv(vars, extraArgs) {
	const env = { ...process.env, ...vars };
	const args = ["npm", "run", ...extraArgs];
	log(`>>> ${args.join(" ")}`);
	const result = spawnSync(args[0], args.slice(1), {
		cwd: REPO_ROOT,
		env,
		stdio: "inherit",
		shell: true,
	});
	if ((result.status ?? 1) !== 0) {
		throw new Error(`command failed (${result.status}): ${args.join(" ")}`);
	}
}

/**
 * @param {string[]} wranglerArgs
 * @param {{ env?: Record<string, string>, input?: string, capture?: boolean }} [opts]
 */
export function runWrangler(wranglerArgs, opts = {}) {
	const env = { ...process.env, ...(opts.env || {}) };
	const stdio = opts.capture
		? ["pipe", "pipe", "pipe"]
		: opts.input !== undefined
			? ["pipe", "inherit", "inherit"]
			: "inherit";
	log(`>>> npx wrangler ${wranglerArgs.join(" ")}`);
	const result = spawnSync("npx", ["wrangler", ...wranglerArgs], {
		cwd: REPO_ROOT,
		env,
		stdio,
		shell: true,
		input: opts.input,
		encoding: opts.capture ? "utf8" : undefined,
	});
	if ((result.status ?? 1) !== 0) {
		if (opts.capture) {
			const err = (result.stderr || result.stdout || "").toString().trim();
			throw new Error(
				`wrangler failed (${result.status}): ${wranglerArgs.join(" ")}${err ? `\n${err}` : ""}`,
			);
		}
		throw new Error(`wrangler failed (${result.status}): ${wranglerArgs.join(" ")}`);
	}
	if (opts.capture) {
		return {
			stdout: (result.stdout || "").toString(),
			stderr: (result.stderr || "").toString(),
		};
	}
	return { stdout: "", stderr: "" };
}

export function assertWranglerLoggedIn() {
	try {
		runWrangler(["whoami"], { capture: true });
	} catch {
		logError("Not logged in to Cloudflare. Run: npx wrangler login");
		process.exit(1);
	}
	log("Cloudflare auth OK (wrangler whoami)");
}

/**
 * @returns {Array<{ name: string, uuid: string }>}
 */
export function listD1Databases() {
	const { stdout } = runWrangler(["d1", "list", "--json"], { capture: true });
	const trimmed = stdout.trim();
	if (!trimmed) {
		return [];
	}
	try {
		const parsed = JSON.parse(trimmed);
		if (Array.isArray(parsed)) {
			return parsed.map((row) => ({
				name: String(row.name || row.database_name || ""),
				uuid: String(row.uuid || row.database_id || ""),
			}));
		}
		if (Array.isArray(parsed?.result)) {
			return parsed.result.map((row) => ({
				name: String(row.name || row.database_name || ""),
				uuid: String(row.uuid || row.database_id || ""),
			}));
		}
	} catch {
		// fall through to line parse
	}
	/** @type {Array<{ name: string, uuid: string }>} */
	const rows = [];
	const uuidRe =
		/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i;
	for (const line of trimmed.split("\n")) {
		const m = line.match(uuidRe);
		if (!m) {
			continue;
		}
		const uuid = m[0];
		const name = line.replace(uuid, "").replace(/[│|]/g, " ").trim().split(/\s+/)[0];
		if (name) {
			rows.push({ name, uuid });
		}
	}
	return rows;
}

/**
 * @param {string} databaseName
 * @returns {string} database_id
 */
export function createD1Database(databaseName) {
	const { stdout, stderr } = runWrangler(["d1", "create", databaseName], {
		capture: true,
	});
	const combined = `${stdout}\n${stderr}`;
	const uuidRe =
		/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i;
	const idMatch = combined.match(/database_id\s*=\s*"?([^"\s]+)"?/i);
	if (idMatch?.[1] && uuidRe.test(idMatch[1])) {
		return idMatch[1];
	}
	const any = combined.match(uuidRe);
	if (any) {
		return any[0];
	}
	throw new Error(
		`Could not parse database_id from wrangler d1 create output.\n${combined}`,
	);
}

/**
 * Resolve D1 id: reuse existing by name, or create.
 * @param {string} databaseName
 * @param {{ reuse?: boolean }} [opts]
 */
export function ensureD1Database(databaseName, opts = {}) {
	const existing = listD1Databases().find((d) => d.name === databaseName);
	if (existing?.uuid) {
		log(`Reusing existing D1 "${databaseName}" (${existing.uuid})`);
		return existing.uuid;
	}
	if (opts.reuse) {
		throw new Error(
			`D1 "${databaseName}" not found. Create it or omit --reuse-d1.`,
		);
	}
	log(`Creating D1 database "${databaseName}"…`);
	const id = createD1Database(databaseName);
	log(`Created D1 "${databaseName}" id=${id}`);
	return id;
}

/**
 * @param {string} instance
 * @param {{
 *   proxyWorkerName: string,
 *   adminWorkerName: string,
 *   d1DatabaseName: string,
 *   d1DatabaseId: string,
 *   d1MigrationsWorkerName: string,
 *   proxyCustomDomain?: string,
 *   adminCustomDomain?: string,
 * }} names
 */
export function writeInstanceEnvFile(instance, names) {
	if (!existsSync(CF_WORKER_DIR)) {
		mkdirSync(CF_WORKER_DIR, { recursive: true });
	}
	const path = envPathForInstance(instance);
	const lines = [
		`# Generated by npm run bootstrap:cloudflare — do not commit`,
		`# Instance: ${instance}`,
		`# Docs: docs/operators/deployment/cloudflare-quickstart.md`,
		``,
		`PROXY_WORKER_NAME=${names.proxyWorkerName}`,
		`ADMIN_WORKER_NAME=${names.adminWorkerName}`,
		``,
		`D1_DATABASE_NAME=${names.d1DatabaseName}`,
		`D1_DATABASE_ID=${names.d1DatabaseId}`,
		`D1_MIGRATIONS_WORKER_NAME=${names.d1MigrationsWorkerName}`,
		``,
	];
	if (names.proxyCustomDomain) {
		lines.push(`PROXY_CUSTOM_DOMAIN=${names.proxyCustomDomain}`);
	} else {
		lines.push(`# PROXY_CUSTOM_DOMAIN=`);
	}
	if (names.adminCustomDomain) {
		lines.push(`ADMIN_CUSTOM_DOMAIN=${names.adminCustomDomain}`);
	} else {
		lines.push(`# ADMIN_CUSTOM_DOMAIN=`);
	}
	lines.push("");
	writeFileSync(path, lines.join("\n"), "utf8");
	log(`Wrote ${path}`);
	return path;
}

/**
 * @param {string} adminWorkerName
 * @param {string | undefined} password  if omitted, wrangler prompts interactively
 */
export function putAdminPasswordSecret(adminWorkerName, password) {
	const args = ["secret", "put", "ADMIN_PASSWORD", "--name", adminWorkerName];
	if (password !== undefined && password !== "") {
		runWrangler(args, { input: `${password}\n` });
	} else {
		log("Enter ADMIN_PASSWORD when wrangler prompts (not stored in .env)…");
		runWrangler(args);
	}
}

/**
 * Best-effort MASTER_KEY read after remote migrate.
 * @param {Record<string, string>} vars
 */
export function fetchRemoteMasterKey(vars) {
	const env = { ...process.env, ...vars };
	// Ensure generated config matches instance
	const gen = spawnSync(
		"npm",
		["run", "gen:wrangler", "--", "--remote"],
		{ cwd: REPO_ROOT, env, stdio: "pipe", shell: true, encoding: "utf8" },
	);
	if ((gen.status ?? 1) !== 0) {
		return null;
	}
	const result = spawnSync(
		"npx",
		[
			"wrangler",
			"d1",
			"execute",
			vars.D1_DATABASE_NAME,
			"--remote",
			"--config",
			"./packages/core/wrangler.d1.jsonc",
			"--json",
			"--command",
			"SELECT value FROM system_config WHERE key = 'MASTER_KEY' LIMIT 1",
		],
		{ cwd: REPO_ROOT, env, stdio: "pipe", shell: true, encoding: "utf8" },
	);
	if ((result.status ?? 1) !== 0) {
		return null;
	}
	const out = (result.stdout || "").trim();
	try {
		const parsed = JSON.parse(out);
		const results = Array.isArray(parsed) ? parsed : [parsed];
		for (const block of results) {
			const rows = block?.results || block?.result?.[0]?.results;
			if (Array.isArray(rows) && rows[0]?.value) {
				return String(rows[0].value);
			}
		}
	} catch {
		const m = out.match(/sk-[^\s"']+/);
		if (m) {
			return m[0];
		}
	}
	return null;
}

export function printLocalDevHint() {
	log("Remote deploy wrote D1 database_id into generated wrangler.jsonc.");
	log("Before local dev:proxy / dev:admin, run:");
	log("  npm run gen:wrangler");
	log(
		"See docs/developers/local-development.md §1 (database_id).",
	);
}

/**
 * @param {string} question
 * @param {string} [defaultValue]
 */
export async function promptLine(question, defaultValue) {
	const rl = readline.createInterface({ input, output });
	try {
		const suffix =
			defaultValue !== undefined && defaultValue !== ""
				? ` [${defaultValue}]`
				: "";
		const answer = (await rl.question(`${question}${suffix}: `)).trim();
		return answer || defaultValue || "";
	} finally {
		rl.close();
	}
}

/**
 * @param {string} question
 * @param {boolean} [defaultYes]
 */
export async function promptYesNo(question, defaultYes = true) {
	const hint = defaultYes ? "Y/n" : "y/N";
	const answer = (await promptLine(`${question} (${hint})`, "")).toLowerCase();
	if (!answer) {
		return defaultYes;
	}
	return answer === "y" || answer === "yes";
}

/**
 * Build default Worker / D1 names from a prefix.
 * @param {string} prefix e.g. octafuse-gateway
 */
export function namesFromPrefix(prefix) {
	const p = prefix.replace(/\/+$/, "").trim();
	return {
		proxyWorkerName: `${p}-proxy`,
		adminWorkerName: `${p}-admin`,
		d1DatabaseName: p,
		d1MigrationsWorkerName: `${p}-d1-migrations`,
	};
}

export function printDownstreamHints({
	proxyUrl,
	adminUrl,
	masterKey,
	proxyWorkerName,
	adminWorkerName,
}) {
	console.log("");
	log("=== Downstream env (portal / clients) ===");
	if (proxyUrl) {
		console.log(`GATEWAY_URL=${proxyUrl}`);
	} else {
		console.log(
			`GATEWAY_URL=https://<account-subdomain>.workers.dev  # Worker: ${proxyWorkerName}`,
		);
		console.log(
			`# Or open Dashboard → Workers → ${proxyWorkerName} for the workers.dev URL`,
		);
	}
	if (adminUrl) {
		console.log(`GATEWAY_MASTER_URL=${adminUrl}`);
	} else {
		console.log(
			`GATEWAY_MASTER_URL=https://<account-subdomain>.workers.dev  # Worker: ${adminWorkerName}`,
		);
	}
	if (masterKey) {
		console.log(`GATEWAY_MASTER_KEY=${masterKey}`);
		if (masterKey === "sk-dev-admin-key") {
			log(
				"WARNING: MASTER_KEY is still the seed value sk-dev-admin-key. Rotate it in Admin → Config before production use.",
			);
		}
	} else {
		console.log(
			`GATEWAY_MASTER_KEY=<from D1 system_config.MASTER_KEY — Admin Config or: npm run deploy:cloudflare -- <instance> --show-master-key>`,
		);
	}
	console.log("");
	log("Verify: GET $GATEWAY_URL/health · open $GATEWAY_MASTER_URL and sign in with ADMIN_PASSWORD");
}
