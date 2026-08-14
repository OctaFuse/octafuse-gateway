import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { readPreviousResponseId, responsesStateRouteUnavailable } from './responses';
import type { RouteResult } from '../../services/model-router';

function route(targetId: string): RouteResult {
	return { targetId } as RouteResult;
}

describe('responses state routing guard', () => {
	it('reads a non-empty previous_response_id', () => {
		assert.equal(readPreviousResponseId({ previous_response_id: ' resp_1 ' }), 'resp_1');
		assert.equal(readPreviousResponseId({ previous_response_id: '   ' }), null);
		assert.equal(readPreviousResponseId({}), null);
	});

	it('allows stateless create on multiple targets', () => {
		assert.equal(responsesStateRouteUnavailable([route('a'), route('b')], null), false);
	});

	it('allows previous_response_id on a single target', () => {
		assert.equal(responsesStateRouteUnavailable([route('a')], 'resp_1'), false);
	});

	it('blocks previous_response_id when multiple targets are eligible', () => {
		assert.equal(responsesStateRouteUnavailable([route('a'), route('b')], 'resp_1'), true);
	});
});
