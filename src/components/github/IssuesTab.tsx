import { useState, useEffect, useCallback, type FC } from 'react';
import { Loader2Icon, CircleDotIcon, CheckCircle2Icon, RefreshCwIcon, TagIcon } from 'lucide-react';
import { legion } from '@/lib/ipc-client';

interface Issue {
  number: number;
  title: string;
  state: string;
  user?: string;
  repo?: string;
  created_at?: string;
  updated_at?: string;
  labels?: string[];
  assignees?: string[];
  comments?: number;
  body?: string;
  html_url?: string;
}

interface Props {
  repoFilter: string;
}

export const IssuesTab: FC<Props> = ({ repoFilter }) => {
  const [issues, setIssues] = useState<Issue[]>([]);
  const [loading, setLoading] = useState(true);
  const [stateFilter, setStateFilter] = useState<'open' | 'closed'>('open');
  const [expanded, setExpanded] = useState<number | null>(null);

  const fetchIssues = useCallback(async () => {
    setLoading(true);
    const filters: Record<string, string> = { state: stateFilter, limit: '50' };
    if (repoFilter) filters.repo = repoFilter;
    const res = await legion.daemon.githubIssues(filters);
    if (res.ok && res.data) {
      const data = Array.isArray(res.data) ? res.data : (res.data as { issues?: Issue[] }).issues || [];
      setIssues(data as Issue[]);
    }
    setLoading(false);
  }, [repoFilter, stateFilter]);

  useEffect(() => { fetchIssues(); }, [fetchIssues]);

  return (
    <div className="p-4">
      <div className="mb-3 flex items-center justify-between">
        <div className="flex items-center gap-1">
          {(['open', 'closed'] as const).map((s) => (
            <button
              key={s}
              type="button"
              onClick={() => setStateFilter(s)}
              className={`rounded-lg px-2.5 py-1 text-xs font-medium transition-colors ${stateFilter === s ? 'bg-primary/15 text-primary' : 'text-muted-foreground hover:text-foreground'}`}
            >
              {s === 'open' ? 'Open' : 'Closed'}
            </button>
          ))}
          <span className="ml-2 text-xs text-muted-foreground">{issues.length} issues</span>
        </div>
        <button type="button" onClick={fetchIssues} className="rounded-md p-1 text-muted-foreground hover:bg-muted/50"><RefreshCwIcon className="h-3.5 w-3.5" /></button>
      </div>

      {loading ? (
        <div className="flex justify-center py-8"><Loader2Icon className="h-5 w-5 animate-spin text-muted-foreground" /></div>
      ) : issues.length === 0 ? (
        <div className="flex flex-col items-center gap-3 py-12 text-center">
          <CircleDotIcon className="h-8 w-8 text-muted-foreground/40" />
          <p className="text-sm text-muted-foreground">No {stateFilter} issues</p>
        </div>
      ) : (
        <div className="space-y-2">
          {issues.map((issue) => (
            <div key={issue.number} className="rounded-lg border border-border/50 bg-card/30 transition-colors hover:bg-card/50">
              <button
                type="button"
                className="flex w-full items-start gap-3 px-4 py-3 text-left"
                onClick={() => setExpanded(expanded === issue.number ? null : issue.number)}
              >
                {issue.state === 'open'
                  ? <CircleDotIcon className="mt-0.5 h-4 w-4 shrink-0 text-emerald-400" />
                  : <CheckCircle2Icon className="mt-0.5 h-4 w-4 shrink-0 text-purple-400" />
                }
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <span className="text-sm font-medium">{issue.title}</span>
                    <span className="shrink-0 text-xs text-muted-foreground">#{issue.number}</span>
                  </div>
                  <div className="mt-1 flex flex-wrap items-center gap-2 text-[10px] text-muted-foreground">
                    {issue.repo && <span className="rounded bg-muted/50 px-1.5 py-0.5 font-mono">{issue.repo}</span>}
                    {issue.user && <span>{issue.user}</span>}
                    {issue.created_at && <span>{new Date(issue.created_at).toLocaleDateString()}</span>}
                    {issue.comments != null && issue.comments > 0 && <span>{issue.comments} comments</span>}
                  </div>
                  {issue.labels?.length ? (
                    <div className="mt-1.5 flex flex-wrap gap-1">
                      {issue.labels.map((l) => (
                        <span key={l} className="flex items-center gap-0.5 rounded-full bg-primary/10 px-2 py-0.5 text-[9px] text-primary">
                          <TagIcon className="h-2 w-2" />{l}
                        </span>
                      ))}
                    </div>
                  ) : null}
                  {issue.assignees?.length ? (
                    <div className="mt-1 flex gap-1">
                      {issue.assignees.map((a) => (
                        <span key={a} className="rounded-full bg-muted/50 px-2 py-0.5 text-[9px] text-muted-foreground">{a}</span>
                      ))}
                    </div>
                  ) : null}
                </div>
              </button>
              {expanded === issue.number && (
                <div className="border-t border-border/30 px-4 py-3 text-xs text-muted-foreground">
                  {issue.body ? (
                    <p className="max-h-40 overflow-y-auto whitespace-pre-wrap">{issue.body}</p>
                  ) : (
                    <p className="italic">No description</p>
                  )}
                  {issue.html_url && (
                    <p className="mt-2 font-mono text-[10px] break-all select-all">{issue.html_url}</p>
                  )}
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
};
