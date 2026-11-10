import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildKeyCreatePayload, buildKeyEditPayload, type KeyCreateDraft } from './key-form';

const draft: KeyCreateDraft = {
  user_id: ' user-1 ',
  email: '',
  external_system: '',
  external_user_id: '',
  name: ' agent ',
  metadata: '',
};
test('existing-user key creation trims fields and never sends external identity', () => {
  assert.deepEqual(
    buildKeyCreatePayload('existingUser', { ...draft, email: 'ignored@example.com' }),
    { user_id: 'user-1', name: 'agent', metadata: null, reason: 'gwui:new' }
  );
  assert.throws(
    () => buildKeyCreatePayload('existingUser', { ...draft, user_id: ' ' }),
    /userRequired/
  );
});
test('external identity creation requires a pair and valid email, never sends user_id', () => {
  const external = {
    ...draft,
    external_system: ' portal ',
    external_user_id: ' external-1 ',
    email: ' test@example.com ',
  };
  assert.deepEqual(buildKeyCreatePayload('externalIdentity', external), {
    external_system: 'portal',
    external_user_id: 'external-1',
    email: 'test@example.com',
    name: 'agent',
    metadata: null,
    reason: 'gwui:new',
  });
  assert.throws(
    () => buildKeyCreatePayload('externalIdentity', { ...external, external_user_id: '' }),
    /externalRequired/
  );
  assert.throws(
    () => buildKeyCreatePayload('externalIdentity', { ...external, email: '' }),
    /emailRequired/
  );
  assert.throws(
    () => buildKeyCreatePayload('externalIdentity', { ...external, email: 'broken' }),
    /emailInvalid/
  );
});
test('edit keeps zero distinct from unlimited and never submits user quotas or status', () => {
  const base = { name: ' ', metadata: '', rateLimitRpm: '' };
  assert.deepEqual(buildKeyEditPayload(base), {
    name: null,
    metadata: null,
    rate_limit: null,
    reason: 'gwui:edit',
  });
  assert.deepEqual(buildKeyEditPayload({ ...base, rateLimitRpm: '0' }).rate_limit, { rpm: 0 });
  for (const rateLimitRpm of ['-1', '1.5', 'Infinity', 'NaN', '4oops'])
    assert.throws(() => buildKeyEditPayload({ ...base, rateLimitRpm }), /rpm/);
});
test('metadata validation preserves existing JSON value contract and rejects invalid JSON', () => {
  assert.equal(
    buildKeyCreatePayload('existingUser', { ...draft, metadata: '{ "plan": "pro" }' }).metadata,
    '{"plan":"pro"}'
  );
  assert.equal(buildKeyCreatePayload('existingUser', { ...draft, metadata: '[]' }).metadata, '[]');
  assert.throws(
    () => buildKeyCreatePayload('existingUser', { ...draft, metadata: '{' }),
    /metadata/
  );
  assert.throws(
    () => buildKeyEditPayload({ name: '', rateLimitRpm: '', metadata: '{' }),
    /metadata/
  );
});
