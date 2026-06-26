import { describe, expect, it } from 'vitest';
import { isSensitiveContentErrorMessage } from './sensitive-content-detector';

describe('isSensitiveContentErrorMessage', () => {
	it('detects English upstream safety blocks', () => {
		expect(
			isSensitiveContentErrorMessage(
				'HTTP 400: System detected potentially unsafe or sensitive content in input or generation.'
			)
		).toBe(true);
		expect(
			isSensitiveContentErrorMessage(
				'HTTP 400: <400> InternalError.Algo.DataInspectionFailed: Input text data may contain inappropriate content.'
			)
		).toBe(true);
	});

	it('detects Chinese upstream safety blocks', () => {
		expect(
			isSensitiveContentErrorMessage(
				'HTTP 400: 系统检测到输入或生成内容可能包含不安全或敏感内容，请您避免输入易产生敏感内容的提示词。'
			)
		).toBe(true);
		expect(isSensitiveContentErrorMessage('内容审核未通过')).toBe(true);
	});

	it('does not classify generic client errors as sensitive', () => {
		expect(isSensitiveContentErrorMessage('HTTP 400: bad request')).toBe(false);
		expect(isSensitiveContentErrorMessage('HTTP 404: model not found')).toBe(false);
	});
});
