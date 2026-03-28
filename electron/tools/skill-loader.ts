import { z } from 'zod';
import { readdirSync, readFileSync, existsSync, statSync } from 'fs';
import { join } from 'path';
import { createWorkflow, createStep } from '@mastra/core/workflows';
import type { AnyWorkflow } from '@mastra/core/workflows';
import { registerSkillWorkflow } from '../agent/mastra-instance.js';
import type { ToolDefinition, ToolExecutionContext } from './types.js';
import { buildScopedToolName, findToolByName } from './naming.js';
import type { LegionConfig } from '../config/schema.js';
import { runCommandWithStreaming, resolveProcessStreamingConfig } from './process-runner.js';
import { runToolExecution } from './execution.js';

/* ── Manifest types ── */

export type SkillExecutionType = 'shell' | 'script' | 'prompt' | 'http' | 'composite';

export type CompositeStep = {
  tool: string;
  args: Record<string, unknown>;
};

export type SkillExecution = {
  type: SkillExecutionType;
  command?: string;
  scriptFile?: string;
  promptTemplate?: string;
  url?: string;
  method?: string;
  headers?: Record<string, string>;
  bodyTemplate?: string;
  steps?: CompositeStep[];
};

export type SkillManifest = {
  name: string;
  description: string;
  version?: string;
  inputSchema?: Record<string, unknown>;
  execution: SkillExecution;
};

type WorkflowChain = {
  then: (step: unknown) => WorkflowChain;
  commit: () => AnyWorkflow;
};

export function getSkillToolName(skillName: string): string {
  return buildScopedToolName('skill', skillName);
}

/* ── Template interpolation ── */

export function interpolateTemplate(template: string, input: Record<string, unknown>): string {
  return template.replace(/\{\{input\.([^}]+)\}\}/g, (_match, path: string) => {
    const keys = path.trim().split('.');
    let current: unknown = input;
    for (const key of keys) {
      if (current == null || typeof current !== 'object') return '';
      current = (current as Record<string, unknown>)[key];
    }
    return current == null ? '' : String(current);
  });
}

/* ── JSON Schema → Zod conversion ── */

export function convertJsonSchemaToZod(schema: Record<string, unknown>): z.ZodTypeAny {
  if (!schema || typeof schema !== 'object') return z.any();

  const type = schema.type as string | undefined;
  const description = schema.description as string | undefined;

  const applyDesc = <T extends z.ZodTypeAny>(zType: T): T => {
    return description ? (zType.describe(description) as T) : zType;
  };

  switch (type) {
    case 'string': {
      const enumVals = schema.enum as string[] | undefined;
      if (enumVals && enumVals.length > 0) {
        return applyDesc(z.enum(enumVals as [string, ...string[]]));
      }
      return applyDesc(z.string());
    }
    case 'number':
    case 'integer': {
      let n = z.number();
      if (typeof schema.minimum === 'number') n = n.min(schema.minimum);
      if (typeof schema.maximum === 'number') n = n.max(schema.maximum);
      return applyDesc(n);
    }
    case 'boolean':
      return applyDesc(z.boolean());
    case 'array': {
      const items = schema.items as Record<string, unknown> | undefined;
      return applyDesc(z.array(items ? convertJsonSchemaToZod(items) : z.any()));
    }
    case 'object': {
      const properties = schema.properties as Record<string, Record<string, unknown>> | undefined;
      const required = schema.required as string[] | undefined;
      if (!properties) return applyDesc(z.record(z.any()));

      const shape: Record<string, z.ZodTypeAny> = {};
      for (const [key, propSchema] of Object.entries(properties)) {
        let fieldType = convertJsonSchemaToZod(propSchema);
        if (!required?.includes(key)) {
          fieldType = fieldType.optional();
        }
        shape[key] = fieldType;
      }
      return applyDesc(z.object(shape));
    }
    default:
      return applyDesc(z.any());
  }
}

/* ── Skill loading from disk ── */

export function loadSkillsFromDisk(skillsDir: string): Array<{ manifest: SkillManifest; dir: string }> {
  if (!existsSync(skillsDir)) return [];

  const results: Array<{ manifest: SkillManifest; dir: string }> = [];

  let entries: string[];
  try {
    entries = readdirSync(skillsDir);
  } catch {
    return [];
  }

  for (const entry of entries) {
    const skillDir = join(skillsDir, entry);
    try {
      if (!statSync(skillDir).isDirectory()) continue;
    } catch {
      continue;
    }

    const manifestPath = join(skillDir, 'skill.json');
    if (!existsSync(manifestPath)) continue;

    try {
      const raw = JSON.parse(readFileSync(manifestPath, 'utf-8'));
      const manifest: SkillManifest = {
        name: raw.name ?? entry,
        description: raw.description ?? `Skill: ${entry}`,
        version: raw.version,
        inputSchema: raw.inputSchema,
        execution: raw.execution ?? { type: 'shell', command: './run.sh' },
      };
      results.push({ manifest, dir: skillDir });
    } catch (err) {
      console.warn(`[SkillLoader] Failed to load skill ${entry}:`, err);
    }
  }

  return results;
}

/* ── Execution handler functions (used inside Mastra Steps) ── */

async function runShellExecution(
  manifest: SkillManifest,
  skillDir: string,
  input: Record<string, unknown>,
  getConfig: () => LegionConfig,
): Promise<Record<string, unknown>> {
  const command = manifest.execution.command ?? './run.sh';
  const resolvedCommand = interpolateTemplate(command, input);
  const config = getConfig();
  const streaming = resolveProcessStreamingConfig(config);

  // Create a minimal execution context for process-runner (no progress/abort in workflow steps)
  const context: ToolExecutionContext = { toolCallId: `wf-${Date.now()}` };

  const result = await runCommandWithStreaming({
    command: resolvedCommand,
    cwd: skillDir,
    timeoutMs: config.tools.shell.timeout,
    env: { ...process.env, SKILL_INPUT: JSON.stringify(input) },
    context,
    streaming,
  });

  return {
    exitCode: result.exitCode,
    stdout: result.stdout,
    stderr: result.stderr,
    ...(result.timedOut ? { error: 'Skill timed out' } : {}),
    ...(result.cancelled ? { error: 'Skill cancelled' } : {}),
  };
}

async function runScriptExecution(
  manifest: SkillManifest,
  skillDir: string,
  input: Record<string, unknown>,
  getConfig: () => LegionConfig,
): Promise<Record<string, unknown>> {
  const scriptFile = manifest.execution.scriptFile ?? 'index.mjs';
  const config = getConfig();
  const streaming = resolveProcessStreamingConfig(config);
  const context: ToolExecutionContext = { toolCallId: `wf-${Date.now()}` };

  const result = await runCommandWithStreaming({
    command: `node ${JSON.stringify(scriptFile)}`,
    cwd: skillDir,
    timeoutMs: config.tools.shell.timeout,
    env: { ...process.env, SKILL_INPUT: JSON.stringify(input) },
    context,
    streaming,
  });

  let parsed: unknown;
  try {
    parsed = JSON.parse(result.stdout.trim());
  } catch {
    parsed = undefined;
  }

  return {
    exitCode: result.exitCode,
    output: parsed ?? result.stdout,
    stderr: result.stderr || undefined,
    ...(result.timedOut ? { error: 'Skill timed out' } : {}),
    ...(result.cancelled ? { error: 'Skill cancelled' } : {}),
  };
}

function runPromptExecution(
  manifest: SkillManifest,
  input: Record<string, unknown>,
): Record<string, unknown> {
  const template = manifest.execution.promptTemplate ?? '';
  return { prompt: interpolateTemplate(template, input) };
}

async function runHttpExecution(
  manifest: SkillManifest,
  input: Record<string, unknown>,
): Promise<Record<string, unknown>> {
  const exec = manifest.execution;
  const url = interpolateTemplate(exec.url ?? '', input);
  const method = (exec.method ?? 'POST').toUpperCase();

  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    ...(exec.headers ?? {}),
  };
  for (const [key, value] of Object.entries(headers)) {
    headers[key] = interpolateTemplate(value, input);
  }

  const fetchOptions: RequestInit = { method, headers };

  if (method !== 'GET' && method !== 'HEAD') {
    if (exec.bodyTemplate) {
      fetchOptions.body = interpolateTemplate(exec.bodyTemplate, input);
    } else {
      fetchOptions.body = JSON.stringify(input);
    }
  }

  const resp = await fetch(url, fetchOptions);
  const contentType = resp.headers.get('content-type') ?? '';
  let body: unknown;
  if (contentType.includes('json')) {
    body = await resp.json();
  } else {
    body = await resp.text();
  }

  return {
    status: resp.status,
    ok: resp.ok,
    body,
    ...(resp.ok ? {} : { error: `HTTP ${resp.status}` }),
  };
}

/* ── Build a Mastra Workflow from a skill manifest ── */

const anySchema = z.record(z.any());

export function skillToWorkflow(
  manifest: SkillManifest,
  skillDir: string,
  getConfig: () => LegionConfig,
  allTools?: ToolDefinition[],
): AnyWorkflow {
  const inputSchema = manifest.inputSchema
    ? convertJsonSchemaToZod(manifest.inputSchema)
    : anySchema;
  const outputSchema = anySchema;

  if (manifest.execution.type === 'composite') {
    return buildCompositeWorkflow(manifest, inputSchema, outputSchema, getConfig, allTools ?? []);
  }

  // Single-step workflow for shell/script/prompt/http
  const executionStep = createStep({
    id: `${manifest.name}-execute`,
    description: manifest.description,
    inputSchema: anySchema,
    outputSchema: anySchema,
    execute: async ({ inputData }) => {
      const input = (inputData ?? {}) as Record<string, unknown>;
      switch (manifest.execution.type) {
        case 'shell':
          return runShellExecution(manifest, skillDir, input, getConfig);
        case 'script':
          return runScriptExecution(manifest, skillDir, input, getConfig);
        case 'prompt':
          return runPromptExecution(manifest, input);
        case 'http':
          return runHttpExecution(manifest, input);
        default:
          return { error: `Unknown execution type: ${manifest.execution.type}` };
      }
    },
  });

  const workflow = createWorkflow({
    id: getSkillToolName(manifest.name),
    description: manifest.description,
    inputSchema,
    outputSchema,
  })
    .then(executionStep)
    .commit();

  registerSkillWorkflow(workflow);
  return workflow;
}

function buildCompositeWorkflow(
  manifest: SkillManifest,
  inputSchema: z.ZodTypeAny,
  outputSchema: z.ZodTypeAny,
  getConfig: () => LegionConfig,
  allTools: ToolDefinition[],
): AnyWorkflow {
  const compositeSteps = manifest.execution.steps ?? [];
  if (compositeSteps.length === 0) {
    // Empty composite — create a no-op workflow
    const noOp = createStep({
      id: `${manifest.name}-noop`,
      inputSchema: anySchema,
      outputSchema: anySchema,
      execute: async () => ({ error: 'No steps defined in composite skill.' }),
    });
    const wf = createWorkflow({
      id: getSkillToolName(manifest.name),
      description: manifest.description,
      inputSchema,
      outputSchema,
    }).then(noOp).commit();
    registerSkillWorkflow(wf);
    return wf;
  }

  // Create Mastra steps from each composite step definition
  const mastraSteps = compositeSteps.map((stepDef, i) => {
    return createStep({
      id: `${manifest.name}-step-${i}`,
      description: `Step ${i + 1}: ${stepDef.tool}`,
      inputSchema: anySchema,
      outputSchema: anySchema,
      execute: async ({ inputData }) => {
        const prevOutput = (inputData ?? {}) as Record<string, unknown>;
        const tool = findToolByName(allTools, stepDef.tool);
        if (!tool) {
          return { error: `Tool "${stepDef.tool}" not found.` };
        }

        // Merge step args with previous output
        const mergedInput: Record<string, unknown> = { ...prevOutput, ...stepDef.args };

        // Interpolate string values
        const interpolated: Record<string, unknown> = {};
        for (const [key, value] of Object.entries(mergedInput)) {
          if (typeof value === 'string') {
            interpolated[key] = interpolateTemplate(value, prevOutput);
          } else {
            interpolated[key] = value;
          }
        }

        const context: ToolExecutionContext = { toolCallId: `wf-composite-${Date.now()}` };
        const result = await tool.execute(interpolated, context);
        // Ensure we return an object for the next step
        if (result && typeof result === 'object' && !Array.isArray(result)) {
          return result as Record<string, unknown>;
        }
        return { value: result };
      },
    });
  });

  // Chain steps sequentially via .then()
  let wf = createWorkflow({
    id: getSkillToolName(manifest.name),
    description: manifest.description,
    inputSchema,
    outputSchema,
  }) as unknown as WorkflowChain;

  for (const step of mastraSteps) {
    wf = wf.then(step);
  }

  const committed = wf.commit();
  registerSkillWorkflow(committed);
  return committed;
}

/* ── Build a ToolDefinition wrapper around a workflow ── */

export function workflowToToolDefinition(
  manifest: SkillManifest,
  workflow: AnyWorkflow,
): ToolDefinition {
  const inputSchema = manifest.inputSchema
    ? convertJsonSchemaToZod(manifest.inputSchema)
    : z.object({}).passthrough();

  return {
    name: getSkillToolName(manifest.name),
    description: `[Workflow] ${manifest.description}`,
    inputSchema,
    source: 'skill',
    sourceId: manifest.name,
    originalName: manifest.name,
    aliases: [`skill:${manifest.name}`],
    execute: async (input, context) => runToolExecution({
      context,
      run: async () => {
        const typedInput = (input ?? {}) as Record<string, unknown>;
        const run = await workflow.createRun();
        const result = await run.start({ inputData: typedInput });

        if (result.status === 'success') {
          return result.result ?? { status: 'success', steps: result.steps };
        }
        if (result.status === 'failed') {
          const workflowError = 'error' in result
            && result.error
            && typeof result.error === 'object'
            && 'message' in result.error
            && typeof result.error.message === 'string'
            ? result.error.message
            : 'Workflow failed';
          return {
            isError: true,
            error: workflowError,
            status: 'failed',
            steps: result.steps,
          };
        }
        return { status: result.status, steps: result.steps };
      },
    }),
  };
}

/* ── Load all enabled skills as Mastra Workflows ── */

export function loadSkillsAsWorkflows(
  skillsDir: string,
  enabledSkills: string[],
  getConfig: () => LegionConfig,
  allTools?: ToolDefinition[],
): Map<string, AnyWorkflow> {
  const skills = loadSkillsFromDisk(skillsDir);
  const workflows = new Map<string, AnyWorkflow>();

  for (const { manifest, dir } of skills) {
    if (enabledSkills.length > 0 && !enabledSkills.includes(manifest.name)) continue;
    try {
      const wf = skillToWorkflow(manifest, dir, getConfig, allTools);
      workflows.set(manifest.name, wf);
    } catch (err) {
      console.warn(`[SkillLoader] Failed to create workflow for skill ${manifest.name}:`, err);
    }
  }

  console.info(`[SkillLoader] Loaded ${workflows.size} skill workflows from ${skillsDir}`);
  return workflows;
}

/* ── Load all enabled skills as tools (wrapping workflows) ── */

export function loadSkillsAsTools(
  skillsDir: string,
  enabledSkills: string[],
  getConfig: () => LegionConfig,
  allTools?: ToolDefinition[],
): ToolDefinition[] {
  const skills = loadSkillsFromDisk(skillsDir);
  const tools: ToolDefinition[] = [];

  for (const { manifest, dir } of skills) {
    if (enabledSkills.length > 0 && !enabledSkills.includes(manifest.name)) continue;
    try {
      const workflow = skillToWorkflow(manifest, dir, getConfig, allTools);
      tools.push(workflowToToolDefinition(manifest, workflow));
    } catch (err) {
      console.warn(`[SkillLoader] Failed to create tool for skill ${manifest.name}:`, err);
    }
  }

  console.info(`[SkillLoader] Loaded ${tools.length} skill tools from ${skillsDir}`);
  return tools;
}
