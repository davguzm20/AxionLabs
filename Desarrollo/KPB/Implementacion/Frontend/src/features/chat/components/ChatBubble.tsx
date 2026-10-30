import type { ReactNode } from 'react';

export type BotMood = 'happy' | 'surprised' | 'sad';

type ChatBubbleProps = {
  author: 'bot' | 'user';
  children: ReactNode;
  botMood?: BotMood;
  time?: string;
};

const botImages: Record<BotMood, { src: string; alt: string }> = {
  happy: { src: '/bot-feliz.png', alt: 'Bot feliz' },
  surprised: { src: '/bot-sorprendido.png', alt: 'Bot sorprendido' },
  sad: { src: '/bot-triste.png', alt: 'Bot triste' },
};

export function ChatBubble({ author, children, botMood = 'happy', time = 'Ahora' }: ChatBubbleProps) {
  const isBot = author === 'bot';
  return (
    <div className={`flex items-start gap-3 ${isBot ? 'justify-start' : 'justify-end'}`}>
      {isBot && <img src={botImages[botMood].src} alt={botImages[botMood].alt} className="mt-1 h-14 w-14 shrink-0 rounded-full object-cover" />}
      <div className={`max-w-[85%] rounded-2xl px-4 py-3 shadow-sm ${isBot ? 'rounded-bl-sm border border-ink-300 bg-white text-ink-900' : 'rounded-br-sm bg-accent-500 text-white'}`}>
        <div className="whitespace-pre-wrap break-words text-sm leading-6">{children}</div>
        <p className={`mt-1 text-right text-xs ${isBot ? 'text-ink-500' : 'text-white/80'}`}>{time}</p>
      </div>
    </div>
  );
}
