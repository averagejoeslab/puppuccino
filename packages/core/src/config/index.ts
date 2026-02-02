/**
 * Configuration management for Puppuccino
 */

import { z } from 'zod';
import { readFileSync, existsSync, writeFileSync, mkdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { homedir } from 'node:os';

/**
 * MCP Server configuration
 */
export const MCPServerSchema = z.object({
  name: z.string(),
  transport: z.enum(['stdio', 'http', 'sse']),
  command: z.string().optional(),
  args: z.array(z.string()).optional(),
  url: z.string().optional(),
  env: z.record(z.string()).optional(),
  enabled: z.boolean().default(true),
});

export type MCPServer = z.infer<typeof MCPServerSchema>;

/**
 * Hook configuration
 */
export const HookSchema = z.object({
  event: z.enum([
    'SessionStart',
    'UserPromptSubmit',
    'PreToolUse',
    'PostToolUse',
    'Stop',
    'PreCompact',
    'SessionEnd',
  ]),
  matcher: z.string().optional(),
  type: z.enum(['command', 'prompt', 'agent']),
  command: z.string().optional(),
  prompt: z.string().optional(),
  agent: z.string().optional(),
});

export type Hook = z.infer<typeof HookSchema>;

/**
 * Permission configuration
 */
export const PermissionsSchema = z.object({
  allowedTools: z.array(z.string()).optional(),
  disallowedTools: z.array(z.string()).optional(),
  autoApprove: z.array(z.string()).optional(),
  yolo: z.boolean().default(false),
});

export type Permissions = z.infer<typeof PermissionsSchema>;

/**
 * Full configuration schema
 */
export const ConfigSchema = z.object({
  // Provider settings
  provider: z.enum(['anthropic', 'openai', 'groq', 'local']).default('anthropic'),
  model: z.string().default('claude-sonnet-4-20250514'),
  apiKey: z.string().optional(),
  baseUrl: z.string().optional(),

  // MCP servers
  mcpServers: z.record(MCPServerSchema).optional(),

  // Permissions
  permissions: PermissionsSchema.optional(),

  // Hooks
  hooks: z.record(z.array(HookSchema)).optional(),

  // Skills
  skills: z.object({
    enabled: z.array(z.string()).optional(),
    disabled: z.array(z.string()).optional(),
  }).optional(),

  // Session settings
  session: z.object({
    persistHistory: z.boolean().default(true),
    maxHistoryDays: z.number().default(30),
  }).optional(),

  // UI settings
  theme: z.enum(['dark', 'light', 'kaldi']).default('kaldi'),

  // Agent settings
  agent: z.object({
    maxTokens: z.number().default(8192),
    maxTurns: z.number().default(100),
    systemPrompt: z.string().optional(),
  }).optional(),
});

export type Config = z.infer<typeof ConfigSchema>;

/**
 * Configuration file locations
 */
export const CONFIG_PATHS = {
  // Project-level (highest priority)
  project: ['.puppuccino.json', 'puppuccino.json', '.puppuccino/config.json'],
  // User-level
  user: [
    join(homedir(), '.config', 'puppuccino', 'config.json'),
    join(homedir(), '.puppuccino', 'config.json'),
  ],
};

/**
 * Data directory locations
 */
export function getDataDir(): string {
  const platform = process.platform;

  if (process.env.PUPPUCCINO_DATA_DIR) {
    return process.env.PUPPUCCINO_DATA_DIR;
  }

  switch (platform) {
    case 'darwin':
      return join(homedir(), 'Library', 'Application Support', 'puppuccino');
    case 'win32':
      return join(process.env.LOCALAPPDATA || homedir(), 'puppuccino');
    default:
      return join(homedir(), '.local', 'share', 'puppuccino');
  }
}

/**
 * Sessions directory
 */
export function getSessionsDir(): string {
  return join(getDataDir(), 'sessions');
}

/**
 * Load configuration from file
 */
export function loadConfigFile(path: string): Partial<Config> | null {
  if (!existsSync(path)) return null;

  try {
    const content = readFileSync(path, 'utf-8');
    return JSON.parse(content);
  } catch {
    return null;
  }
}

/**
 * Load and merge configuration from all sources
 */
export function loadConfig(projectDir?: string): Config {
  const configs: Partial<Config>[] = [];

  // Load user config (lowest priority)
  for (const path of CONFIG_PATHS.user) {
    const config = loadConfigFile(path);
    if (config) {
      configs.push(config);
      break;
    }
  }

  // Load project config (highest priority)
  if (projectDir) {
    for (const filename of CONFIG_PATHS.project) {
      const path = join(projectDir, filename);
      const config = loadConfigFile(path);
      if (config) {
        configs.push(config);
        break;
      }
    }
  }

  // Load environment variables
  const envConfig: Partial<Config> = {};
  if (process.env.ANTHROPIC_API_KEY) {
    envConfig.provider = 'anthropic';
    envConfig.apiKey = process.env.ANTHROPIC_API_KEY;
  } else if (process.env.OPENAI_API_KEY) {
    envConfig.provider = 'openai';
    envConfig.apiKey = process.env.OPENAI_API_KEY;
  }
  if (process.env.PUPPUCCINO_MODEL) {
    envConfig.model = process.env.PUPPUCCINO_MODEL;
  }
  configs.push(envConfig);

  // Merge all configs
  const merged = configs.reduce((acc, cfg) => ({ ...acc, ...cfg }), {});

  // Validate and return with defaults
  return ConfigSchema.parse(merged);
}

/**
 * Save configuration to file
 */
export function saveConfig(config: Partial<Config>, path: string): void {
  const dir = dirname(path);
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true });
  }
  writeFileSync(path, JSON.stringify(config, null, 2));
}

/**
 * Get default user config path
 */
export function getUserConfigPath(): string {
  return CONFIG_PATHS.user[0];
}
