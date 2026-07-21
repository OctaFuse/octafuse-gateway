#!/usr/bin/env node
/**
 * Idempotent data migration: convert known image catalog models from
 * token-fold (image_output_price calibrated via 16384 tokens) to native per_image,
 * and sync catalog unit prices to the current static presets.
 *
 * Usage:
 *   node scripts/db/migrate-image-billing-modes.mjs --dry-run
 *   node scripts/db/migrate-image-billing-modes.mjs --apply
 *
 * Env:
 *   DATABASE_URL + DATABASE_DRIVER=postgres|mysql  (SQL drivers)
 *   Or D1 via wrangler (not automated here — use --print-sql and apply manually)
 *
 * Only touches explicit catalog ids. Does not guess custom models.
 */
import { writeFileSync, mkdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..', '..');
const BACKUP_DIR = join(ROOT, '.migration-backups');

/** Catalog id → per_image / token profile builders (aligned with packages/admin/lib/model-presets/*-image.json). */
const TARGETS = {
	'doubao-seedream-5-0': {
		aliases: ['doubao-seedream-5-0-260128'],
		cny: {
			default: 0.22,
		},
		usd: {
			default: 0.035,
		},
	},
	'doubao-seedream-5-0-pro': {
		aliases: [],
		cny: {
			default: 0.3,
			by_size: { '2k': 0.3, '3k': 0.6, '4k': 0.6 },
			by_quality_size: {
				'flat:2k': 0.3,
				'flat:3k': 0.6,
				'flat:4k': 0.6,
				'auto:2k': 0.3,
				'auto:3k': 0.6,
				'auto:4k': 0.6,
			},
			input: { default: 0.02 },
		},
		usd: {
			default: 0.045,
			by_size: { '2k': 0.045, '3k': 0.09, '4k': 0.09 },
			by_quality_size: {
				'flat:2k': 0.045,
				'flat:3k': 0.09,
				'flat:4k': 0.09,
				'auto:2k': 0.045,
				'auto:3k': 0.09,
				'auto:4k': 0.09,
			},
			input: { default: 0.003 },
		},
	},
	'glm-image': {
		aliases: [],
		cny: { default: 0.1 },
		usd: { default: 0.014 },
	},
	'grok-imagine-image-quality': {
		aliases: [],
		cny: {
			default: 0.36,
			by_size: { '1k': 0.36, '2k': 0.51 },
			input: { default: 0.07 },
		},
		usd: {
			default: 0.05,
			by_size: { '1k': 0.05, '2k': 0.07 },
			input: { default: 0.01 },
		},
	},
	'gpt-image-2': {
		aliases: [],
		tokenOnly: true,
		usd: {
			input_price: 5,
			output_price: 0,
			cache_read_price: 1.25,
			image_input_price: 8,
			image_input_cache_price: 2,
			image_output_price: 30,
		},
		cny: {
			input_price: 36.25,
			output_price: 0,
			cache_read_price: 9.0625,
			image_input_price: 58,
			image_input_cache_price: 14.5,
			image_output_price: 217.5,
		},
	},
	'gemini-3.1-flash-image': {
		aliases: [],
		tokenOnly: true,
		usd: {
			input_price: 0.5,
			output_price: 3,
			cache_read_price: null,
			image_input_price: 0.5,
			image_input_cache_price: null,
			image_output_price: 60,
		},
		cny: {
			input_price: 3.625,
			output_price: 21.75,
			cache_read_price: null,
			image_input_price: 3.625,
			image_input_cache_price: null,
			image_output_price: 435,
		},
	},
	'gemini-3-pro-image-preview': {
		aliases: [],
		tokenOnly: true,
		usd: {
			input_price: 2,
			output_price: 12,
			cache_read_price: null,
			image_input_price: 2,
			image_input_cache_price: null,
			image_output_price: 120,
		},
		cny: {
			input_price: 14.5,
			output_price: 87,
			cache_read_price: null,
			image_input_price: 14.5,
			image_input_cache_price: null,
			image_output_price: 870,
		},
	},
};

function buildPerImageProfile(side) {
	return {
		image_billing_mode: 'per_image',
		image: {
			default: side.default,
			...(side.by_size ? { by_size: side.by_size } : {}),
			...(side.by_quality_size ? { by_quality_size: side.by_quality_size } : {}),
			...(side.input ? { input: side.input } : {}),
			uncertain_result_policy: 'requested',
		},
	};
}

function buildTokenProfile(side) {
	return {
		image_billing_mode: 'token',
		tiers: [
			{
				upto: null,
				input_price: side.input_price,
				output_price: side.output_price,
				cache_read_price: side.cache_read_price,
				cache_write_price: null,
				image_input_price: side.image_input_price,
				image_input_cache_price: side.image_input_cache_price,
				image_output_price: side.image_output_price,
			},
		],
	};
}

function detectCurrency(profileObj) {
	const imageDefault = profileObj?.image?.default;
	if (typeof imageDefault === 'number') {
		// Catalog CNY unit prices are ≥0.1; USD per-image are typically <0.1
		return imageDefault >= 0.1 ? 'cny' : 'usd';
	}
	const tier = Array.isArray(profileObj?.tiers) ? profileObj.tiers[0] : null;
	const out = tier?.image_output_price;
	// Heuristic: CNY fold / token prices were larger (e.g. ≥5 for fold, ≥30 for gpt CNY)
	if (typeof out === 'number' && out >= 5) return 'cny';
	const textIn = tier?.input_price;
	if (typeof textIn === 'number' && textIn >= 3) return 'cny';
	return 'usd';
}

function profilesEqual(a, b) {
	try {
		return JSON.stringify(JSON.parse(a)) === JSON.stringify(JSON.parse(b));
	} catch {
		return a === b;
	}
}

function transformRow(id, pricingProfileJson) {
	let obj;
	try {
		obj = JSON.parse(pricingProfileJson);
	} catch {
		return { skip: true, reason: 'invalid_json' };
	}

	const canon =
		Object.keys(TARGETS).find((k) => k === id || TARGETS[k].aliases.includes(id)) ?? null;
	if (!canon) return { skip: true, reason: 'not_in_catalog' };

	const target = TARGETS[canon];
	const currency = detectCurrency(obj);
	const side = currency === 'cny' ? target.cny : target.usd;
	const afterObj = target.tokenOnly ? buildTokenProfile(side) : buildPerImageProfile(side);
	const after = JSON.stringify(afterObj);
	if (profilesEqual(pricingProfileJson, after)) {
		return { skip: true, reason: 'already_current' };
	}
	return {
		skip: false,
		before: pricingProfileJson,
		after,
		mode: target.tokenOnly ? 'token' : 'per_image',
		currency,
	};
}

function parseArgs(argv) {
	const dryRun = !argv.includes('--apply');
	const printSql = argv.includes('--print-sql');
	return { dryRun, printSql };
}

async function loadPgRows() {
	const { default: postgres } = await import('postgres');
	const url = process.env.DATABASE_URL;
	if (!url) throw new Error('DATABASE_URL required for postgres');
	const sql = postgres(url, { max: 1 });
	try {
		const ids = Object.keys(TARGETS).flatMap((k) => [k, ...TARGETS[k].aliases]);
		const rows = await sql`
			SELECT id, pricing_profile FROM models WHERE id = ANY(${ids})
		`;
		return rows.map((r) => ({ id: r.id, pricing_profile: r.pricing_profile }));
	} finally {
		await sql.end({ timeout: 5 });
	}
}

async function applyPg(updates) {
	const { default: postgres } = await import('postgres');
	const sql = postgres(process.env.DATABASE_URL, { max: 1 });
	try {
		for (const u of updates) {
			await sql`UPDATE models SET pricing_profile = ${u.after} WHERE id = ${u.id}`;
		}
	} finally {
		await sql.end({ timeout: 5 });
	}
}

async function main() {
	const { dryRun, printSql } = parseArgs(process.argv.slice(2));
	const driver = (process.env.DATABASE_DRIVER || 'postgres').toLowerCase();

	if (printSql) {
		console.log('-- Preview UPDATE statements (apply after reviewing backups)');
		for (const [id, t] of Object.entries(TARGETS)) {
			const profile = t.tokenOnly ? buildTokenProfile(t.cny) : buildPerImageProfile(t.cny);
			console.log(
				`UPDATE models SET pricing_profile = '${JSON.stringify(profile).replace(/'/g, "''")}' WHERE id IN ('${[id, ...t.aliases].join("','")}');`
			);
		}
		return;
	}

	if (driver !== 'postgres') {
		console.error(
			`Driver "${driver}" not automated in this script. Use --print-sql and apply manually, or set DATABASE_DRIVER=postgres.`
		);
		process.exit(1);
	}

	const rows = await loadPgRows();
	const planned = [];
	for (const row of rows) {
		const r = transformRow(row.id, row.pricing_profile ?? '');
		if (r.skip) {
			console.log(`skip ${row.id}: ${r.reason}`);
			continue;
		}
		planned.push({ id: row.id, ...r });
		console.log(`plan ${row.id}: → ${r.mode}${r.currency ? ` (${r.currency})` : ''}`);
	}

	mkdirSync(BACKUP_DIR, { recursive: true });
	const stamp = new Date().toISOString().replace(/[:.]/g, '-');
	const backupPath = join(BACKUP_DIR, `image-billing-${stamp}.json`);
	writeFileSync(backupPath, JSON.stringify({ dryRun, planned }, null, 2));
	console.log(`backup written: ${backupPath}`);

	if (dryRun) {
		console.log(`dry-run: ${planned.length} row(s) would update. Re-run with --apply to write.`);
		return;
	}

	await applyPg(planned);
	console.log(`applied: ${planned.length} row(s)`);
}

main().catch((err) => {
	console.error(err);
	process.exit(1);
});
