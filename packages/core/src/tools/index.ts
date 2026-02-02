/**
 * Tool definitions and registry for Puppuccino
 */

import { z, ZodType } from 'zod';
import { readFileSync, writeFileSync, existsSync, mkdirSync, readdirSync, statSync } from 'node:fs';
import { join, dirname, relative, resolve } from 'node:path';
import { execSync, spawn } from 'node:child_process';
import { glob } from './glob.js';

/**
 * Tool definition
 */
export interface Tool {
  name: string;
  description: string;
  parameters: ZodType;
  execute: (input: Record<string, unknown>) => Promise<string>;
}

/**
 * Tool result
 */
export interface ToolResult {
  success: boolean;
  output: string;
  error?: string;
}

/**
 * Read tool - Read file contents
 */
export const ReadTool: Tool = {
  name: 'read',
  description: 'Read the contents of a file. Returns the file contents with line numbers.',
  parameters: z.object({
    path: z.string().describe('The file path to read'),
    offset: z.number().optional().describe('Line number to start reading from (1-based)'),
    limit: z.number().optional().describe('Maximum number of lines to read'),
  }),
  async execute(input) {
    const { path, offset = 1, limit } = input as { path: string; offset?: number; limit?: number };

    if (!existsSync(path)) {
      return `Error: File not found: ${path}`;
    }

    try {
      const content = readFileSync(path, 'utf-8');
      const lines = content.split('\n');

      const startIdx = Math.max(0, offset - 1);
      const endIdx = limit ? startIdx + limit : lines.length;
      const selectedLines = lines.slice(startIdx, endIdx);

      // Format with line numbers
      const formatted = selectedLines.map((line, i) => {
        const lineNum = startIdx + i + 1;
        const padding = String(lines.length).length;
        return `${String(lineNum).padStart(padding)}│${line}`;
      }).join('\n');

      return formatted;
    } catch (err) {
      return `Error reading file: ${err instanceof Error ? err.message : String(err)}`;
    }
  },
};

/**
 * Write tool - Write content to a file
 */
export const WriteTool: Tool = {
  name: 'write',
  description: 'Write content to a file. Creates the file and parent directories if they don\'t exist.',
  parameters: z.object({
    path: z.string().describe('The file path to write to'),
    content: z.string().describe('The content to write'),
  }),
  async execute(input) {
    const { path, content } = input as { path: string; content: string };

    try {
      const dir = dirname(path);
      if (!existsSync(dir)) {
        mkdirSync(dir, { recursive: true });
      }

      writeFileSync(path, content, 'utf-8');
      return `Successfully wrote ${content.length} bytes to ${path}`;
    } catch (err) {
      return `Error writing file: ${err instanceof Error ? err.message : String(err)}`;
    }
  },
};

/**
 * Edit tool - Replace text in a file
 */
export const EditTool: Tool = {
  name: 'edit',
  description: 'Replace text in a file. The old_string must be unique in the file unless replace_all is true.',
  parameters: z.object({
    path: z.string().describe('The file path to edit'),
    old_string: z.string().describe('The text to find and replace'),
    new_string: z.string().describe('The replacement text'),
    replace_all: z.boolean().optional().describe('Replace all occurrences (default: false)'),
  }),
  async execute(input) {
    const { path, old_string, new_string, replace_all = false } = input as {
      path: string;
      old_string: string;
      new_string: string;
      replace_all?: boolean;
    };

    if (!existsSync(path)) {
      return `Error: File not found: ${path}`;
    }

    try {
      const content = readFileSync(path, 'utf-8');

      // Count occurrences
      const count = content.split(old_string).length - 1;

      if (count === 0) {
        return `Error: old_string not found in file`;
      }

      if (count > 1 && !replace_all) {
        return `Error: old_string found ${count} times. Use replace_all=true to replace all, or provide a more specific string.`;
      }

      const newContent = replace_all
        ? content.split(old_string).join(new_string)
        : content.replace(old_string, new_string);

      writeFileSync(path, newContent, 'utf-8');

      const replacements = replace_all ? count : 1;
      return `Successfully replaced ${replacements} occurrence(s) in ${path}`;
    } catch (err) {
      return `Error editing file: ${err instanceof Error ? err.message : String(err)}`;
    }
  },
};

/**
 * Glob tool - Find files by pattern
 */
export const GlobTool: Tool = {
  name: 'glob',
  description: 'Find files matching a glob pattern. Returns a list of matching file paths.',
  parameters: z.object({
    pattern: z.string().describe('The glob pattern (e.g., "**/*.ts", "src/**/*.js")'),
    path: z.string().optional().describe('The directory to search in (default: current directory)'),
  }),
  async execute(input) {
    const { pattern, path: basePath = '.' } = input as { pattern: string; path?: string };

    try {
      const files = await glob(pattern, basePath);

      if (files.length === 0) {
        return 'No files matched the pattern';
      }

      // Limit results
      const maxResults = 100;
      const limited = files.slice(0, maxResults);
      const result = limited.join('\n');

      if (files.length > maxResults) {
        return `${result}\n\n... and ${files.length - maxResults} more files`;
      }

      return result;
    } catch (err) {
      return `Error searching files: ${err instanceof Error ? err.message : String(err)}`;
    }
  },
};

/**
 * Grep tool - Search file contents
 */
export const GrepTool: Tool = {
  name: 'grep',
  description: 'Search for a pattern in files. Returns matching lines with file paths and line numbers.',
  parameters: z.object({
    pattern: z.string().describe('The regex pattern to search for'),
    path: z.string().optional().describe('The directory to search in (default: current directory)'),
    glob: z.string().optional().describe('File pattern to filter (e.g., "*.ts")'),
  }),
  async execute(input) {
    const { pattern, path: basePath = '.', glob: fileGlob } = input as {
      pattern: string;
      path?: string;
      glob?: string;
    };

    try {
      const regex = new RegExp(pattern, 'gi');
      const results: string[] = [];
      const maxResults = 50;

      // Find files to search
      const searchGlob = fileGlob || '**/*';
      const files = await glob(searchGlob, basePath);

      outer: for (const file of files) {
        const fullPath = resolve(basePath, file);

        // Skip directories and binary files
        try {
          const stat = statSync(fullPath);
          if (stat.isDirectory()) continue;
          if (stat.size > 1024 * 1024) continue; // Skip files > 1MB
        } catch {
          continue;
        }

        try {
          const content = readFileSync(fullPath, 'utf-8');
          const lines = content.split('\n');

          for (let i = 0; i < lines.length; i++) {
            if (regex.test(lines[i])) {
              results.push(`${file}:${i + 1}: ${lines[i].trim()}`);
              regex.lastIndex = 0; // Reset regex state

              if (results.length >= maxResults) break outer;
            }
          }
        } catch {
          // Skip files that can't be read as text
          continue;
        }
      }

      if (results.length === 0) {
        return 'No matches found';
      }

      return results.join('\n');
    } catch (err) {
      return `Error searching: ${err instanceof Error ? err.message : String(err)}`;
    }
  },
};

/**
 * Bash tool - Execute shell commands
 */
export const BashTool: Tool = {
  name: 'bash',
  description: 'Execute a shell command and return the output.',
  parameters: z.object({
    command: z.string().describe('The command to execute'),
    timeout: z.number().optional().describe('Timeout in milliseconds (default: 30000)'),
  }),
  async execute(input) {
    const { command, timeout = 30000 } = input as { command: string; timeout?: number };

    return new Promise((resolve) => {
      try {
        const result = execSync(command, {
          encoding: 'utf-8',
          timeout,
          maxBuffer: 10 * 1024 * 1024, // 10MB
          stdio: ['pipe', 'pipe', 'pipe'],
        });

        resolve(result || '(no output)');
      } catch (err: unknown) {
        const error = err as { stdout?: string; stderr?: string; message?: string };
        if (error.stdout || error.stderr) {
          resolve(`${error.stdout || ''}${error.stderr || ''}`);
        } else {
          resolve(`Error: ${error.message || String(err)}`);
        }
      }
    });
  },
};

/**
 * List tool - List directory contents
 */
export const ListTool: Tool = {
  name: 'ls',
  description: 'List the contents of a directory.',
  parameters: z.object({
    path: z.string().optional().describe('The directory path (default: current directory)'),
    all: z.boolean().optional().describe('Include hidden files (default: false)'),
  }),
  async execute(input) {
    const { path: dirPath = '.', all = false } = input as { path?: string; all?: boolean };

    try {
      if (!existsSync(dirPath)) {
        return `Error: Directory not found: ${dirPath}`;
      }

      const entries = readdirSync(dirPath, { withFileTypes: true });
      const filtered = all ? entries : entries.filter(e => !e.name.startsWith('.'));

      const formatted = filtered.map(entry => {
        const suffix = entry.isDirectory() ? '/' : '';
        return `${entry.name}${suffix}`;
      });

      return formatted.sort().join('\n');
    } catch (err) {
      return `Error listing directory: ${err instanceof Error ? err.message : String(err)}`;
    }
  },
};

/**
 * All built-in tools
 */
export const BUILTIN_TOOLS: Tool[] = [
  ReadTool,
  WriteTool,
  EditTool,
  GlobTool,
  GrepTool,
  BashTool,
  ListTool,
];

/**
 * Tool registry
 */
export class ToolRegistry {
  private tools: Map<string, Tool> = new Map();

  constructor() {
    // Register built-in tools
    for (const tool of BUILTIN_TOOLS) {
      this.register(tool);
    }
  }

  /**
   * Register a tool
   */
  register(tool: Tool): void {
    this.tools.set(tool.name, tool);
  }

  /**
   * Unregister a tool
   */
  unregister(name: string): void {
    this.tools.delete(name);
  }

  /**
   * Get a tool by name
   */
  get(name: string): Tool | undefined {
    return this.tools.get(name);
  }

  /**
   * Get all registered tools
   */
  all(): Tool[] {
    return Array.from(this.tools.values());
  }

  /**
   * Check if a tool exists
   */
  has(name: string): boolean {
    return this.tools.has(name);
  }

  /**
   * Execute a tool
   */
  async execute(name: string, input: Record<string, unknown>): Promise<ToolResult> {
    const tool = this.get(name);

    if (!tool) {
      return {
        success: false,
        output: '',
        error: `Unknown tool: ${name}`,
      };
    }

    try {
      // Validate input
      const validated = tool.parameters.parse(input);
      const output = await tool.execute(validated);

      return {
        success: true,
        output,
      };
    } catch (err) {
      return {
        success: false,
        output: '',
        error: err instanceof Error ? err.message : String(err),
      };
    }
  }
}

/**
 * Create a tool registry instance
 */
export function createToolRegistry(): ToolRegistry {
  return new ToolRegistry();
}
