/**
 * MCP (Model Context Protocol) client for tool integration
 */

import { spawn, ChildProcess } from 'node:child_process';
import { EventEmitter } from 'node:events';
import type { MCPServer } from '../config/index.js';
import type { Tool } from '../tools/index.js';
import { z } from 'zod';

/**
 * MCP message types
 */
interface MCPRequest {
  jsonrpc: '2.0';
  id: number;
  method: string;
  params?: Record<string, unknown>;
}

interface MCPResponse {
  jsonrpc: '2.0';
  id: number;
  result?: unknown;
  error?: {
    code: number;
    message: string;
  };
}

interface MCPNotification {
  jsonrpc: '2.0';
  method: string;
  params?: Record<string, unknown>;
}

/**
 * MCP tool definition from server
 */
interface MCPToolDef {
  name: string;
  description: string;
  inputSchema: {
    type: 'object';
    properties: Record<string, unknown>;
    required?: string[];
  };
}

/**
 * MCP connection to a single server
 */
export class MCPConnection extends EventEmitter {
  private server: MCPServer;
  private process: ChildProcess | null = null;
  private messageId = 0;
  private pendingRequests = new Map<number, {
    resolve: (value: unknown) => void;
    reject: (error: Error) => void;
  }>();
  private buffer = '';
  private tools: MCPToolDef[] = [];
  private initialized = false;

  constructor(server: MCPServer) {
    super();
    this.server = server;
  }

  /**
   * Connect to the MCP server
   */
  async connect(): Promise<void> {
    if (this.server.transport !== 'stdio') {
      throw new Error(`Transport ${this.server.transport} not yet supported`);
    }

    if (!this.server.command) {
      throw new Error('Command is required for stdio transport');
    }

    // Spawn the server process
    this.process = spawn(this.server.command, this.server.args || [], {
      stdio: ['pipe', 'pipe', 'pipe'],
      env: {
        ...process.env,
        ...this.server.env,
      },
    });

    // Handle stdout (responses)
    this.process.stdout?.on('data', (data: Buffer) => {
      this.handleData(data.toString());
    });

    // Handle stderr (logs)
    this.process.stderr?.on('data', (data: Buffer) => {
      this.emit('log', data.toString());
    });

    // Handle process exit
    this.process.on('exit', (code) => {
      this.emit('exit', code);
      this.initialized = false;
    });

    // Initialize the connection
    await this.initialize();
  }

  /**
   * Handle incoming data
   */
  private handleData(data: string): void {
    this.buffer += data;

    // Process complete messages (newline-delimited JSON)
    const lines = this.buffer.split('\n');
    this.buffer = lines.pop() || '';

    for (const line of lines) {
      if (!line.trim()) continue;

      try {
        const message = JSON.parse(line);

        if ('id' in message && this.pendingRequests.has(message.id)) {
          // Response to a request
          const pending = this.pendingRequests.get(message.id)!;
          this.pendingRequests.delete(message.id);

          if (message.error) {
            pending.reject(new Error(message.error.message));
          } else {
            pending.resolve(message.result);
          }
        } else if ('method' in message && !('id' in message)) {
          // Notification
          this.emit('notification', message);
        }
      } catch (err) {
        this.emit('error', err);
      }
    }
  }

  /**
   * Send a request and wait for response
   */
  private async request<T>(method: string, params?: Record<string, unknown>): Promise<T> {
    if (!this.process?.stdin) {
      throw new Error('Not connected');
    }

    const id = ++this.messageId;
    const request: MCPRequest = {
      jsonrpc: '2.0',
      id,
      method,
      params,
    };

    return new Promise((resolve, reject) => {
      this.pendingRequests.set(id, { resolve: resolve as (value: unknown) => void, reject });
      this.process!.stdin!.write(JSON.stringify(request) + '\n');

      // Timeout after 30s
      setTimeout(() => {
        if (this.pendingRequests.has(id)) {
          this.pendingRequests.delete(id);
          reject(new Error('Request timeout'));
        }
      }, 30000);
    });
  }

  /**
   * Initialize the MCP connection
   */
  private async initialize(): Promise<void> {
    // Send initialize request
    await this.request('initialize', {
      protocolVersion: '2024-11-05',
      capabilities: {
        tools: {},
      },
      clientInfo: {
        name: 'puppuccino',
        version: '0.1.0',
      },
    });

    // Send initialized notification
    this.process?.stdin?.write(JSON.stringify({
      jsonrpc: '2.0',
      method: 'notifications/initialized',
    }) + '\n');

    // Fetch available tools
    const result = await this.request<{ tools: MCPToolDef[] }>('tools/list');
    this.tools = result.tools || [];

    this.initialized = true;
    this.emit('ready');
  }

  /**
   * Get tools from this server
   */
  getTools(): Tool[] {
    return this.tools.map(t => this.convertTool(t));
  }

  /**
   * Convert MCP tool to our Tool format
   */
  private convertTool(mcpTool: MCPToolDef): Tool {
    // Build a zod schema from JSON schema
    const properties: Record<string, z.ZodType> = {};

    for (const [key, schema] of Object.entries(mcpTool.inputSchema.properties)) {
      const s = schema as { type?: string; description?: string };
      let zodType: z.ZodType;

      switch (s.type) {
        case 'string':
          zodType = z.string();
          break;
        case 'number':
          zodType = z.number();
          break;
        case 'boolean':
          zodType = z.boolean();
          break;
        case 'array':
          zodType = z.array(z.unknown());
          break;
        case 'object':
          zodType = z.object({});
          break;
        default:
          zodType = z.unknown();
      }

      if (s.description) {
        zodType = zodType.describe(s.description);
      }

      if (!mcpTool.inputSchema.required?.includes(key)) {
        zodType = zodType.optional();
      }

      properties[key] = zodType;
    }

    const parameters = z.object(properties);

    return {
      name: `mcp__${this.server.name}__${mcpTool.name}`,
      description: mcpTool.description,
      parameters,
      execute: async (input) => {
        const result = await this.callTool(mcpTool.name, input);
        return typeof result === 'string' ? result : JSON.stringify(result);
      },
    };
  }

  /**
   * Call a tool on this server
   */
  async callTool(name: string, input: Record<string, unknown>): Promise<unknown> {
    const result = await this.request<{ content: Array<{ type: string; text?: string }> }>(
      'tools/call',
      { name, arguments: input }
    );

    // Extract text content
    const textContent = result.content
      ?.filter(c => c.type === 'text')
      .map(c => c.text)
      .join('\n');

    return textContent || result;
  }

  /**
   * Disconnect from the server
   */
  disconnect(): void {
    if (this.process) {
      this.process.kill();
      this.process = null;
    }
    this.initialized = false;
    this.tools = [];
  }

  /**
   * Check if connected
   */
  get isConnected(): boolean {
    return this.initialized;
  }
}

/**
 * MCP client managing multiple servers
 */
export class MCPClient {
  private connections = new Map<string, MCPConnection>();

  /**
   * Add and connect to an MCP server
   */
  async addServer(server: MCPServer): Promise<void> {
    if (!server.enabled) return;

    const connection = new MCPConnection(server);
    await connection.connect();
    this.connections.set(server.name, connection);
  }

  /**
   * Remove an MCP server
   */
  removeServer(name: string): void {
    const connection = this.connections.get(name);
    if (connection) {
      connection.disconnect();
      this.connections.delete(name);
    }
  }

  /**
   * Get all tools from all servers
   */
  getTools(): Tool[] {
    const tools: Tool[] = [];

    for (const connection of this.connections.values()) {
      if (connection.isConnected) {
        tools.push(...connection.getTools());
      }
    }

    return tools;
  }

  /**
   * Call a tool (parses the mcp__server__tool format)
   */
  async callTool(name: string, input: Record<string, unknown>): Promise<unknown> {
    const parts = name.split('__');
    if (parts.length !== 3 || parts[0] !== 'mcp') {
      throw new Error(`Invalid MCP tool name: ${name}`);
    }

    const [, serverName, toolName] = parts;
    const connection = this.connections.get(serverName);

    if (!connection) {
      throw new Error(`MCP server not found: ${serverName}`);
    }

    return connection.callTool(toolName, input);
  }

  /**
   * Disconnect all servers
   */
  disconnectAll(): void {
    for (const connection of this.connections.values()) {
      connection.disconnect();
    }
    this.connections.clear();
  }

  /**
   * Get connected server names
   */
  get servers(): string[] {
    return Array.from(this.connections.keys());
  }
}

/**
 * Create an MCP client
 */
export function createMCPClient(): MCPClient {
  return new MCPClient();
}
