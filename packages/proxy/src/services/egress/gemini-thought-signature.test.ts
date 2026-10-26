import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
	GEMINI_SKIP_THOUGHT_SIGNATURE,
	isInvalidThoughtSignatureErrorBody,
	sanitizeGeminiThoughtSignatures,
} from './gemini-thought-signature';

describe('isInvalidThoughtSignatureErrorBody', () => {
	it('matches Vertex / Gemini invalid-signature errors', () => {
		assert.equal(isInvalidThoughtSignatureErrorBody('{"error":{"message":"Invalid thought signature."}}'), true);
		assert.equal(isInvalidThoughtSignatureErrorBody('Invalid thought_signature in request'), true);
	});

	it('ignores other errors, including a missing signature', () => {
		assert.equal(isInvalidThoughtSignatureErrorBody('{"error":{"message":"bad request"}}'), false);
		assert.equal(
			isInvalidThoughtSignatureErrorBody('Function call is missing a thought_signature in functionCall parts'),
			false
		);
	});
});

describe('sanitizeGeminiThoughtSignatures', () => {
	it('replaces functionCall signatures, removes others, and does not mutate the input', () => {
		const input = {
			generationConfig: { temperature: 1 },
			contents: [
				{ role: 'user', parts: [{ text: 'hi' }] },
				{
					role: 'model',
					parts: [
						{ text: 'thinking', thought: true, thoughtSignature: 'text-sig' },
						{ functionCall: { name: 'a', args: { x: 1 } }, thoughtSignature: 'fc-sig' },
						{ function_call: { name: 'b', args: {} }, thought_signature: 'snake-sig' },
					],
				},
			],
		};
		const snapshot = JSON.stringify(input);

		const out = sanitizeGeminiThoughtSignatures(input);

		assert.ok(out);
		assert.equal(JSON.stringify(input), snapshot);
		assert.equal(out.replaced, 2);
		assert.equal(out.removed, 1);
		const parts = (out.body.contents as Array<{ parts: Array<Record<string, unknown>> }>)[1].parts;
		assert.equal('thoughtSignature' in parts[0], false);
		assert.equal(parts[0].text, 'thinking');
		assert.equal(parts[1].thoughtSignature, GEMINI_SKIP_THOUGHT_SIGNATURE);
		assert.deepEqual(parts[1].functionCall, { name: 'a', args: { x: 1 } });
		assert.equal(parts[2].thoughtSignature, GEMINI_SKIP_THOUGHT_SIGNATURE);
		assert.equal('thought_signature' in parts[2], false);
		assert.deepEqual(out.body.generationConfig, { temperature: 1 });
	});

	it('returns null when there is nothing to sanitize', () => {
		assert.equal(sanitizeGeminiThoughtSignatures({}), null);
		assert.equal(sanitizeGeminiThoughtSignatures({ contents: [{ role: 'user', parts: [{ text: 'hi' }] }] }), null);
	});
});
