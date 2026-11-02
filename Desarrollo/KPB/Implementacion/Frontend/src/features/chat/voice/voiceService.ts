import { api } from '../../../lib/api';
import type { SavedTransactionResponse, TransactionDraft, TransactionPreview } from '../transactionPreview.types';

export async function createVoicePreview(audio: File): Promise<TransactionPreview> {
  const body = new FormData();
  body.append('audio', audio);
  body.append('language', 'es-PE');
  return api<TransactionPreview>('/transactions/voice', { method: 'POST', body });
}

export async function confirmVoicePreview(previewId: string, draft: TransactionDraft): Promise<SavedTransactionResponse> {
  return api<SavedTransactionResponse>('/transactions/voice/confirm', {
    method: 'POST',
    headers: { 'Idempotency-Key': crypto.randomUUID() },
    body: JSON.stringify({ preview_id: previewId, ...draft }),
  });
}
