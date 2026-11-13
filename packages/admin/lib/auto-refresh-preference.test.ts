import assert from 'node:assert/strict';
import test from 'node:test';
import { createAutoRefreshPreference, parseAutoRefreshInterval } from './auto-refresh-preference';
import { createAutoRefreshScheduler } from './auto-refresh-scheduler';

test('unconfigured and invalid preferences cannot schedule periodic requests', () => {
	for (const stored of [null, '', 'true', '30000', '0', 'NaN', 'off']) {
		let timers = 0;
		let deadline: number | null = null;
		const scheduler = createAutoRefreshScheduler({
			intervalMs: parseAutoRefreshInterval(stored), refresh: async () => {}, active: () => true,
			onDeadline: value => { deadline = value; },
			setTimer: () => { timers++; return 1 as unknown as ReturnType<typeof setTimeout>; },
		});
		scheduler.start();
		assert.equal(timers, 0);
		assert.equal(deadline, null);
		scheduler.dispose();
	}
});

test('server and restricted browser storage default to off; only an explicit choice enables refresh', () => {
	const preference = createAutoRefreshPreference('test.interval', 'test-refresh');
	assert.equal(preference.read(), 'off');
	const stored = new Map<string, string>();
	const events = new EventTarget();
	const browser = Object.assign(events, { localStorage: {
		getItem: (key: string) => stored.get(key) ?? null,
		setItem: (key: string, value: string) => { stored.set(key, value); },
	} });
	Object.defineProperty(globalThis, 'window', { configurable: true, value: browser });
	try {
		assert.equal(preference.read(), 'off');
		let changes = 0;
		const unsubscribe = preference.subscribe(() => changes++);
		preference.write(300_000);
		assert.equal(preference.read(), 300_000);
		assert.equal(changes, 1);
		preference.write('off');
		assert.equal(preference.read(), 'off');
		unsubscribe();
		preference.write(60_000);
		assert.equal(changes, 2);
		// Each page owns its own opt-in; enabling routes must not enable maintenance.
		assert.equal(createAutoRefreshPreference('another.interval', 'another-refresh').read(), 'off');
		Object.defineProperty(browser, 'localStorage', { get() { throw new Error('blocked'); } });
		assert.equal(preference.read(), 'off');
	} finally {
		Reflect.deleteProperty(globalThis, 'window');
	}
});
