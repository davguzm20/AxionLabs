import { ArrowUp, Image, Mic } from 'lucide-react';
import { useRef, type RefObject } from 'react';

type ChatInputProps = {
  value: string;
  onChange: (value: string) => void;
  onSend: (text: string) => void;
  onVoice: () => void;
  onReceiptFile?: (file: File) => void;
  disabled?: boolean;
  textareaRef?: RefObject<HTMLTextAreaElement | null>;
};

export function ChatInput({ value, onChange, onSend, onVoice, onReceiptFile, disabled = false, textareaRef }: ChatInputProps) {
  const imageInputRef = useRef<HTMLInputElement>(null);

  function submitMessage() {
    if (!value.trim() || disabled) return;
    onSend(value);
    onChange('');
  }

  return (
    <form className="flex items-center gap-2" onSubmit={(event) => { event.preventDefault(); submitMessage(); }}>
      <input
        ref={imageInputRef}
        type="file"
        accept="image/jpeg,image/png"
        capture="environment"
        className="sr-only"
        aria-label="Seleccionar foto de un comprobante"
        onChange={(event) => {
          const file = event.target.files?.[0];
          if (file) onReceiptFile?.(file);
          event.currentTarget.value = '';
        }}
      />
      <button type="button" onClick={() => imageInputRef.current?.click()} disabled={disabled} aria-label="Adjuntar imagen" className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full border border-gray-300 bg-white p-2 text-gray-500 hover:bg-gray-100 disabled:opacity-50" title="Adjuntar imagen">
        <Image aria-hidden="true" size={20} />
      </button>
      <button type="button" onClick={onVoice} disabled={disabled} aria-label="Grabar nota de voz" className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full border border-gray-300 bg-white p-2 text-gray-500 hover:bg-gray-100 disabled:opacity-50" title="Grabar nota de voz">
        <Mic aria-hidden="true" size={20} />
      </button>
      <label className="sr-only" htmlFor="chat-message">¿Qué gastos o ingresos tuviste hoy?</label>
      <textarea
        ref={textareaRef}
        id="chat-message"
        aria-label="¿Qué gastos o ingresos tuviste hoy?"
        placeholder="¿Qué gastos o ingresos tuviste hoy?"
        rows={1}
        value={value}
        disabled={disabled}
        onChange={(event) => onChange(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === 'Enter' && !event.shiftKey) {
            event.preventDefault();
            submitMessage();
          }
        }}
        className="max-h-32 min-h-11 min-w-0 flex-1 resize-none rounded-2xl border border-gray-300 bg-gray-50 px-4 py-2.5 text-sm leading-5 placeholder:text-gray-500 focus-visible:outline-accent-500 disabled:opacity-60"
      />
      <button type="submit" aria-label="Enviar" disabled={!value.trim() || disabled} className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-brand-500 p-2 text-white hover:bg-brand-600 disabled:cursor-not-allowed disabled:opacity-50">
        <ArrowUp aria-hidden="true" size={20} />
      </button>
    </form>
  );
}
