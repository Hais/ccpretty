# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

- **Build**: `npm run build` - Compiles TypeScript to JavaScript in `dist/`
- **Development**: `npm run dev` - Runs TypeScript compiler in watch mode
- **Test CLI**: `npm run ccpretty` - Run the compiled CLI tool locally
- **Install as CLI**: `npm install -g .` - Install globally to use `ccpretty` command
- **With Slack**: Set environment variables to enable Slack integration. You can use either:
  - Environment variables: `export CCPRETTY_SLACK_TOKEN=xoxb-your-token` etc.
  - Local `.env` file in project directory with environment variables
  - Global `~/.ccpretty.env` file for system-wide configuration
  - See `.env.example` for available environment variables
- **Resume Slack Thread**: `ccpretty --resume-slack-thread` - Resume posting to the last used thread
- **Queue Processing**: `ccpretty --queue` - Enable experimental queue-based processing with tool pairing and deduplication
- **Slack Debug Mode**: Set `export CCPRETTY_SLACK_DEBUG=/path/to/logfile` to log all Slack API calls to the specified file

## Architecture

This is a CLI tool that formats JSON log lines from Claude Code sessions into human-readable output with colored boxes and special formatting.

### Core Components

- `src/index.ts` - Main CLI application with stdin processing and JSON parsing
- `src/models.ts` - TypeScript type definitions for Claude Code message formats
- `src/formatters.ts` - Message formatting functions with colored output
- `src/slack.ts` - Slack integration utilities
- `src/message-queue.ts` - Queue-based message processing (experimental)
- `src/message-reducer.ts` - Message deduplication and tool pairing logic

### Data Flow

#### Standard Mode (Default)
1. Reads streaming JSON from stdin line by line
2. Uses brace counting to detect complete JSON objects across multiple lines
3. Extracts JSON using `@axync/extract-json` library
4. Type-checks and formats based on message type (assistant, user, system, result)
5. Outputs colored, boxed formatting using `boxen` and `picocolors`

#### Queue Mode (--queue flag)
1. Messages are queued for processing instead of immediate output
2. Queue is sampled every 500ms to group related messages
3. Tool_use requests are paired with tool_result responses
4. Duplicate messages are filtered out
5. Combined tool execution summaries show complete workflow
6. Provides better UX with less fragmented output

### Message Types

The tool handles four main message types from Claude Code logs:
- **Assistant responses** - Blue boxes with tool use detection and special TodoWrite formatting
- **User responses** - Green boxes with tool results
- **System responses** - Magenta boxes for session init and system events  
- **Result responses** - Success/error boxes with session metrics

### Special Formatting

- TodoWrite tool calls get formatted as emoji-decorated todo lists with status icons
- Tool usage shows command and description metadata
- Session results include duration, API time, turns, and cost information

### Slack Integration

When Slack environment variables are set, the tool automatically:
1. Creates a new Slack thread on the first significant event (or uses existing thread if `CCPRETTY_SLACK_THREAD_TS` is set)
2. Posts updates to the thread for significant events only:
   - Session initialization (with session ID and available tools)
   - Assistant text messages (truncated to 2800 chars)
   - Tool usage (with command and description, updated with completion status)
   - Task completion/failure (with duration and cost metrics)
3. Manages reactions on the initial message to show workflow status:
   - 🚀 Added when workflow starts
   - ✅ Replaces rocket when workflow completes successfully
   - 🚨 Replaces rocket when workflow fails
4. Groups consecutive assistant messages into a single, numbered list
5. Deduplicates messages - skips posting if content is identical to the previous message
6. Saves thread timestamp to `~/.ccpretty_slack_ts` when creating a new thread
7. Prints active Slack configuration on startup for confirmation

Uses `@slack/web-api` for Slack communication. Required bot token permissions:
- `chat:write` - To post and update messages
- `reactions:write` - To add workflow status reactions

#### Slack Debug Mode

Set `CCPRETTY_SLACK_DEBUG=/path/to/logfile` to enable debug logging of all Slack API calls. Debug logs are written to the specified file and include:
- Timestamps for each API call
- Full request payloads sent to Slack
- Response metadata (timestamps, success status)
- All API methods: `chat.postMessage`, `chat.update`, `reactions.add`, `reactions.remove`

Example usage:
```bash
export CCPRETTY_SLACK_DEBUG=./slack-debug.log
ccpretty < claude-session.log
```

This is useful for debugging Slack integration issues or understanding the exact sequence of API calls.

## Error Handling

The tool includes robust error handling to prevent crashes when processing malformed or unexpected messages:

- **Line parsing errors**: Malformed JSON lines are logged and skipped
- **Message processing errors**: Individual message processing failures don't stop the stream
- **Output errors**: Terminal and Slack output errors are caught and logged
- **Queue processing errors**: Queue-based processing errors are handled gracefully
- **Debug information**: Set `CCPRETTY_DEBUG=1` to see detailed error information and problematic message content

This ensures that ccpretty continues processing even when encountering issues from Claude Code or other upstream sources.