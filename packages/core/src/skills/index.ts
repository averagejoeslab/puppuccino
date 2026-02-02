/**
 * Skills system for reusable prompts and capabilities
 */

import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { homedir } from 'node:os';

/**
 * Skill metadata from YAML frontmatter
 */
export interface SkillMeta {
  name: string;
  description?: string;
  disableModelInvocation?: boolean;
  userInvocable?: boolean;
  allowedTools?: string[];
  model?: string;
  context?: 'fork' | 'inline';
  agent?: string;
}

/**
 * Full skill definition
 */
export interface Skill extends SkillMeta {
  content: string;
  path: string;
}

/**
 * Skill locations (priority order, highest first)
 */
const SKILL_LOCATIONS = [
  // Personal skills
  join(homedir(), '.puppuccino', 'skills'),
  join(homedir(), '.config', 'puppuccino', 'skills'),
  // Project skills (will be prefixed with project path)
  '.puppuccino/skills',
];

/**
 * Parse YAML frontmatter from skill file
 */
function parseFrontmatter(content: string): { meta: Partial<SkillMeta>; content: string } {
  const frontmatterRegex = /^---\n([\s\S]*?)\n---\n([\s\S]*)$/;
  const match = content.match(frontmatterRegex);

  if (!match) {
    return { meta: {}, content };
  }

  const [, yaml, rest] = match;
  const meta: Partial<SkillMeta> = {};

  // Simple YAML parsing (key: value)
  for (const line of yaml.split('\n')) {
    const colonIdx = line.indexOf(':');
    if (colonIdx === -1) continue;

    const key = line.slice(0, colonIdx).trim();
    let value: string | boolean | string[] = line.slice(colonIdx + 1).trim();

    // Handle boolean values
    if (value === 'true') value = true;
    else if (value === 'false') value = false;

    // Handle arrays (simple format: [item1, item2])
    if (typeof value === 'string' && value.startsWith('[') && value.endsWith(']')) {
      value = value.slice(1, -1).split(',').map(s => s.trim());
    }

    // Map to camelCase
    const camelKey = key.replace(/-([a-z])/g, (_, c) => c.toUpperCase());
    (meta as Record<string, unknown>)[camelKey] = value;
  }

  return { meta, content: rest.trim() };
}

/**
 * Load a skill from a directory
 */
function loadSkillFromDir(dir: string): Skill | null {
  const skillFile = join(dir, 'SKILL.md');

  if (!existsSync(skillFile)) {
    return null;
  }

  const content = readFileSync(skillFile, 'utf-8');
  const { meta, content: skillContent } = parseFrontmatter(content);

  const name = meta.name || dirname(dir).split('/').pop() || '';

  return {
    name,
    description: meta.description,
    disableModelInvocation: meta.disableModelInvocation,
    userInvocable: meta.userInvocable !== false, // default true
    allowedTools: meta.allowedTools,
    model: meta.model,
    context: meta.context,
    agent: meta.agent,
    content: skillContent,
    path: skillFile,
  };
}

/**
 * Load all skills from a directory
 */
function loadSkillsFromDir(dir: string): Skill[] {
  if (!existsSync(dir)) {
    return [];
  }

  const skills: Skill[] = [];

  try {
    const entries = readdirSync(dir, { withFileTypes: true });

    for (const entry of entries) {
      if (entry.isDirectory()) {
        const skill = loadSkillFromDir(join(dir, entry.name));
        if (skill) {
          skills.push(skill);
        }
      }
    }
  } catch {
    // Ignore errors
  }

  return skills;
}

/**
 * Skills loader
 */
export class SkillsLoader {
  private skills = new Map<string, Skill>();
  private projectPath?: string;

  constructor(projectPath?: string) {
    this.projectPath = projectPath;
    this.reload();
  }

  /**
   * Reload all skills
   */
  reload(): void {
    this.skills.clear();

    // Load from all locations (lower priority first, so higher priority overwrites)
    const locations = [...SKILL_LOCATIONS].reverse();

    for (const location of locations) {
      let dir: string;

      if (location.startsWith('.')) {
        // Project-relative path
        if (!this.projectPath) continue;
        dir = join(this.projectPath, location);
      } else {
        dir = location;
      }

      const skills = loadSkillsFromDir(dir);

      for (const skill of skills) {
        this.skills.set(skill.name, skill);
      }
    }
  }

  /**
   * Get a skill by name
   */
  get(name: string): Skill | undefined {
    return this.skills.get(name);
  }

  /**
   * Get all skills
   */
  all(): Skill[] {
    return Array.from(this.skills.values());
  }

  /**
   * Get user-invocable skills
   */
  userInvocable(): Skill[] {
    return this.all().filter(s => s.userInvocable !== false);
  }

  /**
   * Get model-invocable skills
   */
  modelInvocable(): Skill[] {
    return this.all().filter(s => !s.disableModelInvocation);
  }

  /**
   * Check if a skill exists
   */
  has(name: string): boolean {
    return this.skills.has(name);
  }

  /**
   * Expand a skill's content with arguments
   */
  expand(name: string, args?: string): string | null {
    const skill = this.get(name);
    if (!skill) return null;

    let content = skill.content;

    // Replace argument placeholders
    if (args) {
      const argParts = args.split(/\s+/);

      // $ARGUMENTS - all arguments
      content = content.replace(/\$ARGUMENTS/g, args);

      // $ARGUMENTS[N] - specific argument
      content = content.replace(/\$ARGUMENTS\[(\d+)\]/g, (_, n) => argParts[parseInt(n)] || '');

      // $N - shorthand for specific argument
      content = content.replace(/\$(\d+)/g, (_, n) => argParts[parseInt(n) - 1] || '');
    }

    return content;
  }
}

/**
 * Create a skills loader
 */
export function createSkillsLoader(projectPath?: string): SkillsLoader {
  return new SkillsLoader(projectPath);
}
