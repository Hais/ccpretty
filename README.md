# Claude Code Pretty

<p align="left">
  <img src="assets/logo.png" alt="Claude Code Pretty Logo" width="250" height="250" style="max-width:250px;max-height:250px;">
</p>

A CLI tool that formats JSON log lines from ccpretty sessions into human-readable output with colored boxes and special formatting. Optionally integrates with Slack to post real-time updates to a channel.

## Features

- **Pretty Formatting**: Transforms JSON logs into colored, boxed output
- **Message Type Support**: Handles assistant, user, system, and result messages
- **Special TodoWrite Formatting**: Displays todo lists with emoji status indicators
- **Slack Integration**: Posts updates to Slack threads with workflow status reactions
- **Streaming Support**: Processes multi-line JSON objects in real-time

## Installation

```bash
# Install globally from npm
npm install -g @hais/ccpretty

# Or install from source
git clone https://github.com/hais/ccpretty.git
cd ccpretty
npm install
npm run build
npm install -g .
```

## Usage

```bash
# Basic usage - pipe ccpretty logs through ccpretty
claude -p "Hello world" --output-format stream-json --verbose | ccpretty

# With Slack integration
export CCPRETTY_SLACK_TOKEN=xoxb-your-token
export CCPRETTY_SLACK_CHANNEL=#channel-name
claude -p "Hello world" --output-format stream-json --verbose | ccpretty

# Continue posting to existing Slack thread (manual)
export CCPRETTY_SLACK_THREAD_TS=1234567890.123456
claude -p "Hello world" --output-format stream-json --verbose | ccpretty

# Or resume the last thread automatically
claude -p "Hello world" --output-format stream-json --verbose  | ccpretty --resume-slack-thread
```

## Slack Integration

When Slack environment variables are set, ccpretty will:
- Create a new thread (or use existing one if `CCPRETTY_SLACK_THREAD_TS` is set)
- Post session initialization with available tools
- Update with assistant messages and tool usage
- Show workflow status with reactions (🚀 → ✅ or 🚨)
- Save thread timestamp to `~/.ccpretty_slack_ts` for automatic reuse with `--resume-slack-thread`

Required Slack bot permissions:

- `assistant:write`  
  Allow ccpretty to act as an App Agent

- `chat:write`  
  Send messages as ccpretty

- `chat:write.customize`  
  Send messages as ccpretty with a customised username and avatar

- `emoji:read`  
  View custom emoji in a workspace

- `reactions:read`  
  View emoji reactions and their associated content in channels and conversations that ccpretty has been added to

- `reactions:write`  
  Add and edit emoji reactions

- `channels:history`  
  View messages and other content in public channels that ccpretty has been added to

## Development

```bash
# Install dependencies
npm install

# Run in development mode
npm run dev

# Build
npm run build

# Test locally
npm run ccpretty
```

## Message Types

- **Assistant**: Blue boxes with tool usage detection
- **User**: Green boxes with tool results  
- **System**: Magenta boxes for session events
- **Result**: Success/error boxes with metrics (duration, cost, etc.)