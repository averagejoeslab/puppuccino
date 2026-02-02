# Puppuccino

AI coding agent for the terminal, featuring Kaldi the Great Pyrenees.

```
    / \__
   (    @\___
   /         O
  /   (_____/
 /_____/   U
```

## Features

- **Agentic Coding** - Kaldi can read, write, edit files, search code, and execute commands
- **Multiple Providers** - Works with Anthropic, OpenAI, Groq, and local models
- **Beautiful TUI** - Terminal interface built with the @averagejoeslab packages
- **Client-Server Architecture** - HTTP server for remote access and integrations
- **Session Management** - Persistent conversation history with resume support
- **MCP Integration** - Extend with Model Context Protocol tools
- **Hooks System** - Lifecycle hooks for custom workflows
- **Skills** - Reusable prompt templates

## Installation

```bash
# Install globally
bun install -g puppuccino

# Or run directly
bunx puppuccino
```

## Quick Start

```bash
# Set your API key
export ANTHROPIC_API_KEY=your-key-here

# Start interactive mode
puppuccino

# One-shot query
puppuccino query "What files are in this directory?"

# Continue previous session
puppuccino --continue

# Start HTTP server
puppuccino serve --port 3000
```

## Commands

| Command | Description |
|---------|-------------|
| `puppuccino` | Start interactive chat mode |
| `puppuccino query <prompt>` | One-shot query |
| `puppuccino serve` | Start HTTP server |
| `puppuccino --continue` | Continue last session |
| `puppuccino --resume <id>` | Resume specific session |

### Interactive Commands

| Command | Description |
|---------|-------------|
| `/help` | Show help |
| `/clear` | Clear conversation |
| `/quit` | Exit |

## Configuration

Create a `.puppuccino.json` in your project or `~/.config/puppuccino/config.json`:

```json
{
  "provider": "anthropic",
  "model": "claude-sonnet-4-20250514",
  "theme": "kaldi",
  "permissions": {
    "autoApprove": ["read", "glob", "grep"],
    "yolo": false
  },
  "mcpServers": {
    "github": {
      "transport": "stdio",
      "command": "mcp-server-github"
    }
  }
}
```

## Architecture

Puppuccino uses a monorepo structure:

```
puppuccino/
├── packages/
│   ├── core/       # Agent loop, tools, providers, MCP, hooks
│   ├── server/     # Hono HTTP/SSE server
│   ├── tui/        # Terminal UI with @averagejoeslab packages
│   └── sdk/        # Programmatic SDK
└── apps/
    └── cli/        # CLI entry point
```

### Built With

- **@averagejoeslab/tui** - Elm Architecture TUI framework
- **@averagejoeslab/widgets** - Terminal widgets (Spinner, TextInput, Viewport)
- **@averagejoeslab/markdown** - Terminal markdown rendering
- **@averagejoeslab/style** - CSS-like terminal styling
- **Hono** - Lightweight HTTP server
- **Vercel AI SDK** - Provider-agnostic LLM interface
- **Bun** - Fast JavaScript runtime

## SDK Usage

```typescript
import { createClient, query } from '@puppuccino/sdk';

// Simple query
const response = await query('What is 2 + 2?');
console.log(response);

// Full client
const client = createClient({
  model: 'claude-sonnet-4-20250514',
});

// Stream response
for await (const event of client.stream('Explain this code')) {
  if (event.type === 'text') {
    process.stdout.write(event.content);
  }
}
```

## API Endpoints

When running `puppuccino serve`:

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/health` | GET | Health check |
| `/chat` | POST | Stream chat (SSE) |
| `/query` | POST | One-shot query |
| `/sessions` | GET | List sessions |
| `/sessions/:id` | GET | Get session |
| `/sessions/:id` | DELETE | Delete session |
| `/tools` | GET | List available tools |
| `/tools/:name` | POST | Execute tool |

## Built-in Tools

| Tool | Description |
|------|-------------|
| `read` | Read file contents |
| `write` | Write to file |
| `edit` | Edit file (find/replace) |
| `glob` | Find files by pattern |
| `grep` | Search file contents |
| `bash` | Execute shell command |
| `ls` | List directory |

## Themes

- **kaldi** - Warm, friendly (default)
- **dark** - Dark mode
- **light** - Light mode

## Hooks

Add hooks in your config:

```json
{
  "hooks": {
    "PreToolUse": [{
      "event": "PreToolUse",
      "matcher": "bash",
      "type": "command",
      "command": "./scripts/validate.sh"
    }]
  }
}
```

## Skills

Create skills in `.puppuccino/skills/`:

```markdown
---
name: review
description: Review code for issues
allowedTools: [read, grep]
---

Review the code in this project for:
- Security issues
- Performance problems
- Code style violations
```

## Environment Variables

| Variable | Description |
|----------|-------------|
| `ANTHROPIC_API_KEY` | Anthropic API key |
| `OPENAI_API_KEY` | OpenAI API key |
| `GROQ_API_KEY` | Groq API key |
| `PUPPUCCINO_MODEL` | Default model |
| `PUPPUCCINO_DATA_DIR` | Data directory |

## Development

```bash
# Install dependencies
bun install

# Build all packages
bun run build

# Run CLI in dev mode
bun run dev

# Run tests
bun run test
```

## License

MIT

---

Made with love by Kaldi the Great Pyrenees
