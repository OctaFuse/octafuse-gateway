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
