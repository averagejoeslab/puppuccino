/**
 * LLM Provider abstraction layer
 * Uses Vercel AI SDK for provider-agnostic implementation
 */

import { createAnthropic } from '@ai-sdk/anthropic';
import { createOpenAI } from '@ai-sdk/openai';
import { generateText, streamText, tool, CoreMessage, CoreTool } from 'ai';
import { z } from 'zod';
import type { Config } from '../config/index.js';
import type { Tool } from '../tools/index.js';

/**
 * Provider types
 */
export type ProviderType = 'anthropic' | 'openai' | 'groq' | 'local';

/**
 * Message types
 */
export interface Message {
  role: 'user' | 'assistant' | 'system';
  content: string | ContentBlock[];
}

export interface ContentBlock {
  type: 'text' | 'tool_use' | 'tool_result';
  text?: string;
  id?: string;
  name?: string;
  input?: Record<string, unknown>;
  tool_use_id?: string;
  content?: string;
}

/**
 * Tool call from LLM
 */
export interface ToolCall {
  id: string;
  name: string;
  input: Record<string, unknown>;
}

/**
 * Response from LLM
 */
export interface LLMResponse {
  text: string;
  toolCalls: ToolCall[];
  finishReason: string;
  usage?: {
    promptTokens: number;
    completionTokens: number;
  };
}

/**
 * Chat options
 */
export interface ChatOptions {
  model: string;
  messages: Message[];
  tools?: Tool[];
  systemPrompt?: string;
  maxTokens?: number;
  temperature?: number;
}

/**
 * Stream event
 */
export interface StreamEvent {
  type: 'text' | 'tool_call_start' | 'tool_call_end' | 'finish';
  text?: string;
  toolCall?: ToolCall;
  finishReason?: string;
}

/**
 * Create a provider instance based on config
 */
export function createProvider(config: Config) {
  const { provider, apiKey, baseUrl } = config;

  switch (provider) {
    case 'anthropic':
      return createAnthropic({
        apiKey: apiKey || process.env.ANTHROPIC_API_KEY,
        baseURL: baseUrl,
      });

    case 'openai':
      return createOpenAI({
        apiKey: apiKey || process.env.OPENAI_API_KEY,
        baseURL: baseUrl,
      });

    case 'groq':
      return createOpenAI({
        apiKey: apiKey || process.env.GROQ_API_KEY,
        baseURL: baseUrl || 'https://api.groq.com/openai/v1',
      });

    case 'local':
      return createOpenAI({
        apiKey: apiKey || 'local',
        baseURL: baseUrl || 'http://localhost:11434/v1',
      });

    default:
      throw new Error(`Unknown provider: ${provider}`);
  }
}

/**
 * Convert our Tool format to AI SDK tool format
 */
function convertTools(tools: Tool[]): Record<string, CoreTool> {
  const result: Record<string, CoreTool> = {};

  for (const t of tools) {
    result[t.name] = tool({
      description: t.description,
      parameters: t.parameters as z.ZodType,
    });
  }

  return result;
}

/**
 * Convert messages to AI SDK format
 */
function convertMessages(messages: Message[]): CoreMessage[] {
  return messages.map(msg => {
    if (typeof msg.content === 'string') {
      return {
        role: msg.role as 'user' | 'assistant' | 'system',
        content: msg.content,
      };
    }

    // Handle complex content blocks
    const textParts = msg.content
      .filter(b => b.type === 'text')
      .map(b => b.text || '')
      .join('');

    return {
      role: msg.role as 'user' | 'assistant' | 'system',
      content: textParts,
    };
  });
}

/**
 * Provider class for LLM interactions
 */
export class Provider {
  private config: Config;
  private sdk: ReturnType<typeof createAnthropic> | ReturnType<typeof createOpenAI>;

  constructor(config: Config) {
    this.config = config;
    this.sdk = createProvider(config);
  }

  /**
   * Send a chat request and get a response
   */
  async chat(options: ChatOptions): Promise<LLMResponse> {
    const {
      model,
      messages,
      tools = [],
      systemPrompt,
      maxTokens = 8192,
      temperature = 0.7,
    } = options;

    const result = await generateText({
      model: this.sdk(model),
      messages: convertMessages(messages),
      system: systemPrompt,
      tools: tools.length > 0 ? convertTools(tools) : undefined,
      maxTokens,
      temperature,
    });

    // Extract tool calls from response
    const toolCalls: ToolCall[] = result.toolCalls?.map(tc => ({
      id: tc.toolCallId,
      name: tc.toolName,
      input: tc.args as Record<string, unknown>,
    })) || [];

    return {
      text: result.text,
      toolCalls,
      finishReason: result.finishReason,
      usage: result.usage ? {
        promptTokens: result.usage.promptTokens,
        completionTokens: result.usage.completionTokens,
      } : undefined,
    };
  }

  /**
   * Stream a chat response
   */
  async *chatStream(options: ChatOptions): AsyncGenerator<StreamEvent> {
    const {
      model,
      messages,
      tools = [],
      systemPrompt,
      maxTokens = 8192,
      temperature = 0.7,
    } = options;

    const result = await streamText({
      model: this.sdk(model),
      messages: convertMessages(messages),
      system: systemPrompt,
      tools: tools.length > 0 ? convertTools(tools) : undefined,
      maxTokens,
      temperature,
    });

    for await (const chunk of result.textStream) {
      yield { type: 'text', text: chunk };
    }

    yield { type: 'finish', finishReason: await result.finishReason };
  }

  /**
   * Get current provider type
   */
  get providerType(): ProviderType {
    return this.config.provider;
  }

  /**
   * Get current model
   */
  get model(): string {
    return this.config.model;
  }
}

/**
 * Create a provider instance
 */
export function createProviderInstance(config: Config): Provider {
  return new Provider(config);
}
