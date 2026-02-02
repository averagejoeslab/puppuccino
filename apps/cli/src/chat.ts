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
  exec,
  batch,
  Key,
} from '@averagejoeslab/tui';

import {
  Spinner,
  TextInput,
  Viewport,
  type SpinnerModel,
  type TextInputModel,
  type ViewportModel,
} from '@averagejoeslab/widgets';

import {
  Style,
  RoundedBorder,
  joinVertical,
  joinHorizontal,
  getWidth,
  getHeight,
  truncate,
  Position,
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

interface InitMsg { type: 'init' }
interface InputMsg { type: 'input'; char: string }
interface SubmitMsg { type: 'submit' }
interface SpinnerTickMsg { type: 'spinnerTick' }
interface AgentEventMsg { type: 'agentEvent'; event: AgentEvent }
interface AgentDoneMsg { type: 'agentDone' }
interface AgentErrorMsg { type: 'agentError'; error: string }
interface PermissionRequestMsg {
  type: 'permissionRequest';
  toolName: string;
  toolInput: unknown;
  resolve: (approved: boolean) => void;
}
interface PermissionResponseMsg { type: 'permissionResponse'; approved: boolean }
interface ScrollMsg { type: 'scroll'; direction: 'up' | 'down' | 'pageUp' | 'pageDown' }
interface ResizeMsg { type: 'resize'; width: number; height: number }

type AppMsg =
  | InitMsg
  | InputMsg
  | SubmitMsg
  | SpinnerTickMsg
  | AgentEventMsg
  | AgentDoneMsg
  | AgentErrorMsg
  | PermissionRequestMsg
  | PermissionResponseMsg
  | ScrollMsg
  | ResizeMsg
  | KeyMsg
  | QuitMsg
  | WindowSizeMsg;

// ============================================================================
// App State
// ============================================================================

type AppState =
  | 'idle'           // Waiting for user input
  | 'thinking'       // Agent is processing
  | 'permission'     // Waiting for permission approval
  | 'streaming';     // Streaming response

interface ChatMessage {
  role: 'user' | 'assistant' | 'tool' | 'error';
  content: string;
  toolName?: string;
}

interface AppModel extends Model<AppMsg> {
  // UI State
  state: AppState;
  width: number;
  height: number;

  // Widgets
  input: TextInputModel;
  spinner: SpinnerModel;
  viewport: ViewportModel;

  // Chat
  messages: ChatMessage[];
  currentResponse: string;

  // Permission
  pendingPermission: {
    toolName: string;
    toolInput: unknown;
    resolve: (approved: boolean) => void;
  } | null;
  permissionSelected: number; // 0 = Yes, 1 = No

  // Theme
  theme: Theme;

  // Core components (not part of state, but needed for operations)
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
        lines.push(theme.styles.accent.render('You:'));
        lines.push(msg.content);
        break;

      case 'assistant':
        lines.push('');
        lines.push(theme.styles.heading.render('Kaldi:'));
        // Word wrap the content
        const words = msg.content.split(' ');
        let line = '';
        for (const word of words) {
          if (line.length + word.length + 1 > width - 4) {
            lines.push(line);
            line = word;
          } else {
            line = line ? line + ' ' + word : word;
          }
        }
        if (line) lines.push(line);
        break;

      case 'tool':
        lines.push('');
        lines.push(theme.styles.toolName.render(`[${msg.toolName}]`));
        const outputLines = msg.content.split('\n').slice(0, 10);
        for (const l of outputLines) {
          lines.push(theme.styles.toolOutput.render(truncate(l, width - 4)));
        }
        if (msg.content.split('\n').length > 10) {
          lines.push(theme.styles.dim.render('  ...(truncated)'));
        }
        break;

      case 'error':
        lines.push('');
        lines.push(theme.styles.error.render('Error: ' + msg.content));
        break;
    }
  }

  return lines.join('\n');
}

// ============================================================================
// View Components
// ============================================================================

function renderHeader(model: AppModel): string {
  const [r, g, b] = KALDI_COLORS.body;
  const style = new Style()
    .foreground(rgb(r, g, b))
    .bold();

  const title = style.render(` Puppuccino v${VERSION} `);
  const status = model.state === 'thinking'
    ? model.theme.styles.warning.render(' thinking... ')
    : model.state === 'permission'
    ? model.theme.styles.warning.render(' permission needed ')
    : model.theme.styles.success.render(' ready ');

  const padding = model.width - getWidth(title) - getWidth(status) - 4;
  const spacer = ' '.repeat(Math.max(0, padding));

  return new Style()
    .border(RoundedBorder, true)
    .borderForeground(rgb(139, 119, 101))
    .width(model.width - 2)
    .render(title + spacer + status);
}

function renderKaldi(model: AppModel): string {
  const [r, g, b] = KALDI_COLORS.body;
  const style = new Style().foreground(rgb(r, g, b));

  let art: string;
  switch (model.state) {
    case 'thinking':
      art = KALDI.thinking;
      break;
    case 'permission':
      art = KALDI.error;
      break;
    default:
      art = KALDI.small;
  }

  return style.render(art);
}

function renderChat(model: AppModel): string {
  const contentHeight = model.height - 12; // Header + input + help
  const contentWidth = model.width - 4;

  let content = formatMessages(model.messages, model.theme, contentWidth);

  // Add current streaming response
  if (model.currentResponse) {
    content += '\n\n' + model.theme.styles.heading.render('Kaldi:');
    content += '\n' + model.currentResponse;
  }

  // Add spinner if thinking
  if (model.state === 'thinking') {
    content += '\n\n' + Spinner.view(model.spinner) + ' ' +
      model.theme.styles.dim.render('Thinking...');
  }

  // Update viewport with content
  const viewport = Viewport.setContent(
    Viewport.setSize(model.viewport, contentWidth, Math.max(1, contentHeight)),
    content
  );

  // Scroll to bottom for new content
  const scrolledViewport = Viewport.scrollToBottom(viewport);

  return new Style()
    .border(RoundedBorder, true)
    .borderForeground(rgb(100, 100, 100))
    .width(model.width - 2)
    .height(contentHeight + 2)
    .render(Viewport.view(scrolledViewport));
}

function renderPermission(model: AppModel): string {
  if (!model.pendingPermission) return '';

  const { toolName, toolInput } = model.pendingPermission;
  const inputStr = JSON.stringify(toolInput, null, 2);
  const preview = inputStr.length > 200 ? inputStr.slice(0, 200) + '...' : inputStr;

  const yesStyle = model.permissionSelected === 0
    ? new Style().foreground(rgb(0, 0, 0)).background(rgb(144, 238, 144)).bold()
    : model.theme.styles.dim;
  const noStyle = model.permissionSelected === 1
    ? new Style().foreground(rgb(0, 0, 0)).background(rgb(255, 99, 71)).bold()
    : model.theme.styles.dim;

  const content = [
    model.theme.styles.warning.render(`Tool requires permission: ${toolName}`),
    '',
    model.theme.styles.dim.render(preview),
    '',
    yesStyle.render(' [Y] Allow ') + '  ' + noStyle.render(' [N] Deny '),
  ].join('\n');

  return new Style()
    .border(RoundedBorder, true)
    .borderForeground(rgb(255, 215, 0))
    .padding(1, 2, 1, 2)
    .width(model.width - 4)
    .render(content);
}

function renderInput(model: AppModel): string {
  const prompt = model.theme.styles.prompt.render('> ');
  const inputView = TextInput.view(model.input);

  return new Style()
    .border(RoundedBorder, true)
    .borderForeground(model.state === 'idle' ? rgb(144, 238, 144) : rgb(100, 100, 100))
    .width(model.width - 2)
    .render(prompt + inputView);
}

function renderHelp(model: AppModel): string {
  const bindings = model.state === 'permission'
    ? 'y/n: respond  '
    : 'enter: send  ctrl+c: quit  ';

  return model.theme.styles.dim.render('  ' + bindings);
}

// ============================================================================
// Model Implementation
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

  // Handle session resume
  if (options.resume) {
    sessionManager.resume(options.resume);
  } else if (options.continue) {
    sessionManager.resumeRecent();
  }

  if (!sessionManager.current) {
    sessionManager.start({ projectPath: process.cwd(), model: config.model });
  }

  const model: AppModel = {
    // State
    state: 'idle',
    width: process.stdout.columns || 80,
    height: process.stdout.rows || 24,

    // Widgets
    input: TextInput.create({
      placeholder: 'Ask Kaldi anything...',
      width: 60,
    }),
    spinner: Spinner.create({ type: 'dot' }),
    viewport: Viewport.create({ height: 10 }),

    // Chat
    messages: [],
    currentResponse: '',

    // Permission
    pendingPermission: null,
    permissionSelected: 0,

    // Theme
    theme,

    // Core (stored but not serialized)
    _config: config,
    _provider: createProviderInstance(config),
    _tools: createToolRegistry(),
    _sessionManager: sessionManager,
    _hooks: createHooksRunner(config.hooks),
    _permissions: permissions,

    // Model interface methods
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

  // Focus the input
  model.input = TextInput.focus(model.input);

  return model;
}

function updateModel(model: AppModel, msg: AppMsg): [AppModel, Cmd<AppMsg>] {
  // Handle quit
  if (isQuitMsg(msg)) {
    model._sessionManager.save();
    return [model, quit()];
  }

  // Handle window resize
  if (isWindowSizeMsg(msg)) {
    return [{
      ...model,
      width: msg.width,
      height: msg.height,
    }, none()];
  }

  // Handle key messages
  if (isKeyMsg(msg)) {
    return handleKeyMsg(model, msg);
  }

  // Handle app-specific messages
  switch ((msg as AppMsg).type) {
    case 'spinnerTick':
      return [{
        ...model,
        spinner: Spinner.tick(model.spinner),
      }, model.state === 'thinking' ? spinnerCmd() : none()];

    case 'agentEvent':
      return handleAgentEvent(model, (msg as AgentEventMsg).event);

    case 'agentDone':
      // Save current response as message if any
      const newMessages = model.currentResponse
        ? [...model.messages, { role: 'assistant' as const, content: model.currentResponse }]
        : model.messages;
      return [{
        ...model,
        state: 'idle',
        messages: newMessages,
        currentResponse: '',
        input: TextInput.focus(model.input),
      }, none()];

    case 'agentError':
      return [{
        ...model,
        state: 'idle',
        messages: [...model.messages, { role: 'error' as const, content: (msg as AgentErrorMsg).error }],
        currentResponse: '',
        input: TextInput.focus(model.input),
      }, none()];

    case 'permissionRequest': {
      const permMsg = msg as PermissionRequestMsg;
      return [{
        ...model,
        state: 'permission',
        pendingPermission: {
          toolName: permMsg.toolName,
          toolInput: permMsg.toolInput,
          resolve: permMsg.resolve,
        },
        permissionSelected: 0,
      }, none()];
    }

    case 'permissionResponse': {
      if (model.pendingPermission) {
        model.pendingPermission.resolve((msg as PermissionResponseMsg).approved);
      }
      return [{
        ...model,
        state: 'thinking',
        pendingPermission: null,
      }, spinnerCmd()];
    }

    default:
      return [model, none()];
  }
}

function handleKeyMsg(model: AppModel, msg: KeyMsg): [AppModel, Cmd<AppMsg>] {
  // Ctrl+C quits
  if (msg.isCtrl('c')) {
    model._sessionManager.save();
    return [model, quit()];
  }

  // Handle permission state
  if (model.state === 'permission') {
    if (msg.key === 'y' || msg.key === 'Y') {
      return updateModel(model, { type: 'permissionResponse', approved: true });
    }
    if (msg.key === 'n' || msg.key === 'N') {
      return updateModel(model, { type: 'permissionResponse', approved: false });
    }
    if (msg.key === Key.Left || msg.key === Key.Right || msg.key === Key.Tab) {
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

  // Handle idle state (text input)
  if (model.state === 'idle') {
    // Enter submits
    if (msg.key === Key.Enter) {
      const value = model.input.value.trim();
      if (!value) return [model, none()];

      // Handle commands
      if (value.startsWith('/')) {
        return handleCommand(model, value);
      }

      // Submit to agent
      return submitToAgent(model, value);
    }

    // Backspace
    if (msg.key === Key.Backspace) {
      return [{
        ...model,
        input: TextInput.backspace(model.input),
      }, none()];
    }

    // Delete
    if (msg.key === Key.Delete) {
      return [{
        ...model,
        input: TextInput.delete(model.input),
      }, none()];
    }

    // Arrow keys
    if (msg.key === Key.Left) {
      return [{
        ...model,
        input: TextInput.cursorLeft(model.input),
      }, none()];
    }
    if (msg.key === Key.Right) {
      return [{
        ...model,
        input: TextInput.cursorRight(model.input),
      }, none()];
    }
    if (msg.key === Key.Home) {
      return [{
        ...model,
        input: TextInput.cursorStart(model.input),
      }, none()];
    }
    if (msg.key === Key.End) {
      return [{
        ...model,
        input: TextInput.cursorEnd(model.input),
      }, none()];
    }

    // Ctrl+U clears line
    if (msg.isCtrl('u')) {
      return [{
        ...model,
        input: TextInput.clear(model.input),
      }, none()];
    }

    // Ctrl+W deletes word
    if (msg.isCtrl('w')) {
      return [{
        ...model,
        input: TextInput.deleteWordBackward(model.input),
      }, none()];
    }

    // Regular character input
    if (msg.sequence && msg.sequence.length === 1 && !msg.ctrl && !msg.alt) {
      return [{
        ...model,
        input: TextInput.insert(model.input, msg.sequence),
      }, none()];
    }
  }

  // Scrolling (works in any state)
  if (msg.key === Key.PageUp) {
    return [{
      ...model,
      viewport: Viewport.pageUp(model.viewport),
    }, none()];
  }
  if (msg.key === Key.PageDown) {
    return [{
      ...model,
      viewport: Viewport.pageDown(model.viewport),
    }, none()];
  }

  return [model, none()];
}

function handleCommand(model: AppModel, command: string): [AppModel, Cmd<AppMsg>] {
  const [cmd, ...args] = command.slice(1).split(/\s+/);

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
- Kaldi can execute shell commands
- Press Ctrl+C to quit`,
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
  // Add user message to UI
  const newMessages: ChatMessage[] = [...model.messages, { role: 'user', content: userInput }];

  // Add to session
  const userMessage: Message = { role: 'user', content: userInput };
  model._sessionManager.addMessage(userMessage);

  // Create agent state
  const session = model._sessionManager.current!;

  // Return new model with thinking state and start agent
  const newModel: AppModel = {
    ...model,
    state: 'thinking',
    messages: newMessages,
    currentResponse: '',
    input: TextInput.blur(TextInput.clear(model.input)),
  };

  return [newModel, batch(spinnerCmd(), runAgentCmd(newModel))];
}

// ============================================================================
// Commands
// ============================================================================

function spinnerCmd(): Cmd<AppMsg> {
  return tick(80, () => ({ type: 'spinnerTick' } as SpinnerTickMsg));
}

function runAgentCmd(model: AppModel): Cmd<AppMsg> {
  return exec(
    async () => {
      const session = model._sessionManager.current!;
      const agentState = createAgentState(model._provider, model._tools, {
        messages: session.messages,
        hooks: model._hooks,
        permissions: model._permissions,
        systemPrompt: model._config.agent?.systemPrompt || DEFAULT_SYSTEM_PROMPT,
        maxTurns: model._config.agent?.maxTurns,
        onPermissionRequest: async (toolName, toolInput) => {
          return new Promise<boolean>((resolve) => {
            // This is hacky but works - we emit a permission event
            // In a real implementation, this would use a proper channel
            (globalThis as any).__puppuccino_permission_request = {
              toolName,
              toolInput,
              resolve,
            };
          });
        },
      });

      const events: AgentEvent[] = [];
      for await (const event of runAgentLoop(agentState)) {
        events.push(event);
      }

      model._sessionManager.save();
      return events;
    },
    (events) => ({ type: 'agentDone' } as AgentDoneMsg),
    (error) => ({ type: 'agentError', error: error.message } as AgentErrorMsg)
  );
}

function handleAgentEvent(model: AppModel, event: AgentEvent): [AppModel, Cmd<AppMsg>] {
  switch (event.type) {
    case 'text':
      return [{
        ...model,
        currentResponse: model.currentResponse + event.content,
      }, none()];

    case 'tool_start':
      return [{
        ...model,
        messages: [...model.messages, {
          role: 'tool' as const,
          content: JSON.stringify(event.input, null, 2),
          toolName: event.name,
        }],
      }, none()];

    case 'tool_result':
      if (event.result.success) {
        return [{
          ...model,
          messages: [...model.messages, {
            role: 'tool' as const,
            content: event.result.output,
            toolName: 'result',
          }],
        }, none()];
      } else {
        return [{
          ...model,
          messages: [...model.messages, {
            role: 'error' as const,
            content: event.result.error || 'Tool failed',
          }],
        }, none()];
      }

    case 'error':
      return [{
        ...model,
        messages: [...model.messages, {
          role: 'error' as const,
          content: event.error,
        }],
      }, none()];

    default:
      return [model, none()];
  }
}

// ============================================================================
// View
// ============================================================================

function viewModel(model: AppModel): string {
  const parts: string[] = [];

  // Header
  parts.push(renderHeader(model));

  // Main content area
  if (model.state === 'permission' && model.pendingPermission) {
    // Show permission dialog
    parts.push(renderChat(model));
    parts.push(renderPermission(model));
  } else {
    // Normal chat view
    parts.push(renderChat(model));
  }

  // Input (only show if idle)
  if (model.state === 'idle') {
    parts.push(renderInput(model));
  }

  // Help bar
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
