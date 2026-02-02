/**
 * @puppuccino/sdk - Programmatic SDK for Puppuccino
 *
 * Provides a simple API for integrating Puppuccino into your applications.
 */

import {
  type Config,
  type Message,
  type AgentEvent,
  type Session,
  loadConfig,
  createProviderInstance,
  createToolRegistry,
  createSessionManager,
  createHooksRunner,
  createPermissionChecker,
  runAgentLoop,
  createAgentState,
  DEFAULT_SYSTEM_PROMPT,
} from '@puppuccino/core';

/**
 * Query options
 */
export interface QueryOptions {
  /** Session ID to continue */
  sessionId?: string;
  /** System prompt override */
  systemPrompt?: string;
  /** Maximum turns */
  maxTurns?: number;
  /** Working directory */
  cwd?: string;
  /** Stream events callback */
  onEvent?: (event: AgentEvent) => void;
}

/**
 * Query result
 */
export interface QueryResult {
  /** Text response */
  response: string;
  /** Session ID */
  sessionId: string;
  /** All events */
  events: AgentEvent[];
  /** Updated messages */
  messages: Message[];
}

/**
 * Puppuccino SDK Client
 */
export class PuppuccinoClient {
  private config: Config;
  private provider: ReturnType<typeof createProviderInstance>;
  private tools: ReturnType<typeof createToolRegistry>;
  private sessionManager: ReturnType<typeof createSessionManager>;
  private hooks: ReturnType<typeof createHooksRunner>;
  private permissions: ReturnType<typeof createPermissionChecker>;

  constructor(config?: Partial<Config>) {
    this.config = loadConfig();

    if (config) {
      this.config = { ...this.config, ...config };
    }

    this.provider = createProviderInstance(this.config);
    this.tools = createToolRegistry();
    this.sessionManager = createSessionManager();
    this.hooks = createHooksRunner(this.config.hooks);
    this.permissions = createPermissionChecker(this.config.permissions);
  }

  /**
   * Send a query and get a response
   */
  async query(message: string, options?: QueryOptions): Promise<QueryResult> {
    const { sessionId, systemPrompt, maxTurns, onEvent } = options || {};

    // Get or create session
    let session: Session;
    if (sessionId) {
      const resumed = this.sessionManager.resume(sessionId);
      if (!resumed) {
        throw new Error(`Session not found: ${sessionId}`);
      }
      session = resumed;
    } else if (this.sessionManager.current) {
      session = this.sessionManager.current;
    } else {
      session = this.sessionManager.start({
        projectPath: options?.cwd || process.cwd(),
        model: this.config.model,
      });
    }

    // Add user message
    const userMessage: Message = { role: 'user', content: message };
    this.sessionManager.addMessage(userMessage);

    // Collect response
    const events: AgentEvent[] = [];
    const texts: string[] = [];

    // Create agent state
    const agentState = createAgentState(this.provider, this.tools, {
      messages: session.messages,
      hooks: this.hooks,
      permissions: this.permissions,
      systemPrompt: systemPrompt || this.config.agent?.systemPrompt || DEFAULT_SYSTEM_PROMPT,
      maxTurns: maxTurns || this.config.agent?.maxTurns,
    });

    // Run agent loop
    for await (const event of runAgentLoop(agentState)) {
      events.push(event);

      if (event.type === 'text') {
        texts.push(event.content);
      }

      if (onEvent) {
        onEvent(event);
      }
    }

    // Save session
    this.sessionManager.save();

    return {
      response: texts.join(''),
      sessionId: session.id,
      events,
      messages: session.messages,
    };
  }

  /**
   * Stream a query response
   */
  async *stream(message: string, options?: QueryOptions): AsyncGenerator<AgentEvent> {
    const { sessionId, systemPrompt, maxTurns } = options || {};

    // Get or create session
    let session: Session;
    if (sessionId) {
      const resumed = this.sessionManager.resume(sessionId);
      if (!resumed) {
        throw new Error(`Session not found: ${sessionId}`);
      }
      session = resumed;
    } else if (this.sessionManager.current) {
      session = this.sessionManager.current;
    } else {
      session = this.sessionManager.start({
        projectPath: options?.cwd || process.cwd(),
        model: this.config.model,
      });
    }

    // Add user message
    const userMessage: Message = { role: 'user', content: message };
    this.sessionManager.addMessage(userMessage);

    // Create agent state
    const agentState = createAgentState(this.provider, this.tools, {
      messages: session.messages,
      hooks: this.hooks,
      permissions: this.permissions,
      systemPrompt: systemPrompt || this.config.agent?.systemPrompt || DEFAULT_SYSTEM_PROMPT,
      maxTurns: maxTurns || this.config.agent?.maxTurns,
    });

    // Run and yield events
    for await (const event of runAgentLoop(agentState)) {
      yield event;
    }

    // Save session
    this.sessionManager.save();
  }

  /**
   * Start a new session
   */
  startSession(options?: { name?: string; projectPath?: string }): Session {
    return this.sessionManager.start(options);
  }

  /**
   * Resume an existing session
   */
  resumeSession(sessionId: string): Session | null {
    return this.sessionManager.resume(sessionId);
  }

  /**
   * Resume the most recent session
   */
  resumeRecentSession(): Session | null {
    return this.sessionManager.resumeRecent();
  }

  /**
   * Get current session
   */
  get currentSession(): Session | null {
    return this.sessionManager.current;
  }

  /**
   * Clear current session
   */
  clearSession(): void {
    this.sessionManager.clear();
    this.sessionManager.save();
  }

  /**
   * Get configuration
   */
  get currentConfig(): Config {
    return this.config;
  }

  /**
   * Update configuration
   */
  updateConfig(config: Partial<Config>): void {
    this.config = { ...this.config, ...config };
    this.provider = createProviderInstance(this.config);

    if (config.hooks) {
      this.hooks = createHooksRunner(config.hooks);
    }

    if (config.permissions) {
      this.permissions = createPermissionChecker(config.permissions);
    }
  }
}

/**
 * Simple one-shot query function
 */
export async function query(message: string, options?: QueryOptions & { config?: Partial<Config> }): Promise<string> {
  const client = new PuppuccinoClient(options?.config);
  const result = await client.query(message, options);
  return result.response;
}

/**
 * Create a new client instance
 */
export function createClient(config?: Partial<Config>): PuppuccinoClient {
  return new PuppuccinoClient(config);
}

// Re-export types
export type { Config, Message, AgentEvent, Session } from '@puppuccino/core';
