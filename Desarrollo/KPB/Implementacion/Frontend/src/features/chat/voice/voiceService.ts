import { api } from '../../../lib/api';
import type { SavedTransactionResponse, TransactionDraft, TransactionPreview } from '../transactionPreview.types';

const idempotencyKeys = new Map<string, string>();

function getIdempotencyKey(previewId: string, draft: TransactionDraft): string {
  const cacheKey = `${previewId}:${JSON.stringify(draft)}`;
  const existing = idempotencyKeys.get(cacheKey);
  if (existing) return existing;

  const key = crypto.randomUUID();
  if (idempotencyKeys.size >= 100) {
    const oldestKey = idempotencyKeys.keys().next().value;
    if (oldestKey) idempotencyKeys.delete(oldestKey);
  }
  idempotencyKeys.set(cacheKey, key);
  return key;
}

export async function createVoicePreview(audio: File): Promise<TransactionPreview> {
  const body = new FormData();
  body.append('audio', audio);
  body.append('language', 'es-PE');
  return api<TransactionPreview>('/transactions/voice', { method: 'POST', body });
}

export async function confirmVoicePreview(
  previewId: string,
  draft: TransactionDraft,
  requestIdempotencyKey?: string,
): Promise<SavedTransactionResponse> {
  return api<SavedTransactionResponse>('/transactions/voice/confirm', {
    method: 'POST',
    headers: { 'Idempotency-Key': requestIdempotencyKey ?? getIdempotencyKey(previewId, draft) },
    body: JSON.stringify({ preview_id: previewId, ...draft }),
  });
}
