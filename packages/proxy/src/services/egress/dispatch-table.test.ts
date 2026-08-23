import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
	implementedConversionAdapterIds,
	registryConversionAdapterIds,
} from './dispatch-table';

describe('adapter dispatch table', () => {
	it('implements every conversion adapter declared in the registry', () => {
		const implemented = new Set(implementedConversionAdapterIds());
		const declared = registryConversionAdapterIds();
		assert.deepEqual([...implemented].sort(), [...declared].sort());
	});

	it('does not register implementations that the registry does not declare', () => {
		const declared = new Set(registryConversionAdapterIds());
		for (const id of implementedConversionAdapterIds()) {
			assert.equal(declared.has(id), true, `orphan dispatch implementation: ${id}`);
		}
	});
});
