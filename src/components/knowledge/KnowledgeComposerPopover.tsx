import { useState, useEffect, useRef, useCallback } from 'react';
import { BookOpenIcon, BrainCircuitIcon, PenLineIcon } from 'lucide-react';
import { legion } from '@/lib/ipc-client';
import { useConfig } from '@/providers/ConfigProvider';

type Scope = 'all' | 'global' | 'local';

interface ToggleProps {
  value: boolean;
  onChange: (v: boolean) => void;
}

function Toggle({ value, onChange }: ToggleProps) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={value}
      onClick={() => onChange(!value)}
      className={`relative h-5 w-9 rounded-full transition-colors ${value ? 'bg-primary' : 'bg-muted'}`}
    >
      <span
        className={`absolute top-0.5 h-4 w-4 rounded-full bg-white transition-transform ${value ? 'translate-x-4' : 'translate-x-0.5'}`}
      />
    </button>
  );
}

export function KnowledgeComposerPopover() {
  const { config, updateConfig } = useConfig();
  const [open, setOpen] = useState(false);
  const [daemonOk, setDaemonOk] = useState<boolean | null>(null);
  const [dataConnected, setDataConnected] = useState<boolean | null>(null);
  const popoverRef = useRef<HTMLDivElement>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);

  const ragEnabled = (config?.knowledge as { ragEnabled?: boolean } | undefined)?.ragEnabled ?? true;
  const captureEnabled = (config?.knowledge as { captureEnabled?: boolean } | undefined)?.captureEnabled ?? false;
  const scope: Scope = ((config?.knowledge as { scope?: string } | undefined)?.scope as Scope | undefined) ?? 'all';

  const anyEnabled = ragEnabled || captureEnabled;

  const fetchStatus = useCallback(async () => {
    try {
      const result = await legion.knowledge.status();
      if (result.ok && result.data) {
        const d = result.data as { available?: boolean; data_connected?: boolean };
        setDaemonOk(d.available === true);
        setDataConnected(d.data_connected ?? null);
      } else {
        setDaemonOk(false);
        setDataConnected(null);
      }
    } catch {
      setDaemonOk(false);
      setDataConnected(null);
    }
  }, []);

  useEffect(() => {
    if (open) {
      fetchStatus();
    }
  }, [open, fetchStatus]);

  // Close on click outside
  useEffect(() => {
    if (!open) return;

    function handleMouseDown(e: MouseEvent) {
      if (
        popoverRef.current &&
        !popoverRef.current.contains(e.target as Node) &&
        buttonRef.current &&
        !buttonRef.current.contains(e.target as Node)
      ) {
        setOpen(false);
      }
    }

    document.addEventListener('mousedown', handleMouseDown);
    return () => document.removeEventListener('mousedown', handleMouseDown);
  }, [open]);

  function handleToggleRag(v: boolean) {
    updateConfig('knowledge.ragEnabled', v);
  }

  function handleToggleCapture(v: boolean) {
    updateConfig('knowledge.captureEnabled', v);
  }

  function handleScopeChange(e: React.ChangeEvent<HTMLSelectElement>) {
    updateConfig('knowledge.scope', e.target.value);
  }

  return (
    <div className="relative">
      <button
        ref={buttonRef}
        type="button"
        onClick={() => setOpen((o) => !o)}
        title="Knowledge settings"
        className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-xl border transition-colors hover:bg-muted/50 ${
          anyEnabled
            ? 'border-primary/50 bg-primary/10 text-primary'
            : 'border-border/70 bg-card/70 text-muted-foreground'
        }`}
      >
        <BookOpenIcon className="h-4 w-4" />
      </button>

      {open && (
        <div
          ref={popoverRef}
          className="absolute bottom-full left-0 mb-2 w-[264px] rounded-xl border border-border/50 bg-popover/95 p-3 shadow-xl backdrop-blur-xl"
        >
          {/* Status line */}
          <div className="mb-3 flex items-center gap-2">
            {daemonOk === null ? (
              <span className="text-xs text-muted-foreground">Checking…</span>
            ) : daemonOk ? (
              <>
                <span className="h-2 w-2 shrink-0 rounded-full bg-emerald-400" />
                <span className="text-xs text-emerald-400">
                  Connected{dataConnected === false ? ' — data offline' : ''}
                </span>
              </>
            ) : (
              <>
                <span className="h-2 w-2 shrink-0 rounded-full bg-red-400" />
                <span className="text-xs text-red-400">Daemon unavailable</span>
              </>
            )}
          </div>

          {/* RAG Context toggle */}
          <div className="mb-2.5 flex items-center justify-between gap-3">
            <div className="flex items-center gap-2 text-sm text-foreground/90">
              <BrainCircuitIcon className="h-4 w-4 shrink-0 text-muted-foreground" />
              RAG Context
            </div>
            <Toggle value={ragEnabled} onChange={handleToggleRag} />
          </div>

          {/* Knowledge Capture toggle */}
          <div className="mb-3 flex items-center justify-between gap-3">
            <div className="flex items-center gap-2 text-sm text-foreground/90">
              <PenLineIcon className="h-4 w-4 shrink-0 text-muted-foreground" />
              Knowledge Capture
            </div>
            <Toggle value={captureEnabled} onChange={handleToggleCapture} />
          </div>

          {/* Scope selector */}
          <div className="flex items-center justify-between gap-3">
            <span className="text-sm text-foreground/90">Scope</span>
            <select
              value={scope}
              onChange={handleScopeChange}
              className="rounded-md border border-border/50 bg-card/70 px-2 py-1 text-xs text-foreground outline-none focus:border-primary/50"
            >
              <option value="all">All</option>
              <option value="global">Global</option>
              <option value="local">Local</option>
            </select>
          </div>
        </div>
      )}
    </div>
  );
}
