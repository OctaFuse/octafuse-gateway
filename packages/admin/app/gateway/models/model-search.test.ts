import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { modelMatchesSearch } from './model-utils';

const model = { id: 'deepseek-v4.1-flash', display_name: 'DeepSeek V4.1 Flash', vendor: 'deepseek', tags: ['低延迟', 'coding'] };
describe('model search', () => {
 it('accepts an empty query and ignores case and surrounding space', () => {
  assert.equal(modelMatchesSearch(model, '  '), true);
  assert.equal(modelMatchesSearch(model, '  DEEPSEEK  '), true);
 });
 it('matches IDs, names and tags across all terms', () => {
  assert.equal(modelMatchesSearch(model, 'v4.1 低延迟'), true);
  assert.equal(modelMatchesSearch(model, 'deepseek coding'), true);
  assert.equal(modelMatchesSearch(model, 'deepseek audio'), false);
 });
 it('handles missing optional fields', () => {
  assert.equal(modelMatchesSearch({ id: 'm1', display_name: null, vendor: '', tags: [] }, 'm1'), true);
 });
});
