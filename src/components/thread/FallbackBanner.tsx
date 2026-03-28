import type { FC } from 'react';
import { AlertTriangleIcon, XIcon } from 'lucide-react';
import { useFallbackBanner } from '@/providers/RuntimeProvider';
import { useComputerUse } from '@/providers/ComputerUseProvider';

export const FallbackBanner: FC = () => {
  const { banner, dismiss } = useFallbackBanner();
  if (!banner) return null;

  return (
    <div className="mx-auto flex w-full max-w-5xl items-center gap-3 rounded-xl border border-amber-500/30 bg-amber-500/8 px-4 py-2.5 text-xs text-amber-200">
      <AlertTriangleIcon className="h-4 w-4 shrink-0 text-amber-400" />
      <span className="flex-1">
        Switched from <strong>{banner.fromModel}</strong> to <strong>{banner.toModel}</strong>
        {banner.reason === 'content-filter'
          ? <span className="text-amber-300/70"> because the prior response was content filtered</span>
          : banner.error
            ? <span className="text-amber-300/70"> because of {banner.error}</span>
            : null}
      </span>
      <button type="button" onClick={dismiss} className="p-0.5 rounded hover:bg-amber-500/20 transition-colors">
        <XIcon className="h-3.5 w-3.5" />
      </button>
    </div>
  );
};

export const ComputerUseFallbackBanner: FC = () => {
  const { fallbackBanner, dismissFallbackBanner } = useComputerUse();
  if (!fallbackBanner) return null;

  return (
    <div className="mx-auto flex w-full max-w-5xl items-center gap-3 rounded-xl border border-amber-500/30 bg-amber-500/8 px-4 py-2.5 text-xs text-amber-200">
      <AlertTriangleIcon className="h-4 w-4 shrink-0 text-amber-400" />
      <span className="flex-1">
        Switched from <strong>{fallbackBanner.fromModel}</strong> to <strong>{fallbackBanner.toModel}</strong>
        {fallbackBanner.error
          ? <span className="text-amber-300/70"> because of {fallbackBanner.error}</span>
          : null}
      </span>
      <button type="button" onClick={dismissFallbackBanner} className="p-0.5 rounded hover:bg-amber-500/20 transition-colors">
        <XIcon className="h-3.5 w-3.5" />
      </button>
    </div>
  );
};
