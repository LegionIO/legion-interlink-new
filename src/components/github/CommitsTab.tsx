import { useState, useEffect, useCallback, type FC } from 'react';
import { Loader2Icon, GitCommitHorizontalIcon, RefreshCwIcon } from 'lucide-react';
import { legion } from '@/lib/ipc-client';

interface Commit {
  sha: string;
  message: string;
  author?: string;
  date?: string;
  repo?: string;
  branch?: string;
  html_url?: string;
  additions?: number;
  deletions?: number;
  files_changed?: number;
}

interface Props {
  repoFilter: string;
}

export const CommitsTab: FC<Props> = ({ repoFilter }) => {
  const [commits, setCommits] = useState<Commit[]>([]);
  const [loading, setLoading] = useState(true);
  const [expanded, setExpanded] = useState<string | null>(null);

  const fetchCommits = useCallback(async () => {
    setLoading(true);
    const filters: Record<string, string> = { limit: '50' };
    if (repoFilter) filters.repo = repoFilter;
    const res = await legion.daemon.githubCommits(filters);
    if (res.ok && res.data) {
      const data = Array.isArray(res.data) ? res.data : (res.data as { commits?: Commit[] }).commits || [];
      setCommits(data as Commit[]);
    }
    setLoading(false);
  }, [repoFilter]);

  useEffect(() => { fetchCommits(); }, [fetchCommits]);

  if (loading) return <div className="flex justify-center py-8"><Loader2Icon className="h-5 w-5 animate-spin text-muted-foreground" /></div>;

  if (commits.length === 0) {
    return (
      <div className="flex flex-col items-center gap-3 py-12 text-center">
        <GitCommitHorizontalIcon className="h-8 w-8 text-muted-foreground/40" />
        <p className="text-sm text-muted-foreground">No recent commits</p>
        <button type="button" onClick={fetchCommits} className="text-xs text-primary hover:underline">Refresh</button>
      </div>
    );
  }

  return (
    <div className="p-4">
      <div className="mb-3 flex items-center justify-between">
        <span className="text-xs text-muted-foreground">{commits.length} commits</span>
        <button type="button" onClick={fetchCommits} className="rounded-md p-1 text-muted-foreground hover:bg-muted/50"><RefreshCwIcon className="h-3.5 w-3.5" /></button>
      </div>
      <div className="space-y-1">
        {commits.map((commit) => {
          const shortSha = commit.sha?.slice(0, 7) || '?';
          const firstLine = commit.message?.split('\n')[0] || '(no message)';

          return (
            <div key={commit.sha} className="rounded-lg border border-border/30 bg-card/20 transition-colors hover:bg-card/40">
              <button
                type="button"
                className="flex w-full items-start gap-3 px-4 py-2.5 text-left"
                onClick={() => setExpanded(expanded === commit.sha ? null : commit.sha)}
              >
                <GitCommitHorizontalIcon className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" />
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <span className="truncate text-sm">{firstLine}</span>
                    <span className="shrink-0 rounded bg-muted/50 px-1.5 py-0.5 font-mono text-[10px] text-muted-foreground">{shortSha}</span>
                  </div>
                  <div className="mt-0.5 flex items-center gap-2 text-[10px] text-muted-foreground">
                    {commit.repo && <span className="font-mono">{commit.repo}</span>}
                    {commit.author && <span>{commit.author}</span>}
                    {commit.date && <span>{new Date(commit.date).toLocaleDateString()}</span>}
                    {commit.branch && <span className="rounded bg-muted/30 px-1 py-0.5 font-mono">{commit.branch}</span>}
                  </div>
                </div>
              </button>
              {expanded === commit.sha && (
                <div className="border-t border-border/20 px-4 py-2.5 text-xs text-muted-foreground">
                  {commit.message?.includes('\n') && (
                    <p className="mb-2 whitespace-pre-wrap">{commit.message}</p>
                  )}
                  <div className="flex gap-4">
                    {commit.additions != null && <span className="text-emerald-400">+{commit.additions}</span>}
                    {commit.deletions != null && <span className="text-red-400">-{commit.deletions}</span>}
                    {commit.files_changed != null && <span>{commit.files_changed} files</span>}
                  </div>
                  {commit.html_url && (
                    <p className="mt-2 font-mono text-[10px] break-all select-all">{commit.html_url}</p>
                  )}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
};
