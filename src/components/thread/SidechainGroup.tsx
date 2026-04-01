import { useState, type FC } from 'react';
import { ChevronRightIcon, BotIcon } from 'lucide-react';
import { MarkdownText } from './MarkdownText';

interface SidechainMessage {
  id: string;
  content: Array<{ type: string; text?: string }>;
  createdAt?: Date;
}

interface SidechainGroupProps {
  agentId: string;
  messages: SidechainMessage[];
  defaultCollapsed?: boolean;
}

export const SidechainGroup: FC<SidechainGroupProps> = ({ agentId, messages, defaultCollapsed = true }) => {
  const [collapsed, setCollapsed] = useState(defaultCollapsed);

  if (messages.length === 0) return null;

  const label = agentId.startsWith('lex-') ? agentId : `Agent: ${agentId}`;

  return (
    <div className="my-3 ml-4 rounded-lg border border-border/30 bg-muted/20">
      <button
        type="button"
        onClick={() => setCollapsed(!collapsed)}
        className="flex w-full items-center gap-2 px-3 py-2 text-xs text-muted-foreground hover:bg-muted/30 transition-colors rounded-t-lg"
      >
        <ChevronRightIcon className={`size-3.5 shrink-0 transition-transform ${collapsed ? '' : 'rotate-90'}`} />
        <BotIcon className="size-3.5 shrink-0 text-blue-400" />
        <span className="font-medium">[{label}]</span>
        <span className="text-muted-foreground/60">{messages.length} message{messages.length !== 1 ? 's' : ''}</span>
      </button>
      {!collapsed && (
        <div className="border-t border-border/20 px-4 py-2 space-y-2">
          {messages.map((msg) => {
            const textParts = msg.content.filter((p) => p.type === 'text' && p.text);
            if (textParts.length === 0) return null;
            return (
              <div key={msg.id} className="text-sm text-foreground/80">
                {textParts.map((part, i) => (
                  <MarkdownText key={`${msg.id}-${i}`} text={part.text ?? ''} />
                ))}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
};
