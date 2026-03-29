import { useEffect, type FC } from 'react';
import { KeyboardIcon } from 'lucide-react';

interface Props {
  open: boolean;
  onClose: () => void;
}

const GROUPS: Array<{ label: string; shortcuts: Array<{ keys: string[]; description: string }> }> = [
  {
    label: 'General',
    shortcuts: [
      { keys: ['⌘', 'K'], description: 'Open command bar' },
      { keys: ['⌘', '?'], description: 'Keyboard shortcuts' },
      { keys: ['⌘', ','], description: 'Open settings' },
      { keys: ['⌘', 'N'], description: 'New conversation' },
      { keys: ['⌘', 'F'], description: 'Find in conversation' },
    ],
  },
  {
    label: 'Navigation',
    shortcuts: [
      { keys: ['⌘', '1'], description: 'Dashboard' },
      { keys: ['⌘', '2'], description: 'Knowledge' },
      { keys: ['⌘', '3'], description: 'GitHub' },
      { keys: ['⌘', '4'], description: 'Extensions' },
      { keys: ['⌘', '5'], description: 'Notifications' },
    ],
  },
  {
    label: 'Chat',
    shortcuts: [
      { keys: ['Enter'], description: 'Send message' },
      { keys: ['Shift', 'Enter'], description: 'New line' },
      { keys: ['⌘', '↑'], description: 'Edit last message' },
      { keys: ['Escape'], description: 'Cancel / close overlay' },
    ],
  },
  {
    label: 'Overlays',
    shortcuts: [
      { keys: ['Escape'], description: 'Close any overlay' },
      { keys: ['⌘', 'K'], description: 'Toggle command bar' },
    ],
  },
];

const Kbd: FC<{ children: string }> = ({ children }) => (
  <kbd className="inline-flex h-5 min-w-[20px] items-center justify-center rounded border border-border/60 bg-muted/40 px-1.5 text-[10px] font-medium text-muted-foreground shadow-[0_1px_0_1px_rgba(0,0,0,0.05)]">
    {children}
  </kbd>
);

export const KeyboardShortcutsOverlay: FC<Props> = ({ open, onClose }) => {
  useEffect(() => {
    if (!open) return;
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') { e.preventDefault(); onClose(); }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [open, onClose]);

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center" onClick={onClose}>
      <div className="absolute inset-0 bg-black/50 backdrop-blur-sm" />
      <div
        className="relative w-full max-w-lg rounded-xl border border-border/50 bg-popover/95 shadow-2xl backdrop-blur-xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center gap-2.5 border-b border-border/30 px-5 py-4">
          <KeyboardIcon className="h-4 w-4 text-primary" />
          <h2 className="text-sm font-semibold">Keyboard Shortcuts</h2>
          <span className="ml-auto text-[10px] text-muted-foreground">Press ESC to close</span>
        </div>

        <div className="max-h-[60vh] overflow-y-auto p-5 space-y-5">
          {GROUPS.map((group) => (
            <div key={group.label}>
              <h3 className="mb-2 text-[10px] font-semibold uppercase tracking-[0.12em] text-muted-foreground/70">{group.label}</h3>
              <div className="space-y-1.5">
                {group.shortcuts.map((s) => (
                  <div key={s.description} className="flex items-center justify-between rounded-lg px-2 py-1.5 hover:bg-muted/20 transition-colors">
                    <span className="text-xs">{s.description}</span>
                    <div className="flex items-center gap-1">
                      {s.keys.map((k, i) => (
                        <span key={i} className="flex items-center gap-0.5">
                          {i > 0 && <span className="text-[9px] text-muted-foreground/40 mx-0.5">+</span>}
                          <Kbd>{k}</Kbd>
                        </span>
                      ))}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>

        <div className="border-t border-border/30 px-5 py-3 text-[10px] text-muted-foreground/50">
          Tip: Use <Kbd>⌘</Kbd><span className="mx-0.5">+</span><Kbd>K</Kbd> to quickly run any command
        </div>
      </div>
    </div>
  );
};
