import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { isSensitiveContentErrorMessage } from './sensitive-content-detector';

describe('isSensitiveContentErrorMessage', () => {
	it('detects English upstream safety blocks', () => {
		assert.equal(
			isSensitiveContentErrorMessage(
				'HTTP 400: System detected potentially unsafe or sensitive content in input or generation.'
			)
		, true);
		assert.equal(
			isSensitiveContentErrorMessage(
				'HTTP 400: <400> InternalError.Algo.DataInspectionFailed: Input text data may contain inappropriate content.'
			)
		, true);
	});

	it('detects Chinese upstream safety blocks', () => {
		assert.equal(
			isSensitiveContentErrorMessage(
				'HTTP 400: 系统检测到输入或生成内容可能包含不安全或敏感内容，请您避免输入易产生敏感内容的提示词。'
			)
		, true);
		assert.equal(isSensitiveContentErrorMessage('内容审核未通过'), true);
	});

	it('does not classify generic client errors as sensitive', () => {
		assert.equal(isSensitiveContentErrorMessage('HTTP 400: bad request'), false);
		assert.equal(isSensitiveContentErrorMessage('HTTP 404: model not found'), false);
	});
});
