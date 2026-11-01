import { api } from '../../../lib/api';
import type { SavedTransactionResponse, TransactionDraft, TransactionPreview } from '../transactionPreview.types';

export async function createReceiptPreview(image: File): Promise<TransactionPreview> {
  const body = new FormData();
  body.append('image', image);
  return api<TransactionPreview>('/transactions/receipt', { method: 'POST', body });
}

export async function confirmReceiptPreview(
  previewId: string,
  draft: TransactionDraft,
  ocrText?: string,
): Promise<SavedTransactionResponse> {
  return api<SavedTransactionResponse>('/transactions/receipt/confirm', {
    method: 'POST',
    headers: { 'Idempotency-Key': crypto.randomUUID() },
    body: JSON.stringify({ preview_id: previewId, ...draft, ocr_text: ocrText }),
  });
}
