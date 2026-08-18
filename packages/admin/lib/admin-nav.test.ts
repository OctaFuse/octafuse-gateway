import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { formatAdminDocumentTitle, matchAdminNavRoute } from './admin-nav';

describe('matchAdminNavRoute', () => {
	it('matches exact sidebar paths', () => {
		assert.equal(matchAdminNavRoute('/gateway/simulator')?.nameKey, 'simulator');
		assert.equal(matchAdminNavRoute('/dashboard')?.nameKey, 'dashboard');
	});

	it('prefers the longest href so nested tools pages win', () => {
		assert.equal(matchAdminNavRoute('/gateway/tools')?.nameKey, 'toolsConfig');
		assert.equal(matchAdminNavRoute('/gateway/tools/invocations')?.nameKey, 'toolInvocations');
	});

	it('treats user detail as Users', () => {
		assert.equal(matchAdminNavRoute('/gateway/users/abc-123')?.nameKey, 'users');
	});

	it('does not confuse analytics users with the Users page', () => {
		assert.equal(matchAdminNavRoute('/gateway/analytics/users')?.nameKey, 'userUsage');
	});

	it('returns null for unknown paths', () => {
		assert.equal(matchAdminNavRoute('/'), null);
		assert.equal(matchAdminNavRoute('/unknown'), null);
	});
});

describe('formatAdminDocumentTitle', () => {
	it('puts the page function before the product title', () => {
		assert.equal(
			formatAdminDocumentTitle('Simulator', 'Octafuse Gateway · Admin'),
			'Simulator · Octafuse Gateway · Admin',
		);
	});

	it('falls back to the product title when the page is unknown', () => {
		assert.equal(formatAdminDocumentTitle(null, 'Octafuse Gateway · Admin'), 'Octafuse Gateway · Admin');
		assert.equal(formatAdminDocumentTitle('  ', 'Octafuse Gateway · Admin'), 'Octafuse Gateway · Admin');
	});
});
