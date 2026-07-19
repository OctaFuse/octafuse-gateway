import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { buildSimulatorRequest } from './endpoint';

describe('buildSimulatorRequest openai', () => {
	it('defaults to chat/completions', () => {
		const result = buildSimulatorRequest({
			baseUrl: 'https://gateway.example.com',
			protocol: 'openai',
			modelForRouting: 'gpt-4o',
			body: { messages: [] },
			apiKey: 'sk-test',
		});
		assert.equal(result.url, 'https://gateway.example.com/v1/chat/completions');
	});

	it('uses images/generations when imagesGenerations is set', () => {
		const result = buildSimulatorRequest({
			baseUrl: 'https://gateway.example.com/',
			protocol: 'openai',
			modelForRouting: 'gpt-image-2',
			body: { prompt: 'a red apple', n: 1 },
			apiKey: 'sk-test',
			imagesGenerations: true,
		});
		assert.equal(result.url, 'https://gateway.example.com/v1/images/generations');
		const parsed = JSON.parse(result.bodyText) as { model: string; prompt: string };
		assert.equal(parsed.model, 'gpt-image-2');
		assert.equal(parsed.prompt, 'a red apple');
	});

	it('uses images/generations when imageOperation is generations', () => {
		const result = buildSimulatorRequest({
			baseUrl: 'https://gateway.example.com',
			protocol: 'openai',
			modelForRouting: 'gpt-image-2',
			body: { prompt: 'hi' },
			apiKey: 'sk-test',
			imageOperation: 'generations',
		});
		assert.equal(result.url, 'https://gateway.example.com/v1/images/generations');
		assert.equal(result.formData, undefined);
	});

	it('builds multipart for images/edits', () => {
		const file = new File([Uint8Array.from([137, 80, 78, 71])], 'ref.png', { type: 'image/png' });
		const result = buildSimulatorRequest({
			baseUrl: 'https://gateway.example.com',
			protocol: 'openai',
			modelForRouting: 'gpt-image-2',
			body: { prompt: 'make it green', n: 1, size: '1024x1024' },
			apiKey: 'sk-test',
			imageOperation: 'edits',
			editImages: [file],
		});
		assert.equal(result.url, 'https://gateway.example.com/v1/images/edits');
		assert.ok(result.formData);
		assert.equal(result.headers['Content-Type'], undefined);
		assert.equal(result.headers.Authorization, 'Bearer sk-test');
		assert.match(result.multipartSummary ?? '', /ref\.png/);
	});

	it('previews images/edits URL even when no reference files yet', () => {
		const result = buildSimulatorRequest({
			baseUrl: 'https://gateway.example.com',
			protocol: 'openai',
			modelForRouting: 'gpt-image-2',
			body: { prompt: 'make it green' },
			apiKey: 'sk-test',
			imageOperation: 'edits',
			editImages: [],
		});
		assert.equal(result.url, 'https://gateway.example.com/v1/images/edits');
		assert.match(result.multipartSummary ?? '', /none selected/);
	});
});

describe('buildSimulatorRequest gemini', () => {
	it('includes alt=sse for streamGenerateContent', () => {
		const result = buildSimulatorRequest({
			baseUrl: 'https://gateway.example.com',
			protocol: 'gemini',
			modelForRouting: 'gemini-2.5-flash',
			geminiAction: 'streamGenerateContent',
			body: { contents: [] },
			apiKey: 'sk-test',
		});
		const u = new URL(result.url);
		assert.equal(u.pathname, '/v1beta/models/gemini-2.5-flash:streamGenerateContent');
		assert.equal(u.searchParams.get('alt'), 'sse');
	});

	it('does not include alt for generateContent', () => {
		const result = buildSimulatorRequest({
			baseUrl: 'https://gateway.example.com',
			protocol: 'gemini',
			modelForRouting: 'gemini-2.5-flash',
			geminiAction: 'generateContent',
			body: { contents: [] },
			apiKey: 'sk-test',
		});
		const u = new URL(result.url);
		assert.equal(u.searchParams.has('alt'), false);
	});
});
