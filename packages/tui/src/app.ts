/**
 * Puppuccino TUI Application
 *
 * Uses the Elm Architecture from @averagejoeslab/tui
 */

import { Program, Key, KeyMsg, batch, type Cmd } from '@averagejoeslab/tui';
import { Spinner, TextInput, Viewport } from '@averagejoeslab/widgets';
import { render as renderMarkdown } from '@averagejoeslab/markdown';
import { Style } from '@averagejoeslab/style';
import { getSize, hideCursor, showCursor, clearScreen } from '@averagejoeslab/term';

import type { AgentEvent, Message, Session } from '@averagejoeslab/puppuccino-core';
import { getTheme, type Theme } from './themes/index.js';
import { getWelcomeBanner, getGoodbyeBanner, getPrompt, KALDI } from './components/kaldi.js';

/**
 * Chat message for display
 */
interface ChatMessage {
  role: 'user' | 'assistant' | 'tool';
  content: string;
  toolName?: string;
  timestamp: Date;
}

/**
 * Application model
 */
export interface Model {
  // UI state
  input: TextInput.Model;
  viewport: Viewport.Model;
  spinner: Spinner.Model;

  // App state
  status: 'idle' | 'thinking' | 'tool' | 'error';
  messages: ChatMessage[];
  currentTool?: string;
  errorMessage?: string;

  // Session
  session?: Session;
  sessionId?: string;

  // Config
  theme: Theme;
  showWelcome: boolean;
  width: number;
  height: number;
}

/**
 * Message types
 */
export type Msg =
  | { type: 'key'; key: Key }
  | { type: 'input'; msg: TextInput.Msg }
  | { type: 'viewport'; msg: Viewport.Msg }
  | { type: 'spinner'; msg: Spinner.Msg }
  | { type: 'submit' }
  | { type: 'agent_event'; event: AgentEvent }
  | { type: 'resize'; width: number; height: number }
  | { type: 'clear' }
  | { type: 'quit' }
  | { type: 'error'; error: string }
  | { type: 'dismiss_welcome' };

/**
 * Initialize the application
 */
export function init(options?: {
  theme?: string;
  sessionId?: string;
}): [Model, Cmd<Msg>] {
  const { width, height } = getSize();
  const theme = getTheme(options?.theme || 'kaldi');

  const model: Model = {
    input: TextInput.init({
      placeholder: 'Ask Kaldi anything...',
      width: width - 4,
    }),
    viewport: Viewport.init({
      width: width - 2,
      height: height - 6,
    }),
    spinner: Spinner.init({ style: 'dots' }),
    status: 'idle',
    messages: [],
    theme,
    showWelcome: true,
    width,
    height,
  };

  // Start spinner animation
  const spinnerCmd = Spinner.tick(model.spinner);

  return [model, spinnerCmd ? () => ({ type: 'spinner', msg: spinnerCmd }) : null];
}

/**
 * Update function
 */
export function update(msg: Msg, model: Model): [Model, Cmd<Msg>] {
  switch (msg.type) {
    case 'key': {
      // Handle global keys
      if (msg.key.ctrl && msg.key.name === 'c') {
        return [model, () => ({ type: 'quit' })];
      }

      if (msg.key.name === 'escape') {
        if (model.showWelcome) {
          return [{ ...model, showWelcome: false }, null];
        }
      }

      if (msg.key.name === 'enter' && model.status === 'idle') {
        const text = TextInput.value(model.input);
        if (text.trim()) {
          return update({ type: 'submit' }, model);
        }
      }

      // Dismiss welcome on any key
      if (model.showWelcome) {
        return [{ ...model, showWelcome: false }, null];
      }

      // Forward to input
      const inputMsg = TextInput.handleKey(msg.key);
      if (inputMsg) {
        return update({ type: 'input', msg: inputMsg }, model);
      }

      return [model, null];
    }

    case 'input': {
      const [newInput, inputCmd] = TextInput.update(msg.msg, model.input);
      const cmd = inputCmd
        ? () => ({ type: 'input' as const, msg: inputCmd })
        : null;

      return [{ ...model, input: newInput }, cmd];
    }

    case 'viewport': {
      const [newViewport, viewportCmd] = Viewport.update(msg.msg, model.viewport);
      const cmd = viewportCmd
        ? () => ({ type: 'viewport' as const, msg: viewportCmd })
        : null;

      return [{ ...model, viewport: newViewport }, cmd];
    }

    case 'spinner': {
      const [newSpinner, spinnerCmd] = Spinner.update(msg.msg, model.spinner);
      const cmd = spinnerCmd
        ? () => ({ type: 'spinner' as const, msg: spinnerCmd })
        : null;

      return [{ ...model, spinner: newSpinner }, cmd];
    }

    case 'submit': {
      const text = TextInput.value(model.input);
      if (!text.trim()) return [model, null];

      // Handle commands
      if (text.startsWith('/')) {
        return handleCommand(text.slice(1), model);
      }

      // Add user message
      const userMessage: ChatMessage = {
        role: 'user',
        content: text,
        timestamp: new Date(),
      };

      return [{
        ...model,
        input: TextInput.init({
          placeholder: 'Ask Kaldi anything...',
          width: model.width - 4,
        }),
        messages: [...model.messages, userMessage],
        status: 'thinking',
      }, null]; // Agent interaction would be triggered externally
    }

    case 'agent_event': {
      return handleAgentEvent(msg.event, model);
    }

    case 'resize': {
      return [{
        ...model,
        width: msg.width,
        height: msg.height,
        input: TextInput.init({
          placeholder: 'Ask Kaldi anything...',
          width: msg.width - 4,
          value: TextInput.value(model.input),
        }),
        viewport: Viewport.init({
          width: msg.width - 2,
          height: msg.height - 6,
          content: model.viewport.content,
        }),
      }, null];
    }

    case 'clear': {
      return [{
        ...model,
        messages: [],
        status: 'idle',
        errorMessage: undefined,
      }, null];
    }

    case 'error': {
      return [{
        ...model,
        status: 'error',
        errorMessage: msg.error,
      }, null];
    }

    case 'dismiss_welcome': {
      return [{ ...model, showWelcome: false }, null];
    }

    case 'quit': {
      // This would trigger program exit
      return [model, null];
    }

    default:
      return [model, null];
  }
}

/**
 * Handle slash commands
 */
function handleCommand(cmd: string, model: Model): [Model, Cmd<Msg>] {
  const [command, ...args] = cmd.split(/\s+/);

  switch (command.toLowerCase()) {
    case 'clear':
    case 'c':
      return update({ type: 'clear' }, model);

    case 'quit':
    case 'q':
    case 'exit':
      return update({ type: 'quit' }, model);

    case 'help':
    case 'h':
    case '?': {
      const helpMessage: ChatMessage = {
        role: 'assistant',
        content: `## Available Commands

- \`/clear\` or \`/c\` - Clear conversation
- \`/quit\` or \`/q\` - Exit Puppuccino
- \`/help\` or \`/?\` - Show this help

Just type your message and press Enter to chat with Kaldi!`,
        timestamp: new Date(),
      };

      return [{
        ...model,
        input: TextInput.init({
          placeholder: 'Ask Kaldi anything...',
          width: model.width - 4,
        }),
        messages: [...model.messages, helpMessage],
      }, null];
    }

    default: {
      const errorMessage: ChatMessage = {
        role: 'assistant',
        content: `Unknown command: \`/${command}\`. Type \`/help\` for available commands.`,
        timestamp: new Date(),
      };

      return [{
        ...model,
        input: TextInput.init({
          placeholder: 'Ask Kaldi anything...',
          width: model.width - 4,
        }),
        messages: [...model.messages, errorMessage],
      }, null];
    }
  }
}

/**
 * Handle agent events
 */
function handleAgentEvent(event: AgentEvent, model: Model): [Model, Cmd<Msg>] {
  switch (event.type) {
    case 'thinking':
      return [{ ...model, status: 'thinking' }, null];

    case 'text': {
      // Find or create assistant message
      const messages = [...model.messages];
      const lastMsg = messages[messages.length - 1];

      if (lastMsg && lastMsg.role === 'assistant' && !lastMsg.toolName) {
        lastMsg.content += event.content;
      } else {
        messages.push({
          role: 'assistant',
          content: event.content,
          timestamp: new Date(),
        });
      }

      return [{ ...model, messages, status: 'idle' }, null];
    }

    case 'tool_start':
      return [{
        ...model,
        status: 'tool',
        currentTool: event.name,
      }, null];

    case 'tool_result': {
      const toolMessage: ChatMessage = {
        role: 'tool',
        content: event.result.success ? event.result.output : `Error: ${event.result.error}`,
        toolName: event.name,
        timestamp: new Date(),
      };

      return [{
        ...model,
        messages: [...model.messages, toolMessage],
        status: 'thinking',
        currentTool: undefined,
      }, null];
    }

    case 'tool_denied': {
      const deniedMessage: ChatMessage = {
        role: 'tool',
        content: `Permission denied: ${event.reason}`,
        toolName: event.name,
        timestamp: new Date(),
      };

      return [{
        ...model,
        messages: [...model.messages, deniedMessage],
        status: 'thinking',
        currentTool: undefined,
      }, null];
    }

    case 'error':
      return [{
        ...model,
        status: 'error',
        errorMessage: event.error,
      }, null];

    case 'done':
      return [{ ...model, status: 'idle' }, null];

    default:
      return [model, null];
  }
}

/**
 * View function - render the UI
 */
export function view(model: Model): string {
  const { theme } = model;
  const lines: string[] = [];

  // Show welcome banner
  if (model.showWelcome) {
    return getWelcomeBanner() + '\n\nPress any key to continue...';
  }

  // Header
  lines.push(theme.styles.heading.render('─'.repeat(model.width)));

  // Chat messages
  const chatLines: string[] = [];
  for (const msg of model.messages) {
    chatLines.push(renderMessage(msg, theme, model.width - 4));
    chatLines.push('');
  }

  // Status indicator
  if (model.status === 'thinking') {
    const spinner = Spinner.view(model.spinner);
    chatLines.push(`${spinner} ${theme.styles.dim.render('Kaldi is thinking...')}`);
  } else if (model.status === 'tool' && model.currentTool) {
    const spinner = Spinner.view(model.spinner);
    chatLines.push(`${spinner} ${theme.styles.toolName.render(model.currentTool)}`);
  } else if (model.status === 'error' && model.errorMessage) {
    chatLines.push(theme.styles.error.render(`Error: ${model.errorMessage}`));
  }

  // Viewport content
  const viewportModel = Viewport.setContent(model.viewport, chatLines.join('\n'));
  lines.push(Viewport.view(viewportModel));

  // Divider
  lines.push(theme.styles.heading.render('─'.repeat(model.width)));

  // Input
  const prompt = getPrompt();
  const inputView = TextInput.view(model.input);
  lines.push(`${prompt}${inputView}`);

  return lines.join('\n');
}

/**
 * Render a single message
 */
function renderMessage(msg: ChatMessage, theme: Theme, width: number): string {
  const lines: string[] = [];

  // Role indicator
  if (msg.role === 'user') {
    lines.push(theme.styles.accent.render('You:'));
    lines.push(msg.content);
  } else if (msg.role === 'assistant') {
    lines.push(theme.styles.heading.render('Kaldi:'));
    // Render markdown
    lines.push(renderMarkdown(msg.content, { width }));
  } else if (msg.role === 'tool') {
    lines.push(theme.styles.toolName.render(`[${msg.toolName}]`));
    // Truncate long tool output
    const output = msg.content.length > 500
      ? msg.content.slice(0, 500) + '\n...(truncated)'
      : msg.content;
    lines.push(theme.styles.toolOutput.render(output));
  }

  return lines.join('\n');
}

/**
 * Create the TUI program
 */
export function createApp(options?: {
  theme?: string;
  sessionId?: string;
}): Program<Model, Msg> {
  return new Program({
    init: () => init(options),
    update,
    view,
  });
}
