import { normalizeMetadataClient } from '@/lib/normalize-metadata-client';

export type KeyCreationMode = 'existingUser' | 'externalIdentity';
export type KeyCreateDraft = {
  user_id: string;
  email: string;
  external_system: string;
  external_user_id: string;
  name: string;
  metadata: string;
};

function metadataValue(raw: string) {
  const metadata = normalizeMetadataClient(raw);
  if (!metadata.ok) throw new Error('metadata');
  return metadata.value;
}

export function buildKeyCreatePayload(mode: KeyCreationMode, draft: KeyCreateDraft) {
  const payload: Record<string, unknown> = {
    metadata: metadataValue(draft.metadata),
    reason: 'gwui:new',
  };
  if (mode === 'existingUser') {
    const id = draft.user_id.trim();
    if (!id) throw new Error('userRequired');
    payload.user_id = id;
  } else {
    const system = draft.external_system.trim();
    const id = draft.external_user_id.trim();
    if (!system || !id) throw new Error('externalRequired');
    const email = draft.email.trim();
    if (!email) throw new Error('emailRequired');
    if (!/^[^\s@]+@[^\s@]+$/.test(email)) throw new Error('emailInvalid');
    payload.external_system = system;
    payload.external_user_id = id;
    payload.email = email;
  }
  if (draft.name.trim()) payload.name = draft.name.trim();
  return payload;
}

export function buildKeyEditPayload(draft: {
  name: string;
  metadata: string;
  rateLimitRpm: string;
}) {
  const raw = draft.rateLimitRpm.trim();
  const rpm = raw === '' ? null : Number(raw);
  if (rpm != null && (!Number.isFinite(rpm) || rpm < 0 || !Number.isInteger(rpm)))
    throw new Error('rpm');
  return {
    name: draft.name.trim() || null,
    metadata: metadataValue(draft.metadata),
    rate_limit: rpm == null ? null : { rpm },
    reason: 'gwui:edit',
  };
}
