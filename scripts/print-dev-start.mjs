#!/usr/bin/env node
/**
 * Prints a startup banner before `wrangler dev` (similar to Next.js local URL hints).
 * Keep port in sync with package.json `dev` / `preview` scripts.
 */
const PORT = 8787;
const base = `http://127.0.0.1:${PORT}`;

const lines = [
	'',
	'────────────────────────────────────────────────────────────',
	'  octafuse · local development',
	'────────────────────────────────────────────────────────────',
	`  Proxy          ${base}`,
	`  Health         GET  ${base}/health`,
	`  Chat           POST ${base}/v1/chat/completions`,
	`  Anthropic      POST ${base}/v1/messages`,
	`  Gemini         POST ${base}/v1beta/models/{model}:generateContent`,
	`  Admin API      ${base}/admin/* (Bearer = D1 system_config.MASTER_KEY)`,
	'',
	'  D1 local data  ../.wrangler/state (database_name: octafuse-gateway)',
	'  First run / migrate  npm run db:migrate',
	'  Optional       copy .env.example → .env (optional .env.local; see docs)',
	'  Admin UI       point octafuse-admin GATEWAY_URL at the URL above',
	'────────────────────────────────────────────────────────────',
	'  Wrangler logs below…',
	'',
];

console.log(lines.join('\n'));
