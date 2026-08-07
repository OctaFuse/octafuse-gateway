import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import type { R2Bucket } from '@cloudflare/workers-types';
import {
	isTemporaryAudioUploadToken,
	resolveTemporaryAudioPublisher,
	temporaryAudioUploadExpired,
} from './temporary-audio-upload';

describe('temporary audio upload publisher', () => {
	it('requires both R2 and a public Gateway URL', () => {
		assert.equal(resolveTemporaryAudioPublisher({}), undefined);
		assert.equal(
			resolveTemporaryAudioPublisher({ PUBLIC_GATEWAY_BASE_URL: 'https://gateway.example' }),
			undefined
		);
	});

	it('writes a random R2 object and deletes it during cleanup', async () => {
		const puts: Array<{ key: string; value: unknown; options: unknown }> = [];
		const deletes: string[] = [];
		const bucket = {
			put: async (key: string, value: unknown, options: unknown) => {
				puts.push({ key, value, options });
				return null;
			},
			delete: async (key: string) => {
				deletes.push(key);
			},
		} as unknown as R2Bucket;
		const publish = resolveTemporaryAudioPublisher({
			AUDIO_UPLOADS: bucket,
			PUBLIC_GATEWAY_BASE_URL: 'https://gateway.example/',
		});
		assert.ok(publish);
		const published = await publish({
			filename: 'sample.wav',
			mimeType: 'audio/wav',
			bytes: new Uint8Array([1, 2, 3]),
		});
		const token = new URL(published.url).pathname.split('/').pop()!;
		assert.equal(isTemporaryAudioUploadToken(token), true);
		assert.equal(puts[0]?.key, token);
		await published.cleanup();
		assert.deepEqual(deletes, [token]);
	});
});

describe('temporaryAudioUploadExpired', () => {
	it('uses mandatory expires_at metadata', () => {
		assert.equal(temporaryAudioUploadExpired({ expires_at: String(Date.now() + 10_000) }), false);
		assert.equal(temporaryAudioUploadExpired({ expires_at: String(Date.now() - 1) }), true);
		assert.throws(() => temporaryAudioUploadExpired(undefined), /missing expires_at/);
	});
});
