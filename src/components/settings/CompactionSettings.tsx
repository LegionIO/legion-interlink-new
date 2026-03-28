import type { FC } from 'react';
import { Toggle, NumberField, SliderField, headTailLabel, settingsSelectClass, type SettingsProps } from './shared';

export const CompactionSettings: FC<SettingsProps> = ({ config, updateConfig }) => {
  const compaction = config.compaction as {
    tool: { enabled: boolean; useAI: boolean; triggerTokens: number; outputMaxTokens: number; truncateMinChars: number; truncateHeadRatio: number; truncateMinTailChars: number };
    conversation: { enabled: boolean; mode: string; triggerPercent: number; ignoreRecentUserMessages: number; ignoreRecentAssistantMessages: number; outputMaxTokens: number; promptReserveTokens: number };
  };

  return (
    <div className="space-y-6">
      <h3 className="text-sm font-semibold">Compaction</h3>

      {/* Tool compaction */}
      <fieldset className="rounded-lg border p-3 space-y-3">
        <legend className="text-xs font-semibold px-1">Tool Result Compaction</legend>
        <Toggle label="Enabled" checked={compaction.tool.enabled} onChange={(v) => updateConfig('compaction.tool.enabled', v)} />
        <Toggle label="Use AI extraction" checked={compaction.tool.useAI} onChange={(v) => updateConfig('compaction.tool.useAI', v)} />
        <NumberField label="Trigger threshold (tokens)" value={compaction.tool.triggerTokens} onChange={(v) => updateConfig('compaction.tool.triggerTokens', v)} />
        <NumberField label="Max output tokens" value={compaction.tool.outputMaxTokens} onChange={(v) => updateConfig('compaction.tool.outputMaxTokens', v)} />
        <NumberField label="Truncate min chars" value={compaction.tool.truncateMinChars} onChange={(v) => updateConfig('compaction.tool.truncateMinChars', v)} />
        <NumberField label="Truncate min tail chars" value={compaction.tool.truncateMinTailChars} onChange={(v) => updateConfig('compaction.tool.truncateMinTailChars', v)} />
        <SliderField label={headTailLabel('Head ratio', compaction.tool.truncateHeadRatio)} value={compaction.tool.truncateHeadRatio} min={0.1} max={0.9} step={0.05} onChange={(v) => updateConfig('compaction.tool.truncateHeadRatio', v)} />
      </fieldset>

      {/* Conversation compaction */}
      <fieldset className="rounded-lg border p-3 space-y-3">
        <legend className="text-xs font-semibold px-1">Conversation Compaction</legend>
        <Toggle label="Enabled" checked={compaction.conversation.enabled} onChange={(v) => updateConfig('compaction.conversation.enabled', v)} />
        <div>
          <label className="text-[10px] text-muted-foreground block mb-0.5">Mode</label>
          <select
            className={settingsSelectClass}
            value={compaction.conversation.mode}
            onChange={(e) => updateConfig('compaction.conversation.mode', e.target.value)}
          >
            <option value="mastra-observational-memory">Mastra Observational Memory</option>
            <option value="legacy-summary">Legacy Summary</option>
          </select>
        </div>
        <SliderField label={`Trigger at ${Math.round(compaction.conversation.triggerPercent * 100)}% context`} value={compaction.conversation.triggerPercent} min={0.5} max={0.95} step={0.05} onChange={(v) => updateConfig('compaction.conversation.triggerPercent', v)} />
        <NumberField label="Ignore recent user messages" value={compaction.conversation.ignoreRecentUserMessages} onChange={(v) => updateConfig('compaction.conversation.ignoreRecentUserMessages', v)} />
        <NumberField label="Ignore recent assistant messages" value={compaction.conversation.ignoreRecentAssistantMessages} onChange={(v) => updateConfig('compaction.conversation.ignoreRecentAssistantMessages', v)} />
        <NumberField label="Summary max tokens" value={compaction.conversation.outputMaxTokens} onChange={(v) => updateConfig('compaction.conversation.outputMaxTokens', v)} />
        <NumberField label="Prompt reserve tokens" value={compaction.conversation.promptReserveTokens} onChange={(v) => updateConfig('compaction.conversation.promptReserveTokens', v)} />
      </fieldset>
    </div>
  );
};
