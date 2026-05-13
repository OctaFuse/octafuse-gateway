import { drizzle as drizzleD1 } from 'drizzle-orm/d1';
import { d1CoreSchema } from './schema.d1';
import type { D1Database } from '@cloudflare/workers-types';
import type { DrizzleD1Database } from 'drizzle-orm/d1';

export type D1DrizzleClient = DrizzleD1Database<typeof d1CoreSchema>;

export function initD1Drizzle(db: D1Database): D1DrizzleClient {
	return drizzleD1(db, { schema: d1CoreSchema });
}
