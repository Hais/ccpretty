# ccpretty Architecture Documentation

## Overview

ccpretty is a command-line tool that transforms JSON log lines from Claude Code sessions into human-readable, colored output. It supports two processing modes: immediate (default) and queue-based (experimental), along with optional Slack integration for real-time notifications.

## Table of Contents

1. [System Architecture](#system-architecture)
2. [Core Components](#core-components)
3. [Data Flow](#data-flow)
4. [Processing Modes](#processing-modes)
5. [Message Types](#message-types)
6. [Component Details](#component-details)
7. [Integration Points](#integration-points)

## System Architecture

```mermaid
graph TB
    subgraph Input
        A[Claude Code JSON Logs] -->|stdin| B[CLI Entry Point]
    end
    
    subgraph "Core Processing"
        B --> C{Processing Mode?}
        C -->|Standard| D[Immediate Processor]
        C -->|--queue| E[Message Queue]
        
        E --> F[Message Reducer]
        F --> G[Grouped Output]
        
        D --> H[Formatted Output]
    end
    
    subgraph "Output Channels"
        H --> I[Console Output]
        G --> I
        
        H --> J{Slack Enabled?}
        G --> J
        J -->|Yes| K[Slack API]
        J -->|No| L[Skip]
    end
    
    subgraph "External Services"
        K --> M[Slack Workspace]
    end
```

## Core Components

### Component Overview

```mermaid
graph LR
    subgraph "Input Layer"
        A[index.ts<br/>CLI & Stream Handler]
    end
    
    subgraph "Data Models"
        B[models.ts<br/>Type Definitions]
    end
    
    subgraph "Processing Layer"
        C[formatters.ts<br/>Message Formatting]
        D[message-queue.ts<br/>Queue Management]
        E[message-reducer.ts<br/>Message Reduction]
    end
    
    subgraph "Integration Layer"
        F[slack.ts<br/>Slack Integration]
    end
    
    A --> B
    A --> C
    A --> D
    D --> E
    A --> F
    C --> B
    F --> B
```

### Component Responsibilities

| Component | Responsibility | Key Functions |
|-----------|---------------|---------------|
| `index.ts` | CLI entry point, stream processing, mode selection | `main()`, `processJsonBuffer()` |
| `models.ts` | TypeScript interfaces for Claude Code messages | Type guards, interfaces |
| `formatters.ts` | Visual formatting with colors and boxes | `formatAssistantResponse()`, etc. |
| `message-queue.ts` | Queue management and tool pairing | `enqueue()`, `processQueue()` |
| `message-reducer.ts` | Message deduplication and grouping | `reduceGroups()`, `reduceToolPair()` |
| `slack.ts` | Slack API integration | `postToSlack()`, `createSlackBlocks()` |

## Data Flow

### Standard Mode Data Flow

```mermaid
sequenceDiagram
    participant S as stdin
    participant I as index.ts
    participant E as extractJson
    participant F as formatters.ts
    participant C as Console
    participant SL as Slack API
    
    S->>I: JSON log line
    I->>I: Buffer accumulation
    I->>E: Extract JSON objects
    E->>I: Parsed objects
    
    loop For each object
        I->>F: Format message
        F->>I: Formatted output
        I->>C: Print to console
        
        opt Slack enabled & significant event
            I->>SL: Post to Slack
        end
    end
```

### Queue Mode Data Flow

```mermaid
sequenceDiagram
    participant S as stdin
    participant I as index.ts
    participant Q as MessageQueue
    participant R as MessageReducer
    participant C as Console
    
    S->>I: JSON log line
    I->>I: Extract JSON
    I->>Q: Enqueue message
    
    Note over Q: Every 500ms
    Q->>Q: Process queue
    Q->>Q: Pair tool_use/tool_result
    Q->>R: Send message groups
    R->>R: Deduplicate & format
    R->>I: Processed messages
    I->>C: Print combined output
```

## Processing Modes

### Standard Mode (Default)

- **Immediate processing**: Messages are formatted and output as soon as they're received
- **No buffering**: Each message is independent
- **Simple and fast**: Minimal latency between input and output
- **Tool separation**: `tool_use` and `tool_result` appear as separate messages

### Queue Mode (--queue flag)

- **Batched processing**: Messages are queued and processed every 500ms
- **Tool pairing**: Automatically matches `tool_use` with corresponding `tool_result`
- **Sequential tool execution**: Only one tool can run at a time - new tools interrupt previous ones
- **Interruption handling**: Interrupted tools are marked and displayed appropriately
- **Deduplication**: Filters out identical consecutive messages
- **Enhanced UX**: Shows complete tool execution workflows
- **Immediate messages**: System and result messages bypass queue for instant output
- **Orphan detection**: Tool uses without results after 30s are marked as orphaned

```mermaid
stateDiagram-v2
    [*] --> Queued: Message received
    Queued --> Pending: Added to queue
    
    Pending --> Processing: Timer tick (500ms)
    Pending --> Processing: Immediate message
    
    Processing --> ToolPairing: Is tool_use?
    Processing --> SingleMessage: Regular message
    
    ToolPairing --> CheckActive: Check for active tool
    CheckActive --> InterruptActive: Active tool exists
    CheckActive --> WaitingForResult: No active tool
    
    InterruptActive --> Output: Interrupted tool message
    InterruptActive --> WaitingForResult: Set new active tool
    
    WaitingForResult --> CompletePair: tool_result received
    WaitingForResult --> Interrupted: New tool_use
    WaitingForResult --> Timeout: 30s elapsed
    
    Interrupted --> Output: Interrupted message
    CompletePair --> Output: Combined message
    SingleMessage --> Output: Formatted message
    Timeout --> Output: Orphaned tool_use
    
    Output --> [*]
```

## Message Types

### Message Type Hierarchy

```mermaid
graph TD
    A[LogEntry] --> B[SystemResponse]
    A --> C[AssistantResponse]
    A --> D[UserResponse]
    A --> E[ResultResponse]
    
    B --> F[SystemInitMessage]
    
    C --> G[TextContent]
    C --> H[ToolUseContent]
    
    D --> I[ToolResultContent]
    D --> J[TextContent]
    
    E --> K[SuccessResult]
    E --> L[ErrorResult]
```

### Message Type Transformations

```mermaid
graph LR
    subgraph "Input Types"
        A1[tool_use<br/>Assistant Message]
        A2[tool_result<br/>User Message]
    end
    
    subgraph "Queue Processing"
        B1[ToolPair Object]
        B2[Message Group]
    end
    
    subgraph "Output Types"
        C1[Combined Tool<br/>Execution Summary]
        C2[Standard<br/>Formatted Message]
    end
    
    A1 --> B1
    A2 --> B1
    B1 --> B2
    B2 --> C1
    
    A1 -->|Standard Mode| C2
    A2 -->|Standard Mode| C2
```

## Component Details

### index.ts - CLI Entry Point

```mermaid
flowchart TD
    A[Start] --> B[Parse CLI Arguments]
    B --> C{Queue Mode?}
    C -->|Yes| D[Initialize Queue]
    C -->|No| E[Standard Setup]
    
    D --> F[Create MessageQueue]
    F --> G[Create MessageReducer]
    
    B --> H{Slack Config?}
    H -->|Yes| I[Initialize Slack Client]
    H -->|No| J[Skip Slack]
    
    E --> K[Setup readline]
    G --> K
    I --> K
    J --> K
    
    K --> L[Process stdin]
    L --> M{Complete JSON?}
    M -->|Yes| N[Process Buffer]
    M -->|No| O[Accumulate]
    
    N --> P{Queue Mode?}
    P -->|Yes| Q[Enqueue Message]
    P -->|No| R[Format & Output]
    
    O --> L
    Q --> L
    R --> L
```

### message-queue.ts - Queue Management

Key concepts:
- **QueuedMessage**: Wrapper for log entries with metadata (status, timestamp)
- **ToolPair**: Links tool_use with tool_result, tracks execution time
- **MessageGroup**: Collection of related messages for batch processing
- **Sampling**: Periodic processing every 500ms for better UX
- **Timeout handling**: 30s timeout for orphaned tool uses
- **Active tool tracking**: Only one tool can be active at a time
- **Interruption mechanism**: New tool uses interrupt pending ones

### message-reducer.ts - Message Processing

Key concepts:
- **Deduplication**: Tracks last output to avoid duplicates using content hashing
- **Tool combination**: Merges tool execution into single message with timing
- **Formatting**: Creates unified output with status indicators (✅, ❌, ⚠️)
- **Result truncation**: Limits output to 500 lines for readability
- **Error handling**: Special formatting for tool errors and interruptions
- **State management**: Maintains last message state for deduplication

### slack.ts - Slack Integration

```mermaid
flowchart LR
    A[Log Entry] --> B{Significant?}
    B -->|No| C[Skip]
    B -->|Yes| D[Create Message]
    
    D --> E{Thread Exists?}
    E -->|No| F[Create Thread]
    E -->|Yes| G[Post to Thread]
    
    F --> H[Save Thread ID]
    H --> G
    
    G --> I{Message Type?}
    I -->|tool_use| J[Track Tool ID]
    I -->|tool_result| K[Update Tool Message]
    I -->|assistant| L[Group Messages]
    I -->|system| M[Session Info]
    I -->|result| N[Final Status]
    
    J --> O[Post with ⏳ Status]
    K --> P[Update to ✅/❌]
    L --> Q[Numbered List]
    M --> R[Tool List]
    N --> S[Workflow Reaction]
```

Key features:
- **Rich formatting**: Uses Slack Block Kit for structured messages
- **Live updates**: Tool status changes from ⏳ to ✅/❌ on completion
- **Message grouping**: Consecutive assistant messages become numbered lists
- **Deduplication**: Skips identical messages to reduce noise
- **Thread management**: Saves/loads thread IDs for continuity
- **Workflow tracking**: Reactions on initial message show overall status

## Integration Points

### Environment Variables

| Variable | Purpose | Required |
|----------|---------|----------|
| `CCPRETTY_SLACK_TOKEN` | Bot token for Slack API | No |
| `CCPRETTY_SLACK_CHANNEL` | Target Slack channel | No |
| `CCPRETTY_SLACK_THREAD_TS` | Existing thread timestamp | No |

### CLI Arguments

| Argument | Purpose | Default |
|----------|---------|---------|
| `--queue` | Enable queue-based processing | Disabled |
| `--resume-slack-thread` | Resume last Slack thread | New thread |

### Input/Output Formats

**Input**: Newline-delimited JSON from Claude Code
```json
{"type":"assistant","message":{...},"session_id":"..."}
{"type":"user","message":{...},"session_id":"..."}
```

**Output**: Formatted text with ANSI colors and Unicode boxes
```
╔════════════════════════ assistant ════════════════════════╗
║                                                            ║
║   Hello! I'll help you with that task.                    ║
║   [claude-3-5-sonnet | 15 tokens | 120ms]                 ║
║                                                            ║
╚════════════════════════════════════════════════════════════╝
```

## Future Enhancements

1. **Configurable queue intervals**: Allow customization of the 500ms sampling rate
2. **Parallel tool execution**: Support for concurrent tool runs when safe
3. **Plugin architecture**: Support for custom formatters and processors
4. **Persistent state**: Save and resume sessions across restarts
5. **WebSocket support**: Real-time streaming to web interfaces
6. **Advanced filtering**: User-defined rules for message processing
7. **Export formats**: Support for Markdown, HTML, or JSON output
8. **Performance metrics**: Track and display queue processing statistics