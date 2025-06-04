import { WebClient } from '@slack/web-api';
import {
  isSystemResponse,
  isSystemInitMessage,
  isAssistantResponse,
  isUserResponse,
  isTextContent,
  isToolUseContent,
  isToolResultContent,
} from './models';
import { trimFilePath } from './formatters';

export interface SlackConfig {
  token: string;
  channel: string;
  threadTs?: string;
  client: WebClient;
  lastMessage?: {
    ts: string;
    type: string;
    content: string;
    count: number;
  };
  initialMessageTs?: string;
  pendingToolUses: Map<string, { messageTs: string; toolName: string }>;
  lastPostedContent?: string;
  lastAssistantText?: string;
}

export interface LogEntry {
  type?: string;
  [key: string]: any;
}

// Check if an event is significant enough to post to Slack
export function isSignificantEvent(data: LogEntry): boolean {
  try {
    // System init messages (session start)
    if (isSystemResponse(data) && isSystemInitMessage(data)) {
      return true;
    }
    
    // Result messages (task completion/failure)
    if (data.type === 'result') {
      return true;
    }
    
    // Assistant messages with text content (no tool use)
    if (isAssistantResponse(data) && data.message?.type === 'message') {
      const content = data.message.content;
      if (!Array.isArray(content)) return false;
      
      const hasText = content.some(c => isTextContent(c));
      const hasToolUse = content.some(c => isToolUseContent(c));
      
      // Include text-only messages OR tool use messages
      return hasText || hasToolUse;
    }
    
    // User messages with tool results
    if (isUserResponse(data) && data.message?.content) {
      const content = data.message.content;
      if (!Array.isArray(content)) return false;
      
      return content.some(c => isToolResultContent(c));
    }
    
    return false;
  } catch (error) {
    // If anything goes wrong, just return false
    return false;
  }
}

// Get the type of message for grouping purposes
export function getMessageType(data: LogEntry): string {
  try {
    if (isSystemResponse(data) && isSystemInitMessage(data)) {
      return 'system_init';
    }
    
    if (data.type === 'result') {
      return 'result';
    }
    
    if (isAssistantResponse(data) && data.message?.content) {
      const content = data.message.content;
      if (Array.isArray(content)) {
        const hasToolUse = content.some(c => isToolUseContent(c));
        return hasToolUse ? 'tool_use' : 'assistant';
      }
    }
    
    if (isUserResponse(data)) {
      return 'tool_result';
    }
    
    return 'unknown';
  } catch (error) {
    return 'unknown';
  }
}

// Extract assistant message content without formatting
export function extractAssistantContent(data: LogEntry): string {
  try {
    if (isAssistantResponse(data) && data.message?.content && Array.isArray(data.message.content)) {
      const textContent = data.message.content.filter(c => isTextContent(c)) as any[];
      if (textContent.length > 0) {
        const message = textContent.map((c: any) => c.text || '').join('\n\n');
        // Truncate long messages
        return message.length > 500 ? message.substring(0, 497) + '...' : message;
      }
    }
    return '';
  } catch (error) {
    return '';
  }
}

// Create a simplified message for Slack (fallback)
export function createSlackMessage(data: LogEntry): string {
  if (isSystemResponse(data) && isSystemInitMessage(data)) {
    return `🚀 *Claude Code Session Started*\nSession ID: \`${data.session_id}\`\nTools: ${data.tools.join(', ')}`;
  }
  
  if (data.type === 'result') {
    const isSuccess = data.subtype === 'success' && !data.is_error;
    const icon = isSuccess ? '✅' : '❌';
    const status = isSuccess ? 'Completed' : 'Failed';
    return `${icon} *Task ${status}*\nDuration: ${(data.duration_ms / 1000).toFixed(2)}s | Cost: $${data.cost_usd.toFixed(4)} USD`;
  }
  
  if (isAssistantResponse(data)) {
    const content = data.message.content;
    const toolUses = content.filter(c => isToolUseContent(c)) as any[];
    const textContent = content.filter(c => isTextContent(c)) as any[];
    
    // Handle tool use messages
    if (toolUses.length > 0) {
      const toolMessages = toolUses.map((tool: any) => {
        let msg = `🔧 *${tool.name}*`;
        
        // Add file path for file-related tools
        if (tool.input.file_path) {
          const trimmedPath = trimFilePath(tool.input.file_path);
          msg += `\nFile: \`${trimmedPath}\``;
        }
        
        if (tool.input.command) {
          msg += `\nCommand: \`${tool.input.command}\``;
        }
        if (tool.input.description) {
          msg += `\nDescription: ${tool.input.description}`;
        }
        
        // Add other relevant parameters
        if (tool.input.pattern) {
          msg += `\nPattern: \`${tool.input.pattern}\``;
        }
        if (tool.input.limit && typeof tool.input.limit === 'number') {
          msg += `\nLimit: ${tool.input.limit} lines`;
        }
        if (tool.input.offset && typeof tool.input.offset === 'number') {
          msg += `\nOffset: ${tool.input.offset}`;
        }
        
        msg += `\n🟡 *Running...*`;
        return msg;
      });
      return toolMessages.join('\n\n');
    }
    
    // Handle text content from assistant messages
    if (textContent.length > 0) {
      // Combine all text content
      const message = textContent.map((c: any) => c.text).join('\n\n');
      // Truncate long messages for Slack
      const truncated = message.length > 500 ? message.substring(0, 497) + '...' : message;
      return `💬 *Assistant:*\n${truncated}`;
    }
  }
  
  return 'Event processed';
}

// Create Slack blocks for better formatting
export function createSlackBlocks(data: LogEntry): any[] {
  if (isSystemResponse(data) && isSystemInitMessage(data)) {
    return [
      {
        type: "header",
        text: {
          type: "plain_text",
          text: "🚀 Claude Code Session Started"
        }
      },
      {
        type: "section",
        fields: [
          {
            type: "mrkdwn",
            text: `*Session ID:*\n\`${data.session_id}\``
          },
          {
            type: "mrkdwn",
            text: `*Tools:*\n${data.tools.join(', ')}`
          }
        ]
      }
    ];
  }
  
  if (data.type === 'result') {
    const isSuccess = data.subtype === 'success' && !data.is_error;
    const icon = isSuccess ? '✅' : '❌';
    const status = isSuccess ? 'Completed' : 'Failed';
    
    return [
      {
        type: "header",
        text: {
          type: "plain_text",
          text: `${icon} Task ${status}`
        }
      },
      {
        type: "section",
        fields: [
          {
            type: "mrkdwn",
            text: `*Duration:*\n${(data.duration_ms / 1000).toFixed(2)}s`
          },
          {
            type: "mrkdwn",
            text: `*Cost:*\n$${data.cost_usd.toFixed(4)} USD`
          },
          {
            type: "mrkdwn",
            text: `*Turns:*\n${data.num_turns}`
          },
          {
            type: "mrkdwn",
            text: `*API Time:*\n${(data.duration_api_ms / 1000).toFixed(2)}s`
          }
        ]
      }
    ];
  }
  
  if (isAssistantResponse(data)) {
    const content = data.message.content;
    const toolUses = content.filter(c => isToolUseContent(c)) as any[];
    const textContent = content.filter(c => isTextContent(c)) as any[];
    
    // Handle tool use messages
    if (toolUses.length > 0) {
      const blocks: any[] = [];
      
      toolUses.forEach((tool: any) => {
        blocks.push({
          type: "header",
          text: {
            type: "plain_text",
            text: `🔧 ${tool.name}`
          }
        });
        
        const fields: any[] = [];
        
        // Add file path for file-related tools
        if (tool.input.file_path) {
          const trimmedPath = trimFilePath(tool.input.file_path);
          fields.push({
            type: "mrkdwn",
            text: `*File:*\n\`${trimmedPath}\``
          });
        }
        
        if (tool.input.command) {
          fields.push({
            type: "mrkdwn",
            text: `*Command:*\n\`${tool.input.command}\``
          });
        }
        if (tool.input.description) {
          fields.push({
            type: "mrkdwn",
            text: `*Description:*\n${tool.input.description}`
          });
        }
        
        // Add other relevant parameters
        if (tool.input.pattern) {
          fields.push({
            type: "mrkdwn",
            text: `*Pattern:*\n\`${tool.input.pattern}\``
          });
        }
        if (tool.input.limit && typeof tool.input.limit === 'number') {
          fields.push({
            type: "mrkdwn",
            text: `*Limit:*\n${tool.input.limit} lines`
          });
        }
        
        if (fields.length > 0) {
          blocks.push({
            type: "section",
            fields: fields
          });
        }
        
        // Add status indicator
        blocks.push({
          type: "context",
          elements: [
            {
              type: "mrkdwn",
              text: "🟡 *Running...*"
            }
          ]
        });
      });
      
      return blocks;
    }
    
    // Handle text content from assistant messages
    if (textContent.length > 0) {
      // Combine all text content
      const message = textContent.map((c: any) => c.text).join('\n\n');
      // Truncate long messages for Slack (blocks have a 3000 char limit)
      const truncated = message.length > 2800 ? message.substring(0, 2797) + '...' : message;
      
      return [
        {
          type: "section",
          text: {
            type: "mrkdwn",
            text: `💬 *Assistant:*\n${truncated}`
          }
        }
      ];
    }
  }
  
  // Handle tool results
  if (isUserResponse(data)) {
    const toolResults = data.message.content.filter(c => isToolResultContent(c)) as any[];
    if (toolResults.length > 0) {
      // This will be handled by updating existing tool_use messages
      return [];
    }
  }
  
  return [
    {
      type: "section",
      text: {
        type: "plain_text",
        text: "Event processed"
      }
    }
  ];
}