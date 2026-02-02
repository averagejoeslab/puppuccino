/**
 * Glob pattern matching utility
 */

import { readdirSync, statSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';

/**
 * Convert a glob pattern to a regex
 */
function globToRegex(pattern: string): RegExp {
  let regex = pattern
    // Escape special regex chars except * and ?
    .replace(/[.+^${}()|[\]\\]/g, '\\$&')
    // Convert ** to match any path
    .replace(/\*\*/g, '{{GLOBSTAR}}')
    // Convert * to match any chars except /
    .replace(/\*/g, '[^/]*')
    // Convert ? to match single char
    .replace(/\?/g, '[^/]')
    // Restore **
    .replace(/\{\{GLOBSTAR\}\}/g, '.*');

  return new RegExp(`^${regex}$`);
}

/**
 * Check if a path should be ignored
 */
function shouldIgnore(name: string): boolean {
  const ignored = [
    'node_modules',
    '.git',
    '.svn',
    '.hg',
    '.DS_Store',
    'dist',
    'build',
    'coverage',
    '.turbo',
    '.next',
    '.nuxt',
  ];

  return ignored.includes(name);
}

/**
 * Recursively walk a directory
 */
function* walkDir(dir: string, base: string): Generator<string> {
  try {
    const entries = readdirSync(dir, { withFileTypes: true });

    for (const entry of entries) {
      const name = entry.name;

      // Skip ignored directories
      if (entry.isDirectory() && shouldIgnore(name)) {
        continue;
      }

      const fullPath = join(dir, name);
      const relativePath = relative(base, fullPath);

      if (entry.isDirectory()) {
        yield* walkDir(fullPath, base);
      } else {
        yield relativePath;
      }
    }
  } catch {
    // Skip directories we can't read
  }
}

/**
 * Find files matching a glob pattern
 */
export async function glob(pattern: string, basePath: string = '.'): Promise<string[]> {
  const absBase = resolve(basePath);
  const regex = globToRegex(pattern);
  const results: string[] = [];

  for (const file of walkDir(absBase, absBase)) {
    // Normalize path separators
    const normalized = file.replace(/\\/g, '/');

    if (regex.test(normalized)) {
      results.push(normalized);
    }
  }

  // Sort by path
  return results.sort();
}
