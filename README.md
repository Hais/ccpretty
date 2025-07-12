# ccpretty - Claude Code Pretty Formatter

A powerful CLI tool that transforms Claude Code JSON logs into beautiful, human-readable output with colored boxes and intelligent formatting. Features real-time Slack integration for collaborative workflow monitoring.

## ✨ Features

- **🎨 Pretty Formatting**: Transforms JSON logs into colored, boxed terminal output
- **📝 Message Type Support**: Handles assistant, user, system, and result messages with distinct styling
- **✅ TodoWrite Integration**: Displays todo lists with emoji status indicators and progress tracking
- **💬 Slack Integration**: Real-time updates to Slack threads with workflow status reactions
- **🔄 Streaming Support**: Processes multi-line JSON objects in real-time as they arrive
- **🛡️ Robust Error Handling**: Graceful handling of malformed messages and Claude Code crashes
- **⚡ Crash Recovery**: Timeout detection and automatic session finalization
- **🔗 GitHub Actions Integration**: Automatic detection and linking of GitHub Actions runs
- **📦 Programmatic API**: Export functions for use in other Node.js applications

## 📦 Installation

### From npm (Recommended)
```bash
npm install -g @hais/ccpretty
```

### From Source
```bash
git clone https://github.com/Hais/ccpretty.git
cd ccpretty
npm install
npm run build
npm install -g .
```

### Verify Installation
```bash
ccpretty --help
```

## 🚀 Usage

### Basic Usage
```bash
# Pipe Claude Code logs through ccpretty for pretty terminal output
claude -p "Hello world" --output-format stream-json --verbose | ccpretty

# Process a saved log file
ccpretty < claude-session.log

# Enable debug mode
CCPRETTY_DEBUG=1 claude -p "Hello world" --output-format stream-json --verbose | ccpretty
```

### Slack Integration
```bash
# Set up Slack environment variables
export CCPRETTY_SLACK_TOKEN=xoxb-your-token
export CCPRETTY_SLACK_CHANNEL=#channel-name

# Run with Slack updates
claude -p "Hello world" --output-format stream-json --verbose | ccpretty

# Continue in existing thread (manual)
export CCPRETTY_SLACK_THREAD_TS=1234567890.123456
claude -p "Hello world" --output-format stream-json --verbose | ccpretty

# Resume last thread automatically
ccpretty --resume-slack-thread < claude-session.log
```

### Programmatic Usage
```typescript
import { runWithClaude } from '@hais/ccpretty/run-with-claude';
import { formatAssistantMessage } from '@hais/ccpretty/formatters';

// Run Claude Code with ccpretty integration
await runWithClaude(['claude', '-p', 'Hello world']);

// Use formatters directly
const formatted = formatAssistantMessage(message);
```

## 💬 Slack Integration

### Features
When Slack environment variables are configured, ccpretty automatically:

- 🧵 **Thread Management**: Creates new threads or resumes existing ones
- 📊 **Session Tracking**: Posts initialization with session ID and available tools
- 💬 **Real-time Updates**: Streams assistant messages and tool usage
- 🎯 **Status Reactions**: Visual workflow status (🚀 → ✅ or 🚨)
- ⏳ **Live Progress**: Tool execution status (⏳ → ✅ or ❌)
- 📝 **Smart Grouping**: Combines consecutive assistant messages
- 🚫 **Deduplication**: Skips identical messages
- 💾 **Auto-resume**: Saves thread timestamp for `--resume-slack-thread`

### Required Bot Permissions

Your Slack bot needs these permissions:

| Permission | Purpose |
|------------|---------|
| `assistant:write` | Act as an App Agent |
| `chat:write` | Send messages as ccpretty |
| `chat:write.customize` | Custom username and avatar |
| `emoji:read` | View custom workspace emoji |
| `reactions:read` | View emoji reactions and content |
| `reactions:write` | Add and edit emoji reactions |
| `channels:history` | View messages in public channels |

## ⚙️ Configuration

### Environment Variables

#### Slack Integration
| Variable | Description | Example |
|----------|-------------|---------|
| `CCPRETTY_SLACK_TOKEN` | Slack bot token | `xoxb-your-token` |
| `CCPRETTY_SLACK_CHANNEL` | Channel to post to | `#dev-logs` |
| `CCPRETTY_SLACK_THREAD_TS` | Existing thread timestamp | `1234567890.123456` |

#### Custom Session Display
| Variable | Description | Default |
|----------|-------------|---------|
| `CCPRETTY_TITLE` | Custom session title | "Claude Code Session Started" |
| `CCPRETTY_DESCRIPTION` | Session description | Auto-generated |
| `CCPRETTY_URL` | Custom session URL | GitHub Actions URL (if detected) |

#### Debug and Logging
| Variable | Description | Values |
|----------|-------------|--------|
| `CCPRETTY_DEBUG` | Enable debug logging | `1` or `0` |
| `CCPRETTY_SLACK_DEBUG` | Slack API debug log file | `/path/to/logfile` |

### Configuration Files

ccpretty supports multiple configuration methods (in order of precedence):

1. **Environment variables** (highest priority)
2. **Local `.env` file** in project directory
3. **Global `~/.ccpretty.env` file** for system-wide settings

### Example Configuration

```bash
# ~/.ccpretty.env
CCPRETTY_SLACK_TOKEN=xoxb-your-token
CCPRETTY_SLACK_CHANNEL=#dev-logs
CCPRETTY_TITLE="Data Pipeline Workflow"
CCPRETTY_DESCRIPTION="Processing analytics data"
CCPRETTY_DEBUG=1
```

## 🛠️ Development

### Setup
```bash
# Clone and install
git clone https://github.com/Hais/ccpretty.git
cd ccpretty
npm install
```

### Development Commands
```bash
# Development mode (TypeScript watch)
npm run dev

# Build project
npm run build

# Test locally
npm run ccpretty

# Run test suite
npm test

# Watch mode testing
npm run test:watch

# Coverage report
npm run test:coverage
```

### Test Suites
```bash
# Individual test files
npm test -- tests/formatters.test.ts          # Message formatting
npm test -- tests/slack.test.ts               # Slack integration
npm test -- tests/cli-integration.test.ts     # CLI functionality
npm test -- tests/models.test.ts              # Type definitions
```

## 📋 Message Types

ccpretty handles different Claude Code message types with distinct styling:

| Type | Appearance | Content |
|------|------------|---------|
| **Assistant** | 🔵 Blue boxes | Tool usage detection, formatted responses |
| **User** | 🟢 Green boxes | Tool results, user input |
| **System** | 🟣 Magenta boxes | Session events, initialization |
| **Result** | ✅/❌ Success/Error | Metrics (duration, cost, turns) |

### Special Formatting
- **TodoWrite**: Emoji-decorated lists with status tracking
- **Tool Usage**: Command descriptions and execution status
- **Session Results**: Duration, API time, cost summaries

## 🔧 CLI Options

```bash
ccpretty [options]

Options:
  --resume-slack-thread    Resume posting to the last used Slack thread
  --help                   Show help information
  --version                Show version number
```

## 📚 API Reference

### Package Exports

```typescript
// Main CLI application
import ccpretty from '@hais/ccpretty';

// Message formatting functions
import { formatAssistantMessage, formatUserMessage } from '@hais/ccpretty/formatters';

// TypeScript type definitions
import { AssistantMessage, UserMessage, SystemMessage } from '@hais/ccpretty/models';

// Slack integration utilities
import { createSlackClient, postToSlack } from '@hais/ccpretty/slack';

// Helper function for running Claude Code with ccpretty
import { runWithClaude } from '@hais/ccpretty/run-with-claude';
```

### Key Functions

#### `runWithClaude(args: string[]): Promise<void>`
Programmatically run Claude Code with ccpretty integration:
```typescript
await runWithClaude(['claude', '-p', 'Hello world']);
```

#### Message Formatters
Format individual messages for terminal display:
```typescript
const formatted = formatAssistantMessage(assistantMsg);
const userFormatted = formatUserMessage(userMsg);
```

## 🤝 Contributing

1. Fork the repository
2. Create a feature branch: `git checkout -b feature-name`
3. Make your changes with tests
4. Run the test suite: `npm test`
5. Submit a pull request

## 📄 License

MIT License - see LICENSE file for details.

## 🔗 Links

- [Claude Code Documentation](https://docs.anthropic.com/en/docs/claude-code)
- [GitHub Repository](https://github.com/Hais/ccpretty)
- [npm Package](https://www.npmjs.com/package/@hais/ccpretty)