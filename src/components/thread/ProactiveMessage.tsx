import type { FC } from 'react';
import { Brain } from 'lucide-react';

interface ProactiveMessageProps {
  intent: string;
  content: string;
  timestamp: string;
}

const INTENT_LABELS: Record<string, string> = {
  share_insight: 'Insight',
  check_in: 'Check-in',
  offer_help: 'Suggestion',
  express_concern: 'Heads up',
  celebrate: 'Nice!',
  reflect: 'Reflection',
  direct_engage: 'GAIA',
};

export const ProactiveMessage: FC<ProactiveMessageProps> = ({ intent, content, timestamp }) => {
  const label = INTENT_LABELS[intent] || 'GAIA';
  const time = new Date(timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });

  return (
    <div className="my-4 mx-auto max-w-3xl rounded-lg border-l-2 border-amber-500/50 bg-amber-500/5 px-4 py-3">
      <div className="flex items-center gap-2 mb-1">
        <Brain className="size-3.5 text-amber-500" />
        <span className="text-xs font-medium text-amber-600 dark:text-amber-400">{label}</span>
        <span className="text-xs text-muted-foreground/50 ml-auto">{time}</span>
      </div>
      <p className="text-sm text-foreground/80">{content}</p>
    </div>
  );
};
