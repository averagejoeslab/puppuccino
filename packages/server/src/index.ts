/**
 * @puppuccino/server - HTTP server for Puppuccino
 *
 * Provides REST and SSE endpoints for interacting with the agent.
 */

import { Hono } from 'hono';
import { cors } from 'hono/cors';
import { logger } from 'hono/logger';
import { streamSSE } from 'hono/streaming';
import { zValidator } from '@hono/zod-validator';
import { z } from 'zod';

import {
  type Config,
  type Message,
  type AgentEvent,
  loadConfig,
  createProviderInstance,
  createToolRegistry,
  createSessionManager,
  createHooksRunner,
  createPermissionChecker,
  runAgentLoop,
  listSessions,
  loadSession,
  deleteSession,
} from '@puppuccino/core';

/**
 * Server state
 */
interface ServerState {
  config: Config;
  sessionManager: ReturnType<typeof createSessionManager>;
  toolRegistry: ReturnType<typeof createToolRegistry>;
  provider: ReturnType<typeof createProviderInstance>;
  hooks: ReturnType<typeof createHooksRunner>;
  permissions: ReturnType<typeof createPermissionChecker>;
}

/**
 * Create the Puppuccino server
 */
export function createServer(config?: Config): Hono {
  const app = new Hono();

  // Load configuration
  const serverConfig = config || loadConfig();

  // Initialize state
  const state: ServerState = {
    config: serverConfig,
    sessionManager: createSessionManager(),
    toolRegistry: createToolRegistry(),
    provider: createProviderInstance(serverConfig),
    hooks: createHooksRunner(serverConfig.hooks),
    permissions: createPermissionChecker(serverConfig.permissions),
  };

  // Middleware
  app.use('*', cors());
  app.use('*', logger());

  // Health check
  app.get('/health', (c) => {
    return c.json({
      status: 'ok',
      version: '0.1.0',
      provider: state.config.provider,
      model: state.config.model,
    });
  });

  // Chat endpoint - send a message and get streaming response
  app.post(
    '/chat',
    zValidator(
      'json',
      z.object({
        message: z.string(),
        sessionId: z.string().optional(),
      })
    ),
    async (c) => {
      const { message, sessionId } = c.req.valid('json');

      // Get or create session
      let session = sessionId
        ? state.sessionManager.resume(sessionId)
        : state.sessionManager.current;

      if (!session) {
        session = state.sessionManager.start({
          projectPath: process.cwd(),
          model: state.config.model,
        });
      }

      // Add user message
      const userMessage: Message = { role: 'user', content: message };
      state.sessionManager.addMessage(userMessage);

      // Run agent and stream response
      return streamSSE(c, async (stream) => {
        const agentState = {
          messages: session!.messages,
          provider: state.provider,
          tools: state.toolRegistry,
          hooks: state.hooks,
          permissions: state.permissions,
          systemPrompt: state.config.agent?.systemPrompt,
          maxTurns: state.config.agent?.maxTurns,
        };

        for await (const event of runAgentLoop(agentState)) {
          await stream.writeSSE({
            event: event.type,
            data: JSON.stringify(event),
          });
        }

        // Save session
        state.sessionManager.save();

        await stream.writeSSE({
          event: 'end',
          data: JSON.stringify({ sessionId: session!.id }),
        });
      });
    }
  );

  // One-shot query endpoint (non-streaming)
  app.post(
    '/query',
    zValidator(
      'json',
      z.object({
        message: z.string(),
        sessionId: z.string().optional(),
      })
    ),
    async (c) => {
      const { message, sessionId } = c.req.valid('json');

      // Get or create session
      let session = sessionId
        ? state.sessionManager.resume(sessionId)
        : state.sessionManager.current;

      if (!session) {
        session = state.sessionManager.start({
          projectPath: process.cwd(),
          model: state.config.model,
        });
      }

      // Add user message
      const userMessage: Message = { role: 'user', content: message };
      state.sessionManager.addMessage(userMessage);

      // Collect events
      const events: AgentEvent[] = [];
      const texts: string[] = [];

      const agentState = {
        messages: session.messages,
        provider: state.provider,
        tools: state.toolRegistry,
        hooks: state.hooks,
        permissions: state.permissions,
        systemPrompt: state.config.agent?.systemPrompt,
        maxTurns: state.config.agent?.maxTurns,
      };

      for await (const event of runAgentLoop(agentState)) {
        events.push(event);

        if (event.type === 'text') {
          texts.push(event.content);
        }
      }

      // Save session
      state.sessionManager.save();

      return c.json({
        sessionId: session.id,
        response: texts.join(''),
        events,
      });
    }
  );

  // Sessions endpoints
  app.get('/sessions', (c) => {
    const sessions = listSessions();
    return c.json({ sessions });
  });

  app.get('/sessions/:id', (c) => {
    const session = loadSession(c.req.param('id'));

    if (!session) {
      return c.json({ error: 'Session not found' }, 404);
    }

    return c.json({ session });
  });

  app.delete('/sessions/:id', (c) => {
    const deleted = deleteSession(c.req.param('id'));

    if (!deleted) {
      return c.json({ error: 'Session not found' }, 404);
    }

    return c.json({ success: true });
  });

  app.post('/sessions/:id/clear', (c) => {
    const session = state.sessionManager.resume(c.req.param('id'));

    if (!session) {
      return c.json({ error: 'Session not found' }, 404);
    }

    state.sessionManager.clear();
    state.sessionManager.save();

    return c.json({ success: true });
  });

  // Tools endpoint
  app.get('/tools', (c) => {
    const tools = state.toolRegistry.all().map((t) => ({
      name: t.name,
      description: t.description,
    }));

    return c.json({ tools });
  });

  // Execute tool directly
  app.post(
    '/tools/:name',
    zValidator('json', z.record(z.unknown())),
    async (c) => {
      const name = c.req.param('name');
      const input = c.req.valid('json');

      const result = await state.toolRegistry.execute(name, input);

      return c.json(result);
    }
  );

  // Config endpoint
  app.get('/config', (c) => {
    // Don't expose API keys
    const safeConfig = {
      provider: state.config.provider,
      model: state.config.model,
      theme: state.config.theme,
    };

    return c.json(safeConfig);
  });

  return app;
}

/**
 * Start the server
 */
export function startServer(options?: { port?: number; config?: Config }): void {
  const port = options?.port || parseInt(process.env.PORT || '3000', 10);
  const app = createServer(options?.config);

  console.log(`🐕 Puppuccino server starting on port ${port}`);

  Bun.serve({
    port,
    fetch: app.fetch,
  });
}

// Export types
export type { ServerState };

// Re-export Hono for custom extensions
export { Hono };
