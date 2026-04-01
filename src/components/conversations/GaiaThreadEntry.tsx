import { useState, useEffect, type FC } from 'react';
import { Brain } from 'lucide-react';
import { app } from '@/lib/ipc-client';

const GAIA_THREAD_ID = '__gaia_proactive__';

interface GaiaThreadEntryProps {
  activeConversationId: string | null;
  onSelect: (id: string) => void;
}

export const GaiaThreadEntry: FC<GaiaThreadEntryProps> = ({ activeConversationId, onSelect }) => {
  const [unread, setUnread] = useState(false);
  const isActive = activeConversationId === GAIA_THREAD_ID;

  useEffect(() => {
    // Ensure GAIA thread exists
    void app.gaiaThread.ensure().catch(() => {});
  }, []);

  useEffect(() => {
    const unsub = app.gaiaThread.onNewMessage(() => {
      if (!isActive) setUnread(true);
    });
    return unsub;
  }, [isActive]);

  useEffect(() => {
    if (isActive) setUnread(false);
  }, [isActive]);

  return (
    <button
      className={`flex items-center gap-2 w-full px-3 py-2 text-sm rounded-md transition-colors ${
        isActive
          ? 'bg-accent text-accent-foreground'
          : 'text-muted-foreground hover:bg-accent/50 hover:text-foreground'
      }`}
      onClick={() => onSelect(GAIA_THREAD_ID)}
    >
      <Brain className="size-4 shrink-0 text-amber-500" />
      <span className="truncate font-medium">GAIA</span>
      {unread && (
        <span className="ml-auto size-2 rounded-full bg-amber-500 shrink-0" />
      )}
    </button>
  );
};

export { GAIA_THREAD_ID };
