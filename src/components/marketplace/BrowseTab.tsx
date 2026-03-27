import { useState, useEffect, useCallback, type FC } from 'react';
import { Loader2Icon, PuzzleIcon, DownloadIcon, SearchIcon, RefreshCwIcon, TagIcon, StarIcon } from 'lucide-react';
import { legion } from '@/lib/ipc-client';

interface AvailableExtension {
  name: string;
  description?: string;
  version?: string;
  category?: string;
  author?: string;
  downloads?: number;
  rating?: number;
  tags?: string[];
  installed?: boolean;
  gem_name?: string;
}

interface Props {
  onInstalled: () => void;
}

const CATEGORIES = ['All', 'Cognitive', 'Integration', 'AI Provider', 'Utility', 'Monitoring', 'Security'];

export const BrowseTab: FC<Props> = ({ onInstalled }) => {
  const [extensions, setExtensions] = useState<AvailableExtension[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [category, setCategory] = useState('All');
  const [installing, setInstalling] = useState<Set<string>>(new Set());

  const fetchAvailable = useCallback(async () => {
    setLoading(true);
    const filters: Record<string, string> = {};
    if (search) filters.query = search;
    if (category !== 'All') filters.category = category.toLowerCase();
    const res = await legion.daemon.marketplace(filters);
    if (res.ok && res.data) {
      const data = Array.isArray(res.data) ? res.data : (res.data as { extensions?: AvailableExtension[] }).extensions || [];
      setExtensions(data as AvailableExtension[]);
    }
    setLoading(false);
  }, [search, category]);

  useEffect(() => { fetchAvailable(); }, [fetchAvailable]);

  const handleInstall = async (ext: AvailableExtension) => {
    const id = ext.gem_name || ext.name;
    setInstalling((prev) => new Set(prev).add(id));
    const res = await legion.daemon.extensionInstall(id);
    setInstalling((prev) => { const n = new Set(prev); n.delete(id); return n; });
    if (res.ok) {
      setExtensions((prev) => prev.map((e) => (e.name === ext.name ? { ...e, installed: true } : e)));
      onInstalled();
    }
  };

  return (
    <div className="p-4 space-y-4">
      {/* Search + Category */}
      <div className="flex gap-3">
        <div className="relative flex-1">
          <SearchIcon className="absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search extensions..."
            className="w-full rounded-lg border border-border/50 bg-card/50 py-2 pl-9 pr-3 text-xs outline-none placeholder:text-muted-foreground/60 focus:border-primary/50"
          />
        </div>
        <button type="button" onClick={fetchAvailable} className="rounded-md p-2 text-muted-foreground hover:bg-muted/50">
          <RefreshCwIcon className="h-3.5 w-3.5" />
        </button>
      </div>

      <div className="flex flex-wrap gap-1">
        {CATEGORIES.map((cat) => (
          <button
            key={cat}
            type="button"
            onClick={() => setCategory(cat)}
            className={`rounded-full px-3 py-1 text-xs font-medium transition-colors ${category === cat ? 'bg-primary/15 text-primary' : 'text-muted-foreground hover:text-foreground hover:bg-muted/50'}`}
          >
            {cat}
          </button>
        ))}
      </div>

      {/* Results */}
      {loading ? (
        <div className="flex justify-center py-8"><Loader2Icon className="h-5 w-5 animate-spin text-muted-foreground" /></div>
      ) : extensions.length === 0 ? (
        <div className="flex flex-col items-center gap-3 py-12 text-center">
          <PuzzleIcon className="h-8 w-8 text-muted-foreground/40" />
          <p className="text-sm text-muted-foreground">No extensions found</p>
        </div>
      ) : (
        <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
          {extensions.map((ext) => {
            const id = ext.gem_name || ext.name;
            const isInstalling = installing.has(id);

            return (
              <div key={ext.name} className="rounded-lg border border-border/50 bg-card/30 p-4 transition-colors hover:bg-card/50">
                <div className="flex items-start justify-between">
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      <PuzzleIcon className="h-4 w-4 shrink-0 text-primary" />
                      <span className="text-sm font-medium truncate">{ext.name}</span>
                    </div>
                    {ext.version && <span className="text-[10px] text-muted-foreground font-mono ml-6">v{ext.version}</span>}
                  </div>
                  {ext.installed ? (
                    <span className="shrink-0 rounded-full bg-emerald-500/10 px-2.5 py-1 text-[10px] font-medium text-emerald-400">Installed</span>
                  ) : (
                    <button
                      type="button"
                      onClick={() => handleInstall(ext)}
                      disabled={isInstalling}
                      className="flex shrink-0 items-center gap-1.5 rounded-lg bg-primary px-3 py-1.5 text-xs font-medium text-primary-foreground transition-colors hover:bg-primary/90 disabled:opacity-50"
                    >
                      {isInstalling ? <Loader2Icon className="h-3 w-3 animate-spin" /> : <DownloadIcon className="h-3 w-3" />}
                      Install
                    </button>
                  )}
                </div>
                {ext.description && <p className="mt-2 text-xs text-muted-foreground line-clamp-2">{ext.description}</p>}
                <div className="mt-3 flex flex-wrap items-center gap-2">
                  {ext.category && (
                    <span className="rounded-full bg-muted/50 px-2 py-0.5 text-[9px] text-muted-foreground">{ext.category}</span>
                  )}
                  {ext.author && <span className="text-[10px] text-muted-foreground">{ext.author}</span>}
                  {ext.rating != null && (
                    <span className="flex items-center gap-0.5 text-[10px] text-amber-400">
                      <StarIcon className="h-2.5 w-2.5 fill-current" />{ext.rating.toFixed(1)}
                    </span>
                  )}
                  {ext.downloads != null && (
                    <span className="text-[10px] text-muted-foreground">{ext.downloads.toLocaleString()} installs</span>
                  )}
                </div>
                {ext.tags?.length ? (
                  <div className="mt-2 flex flex-wrap gap-1">
                    {ext.tags.slice(0, 5).map((t) => (
                      <span key={t} className="flex items-center gap-0.5 rounded-full bg-primary/10 px-1.5 py-0.5 text-[9px] text-primary">
                        <TagIcon className="h-2 w-2" />{t}
                      </span>
                    ))}
                  </div>
                ) : null}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
};
