/**
 * Minimal Cloudflare `Env` typings when `cloudflare-env.d.ts` is absent
 * (e.g. `npm run build:docker` / Docker image build without `wrangler types`).
 * After `npm run cf-typegen`, Wrangler-generated `cloudflare-env.d.ts` augments/merges with this.
 */
/// <reference types="@cloudflare/workers-types" />

declare namespace Cloudflare {
	interface Env {
		DB: D1Database;
		ASSETS: Fetcher;
		ADMIN_USERNAME: string;
		ADMIN_PASSWORD: string;
		DATABASE_URL?: string;
		DATABASE_DRIVER?: string;
	}
}

interface CloudflareEnv extends Cloudflare.Env {}
