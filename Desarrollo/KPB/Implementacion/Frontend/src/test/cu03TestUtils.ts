import { Blob as NodeBlob, File as NodeFile } from 'node:buffer';
import { vi } from 'vitest';
import type { SavedTransactionResponse, TransactionDraft, TransactionPreview } from '../features/chat/transactionPreview.types';
import { foodCategory, makeTextPreview, testWallet } from './cu01Cu02TestUtils';

export function makeVoicePreview(extracted: Partial<TransactionPreview['extracted']> = {}): TransactionPreview {
  return makeTextPreview(extracted, {
    preview_id: 'preview-cu03-1',
    transcript: 'Gasté quince soles en el menú',
  });
}

export function makeVoiceDraft(preview = makeVoicePreview()): TransactionDraft {
  const { extracted } = preview;
  return {
    type: extracted.type, amount: extracted.amount ?? '', currency: extracted.currency,
    concept: extracted.concept, transaction_date: extracted.transaction_date,
    category_id: extracted.category.id, wallet_id: extracted.wallet_id ?? testWallet.id,
    merchant: extracted.merchant ?? '', ruc: extracted.ruc ?? '',
  };
}

export function makeSavedVoiceResponse(draft = makeVoiceDraft()): SavedTransactionResponse {
  return {
    transaction: {
      id: 'saved-cu03-1', type: draft.type, amount: draft.amount, currency: draft.currency,
      concept: draft.concept, transaction_date: draft.transaction_date, wallet_id: draft.wallet_id,
      category: { ...foodCategory, id: draft.category_id, type: draft.type },
    },
    wallet_name: testWallet.name,
    alerts: [],
  };
}

/** Node fetch no serializa el FormData de jsdom. Usa su propia familia de objetos multipart. */
export async function installNativeMultipartMocks() {
  // Response comparte las implementaciones nativas de fetch, sin depender de paquetes transitivos.
  const form = await new Response('', { headers: { 'Content-Type': 'application/x-www-form-urlencoded' } }).formData();
  vi.stubGlobal('FormData', form.constructor);
  vi.stubGlobal('File', NodeFile);
  vi.stubGlobal('Blob', NodeBlob);
}

/** Sustituye solo las APIs multimedia que jsdom no implementa; nunca usa el micrófono real. */
export function installVoiceBrowserMocks() {
  const media = { duration: 12, metadataError: false };
  const stopTrack = vi.fn();
  const stream = { getTracks: () => [{ stop: stopTrack }] } as unknown as MediaStream;
  const getUserMedia = vi.fn<() => Promise<MediaStream>>().mockResolvedValue(stream);
  const recorders: RecorderStub[] = [];

  class RecorderStub {
    static isTypeSupported = vi.fn((type: string) => type === 'audio/webm;codecs=opus');
    state: RecordingState = 'inactive';
    mimeType: string;
    ondataavailable: ((event: { data: Blob }) => void) | null = null;
    onstop: (() => void) | null = null;
    onerror: (() => void) | null = null;
    start = vi.fn(() => { this.state = 'recording'; });
    stop = vi.fn(() => { this.state = 'inactive'; this.onstop?.(); });

    constructor(_stream: MediaStream, options?: MediaRecorderOptions) {
      this.mimeType = options?.mimeType ?? 'audio/webm';
      recorders.push(this);
    }

    emitData(data = new Blob(['audio-cu03'], { type: this.mimeType })) {
      this.ondataavailable?.({ data });
    }
  }

  class AudioStub {
    duration = media.duration;
    onloadedmetadata: (() => void) | null = null;
    onerror: (() => void) | null = null;
    set src(value: string) {
      if (!value) return;
      queueMicrotask(() => {
        if (media.metadataError) this.onerror?.();
        else this.onloadedmetadata?.();
      });
    }
  }

  const descriptors = [
    { target: navigator, name: 'mediaDevices', value: { getUserMedia } },
    { target: URL, name: 'createObjectURL', value: vi.fn(() => 'blob:cu03-audio') },
    { target: URL, name: 'revokeObjectURL', value: vi.fn() },
  ].map(({ target, name, value }) => {
    const descriptor = Object.getOwnPropertyDescriptor(target, name);
    Object.defineProperty(target, name, { configurable: true, writable: true, value });
    return { target, name, descriptor };
  });
  vi.stubGlobal('MediaRecorder', RecorderStub);
  vi.stubGlobal('Audio', AudioStub);

  return {
    media, stream, stopTrack, getUserMedia, recorders, RecorderStub,
    restore() {
      for (const { target, name, descriptor } of descriptors) {
        if (descriptor) Object.defineProperty(target, name, descriptor);
        else Reflect.deleteProperty(target, name);
      }
      vi.unstubAllGlobals();
    },
  };
}
