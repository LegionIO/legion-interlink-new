import { useState, useEffect, useRef, useCallback, type FC } from 'react';
import { CommandIcon, Loader2Icon, ZapIcon, AlertCircleIcon, CheckCircle2Icon, ArrowRightIcon } from 'lucide-react';
import { legion } from '@/lib/ipc-client';

interface Capability {
  name: string;
  description?: string;
  category?: string;
  confidence?: number;
}

interface CommandResult {
  status: string;
  message?: string;
  task_id?: string;
  output?: unknown;
  matched_capability?: string;
}

interface Props {
  open: boolean;
  onClose: () => void;
}

export const CommandBar: FC<Props> = ({ open, onClose }) => {
  const [input, setInput] = useState('');
  const [running, setRunning] = useState(false);
  const [result, setResult] = useState<CommandResult | null>(null);
  const [capabilities, setCapabilities] = useState<Capability[]>([]);
  const [filtered, setFiltered] = useState<Capability[]>([]);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (open) {
      setInput('');
      setResult(null);
      setRunning(false);
      inputRef.current?.focus();
      legion.daemon.capabilities().then((res) => {
        if (res.ok && res.data) {
          const data = Array.isArray(res.data) ? res.data : (res.data as { capabilities?: Capability[] }).capabilities || [];
          setCapabilities(data as Capability[]);
        }
      });
    }
  }, [open]);

  useEffect(() => {
    if (!input.trim()) {
      setFiltered(capabilities.slice(0, 8));
      return;
    }
    const q = input.toLowerCase();
    const matches = capabilities
      .filter((c) => c.name.toLowerCase().includes(q) || c.description?.toLowerCase().includes(q))
      .slice(0, 8);
    setFiltered(matches);
  }, [input, capabilities]);

  // Global Cmd+K handler
  useEffect(() => {
    if (!open) return;
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') { onClose(); e.preventDefault(); }
    };
    window.addEventListener('keydown', handleKey);
    return () => window.removeEventListener('keydown', handleKey);
  }, [open, onClose]);

  const handleSubmit = useCallback(async () => {
    if (!input.trim() || running) return;
    setRunning(true);
    setResult(null);
    const res = await legion.daemon.doCommand(input.trim());
    if (res.ok && res.data) {
      setResult(res.data as CommandResult);
    } else {
      setResult({ status: 'error', message: res.error || 'Command failed' });
    }
    setRunning(false);
  }, [input, running]);

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      handleSubmit();
    }
  };

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center pt-[20vh]" onClick={onClose}>
      <div className="absolute inset-0 bg-black/50 backdrop-blur-sm" />
      <div
        className="relative w-full max-w-lg rounded-xl border border-border/50 bg-popover/95 shadow-2xl backdrop-blur-xl"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Input */}
        <div className="flex items-center gap-3 border-b border-border/30 px-4 py-3">
          <CommandIcon className="h-4 w-4 shrink-0 text-primary" />
          <input
            ref={inputRef}
            type="text"
            value={input}
            onChange={(e) => { setInput(e.target.value); setResult(null); }}
            onKeyDown={handleKeyDown}
            placeholder="What would you like to do?"
            className="flex-1 bg-transparent text-sm outline-none placeholder:text-muted-foreground/50"
            autoFocus
          />
          {running ? (
            <Loader2Icon className="h-4 w-4 animate-spin text-primary" />
          ) : input.trim() ? (
            <button type="button" onClick={handleSubmit} className="rounded-md bg-primary p-1 text-primary-foreground">
              <ArrowRightIcon className="h-3.5 w-3.5" />
            </button>
          ) : null}
        </div>

        {/* Result */}
        {result && (
          <div className={`border-b border-border/30 px-4 py-3 text-xs ${result.status === 'error' ? 'bg-red-500/5' : 'bg-emerald-500/5'}`}>
            <div className="flex items-start gap-2">
              {result.status === 'error'
                ? <AlertCircleIcon className="mt-0.5 h-3.5 w-3.5 shrink-0 text-red-400" />
                : <CheckCircle2Icon className="mt-0.5 h-3.5 w-3.5 shrink-0 text-emerald-400" />
              }
              <div className="min-w-0 flex-1">
                {result.message && <p>{result.message}</p>}
                {result.matched_capability && (
                  <p className="mt-1 text-[10px] text-muted-foreground">Matched: {result.matched_capability}</p>
                )}
                {result.task_id && (
                  <p className="mt-1 font-mono text-[10px] text-muted-foreground">Task: {result.task_id}</p>
                )}
                {typeof result.output === 'string' && (
                  <p className="mt-1 whitespace-pre-wrap text-muted-foreground">{String(result.output)}</p>
                )}
              </div>
            </div>
          </div>
        )}

        {/* Capabilities suggestions */}
        {!result && filtered.length > 0 && (
          <div className="max-h-64 overflow-y-auto py-2">
            {filtered.map((cap) => (
              <button
                key={cap.name}
                type="button"
                onClick={() => { setInput(cap.description || cap.name); }}
                className="flex w-full items-center gap-3 px-4 py-2 text-left transition-colors hover:bg-muted/30"
              >
                <ZapIcon className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                <div className="min-w-0 flex-1">
                  <p className="text-xs font-medium">{cap.name}</p>
                  {cap.description && <p className="text-[10px] text-muted-foreground truncate">{cap.description}</p>}
                </div>
                {cap.category && <span className="shrink-0 rounded bg-muted/50 px-1.5 py-0.5 text-[9px] text-muted-foreground">{cap.category}</span>}
              </button>
            ))}
          </div>
        )}

        {/* Footer hint */}
        <div className="flex items-center justify-between px-4 py-2 text-[10px] text-muted-foreground/60">
          <span>Type a command in natural language</span>
          <span>ESC to close</span>
        </div>
      </div>
    </div>
  );
};
