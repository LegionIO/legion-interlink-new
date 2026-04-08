import { useState, useEffect, type FC } from 'react';
import {
  PlusIcon,
  PencilIcon,
  Trash2Icon,
  SearchIcon,
  CheckCircle2Icon,
  AlertCircleIcon,
  TerminalIcon,
} from 'lucide-react';
import { app } from '@/lib/ipc-client';
import { EditableInput } from '@/components/EditableInput';
import { Toggle, type SettingsProps } from './shared';

type CliTool = {
  name: string;
  binary: string;
  extraBinaries?: string[];
  description: string;
  prefix?: string;
  enabled?: boolean;
  builtIn?: boolean;
};

export const CliToolsSettings: FC<SettingsProps> = ({ config, updateConfig }) => {
  const tools = ((config as { cliTools?: CliTool[] }).cliTools ?? []) as CliTool[];
  const [showAdd, setShowAdd] = useState(false);
  const [editIndex, setEditIndex] = useState<number | null>(null);
  const [binaryStatus, setBinaryStatus] = useState<Record<string, boolean>>({});

  useEffect(() => {
    const allBinaries = [...new Set(tools.flatMap((t) => [t.binary, ...(t.extraBinaries ?? [])]))];
    if (allBinaries.length > 0 && app.cliTools?.checkBinaries) {
      app.cliTools.checkBinaries(allBinaries).then(setBinaryStatus).catch(() => {});
    }
  }, [tools]);

  const updateTools = (newTools: CliTool[]) => updateConfig('cliTools', newTools);

  const addTool = (tool: CliTool) => {
    updateTools([...tools, { ...tool, builtIn: false }]);
    setShowAdd(false);
  };

  const updateTool = (index: number, tool: CliTool) => {
    const next = [...tools];
    next[index] = tool;
    updateTools(next);
    setEditIndex(null);
  };

  const deleteTool = (index: number) => {
    updateTools(tools.filter((_, i) => i !== index));
    if (editIndex === index) setEditIndex(null);
  };

  const toggleTool = (index: number) => {
    const next = [...tools];
    next[index] = { ...next[index], enabled: next[index].enabled === false ? true : false };
    updateTools(next);
  };

  const availableCount = tools.filter((t) => t.enabled !== false && binaryStatus[t.binary]).length;
  const totalCount = tools.length;

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-semibold">CLI Tools</h3>
        <span className="text-[10px] text-muted-foreground">
          {availableCount} active / {totalCount} configured
        </span>
      </div>
      <p className="text-xs text-muted-foreground">
        CLI tools give the AI access to command-line programs. Tools are only available if their binary is found on the system.
      </p>

      {tools.length === 0 && !showAdd && (
        <p className="text-xs text-muted-foreground">No CLI tools configured.</p>
      )}

      <div className="space-y-2">
        {tools.map((tool, i) =>
          editIndex === i ? (
            <ToolForm
              key={`edit-${i}`}
              initial={tool}
              onSave={(t) => updateTool(i, t)}
              onCancel={() => setEditIndex(null)}
              submitLabel="Save"
            />
          ) : (
            <ToolCard
              key={tool.name}
              tool={tool}
              binaryFound={binaryStatus[tool.binary] ?? false}
              onEdit={() => setEditIndex(i)}
              onDelete={() => deleteTool(i)}
              onToggle={() => toggleTool(i)}
            />
          ),
        )}
      </div>

      {showAdd ? (
        <ToolForm
          initial={{ name: '', binary: '', description: '', enabled: true }}
          onSave={addTool}
          onCancel={() => setShowAdd(false)}
          submitLabel="Add Tool"
        />
      ) : (
        <button
          type="button"
          onClick={() => setShowAdd(true)}
          className="flex items-center gap-1.5 rounded-lg border border-dashed px-3 py-2 text-xs text-muted-foreground hover:bg-muted/50 transition-colors w-full"
        >
          <PlusIcon className="h-3.5 w-3.5" />
          Add CLI Tool
        </button>
      )}
    </div>
  );
};

/* ── Tool Card (read-only row) ── */

const ToolCard: FC<{
  tool: CliTool;
  binaryFound: boolean;
  onEdit: () => void;
  onDelete: () => void;
  onToggle: () => void;
}> = ({ tool, binaryFound, onEdit, onDelete, onToggle }) => {
  const isEnabled = tool.enabled !== false;

  return (
    <div className={`rounded-lg border p-3 space-y-2 ${!isEnabled ? 'opacity-50' : ''}`}>
      <div className="flex items-center gap-2">
        <div className={`h-2 w-2 rounded-full shrink-0 ${binaryFound ? 'bg-green-500' : 'bg-red-500'}`} />
        <span className="text-xs font-mono font-semibold truncate">{tool.name}</span>

        <span className="flex items-center gap-0.5 text-[10px] text-muted-foreground bg-muted rounded px-1.5 py-0.5">
          <TerminalIcon className="h-2.5 w-2.5" /> {tool.binary}
        </span>

        {tool.extraBinaries && tool.extraBinaries.length > 0 && (
          <span className="text-[10px] text-muted-foreground bg-muted rounded px-1.5 py-0.5">
            +{tool.extraBinaries.join(', ')}
          </span>
        )}

        {tool.builtIn && (
          <span className="text-[10px] text-muted-foreground/60 bg-muted/50 rounded px-1.5 py-0.5">
            built-in
          </span>
        )}

        <div className="ml-auto flex items-center gap-1">
          <button type="button" onClick={onEdit} className="p-1 rounded hover:bg-muted transition-colors" title="Edit">
            <PencilIcon className="h-3.5 w-3.5 text-muted-foreground" />
          </button>
          {!tool.builtIn && (
            <button type="button" onClick={onDelete} className="p-1 rounded hover:bg-destructive/10 transition-colors" title="Delete">
              <Trash2Icon className="h-3.5 w-3.5 text-muted-foreground" />
            </button>
          )}
          <input
            type="checkbox"
            checked={isEnabled}
            onChange={onToggle}
            className="rounded ml-1"
            title={isEnabled ? 'Disable' : 'Enable'}
          />
        </div>
      </div>

      <div className="text-[10px] text-muted-foreground line-clamp-2">
        {tool.description.split('\n')[0]}
      </div>

      {!binaryFound && isEnabled && (
        <div className="flex items-center gap-1.5 text-[10px] text-red-500 dark:text-red-400">
          <AlertCircleIcon className="h-3 w-3" />
          Binary &quot;{tool.binary}&quot; not found on system
        </div>
      )}
    </div>
  );
};

/* ── Tool Form (add / edit) ── */

const ToolForm: FC<{
  initial: CliTool;
  onSave: (tool: CliTool) => void;
  onCancel: () => void;
  submitLabel: string;
}> = ({ initial, onSave, onCancel, submitLabel }) => {
  const [name, setName] = useState(initial.name);
  const [binary, setBinary] = useState(initial.binary);
  const [extraBinaries, setExtraBinaries] = useState((initial.extraBinaries ?? []).join(', '));
  const [description, setDescription] = useState(initial.description);
  const [prefix, setPrefix] = useState(initial.prefix ?? '');
  const [enabled, setEnabled] = useState(initial.enabled !== false);
  const [checkResult, setCheckResult] = useState<boolean | null>(null);

  const canSave = name.trim() && binary.trim() && description.trim();

  const handleCheckBinary = async () => {
    if (!binary.trim()) return;
    setCheckResult(null);
    try {
      const results = await app.cliTools.checkBinaries([binary.trim()]);
      setCheckResult(results[binary.trim()] ?? false);
    } catch {
      setCheckResult(false);
    }
  };

  const handleSave = () => {
    if (!canSave) return;
    const extras = extraBinaries.split(',').map((s) => s.trim()).filter(Boolean);
    const tool: CliTool = {
      name: name.trim(),
      binary: binary.trim(),
      extraBinaries: extras.length > 0 ? extras : undefined,
      description: description.trim(),
      prefix: prefix.trim() || undefined,
      enabled,
      builtIn: initial.builtIn,
    };
    onSave(tool);
  };

  return (
    <div className="rounded-lg border bg-card p-3 space-y-3">
      <div className="grid grid-cols-2 gap-3">
        <div>
          <label className="text-[10px] text-muted-foreground block mb-0.5">Tool Name</label>
          <EditableInput
            className="w-full rounded border bg-background px-2 py-1 text-xs font-mono"
            value={name}
            onChange={setName}
            placeholder="my-tool"
          />
        </div>
        <div>
          <label className="text-[10px] text-muted-foreground block mb-0.5">Binary</label>
          <div className="flex items-center gap-1">
            <EditableInput
              className="flex-1 rounded border bg-background px-2 py-1 text-xs font-mono"
              value={binary}
              onChange={(v) => { setBinary(v); setCheckResult(null); }}
              placeholder="htop"
            />
            <button
              type="button"
              onClick={handleCheckBinary}
              disabled={!binary.trim()}
              className="p-1 rounded hover:bg-muted transition-colors disabled:opacity-40"
              title="Check if binary exists"
            >
              <SearchIcon className="h-3.5 w-3.5 text-muted-foreground" />
            </button>
            {checkResult !== null && (
              checkResult
                ? <CheckCircle2Icon className="h-3.5 w-3.5 text-green-500" />
                : <AlertCircleIcon className="h-3.5 w-3.5 text-red-500" />
            )}
          </div>
        </div>
      </div>

      <div>
        <label className="text-[10px] text-muted-foreground block mb-0.5">Extra Binaries (comma-separated)</label>
        <EditableInput
          className="w-full rounded border bg-background px-2 py-1 text-xs font-mono"
          value={extraBinaries}
          onChange={setExtraBinaries}
          placeholder="pip3, pip"
        />
      </div>

      <div>
        <label className="text-[10px] text-muted-foreground block mb-0.5">Description</label>
        <textarea
          className="w-full rounded border bg-background px-2 py-1 text-xs font-mono min-h-[60px] resize-y outline-none focus:ring-1 focus:ring-ring"
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          placeholder="Describe what this tool does and provide usage examples..."
        />
      </div>

      <div>
        <label className="text-[10px] text-muted-foreground block mb-0.5">Example Prefix (optional)</label>
        <EditableInput
          className="w-full rounded border bg-background px-2 py-1 text-xs font-mono"
          value={prefix}
          onChange={setPrefix}
          placeholder="htop --version"
        />
      </div>

      <Toggle label="Enabled" checked={enabled} onChange={setEnabled} />

      <div className="flex items-center gap-2 pt-1">
        <button
          type="button"
          onClick={handleSave}
          disabled={!canSave}
          className="rounded-md bg-primary text-primary-foreground px-3 py-1 text-xs font-medium disabled:opacity-40 transition-colors hover:bg-primary/90"
        >
          {submitLabel}
        </button>
        <button
          type="button"
          onClick={onCancel}
          className="rounded-md bg-muted px-3 py-1 text-xs hover:bg-muted/80 transition-colors"
        >
          Cancel
        </button>
      </div>
    </div>
  );
};
