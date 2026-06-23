import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { buildSimulatorRequest } from './endpoint';

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
