#!/usr/bin/env bun
/**
 * Puppuccino CLI - AI coding agent for the terminal
 *
 * Features Kaldi the Great Pyrenees as your helpful coding companion.
 */

import yargs from 'yargs';
import { hideBin } from 'yargs/helpers';
import { createInterface } from 'node:readline';

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

import {
  getWelcomeBanner,
  getGoodbyeBanner,
  getPrompt,
  getTheme,
  KALDI,
} from '@averagejoeslab/puppuccino-tui';

import { startServer } from '@averagejoeslab/puppuccino-server';
import { Style } from '@averagejoeslab/style';

/**
 * Print styled output
 */
function print(text: string): void {
  process.stdout.write(text);
}

function println(text: string = ''): void {
  console.log(text);
}

/**
 * Interactive chat mode
 */
async function runInteractive(options: {
  resume?: string;
  continue?: boolean;
  theme?: string;
  yolo?: boolean;
}): Promise<void> {
  // Load config
  const config = loadConfig(process.cwd());
  const theme = getTheme(options.theme || config.theme || 'kaldi');

  // Initialize components
  const provider = createProviderInstance(config);
  const tools = createToolRegistry();
  const sessionManager = createSessionManager();
  const hooks = createHooksRunner(config.hooks);
  const permissions = createPermissionChecker(config.permissions);

  if (options.yolo) {
    permissions.enableYolo();
  }

  // Resume or start session
  if (options.resume) {
    const session = sessionManager.resume(options.resume);
    if (!session) {
      println(theme.styles.error.render(`Session not found: ${options.resume}`));
      process.exit(1);
    }
    println(theme.styles.info.render(`Resumed session: ${session.id}`));
  } else if (options.continue) {
    const session = sessionManager.resumeRecent();
    if (session) {
      println(theme.styles.info.render(`Continued session: ${session.id}`));
    } else {
      sessionManager.start({ projectPath: process.cwd(), model: config.model });
    }
  } else {
    sessionManager.start({ projectPath: process.cwd(), model: config.model });
  }

  // Print welcome banner
  println(getWelcomeBanner(VERSION));
  println(theme.styles.dim.render(`Model: ${config.model}`));
  println(theme.styles.dim.render(`Working directory: ${process.cwd()}`));
  println();

  // Create readline interface
  const rl = createInterface({
    input: process.stdin,
    output: process.stdout,
  });

  const promptStr = getPrompt();

  // Main loop
  const askQuestion = (): void => {
    rl.question(promptStr, async (input) => {
      const trimmed = input.trim();

      // Handle empty input
      if (!trimmed) {
        askQuestion();
        return;
      }

      // Handle commands
      if (trimmed.startsWith('/')) {
        const [cmd, ...args] = trimmed.slice(1).split(/\s+/);

        switch (cmd.toLowerCase()) {
          case 'q':
          case 'quit':
          case 'exit':
            println(getGoodbyeBanner());
            sessionManager.save();
            rl.close();
            process.exit(0);
            break;

          case 'c':
          case 'clear':
            sessionManager.clear();
            println(theme.styles.info.render('Conversation cleared.'));
            break;

          case 'h':
          case 'help':
          case '?':
            println(`
${theme.styles.heading.render('Commands:')}
  /help, /?     - Show this help
  /clear, /c    - Clear conversation
  /quit, /q     - Exit Puppuccino

${theme.styles.heading.render('Tips:')}
  - Just type your message and press Enter
  - Kaldi can read, write, and edit files
  - Kaldi can execute shell commands
  - Press Ctrl+C to cancel current operation
`);
            break;

          default:
            println(theme.styles.warning.render(`Unknown command: /${cmd}`));
        }

        askQuestion();
        return;
      }

      // Add user message
      const userMessage: Message = { role: 'user', content: trimmed };
      sessionManager.addMessage(userMessage);

      // Create agent state
      const session = sessionManager.current!;
      const agentState = createAgentState(provider, tools, {
        messages: session.messages,
        hooks,
        permissions,
        systemPrompt: config.agent?.systemPrompt || DEFAULT_SYSTEM_PROMPT,
        maxTurns: config.agent?.maxTurns,
        onPermissionRequest: async (toolName, toolInput) => {
          // For interactive mode, ask user
          return new Promise((resolve) => {
            const inputStr = JSON.stringify(toolInput, null, 2);
            println();
            println(theme.styles.warning.render(`Tool requires permission: ${toolName}`));
            println(theme.styles.dim.render(inputStr.slice(0, 200)));
            rl.question('Allow? [y/N] ', (answer) => {
              resolve(answer.toLowerCase() === 'y' || answer.toLowerCase() === 'yes');
            });
          });
        },
      });

      println();

      // Run agent loop
      try {
        for await (const event of runAgentLoop(agentState)) {
          handleEvent(event, theme);
        }
      } catch (err) {
        println(theme.styles.error.render(`Error: ${err instanceof Error ? err.message : String(err)}`));
      }

      // Save session
      sessionManager.save();

      println();
      askQuestion();
    });
  };

  // Handle Ctrl+C
  rl.on('SIGINT', () => {
    println();
    println(getGoodbyeBanner());
    sessionManager.save();
    process.exit(0);
  });

  askQuestion();
}

/**
 * Handle agent events
 */
function handleEvent(event: AgentEvent, theme: ReturnType<typeof getTheme>): void {
  switch (event.type) {
    case 'thinking':
      print(theme.styles.dim.render('Thinking...'));
      break;

    case 'text':
      // Clear the "Thinking..." line and print text
      print('\r\x1b[K'); // Clear line
      println(event.content);
      break;

    case 'tool_start':
      println();
      println(theme.styles.toolName.render(`[${event.name}]`));
      const inputPreview = JSON.stringify(event.input, null, 2);
      if (inputPreview.length > 200) {
        println(theme.styles.dim.render(inputPreview.slice(0, 200) + '...'));
      } else {
        println(theme.styles.dim.render(inputPreview));
      }
      break;

    case 'tool_result':
      if (event.result.success) {
        const output = event.result.output;
        if (output.length > 500) {
          println(theme.styles.toolOutput.render(output.slice(0, 500) + '\n...(truncated)'));
        } else {
          println(theme.styles.toolOutput.render(output));
        }
      } else {
        println(theme.styles.error.render(`Error: ${event.result.error}`));
      }
      break;

    case 'tool_denied':
      println(theme.styles.warning.render(`Permission denied: ${event.reason}`));
      break;

    case 'error':
      println(theme.styles.error.render(`Error: ${event.error}`));
      break;

    case 'done':
      // Done
      break;
  }
}

/**
 * One-shot query mode
 */
async function runQuery(prompt: string, options: {
  output?: 'text' | 'json';
  sessionId?: string;
}): Promise<void> {
  const config = loadConfig(process.cwd());
  const provider = createProviderInstance(config);
  const tools = createToolRegistry();
  const sessionManager = createSessionManager();
  const permissions = createPermissionChecker(config.permissions);

  // Auto-approve in non-interactive mode
  permissions.enableYolo();

  // Get or create session
  if (options.sessionId) {
    sessionManager.resume(options.sessionId);
  } else {
    sessionManager.start({ projectPath: process.cwd(), model: config.model });
  }

  // Add user message
  const userMessage: Message = { role: 'user', content: prompt };
  sessionManager.addMessage(userMessage);

  const session = sessionManager.current!;
  const agentState = createAgentState(provider, tools, {
    messages: session.messages,
    permissions,
    systemPrompt: config.agent?.systemPrompt || DEFAULT_SYSTEM_PROMPT,
    maxTurns: config.agent?.maxTurns,
  });

  // Collect response
  const events: AgentEvent[] = [];
  const texts: string[] = [];

  for await (const event of runAgentLoop(agentState)) {
    events.push(event);
    if (event.type === 'text') {
      texts.push(event.content);
    }
  }

  sessionManager.save();

  // Output
  if (options.output === 'json') {
    console.log(JSON.stringify({
      sessionId: session.id,
      response: texts.join(''),
      events,
    }, null, 2));
  } else {
    console.log(texts.join(''));
  }
}

/**
 * Main CLI
 */
const cli = yargs(hideBin(process.argv))
  .scriptName('puppuccino')
  .usage('$0 [command] [options]')
  .command(
    ['$0', 'chat'],
    'Start interactive chat mode',
    (yargs) => yargs
      .option('resume', {
        alias: 'r',
        type: 'string',
        description: 'Resume a specific session',
      })
      .option('continue', {
        alias: 'c',
        type: 'boolean',
        description: 'Continue the most recent session',
      })
      .option('theme', {
        alias: 't',
        type: 'string',
        choices: ['kaldi', 'dark', 'light'],
        description: 'Color theme',
      })
      .option('yolo', {
        type: 'boolean',
        description: 'Auto-approve all tool executions',
      }),
    async (argv) => {
      await runInteractive({
        resume: argv.resume,
        continue: argv.continue,
        theme: argv.theme,
        yolo: argv.yolo,
      });
    }
  )
  .command(
    'query <prompt>',
    'Send a one-shot query',
    (yargs) => yargs
      .positional('prompt', {
        type: 'string',
        description: 'The prompt to send',
        demandOption: true,
      })
      .option('output', {
        alias: 'o',
        type: 'string',
        choices: ['text', 'json'],
        default: 'text',
        description: 'Output format',
      })
      .option('session', {
        alias: 's',
        type: 'string',
        description: 'Session ID to use',
      }),
    async (argv) => {
      await runQuery(argv.prompt as string, {
        output: argv.output as 'text' | 'json',
        sessionId: argv.session,
      });
    }
  )
  .command(
    'serve',
    'Start the HTTP server',
    (yargs) => yargs
      .option('port', {
        alias: 'p',
        type: 'number',
        default: 3000,
        description: 'Port to listen on',
      }),
    async (argv) => {
      startServer({ port: argv.port });
    }
  )
  .command(
    'version',
    'Show version',
    {},
    () => {
      console.log(`Puppuccino v${VERSION}`);
    }
  )
  .help()
  .alias('h', 'help')
  .version(false)
  .strict();

// Run
cli.parse();
