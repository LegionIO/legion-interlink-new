import { useEffect, useRef, useState, type FC } from 'react';
import { CheckIcon, ChevronDownIcon, UserCircleIcon } from 'lucide-react';
import { app } from '@/lib/ipc-client';

type ProfileInfo = {
  key: string;
  name: string;
  primaryModelKey: string;
  fallbackModelKeys: string[];
};

type ProfileCatalog = {
  profiles: ProfileInfo[];
  defaultKey: string | null;
};

export const ProfileSelector: FC<{
  selectedProfileKey: string | null;
  onSelectProfile: (key: string | null, primaryModelKey: string | null) => void;
  dropdownDirection?: 'up' | 'down';
}> = ({ selectedProfileKey, onSelectProfile, dropdownDirection = 'up' }) => {
  const [catalog, setCatalog] = useState<ProfileCatalog | null>(null);
  const [isOpen, setIsOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    app.profileCatalog()
      .then((data) => setCatalog(data as ProfileCatalog))
      .catch(() => {});
  }, []);

  useEffect(() => {
    if (!isOpen) return;
    const handlePointerDown = (event: PointerEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) setIsOpen(false);
    };
    window.addEventListener('pointerdown', handlePointerDown);
    return () => window.removeEventListener('pointerdown', handlePointerDown);
  }, [isOpen]);

  if (!catalog || catalog.profiles.length === 0) return null;

  const currentKey = selectedProfileKey ?? catalog.defaultKey;
  const currentProfile = catalog.profiles.find((p) => p.key === currentKey);
  const label = currentProfile?.name ?? 'Default';

  return (
    <div ref={rootRef} className="relative">
      <button
        type="button"
        onClick={() => setIsOpen(!isOpen)}
        className="flex items-center gap-1.5 rounded-xl border border-border/70 bg-card/70 px-3 py-1.5 text-xs transition-colors hover:bg-muted/50"
      >
        <UserCircleIcon className="h-3 w-3 text-muted-foreground" />
        <span className="font-medium max-w-[100px] truncate">{label}</span>
        <ChevronDownIcon className="h-3 w-3 text-muted-foreground" />
      </button>

      {isOpen && (
        <div className={`absolute ${dropdownDirection === 'down' ? 'top-full mt-2' : 'bottom-full mb-2'} right-0 z-50 w-[220px] rounded-2xl border border-border/70 bg-popover/95 p-1.5 shadow-[0_16px_40px_rgba(5,4,15,0.28)] backdrop-blur-xl`}>
          <div className="px-3 py-2 text-sm font-medium text-muted-foreground">Select profile</div>
          <div className="max-h-[300px] overflow-y-auto">
            {/* No profile option */}
            <button
              type="button"
              onClick={() => { onSelectProfile(null, null); setIsOpen(false); }}
              className={`flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-sm transition-colors ${
                !currentKey ? 'bg-primary/12 text-foreground' : 'hover:bg-muted'
              }`}
            >
              <span className="flex-1 text-left">Default (no profile)</span>
              {!currentKey && <CheckIcon className="h-4 w-4 shrink-0" />}
            </button>
            {catalog.profiles.map((profile) => (
              <button
                key={profile.key}
                type="button"
                onClick={() => { onSelectProfile(profile.key, profile.primaryModelKey); setIsOpen(false); }}
                className={`flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-sm transition-colors ${
                  profile.key === currentKey
                    ? 'bg-primary/12 text-foreground'
                    : 'hover:bg-muted'
                }`}
              >
                <UserCircleIcon className="h-4 w-4 shrink-0 text-foreground" />
                <span className="flex-1 text-left font-medium">{profile.name}</span>
                {profile.fallbackModelKeys.length > 0 && (
                  <span className="text-[10px] opacity-60">
                    {profile.fallbackModelKeys.length} fallback{profile.fallbackModelKeys.length > 1 ? 's' : ''}
                  </span>
                )}
                {profile.key === currentKey && <CheckIcon className="h-4 w-4 shrink-0" />}
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
};
