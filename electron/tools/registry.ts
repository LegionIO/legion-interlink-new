import type { ToolDefinition } from './types.js';
import type { LegionConfig } from '../config/schema.js';
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
} from './config-manage.js';
import { createModelSwitchTool } from './model-switch.js';
import { createSubAgentTool } from './sub-agent.js';
import { loadSkillsAsTools } from './skill-loader.js';
import { createSkillManageTool } from './skill-manage.js';

export async function buildToolRegistry(getConfig: () => LegionConfig, legionHome?: string): Promise<ToolDefinition[]> {
  let config: LegionConfig;
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

  // File tools
  if (config?.tools?.fileAccess?.enabled !== false) {
    tools.push(createFileReadTool());
    tools.push(createFileWriteTool());
    tools.push(createFileEditTool());
    tools.push(createGrepTool(getConfig));
    tools.push(createGlobTool(getConfig));
    tools.push(createListDirectoryTool());
  }

  // Self-management tools (always available)
  if (legionHome) {
    tools.push(createMcpManageTool(legionHome));
    tools.push(createMemorySettingsTool(legionHome));
    tools.push(createCompactionSettingsTool(legionHome));
    tools.push(createToolSettingsTool(legionHome));
    tools.push(createAdvancedSettingsTool(legionHome));
    tools.push(createSystemPromptTool(legionHome));
    tools.push(createAudioSettingsTool(legionHome));
    tools.push(createModelSwitchTool(legionHome));
  }

  // Sub-agent tool
  if (config?.tools?.subAgents?.enabled !== false && legionHome) {
    tools.push(createSubAgentTool(getConfig, legionHome, 0, tools));
  }

  // Skill management tool (always available)
  if (legionHome) {
    tools.push(createSkillManageTool(legionHome));
  }

  // Skill tools
  if (legionHome) {
    const skillsDir = config.skills?.directory || (legionHome + '/skills');
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
