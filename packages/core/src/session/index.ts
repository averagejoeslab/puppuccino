/**
 * Session management for conversation persistence
 */

import { existsSync, mkdirSync, writeFileSync, readFileSync, readdirSync, unlinkSync } from 'node:fs';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { getSessionsDir } from '../config/index.js';
import type { Message } from '../providers/index.js';

/**
 * Session metadata
 */
export interface SessionMeta {
  id: string;
  name?: string;
  createdAt: string;
  updatedAt: string;
  projectPath?: string;
  model?: string;
  messageCount: number;
}

/**
 * Full session with messages
 */
export interface Session extends SessionMeta {
  messages: Message[];
}

/**
 * Session entry in JSONL format
 */
interface SessionEntry {
  type: 'meta' | 'message';
  timestamp: string;
  data: SessionMeta | Message;
}

/**
 * Get the path for a session file
 */
function getSessionPath(id: string): string {
  const dir = getSessionsDir();
  return join(dir, `${id}.jsonl`);
}

/**
 * Ensure sessions directory exists
 */
function ensureSessionsDir(): void {
  const dir = getSessionsDir();
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true });
  }
}

/**
 * Create a new session
 */
export function createSession(options?: {
  name?: string;
  projectPath?: string;
  model?: string;
}): Session {
  const now = new Date().toISOString();

  return {
    id: randomUUID(),
    name: options?.name,
    createdAt: now,
    updatedAt: now,
    projectPath: options?.projectPath,
    model: options?.model,
    messageCount: 0,
    messages: [],
  };
}

/**
 * Save a session to disk
 */
export function saveSession(session: Session): void {
  ensureSessionsDir();

  const path = getSessionPath(session.id);
  const lines: string[] = [];

  // Write metadata
  const meta: SessionEntry = {
    type: 'meta',
    timestamp: session.updatedAt,
    data: {
      id: session.id,
      name: session.name,
      createdAt: session.createdAt,
      updatedAt: session.updatedAt,
      projectPath: session.projectPath,
      model: session.model,
      messageCount: session.messages.length,
    },
  };
  lines.push(JSON.stringify(meta));

  // Write messages
  for (const message of session.messages) {
    const entry: SessionEntry = {
      type: 'message',
      timestamp: new Date().toISOString(),
      data: message,
    };
    lines.push(JSON.stringify(entry));
  }

  writeFileSync(path, lines.join('\n') + '\n');
}

/**
 * Append a message to a session
 */
export function appendMessage(sessionId: string, message: Message): void {
  ensureSessionsDir();

  const path = getSessionPath(sessionId);
  const entry: SessionEntry = {
    type: 'message',
    timestamp: new Date().toISOString(),
    data: message,
  };

  // Append to file
  const line = JSON.stringify(entry) + '\n';

  if (existsSync(path)) {
    const content = readFileSync(path, 'utf-8');
    writeFileSync(path, content + line);
  } else {
    writeFileSync(path, line);
  }
}

/**
 * Load a session from disk
 */
export function loadSession(id: string): Session | null {
  const path = getSessionPath(id);

  if (!existsSync(path)) {
    return null;
  }

  const content = readFileSync(path, 'utf-8');
  const lines = content.trim().split('\n').filter(Boolean);

  let meta: SessionMeta | null = null;
  const messages: Message[] = [];

  for (const line of lines) {
    try {
      const entry: SessionEntry = JSON.parse(line);

      if (entry.type === 'meta') {
        meta = entry.data as SessionMeta;
      } else if (entry.type === 'message') {
        messages.push(entry.data as Message);
      }
    } catch {
      // Skip invalid lines
    }
  }

  if (!meta) {
    // Create basic meta from file
    meta = {
      id,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      messageCount: messages.length,
    };
  }

  return {
    ...meta,
    messages,
  };
}

/**
 * List all sessions
 */
export function listSessions(): SessionMeta[] {
  ensureSessionsDir();

  const dir = getSessionsDir();
  const files = readdirSync(dir).filter(f => f.endsWith('.jsonl'));

  const sessions: SessionMeta[] = [];

  for (const file of files) {
    const id = file.replace('.jsonl', '');
    const session = loadSession(id);

    if (session) {
      sessions.push({
        id: session.id,
        name: session.name,
        createdAt: session.createdAt,
        updatedAt: session.updatedAt,
        projectPath: session.projectPath,
        model: session.model,
        messageCount: session.messageCount,
      });
    }
  }

  // Sort by updatedAt (most recent first)
  return sessions.sort((a, b) =>
    new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime()
  );
}

/**
 * Delete a session
 */
export function deleteSession(id: string): boolean {
  const path = getSessionPath(id);

  if (existsSync(path)) {
    unlinkSync(path);
    return true;
  }

  return false;
}

/**
 * Get the most recent session
 */
export function getRecentSession(): Session | null {
  const sessions = listSessions();

  if (sessions.length === 0) {
    return null;
  }

  return loadSession(sessions[0].id);
}

/**
 * Fork a session (create a copy with new ID)
 */
export function forkSession(id: string): Session | null {
  const original = loadSession(id);

  if (!original) {
    return null;
  }

  const forked = createSession({
    name: original.name ? `${original.name} (fork)` : undefined,
    projectPath: original.projectPath,
    model: original.model,
  });

  forked.messages = [...original.messages];
  forked.messageCount = original.messageCount;

  saveSession(forked);

  return forked;
}

/**
 * Session manager class
 */
export class SessionManager {
  private currentSession: Session | null = null;

  /**
   * Start a new session
   */
  start(options?: Parameters<typeof createSession>[0]): Session {
    this.currentSession = createSession(options);
    return this.currentSession;
  }

  /**
   * Resume an existing session
   */
  resume(id: string): Session | null {
    const session = loadSession(id);

    if (session) {
      this.currentSession = session;
    }

    return session;
  }

  /**
   * Resume the most recent session
   */
  resumeRecent(): Session | null {
    const session = getRecentSession();

    if (session) {
      this.currentSession = session;
    }

    return session;
  }

  /**
   * Get current session
   */
  get current(): Session | null {
    return this.currentSession;
  }

  /**
   * Add a message to current session
   */
  addMessage(message: Message): void {
    if (!this.currentSession) {
      throw new Error('No active session');
    }

    this.currentSession.messages.push(message);
    this.currentSession.messageCount = this.currentSession.messages.length;
    this.currentSession.updatedAt = new Date().toISOString();
  }

  /**
   * Save current session
   */
  save(): void {
    if (this.currentSession) {
      saveSession(this.currentSession);
    }
  }

  /**
   * Clear current session messages
   */
  clear(): void {
    if (this.currentSession) {
      this.currentSession.messages = [];
      this.currentSession.messageCount = 0;
      this.currentSession.updatedAt = new Date().toISOString();
    }
  }

  /**
   * End current session
   */
  end(): void {
    if (this.currentSession) {
      this.save();
      this.currentSession = null;
    }
  }
}

/**
 * Create a session manager
 */
export function createSessionManager(): SessionManager {
  return new SessionManager();
}
