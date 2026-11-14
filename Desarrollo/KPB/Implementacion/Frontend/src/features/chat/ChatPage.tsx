import { useEffect, useRef, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { RotateCcw } from 'lucide-react';
import { api } from '../../lib/api';
import { ChatBubble } from './components/ChatBubble';
import type { BotMood } from './components/ChatBubble';
import { AlertCard, type ChatAlert } from './components/AlertCard';
import { ChatInput } from './components/ChatInput';
import { ConfirmationCard, type Transaction, type TransactionStatus } from './components/ConfirmationCard';
import { TransactionPreviewCard } from './components/TransactionPreviewCard';
import { VoiceRecorder } from './voice/VoiceRecorder';
import { confirmVoicePreview, createVoicePreview } from './voice/voiceService';
import { confirmReceiptPreview, createReceiptPreview } from './receipt/receiptService';
import { validateReceiptImage } from './receipt/imageValidation';
import type { Api10SavedTransaction, Api10SavedTransactionResponse, LegacyBudgetAlert, SavedTransactionResponse, TransactionDraft, TransactionPreview } from './transactionPreview.types';
import { NotificationBell } from '../notifications/components/NotificationBell';

type ChatMessage =
  | { id: string; kind: 'bubble'; author: 'bot' | 'user'; text: string; botMood?: BotMood }
  | { id: string; kind: 'confirmation'; transaction: Transaction; walletName: string; idempotencyKey: string; idempotencyPayload?: string; status: TransactionStatus; isSaving?: boolean; saveError?: string }
  | { id: string; kind: 'preview'; source: 'TEXT' | 'VOICE' | 'RECEIPT'; preview: TransactionPreview; suggestedCategoryId?: string; imageFile?: File; isSaving?: boolean; saveError?: string }
  | { id: string; kind: 'alert'; alert: ChatAlert };
type SaveResponse = Api10SavedTransactionResponse | SavedTransactionResponse;
type ApiError = Error & { status?: number; code?: string };

function highestPriorityAlert(alerts: ChatAlert[]): ChatAlert | undefined {
  return alerts.reduce<ChatAlert | undefined>((highest, alert) => {
    if (!highest) return alert;
    const isHighPriority = (value: ChatAlert) => value.priority?.toLocaleLowerCase() === 'high';
    const alertIsHighPriority = isHighPriority(alert);
    const highestIsHighPriority = isHighPriority(highest);
    if (alertIsHighPriority !== highestIsHighPriority) return alertIsHighPriority ? alert : highest;
    return (alert.threshold_percentage ?? 0) > (highest.threshold_percentage ?? 0) ? alert : highest;
  }, undefined);
}

function toChatTransaction(transaction: Api10SavedTransaction | SavedTransactionResponse['transaction']): Transaction {
  if ('wallet' in transaction) {
    return {
      id: transaction.id,
      type: transaction.type.toUpperCase() as Transaction['type'],
      amount: transaction.amount,
      currency: transaction.currency,
      concept: transaction.concept,
      transaction_date: transaction.occurred_at.slice(0, 10),
      wallet_id: transaction.wallet.id,
      category: { ...transaction.category, icon: 'circle-help' },
    };
  }
  return { ...transaction, category: { ...transaction.category, icon: transaction.category.icon ?? 'circle-help' } };
}

export function ChatPage() {
  const queryClient = useQueryClient();
  const [messages, setMessages] = useState<ChatMessage[]>(() => {
    if (typeof localStorage !== 'undefined') {
      try {
        const saved = localStorage.getItem('khipubot_chat_messages');
        if (saved) {
          const parsed = JSON.parse(saved) as ChatMessage[];
          if (Array.isArray(parsed)) {
            return parsed.map((message) => message.kind === 'preview'
              ? { ...message, imageFile: undefined, isSaving: false }
              : message.kind === 'confirmation' ? { ...message, isSaving: false } : message);
          }
        }
      } catch {
        // Ignore invalid or unavailable browser storage.
      }
    }
    return [
    { id: 'greeting', kind: 'bubble', author: 'bot', text: '¡Hola! Soy KhipuBot. ¿Qué gastos o ingresos tuviste hoy? Puedes escribirme, enviarme un audio o la foto de un comprobante.' },
  ];
  });
  const [draft, setDraft] = useState('');
  const [sending, setSending] = useState(false);
  const [voiceRecorderOpen, setVoiceRecorderOpen] = useState(false);
  const [retryText, setRetryText] = useState<string>();
  const [textValidationError, setTextValidationError] = useState<string>();
  const logRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const previewIdempotencyKeys = useRef(new Map<string, { payload: string; key: string }>());
  const savingPreviewIds = useRef(new Set<string>());

  useEffect(() => {
    if (typeof localStorage === 'undefined') return;
    if (!localStorage.getItem('access_token')) {
      localStorage.removeItem('khipubot_chat_messages');
      return;
    }
    if (messages.length === 0) return;
    try {
      const persistentMessages = messages.map((message) => message.kind === 'preview'
        ? { ...message, imageFile: undefined, isSaving: false }
        : message.kind === 'confirmation' ? { ...message, isSaving: false } : message);
      localStorage.setItem('khipubot_chat_messages', JSON.stringify(persistentMessages));
    } catch {
      // Keep the chat usable when browser storage is unavailable.
    }
  }, [messages]);

  useEffect(() => {
    if (sending || voiceRecorderOpen) return;
    const frame = requestAnimationFrame(() => inputRef.current?.focus());
    return () => cancelAnimationFrame(frame);
  }, [sending, messages.length, voiceRecorderOpen]);

  async function sendText(text: string) {
    const value = text.trim();
    if (!value || sending) return;
    if (value.length > 500) {
      setTextValidationError('El texto no puede superar 500 caracteres.');
      return;
    }
    setTextValidationError(undefined);

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
          ? apiError.message || 'El servicio no est\u00e1 disponible. Por favor intente nuevamente'
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
      const response = await api<Api10SavedTransactionResponse>('/transactions', {
        method: 'POST',
        headers: { 'Idempotency-Key': idempotencyKey },
        body: JSON.stringify({
          type: transaction.type.toLowerCase(),
          amount: transaction.amount,
          currency: transaction.currency,
          concept: transaction.concept,
          occurred_at: `${transaction.transaction_date}T12:00:00-05:00`,
          wallet_id: transaction.wallet_id,
          category_id: transaction.category.id,
          category_source: transaction.category.source === 'suggested' ? 'suggested' : 'manual',
          source: 'manual',
        }),
      });
      void queryClient.invalidateQueries({ queryKey: ['budgets'] });
      void queryClient.invalidateQueries({ queryKey: ['notifications'] });
      setMessages((current) => {
        const confirmationIndex = current.findIndex((message) => message.kind === 'confirmation' && message.id === messageId);
        const next = current.map((message) => message.kind === 'confirmation' && message.id === messageId
          ? { ...message, transaction: toChatTransaction(response.transaction), status: 'confirmed' as const, isSaving: false, saveError: undefined }
          : message);
        const alert = response.budget_alert;
        if (alert && confirmationIndex >= 0) {
          next.splice(confirmationIndex + 1, 0, {
            id: crypto.randomUUID(),
            kind: 'alert',
            alert,
          });
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
    if (savingPreviewIds.current.has(messageId)) return;
    savingPreviewIds.current.add(messageId);
    setMessages((current) => current.map((message) => message.kind === 'preview' && message.id === messageId
      ? { ...message, isSaving: true, saveError: undefined }
      : message));
    try {
      const preview = messages.find((message) => message.kind === 'preview' && message.id === messageId);
      if (!preview || preview.kind !== 'preview') return;
      const idempotencyPayload = JSON.stringify(transactionDraft);
      const previousIdempotency = previewIdempotencyKeys.current.get(messageId);
      const idempotencyKey = previousIdempotency?.payload === idempotencyPayload
        ? previousIdempotency.key
        : crypto.randomUUID();
      previewIdempotencyKeys.current.set(messageId, { payload: idempotencyPayload, key: idempotencyKey });
      console.log('[Chat] Enviando una transacción al backend.');
      const response: SaveResponse = source === 'TEXT'
        ? await api<Api10SavedTransactionResponse>('/transactions', {
          method: 'POST',
          headers: { 'Idempotency-Key': idempotencyKey },
          body: JSON.stringify({
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
          ? await confirmVoicePreview(preview.preview.preview_id, transactionDraft, idempotencyKey)
          : await confirmReceiptPreview(preview.preview.preview_id, transactionDraft, preview.preview.ocr_text);
      const savedTransaction = toChatTransaction(response.transaction);
      void queryClient.invalidateQueries({ queryKey: ['budgets'] });
      void queryClient.invalidateQueries({ queryKey: ['notifications'] });
      void queryClient.invalidateQueries({ queryKey: ['transactions'] });
      void queryClient.invalidateQueries({ queryKey: ['wallets'] });
      void queryClient.invalidateQueries({ queryKey: ['dashboard'] });
      previewIdempotencyKeys.current.delete(messageId);
      setMessages((current) => {
        const next = current.map((message) => message.kind === 'preview' && message.id === messageId
          ? {
            id: message.id,
            kind: 'confirmation' as const,
            transaction: savedTransaction,
            walletName: 'wallet_name' in response ? response.wallet_name ?? 'Monedero' : 'wallet' in response.transaction ? response.transaction.wallet.name : 'Monedero',
            idempotencyKey: crypto.randomUUID(),
            status: 'confirmed' as const,
          }
          : message);
        const legacyAlerts: LegacyBudgetAlert[] = 'alerts' in response ? response.alerts ?? [] : [];
        const budgetAlert = 'budget_alert' in response ? response.budget_alert : undefined;
        const alert = highestPriorityAlert([...legacyAlerts, ...(budgetAlert ? [budgetAlert] : [])]);
        if (alert) {
          const index = next.findIndex((message) => message.id === messageId);
          next.splice(index + 1, 0, {
            id: crypto.randomUUID(),
            kind: 'alert',
            alert,
          });
        }
        return next;
      });
    } catch (error) {
      const messageText = error instanceof Error ? error.message : 'No se pudo guardar la transacción. Inténtalo nuevamente.';
      setMessages((current) => current.map((message) => message.kind === 'preview' && message.id === messageId
        ? { ...message, isSaving: false, saveError: messageText }
        : message));
    } finally {
      savingPreviewIds.current.delete(messageId);
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
        {textValidationError && <p role="alert" className="mb-2 text-sm text-danger-600">{textValidationError}</p>}
        <ChatInput
          value={draft}
          onChange={(value) => { setDraft(value); if (value.length > 0 && value.length <= 500) setTextValidationError(undefined); }}
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
