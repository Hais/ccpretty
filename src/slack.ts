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
  pendingToolUses: Map<string, { messageTs: string; toolName: string; toolInput: any }>;
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
    // Check for custom environment variables
    const customTitle = process.env.CCPRETTY_TITLE;
    const customDescription = process.env.CCPRETTY_DESCRIPTION;
    const customUrl = process.env.CCPRETTY_URL;
    
    if (customTitle || customDescription || customUrl) {
      let message = '';
      if (customTitle) {
        message += `🚀 *${customTitle}*`;
      }
      if (customDescription) {
        message += `\n${customDescription}`;
      }
      if (customUrl) {
        message += `\nURL: ${customUrl}`;
      }
      message += `\nSession ID: \`${data.session_id}\``;
      return message;
    } else {
      return `🚀 *Claude Code Session Started*\nSession ID: \`${data.session_id}\``;
    }
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
        // Special formatting for TodoWrite
        if (tool.name === 'TodoWrite' && tool.input.todos) {
          let msg = `📝 *Todo List Update*\n`;
          
          // Group todos by status
          const pendingTodos = tool.input.todos.filter((t: any) => t.status === 'pending');
          const inProgressTodos = tool.input.todos.filter((t: any) => t.status === 'in_progress');
          const completedTodos = tool.input.todos.filter((t: any) => t.status === 'completed');
          
          if (pendingTodos.length > 0) {
            msg += `\n*⏳ Pending:*\n`;
            msg += pendingTodos.map((todo: any) => {
              const priorityEmoji = todo.priority === 'high' ? '🔴' : 
                                  todo.priority === 'medium' ? '🟡' : '🟢';
              return `${priorityEmoji} ${todo.content}`;
            }).join('\n');
          }
          
          if (inProgressTodos.length > 0) {
            msg += `\n\n*🔄 In Progress:*\n`;
            msg += inProgressTodos.map((todo: any) => {
              const priorityEmoji = todo.priority === 'high' ? '🔴' : 
                                  todo.priority === 'medium' ? '🟡' : '🟢';
              return `${priorityEmoji} ${todo.content}`;
            }).join('\n');
          }
          
          if (completedTodos.length > 0) {
            msg += `\n\n*✅ Completed:*\n`;
            msg += completedTodos.map((todo: any) => `~${todo.content}~`).join('\n');
          }
          
          msg += `\n\n📊 *Summary:* ${completedTodos.length}/${tool.input.todos.length} completed`;
          return msg;
        }
        
        // Standard tool formatting
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
    // Check for custom environment variables
    const customTitle = process.env.CCPRETTY_TITLE;
    const customDescription = process.env.CCPRETTY_DESCRIPTION;
    const customUrl = process.env.CCPRETTY_URL;
    
    const blocks: any[] = [];
    
    // Header
    blocks.push({
      type: "header",
      text: {
        type: "plain_text",
        text: customTitle ? `🚀 ${customTitle}` : "🚀 Claude Code Session Started"
      }
    });
    
    // Section with fields
    const fields: any[] = [];
    
    // Add session ID field
    fields.push({
      type: "mrkdwn",
      text: `*Session ID:*\n\`${data.session_id}\``
    });
    
    // Add custom fields if present
    if (customDescription) {
      fields.push({
        type: "mrkdwn",
        text: `*Description:*\n${customDescription}`
      });
    }
    
    if (customUrl) {
      fields.push({
        type: "mrkdwn",
        text: `*URL:*\n${customUrl}`
      });
    }
    
    blocks.push({
      type: "section",
      fields: fields
    });
    
    return blocks;
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
        // Special formatting for TodoWrite
        if (tool.name === 'TodoWrite' && tool.input.todos) {
          blocks.push({
            type: "header",
            text: {
              type: "plain_text",
              text: "📝 Todo List Update",
              emoji: true
            }
          });
          
          // Group todos by status
          const pendingTodos = tool.input.todos.filter((t: any) => t.status === 'pending');
          const inProgressTodos = tool.input.todos.filter((t: any) => t.status === 'in_progress');
          const completedTodos = tool.input.todos.filter((t: any) => t.status === 'completed');
          
          // Add pending todos
          if (pendingTodos.length > 0) {
            blocks.push({
              type: "section",
              text: {
                type: "mrkdwn",
                text: "*⏳ Pending:*"
              }
            });
            
            const pendingText = pendingTodos.map((todo: any) => {
              const priorityEmoji = todo.priority === 'high' ? '🔴' : 
                                  todo.priority === 'medium' ? '🟡' : '🟢';
              return `${priorityEmoji} ${todo.content}`;
            }).join('\n');
            
            blocks.push({
              type: "section",
              text: {
                type: "mrkdwn",
                text: pendingText
              }
            });
          }
          
          // Add in-progress todos
          if (inProgressTodos.length > 0) {
            blocks.push({
              type: "section",
              text: {
                type: "mrkdwn",
                text: "*🔄 In Progress:*"
              }
            });
            
            const inProgressText = inProgressTodos.map((todo: any) => {
              const priorityEmoji = todo.priority === 'high' ? '🔴' : 
                                  todo.priority === 'medium' ? '🟡' : '🟢';
              return `${priorityEmoji} ${todo.content}`;
            }).join('\n');
            
            blocks.push({
              type: "section",
              text: {
                type: "mrkdwn",
                text: inProgressText
              }
            });
          }
          
          // Add completed todos
          if (completedTodos.length > 0) {
            blocks.push({
              type: "section",
              text: {
                type: "mrkdwn",
                text: "*✅ Completed:*"
              }
            });
            
            const completedText = completedTodos.map((todo: any) => {
              return `~${todo.content}~`;
            }).join('\n');
            
            blocks.push({
              type: "section",
              text: {
                type: "mrkdwn",
                text: completedText
              }
            });
          }
          
          // Add divider
          blocks.push({
            type: "divider"
          });
          
          // Add summary context
          blocks.push({
            type: "context",
            elements: [
              {
                type: "mrkdwn",
                text: `📊 *Summary:* ${completedTodos.length}/${tool.input.todos.length} completed`
              }
            ]
          });
        } else {
          // Standard tool formatting
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
        }
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