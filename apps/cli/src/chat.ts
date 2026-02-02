/**
 * Puppuccino Chat TUI - Full Elm Architecture Implementation
 *
 * A beautiful, interactive terminal UI for the Puppuccino AI coding agent.
 * Features streaming responses, animated spinners, and a polished interface.
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
  batch,
  Key,
} from '@averagejoeslab/tui';

import {
  Spinner,
  TextInput,
  Viewport,
  Progress,
  Help,
  type SpinnerModel,
  type TextInputModel,
  type ViewportModel,
} from '@averagejoeslab/widgets';

import {
  Style,
  RoundedBorder,
  joinVertical,
  joinHorizontal,
  Position,
  truncate,
  center,
  padRight,
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

interface TickMsg { type: 'tick' }
interface CheckAgentMsg { type: 'checkAgent' }
interface PermissionResponseMsg { type: 'permissionResponse'; approved: boolean }

type AppMsg =
  | TickMsg
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

// Global event queue for agent events (allows async communication)
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
  frameCount: number;
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

// Kaldi colors
const CREAM = rgb(255, 250, 240);
const TAN = rgb(210, 180, 140);
const BROWN = rgb(139, 119, 101);
const GREEN = rgb(144, 238, 144);
const GOLD = rgb(255, 215, 0);
const RED = rgb(255, 99, 71);
const GRAY = rgb(128, 128, 128);
const DARK_GRAY = rgb(80, 80, 80);
const SKY_BLUE = rgb(135, 206, 235);

function formatMessages(messages: ChatMessage[], theme: Theme, width: number): string {
  if (messages.length === 0) {
    return '';
  }

  const lines: string[] = [];

  for (const msg of messages) {
    switch (msg.role) {
      case 'user':
        lines.push('');
        lines.push(new Style().foreground(TAN).bold().render('  You'));
        for (const line of msg.content.split('\n')) {
          lines.push('  ' + line);
        }
        break;

      case 'assistant':
        lines.push('');
        lines.push(new Style().foreground(CREAM).bold().render('  Kaldi'));
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
        lines.push(new Style().foreground(SKY_BLUE).bold().render(`  [${msg.toolName}]`));
        const outputLines = msg.content.split('\n').slice(0, 6);
        for (const l of outputLines) {
          lines.push('  ' + new Style().foreground(GRAY).render(truncate(l, width - 6)));
        }
        if (msg.content.split('\n').length > 6) {
          lines.push(new Style().foreground(DARK_GRAY).render('    ...(truncated)'));
        }
        break;

      case 'error':
        lines.push('');
        lines.push(new Style().foreground(RED).bold().render('  Error'));
        lines.push('  ' + new Style().foreground(RED).render(msg.content));
        break;
    }
  }

  return lines.join('\n');
}

// ============================================================================
// View Components
// ============================================================================

function renderHeader(model: AppModel): string {
  // Kaldi ASCII art (small version)
  const kaldiArt = model.state === 'thinking'
    ? new Style().foreground(CREAM).render('  /\\_/\\  ')
    : new Style().foreground(CREAM).render('  /\\_/\\  ');

  // Title
  const title = new Style().foreground(CREAM).bold().render('Puppuccino');
  const version = new Style().foreground(GRAY).render(` v${VERSION}`);

  // Status indicator with animation
  let statusIcon: string;
  let statusText: string;
  let statusColor = GREEN;

  switch (model.state) {
    case 'thinking':
      // Animated dots based on frame count
      const dots = '.'.repeat((model.frameCount % 4));
      statusIcon = Spinner.view(model.spinner);
      statusText = `thinking${dots}`;
      statusColor = GOLD;
      break;
    case 'permission':
      statusIcon = '⚠';
      statusText = 'permission needed';
      statusColor = GOLD;
      break;
    default:
      statusIcon = '●';
      statusText = 'ready';
      statusColor = GREEN;
  }

  const status = new Style().foreground(statusColor).render(`${statusIcon} ${statusText}`);

  // Build header content
  const leftContent = `${kaldiArt}${title}${version}`;
  const rightContent = status;
  const padding = model.width - 28 - statusText.length - 6;
  const spacer = ' '.repeat(Math.max(1, padding));

  return new Style()
    .border(RoundedBorder, true)
    .borderForeground(TAN)
    .width(model.width - 2)
    .paddingLeft(1)
    .paddingRight(1)
    .render(leftContent + spacer + rightContent);
}

function renderChat(model: AppModel): string {
  const contentHeight = model.height - 10;
  const contentWidth = model.width - 6;

  // Build content
  let content = formatMessages(model.messages, model.theme, contentWidth);

  // Add current streaming response
  if (model.currentResponse) {
    content += '\n\n' + new Style().foreground(CREAM).bold().render('  Kaldi');
    content += '\n  ' + model.currentResponse;

    // Add blinking cursor at end when streaming
    if (model.state === 'thinking') {
      const cursor = model.frameCount % 2 === 0 ? '█' : ' ';
      content += new Style().foreground(GREEN).render(cursor);
    }
  }

  // Add thinking indicator with animated spinner
  if (model.state === 'thinking' && !model.currentResponse) {
    const spinnerFrame = Spinner.view(model.spinner);
    content += '\n\n  ' + new Style().foreground(GOLD).render(spinnerFrame) + ' ' +
      new Style().foreground(GRAY).render('Thinking...');
  }

  // Welcome message if no content
  if (!content.trim()) {
    const welcome = [
      '',
      new Style().foreground(CREAM).render('      /\\_/\\'),
      new Style().foreground(CREAM).render('     ( o.o )  ') + new Style().foreground(TAN).render('Woof!'),
      new Style().foreground(CREAM).render('      > ^ <'),
      '',
      new Style().foreground(GRAY).render('  Hi! I\'m Kaldi, your coding companion.'),
      new Style().foreground(GRAY).render('  Ask me anything or type /help for commands.'),
      '',
    ].join('\n');
    content = welcome;
  }

  // Update viewport
  let viewport = Viewport.setContent(
    Viewport.setSize(model.viewport, contentWidth, Math.max(1, contentHeight)),
    content
  );
  viewport = Viewport.scrollToBottom(viewport);

  return new Style()
    .border(RoundedBorder, true)
    .borderForeground(DARK_GRAY)
    .width(model.width - 2)
    .height(contentHeight + 2)
    .render(Viewport.view(viewport));
}

function renderPermission(model: AppModel): string {
  if (!permissionRequest) return '';

  const { toolName, toolInput } = permissionRequest;
  const inputStr = JSON.stringify(toolInput, null, 2);
  const preview = inputStr.length > 200 ? inputStr.slice(0, 200) + '...' : inputStr;

  const yesStyle = model.permissionSelected === 0
    ? new Style().foreground(rgb(0, 0, 0)).background(GREEN).bold()
    : new Style().foreground(GRAY);
  const noStyle = model.permissionSelected === 1
    ? new Style().foreground(rgb(0, 0, 0)).background(RED).bold()
    : new Style().foreground(GRAY);

  const content = [
    '',
    new Style().foreground(GOLD).bold().render(`  Tool: ${toolName}`),
    '',
    new Style().foreground(GRAY).render(preview.split('\n').slice(0, 5).map(l => '  ' + l).join('\n')),
    '',
    '  ' + yesStyle.render(' Y Allow ') + '    ' + noStyle.render(' N Deny '),
    '',
  ].join('\n');

  return new Style()
    .border(RoundedBorder, true)
    .borderForeground(GOLD)
    .width(model.width - 4)
    .render(content);
}

function renderInput(model: AppModel): string {
  if (model.state !== 'idle') {
    return ''; // Hide input when not idle
  }

  const promptStyle = new Style().foreground(TAN).bold();
  const prompt = promptStyle.render(' ❯ ');

  // Show cursor character with blink
  const value = model.input.value;
  const cursor = model.input.cursor;
  const before = value.slice(0, cursor);
  const cursorChar = value[cursor] || ' ';
  const after = value.slice(cursor + 1);

  // Blinking cursor
  const cursorVisible = model.frameCount % 2 === 0;
  const cursorStyle = cursorVisible
    ? new Style().foreground(rgb(0, 0, 0)).background(GREEN)
    : new Style();
  const inputDisplay = before + cursorStyle.render(cursorChar) + after;

  const placeholder = !value
    ? new Style().foreground(GRAY).render('Ask Kaldi anything...')
    : inputDisplay;

  return new Style()
    .border(RoundedBorder, true)
    .borderForeground(GREEN)
    .width(model.width - 2)
    .render(prompt + (value ? inputDisplay : placeholder));
}

function renderHelp(model: AppModel): string {
  let bindings: string;

  if (model.state === 'permission') {
    bindings = new Style().foreground(GRAY).render(
      '  y') + new Style().foreground(DARK_GRAY).render(' allow  ') +
      new Style().foreground(GRAY).render('n') + new Style().foreground(DARK_GRAY).render(' deny  ') +
      new Style().foreground(GRAY).render('tab') + new Style().foreground(DARK_GRAY).render(' switch');
  } else if (model.state === 'thinking') {
    bindings = new Style().foreground(GRAY).render(
      '  ctrl+c') + new Style().foreground(DARK_GRAY).render(' cancel');
  } else {
    bindings = new Style().foreground(GRAY).render(
      '  enter') + new Style().foreground(DARK_GRAY).render(' send  ') +
      new Style().foreground(GRAY).render('/help') + new Style().foreground(DARK_GRAY).render(' commands  ') +
      new Style().foreground(GRAY).render('ctrl+c') + new Style().foreground(DARK_GRAY).render(' quit');
  }

  return bindings;
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
    frameCount: 0,
    _config: config,
    _provider: createProviderInstance(config),
    _tools: createToolRegistry(),
    _sessionManager: sessionManager,
    _hooks: createHooksRunner(config.hooks),
    _permissions: permissions,

    init(): Cmd<AppMsg> {
      // Start the animation tick loop immediately
      return tickCmd();
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
    }, tickCmd()];
  }

  if (isKeyMsg(msg)) {
    return handleKeyMsg(model, msg);
  }

  switch ((msg as AppMsg).type) {
    case 'tick': {
      // Update frame count and spinner
      let newModel = {
        ...model,
        frameCount: model.frameCount + 1,
        spinner: Spinner.tick(model.spinner),
      };

      // Check for permission requests
      if (permissionRequest && model.state !== 'permission') {
        newModel = {
          ...newModel,
          state: 'permission',
          permissionSelected: 0,
        };
      }

      // Process queued agent events
      while (eventQueue.length > 0) {
        const event = eventQueue.shift()!;
        newModel = processAgentEvent(newModel, event);
      }

      // Check if agent finished
      if (!agentRunning && model.state === 'thinking' && !permissionRequest) {
        if (agentError) {
          const error = agentError;
          agentError = null;
          newModel = {
            ...newModel,
            state: 'idle',
            messages: [...newModel.messages, { role: 'error', content: error }],
            currentResponse: '',
          };
        } else if (newModel.currentResponse) {
          // Agent done - save response
          newModel = {
            ...newModel,
            state: 'idle',
            messages: [...newModel.messages, { role: 'assistant', content: newModel.currentResponse }],
            currentResponse: '',
          };
        } else {
          newModel = {
            ...newModel,
            state: 'idle',
          };
        }
      }

      // Continue ticking
      return [newModel, tickCmd()];
    }

    case 'permissionResponse': {
      if (permissionRequest) {
        permissionRequest.resolve((msg as PermissionResponseMsg).approved);
        permissionRequest = null;
      }
      return [{
        ...model,
        state: 'thinking',
      }, tickCmd()];
    }

    default:
      return [model, tickCmd()];
  }
}

function processAgentEvent(model: AppModel, event: AgentEvent): AppModel {
  switch (event.type) {
    case 'text_delta':
      return {
        ...model,
        currentResponse: model.currentResponse + event.delta,
      };

    case 'text':
      // Full text replaces current response
      return {
        ...model,
        currentResponse: event.content,
      };

    case 'tool_start':
      return {
        ...model,
        messages: [...model.messages, {
          role: 'tool' as const,
          content: JSON.stringify(event.input, null, 2),
          toolName: event.name,
        }],
      };

    case 'tool_result':
      if (event.result.success) {
        const output = event.result.output;
        return {
          ...model,
          messages: [...model.messages, {
            role: 'tool' as const,
            content: output.length > 400 ? output.slice(0, 400) + '...' : output,
            toolName: 'output',
          }],
        };
      } else {
        return {
          ...model,
          messages: [...model.messages, {
            role: 'error' as const,
            content: event.result.error || 'Tool execution failed',
          }],
        };
      }

    case 'tool_denied':
      return {
        ...model,
        messages: [...model.messages, {
          role: 'error' as const,
          content: `Permission denied: ${event.reason}`,
        }],
      };

    case 'error':
      return {
        ...model,
        messages: [...model.messages, {
          role: 'error' as const,
          content: event.error,
        }],
      };

    default:
      return model;
  }
}

function handleKeyMsg(model: AppModel, msg: KeyMsg): [AppModel, Cmd<AppMsg>] {
  // Ctrl+C always quits
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
      }, tickCmd()];
    }
    if (msg.key === Key.Enter) {
      return updateModel(model, { type: 'permissionResponse', approved: model.permissionSelected === 0 });
    }
    return [model, tickCmd()];
  }

  // Thinking state - only allow quit
  if (model.state === 'thinking') {
    return [model, tickCmd()];
  }

  // Idle state - text input
  if (model.state === 'idle') {
    if (msg.key === Key.Enter) {
      const value = model.input.value.trim();
      if (!value) return [model, tickCmd()];

      if (value.startsWith('/')) {
        return handleCommand(model, value);
      }

      return submitToAgent(model, value);
    }

    if (msg.key === Key.Backspace) {
      return [{ ...model, input: TextInput.backspace(model.input) }, tickCmd()];
    }

    if (msg.key === Key.Delete) {
      return [{ ...model, input: TextInput.delete(model.input) }, tickCmd()];
    }

    if (msg.key === Key.Left) {
      return [{ ...model, input: TextInput.cursorLeft(model.input) }, tickCmd()];
    }

    if (msg.key === Key.Right) {
      return [{ ...model, input: TextInput.cursorRight(model.input) }, tickCmd()];
    }

    if (msg.key === Key.Home) {
      return [{ ...model, input: TextInput.cursorStart(model.input) }, tickCmd()];
    }

    if (msg.key === Key.End) {
      return [{ ...model, input: TextInput.cursorEnd(model.input) }, tickCmd()];
    }

    if (msg.isCtrl('u')) {
      return [{ ...model, input: TextInput.clear(model.input) }, tickCmd()];
    }

    if (msg.isCtrl('w')) {
      return [{ ...model, input: TextInput.deleteWordBackward(model.input) }, tickCmd()];
    }

    // Regular character
    if (msg.sequence && msg.sequence.length === 1 && !msg.ctrl && !msg.alt) {
      return [{ ...model, input: TextInput.insert(model.input, msg.sequence) }, tickCmd()];
    }
  }

  return [model, tickCmd()];
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
      }, tickCmd()];

    case 'h':
    case 'help':
    case '?':
      return [{
        ...model,
        messages: [...model.messages, {
          role: 'assistant' as const,
          content: `Commands:
  /help, /?     Show this help
  /clear, /c    Clear conversation
  /quit, /q     Exit Puppuccino

Tips:
  Just type your message and press Enter
  Kaldi can read, write, and edit files
  Kaldi can run shell commands
  Press Ctrl+C to quit anytime`,
        }],
        input: TextInput.clear(model.input),
      }, tickCmd()];

    default:
      return [{
        ...model,
        messages: [...model.messages, {
          role: 'error' as const,
          content: `Unknown command: /${cmd}`,
        }],
        input: TextInput.clear(model.input),
      }, tickCmd()];
  }
}

function submitToAgent(model: AppModel, userInput: string): [AppModel, Cmd<AppMsg>] {
  const newMessages: ChatMessage[] = [...model.messages, { role: 'user', content: userInput }];

  const userMessage: Message = { role: 'user', content: userInput };
  model._sessionManager.addMessage(userMessage);

  // Start agent in background (non-blocking)
  startAgentLoop(model);

  return [{
    ...model,
    state: 'thinking',
    messages: newMessages,
    currentResponse: '',
    input: TextInput.clear(model.input),
  }, tickCmd()];
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
      streaming: true,
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

function tickCmd(): Cmd<AppMsg> {
  // Single unified tick at ~30fps for smooth animation
  return tick(33, () => ({ type: 'tick' } as TickMsg));
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
    title: 'Puppuccino',
  });

  await program.run();
}

export { createAppModel, AppModel, AppMsg };
