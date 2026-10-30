import { useEffect, useRef, useState } from 'react';
import { RotateCcw } from 'lucide-react';
import { api } from '../../lib/api';
import { ChatBubble } from './components/ChatBubble';
import type { BotMood } from './components/ChatBubble';
import { AlertCard, type BudgetAlert } from './components/AlertCard';
import { ChatInput } from './components/ChatInput';
import { ConfirmationCard, type Transaction } from './components/ConfirmationCard';

type ChatMessage =
  | { id: string; kind: 'bubble'; author: 'bot' | 'user'; text: string; botMood?: BotMood }
  | { id: string; kind: 'confirmation'; transaction: Transaction; walletName: string }
  | { id: string; kind: 'alert'; alert: BudgetAlert };
type TextResponse = { transaction: Transaction; wallet_name?: string; message: string; botMood?: BotMood; alerts?: BudgetAlert[] };
type TextApiError = Error & { status?: number; code?: string };

const walletId = '4d6b3036-4290-4bde-aea4-375c779ef48b';

export function ChatPage() {
  const [messages, setMessages] = useState<ChatMessage[]>([
    { id: 'greeting', kind: 'bubble', author: 'bot', text: '¡Hola! Soy KhipuBot. ¿Qué gastos o ingresos tuviste hoy? Puedes escribirme, enviarme un audio o la foto de un comprobante.' },
  ]);
  const [draft, setDraft] = useState('');
  const [sending, setSending] = useState(false);
  const [retryText, setRetryText] = useState<string>();
  const logRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    if (!sending) {
      requestAnimationFrame(() => inputRef.current?.focus());
    }
  }, [sending]);

  async function sendText(text: string) {
    const value = text.trim();
    if (!value || sending) return;

    setMessages((current) => [...current.slice(-48), { id: crypto.randomUUID(), kind: 'bubble', author: 'user', text: value }]);
    setSending(true);
    setRetryText(value);
    try {
      const response = await api<TextResponse>('/transactions/text', {
        method: 'POST',
        headers: { 'Idempotency-Key': crypto.randomUUID() },
        body: JSON.stringify({ text: value, wallet_id: walletId, client_timezone: 'America/Lima' }),
      });
      setMessages((current) => [...current.slice(-48),
        { id: response.transaction.id, kind: 'confirmation', transaction: response.transaction, walletName: response.wallet_name ?? 'Monedero' },
        ...(response.alerts ?? []).map((alert) => ({ id: crypto.randomUUID(), kind: 'alert' as const, alert })),
      ]);
      setDraft('');
      setRetryText(undefined);
    } catch (error) {
      const apiError = error as TextApiError;
      const message = apiError.code === 'AMOUNT_NOT_FOUND'
        ? 'No pude identificar el monto. ¿Cuánto fue el gasto/ingreso?'
        : 'El servicio no está disponible. Por favor intente nuevamente.';
      setMessages((current) => [...current.slice(-49), {
        id: crypto.randomUUID(),
        kind: 'bubble',
        author: 'bot',
        text: message,
        botMood: apiError.code === 'AMOUNT_NOT_FOUND' ? 'surprised' : 'sad',
      }]);
    } finally {
      setSending(false);
      requestAnimationFrame(() => {
        if (logRef.current) logRef.current.scrollTop = logRef.current.scrollHeight;
      });
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
      </header>

      <div ref={logRef} role="log" aria-live="polite" aria-label="Conversación con KhipuBot" className="min-h-0 flex-1 space-y-4 overflow-y-auto bg-white p-4">
        {messages.map((message) => message.kind === 'bubble'
          ? <ChatBubble key={message.id} author={message.author} botMood={message.botMood}>{message.text}</ChatBubble>
          : message.kind === 'confirmation'
            ? <ConfirmationCard key={message.id} transaction={message.transaction} walletName={message.walletName} />
            : <AlertCard key={message.id} alert={message.alert} />)}
        {sending && <div className="flex items-center gap-2 text-sm text-ink-500" role="status"><img src="/logo.png" alt="" className="h-8 w-8 rounded-full" />KhipuBot está escribiendo…</div>}
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
        <ChatInput value={draft} onChange={setDraft} onSend={sendText} disabled={sending} textareaRef={inputRef} />
      </div>
    </section>
  );
}
