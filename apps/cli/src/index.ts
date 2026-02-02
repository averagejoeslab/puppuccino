#!/usr/bin/env node
/**
 * Puppuccino CLI - AI coding agent for the terminal
 *
 * Features Kaldi the Great Pyrenees as your helpful coding companion.
 * Now with a beautiful TUI using the Elm Architecture!
 */

import yargs from 'yargs';
import { hideBin } from 'yargs/helpers';

import {
  loadConfig,
  createProviderInstance,
  createToolRegistry,
  createSessionManager,
  createPermissionChecker,
  runAgentLoop,
  createAgentState,
  DEFAULT_SYSTEM_PROMPT,
  type Message,
  type AgentEvent,
  VERSION,
} from '@averagejoeslab/puppuccino-core';

import { startServer } from '@averagejoeslab/puppuccino-server';
import { runChat } from './chat.js';

/**
 * One-shot query mode (non-interactive)
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
      await runChat({
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
