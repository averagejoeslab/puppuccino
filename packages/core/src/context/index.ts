/**
 * Context management for project and memory
 */

import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative, basename } from 'node:path';

/**
 * Project context information
 */
export interface ProjectContext {
  path: string;
  name: string;
  gitRoot?: string;
  packageJson?: Record<string, unknown>;
  readme?: string;
  structure: string;
}

/**
 * File info for context
 */
interface FileInfo {
  name: string;
  type: 'file' | 'directory';
  children?: FileInfo[];
}

/**
 * Directories to ignore when building structure
 */
const IGNORED_DIRS = new Set([
  'node_modules',
  '.git',
  '.svn',
  '.hg',
  'dist',
  'build',
  '.next',
  '.nuxt',
  '.turbo',
  'coverage',
  '__pycache__',
  '.pytest_cache',
  'venv',
  '.venv',
]);

/**
 * Build a tree structure of a directory
 */
function buildTree(dir: string, depth: number = 3, current: number = 0): FileInfo[] {
  if (current >= depth) return [];

  try {
    const entries = readdirSync(dir, { withFileTypes: true });
    const result: FileInfo[] = [];

    for (const entry of entries) {
      // Skip hidden and ignored
      if (entry.name.startsWith('.') || IGNORED_DIRS.has(entry.name)) {
        continue;
      }

      if (entry.isDirectory()) {
        result.push({
          name: entry.name,
          type: 'directory',
          children: buildTree(join(dir, entry.name), depth, current + 1),
        });
      } else {
        result.push({
          name: entry.name,
          type: 'file',
        });
      }
    }

    // Sort: directories first, then files
    return result.sort((a, b) => {
      if (a.type === b.type) return a.name.localeCompare(b.name);
      return a.type === 'directory' ? -1 : 1;
    });
  } catch {
    return [];
  }
}

/**
 * Format tree as string
 */
function formatTree(tree: FileInfo[], prefix: string = ''): string {
  const lines: string[] = [];

  for (let i = 0; i < tree.length; i++) {
    const item = tree[i];
    const isLast = i === tree.length - 1;
    const connector = isLast ? '└── ' : '├── ';
    const childPrefix = isLast ? '    ' : '│   ';

    const suffix = item.type === 'directory' ? '/' : '';
    lines.push(`${prefix}${connector}${item.name}${suffix}`);

    if (item.children && item.children.length > 0) {
      lines.push(formatTree(item.children, prefix + childPrefix));
    }
  }

  return lines.join('\n');
}

/**
 * Find git root directory
 */
function findGitRoot(dir: string): string | undefined {
  let current = dir;

  while (current !== '/') {
    if (existsSync(join(current, '.git'))) {
      return current;
    }
    current = join(current, '..');
  }

  return undefined;
}

/**
 * Load project context
 */
export function loadProjectContext(projectPath: string): ProjectContext {
  const name = basename(projectPath);
  const gitRoot = findGitRoot(projectPath);

  // Load package.json if exists
  let packageJson: Record<string, unknown> | undefined;
  const packageJsonPath = join(projectPath, 'package.json');
  if (existsSync(packageJsonPath)) {
    try {
      packageJson = JSON.parse(readFileSync(packageJsonPath, 'utf-8'));
    } catch {
      // Ignore parse errors
    }
  }

  // Load README if exists
  let readme: string | undefined;
  const readmeNames = ['README.md', 'README.txt', 'README', 'readme.md'];
  for (const readmeName of readmeNames) {
    const readmePath = join(projectPath, readmeName);
    if (existsSync(readmePath)) {
      try {
        readme = readFileSync(readmePath, 'utf-8');
        // Limit to first 2000 chars
        if (readme.length > 2000) {
          readme = readme.slice(0, 2000) + '\n...(truncated)';
        }
      } catch {
        // Ignore read errors
      }
      break;
    }
  }

  // Build directory structure
  const tree = buildTree(projectPath);
  const structure = formatTree(tree);

  return {
    path: projectPath,
    name,
    gitRoot,
    packageJson,
    readme,
    structure,
  };
}

/**
 * Format project context as system prompt addition
 */
export function formatProjectContext(context: ProjectContext): string {
  const sections: string[] = [];

  sections.push(`## Project: ${context.name}`);
  sections.push(`Path: ${context.path}`);

  if (context.gitRoot) {
    sections.push(`Git root: ${context.gitRoot}`);
  }

  if (context.packageJson) {
    const pkg = context.packageJson;
    if (pkg.description) {
      sections.push(`\nDescription: ${pkg.description}`);
    }
    if (pkg.scripts) {
      sections.push(`\nAvailable scripts: ${Object.keys(pkg.scripts as object).join(', ')}`);
    }
  }

  sections.push(`\n## Project Structure\n\`\`\`\n${context.structure}\n\`\`\``);

  if (context.readme) {
    sections.push(`\n## README\n${context.readme}`);
  }

  return sections.join('\n');
}

/**
 * Memory entry for conversation context
 */
export interface MemoryEntry {
  type: 'summary' | 'fact' | 'preference';
  content: string;
  timestamp: string;
}

/**
 * Conversation memory
 */
export class Memory {
  private entries: MemoryEntry[] = [];
  private maxEntries = 100;

  /**
   * Add an entry
   */
  add(type: MemoryEntry['type'], content: string): void {
    this.entries.push({
      type,
      content,
      timestamp: new Date().toISOString(),
    });

    // Trim if over limit
    if (this.entries.length > this.maxEntries) {
      this.entries = this.entries.slice(-this.maxEntries);
    }
  }

  /**
   * Get all entries
   */
  all(): MemoryEntry[] {
    return [...this.entries];
  }

  /**
   * Get entries by type
   */
  byType(type: MemoryEntry['type']): MemoryEntry[] {
    return this.entries.filter(e => e.type === type);
  }

  /**
   * Format memory for system prompt
   */
  format(): string {
    if (this.entries.length === 0) return '';

    const sections: string[] = ['## Memory'];

    const facts = this.byType('fact');
    if (facts.length > 0) {
      sections.push('\n### Facts');
      for (const fact of facts) {
        sections.push(`- ${fact.content}`);
      }
    }

    const preferences = this.byType('preference');
    if (preferences.length > 0) {
      sections.push('\n### User Preferences');
      for (const pref of preferences) {
        sections.push(`- ${pref.content}`);
      }
    }

    const summaries = this.byType('summary');
    if (summaries.length > 0) {
      sections.push('\n### Previous Context');
      for (const summary of summaries.slice(-3)) {
        sections.push(`- ${summary.content}`);
      }
    }

    return sections.join('\n');
  }

  /**
   * Clear all entries
   */
  clear(): void {
    this.entries = [];
  }

  /**
   * Export entries
   */
  export(): MemoryEntry[] {
    return [...this.entries];
  }

  /**
   * Import entries
   */
  import(entries: MemoryEntry[]): void {
    this.entries = [...entries];
  }
}

/**
 * Create a memory instance
 */
export function createMemory(): Memory {
  return new Memory();
}
