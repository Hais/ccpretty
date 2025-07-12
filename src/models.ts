import type { 
  Message as AnthropicMessage,
  TextBlock,
  ToolUseBlock,
  ContentBlock,
  Usage as AnthropicUsage,
  MessageParam,
  ToolResultBlockParam
} from '@anthropic-ai/sdk/resources/messages/messages.js';

// Re-export Anthropic SDK types for convenience
export type { 
  AnthropicMessage,
  TextBlock,
  ToolUseBlock,
  ContentBlock as AnthropicContentBlock,
  AnthropicUsage
};

// Custom types for Claude Code logging format
// These wrap the Anthropic SDK types with additional metadata

// Extended Usage type that includes additional fields from Claude Code
export interface Usage {
  input_tokens: number;
  output_tokens: number;
  cache_creation_input_tokens?: number | null;
  cache_read_input_tokens?: number | null;
  server_tool_use?: any;
  service_tier?: 'standard' | 'priority' | 'batch' | null;
}

// Content types - using Anthropic SDK types directly
export type TextContent = TextBlock;

export interface ToolUseContent extends ToolUseBlock {
  input: {
    command?: string;
    description?: string;
    timeout?: number;
    [key: string]: any;
  };
}

export interface ToolResultContent {
  type: 'tool_result';
  tool_use_id: string;
  content: string;
  is_error?: boolean;
}

export type MessageContent = TextContent | ToolUseContent | ToolResultContent;

// Message structure - extends Anthropic SDK Message
export interface AssistantMessage extends Omit<AnthropicMessage, 'content'> {
  content: MessageContent[];
  ttftMs: number;
}

// Response types - Claude Code specific wrapper format
export interface AssistantTextResponse {
  type: 'assistant';
  message: AssistantMessage & {
    content: TextContent[];
  };
  session_id: string;
}

export interface AssistantToolUseResponse {
  type: 'assistant';
  message: AssistantMessage & {
    content: ToolUseContent[];
  };
  session_id: string;
}

export type AssistantResponse = AssistantTextResponse | AssistantToolUseResponse;

// User message types
export interface UserMessage {
  role: 'user';
  content: MessageContent[];
}

export interface UserResponse {
  type: 'user';
  message: UserMessage;
  session_id: string;
}

// System message types - Claude Code specific
export interface SystemInitMessage {
  type: 'system';
  subtype: 'init';
  session_id: string;
  tools: string[];
  mcp_servers: string[];
}

export interface SystemMessage {
  type: 'system';
  subtype: string;
  session_id: string;
  session_started?: string;
  message?: string;
  [key: string]: any;
}

export type SystemResponse = SystemInitMessage | SystemMessage;

// Result message types - Claude Code specific
export interface ResultResponse {
  type: 'result';
  subtype: 'success' | 'error';
  is_error?: boolean;
  result?: string | {
    exit_code?: number;
    session_duration_seconds?: number;
    api_wall_time_seconds?: number;
    turns_taken?: number;
    total_cost_usd?: number;
    [key: string]: any;
  };
  duration_ms: number;
  duration_api_ms: number;
  num_turns: number;
  total_cost_usd: number; // Changed from cost_usd to match actual log format
  session_id: string;
  usage?: {
    input_tokens?: number;
    output_tokens?: number;
    cache_creation_input_tokens?: number;
    cache_read_input_tokens?: number;
    server_tool_use?: any;
    service_tier?: string;
  };
}

// Union of all message types
export type Message = AssistantResponse | UserResponse | SystemResponse | ResultResponse;

// Type guards
export function isTextContent(content: MessageContent): content is TextContent {
  return content.type === 'text';
}

export function isToolUseContent(content: MessageContent): content is ToolUseContent {
  return content.type === 'tool_use';
}

export function isToolResultContent(content: MessageContent): content is ToolResultContent {
  return content.type === 'tool_result';
}

export function isAssistantResponse(response: any): response is AssistantResponse {
  return response?.type === 'assistant' && response?.message?.role === 'assistant';
}

export function isUserResponse(response: any): response is UserResponse {
  return response?.type === 'user' && response?.message?.role === 'user';
}

export function isSystemResponse(response: any): response is SystemResponse {
  return response?.type === 'system';
}

export function isSystemInitMessage(response: any): response is SystemInitMessage {
  return response?.type === 'system' && response?.subtype === 'init';
}

export function isResultResponse(response: any): response is ResultResponse {
  return response?.type === 'result';
}