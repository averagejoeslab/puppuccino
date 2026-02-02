/**
 * Permission system for tool execution
 */

import type { Permissions } from '../config/index.js';

/**
 * Permission check result
 */
export interface PermissionResult {
  permitted: boolean;
  reason?: string;
  requiresConfirmation?: boolean;
}

/**
 * Pattern matcher for tool permissions
 */
function matchPattern(pattern: string, toolName: string, input: Record<string, unknown>): boolean {
  // Simple pattern: just tool name
  if (!pattern.includes('(')) {
    return pattern === toolName || pattern === '*';
  }

  // Pattern with argument constraint: ToolName(argPattern)
  const match = pattern.match(/^(\w+)\((.*)\)$/);
  if (!match) return false;

  const [, name, argPattern] = match;

  if (name !== toolName && name !== '*') {
    return false;
  }

  // Check if any argument value matches the pattern
  const argRegex = new RegExp(argPattern);

  for (const value of Object.values(input)) {
    if (typeof value === 'string' && argRegex.test(value)) {
      return true;
    }
  }

  return false;
}

/**
 * Permission checker
 */
export class PermissionChecker {
  private config: Permissions;

  constructor(config?: Permissions) {
    this.config = config || {};
  }

  /**
   * Check if a tool execution is permitted
   */
  async check(toolName: string, input: Record<string, unknown>): Promise<PermissionResult> {
    // YOLO mode - everything permitted
    if (this.config.yolo) {
      return { permitted: true };
    }

    // Check disallowed tools first
    if (this.config.disallowedTools) {
      for (const pattern of this.config.disallowedTools) {
        if (matchPattern(pattern, toolName, input)) {
          return {
            permitted: false,
            reason: `Tool ${toolName} is disallowed by pattern: ${pattern}`,
          };
        }
      }
    }

    // Check auto-approve patterns
    if (this.config.autoApprove) {
      for (const pattern of this.config.autoApprove) {
        if (matchPattern(pattern, toolName, input)) {
          return { permitted: true };
        }
      }
    }

    // Check allowed tools
    if (this.config.allowedTools && this.config.allowedTools.length > 0) {
      for (const pattern of this.config.allowedTools) {
        if (matchPattern(pattern, toolName, input)) {
          return { permitted: true };
        }
      }

      // If allowed list exists but tool not in it, deny
      return {
        permitted: false,
        reason: `Tool ${toolName} is not in allowed list`,
        requiresConfirmation: true,
      };
    }

    // Default: require confirmation for potentially dangerous tools
    const dangerousTools = ['bash', 'write', 'edit'];
    if (dangerousTools.includes(toolName)) {
      return {
        permitted: false,
        reason: `Tool ${toolName} requires confirmation`,
        requiresConfirmation: true,
      };
    }

    // Safe tools are permitted
    return { permitted: true };
  }

  /**
   * Update configuration
   */
  updateConfig(config: Partial<Permissions>): void {
    this.config = { ...this.config, ...config };
  }

  /**
   * Enable YOLO mode
   */
  enableYolo(): void {
    this.config.yolo = true;
  }

  /**
   * Disable YOLO mode
   */
  disableYolo(): void {
    this.config.yolo = false;
  }

  /**
   * Add an auto-approve pattern
   */
  addAutoApprove(pattern: string): void {
    if (!this.config.autoApprove) {
      this.config.autoApprove = [];
    }
    this.config.autoApprove.push(pattern);
  }
}

/**
 * Create a permission checker
 */
export function createPermissionChecker(config?: Permissions): PermissionChecker {
  return new PermissionChecker(config);
}
