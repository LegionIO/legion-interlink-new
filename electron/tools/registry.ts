import type { ToolDefinition } from './types.js';
import type { AppConfig } from '../config/schema.js';
import type { ComputerSession } from '../../shared/computer-use.js';
import { createShellTool } from './shell.js';
import { createFileReadTool } from './file-read.js';
import { createFileWriteTool, createFileEditTool } from './file-write.js';
import { createGrepTool, createGlobTool, createListDirectoryTool } from './file-search.js';
import { connectAllMcpServers } from './mcp-client.js';
import { createMcpManageTool } from './mcp-manage.js';
import {
  createMemorySettingsTool,
  createCompactionSettingsTool,
  createToolSettingsTool,
  createAdvancedSettingsTool,
  createSystemPromptTool,
  createAudioSettingsTool,
  createRealtimeSettingsTool,
} from './config-manage.js';
import { createModelSwitchTool } from './model-switch.js';
import { createSubAgentTool } from './sub-agent.js';
import { loadSkillsAsTools } from './skill-loader.js';
import { createSkillManageTool } from './skill-manage.js';
import { createCliToolManageTool } from './cli-tool-manage.js';
import { webFetchTool } from './web-fetch.js';
import { webSearchTool } from './web-search.js';
import { createImageGenTool } from './image-gen.js';
import { createVideoGenTool } from './video-gen.js';
import { buildCliTools } from './cli-tools.js';
import { z } from 'zod';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { getComputerUseManager } from '../computer-use/service.js';

type ConversationMessageLike = {
  id?: string;
  parentId?: string | null;
  role?: string;
  content?: unknown;
};

type ConversationRecordLike = {
  title?: string | null;
  fallbackTitle?: string | null;
  messages?: unknown[];
  messageTree?: ConversationMessageLike[];
  headId?: string | null;
};

function normalizeSnippet(value: string, maxLength = 240): string {
  const trimmed = value.replace(/\s+/g, ' ').trim();
  if (!trimmed) return '';
  return trimmed.length <= maxLength
    ? trimmed
    : trimmed.slice(0, Math.max(0, maxLength - 3)).trimEnd() + '...';
}

function extractMessageText(message: unknown): string {
  const content = Array.isArray((message as { content?: unknown })?.content)
    ? (message as { content: unknown[] }).content
    : [];

  return normalizeSnippet(content.flatMap((part) => {
    const candidate = part as {
      type?: string;
      text?: string;
      filename?: string;
      toolName?: string;
      result?: unknown;
      liveOutput?: { stdout?: string; stderr?: string };
    };

    if (candidate.type === 'text' && typeof candidate.text === 'string') {
      return [candidate.text];
    }

    if (candidate.type === 'file' && typeof candidate.filename === 'string') {
      return ['Attached file: ' + candidate.filename];
    }

    if (candidate.type === 'tool-call' && typeof candidate.toolName === 'string') {
      const outputs = [
        typeof candidate.result === 'string' ? candidate.result : '',
        candidate.liveOutput?.stdout ?? '',
        candidate.liveOutput?.stderr ?? '',
      ].map((value) => normalizeSnippet(value, 120)).filter(Boolean);
      return [outputs.length > 0 ? 'Tool ' + candidate.toolName + ': ' + outputs.join(' ') : 'Tool ' + candidate.toolName];
    }

    return [];
  }).join(' '));
}

function resolveConversationMessages(conversation: ConversationRecordLike | null): unknown[] {
  if (Array.isArray(conversation?.messageTree) && conversation.messageTree.length > 0) {
    const byId = new Map(conversation.messageTree
      .filter((message) => typeof message.id === 'string')
      .map((message) => [message.id as string, message]));
    const ordered: ConversationMessageLike[] = [];
    const seen = new Set<string>();
    let cursor = conversation.headId ?? conversation.messageTree[conversation.messageTree.length - 1]?.id ?? null;

    while (cursor && !seen.has(cursor)) {
      seen.add(cursor);
      const message = byId.get(cursor);
      if (!message) break;
      ordered.unshift(message);
      cursor = typeof message.parentId === 'string' ? message.parentId : null;
    }

    if (ordered.length > 0) {
      return ordered;
    }
  }

  return Array.isArray(conversation?.messages) ? conversation.messages : [];
}

function buildConversationContextSummary(conversation: ConversationRecordLike | null): string | undefined {
  const messages = resolveConversationMessages(conversation);
  const excerpts = messages
    .map((message) => {
      const role = typeof (message as { role?: unknown })?.role === 'string'
        ? String((message as { role?: string }).role)
        : 'unknown';
      const text = extractMessageText(message);
      return { role, text };
    })
    .filter((message) => message.text && ['system', 'user', 'assistant'].includes(message.role))
    .slice(-6)
    .map((message) => message.role + ': ' + message.text);

  if (excerpts.length === 0) return undefined;

  const title = normalizeSnippet(conversation?.title ?? conversation?.fallbackTitle ?? '', 120);
  const summary = title
    ? ['Conversation title: ' + title, ...excerpts].join('\n')
    : excerpts.join('\n');

  return summary.length <= 1800
    ? summary
    : summary.slice(0, 1797).trimEnd() + '...';
}

function readConversationRecord(appHome: string, conversationId: string): ConversationRecordLike | null {
  const storePath = join(appHome, 'data', 'conversations.json');
  if (!existsSync(storePath)) return null;

  try {
    const store = JSON.parse(readFileSync(storePath, 'utf-8')) as {
      conversations?: Record<string, ConversationRecordLike>;
    };
    return store.conversations?.[conversationId] ?? null;
  } catch {
    return null;
  }
}

export async function buildToolRegistry(getConfig: () => AppConfig, appHome?: string): Promise<ToolDefinition[]> {
  let config: AppConfig;
  try {
    config = getConfig();
  } catch {
    console.warn('[ToolRegistry] Config not available yet, registering default tools');
    // Return basic tools even without config
    return [
      createFileReadTool(),
      createFileWriteTool(),
      createFileEditTool(),
      createGrepTool(),
      createGlobTool(),
      createListDirectoryTool(),
    ];
  }

  const tools: ToolDefinition[] = [];

  // Shell tool
  if (config?.tools?.shell?.enabled !== false) {
    tools.push(createShellTool(getConfig));
  }

  // CLI tools (gh/git, brew, wget, jq, tree, python, ollama, klist, jfrog)
  // Only included if the binary exists on the system
  if (config?.tools?.shell?.enabled !== false) {
    tools.push(...buildCliTools(getConfig));
  }

  // File tools
  if (config?.tools?.fileAccess?.enabled !== false) {
    tools.push(createFileReadTool());
    tools.push(createFileWriteTool());
    tools.push(createFileEditTool());
    tools.push(createGrepTool(getConfig));
    tools.push(createGlobTool(getConfig));
    tools.push(createListDirectoryTool());
  }

  // Web tools
  if (config?.tools?.webFetch?.enabled !== false) {
    tools.push(webFetchTool);
  }
  if (config?.tools?.webSearch?.enabled !== false) {
    tools.push(webSearchTool);
  }

  // Media generation tools
  if (config?.imageGeneration?.enabled && appHome) {
    tools.push(createImageGenTool(getConfig, appHome));
  }
  if (config?.videoGeneration?.enabled && appHome) {
    tools.push(createVideoGenTool(getConfig, appHome));
  }

  // Self-management tools (always available)
  if (appHome) {
    tools.push(createMcpManageTool(appHome));
    tools.push(createMemorySettingsTool(appHome));
    tools.push(createCompactionSettingsTool(appHome));
    tools.push(createToolSettingsTool(appHome));
    tools.push(createAdvancedSettingsTool(appHome));
    tools.push(createSystemPromptTool(appHome));
    tools.push(createAudioSettingsTool(appHome));
    tools.push(createRealtimeSettingsTool(appHome));
    tools.push(createModelSwitchTool(appHome));
  }

  // Sub-agent tool
  if (config?.tools?.subAgents?.enabled !== false && appHome) {
    tools.push(createSubAgentTool(getConfig, appHome, 0, tools));
  }

  // Skill management tool (always available)
  if (appHome) {
    tools.push(createSkillManageTool(appHome));
    tools.push(createCliToolManageTool(appHome));
  }

  const cuSurface = config.computerUse?.toolSurface ?? 'both';
  const cuEnabledForChat = config.computerUse?.enabled !== false && (cuSurface === 'both' || cuSurface === 'only-chat');

  if (appHome && cuEnabledForChat) {
    const manager = getComputerUseManager(appHome, getConfig);
    tools.push({
      name: 'computer_use_session',
      description: 'Start a long-lived computer-use session that can control a browser or local desktop with live viewport updates and approval handling.',
      inputSchema: z.object({
        goal: z.string().describe('The goal the computer-use session should accomplish.'),
        target: z.enum(['isolated-browser', 'local-macos']).optional(),
        surface: z.enum(['docked', 'window']).optional(),
        approvalMode: z.enum(['step', 'goal', 'autonomous']).optional(),
        modelKey: z.string().optional(),
        profileKey: z.string().optional(),
        conversationContext: z.enum(['current', 'none']).optional().describe('Whether to include a concise summary of the current conversation. Defaults to current.'),
      }),
      execute: async (input, context) => {
        const payload = input as {
          goal: string;
          target?: 'isolated-browser' | 'local-macos';
          surface?: 'docked' | 'window';
          approvalMode?: 'step' | 'goal' | 'autonomous';
          modelKey?: string;
          profileKey?: string;
          conversationContext?: 'current' | 'none';
        };
        const conversationId = context.conversationId;
        if (!conversationId) {
          throw new Error('Computer use sessions must be tied to the current conversation.');
        }
        const contextSummary = payload.conversationContext === 'none'
          ? undefined
          : buildConversationContextSummary(readConversationRecord(appHome, conversationId));
        const session = await manager.startSession(payload.goal, {
          conversationId,
          target: payload.target,
          surface: payload.surface,
          approvalMode: payload.approvalMode,
          modelKey: payload.modelKey ?? null,
          profileKey: payload.profileKey ?? null,
          contextSummary,
        });
        return {
          sessionId: session.id,
          status: session.status,
          target: session.target,
          approvalMode: session.approvalMode,
          currentSubgoal: session.currentSubgoal,
        };
      },
    });
    tools.push({
      name: 'computer_use_control',
      description: 'Control an existing computer-use session: pause, resume, stop, continue (resume a completed session with a new goal), approve/reject actions, or change the display surface. If sessionId is omitted, targets the most recent session for the current conversation.',
      inputSchema: z.object({
        sessionId: z.string().optional().describe('Session ID. If omitted, targets the most recent session for the current conversation.'),
        action: z.enum(['pause', 'resume', 'stop', 'continue', 'approve', 'reject', 'surface']),
        actionId: z.string().optional().describe('Required for approve/reject actions.'),
        reason: z.string().optional().describe('Optional rejection reason.'),
        goal: z.string().optional().describe('Required for continue action — the new follow-up goal.'),
        surface: z.enum(['docked', 'window']).optional().describe('Required for surface action.'),
      }),
      execute: async (input, context) => {
        const payload = input as {
          sessionId?: string;
          action: 'pause' | 'resume' | 'stop' | 'continue' | 'approve' | 'reject' | 'surface';
          actionId?: string;
          reason?: string;
          goal?: string;
          surface?: 'docked' | 'window';
        };

        let targetSessionId = payload.sessionId;
        if (!targetSessionId && context.conversationId) {
          const all = manager.listSessions();
          // For 'continue', find the most recent terminal session; otherwise find the active one
          const match = payload.action === 'continue'
            ? all.find((s) => s.conversationId === context.conversationId
                && (s.status === 'completed' || s.status === 'stopped' || s.status === 'failed'))
            : all.find((s) => s.conversationId === context.conversationId
                && s.status !== 'completed' && s.status !== 'stopped' && s.status !== 'failed');
          targetSessionId = match?.id;
        }
        if (!targetSessionId) return { isError: true, error: payload.action === 'continue' ? 'No completed computer-use session found to continue.' : 'No active computer-use session found.' };

        const result = payload.action === 'pause'
          ? manager.pauseSession(targetSessionId)
          : payload.action === 'resume'
            ? manager.resumeSession(targetSessionId)
            : payload.action === 'stop'
              ? manager.stopSession(targetSessionId)
              : payload.action === 'continue'
                ? await manager.continueSession(targetSessionId, payload.goal ?? '')
                : payload.action === 'approve'
                  ? await manager.approveAction(targetSessionId, payload.actionId ?? '')
                  : payload.action === 'reject'
                    ? manager.rejectAction(targetSessionId, payload.actionId ?? '', payload.reason)
                    : manager.setSurface(targetSessionId, payload.surface ?? 'docked');
        return result ?? { isError: true, error: 'Computer-use session not found.' };
      },
    });

    tools.push({
      name: 'computer_use_session_info',
      description: 'Fetch information about a computer-use session. Works during and after execution. Returns structured data without screenshots. Use to check progress, audit steps, or get the final result.',
      inputSchema: z.object({
        sessionId: z.string().optional().describe('Session ID. If omitted, returns the most recent session for the current conversation.'),
        includeResult: z.boolean().optional().describe('Include status summary and final result. Defaults to true.'),
        includeSteps: z.boolean().optional().describe('Include individual action steps (without screenshots). Defaults to false.'),
        includeCheckpoints: z.boolean().optional().describe('Include checkpoint summaries. Defaults to false.'),
        includeGuidance: z.boolean().optional().describe('Include user guidance messages. Defaults to false.'),
        includePermissions: z.boolean().optional().describe('Include permission state. Defaults to false.'),
        includePlan: z.boolean().optional().describe('Include current plan/subgoal state. Defaults to false.'),
        stepLimit: z.number().optional().describe('Max number of steps to return (most recent). Defaults to 20.'),
      }),
      execute: async (input, context) => {
        const payload = input as {
          sessionId?: string;
          includeResult?: boolean;
          includeSteps?: boolean;
          includeCheckpoints?: boolean;
          includeGuidance?: boolean;
          includePermissions?: boolean;
          includePlan?: boolean;
          stepLimit?: number;
        };

        let session: ComputerSession | null = null;
        if (payload.sessionId) {
          session = manager.getSession(payload.sessionId) ?? null;
        } else if (context.conversationId) {
          const all = manager.listSessions();
          session = all.find((s) => s.conversationId === context.conversationId) ?? null;
        }
        if (!session) return { isError: true, error: 'No computer-use session found.' };

        const includeResult = payload.includeResult !== false;
        const stepLimit = payload.stepLimit ?? 20;

        const result: Record<string, unknown> = {
          sessionId: session.id,
          conversationId: session.conversationId,
          goal: session.goal,
          target: session.target,
          status: session.status,
          createdAt: session.createdAt,
          updatedAt: session.updatedAt,
          actionCount: session.actions.length,
        };

        if (includeResult) {
          result.currentSubgoal = session.currentSubgoal;
          result.planSummary = session.planSummary;
          result.lastError = session.lastError;
          result.statusMessage = session.statusMessage;
        }

        if (payload.includeSteps) {
          result.steps = session.actions.slice(-stepLimit).map((action) => ({
            id: action.id,
            kind: action.kind,
            status: action.status,
            rationale: action.rationale,
            risk: action.risk,
            resultSummary: action.resultSummary,
            error: action.error,
            createdAt: action.createdAt,
            // Include action params but NOT screenshots
            ...(action.x != null ? { x: action.x, y: action.y } : {}),
            ...(action.resolvedX != null ? { resolvedX: action.resolvedX, resolvedY: action.resolvedY } : {}),
            ...(action.elementId ? { elementId: action.elementId } : {}),
            ...(action.text ? { text: action.text } : {}),
            ...(action.url ? { url: action.url } : {}),
            ...(action.keys?.length ? { keys: action.keys } : {}),
            ...(action.appName ? { appName: action.appName } : {}),
          }));
        }

        if (payload.includeCheckpoints) {
          result.checkpoints = session.checkpoints.map((cp) => ({
            id: cp.id,
            summary: cp.summary,
            successCriteria: cp.successCriteria,
            complete: cp.complete,
            createdAt: cp.createdAt,
          }));
        }

        if (payload.includeGuidance) {
          result.guidanceMessages = (session.guidanceMessages ?? []).map((m) => ({
            id: m.id,
            text: m.text,
            createdAt: m.createdAt,
            injectedAt: m.injectedAt,
          }));
        }

        if (payload.includePermissions && session.permissionState) {
          result.permissions = session.permissionState;
        }

        if (payload.includePlan && session.plannerState) {
          result.plan = {
            summary: session.plannerState.summary,
            subgoals: session.plannerState.subgoals,
            successCriteria: session.plannerState.successCriteria,
            activeSubgoalIndex: session.plannerState.activeSubgoalIndex,
          };
        }

        return result;
      },
    });

    tools.push({
      name: 'computer_use_session_message',
      description: 'Send a guidance message to a computer-use session. If the session is active, the message is queued for the next planning cycle. If the session has completed/stopped/failed, it will be automatically resumed with the message as a follow-up goal. Use this to redirect, clarify, add instructions, or continue a finished session.',
      inputSchema: z.object({
        sessionId: z.string().optional().describe('Session ID. If omitted, targets the most recent session for the current conversation.'),
        message: z.string().describe('The guidance or follow-up message to send to the session.'),
      }),
      execute: async (input, context) => {
        const payload = input as { sessionId?: string; message: string };

        let targetSessionId = payload.sessionId;
        if (!targetSessionId && context.conversationId) {
          const all = manager.listSessions();
          // First try to find an active session, then fall back to the most recent terminal one
          const active = all.find((s) =>
            s.conversationId === context.conversationId
            && s.status !== 'completed' && s.status !== 'stopped' && s.status !== 'failed',
          );
          if (active) {
            targetSessionId = active.id;
          } else {
            const terminal = all.find((s) => s.conversationId === context.conversationId);
            targetSessionId = terminal?.id;
          }
        }
        if (!targetSessionId) return { isError: true, error: 'No computer-use session found for this conversation.' };

        // Try sending guidance first (works for active sessions)
        const guidanceResult = await manager.sendGuidance(targetSessionId, payload.message);
        if (guidanceResult) {
          return {
            sessionId: guidanceResult.id,
            status: guidanceResult.status,
            action: guidanceResult.status === 'running' ? 'guidance_queued_and_resumed' : 'guidance_queued',
            pendingGuidanceCount: (guidanceResult.guidanceMessages ?? []).filter((m) => !m.injectedAt).length,
          };
        }

        // Session is terminal — continue it with the message as a new goal
        const continued = await manager.continueSession(targetSessionId, payload.message);
        if (continued) {
          return {
            sessionId: continued.id,
            status: continued.status,
            action: 'session_continued',
            goal: continued.goal,
          };
        }

        return { isError: true, error: 'Failed to send message or continue session.' };
      },
    });
  }

  // Skill tools
  if (appHome) {
    const skillsDir = config.skills?.directory || (appHome + '/skills');
    const enabledSkills = config.skills?.enabled ?? [];
    const skillTools = loadSkillsAsTools(skillsDir, enabledSkills, getConfig, tools);
    tools.push(...skillTools);
  }

  // MCP tools
  if (config?.mcpServers?.length) {
    try {
      const mcpTools = await connectAllMcpServers(config);
      tools.push(...mcpTools);
    } catch (error) {
      console.error('[ToolRegistry] Failed to connect MCP servers:', error);
    }
  }

  return tools;
}
