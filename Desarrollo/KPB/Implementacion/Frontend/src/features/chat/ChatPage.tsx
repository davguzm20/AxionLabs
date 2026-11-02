import { useEffect, useRef, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { RotateCcw } from 'lucide-react';
import { api } from '../../lib/api';
import { ChatBubble } from './components/ChatBubble';
import type { BotMood } from './components/ChatBubble';
import { AlertCard, type BudgetAlert } from './components/AlertCard';
import { ChatInput } from './components/ChatInput';
import { ConfirmationCard, type Transaction, type TransactionStatus } from './components/ConfirmationCard';
import { TransactionPreviewCard } from './components/TransactionPreviewCard';
import { VoiceRecorder } from './voice/VoiceRecorder';
import { confirmVoicePreview, createVoicePreview } from './voice/voiceService';
import { confirmReceiptPreview, createReceiptPreview } from './receipt/receiptService';
import { validateReceiptImage } from './receipt/imageValidation';
import type { TransactionDraft, TransactionPreview } from './transactionPreview.types';
import { NotificationBell } from '../notifications/components/NotificationBell';

type ChatMessage =
  | { id: string; kind: 'bubble'; author: 'bot' | 'user'; text: string; botMood?: BotMood }
  | { id: string; kind: 'confirmation'; transaction: Transaction; walletName: string; idempotencyKey: string; idempotencyPayload?: string; status: TransactionStatus; isSaving?: boolean; saveError?: string }
  | { id: string; kind: 'preview'; source: 'TEXT' | 'VOICE' | 'RECEIPT'; preview: TransactionPreview; suggestedCategoryId?: string; imageFile?: File; isSaving?: boolean; saveError?: string }
  | { id: string; kind: 'alert'; alert: BudgetAlert };
type SaveResponse = { transaction: Transaction; alerts?: BudgetAlert[]; budget_alert?: BudgetAlert; wallet_name?: string };
type ApiError = Error & { status?: number; code?: string };

export function ChatPage() {
  const queryClient = useQueryClient();
  const [messages, setMessages] = useState<ChatMessage[]>([
    { id: 'greeting', kind: 'bubble', author: 'bot', text: '¡Hola! Soy KhipuBot. ¿Qué gastos o ingresos tuviste hoy? Puedes escribirme, enviarme un audio o la foto de un comprobante.' },
  ]);
  const [draft, setDraft] = useState('');
  const [sending, setSending] = useState(false);
  const [voiceRecorderOpen, setVoiceRecorderOpen] = useState(false);
  const [retryText, setRetryText] = useState<string>();
  const logRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const previewIdempotencyKeys = useRef(new Map<string, string>());

  useEffect(() => {
    if (sending || voiceRecorderOpen) return;
    const frame = requestAnimationFrame(() => inputRef.current?.focus());
    return () => cancelAnimationFrame(frame);
  }, [sending, messages.length, voiceRecorderOpen]);

  async function sendText(text: string) {
    const value = text.trim();
    if (!value || sending) return;

    setMessages((current) => [...current.slice(-48), { id: crypto.randomUUID(), kind: 'bubble', author: 'user', text: value }]);
    setSending(true);
    setRetryText(undefined);
    try {
      const preview = await api<TransactionPreview>('/extractions/text', {
        method: 'POST',
        body: JSON.stringify({ text: value, client_timezone: 'America/Lima' }),
      });
      setMessages((current) => [...current.slice(-48), { id: preview.preview_id, kind: 'preview', source: 'TEXT', preview, suggestedCategoryId: preview.extracted.category.id }]);
    } catch (error) {
      const apiError = error as ApiError;
      const isMissingAmount = apiError.code === 'AMOUNT_NOT_DETECTED';
      const message = isMissingAmount
        ? 'No pude identificar el monto. \u00bfCu\u00e1nto fue el gasto/ingreso?'
        : apiError.code === 'NLP_UNAVAILABLE'
          ? 'El servicio no est\u00e1 disponible. Int\u00e9ntalo nuevamente.'
          : apiError.message || 'No pude registrar la transacci\u00f3n. Int\u00e9ntalo nuevamente.';
      setMessages((current) => [...current.slice(-49), {
        id: crypto.randomUUID(),
        kind: 'bubble',
        author: 'bot',
        text: message,
        botMood: 'sad',
      }]);
      if (apiError.code === 'NLP_UNAVAILABLE') setRetryText(value);
    } finally {
      setSending(false);
      requestAnimationFrame(() => {
        if (logRef.current) logRef.current.scrollTop = logRef.current.scrollHeight;
      });
    }
  }

  async function confirmTransaction(messageId: string, transaction: Transaction) {
    const confirmation = messages.find((message) => message.kind === 'confirmation' && message.id === messageId);
    if (!confirmation || confirmation.kind !== 'confirmation') return;
    const idempotencyPayload = JSON.stringify(transaction);
    const idempotencyKey = confirmation.idempotencyPayload === idempotencyPayload
      ? confirmation.idempotencyKey
      : crypto.randomUUID();
    setMessages((current) => current.map((message) => message.kind === 'confirmation' && message.id === messageId
      ? { ...message, idempotencyKey, idempotencyPayload, isSaving: true, saveError: undefined }
      : message));
    try {
      const response = await api<SaveResponse>('/transactions', {
        method: 'POST',
        headers: { 'Idempotency-Key': idempotencyKey },
        body: JSON.stringify({
          preview_id: messageId,
          type: transaction.type,
          amount: transaction.amount,
          currency: transaction.currency,
          concept: transaction.concept,
          transaction_date: transaction.transaction_date,
          wallet_id: transaction.wallet_id,
          category_id: transaction.category.id,
        }),
      });
      void queryClient.invalidateQueries({ queryKey: ['budgets'] });
      void queryClient.invalidateQueries({ queryKey: ['notifications'] });
      setMessages((current) => {
        const confirmationIndex = current.findIndex((message) => message.kind === 'confirmation' && message.id === messageId);
        const next = current.map((message) => message.kind === 'confirmation' && message.id === messageId
          ? { ...message, transaction: response.transaction, status: 'confirmed' as const, isSaving: false, saveError: undefined }
          : message);
        if (response.alerts?.length && confirmationIndex >= 0) {
          next.splice(confirmationIndex + 1, 0, ...response.alerts.map((alert) => ({
            id: crypto.randomUUID(),
            kind: 'alert' as const,
            alert,
          })));
        }
        return next;
      });
    } catch {
      setMessages((current) => current.map((message) => message.kind === 'confirmation' && message.id === messageId
        ? { ...message, isSaving: false, saveError: 'No se pudo guardar la transacción. Inténtalo nuevamente.' }
        : message));
    }
  }

  async function sendVoice(audio: File) {
    setSending(true);
    try {
      const preview = await createVoicePreview(audio);
      setMessages((current) => [...current.slice(-48), {
        id: preview.preview_id,
        kind: 'preview',
        source: 'VOICE',
        preview,
      }]);
      requestAnimationFrame(() => {
        if (logRef.current) logRef.current.scrollTop = logRef.current.scrollHeight;
      });
    } finally {
      setSending(false);
    }
  }

  async function sendReceipt(image: File) {
    const validationError = await validateReceiptImage(image);
    if (validationError) {
      setMessages((current) => [...current, {
        id: crypto.randomUUID(),
        kind: 'bubble',
        author: 'bot',
        text: validationError,
        botMood: 'surprised',
      }]);
      return;
    }

    setSending(true);
    try {
      const preview = await createReceiptPreview(image);
      setMessages((current) => [...current.slice(-48), {
        id: preview.preview_id,
        kind: 'preview',
        source: 'RECEIPT',
        preview,
        imageFile: image,
      }]);
      requestAnimationFrame(() => {
        if (logRef.current) logRef.current.scrollTop = logRef.current.scrollHeight;
      });
    } catch (error) {
      setMessages((current) => [...current, {
        id: crypto.randomUUID(),
        kind: 'bubble',
        author: 'bot',
        text: error instanceof Error ? error.message : 'No se pudo leer el comprobante. Inténtalo nuevamente.',
        botMood: 'sad',
      }]);
    } finally {
      setSending(false);
    }
  }

  async function confirmPreview(messageId: string, source: 'TEXT' | 'VOICE' | 'RECEIPT', transactionDraft: TransactionDraft) {
    setMessages((current) => current.map((message) => message.kind === 'preview' && message.id === messageId
      ? { ...message, isSaving: true, saveError: undefined }
      : message));
    try {
      const preview = messages.find((message) => message.kind === 'preview' && message.id === messageId);
      if (!preview || preview.kind !== 'preview') return;
      const idempotencyKey = previewIdempotencyKeys.current.get(messageId) ?? crypto.randomUUID();
      previewIdempotencyKeys.current.set(messageId, idempotencyKey);
      const response = source === 'TEXT'
        ? await api<SaveResponse>('/transactions', {
          method: 'POST',
          headers: { 'Idempotency-Key': idempotencyKey },
          body: JSON.stringify({
            preview_id: preview.preview.preview_id,
            type: transactionDraft.type.toLocaleLowerCase(),
            amount: transactionDraft.amount,
            currency: transactionDraft.currency,
            concept: transactionDraft.concept,
            occurred_at: `${transactionDraft.transaction_date}T12:00:00-05:00`,
            wallet_id: transactionDraft.wallet_id,
            category_id: transactionDraft.category_id,
            source: 'text',
            category_source: transactionDraft.category_id === preview.suggestedCategoryId ? 'suggested' : 'manual',
          }),
        })
        : source === 'VOICE'
          ? await confirmVoicePreview(preview.preview.preview_id, transactionDraft)
          : await confirmReceiptPreview(preview.preview.preview_id, transactionDraft, preview.preview.ocr_text);
      const savedTransaction: Transaction = {
        ...response.transaction,
        category: {
          ...response.transaction.category,
          icon: response.transaction.category.icon ?? 'circle-help',
        },
      };
      void queryClient.invalidateQueries({ queryKey: ['budgets'] });
      void queryClient.invalidateQueries({ queryKey: ['notifications'] });
      void queryClient.invalidateQueries({ queryKey: ['transactions'] });
      void queryClient.invalidateQueries({ queryKey: ['wallets'] });
      void queryClient.invalidateQueries({ queryKey: ['dashboard'] });
      const budgetAlert = 'budget_alert' in response ? response.budget_alert : undefined;
      previewIdempotencyKeys.current.delete(messageId);
      setMessages((current) => {
        const next = current.map((message) => message.kind === 'preview' && message.id === messageId
          ? {
            id: message.id,
            kind: 'confirmation' as const,
            transaction: savedTransaction,
            walletName: response.wallet_name ?? 'Monedero',
            idempotencyKey: crypto.randomUUID(),
            status: 'confirmed' as const,
          }
          : message);
        const alerts = [...(response.alerts ?? []), ...(budgetAlert ? [budgetAlert] : [])];
        if (alerts.length) {
          const index = next.findIndex((message) => message.id === messageId);
          next.splice(index + 1, 0, ...alerts.map((alert) => ({
            id: crypto.randomUUID(),
            kind: 'alert' as const,
            alert,
          })));
        }
        return next;
      });
    } catch (error) {
      const messageText = error instanceof Error ? error.message : 'No se pudo guardar la transacción. Inténtalo nuevamente.';
      setMessages((current) => current.map((message) => message.kind === 'preview' && message.id === messageId
        ? { ...message, isSaving: false, saveError: messageText }
        : message));
    }
  }

  return (
    <section aria-labelledby="chat-title" className="flex h-[100dvh] w-full flex-col overflow-hidden bg-white pb-[calc(4rem+env(safe-area-inset-bottom))] lg:pb-0">
      <header className="flex min-h-[4.5rem] items-center gap-3 border-b border-ink-300 bg-white px-4 py-3">
        <img src="/logo.png" alt="" className="h-10 w-10 rounded-full object-cover" />
        <div className="min-w-0 flex-1">
          <h1 id="chat-title" className="font-semibold text-ink-900">KhipuBot</h1>
          <p className="text-xs text-brand-700"><span aria-hidden="true">●</span> En línea</p>
        </div>
        <NotificationBell />
      </header>

      <div ref={logRef} role="log" aria-live="polite" aria-label="Conversación con KhipuBot" className="min-h-0 flex-1 space-y-4 overflow-y-auto bg-white p-4">
        {messages.map((message) => message.kind === 'bubble'
          ? <ChatBubble key={message.id} author={message.author} botMood={message.botMood}>{message.text}</ChatBubble>
          : message.kind === 'confirmation'
            ? <div key={message.id}>
              <ConfirmationCard
                transaction={message.transaction}
                walletName={message.walletName}
                status={message.status}
                isAccepting={message.isSaving}
                onAccept={(transaction) => void confirmTransaction(message.id, transaction)}
              />
              {message.saveError && <p role="alert" className="ml-[4.25rem] mt-2 text-sm text-danger-600">{message.saveError}</p>}
            </div>
            : message.kind === 'preview'
              ? <TransactionPreviewCard
                key={message.id}
                source={message.source}
                preview={message.preview}
                imageFile={message.imageFile}
                isSaving={message.isSaving ?? false}
                saveError={message.saveError}
                onEdit={(updatedDraft, category) => setMessages((current) => current.map((item) => item.kind === 'preview' && item.id === message.id
                  ? { ...item, preview: { ...item.preview, extracted: { ...item.preview.extracted, amount: updatedDraft.amount, concept: updatedDraft.concept, category } } }
                  : item))}
                onConfirm={(transactionDraft) => void confirmPreview(message.id, message.source, transactionDraft)}
              />
              : <AlertCard key={message.id} alert={message.alert} />)}
        {sending && <div className="flex items-center gap-2 text-sm text-ink-500" role="status"><img src="/logo.png" alt="" className="h-8 w-8 rounded-full" />KhipuBot está preparando la transacción…</div>}
        {retryText && !sending && (
          <div className="flex items-start gap-3">
            <span aria-hidden="true" className="h-14 w-14 shrink-0" />
            <button
              type="button"
              onClick={() => sendText(retryText)}
              className="inline-flex min-h-11 items-center justify-center gap-2 rounded-lg border border-gray-300 bg-white px-4 py-2 text-sm text-gray-700 hover:bg-gray-50"
            >
              <RotateCcw aria-hidden="true" size={16} />
              Reintentar
            </button>
          </div>
        )}
      </div>

      <div className="shrink-0 border-t border-ink-300 bg-white p-4">
        <ChatInput
          value={draft}
          onChange={setDraft}
          onSend={sendText}
          onVoice={() => setVoiceRecorderOpen(true)}
          onReceiptFile={sendReceipt}
          disabled={sending}
          textareaRef={inputRef}
        />
      </div>
      {voiceRecorderOpen && <VoiceRecorder onClose={() => setVoiceRecorderOpen(false)} onSubmit={sendVoice} />}
    </section>
  );
}
