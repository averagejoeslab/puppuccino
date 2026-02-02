/**
 * @puppuccino/core - Core engine for Puppuccino AI coding agent
 *
 * This package provides the fundamental building blocks for the Puppuccino
 * coding agent, including the agent loop, tools, providers, and more.
 */

// Configuration
export {
  type Config,
  type MCPServer,
  type Hook,
  type Permissions,
  ConfigSchema,
  MCPServerSchema,
  HookSchema,
  PermissionsSchema,
  loadConfig,
  saveConfig,
  getDataDir,
  getSessionsDir,
  getUserConfigPath,
  CONFIG_PATHS,
} from './config/index.js';

// Providers
export {
  type ProviderType,
  type Message,
  type ContentBlock,
  type ToolCall,
  type LLMResponse,
  type ChatOptions,
  type StreamEvent,
  Provider,
  createProvider,
  createProviderInstance,
} from './providers/index.js';

// Tools
export {
  type Tool,
  type ToolResult,
  ToolRegistry,
  createToolRegistry,
  ReadTool,
  WriteTool,
  EditTool,
  GlobTool,
  GrepTool,
  BashTool,
  ListTool,
  BUILTIN_TOOLS,
} from './tools/index.js';

// Agent
export {
  type AgentEvent,
  type AgentState,
  runAgentLoop,
  runAgent,
  createAgentState,
  DEFAULT_SYSTEM_PROMPT,
} from './agent/index.js';

// Hooks
export {
  type HookEvent,
  type HookContext,
  type HookResult,
  HooksRunner,
  createHooksRunner,
} from './hooks/index.js';

// Permissions
export {
  type PermissionResult,
  PermissionChecker,
  createPermissionChecker,
} from './permissions/index.js';

// Session
export {
  type SessionMeta,
  type Session,
  SessionManager,
  createSession,
  saveSession,
  loadSession,
  listSessions,
  deleteSession,
  getRecentSession,
  forkSession,
  appendMessage,
  createSessionManager,
} from './session/index.js';

// MCP
export {
  MCPConnection,
  MCPClient,
  createMCPClient,
} from './mcp/index.js';

// Skills
export {
  type SkillMeta,
  type Skill,
  SkillsLoader,
  createSkillsLoader,
} from './skills/index.js';

// Context
export {
  type ProjectContext,
  type MemoryEntry,
  Memory,
  loadProjectContext,
  formatProjectContext,
  createMemory,
} from './context/index.js';

// Version
export const VERSION = '0.1.0';
