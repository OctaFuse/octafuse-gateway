import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { geminiBodyRedactedForLog } from './gemini';
import { geminiPathUsesImagePassthrough } from './gemini-image-generation';

describe('gemini image route selection', () => {
	it('sends image models through native image passthrough and leaves text models on the LLM path', () => {
		assert.equal(geminiPathUsesImagePassthrough({ output_modalities: '["image"]' }), true);
		assert.equal(geminiPathUsesImagePassthrough({ output_modalities: '["text","image"]' }), true);
		assert.equal(geminiPathUsesImagePassthrough({ output_modalities: '["text"]' }), false);
	});

	it('drops contents so inline image bytes are not written to the request log', () => {
		const redacted = geminiBodyRedactedForLog(
			{
				contents: [{ parts: [{ inlineData: { mimeType: 'image/png', data: 'abc' } }, { text: 'lantern' }] }],
				generationConfig: { responseModalities: ['TEXT', 'IMAGE'], imageConfig: { imageSize: '1K' } },
			},
			'generateContent',
		);
		assert.equal('contents' in redacted, false);
		assert.equal(redacted._contents_count, 1);
		assert.equal(redacted._gemini_action, 'generateContent');
		assert.deepEqual(
			(redacted.generationConfig as { imageConfig: { imageSize: string } }).imageConfig.imageSize,
			'1K',
		);
	});
});
