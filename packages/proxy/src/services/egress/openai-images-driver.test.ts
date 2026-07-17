import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
	countValidImageResults,
	normalizeImageCommonParams,
	redactImageRequestForLog,
	validateImageUpload,
	IMAGE_MAX_PROMPT_CHARS,
} from './openai-images-driver';

describe('normalizeImageCommonParams', () => {
	it('requires prompt and forces n=1', () => {
		assert.equal(normalizeImageCommonParams({ prompt: '' }).ok, false);
		assert.equal(normalizeImageCommonParams({ prompt: 'hi', n: 2 }).ok, false);
		const ok = normalizeImageCommonParams({
			prompt: ' a cat ',
			n: 1,
			size: 'auto',
			quality: 'medium',
		});
		assert.equal(ok.ok, true);
		if (ok.ok) {
			assert.equal(ok.prompt, 'a cat');
			assert.equal(ok.n, 1);
			assert.equal(ok.size, 'auto');
			assert.equal(ok.quality, 'medium');
		}
	});

	it('accepts numeric string n from multipart', () => {
		const ok = normalizeImageCommonParams({ prompt: 'hi', n: '1' });
		assert.equal(ok.ok, true);
		if (ok.ok) assert.equal(ok.n, 1);
		assert.equal(normalizeImageCommonParams({ prompt: 'hi', n: '2' }).ok, false);
	});

	it('rejects oversized prompt', () => {
		const r = normalizeImageCommonParams({ prompt: 'x'.repeat(IMAGE_MAX_PROMPT_CHARS + 1) });
		assert.equal(r.ok, false);
	});
});

describe('validateImageUpload / countValidImageResults', () => {
	it('validates mime and size', () => {
		assert.equal(
			validateImageUpload({ filename: 'a.png', mimeType: 'image/png', bytes: new Uint8Array([1, 2, 3]) }),
			null
		);
		assert.match(
			validateImageUpload({
				filename: 'a.gif',
				mimeType: 'image/gif',
				bytes: new Uint8Array([1]),
			}) ?? '',
			/mime/
		);
		assert.match(
			validateImageUpload({ filename: 'a.png', mimeType: 'image/png', bytes: new Uint8Array() }) ?? '',
			/empty/
		);
	});

	it('counts b64_json and url entries', () => {
		assert.equal(countValidImageResults({ data: [{ b64_json: 'abc' }, { url: 'https://x' }] }), 2);
		assert.equal(countValidImageResults({ data: [{ b64_json: '' }, {}] }), 0);
		assert.equal(countValidImageResults(null), 0);
	});
});

describe('redactImageRequestForLog', () => {
	it('never includes prompt text or b64', () => {
		const out = redactImageRequestForLog({
			operation: 'generations',
			model: 'gpt-image-2',
			prompt: 'secret prompt about a novel cover',
			n: 1,
			quality: 'auto',
		});
		const s = JSON.stringify(out);
		assert.equal(s.includes('secret prompt'), false);
		assert.equal(out.prompt_chars, 'secret prompt about a novel cover'.length);
		assert.deepEqual(out._redacted, ['prompt', 'image', 'images', 'b64_json']);
	});
});
