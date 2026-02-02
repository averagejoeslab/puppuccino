/**
 * Agent loop - the core agentic execution engine
 */

import type { Provider, LLMResponse, Message, ToolCall } from '../providers/index.js';
import type { ToolRegistry, Tool, ToolResult } from '../tools/index.js';
import type { HooksRunner, HookContext } from '../hooks/index.js';
import type { PermissionChecker } from '../permissions/index.js';

/**
 * Agent event types
 */
export type AgentEvent =
  | { type: 'thinking' }
  | { type: 'text'; content: string }
  | { type: 'text_delta'; delta: string }
  | { type: 'tool_start'; name: string; input: Record<string, unknown> }
  | { type: 'tool_result'; name: string; result: ToolResult }
  | { type: 'tool_denied'; name: string; reason: string }
  | { type: 'error'; error: string }
  | { type: 'done'; response: LLMResponse };

/**
 * Agent state
 */
export interface AgentState {
  messages: Message[];
  provider: Provider;
  tools: ToolRegistry;
  hooks?: HooksRunner;
  permissions?: PermissionChecker;
  systemPrompt?: string;
  maxTurns?: number;
  onPermissionRequest?: (toolName: string, input: Record<string, unknown>) => Promise<boolean>;
}

/**
 * Default system prompt
 */
export const DEFAULT_SYSTEM_PROMPT = `You are Kaldi, a helpful AI coding assistant. You're a Great Pyrenees who loves helping developers write great code.

You have access to tools to read, write, and edit files, search the codebase, and execute commands. Use these tools to help the user with their coding tasks.

When making changes:
- Read files before editing them to understand the context
- Make minimal, focused changes
- Explain what you're doing and why
- Be careful with destructive operations

Be friendly, helpful, and thorough in your responses.`;

/**
 * Run the agent loop
 */
export async function* runAgentLoop(state: AgentState): AsyncGenerator<AgentEvent> {
  const {
    messages,
    provider,
    tools,
    hooks,
    permissions,
    systemPrompt = DEFAULT_SYSTEM_PROMPT,
    maxTurns = 100,
    onPermissionRequest,
  } = state;

  let turns = 0;

  while (turns < maxTurns) {
    turns++;

    // Emit thinking event
    yield { type: 'thinking' };

    // Run pre-turn hook
    if (hooks) {
      const hookResult = await hooks.run('PreToolUse', {
        messages,
        turn: turns,
      });

      if (hookResult.blocked) {
        yield { type: 'error', error: hookResult.reason || 'Blocked by hook' };
        return;
      }
    }

    // Call the LLM
    let response: LLMResponse;
    try {
      response = await provider.chat({
        model: provider.model,
        messages,
        tools: tools.all(),
        systemPrompt,
      });
    } catch (err) {
      yield { type: 'error', error: err instanceof Error ? err.message : String(err) };
      return;
    }

    // Emit text content
    if (response.text) {
      yield { type: 'text', content: response.text };
    }

    // Check if we're done (no tool calls)
    if (response.toolCalls.length === 0) {
      yield { type: 'done', response };
      return;
    }

    // Process tool calls
    const toolResults: Array<{ tool_use_id: string; content: string }> = [];

    for (const toolCall of response.toolCalls) {
      // Emit tool start event
      yield {
        type: 'tool_start',
        name: toolCall.name,
        input: toolCall.input,
      };

      // Check permissions
      if (permissions) {
        const allowed = await permissions.check(toolCall.name, toolCall.input);

        if (!allowed.permitted) {
          // Ask user for permission if callback provided
          if (onPermissionRequest) {
            const granted = await onPermissionRequest(toolCall.name, toolCall.input);

            if (!granted) {
              yield {
                type: 'tool_denied',
                name: toolCall.name,
                reason: 'Permission denied by user',
              };

              toolResults.push({
                tool_use_id: toolCall.id,
                content: 'Permission denied by user',
              });

              continue;
            }
          } else {
            yield {
              type: 'tool_denied',
              name: toolCall.name,
              reason: allowed.reason || 'Permission denied',
            };

            toolResults.push({
              tool_use_id: toolCall.id,
              content: allowed.reason || 'Permission denied',
            });

            continue;
          }
        }
      }

      // Execute the tool
      const result = await tools.execute(toolCall.name, toolCall.input);

      yield {
        type: 'tool_result',
        name: toolCall.name,
        result,
      };

      // Run post-tool hook
      if (hooks) {
        await hooks.run('PostToolUse', {
          tool: toolCall.name,
          input: toolCall.input,
          result,
        });
      }

      toolResults.push({
        tool_use_id: toolCall.id,
        content: result.success ? result.output : `Error: ${result.error}`,
      });
    }

    // Add assistant response and tool results to messages
    messages.push({
      role: 'assistant',
      content: [
        ...(response.text ? [{ type: 'text' as const, text: response.text }] : []),
        ...response.toolCalls.map(tc => ({
          type: 'tool_use' as const,
          id: tc.id,
          name: tc.name,
          input: tc.input,
        })),
      ],
    });

    messages.push({
      role: 'user',
      content: toolResults.map(tr => ({
        type: 'tool_result' as const,
        tool_use_id: tr.tool_use_id,
        content: tr.content,
      })),
    });
  }

  // Max turns reached
  yield { type: 'error', error: `Max turns (${maxTurns}) reached` };
}

/**
 * Simple synchronous agent run (collects all events)
 */
export async function runAgent(state: AgentState): Promise<{
  events: AgentEvent[];
  messages: Message[];
}> {
  const events: AgentEvent[] = [];

  for await (const event of runAgentLoop(state)) {
    events.push(event);
  }

  return {
    events,
    messages: state.messages,
  };
}

/**
 * Create an agent state
 */
export function createAgentState(
  provider: Provider,
  tools: ToolRegistry,
  options?: Partial<Omit<AgentState, 'provider' | 'tools' | 'messages'>>
): AgentState {
  return {
    messages: [],
    provider,
    tools,
    ...options,
  };
}
