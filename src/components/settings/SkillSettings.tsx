import { useState, useEffect, type FC } from 'react';
import {
  Trash2Icon,
  ChevronDownIcon,
  ChevronRightIcon,
  TerminalIcon,
  CodeIcon,
  MessageSquareIcon,
  GlobeIcon,
  LayersIcon,
} from 'lucide-react';
import { app } from '@/lib/ipc-client';
import type { SettingsProps } from './shared';

type SkillEntry = {
  name: string;
  description: string;
  version?: string;
  type: string;
  enabled: boolean;
  dir: string;
};

type SkillDetail = {
  manifest?: Record<string, unknown>;
  files?: Record<string, string>;
  dir?: string;
  error?: string;
};

const typeIcons: Record<string, FC<{ className?: string }>> = {
  shell: TerminalIcon,
  script: CodeIcon,
  prompt: MessageSquareIcon,
  http: GlobeIcon,
  composite: LayersIcon,
};

const typeLabels: Record<string, string> = {
  shell: 'Shell',
  script: 'Script',
  prompt: 'Prompt',
  http: 'HTTP',
  composite: 'Composite',
};

export const SkillSettings: FC<SettingsProps> = ({ config, updateConfig: _updateConfig }) => {
  const [skills, setSkills] = useState<SkillEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [expandedSkill, setExpandedSkill] = useState<string | null>(null);
  const [skillDetail, setSkillDetail] = useState<SkillDetail | null>(null);

  const loadSkills = async () => {
    try {
      const list = await app.skills.list();
      setSkills(list);
    } catch {
      setSkills([]);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadSkills();
  }, [config]);

  const handleToggle = async (name: string, enable: boolean) => {
    await app.skills.toggle(name, enable);
    setSkills((prev) => prev.map((s) => (s.name === name ? { ...s, enabled: enable } : s)));
  };

  const handleDelete = async (name: string) => {
    await app.skills.delete(name);
    setSkills((prev) => prev.filter((s) => s.name !== name));
    if (expandedSkill === name) {
      setExpandedSkill(null);
      setSkillDetail(null);
    }
  };

  const handleExpand = async (name: string) => {
    if (expandedSkill === name) {
      setExpandedSkill(null);
      setSkillDetail(null);
      return;
    }
    setExpandedSkill(name);
    setSkillDetail(null);
    try {
      const detail = await app.skills.get(name);
      setSkillDetail(detail);
    } catch {
      setSkillDetail({ error: 'Failed to load skill details' });
    }
  };

  if (loading) {
    return (
      <div className="space-y-4">
        <h3 className="text-sm font-semibold">Skills</h3>
        <p className="text-xs text-muted-foreground">Loading skills...</p>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <h3 className="text-sm font-semibold">Skills</h3>
      <p className="text-xs text-muted-foreground">
        Skills are reusable tools stored in <code className="bg-muted rounded px-1">~/.{__BRAND_APP_SLUG}/skills/</code>.
        The AI can create new skills during conversations, or you can add them manually.
      </p>

      {skills.length === 0 ? (
        <div className="rounded-lg border border-dashed p-4 text-center">
          <p className="text-xs text-muted-foreground">
            No skills installed. Ask the AI to create one, e.g. "create a skill that checks disk usage".
          </p>
        </div>
      ) : (
        <div className="space-y-2">
          {skills.map((skill) => (
            <div key={skill.name}>
              <SkillCard
                skill={skill}
                expanded={expandedSkill === skill.name}
                onToggle={(enable) => handleToggle(skill.name, enable)}
                onDelete={() => handleDelete(skill.name)}
                onExpand={() => handleExpand(skill.name)}
              />
              {expandedSkill === skill.name && skillDetail && (
                <SkillDetailView detail={skillDetail} />
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
};

const SkillCard: FC<{
  skill: SkillEntry;
  expanded: boolean;
  onToggle: (enable: boolean) => void;
  onDelete: () => void;
  onExpand: () => void;
}> = ({ skill, expanded, onToggle, onDelete, onExpand }) => {
  const TypeIcon = typeIcons[skill.type] ?? CodeIcon;

  return (
    <div className={`rounded-lg border p-3 space-y-1 ${!skill.enabled ? 'opacity-50' : ''}`}>
      <div className="flex items-center gap-2">
        <button
          type="button"
          onClick={onExpand}
          className="p-0.5 rounded hover:bg-muted transition-colors"
        >
          {expanded ? (
            <ChevronDownIcon className="h-3.5 w-3.5 text-muted-foreground" />
          ) : (
            <ChevronRightIcon className="h-3.5 w-3.5 text-muted-foreground" />
          )}
        </button>

        <div className={`h-2 w-2 rounded-full shrink-0 ${skill.enabled ? 'bg-green-500' : 'bg-muted-foreground/30'}`} />

        <span className="text-xs font-mono font-semibold truncate">
          {skill.name}
        </span>

        <span className="flex items-center gap-0.5 text-[10px] text-muted-foreground bg-muted rounded px-1.5 py-0.5">
          <TypeIcon className="h-2.5 w-2.5" />
          {typeLabels[skill.type] ?? skill.type}
        </span>

        {skill.version && (
          <span className="text-[10px] text-muted-foreground">v{skill.version}</span>
        )}

        <div className="ml-auto flex items-center gap-1">
          <button
            type="button"
            onClick={onDelete}
            className="p-1 rounded hover:bg-destructive/10 transition-colors"
            title="Delete skill"
          >
            <Trash2Icon className="h-3.5 w-3.5 text-muted-foreground" />
          </button>
          <input
            type="checkbox"
            checked={skill.enabled}
            onChange={(e) => onToggle(e.target.checked)}
            className="rounded ml-1"
            title={skill.enabled ? 'Disable' : 'Enable'}
          />
        </div>
      </div>

      <p className="text-[10px] text-muted-foreground pl-6 truncate">
        {skill.description}
      </p>
    </div>
  );
};

const SkillDetailView: FC<{ detail: SkillDetail }> = ({ detail }) => {
  if (detail.error) {
    return (
      <div className="ml-6 mt-1 rounded border bg-destructive/5 p-2 text-[10px] text-destructive">
        {detail.error}
      </div>
    );
  }

  return (
    <div className="ml-6 mt-1 space-y-2">
      {detail.manifest && (
        <div>
          <label className="text-[10px] text-muted-foreground block mb-0.5">skill.json</label>
          <pre className="rounded border bg-muted/30 p-2 text-[10px] font-mono overflow-x-auto max-h-[200px] overflow-y-auto">
            {JSON.stringify(detail.manifest, null, 2)}
          </pre>
        </div>
      )}

      {detail.files && Object.keys(detail.files).length > 0 && (
        <div className="space-y-1.5">
          {Object.entries(detail.files).map(([filename, content]) => (
            <div key={filename}>
              <label className="text-[10px] text-muted-foreground block mb-0.5">
                {filename}
              </label>
              <pre className="rounded border bg-muted/30 p-2 text-[10px] font-mono overflow-x-auto max-h-[150px] overflow-y-auto">
                {content}
              </pre>
            </div>
          ))}
        </div>
      )}

      {detail.dir && (
        <p className="text-[10px] text-muted-foreground font-mono truncate">
          {detail.dir}
        </p>
      )}
    </div>
  );
};
