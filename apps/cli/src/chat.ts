/**
 * Puppuccino Chat TUI - Full Elm Architecture Implementation
 *
 * Uses @averagejoeslab/tui for the runtime and widgets for a beautiful
 * terminal experience like Charm's Crush.
 */

import {
  Program,
  type Model,
  type Cmd,
  type Msg,
  KeyMsg,
  isKeyMsg,
  isQuitMsg,
  QuitMsg,
  WindowSizeMsg,
  isWindowSizeMsg,
  quit,
  none,
  tick,
  Key,
} from '@averagejoeslab/tui';

import {
  Spinner,
  TextInput,
  Viewport,
  Progress,
  type SpinnerModel,
  type TextInputModel,
  type ViewportModel,
} from '@averagejoeslab/widgets';

import {
  Style,
  RoundedBorder,
  joinVertical,
  Position,
  truncate,
} from '@averagejoeslab/style';

import {
  loadConfig,
  createProviderInstance,
  createToolRegistry,
  createSessionManager,
  createHooksRunner,
  createPermissionChecker,
  runAgentLoop,
  createAgentState,
  DEFAULT_SYSTEM_PROMPT,
  type Message,
  type AgentEvent,
  VERSION,
} from '@averagejoeslab/puppuccino-core';

import { getTheme, KALDI, KALDI_COLORS, type Theme } from '@averagejoeslab/puppuccino-tui';

// ============================================================================
// Message Types
// ============================================================================

interface SpinnerTickMsg { type: 'spinnerTick' }
interface AgentEventMsg { type: 'agentEvent'; event: AgentEvent }
interface AgentDoneMsg { type: 'agentDone' }
interface AgentErrorMsg { type: 'agentError'; error: string }
interface CheckAgentMsg { type: 'checkAgent' }
interface PermissionResponseMsg { type: 'permissionResponse'; approved: boolean }

type AppMsg =
  | SpinnerTickMsg
  | AgentEventMsg
  | AgentDoneMsg
  | AgentErrorMsg
  | CheckAgentMsg
  | PermissionResponseMsg
  | KeyMsg
  | QuitMsg
  | WindowSizeMsg;

// ============================================================================
// App State
// ============================================================================

type AppState = 'idle' | 'thinking' | 'permission';

interface ChatMessage {
  role: 'user' | 'assistant' | 'tool' | 'error';
  content: string;
  toolName?: string;
}

// Global event queue for agent events
const eventQueue: AgentEvent[] = [];
let agentRunning = false;
let agentError: string | null = null;
let permissionRequest: {
  toolName: string;
  toolInput: unknown;
  resolve: (approved: boolean) => void;
} | null = null;

interface AppModel extends Model<AppMsg> {
  state: AppState;
  width: number;
  height: number;
  input: TextInputModel;
  spinner: SpinnerModel;
  viewport: ViewportModel;
  messages: ChatMessage[];
  currentResponse: string;
  permissionSelected: number;
  theme: Theme;
  _config: ReturnType<typeof loadConfig>;
  _provider: ReturnType<typeof createProviderInstance>;
  _tools: ReturnType<typeof createToolRegistry>;
  _sessionManager: ReturnType<typeof createSessionManager>;
  _hooks: ReturnType<typeof createHooksRunner>;
  _permissions: ReturnType<typeof createPermissionChecker>;
}

// ============================================================================
// Helpers
// ============================================================================

function rgb(r: number, g: number, b: number) {
  return { r, g, b };
}

function formatMessages(messages: ChatMessage[], theme: Theme, width: number): string {
  const lines: string[] = [];

  for (const msg of messages) {
    switch (msg.role) {
      case 'user':
        lines.push('');
        lines.push(theme.styles.accent.render('  You:'));
        for (const line of msg.content.split('\n')) {
          lines.push('  ' + line);
        }
        break;

      case 'assistant':
        lines.push('');
        lines.push(theme.styles.heading.render('  Kaldi:'));
        const words = msg.content.split(' ');
        let line = '  ';
        for (const word of words) {
          if (line.length + word.length + 1 > width - 6) {
            lines.push(line);
            line = '  ' + word;
          } else {
            line = line + (line.length > 2 ? ' ' : '') + word;
          }
        }
        if (line.length > 2) lines.push(line);
        break;

      case 'tool':
        lines.push('');
        lines.push(theme.styles.toolName.render(`  [${msg.toolName}]`));
        const outputLines = msg.content.split('\n').slice(0, 8);
        for (const l of outputLines) {
          lines.push('  ' + theme.styles.toolOutput.render(truncate(l, width - 6)));
        }
        if (msg.content.split('\n').length > 8) {
          lines.push(theme.styles.dim.render('    ...(truncated)'));
        }
        break;

      case 'error':
        lines.push('');
        lines.push(theme.styles.error.render('  Error: ' + msg.content));
        break;
    }
  }

  return lines.join('\n');
}

// ============================================================================
// View Components
// ============================================================================

function renderHeader(model: AppModel): string {
  const titleStyle = new Style()
    .foreground(rgb(255, 250, 240))
    .bold();

  const title = titleStyle.render(` Puppuccino v${VERSION} `);

  let status: string;
  let statusColor: { r: number; g: number; b: number };

  switch (model.state) {
    case 'thinking':
      status = ' ' + Spinner.view(model.spinner) + ' thinking... ';
      statusColor = rgb(255, 215, 0); // Gold
      break;
    case 'permission':
      status = ' permission needed ';
      statusColor = rgb(255, 165, 0); // Orange
      break;
    default:
      status = ' ready ';
      statusColor = rgb(144, 238, 144); // Light green
  }

  const statusStyled = new Style().foreground(statusColor).render(status);
  const padding = model.width - 24 - status.length;
  const spacer = ' '.repeat(Math.max(0, padding));

  return new Style()
    .border(RoundedBorder, true)
    .borderForeground(rgb(210, 180, 140)) // Tan/warm brown
    .width(model.width - 2)
    .render(title + spacer + statusStyled);
}

function renderChat(model: AppModel): string {
  const contentHeight = model.height - 10;
  const contentWidth = model.width - 6;

  let content = formatMessages(model.messages, model.theme, contentWidth);

  // Add current streaming response
  if (model.currentResponse) {
    content += '\n\n' + model.theme.styles.heading.render('  Kaldi:');
    content += '\n  ' + model.currentResponse;
  }

  // Add thinking indicator
  if (model.state === 'thinking' && !model.currentResponse) {
    content += '\n\n  ' + Spinner.view(model.spinner) + ' ' +
      model.theme.styles.dim.render('Thinking...');
  }

  // Update viewport
  let viewport = Viewport.setContent(
    Viewport.setSize(model.viewport, contentWidth, Math.max(1, contentHeight)),
    content || '\n  ' + model.theme.styles.dim.render('Start a conversation with Kaldi!')
  );
  viewport = Viewport.scrollToBottom(viewport);

  return new Style()
    .border(RoundedBorder, true)
    .borderForeground(rgb(100, 100, 100))
    .width(model.width - 2)
    .height(contentHeight + 2)
    .render(Viewport.view(viewport));
}

function renderPermission(model: AppModel): string {
  if (!permissionRequest) return '';

  const { toolName, toolInput } = permissionRequest;
  const inputStr = JSON.stringify(toolInput, null, 2);
  const preview = inputStr.length > 300 ? inputStr.slice(0, 300) + '...' : inputStr;

  const yesStyle = model.permissionSelected === 0
    ? new Style().foreground(rgb(0, 0, 0)).background(rgb(144, 238, 144)).bold()
    : model.theme.styles.dim;
  const noStyle = model.permissionSelected === 1
    ? new Style().foreground(rgb(0, 0, 0)).background(rgb(255, 99, 71)).bold()
    : model.theme.styles.dim;

  const content = [
    '',
    model.theme.styles.warning.render(`  Tool requires permission: ${toolName}`),
    '',
    model.theme.styles.dim.render(preview.split('\n').map(l => '  ' + l).join('\n')),
    '',
    '  ' + yesStyle.render(' [Y] Allow ') + '    ' + noStyle.render(' [N] Deny '),
    '',
  ].join('\n');

  return new Style()
    .border(RoundedBorder, true)
    .borderForeground(rgb(255, 215, 0))
    .width(model.width - 4)
    .render(content);
}

function renderInput(model: AppModel): string {
  if (model.state !== 'idle') {
    return ''; // Hide input when not idle
  }

  const promptStyle = new Style().foreground(rgb(210, 180, 140)).bold();
  const prompt = promptStyle.render(' > ');

  // Show cursor character
  const value = model.input.value;
  const cursor = model.input.cursor;
  const before = value.slice(0, cursor);
  const cursorChar = value[cursor] || ' ';
  const after = value.slice(cursor + 1);

  const cursorStyle = new Style().reverse();
  const inputDisplay = before + cursorStyle.render(cursorChar) + after;

  const placeholder = !value
    ? model.theme.styles.dim.render('Ask Kaldi anything...')
    : inputDisplay;

  return new Style()
    .border(RoundedBorder, true)
    .borderForeground(rgb(144, 238, 144))
    .width(model.width - 2)
    .render(prompt + (value ? inputDisplay : placeholder));
}

function renderHelp(model: AppModel): string {
  const bindings = model.state === 'permission'
    ? 'y: allow  n: deny  tab: switch'
    : model.state === 'thinking'
    ? 'ctrl+c: cancel'
    : 'enter: send  /help: commands  ctrl+c: quit';

  return model.theme.styles.dim.render('  ' + bindings);
}

// ============================================================================
// Model
// ============================================================================

function createAppModel(options: {
  theme?: string;
  yolo?: boolean;
  resume?: string;
  continue?: boolean;
}): AppModel {
  const config = loadConfig(process.cwd());
  const theme = getTheme(options.theme || config.theme || 'kaldi');
  const permissions = createPermissionChecker(config.permissions);

  if (options.yolo) {
    permissions.enableYolo();
  }

  const sessionManager = createSessionManager();

  if (options.resume) {
    sessionManager.resume(options.resume);
  } else if (options.continue) {
    sessionManager.resumeRecent();
  }

  if (!sessionManager.current) {
    sessionManager.start({ projectPath: process.cwd(), model: config.model });
  }

  const width = process.stdout.columns || 80;
  const height = process.stdout.rows || 24;

  const model: AppModel = {
    state: 'idle',
    width,
    height,
    input: TextInput.focus(TextInput.create({ placeholder: 'Ask Kaldi anything...', width: width - 10 })),
    spinner: Spinner.create({ type: 'dot' }),
    viewport: Viewport.create({ height: height - 10 }),
    messages: [],
    currentResponse: '',
    permissionSelected: 0,
    theme,
    _config: config,
    _provider: createProviderInstance(config),
    _tools: createToolRegistry(),
    _sessionManager: sessionManager,
    _hooks: createHooksRunner(config.hooks),
    _permissions: permissions,

    init(): Cmd<AppMsg> {
      return none();
    },

    update(msg: AppMsg): [Model<AppMsg>, Cmd<AppMsg>] {
      return updateModel(this as AppModel, msg);
    },

    view(): string {
      return viewModel(this as AppModel);
    },
  };

  return model;
}

function updateModel(model: AppModel, msg: AppMsg): [AppModel, Cmd<AppMsg>] {
  if (isQuitMsg(msg)) {
    model._sessionManager.save();
    return [model, quit()];
  }

  if (isWindowSizeMsg(msg)) {
    return [{
      ...model,
      width: msg.width,
      height: msg.height,
    }, none()];
  }

  if (isKeyMsg(msg)) {
    return handleKeyMsg(model, msg);
  }

  switch ((msg as AppMsg).type) {
    case 'spinnerTick': {
      const newModel = {
        ...model,
        spinner: Spinner.tick(model.spinner),
      };

      // Continue ticking if still thinking
      if (model.state === 'thinking') {
        return [newModel, spinnerTickCmd()];
      }
      return [newModel, none()];
    }

    case 'checkAgent': {
      // Check for permission requests
      if (permissionRequest && model.state !== 'permission') {
        return [{
          ...model,
          state: 'permission',
          permissionSelected: 0,
        }, checkAgentCmd()];
      }

      // Process queued events
      if (eventQueue.length > 0) {
        const event = eventQueue.shift()!;
        const [newModel, cmd] = handleAgentEvent(model, event);
        return [newModel, cmd];
      }

      // Check if agent finished
      if (!agentRunning && model.state === 'thinking') {
        if (agentError) {
          const error = agentError;
          agentError = null;
          return [{
            ...model,
            state: 'idle',
            messages: [...model.messages, { role: 'error', content: error }],
            currentResponse: '',
          }, none()];
        }

        // Agent done - save response
        const newMessages = model.currentResponse
          ? [...model.messages, { role: 'assistant' as const, content: model.currentResponse }]
          : model.messages;

        return [{
          ...model,
          state: 'idle',
          messages: newMessages,
          currentResponse: '',
        }, none()];
      }

      // Keep checking if agent is running
      if (agentRunning || model.state === 'thinking' || model.state === 'permission') {
        return [model, checkAgentCmd()];
      }

      return [model, none()];
    }

    case 'permissionResponse': {
      if (permissionRequest) {
        permissionRequest.resolve((msg as PermissionResponseMsg).approved);
        permissionRequest = null;
      }
      return [{
        ...model,
        state: 'thinking',
      }, checkAgentCmd()];
    }

    default:
      return [model, none()];
  }
}

function handleAgentEvent(model: AppModel, event: AgentEvent): [AppModel, Cmd<AppMsg>] {
  switch (event.type) {
    case 'text':
      return [{
        ...model,
        currentResponse: model.currentResponse + event.content,
      }, checkAgentCmd()];

    case 'tool_start':
      return [{
        ...model,
        messages: [...model.messages, {
          role: 'tool' as const,
          content: JSON.stringify(event.input, null, 2),
          toolName: event.name,
        }],
      }, checkAgentCmd()];

    case 'tool_result':
      if (event.result.success) {
        const output = event.result.output;
        return [{
          ...model,
          messages: [...model.messages, {
            role: 'tool' as const,
            content: output.length > 500 ? output.slice(0, 500) + '...' : output,
            toolName: 'output',
          }],
        }, checkAgentCmd()];
      } else {
        return [{
          ...model,
          messages: [...model.messages, {
            role: 'error' as const,
            content: event.result.error || 'Tool execution failed',
          }],
        }, checkAgentCmd()];
      }

    case 'tool_denied':
      return [{
        ...model,
        messages: [...model.messages, {
          role: 'error' as const,
          content: `Permission denied: ${event.reason}`,
        }],
      }, checkAgentCmd()];

    case 'error':
      return [{
        ...model,
        messages: [...model.messages, {
          role: 'error' as const,
          content: event.error,
        }],
      }, checkAgentCmd()];

    default:
      return [model, checkAgentCmd()];
  }
}

function handleKeyMsg(model: AppModel, msg: KeyMsg): [AppModel, Cmd<AppMsg>] {
  // Ctrl+C quits
  if (msg.isCtrl('c')) {
    model._sessionManager.save();
    return [model, quit()];
  }

  // Permission state
  if (model.state === 'permission') {
    if (msg.key === 'y' || msg.key === 'Y') {
      return updateModel(model, { type: 'permissionResponse', approved: true });
    }
    if (msg.key === 'n' || msg.key === 'N') {
      return updateModel(model, { type: 'permissionResponse', approved: false });
    }
    if (msg.key === Key.Tab || msg.key === Key.Left || msg.key === Key.Right) {
      return [{
        ...model,
        permissionSelected: model.permissionSelected === 0 ? 1 : 0,
      }, none()];
    }
    if (msg.key === Key.Enter) {
      return updateModel(model, { type: 'permissionResponse', approved: model.permissionSelected === 0 });
    }
    return [model, none()];
  }

  // Thinking state - only allow quit
  if (model.state === 'thinking') {
    return [model, none()];
  }

  // Idle state - text input
  if (model.state === 'idle') {
    if (msg.key === Key.Enter) {
      const value = model.input.value.trim();
      if (!value) return [model, none()];

      if (value.startsWith('/')) {
        return handleCommand(model, value);
      }

      return submitToAgent(model, value);
    }

    if (msg.key === Key.Backspace) {
      return [{ ...model, input: TextInput.backspace(model.input) }, none()];
    }

    if (msg.key === Key.Delete) {
      return [{ ...model, input: TextInput.delete(model.input) }, none()];
    }

    if (msg.key === Key.Left) {
      return [{ ...model, input: TextInput.cursorLeft(model.input) }, none()];
    }

    if (msg.key === Key.Right) {
      return [{ ...model, input: TextInput.cursorRight(model.input) }, none()];
    }

    if (msg.key === Key.Home) {
      return [{ ...model, input: TextInput.cursorStart(model.input) }, none()];
    }

    if (msg.key === Key.End) {
      return [{ ...model, input: TextInput.cursorEnd(model.input) }, none()];
    }

    if (msg.isCtrl('u')) {
      return [{ ...model, input: TextInput.clear(model.input) }, none()];
    }

    if (msg.isCtrl('w')) {
      return [{ ...model, input: TextInput.deleteWordBackward(model.input) }, none()];
    }

    // Regular character
    if (msg.sequence && msg.sequence.length === 1 && !msg.ctrl && !msg.alt) {
      return [{ ...model, input: TextInput.insert(model.input, msg.sequence) }, none()];
    }
  }

  return [model, none()];
}

function handleCommand(model: AppModel, command: string): [AppModel, Cmd<AppMsg>] {
  const [cmd] = command.slice(1).split(/\s+/);

  switch (cmd.toLowerCase()) {
    case 'q':
    case 'quit':
    case 'exit':
      model._sessionManager.save();
      return [model, quit()];

    case 'c':
    case 'clear':
      model._sessionManager.clear();
      return [{
        ...model,
        messages: [],
        input: TextInput.clear(model.input),
      }, none()];

    case 'h':
    case 'help':
    case '?':
      return [{
        ...model,
        messages: [...model.messages, {
          role: 'assistant' as const,
          content: `Commands:
  /help, /?     - Show this help
  /clear, /c    - Clear conversation
  /quit, /q     - Exit Puppuccino

Tips:
  - Just type your message and press Enter
  - Kaldi can read, write, and edit files
  - Kaldi can execute shell commands`,
        }],
        input: TextInput.clear(model.input),
      }, none()];

    default:
      return [{
        ...model,
        messages: [...model.messages, {
          role: 'error' as const,
          content: `Unknown command: /${cmd}`,
        }],
        input: TextInput.clear(model.input),
      }, none()];
  }
}

function submitToAgent(model: AppModel, userInput: string): [AppModel, Cmd<AppMsg>] {
  const newMessages: ChatMessage[] = [...model.messages, { role: 'user', content: userInput }];

  const userMessage: Message = { role: 'user', content: userInput };
  model._sessionManager.addMessage(userMessage);

  // Start agent in background
  startAgentLoop(model);

  return [{
    ...model,
    state: 'thinking',
    messages: newMessages,
    currentResponse: '',
    input: TextInput.clear(model.input),
  }, spinnerTickCmd()]; // Start with spinner, it will trigger checkAgent
}

// ============================================================================
// Agent Loop (runs in background)
// ============================================================================

async function startAgentLoop(model: AppModel): Promise<void> {
  agentRunning = true;
  agentError = null;

  try {
    const session = model._sessionManager.current!;
    const agentState = createAgentState(model._provider, model._tools, {
      messages: session.messages,
      hooks: model._hooks,
      permissions: model._permissions,
      systemPrompt: model._config.agent?.systemPrompt || DEFAULT_SYSTEM_PROMPT,
      maxTurns: model._config.agent?.maxTurns,
      onPermissionRequest: async (toolName, toolInput) => {
        return new Promise<boolean>((resolve) => {
          permissionRequest = { toolName, toolInput, resolve };
        });
      },
    });

    for await (const event of runAgentLoop(agentState)) {
      eventQueue.push(event);
    }

    model._sessionManager.save();
  } catch (err) {
    agentError = err instanceof Error ? err.message : String(err);
  } finally {
    agentRunning = false;
  }
}

// ============================================================================
// Commands
// ============================================================================

function spinnerTickCmd(): Cmd<AppMsg> {
  return tick(80, () => {
    // Also check agent on each tick
    return { type: 'checkAgent' } as CheckAgentMsg;
  });
}

function checkAgentCmd(): Cmd<AppMsg> {
  return tick(50, () => ({ type: 'checkAgent' } as CheckAgentMsg));
}

// ============================================================================
// View
// ============================================================================

function viewModel(model: AppModel): string {
  const parts: string[] = [];

  parts.push(renderHeader(model));

  if (model.state === 'permission') {
    parts.push(renderChat(model));
    parts.push(renderPermission(model));
  } else {
    parts.push(renderChat(model));
  }

  parts.push(renderInput(model));
  parts.push(renderHelp(model));

  return joinVertical(Position.Left, ...parts);
}

// ============================================================================
// Export
// ============================================================================

export async function runChat(options: {
  theme?: string;
  yolo?: boolean;
  resume?: string;
  continue?: boolean;
}): Promise<void> {
  const model = createAppModel(options);

  const program = new Program(model, {
    altScreen: true,
    mouse: false,
    bracketedPaste: true,
  });

  await program.run();
}

export { createAppModel, AppModel, AppMsg };
