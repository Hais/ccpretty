# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

- **Build**: `npm run build` - Compiles TypeScript to JavaScript in `dist/`
- **Development**: `npm run dev` - Runs TypeScript compiler in watch mode
- **Test CLI**: `npm run ccpretty` - Run the compiled CLI tool locally
- **Install as CLI**: `npm install -g .` - Install globally to use `ccpretty` command
- **With Slack**: Set environment variables to enable Slack integration:
  - `export CCPRETTY_SLACK_TOKEN=xoxb-your-token`
  - `export CCPRETTY_SLACK_CHANNEL=#channel-name`
  - `export CCPRETTY_SLACK_THREAD_TS=1234567890.123456` (optional, to post to existing thread)
- **Resume Slack Thread**: `ccpretty --resume-slack-thread` - Resume posting to the last used thread

## Architecture

This is a CLI tool that formats JSON log lines from Claude Code sessions into human-readable output with colored boxes and special formatting.

### Core Components

- `src/index.ts` - Main CLI application with stdin processing and JSON parsing
- `src/models.ts` - TypeScript type definitions for Claude Code message formats

### Data Flow

1. Reads streaming JSON from stdin line by line
2. Uses brace counting to detect complete JSON objects across multiple lines
3. Extracts JSON using `@axync/extract-json` library
4. Type-checks and formats based on message type (assistant, user, system, result)
5. Outputs colored, boxed formatting using `boxen` and `picocolors`

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