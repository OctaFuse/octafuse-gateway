import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { listProviderQuotaKinds } from '@octafuse/core/provider-quota';
import { isKnownProviderKind } from './provider-import-preset';
import {
	CUSTOM_PROVIDER_KIND,
	UNCLASSIFIED_PROVIDER_KIND_FILTER,
	buildProviderKindFilterOptions,
	compareProvidersByKindThenName,
	formatProviderAccountLabel,
	formatProviderPickerLabel,
	providerKindFilterKey,
	sortProvidersByKindThenName,
} from './provider-kind';

const ark = { en: 'Volcengine Ark', zh: '火山方舟' };
const studio = { en: 'Alibaba Cloud Model Studio', zh: '阿里云百炼' };

describe('formatProviderPickerLabel', () => {
	it('puts the type before the account alias', () => {
		assert.equal(formatProviderPickerLabel('1084', 'Volcengine Ark'), 'Volcengine Ark · 1084');
	});

	it('keeps the account-first label for already chosen accounts', () => {
		assert.equal(formatProviderAccountLabel('1084', 'Volcengine Ark'), '1084 · Volcengine Ark');
	});

	it('omits a missing type and a type that repeats the alias', () => {
		assert.equal(formatProviderPickerLabel('七牛云', null), '七牛云');
		assert.equal(formatProviderPickerLabel('Moonshot AI', 'moonshot ai'), 'Moonshot AI');
	});
});

describe('providerKindFilterKey', () => {
	it('uses a dedicated key for an empty kind', () => {
		assert.equal(providerKindFilterKey(''), UNCLASSIFIED_PROVIDER_KIND_FILTER);
		assert.equal(providerKindFilterKey('  '), UNCLASSIFIED_PROVIDER_KIND_FILTER);
		assert.equal(providerKindFilterKey('openai'), 'openai');
	});
});

describe('compareProvidersByKindThenName', () => {
	const providers = [
		{ id: 'b', name: '谷仓', kind: 'studio', kind_labels: studio },
		{ id: 'a', name: '七牛云', kind: '' },
		{ id: 'c', name: '1084', kind: 'ark', kind_labels: ark },
		{ id: 'd', name: '8612', kind: 'ark', kind_labels: ark },
		{ id: 'e', name: '自定义甲', kind: CUSTOM_PROVIDER_KIND },
	];

	it('groups the same localized type and leaves unclassified last', () => {
		const sorted = sortProvidersByKindThenName(providers, 'zh', '自定义').map((provider) => provider.name);
		assert.deepEqual(sorted, ['谷仓', '1084', '8612', '自定义甲', '七牛云']);
	});

	it('uses the localized type name for the current locale', () => {
		const left = { name: 'a', kind: 'z', kind_labels: { en: 'Zoom', zh: '阿尔法' } };
		const right = { name: 'b', kind: 'a', kind_labels: { en: 'Alpha', zh: '泽塔' } };
		assert.ok(compareProvidersByKindThenName(left, right, 'en', 'Custom') > 0);
		assert.ok(compareProvidersByKindThenName(left, right, 'zh', '自定义') < 0);
	});
});

describe('buildProviderKindFilterOptions', () => {
	it('counts routes per type and hides types with no provider', () => {
		const options = buildProviderKindFilterOptions({
			providers: [
				{ id: 'p1', name: '1084', kind: 'ark', kind_labels: ark },
				{ id: 'p2', name: '8612', kind: 'ark', kind_labels: ark },
				{ id: 'p3', name: '七牛云', kind: '' },
			],
			routeProviderIds: ['p1', 'p1', 'p2', 'missing'],
			locale: 'en',
			customLabel: 'Custom',
			unclassifiedLabel: 'Unclassified',
		});
		assert.deepEqual(options, [
			{ key: 'ark', label: 'Volcengine Ark', count: 3 },
			{ key: UNCLASSIFIED_PROVIDER_KIND_FILTER, label: 'Unclassified', count: 0 },
		]);
	});

	it('keeps a selected type that is no longer in the catalog', () => {
		const options = buildProviderKindFilterOptions({
			providers: [],
			routeProviderIds: [],
			locale: 'en',
			customLabel: 'Custom',
			unclassifiedLabel: 'Unclassified',
			selectedKey: 'gone',
		});
		assert.deepEqual(options, [{ key: 'gone', label: 'gone', count: 0 }]);
	});
});

describe('provider quota kinds', () => {
	it('only registers quota adapters for known provider templates', () => {
		const kinds = listProviderQuotaKinds();
		assert.ok(kinds.length > 0);
		for (const kind of kinds) {
			assert.equal(isKnownProviderKind(kind), true, kind);
		}
	});
});
