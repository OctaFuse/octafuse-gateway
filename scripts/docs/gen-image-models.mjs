#!/usr/bin/env node
/**
 * Render the image model catalog tables in docs/developers/reference/image-models.md
 * from packages/admin/lib/model-presets/*.json (the only source of catalog prices).
 *
 * Usage:
 *   node scripts/docs/gen-image-models.mjs          # rewrite the generated block
 *   node scripts/docs/gen-image-models.mjs --check  # exit 1 when the doc is stale
 */
import { readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const PRESET_DIR = join(ROOT, 'packages/admin/lib/model-presets');
export const DOC_PATH = join(ROOT, 'docs/developers/reference/image-models.md');

export const BEGIN_MARKER = '<!-- BEGIN GENERATED: image-models (npm run docs:image-models) -->';
export const END_MARKER = '<!-- END GENERATED: image-models -->';

/** A new image vendor must get a vendor doc before it can appear in the catalog. */
export const VENDOR_DOCS = {
	openai: ['OpenAI GPT Image', '../architecture/openai-compatible-image.md#openai-gpt-image'],
	zhipu: ['智谱 GLM Image', '../architecture/openai-compatible-image.md#智谱-glm-image'],
	xai: ['xAI Grok Imagine', '../architecture/openai-compatible-image.md#xai-grok-imagine'],
	google: ['Google Gemini', '../architecture/openai-compatible-image.md#google-gemini-nano-banana'],
	bytedance: ['火山方舟 Seedream', '../architecture/volcengine-image.md'],
	aliyun: ['百炼 DashScope', '../architecture/dashscope-image.md'],
	minimax: ['MiniMax', '../architecture/minimax-image.md'],
};

const CURRENCIES = [
	['cny', '¥'],
	['usd', '$'],
];

export function loadImagePresets(dir = PRESET_DIR) {
	const rows = [];
	for (const file of readdirSync(dir).filter((f) => f.endsWith('.json')).sort()) {
		const list = JSON.parse(readFileSync(join(dir, file), 'utf8'));
		if (!Array.isArray(list)) continue;
		for (const model of list) {
			if (!(model?.modalities?.output ?? []).includes('image')) continue;
			rows.push({ ...model, presetFile: file });
		}
	}
	return rows.sort(
		(a, b) => a.vendor.localeCompare(b.vendor) || a.id.localeCompare(b.id)
	);
}

function billingMode(model) {
	const modes = new Set(
		CURRENCIES.map(([cur]) => model.pricing?.[cur]?.image_billing_mode).filter(Boolean)
	);
	if (modes.size !== 1) {
		throw new Error(`${model.id}: expected one image_billing_mode, got ${[...modes].join(',') || 'none'}`);
	}
	return [...modes][0];
}

function money(symbol, value) {
	return value == null ? '—' : `${symbol}${value}`;
}

function headlinePrice(model, cur, symbol) {
	const side = model.pricing?.[cur];
	if (!side) return '—';
	if (side.image_billing_mode === 'per_image') {
		return `${money(symbol, side.image?.default)}/张`;
	}
	const tier = side.tiers?.[0];
	return tier?.image_output_price == null ? '—' : `图出 ${money(symbol, tier.image_output_price)}/1M`;
}

function tierLabels(image) {
	const labels = [];
	for (const key of ['by_quality_size', 'by_quality', 'by_size']) {
		if (image?.[key] && Object.keys(image[key]).length > 0) labels.push(`\`${key}\``);
	}
	if (image?.input) labels.push('参考图');
	return labels;
}

function tierRows(model) {
	const usd = model.pricing?.usd?.image;
	const cny = model.pricing?.cny?.image;
	const base = usd ?? cny;
	const rows = [];
	for (const key of ['by_quality_size', 'by_quality', 'by_size']) {
		for (const tier of Object.keys(base?.[key] ?? {})) {
			rows.push([`\`${key}\` · \`${tier}\``, cny?.[key]?.[tier], usd?.[key]?.[tier]]);
		}
	}
	if (base?.input) {
		rows.push(['参考图 `input.default`', cny?.input?.default, usd?.input?.default]);
	}
	return rows;
}

function table(header, rows) {
	return [
		`| ${header.join(' | ')} |`,
		`|${header.map(() => '---').join('|')}|`,
		...rows.map((r) => `| ${r.join(' | ')} |`),
	].join('\n');
}

export function renderImageModelsBlock(models) {
	const overview = [];
	const tiers = [];
	const tokens = [];
	for (const model of models) {
		const doc = VENDOR_DOCS[model.vendor];
		if (!doc) {
			throw new Error(`${model.id}: vendor "${model.vendor}" has no entry in VENDOR_DOCS`);
		}
		const mode = billingMode(model);
		const image = model.pricing?.usd?.image ?? model.pricing?.cny?.image;
		overview.push([
			`\`${model.id}\``,
			model.display_name,
			`[${doc[0]}](${doc[1]})`,
			`\`${mode}\``,
			headlinePrice(model, 'cny', '¥'),
			headlinePrice(model, 'usd', '$'),
			mode === 'per_image' ? tierLabels(image).join('、') || '一口价' : '按 usage',
			`\`${model.presetFile}\``,
		]);
		if (mode === 'per_image') {
			for (const [label, cny, usd] of tierRows(model)) {
				tiers.push([`\`${model.id}\``, label, money('¥', cny), money('$', usd)]);
			}
		} else {
			for (const [cur, symbol] of CURRENCIES) {
				const tier = model.pricing?.[cur]?.tiers?.[0];
				if (!tier) continue;
				tokens.push([
					`\`${model.id}\``,
					cur.toUpperCase(),
					money(symbol, tier.input_price),
					money(symbol, tier.cache_read_price),
					money(symbol, tier.output_price),
					money(symbol, tier.image_input_price),
					money(symbol, tier.image_input_cache_price),
					money(symbol, tier.image_output_price),
				]);
			}
		}
	}
	return [
		BEGIN_MARKER,
		'',
		'### 目录总览',
		'',
		table(['模型 ID', '展示名', '厂商文档', '计费模式', 'CNY', 'USD', '分档', '预设文件'], overview),
		'',
		'### 按张分档',
		'',
		'查价顺序是 `by_quality_size`（键为 `quality:size`）→ `by_quality` → `by_size` → `default`。没有列出的模型按目录总览里的一口价计费。',
		'',
		table(['模型 ID', '档位', 'CNY / 张', 'USD / 张'], tiers),
		'',
		'### Token 单价',
		'',
		'单位是每百万 token。`—` 表示该币种没有预设，导入后需要手工补价。',
		'',
		table(['模型 ID', '币种', '文本输入', '文本缓存', '文本输出', '图片输入', '图片输入缓存', '图片输出'], tokens),
		'',
		END_MARKER,
	].join('\n');
}

export function replaceGeneratedBlock(doc, block) {
	const start = doc.indexOf(BEGIN_MARKER);
	const end = doc.indexOf(END_MARKER);
	if (start < 0 || end < start) {
		throw new Error('image-models.md is missing the generated block markers');
	}
	return doc.slice(0, start) + block + doc.slice(end + END_MARKER.length);
}

function main() {
	const doc = readFileSync(DOC_PATH, 'utf8');
	const next = replaceGeneratedBlock(doc, renderImageModelsBlock(loadImagePresets()));
	if (process.argv.includes('--check')) {
		if (next !== doc) {
			console.error('image-models.md is stale; run `npm run docs:image-models`.');
			process.exit(1);
		}
		return;
	}
	if (next !== doc) writeFileSync(DOC_PATH, next);
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
	main();
}
