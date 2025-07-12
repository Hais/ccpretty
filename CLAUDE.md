# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

ccpretty is a CLI tool that transforms Claude Code JSON logs into beautiful, human-readable output with colored boxes and intelligent formatting. It features real-time Slack integration for collaborative workflow monitoring and robust error handling for production use.

## Commands

### Development Commands
- **Build**: `npm run build` - Compiles TypeScript to JavaScript in `dist/`
- **Development**: `npm run dev` - Runs TypeScript compiler in watch mode
- **Test CLI**: `npm run ccpretty` - Run the compiled CLI tool locally
- **Install as CLI**: `npm install -g .` - Install globally to use `ccpretty` command

### Testing Commands
- **Tests**: `npm test` - Run test suite
- **Test Watch**: `npm run test:watch` - Run tests in watch mode
- **Test Coverage**: `npm run test:coverage` - Run tests with coverage report

### CLI Usage
- **Basic Usage**: `claude --output-format stream-json --verbose | ccpretty`
- **Resume Slack Thread**: `ccpretty --resume-slack-thread` - Resume posting to the last used thread
- **Debug Mode**: `CCPRETTY_DEBUG=1 ccpretty` - Enable detailed debug logging

### Slack Integration Setup
Set environment variables to enable Slack integration. Configuration methods (in order of precedence):
1. Environment variables: `export CCPRETTY_SLACK_TOKEN=xoxb-your-token` etc.
2. Local `.env` file in project directory
3. Global `~/.ccpretty.env` file for system-wide configuration

**Slack Debug Mode**: Set `export CCPRETTY_SLACK_DEBUG=/path/to/logfile` to log all Slack API calls to the specified file

### Important Files
- `.env.example` - Template for environment variables
- `~/.ccpretty_slack_ts` - Stores last Slack thread timestamp for auto-resume

## Architecture

This CLI tool transforms Claude Code JSON logs into human-readable output with colored boxes and intelligent formatting, featuring real-time Slack integration.

### Core Components

#### Main Application
- `src/index.ts` - Main CLI entry point with stdin processing and command-line argument handling
- `src/input-parser.ts` - Robust JSON extraction and parsing from streaming input with brace counting
- `src/models.ts` - TypeScript type definitions and type guards for Claude Code message formats

#### Output Systems
- `src/terminal-output.ts` - Terminal formatting and display logic with colored boxes
- `src/slack-output.ts` - Slack message posting, thread management, and status reactions
- `src/formatters.ts` - Message formatting functions with special TodoWrite handling

#### Integration Utilities
- `src/slack.ts` - Slack client wrapper and API utilities
- `src/run-with-claude.ts` - Helper function for programmatic Claude Code execution
- `src/github-utils.ts` - GitHub Actions environment detection and URL generation
- `src/rate-limiter.ts` - Simple rate limiter for Slack API calls to prevent hitting limits

### Data Flow

1. **Input Processing** (`src/input-parser.ts`)
   - Reads streaming JSON from stdin line by line
   - Uses brace counting to detect complete JSON objects across multiple lines
   - Extracts JSON using `@axync/extract-json` library for robust parsing
   - Handles partial JSON objects and streaming input gracefully

2. **Message Type Detection** (`src/models.ts`)
   - Type-checks and categorizes messages using TypeScript type guards
   - Supports assistant, user, system, and result message types
   - Validates message structure and content before processing

3. **Dual Output Processing**
   - **Terminal Output** (`src/terminal-output.ts`): Formats messages with colored, boxed output using `boxen` and `picocolors`
   - **Slack Output** (`src/slack-output.ts`): Posts formatted messages to Slack threads with status reactions and deduplication

4. **Enhanced Features**
   - **GitHub Integration** (`src/github-utils.ts`): Detects GitHub Actions environment and generates run URLs
   - **Rate Limiting** (`src/rate-limiter.ts`): Prevents hitting Slack API limits
   - **Error Handling**: Robust error handling prevents crashes when processing malformed or unexpected messages


### Message Types

The tool handles four main message types from Claude Code logs with distinct visual styling:

#### Assistant Messages (`AssistantMessage`)
- **Appearance**: Blue boxes with tool use detection
- **Special Handling**: TodoWrite tool calls formatted as emoji-decorated todo lists with status icons
- **Content**: AI responses, tool invocations, and reasoning

#### User Messages (`UserMessage`) 
- **Appearance**: Green boxes 
- **Content**: Tool results, user input, and command outputs
- **Features**: Syntax highlighting for code blocks and structured data

#### System Messages (`SystemMessage`)
- **Appearance**: Magenta boxes
- **Content**: Session initialization, system events, and configuration
- **Special**: GitHub Actions detection and session metadata

#### Result Messages (`ResultMessage`)
- **Appearance**: Success/error boxes with metrics
- **Content**: Session completion status, duration, API time, turns, and cost information
- **Status**: Visual indicators for success (✅) or failure (❌)

### Advanced Formatting Features

- **TodoWrite Integration**: Emoji-decorated todo lists with real-time status tracking (⏳ → ✅ or ❌)
- **Tool Usage Display**: Command descriptions and execution status with metadata
- **Session Metrics**: Comprehensive session summaries with duration, API time, and cost breakdown
- **Code Highlighting**: Syntax highlighting for code blocks and JSON structures
- **Smart Truncation**: Intelligent content truncation for Slack while preserving important information

### Slack Integration

When Slack environment variables are configured, the tool provides comprehensive real-time monitoring:

#### Automatic Thread Management
1. **Thread Creation**: Creates new Slack thread on the first significant event
2. **Thread Resumption**: Uses existing thread if `CCPRETTY_SLACK_THREAD_TS` is set or `--resume-slack-thread` flag is used
3. **Thread Persistence**: Saves thread timestamp to `~/.ccpretty_slack_ts` for automatic reuse

#### Smart Message Posting
Posts updates to the thread for significant events only:
- **Session Initialization**: Session ID, available tools, and GitHub Actions context
- **Assistant Messages**: Truncated to 2800 chars with smart content preservation
- **Tool Usage**: Command descriptions with live execution status updates
- **Session Results**: Completion status with duration, cost, and performance metrics

#### Visual Status Management
- **Workflow Status Reactions**: 🚀 (starting) → ✅ (success) or 🚨 (failure)
- **Tool Status Updates**: ⏳ (executing) → ✅ (success) or ❌ (error)
- **Message Grouping**: Consecutive assistant messages combined into numbered lists
- **Deduplication**: Skips posting identical messages to reduce noise

#### Configuration and Dependencies
- **Slack Client**: Uses `@slack/web-api` for reliable API communication
- **Rate Limiting**: Built-in rate limiting to respect Slack API limits
- **Startup Confirmation**: Prints active Slack configuration for verification

#### Required Bot Permissions
| Permission | Purpose |
|------------|---------|
| `assistant:write` | Allow ccpretty to act as an App Agent |
| `chat:write` | Send messages as ccpretty |
| `chat:write.customize` | Send messages with customized username and avatar |
| `emoji:read` | View custom emoji in workspace |
| `reactions:read` | View emoji reactions and content |
| `reactions:write` | Add and edit emoji reactions |
| `channels:history` | View messages in public channels |

#### Slack Debug Mode

Enable comprehensive debug logging of all Slack API interactions:

```bash
export CCPRETTY_SLACK_DEBUG=/path/to/logfile
ccpretty < claude-session.log
```

**Debug Log Contents:**
- Timestamps for each API call
- Full request payloads sent to Slack
- Response metadata (timestamps, success status)
- All API methods: `chat.postMessage`, `chat.update`, `reactions.add`, `reactions.remove`

**Use Cases:**
- Debugging Slack integration issues
- Understanding API call sequences
- Troubleshooting permission or configuration problems
- Performance analysis of Slack interactions

## Error Handling & Resilience

ccpretty is designed for production reliability with comprehensive error handling:

### Input Processing Errors
- **Malformed JSON**: Invalid JSON lines are logged and gracefully skipped
- **Partial Messages**: Incomplete JSON objects are buffered until complete
- **Stream Interruptions**: Handles broken input streams from upstream crashes
- **Encoding Issues**: Robust text processing handles various character encodings

### Message Processing Errors
- **Type Validation**: Invalid message types are logged but don't crash the application
- **Content Errors**: Malformed message content is sanitized and processed safely
- **Formatter Failures**: Individual message formatting errors don't stop the stream
- **Output Pipeline**: Terminal and Slack output errors are isolated and logged

### Debug and Monitoring
Set `CCPRETTY_DEBUG=1` to enable detailed error information:
- Full error stack traces
- Problematic message content logging
- Processing pipeline state information
- Performance timing information

### Claude Code Crash Recovery

ccpretty handles upstream Claude Code crashes gracefully:

#### Crash Detection Mechanisms
- **Timeout Detection**: 30-second timeout assumes upstream process crashed
- **Signal Handling**: Proper handling of SIGINT, SIGTERM, and other termination signals
- **Stdin Error Detection**: Detects broken input streams from process failures
- **Resource Cleanup**: Ensures proper cleanup of file handles and network connections

#### Graceful Finalization
- **Session Completion**: Automatically finalizes Slack sessions even without proper result messages
- **Status Updates**: Updates workflow status reactions to indicate premature termination
- **Partial Results**: Processes and displays any partial session data available
- **Error Reporting**: Clear error messages help diagnose upstream issues

## Helper Functions and APIs

### `runWithClaude` Function

The `runWithClaude` function in `src/run-with-claude.ts` provides programmatic access to run Claude Code with ccpretty integration:

```typescript
import { runWithClaude } from '@hais/ccpretty/run-with-claude';

// Run Claude Code with automatic ccpretty formatting
await runWithClaude(['claude', '-p', 'Hello world']);
```

**Features:**
- Captures Claude Code output to a temporary file
- Runs ccpretty on the output even if Claude Code crashes
- Provides clear error reporting for both Claude Code and ccpretty failures
- Handles process cleanup and error propagation
- Supports all Claude Code command-line arguments

### CLI Arguments

**Available Options:**
- `--resume-slack-thread` - Resume posting to the last used Slack thread (reads timestamp from `~/.ccpretty_slack_ts`)
- `--help` - Display help information and usage examples
- `--version` - Show current version number

## Environment Variables

ccpretty supports flexible configuration through multiple methods (in order of precedence):

### Configuration Sources
1. **Environment variables** (highest priority)
2. **Local `.env` file** in project directory
3. **Global `~/.ccpretty.env` file** for system-wide configuration

### Slack Integration Variables
| Variable | Description | Example |
|----------|-------------|---------|
| `CCPRETTY_SLACK_TOKEN` | Slack bot token | `xoxb-your-token` |
| `CCPRETTY_SLACK_CHANNEL` | Slack channel to post to | `#dev-logs` or `#general` |
| `CCPRETTY_SLACK_THREAD_TS` | Existing thread timestamp | `1234567890.123456` |

### Custom Session Display Variables
| Variable | Description | Default |
|----------|-------------|---------|
| `CCPRETTY_TITLE` | Custom session title | `"Claude Code Session Started"` |
| `CCPRETTY_DESCRIPTION` | Session description | Auto-generated from context |
| `CCPRETTY_URL` | Custom session URL | GitHub Actions URL (if detected) |

### Debug and Logging Variables
| Variable | Description | Values |
|----------|-------------|--------|
| `CCPRETTY_DEBUG` | Enable detailed debug logging | `1` (enabled) or `0` (disabled) |
| `CCPRETTY_SLACK_DEBUG` | Slack API debug log file path | `/path/to/logfile` |

### Configuration File Template
See `.env.example` for a complete template of available environment variables.

## Package Exports

ccpretty provides several exports for programmatic integration in Node.js applications:

### Export Modules

| Module | Purpose | Key Functions |
|--------|---------|---------------|
| `@hais/ccpretty` | Main CLI application | Primary entry point |
| `@hais/ccpretty/formatters` | Message formatting | `formatAssistantMessage`, `formatUserMessage`, `formatSystemMessage` |
| `@hais/ccpretty/models` | TypeScript types | `AssistantMessage`, `UserMessage`, `SystemMessage`, `ResultMessage` |
| `@hais/ccpretty/slack` | Slack integration | `createSlackClient`, `postToSlack`, `updateSlackMessage` |
| `@hais/ccpretty/run-with-claude` | Claude Code integration | `runWithClaude` |

### Example Usage

#### Programmatic Claude Code Execution
```typescript
import { runWithClaude } from '@hais/ccpretty/run-with-claude';

// Run Claude Code with automatic ccpretty formatting and Slack integration
await runWithClaude(['claude', '-p', 'Hello world']);
```

#### Direct Message Formatting
```typescript
import { formatAssistantMessage, formatUserMessage } from '@hais/ccpretty/formatters';
import { AssistantMessage, UserMessage } from '@hais/ccpretty/models';

// Format messages for terminal display
const assistantMsg: AssistantMessage = { /* ... */ };
const userMsg: UserMessage = { /* ... */ };

const formattedAssistant = formatAssistantMessage(assistantMsg);
const formattedUser = formatUserMessage(userMsg);

console.log(formattedAssistant);
console.log(formattedUser);
```

#### Custom Slack Integration
```typescript
import { createSlackClient, postToSlack } from '@hais/ccpretty/slack';

const slackClient = createSlackClient(process.env.CCPRETTY_SLACK_TOKEN);
await postToSlack(slackClient, channel, message, threadTs);
```

### Type Safety

All exports include comprehensive TypeScript type definitions for enhanced development experience and runtime safety.

## Testing and Quality Assurance

### Test Structure
- **Unit Tests**: `tests/formatters.test.ts`, `tests/models.test.ts`
- **Integration Tests**: `tests/cli-integration.test.ts`, `tests/slack.test.ts`
- **Coverage Target**: Maintain >90% code coverage
- **CI/CD**: Automated testing on all pull requests

### Code Quality
- **TypeScript**: Strict type checking enabled
- **ESLint**: Code style and quality enforcement
- **Prettier**: Consistent code formatting
- **Error Handling**: Comprehensive error coverage and graceful degradation