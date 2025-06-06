// Common types
export interface Usage {
  input_tokens: number;
  cache_creation_input_tokens?: number;
  cache_read_input_tokens?: number;
  output_tokens: number;
}

// Content types
export interface TextContent {
  type: 'text';
  text: string;
}

export interface ToolUseContent {
  type: 'tool_use';
  id: string;
  name: string;
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

// Message structure
export interface AssistantMessage {
  id: string;
  type: 'message';
  role: 'assistant';
  model: string;
  content: MessageContent[];
  stop_reason: 'tool_use' | 'end_turn' | string;
  stop_sequence: string | null;
  usage: Usage;
  ttftMs: number;
}

// Response types
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

// System message types
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

// Result message types
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
  cost_usd: number;
  session_id: string;
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