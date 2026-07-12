#!/usr/bin/env node
/**
 * First-time Cloudflare bootstrap for external self-hosters:
 * login check → create/reuse D1 → write instance env → migrate → deploy
 * proxy + admin → ADMIN_PASSWORD secret → print downstream hints.
 *
 * Usage (repo root):
 *   npm run bootstrap:cloudflare
 *   node scripts/deploy/bootstrap-cloudflare.mjs [options]
 *
 * Options:
 *   --instance <name>           Env file basename (default: interactive / "default")
 *   --prefix <prefix>           Worker/D1 name prefix (default: octafuse-gateway)
 *   --proxy-domain <host>       Optional custom domain for Proxy
 *   --admin-domain <host>       Optional custom domain for Admin
 *   --admin-password-env <VAR>  Read ADMIN_PASSWORD from that env var (non-interactive)
 *   --reuse-d1                  Fail if D1 name missing (do not create)
 *   --d1-id <uuid>              Use this D1 id (skip create/list match by name)
 *   --skip-secret               Do not set ADMIN_PASSWORD Worker secret
 *   --yes, -y                   Accept defaults; non-interactive where possible
 *   --help, -h
 */
import { existsSync } from "node:fs";
import {
	assertWranglerLoggedIn,
	ensureD1Database,
	envPathForInstance,
	fetchRemoteMasterKey,
	log,
	logError,
	namesFromPrefix,
	printDownstreamHints,
	printLocalDevHint,
	promptLine,
	promptYesNo,
	putAdminPasswordSecret,
	runNpmWithEnv,
	writeInstanceEnvFile,
} from "./cf-deploy-lib.mjs";

function usage() {
	console.log(`Usage: npm run bootstrap:cloudflare -- [options]

First-time Cloudflare deploy (Proxy + Admin + shared D1).

Options:
  --instance <name>           cloudflare-worker/<name>.env (default: default)
  --prefix <prefix>           Names: <prefix>-proxy / -admin / D1 <prefix>
                              (default: octafuse-gateway)
  --proxy-domain <host>       Optional Proxy custom domain
  --admin-domain <host>       Optional Admin custom domain
  --admin-password-env <VAR>  Password from process.env[VAR] (no prompt)
  --reuse-d1                  Require existing D1 with that name
  --d1-id <uuid>              Use existing D1 id directly
  --skip-secret               Skip wrangler secret put ADMIN_PASSWORD
  --yes, -y                   Non-interactive defaults
  --help, -h

Example:
  npm run bootstrap:cloudflare -- --instance mygw --prefix my-gateway -y
`);
}

/**
 * @param {string[]} argv
 */
function parseArgs(argv) {
	/** @type {Record<string, string | boolean>} */
	const out = {
		yes: false,
		reuseD1: false,
		skipSecret: false,
	};
	for (let i = 0; i < argv.length; i++) {
		const a = argv[i];
		const next = () => {
			const v = argv[++i];
			if (!v || v.startsWith("-")) {
				throw new Error(`missing value for ${a}`);
			}
			return v;
		};
		switch (a) {
			case "--help":
			case "-h":
				out.help = true;
				break;
			case "--yes":
			case "-y":
				out.yes = true;
				break;
			case "--reuse-d1":
				out.reuseD1 = true;
				break;
			case "--skip-secret":
				out.skipSecret = true;
				break;
			case "--instance":
				out.instance = next();
				break;
			case "--prefix":
				out.prefix = next();
				break;
			case "--proxy-domain":
				out.proxyDomain = next();
				break;
			case "--admin-domain":
				out.adminDomain = next();
				break;
			case "--admin-password-env":
				out.adminPasswordEnv = next();
				break;
			case "--d1-id":
				out.d1Id = next();
				break;
			default:
				throw new Error(`unknown option: ${a}`);
		}
	}
	return out;
}

async function main() {
	const args = parseArgs(process.argv.slice(2));
	if (args.help) {
		usage();
		return;
	}

	assertWranglerLoggedIn();

	const interactive = process.stdin.isTTY && !args.yes;

	let instance =
		typeof args.instance === "string" ? args.instance : "";
	if (!instance) {
		instance = interactive
			? await promptLine("Instance name (env file basename)", "default")
			: "default";
	}

	let prefix = typeof args.prefix === "string" ? args.prefix : "";
	if (!prefix) {
		prefix = interactive
			? await promptLine(
					"Resource name prefix (Workers + D1)",
					"octafuse-gateway",
				)
			: "octafuse-gateway";
	}

	const baseNames = namesFromPrefix(prefix);
	let proxyDomain =
		typeof args.proxyDomain === "string" ? args.proxyDomain : "";
	let adminDomain =
		typeof args.adminDomain === "string" ? args.adminDomain : "";

	if (interactive && !proxyDomain && !adminDomain) {
		const wantDomain = await promptYesNo(
			"Bind custom domains now? (usually skip; use workers.dev first)",
			false,
		);
		if (wantDomain) {
			proxyDomain = await promptLine("Proxy custom domain (empty to skip)", "");
			adminDomain = await promptLine("Admin custom domain (empty to skip)", "");
		}
	}

	const envPath = envPathForInstance(instance);
	if (existsSync(envPath)) {
		if (interactive) {
			const overwrite = await promptYesNo(
				`Env file already exists (${envPath}). Overwrite?`,
				false,
			);
			if (!overwrite) {
				logError("Aborted. Use npm run deploy:cloudflare -- " + instance);
				process.exit(1);
			}
		} else if (!args.yes) {
			logError(
				`Env file already exists: ${envPath}. Pass --yes to overwrite, or pick another --instance.`,
			);
			process.exit(1);
		} else {
			log(`Overwriting existing env: ${envPath}`);
		}
	}

	let d1DatabaseId =
		typeof args.d1Id === "string" ? args.d1Id : "";
	if (!d1DatabaseId) {
		d1DatabaseId = ensureD1Database(baseNames.d1DatabaseName, {
			reuse: Boolean(args.reuseD1),
		});
	} else {
		log(`Using provided D1 id=${d1DatabaseId}`);
	}

	const names = {
		...baseNames,
		d1DatabaseId,
		proxyCustomDomain: proxyDomain || undefined,
		adminCustomDomain: adminDomain || undefined,
	};

	writeInstanceEnvFile(instance, names);

	/** @type {Record<string, string>} */
	const vars = {
		PROXY_WORKER_NAME: names.proxyWorkerName,
		ADMIN_WORKER_NAME: names.adminWorkerName,
		D1_DATABASE_NAME: names.d1DatabaseName,
		D1_DATABASE_ID: names.d1DatabaseId,
		D1_MIGRATIONS_WORKER_NAME: names.d1MigrationsWorkerName,
	};
	if (names.proxyCustomDomain) {
		vars.PROXY_CUSTOM_DOMAIN = names.proxyCustomDomain;
	}
	if (names.adminCustomDomain) {
		vars.ADMIN_CUSTOM_DOMAIN = names.adminCustomDomain;
	}

	log("Applying remote D1 migrations…");
	runNpmWithEnv(vars, ["db:migrate:remote"]);

	log("Deploying Proxy Worker (usually under a minute)…");
	runNpmWithEnv(vars, ["deploy:proxy"]);

	log(
		"Deploying Admin Worker (OpenNext build — often several minutes on first run)…",
	);
	runNpmWithEnv(vars, ["deploy:admin"]);

	if (!args.skipSecret) {
		let password;
		if (typeof args.adminPasswordEnv === "string") {
			password = process.env[args.adminPasswordEnv];
			if (!password) {
				logError(
					`Environment variable ${args.adminPasswordEnv} is empty or unset`,
				);
				process.exit(1);
			}
		} else if (!interactive && args.yes) {
			log(
				"Non-interactive (--yes) without --admin-password-env: skipping secret put. Set later with:",
			);
			log(
				`  npx wrangler secret put ADMIN_PASSWORD --name ${names.adminWorkerName}`,
			);
			password = undefined;
			args.skipSecret = true;
		}

		if (!args.skipSecret) {
			putAdminPasswordSecret(names.adminWorkerName, password);
		}
	}

	const masterKey = fetchRemoteMasterKey(vars);

	const proxyUrl = names.proxyCustomDomain
		? `https://${names.proxyCustomDomain}`
		: undefined;
	const adminUrl = names.adminCustomDomain
		? `https://${names.adminCustomDomain}`
		: undefined;

	printDownstreamHints({
		proxyUrl,
		adminUrl,
		masterKey,
		proxyWorkerName: names.proxyWorkerName,
		adminWorkerName: names.adminWorkerName,
	});

	log(`Bootstrap complete. Instance env: cloudflare-worker/${instance}.env`);
	log(`Later deploys: npm run deploy:cloudflare -- ${instance} --migrate`);
	printLocalDevHint();
}

try {
	await main();
} catch (err) {
	logError(err instanceof Error ? err.message : String(err));
	process.exit(1);
}
