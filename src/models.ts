// Import SDK types from the npm package
import type {
  SDKAssistantMessage,
  SDKUserMessage,
  SDKSystemMessage,
  SDKResultMessage,
  SDKMessage,
  NonNullableUsage,
  Options as SDKOptions,
  PermissionMode,
  McpServerConfig,
  McpStdioServerConfig,
  McpSSEServerConfig,
  McpHttpServerConfig,
  ApiKeySource,
  ConfigScope
} from '@anthropic-ai/claude-code';

// Re-export for convenience
export type {
  SDKAssistantMessage,
  SDKUserMessage,
  SDKSystemMessage,
  SDKResultMessage,
  SDKMessage,
  NonNullableUsage,
  SDKOptions,
  PermissionMode,
  McpServerConfig,
  McpStdioServerConfig,
  McpSSEServerConfig,
  McpHttpServerConfig,
  ApiKeySource,
  ConfigScope
};

// Import and re-export common Anthropic SDK types for convenience
import type { 
  Message as AnthropicMessage,
  TextBlock,
  ToolUseBlock,
  ContentBlock as AnthropicContentBlock,
  Usage as AnthropicUsage,
  MessageParam,
  ToolResultBlockParam
} from '@anthropic-ai/sdk/resources/messages/messages.js';

export type { 
  AnthropicMessage,
  TextBlock,
  ToolUseBlock,
  AnthropicContentBlock,
  AnthropicUsage,
  MessageParam,
  ToolResultBlockParam
};

// Main message types - using SDK types directly
export type AssistantMessage = SDKAssistantMessage;
export type UserMessage = SDKUserMessage;
export type SystemMessage = SDKSystemMessage;
export type ResultMessage = SDKResultMessage;
export type Message = SDKMessage;

// Legacy aliases for backward compatibility
export type AssistantResponse = SDKAssistantMessage;
export type UserResponse = SDKUserMessage;
export type SystemResponse = SDKSystemMessage;
export type ResultResponse = SDKResultMessage;
export type SystemInitMessage = SDKSystemMessage; // SDK only has 'init' subtype for system messages
export type Usage = NonNullableUsage;

// Type guards for SDK message types
export function isAssistantMessage(message: any): message is AssistantMessage {
  return message?.type === 'assistant' && message?.message?.role === 'assistant';
}

export function isUserMessage(message: any): message is UserMessage {
  return message?.type === 'user' && message?.message?.role === 'user';
}

export function isSystemMessage(message: any): message is SystemMessage {
  return message?.type === 'system' && message?.subtype === 'init';
}

export function isResultMessage(message: any): message is ResultMessage {
  return message?.type === 'result';
}

// Legacy aliases for backward compatibility
export const isAssistantResponse = isAssistantMessage;
export const isUserResponse = isUserMessage;
export const isSystemResponse = isSystemMessage;
export const isSystemInitMessage = isSystemMessage;
export const isResultResponse = isResultMessage;

// Content type guards for message content
export function isTextContent(content: any): content is TextBlock {
  return content?.type === 'text';
}

export function isToolUseContent(content: any): content is ToolUseBlock {
  return content?.type === 'tool_use';
}

export function isToolResultContent(content: any): content is ToolResultBlockParam {
  return content?.type === 'tool_result';
}