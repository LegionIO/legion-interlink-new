import { useState, useEffect, useCallback, type FC } from 'react';
import { Loader2Icon, GitPullRequestIcon, CheckCircle2Icon, XCircleIcon, CircleDotIcon, MessageSquareIcon, RefreshCwIcon } from 'lucide-react';
import { legion } from '@/lib/ipc-client';

interface PullRequest {
  number: number;
  title: string;
  state: string;
  user?: string;
  repo?: string;
  created_at?: string;
  updated_at?: string;
  draft?: boolean;
  mergeable?: boolean;
  review_status?: string;
  checks_status?: string;
  comments?: number;
  additions?: number;
  deletions?: number;
  labels?: string[];
  head_branch?: string;
  base_branch?: string;
  html_url?: string;
}

interface Props {
  repoFilter: string;
}

export const PullRequestsTab: FC<Props> = ({ repoFilter }) => {
  const [prs, setPrs] = useState<PullRequest[]>([]);
  const [loading, setLoading] = useState(true);
  const [expanded, setExpanded] = useState<number | null>(null);

  const fetchPRs = useCallback(async () => {
    setLoading(true);
    const filters: Record<string, string> = { state: 'open', limit: '50' };
    if (repoFilter) filters.repo = repoFilter;
    const res = await legion.daemon.githubPulls(filters);
    if (res.ok && res.data) {
      const data = Array.isArray(res.data) ? res.data : (res.data as { pulls?: PullRequest[] }).pulls || [];
      setPrs(data as PullRequest[]);
    }
    setLoading(false);
  }, [repoFilter]);

  useEffect(() => { fetchPRs(); }, [fetchPRs]);

  if (loading) return <div className="flex justify-center py-8"><Loader2Icon className="h-5 w-5 animate-spin text-muted-foreground" /></div>;

  if (prs.length === 0) {
    return (
      <div className="flex flex-col items-center gap-3 py-12 text-center">
        <GitPullRequestIcon className="h-8 w-8 text-muted-foreground/40" />
        <p className="text-sm text-muted-foreground">No open pull requests</p>
        <button type="button" onClick={fetchPRs} className="text-xs text-primary hover:underline">Refresh</button>
      </div>
    );
  }

  return (
    <div className="space-y-2 p-4">
      <div className="mb-3 flex items-center justify-between">
        <span className="text-xs text-muted-foreground">{prs.length} open PRs</span>
        <button type="button" onClick={fetchPRs} className="rounded-md p-1 text-muted-foreground hover:bg-muted/50"><RefreshCwIcon className="h-3.5 w-3.5" /></button>
      </div>
      {prs.map((pr) => (
        <div key={pr.number} className="rounded-lg border border-border/50 bg-card/30 transition-colors hover:bg-card/50">
          <button
            type="button"
            className="flex w-full items-start gap-3 px-4 py-3 text-left"
            onClick={() => setExpanded(expanded === pr.number ? null : pr.number)}
          >
            <PrStateIcon state={pr.state} draft={pr.draft} />
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-2">
                <span className="text-sm font-medium">{pr.title}</span>
                <span className="shrink-0 text-xs text-muted-foreground">#{pr.number}</span>
              </div>
              <div className="mt-1 flex flex-wrap items-center gap-2 text-[10px] text-muted-foreground">
                {pr.repo && <span className="rounded bg-muted/50 px-1.5 py-0.5 font-mono">{pr.repo}</span>}
                {pr.user && <span>{pr.user}</span>}
                {pr.head_branch && pr.base_branch && (
                  <span className="font-mono">{pr.head_branch} → {pr.base_branch}</span>
                )}
                {pr.created_at && <span>{new Date(pr.created_at).toLocaleDateString()}</span>}
              </div>
              <div className="mt-1.5 flex items-center gap-2">
                {pr.review_status && <ReviewBadge status={pr.review_status} />}
                {pr.checks_status && <ChecksBadge status={pr.checks_status} />}
                {pr.labels?.map((l) => (
                  <span key={l} className="rounded-full bg-primary/10 px-2 py-0.5 text-[9px] text-primary">{l}</span>
                ))}
                {pr.comments != null && pr.comments > 0 && (
                  <span className="flex items-center gap-0.5 text-[10px] text-muted-foreground">
                    <MessageSquareIcon className="h-3 w-3" />{pr.comments}
                  </span>
                )}
              </div>
            </div>
          </button>
          {expanded === pr.number && (
            <div className="border-t border-border/30 px-4 py-3 text-xs text-muted-foreground">
              <div className="flex gap-4">
                {pr.additions != null && <span className="text-emerald-400">+{pr.additions}</span>}
                {pr.deletions != null && <span className="text-red-400">-{pr.deletions}</span>}
                {pr.mergeable != null && (
                  <span>{pr.mergeable ? 'Mergeable' : 'Conflicts'}</span>
                )}
              </div>
              {pr.html_url && (
                <p className="mt-2 font-mono text-[10px] break-all select-all">{pr.html_url}</p>
              )}
            </div>
          )}
        </div>
      ))}
    </div>
  );
};

const PrStateIcon: FC<{ state: string; draft?: boolean }> = ({ state, draft }) => {
  if (draft) return <GitPullRequestIcon className="mt-0.5 h-4 w-4 shrink-0 text-gray-400" />;
  if (state === 'merged') return <GitPullRequestIcon className="mt-0.5 h-4 w-4 shrink-0 text-purple-400" />;
  if (state === 'closed') return <GitPullRequestIcon className="mt-0.5 h-4 w-4 shrink-0 text-red-400" />;
  return <GitPullRequestIcon className="mt-0.5 h-4 w-4 shrink-0 text-emerald-400" />;
};

const ReviewBadge: FC<{ status: string }> = ({ status }) => {
  const config: Record<string, { color: string; icon: typeof CheckCircle2Icon }> = {
    approved: { color: 'bg-emerald-500/10 text-emerald-400', icon: CheckCircle2Icon },
    changes_requested: { color: 'bg-red-500/10 text-red-400', icon: XCircleIcon },
    review_required: { color: 'bg-amber-500/10 text-amber-400', icon: CircleDotIcon },
  };
  const c = config[status] || config.review_required;
  const Icon = c.icon;
  return (
    <span className={`flex items-center gap-1 rounded-full px-1.5 py-0.5 text-[9px] font-medium ${c.color}`}>
      <Icon className="h-2.5 w-2.5" />{status.replace(/_/g, ' ')}
    </span>
  );
};

const ChecksBadge: FC<{ status: string }> = ({ status }) => {
  const colors: Record<string, string> = {
    success: 'bg-emerald-500/10 text-emerald-400',
    failure: 'bg-red-500/10 text-red-400',
    pending: 'bg-amber-500/10 text-amber-400',
  };
  return (
    <span className={`rounded-full px-1.5 py-0.5 text-[9px] font-medium ${colors[status] || 'bg-muted/50 text-muted-foreground'}`}>
      checks: {status}
    </span>
  );
};
