/**
 * Hooks system for lifecycle events
 */

import { execSync } from 'node:child_process';
import type { Hook } from '../config/index.js';

/**
 * Hook events
 */
export type HookEvent =
  | 'SessionStart'
  | 'UserPromptSubmit'
  | 'PreToolUse'
  | 'PostToolUse'
  | 'Stop'
  | 'PreCompact'
  | 'SessionEnd';

/**
 * Hook context passed to hooks
 */
export interface HookContext {
  event: HookEvent;
  [key: string]: unknown;
}

/**
 * Hook result
 */
export interface HookResult {
  blocked: boolean;
  reason?: string;
  output?: string;
}

/**
 * Run a command hook
 */
async function runCommandHook(command: string, context: HookContext): Promise<HookResult> {
  try {
    const input = JSON.stringify(context);
    const output = execSync(command, {
      encoding: 'utf-8',
      input,
      timeout: 30000,
      stdio: ['pipe', 'pipe', 'pipe'],
    });

    // Parse output as JSON if possible
    try {
      const result = JSON.parse(output);
      return {
        blocked: result.blocked === true,
        reason: result.reason,
        output: result.output || output,
      };
    } catch {
      return {
        blocked: false,
        output,
      };
    }
  } catch (err: unknown) {
    const error = err as { status?: number; message?: string };

    // Exit code 2 means blocking error
    if (error.status === 2) {
      return {
        blocked: true,
        reason: error.message || 'Hook blocked execution',
      };
    }

    // Other errors are non-blocking
    return {
      blocked: false,
      output: error.message || String(err),
    };
  }
}

/**
 * Run a prompt hook (single-turn LLM evaluation)
 */
async function runPromptHook(prompt: string, context: HookContext): Promise<HookResult> {
  // Prompt hooks would call an LLM to evaluate
  // For now, just return non-blocking
  return {
    blocked: false,
    output: `Prompt hook: ${prompt}`,
  };
}

/**
 * Hooks runner
 */
export class HooksRunner {
  private hooks: Map<HookEvent, Hook[]> = new Map();

  constructor(hooks?: Record<string, Hook[]>) {
    if (hooks) {
      for (const [event, eventHooks] of Object.entries(hooks)) {
        this.hooks.set(event as HookEvent, eventHooks);
      }
    }
  }

  /**
   * Add a hook
   */
  add(event: HookEvent, hook: Hook): void {
    const existing = this.hooks.get(event) || [];
    existing.push(hook);
    this.hooks.set(event, existing);
  }

  /**
   * Remove all hooks for an event
   */
  clear(event: HookEvent): void {
    this.hooks.delete(event);
  }

  /**
   * Run all hooks for an event
   */
  async run(event: HookEvent, context: Partial<HookContext> = {}): Promise<HookResult> {
    const hooks = this.hooks.get(event) || [];
    const fullContext: HookContext = { event, ...context };

    for (const hook of hooks) {
      // Check matcher for tool-specific hooks
      if (hook.matcher && context.tool) {
        const pattern = new RegExp(hook.matcher);
        if (!pattern.test(context.tool as string)) {
          continue;
        }
      }

      let result: HookResult;

      switch (hook.type) {
        case 'command':
          if (hook.command) {
            result = await runCommandHook(hook.command, fullContext);
          } else {
            result = { blocked: false };
          }
          break;

        case 'prompt':
          if (hook.prompt) {
            result = await runPromptHook(hook.prompt, fullContext);
          } else {
            result = { blocked: false };
          }
          break;

        case 'agent':
          // Agent hooks would spawn a subagent
          result = { blocked: false };
          break;

        default:
          result = { blocked: false };
      }

      // Stop on blocking result
      if (result.blocked) {
        return result;
      }
    }

    return { blocked: false };
  }

  /**
   * Get all hooks for an event
   */
  get(event: HookEvent): Hook[] {
    return this.hooks.get(event) || [];
  }
}

/**
 * Create a hooks runner
 */
export function createHooksRunner(hooks?: Record<string, Hook[]>): HooksRunner {
  return new HooksRunner(hooks);
}
