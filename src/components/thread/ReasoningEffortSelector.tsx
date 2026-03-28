import { useEffect, useRef, useState, type FC } from 'react';
import { BrainCircuitIcon, CheckIcon, ChevronDownIcon } from 'lucide-react';

export type ReasoningEffort = 'low' | 'medium' | 'high' | 'xhigh';

const OPTIONS: Array<{ value: ReasoningEffort; label: string }> = [
  { value: 'low', label: 'Low' },
  { value: 'medium', label: 'Medium' },
  { value: 'high', label: 'High' },
  { value: 'xhigh', label: 'Extra High' },
];

export const ReasoningEffortSelector: FC<{
  value: ReasoningEffort;
  onChange: (value: ReasoningEffort) => void;
  dropdownDirection?: 'up' | 'down';
}> = ({ value, onChange, dropdownDirection = 'up' }) => {
  const [isOpen, setIsOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const current = OPTIONS.find((option) => option.value === value) ?? OPTIONS[1];

  useEffect(() => {
    if (!isOpen) return;

    const handlePointerDown = (event: PointerEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) {
        setIsOpen(false);
      }
    };

    window.addEventListener('pointerdown', handlePointerDown);
    return () => window.removeEventListener('pointerdown', handlePointerDown);
  }, [isOpen]);

  return (
    <div ref={rootRef} className="relative">
      <button
        type="button"
        onClick={() => setIsOpen((open) => !open)}
        className="flex items-center gap-1.5 rounded-xl border border-border/70 bg-card/70 px-3 py-1.5 text-xs transition-colors hover:bg-muted/50"
      >
        <BrainCircuitIcon className="h-3 w-3 text-muted-foreground" />
        <span className="font-medium">{current.label}</span>
        <ChevronDownIcon className="h-3 w-3 text-muted-foreground" />
      </button>

      {isOpen && (
        <>
          <div className={`absolute ${dropdownDirection === 'down' ? 'top-full mt-2' : 'bottom-full mb-2'} left-0 z-50 w-[220px] rounded-2xl border border-border/70 bg-popover/95 p-1.5 shadow-[0_16px_40px_rgba(5,4,15,0.28)] backdrop-blur-xl`}>
            <div className="px-3 py-2 text-sm font-medium text-muted-foreground">Select reasoning</div>
            <div className="max-h-[280px] overflow-y-auto">
              {OPTIONS.map((option) => (
                <button
                  key={option.value}
                  type="button"
                  onClick={() => {
                    onChange(option.value);
                    setIsOpen(false);
                  }}
                  className={`flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-sm transition-colors ${
                    option.value === value ? 'bg-primary/12 text-foreground' : 'hover:bg-muted'
                  }`}
                >
                  <BrainCircuitIcon className="h-4 w-4 shrink-0 text-foreground" />
                  <span className="flex-1 text-left">{option.label}</span>
                  {option.value === value && <CheckIcon className="h-4 w-4 shrink-0" />}
                </button>
              ))}
            </div>
          </div>
        </>
      )}
    </div>
  );
};
