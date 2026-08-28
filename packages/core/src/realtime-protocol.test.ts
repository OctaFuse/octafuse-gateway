import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
	buildDashScopeRealtimeAuthProtocol,
	parseDashScopeRealtimeAuthProtocol,
	pickDashScopeRealtimeSubprotocol,
} from './realtime-protocol';

describe('DashScope realtime browser auth protocol', () => {
	it('carries the API key in a negotiated subprotocol token', () => {
		const protocol = buildDashScopeRealtimeAuthProtocol('sk-test-key');
		assert.deepEqual(parseDashScopeRealtimeAuthProtocol(protocol), {
			apiKey: 'sk-test-key',
			protocol,
		});
	});

	it('selects the gateway token from a list of offered protocols', () => {
		assert.deepEqual(
			parseDashScopeRealtimeAuthProtocol(
				'chat, octafuse-api-key.sk-test-key, audio'
			),
			{ apiKey: 'sk-test-key', protocol: 'octafuse-api-key.sk-test-key' }
		);
	});

	it('rejects an absent or empty token', () => {
		assert.equal(parseDashScopeRealtimeAuthProtocol('chat, audio'), null);
		assert.equal(parseDashScopeRealtimeAuthProtocol('octafuse-api-key.'), null);
	});

	it('prefers the gateway auth subprotocol when several are offered', () => {
		assert.equal(
			pickDashScopeRealtimeSubprotocol(['chat', 'octafuse-api-key.sk-test-key', 'audio']),
			'octafuse-api-key.sk-test-key'
		);
		assert.equal(pickDashScopeRealtimeSubprotocol(['chat']), 'chat');
		assert.equal(pickDashScopeRealtimeSubprotocol([]), false);
	});
});
