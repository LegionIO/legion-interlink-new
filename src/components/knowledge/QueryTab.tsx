import { useState, useCallback, type FC, type KeyboardEvent } from 'react';
import { SearchIcon, ListIcon, LoaderIcon } from 'lucide-react';
import { SparklesIcon } from 'lucide-react';
import { legion } from '@/lib/ipc-client';
import { QueryResultCard, type KnowledgeResult } from './QueryResultCard';
import { SynthesizedAnswer } from './SynthesizedAnswer';

type Scope = 'all' | 'global' | 'local';

interface QueryResponse {
  results?: KnowledgeResult[];
  answer?: string;
  sources?: Array<{ id: string; content: string; confidence: number }>;
}

const SCOPES: { value: Scope; label: string }[] = [
  { value: 'all', label: 'All' },
  { value: 'global', label: 'Global' },
  { value: 'local', label: 'Local' },
];

export const QueryTab: FC = () => {
  const [query, setQuery] = useState('');
  const [scope, setScope] = useState<Scope>('all');
  const [synthesize, setSynthesize] = useState(true);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [response, setResponse] = useState<QueryResponse | null>(null);
  const [hasSearched, setHasSearched] = useState(false);

  const runSearch = useCallback(async () => {
    const q = query.trim();
    if (!q) return;

    setLoading(true);
    setError('');
    setResponse(null);
    setHasSearched(true);

    try {
      const result = await legion.knowledge.query(q, scope, synthesize);

      if (result.ok) {
        setResponse((result.data as QueryResponse) ?? {});
      } else {
        setError(result.error || 'Query failed');
      }
    } catch (err) {
      setError(String(err));
    } finally {
      setLoading(false);
    }
  }, [query, scope, synthesize]);

  const handleKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter') {
      void runSearch();
    }
  };

  const results = response?.results ?? [];

  return (
    <div className="space-y-4">
      {/* Search bar */}
      <div className="flex gap-2">
        <div className="relative flex-1">
          <SearchIcon className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground pointer-events-none" />
          <input
            type="text"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="Search knowledge base…"
            className="w-full rounded-xl border border-border/50 bg-card/50 py-2 pl-9 pr-3 text-sm outline-none placeholder:text-muted-foreground focus:ring-1 focus:ring-ring"
          />
        </div>

        {/* Scope dropdown */}
        <select
          value={scope}
          onChange={(e) => setScope(e.target.value as Scope)}
          className="rounded-xl border border-border/50 bg-card/50 px-3 py-2 text-sm text-foreground outline-none focus:ring-1 focus:ring-ring"
        >
          {SCOPES.map((s) => (
            <option key={s.value} value={s.value}>
              {s.label}
            </option>
          ))}
        </select>

        {/* Search button */}
        <button
          type="button"
          onClick={() => void runSearch()}
          disabled={loading || !query.trim()}
          className="flex items-center gap-1.5 rounded-xl bg-primary px-4 py-2 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90 disabled:opacity-50"
        >
          {loading ? (
            <LoaderIcon className="h-4 w-4 animate-spin" />
          ) : (
            <SearchIcon className="h-4 w-4" />
          )}
          {loading ? 'Searching…' : 'Search'}
        </button>
      </div>

      {/* Mode toggle */}
      <div className="flex items-center gap-1 rounded-lg border border-border/50 bg-card/30 p-1 w-fit">
        <button
          type="button"
          onClick={() => setSynthesize(true)}
          className={`flex items-center gap-1.5 rounded-md px-3 py-1.5 text-xs font-medium transition-colors ${
            synthesize
              ? 'bg-primary text-primary-foreground'
              : 'text-muted-foreground hover:text-foreground'
          }`}
        >
          <SparklesIcon className="h-3.5 w-3.5" />
          Synthesized
        </button>
        <button
          type="button"
          onClick={() => setSynthesize(false)}
          className={`flex items-center gap-1.5 rounded-md px-3 py-1.5 text-xs font-medium transition-colors ${
            !synthesize
              ? 'bg-primary text-primary-foreground'
              : 'text-muted-foreground hover:text-foreground'
          }`}
        >
          <ListIcon className="h-3.5 w-3.5" />
          Raw Results
        </button>
      </div>

      {/* Error */}
      {error && (
        <div className="rounded-lg border border-destructive/30 bg-destructive/5 p-3">
          <p className="text-xs text-destructive">{error}</p>
        </div>
      )}

      {/* Results */}
      {!loading && response !== null && (
        <div className="space-y-3">
          {/* Synthesized answer (synthesized mode only) */}
          {synthesize && response.answer && (
            <SynthesizedAnswer answer={response.answer} sources={response.sources} />
          )}

          {/* Results count */}
          {results.length > 0 && (
            <p className="text-xs text-muted-foreground">
              {results.length} {results.length === 1 ? 'result' : 'results'}
            </p>
          )}

          {/* Result cards */}
          {results.length > 0 ? (
            <div className="space-y-2">
              {results.map((r) => (
                <QueryResultCard key={r.id} result={r} />
              ))}
            </div>
          ) : (
            hasSearched &&
            !error && (
              <div className="rounded-lg border border-border/50 bg-card/30 py-10 text-center">
                <p className="text-sm text-muted-foreground">No results found.</p>
                <p className="mt-1 text-xs text-muted-foreground/60">
                  Try a different query or scope.
                </p>
              </div>
            )
          )}
        </div>
      )}
    </div>
  );
};
