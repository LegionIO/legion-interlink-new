import { useState, useEffect, useCallback } from 'react';
import { GitBranchIcon, GitPullRequestIcon, CircleDotIcon, GitCommitHorizontalIcon, XIcon, RefreshCwIcon, AlertCircleIcon, Loader2Icon } from 'lucide-react';
import { legion } from '@/lib/ipc-client';
import { PullRequestsTab } from './PullRequestsTab';
import { IssuesTab } from './IssuesTab';
import { CommitsTab } from './CommitsTab';

type GitHubTab = 'pulls' | 'issues' | 'commits';

const tabs: { key: GitHubTab; label: string; icon: typeof GitPullRequestIcon }[] = [
  { key: 'pulls', label: 'Pull Requests', icon: GitPullRequestIcon },
  { key: 'issues', label: 'Issues', icon: CircleDotIcon },
  { key: 'commits', label: 'Commits', icon: GitCommitHorizontalIcon },
];

interface Props {
  onClose: () => void;
}

export function GitHubPanel({ onClose }: Props) {
  const [activeTab, setActiveTab] = useState<GitHubTab>('pulls');
  const [daemonOk, setDaemonOk] = useState<boolean | null>(null);
  const [statusText, setStatusText] = useState('');
  const [repos, setRepos] = useState<string[]>([]);
  const [repoFilter, setRepoFilter] = useState('');

  const checkDaemon = useCallback(async () => {
    const result = await legion.daemon.githubStatus();
    setDaemonOk(result.ok);
    if (result.ok && result.data) {
      const d = result.data as { user?: string; org?: string; repos?: number };
      const parts: string[] = [];
      if (d.user || d.org) parts.push(d.org || d.user || '');
      if (d.repos != null) parts.push(`${d.repos} repos`);
      setStatusText(parts.join(' · ') || 'Connected');
    } else {
      setStatusText(result.error || 'Unavailable');
    }

    const repoRes = await legion.daemon.githubRepos();
    if (repoRes.ok && repoRes.data) {
      const data = Array.isArray(repoRes.data) ? repoRes.data : (repoRes.data as { repos?: string[] }).repos || [];
      setRepos((data as Array<string | { full_name?: string; name?: string }>).map((r) =>
        typeof r === 'string' ? r : r.full_name || r.name || ''
      ).filter(Boolean));
    }
  }, []);

  useEffect(() => { checkDaemon(); }, [checkDaemon]);

  return (
    <div className="flex h-full flex-col">
      {/* Header */}
      <div className="flex items-center justify-between border-b border-border/50 px-6 py-4">
        <div className="flex items-center gap-3">
          <GitBranchIcon className="h-5 w-5 text-primary" />
          <h1 className="text-lg font-semibold">GitHub</h1>
          {daemonOk !== null && (
            <span className={`flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-xs font-medium ${daemonOk ? 'bg-emerald-500/10 text-emerald-400' : 'bg-red-500/10 text-red-400'}`}>
              <span className={`h-1.5 w-1.5 rounded-full ${daemonOk ? 'bg-emerald-400' : 'bg-red-400'}`} />
              {statusText}
            </span>
          )}
        </div>
        <div className="flex items-center gap-2">
          {repos.length > 0 && (
            <select
              value={repoFilter}
              onChange={(e) => setRepoFilter(e.target.value)}
              className="rounded-lg border border-border/50 bg-card/50 px-2 py-1 text-xs text-foreground outline-none"
            >
              <option value="">All repos</option>
              {repos.map((r) => <option key={r} value={r}>{r}</option>)}
            </select>
          )}
          <button type="button" onClick={checkDaemon} className="rounded-md p-1.5 text-muted-foreground transition-colors hover:bg-muted/50" title="Refresh status">
            <RefreshCwIcon className="h-4 w-4" />
          </button>
          <button type="button" onClick={onClose} className="rounded-md p-1.5 text-muted-foreground transition-colors hover:bg-muted/50" title="Close">
            <XIcon className="h-4 w-4" />
          </button>
        </div>
      </div>

      {/* Tabs */}
      <div className="flex gap-1 border-b border-border/50 px-6">
        {tabs.map(({ key, label, icon: Icon }) => (
          <button
            key={key}
            type="button"
            onClick={() => setActiveTab(key)}
            className={`flex items-center gap-1.5 border-b-2 px-3 py-2.5 text-sm font-medium transition-colors ${
              activeTab === key
                ? 'border-primary text-primary'
                : 'border-transparent text-muted-foreground hover:text-foreground'
            }`}
          >
            <Icon className="h-3.5 w-3.5" />
            {label}
          </button>
        ))}
      </div>

      {/* Content */}
      <div className="flex-1 overflow-y-auto">
        {!daemonOk && daemonOk !== null ? (
          <div className="flex flex-col items-center justify-center gap-4 p-12 text-center">
            <AlertCircleIcon className="h-10 w-10 text-muted-foreground/50" />
            <div>
              <p className="font-medium text-foreground">Daemon not connected</p>
              <p className="mt-1 text-sm text-muted-foreground">GitHub features require the Legion daemon with lex-github running.</p>
            </div>
            <button type="button" onClick={checkDaemon} className="rounded-lg bg-primary px-4 py-2 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90">
              Retry
            </button>
          </div>
        ) : daemonOk === null ? (
          <div className="flex items-center justify-center p-12">
            <Loader2Icon className="h-6 w-6 animate-spin text-muted-foreground" />
          </div>
        ) : (
          <>
            {activeTab === 'pulls' && <PullRequestsTab repoFilter={repoFilter} />}
            {activeTab === 'issues' && <IssuesTab repoFilter={repoFilter} />}
            {activeTab === 'commits' && <CommitsTab repoFilter={repoFilter} />}
          </>
        )}
      </div>
    </div>
  );
}
