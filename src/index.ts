#!/usr/bin/env node

import * as readline from 'readline';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { extractJson } from '@axync/extract-json';
import { WebClient } from '@slack/web-api';
import { 
  AssistantResponse, 
  UserResponse, 
  SystemResponse,
  isAssistantResponse, 
  isUserResponse, 
  isSystemResponse,
  isSystemInitMessage,
  isTextContent, 
  isToolUseContent, 
  isToolResultContent 
} from './models';
import {
  formatAssistantResponse,
  formatUserResponse,
  formatSystemResponse,
  formatResultResponse,
  formatUnknownResponse,
  trimFilePath
} from './formatters';
import { MessageQueue, MessageGroup } from './message-queue';
import { MessageReducer, ProcessedMessage } from './message-reducer';
import {
  SlackConfig as ImportedSlackConfig,
  isSignificantEvent as slackIsSignificantEvent,
  getMessageType as slackGetMessageType,
  extractAssistantContent as slackExtractAssistantContent,
  createSlackMessage as slackCreateSlackMessage,
  createSlackBlocks as slackCreateSlackBlocks
} from './slack';

interface LogEntry {
  type?: string;
  [key: string]: any;
}

// Use SlackConfig from slack.ts
type SlackConfig = ImportedSlackConfig;

// Get configuration from environment variables and arguments
function getConfig(): { 
  slack: { token?: string; channel?: string; threadTs?: string };
  useQueue: boolean;
} {
  let threadTs = process.env.CCPRETTY_SLACK_THREAD_TS;
  
  // Check for --resume-slack-thread argument
  const resumeArg = process.argv.includes('--resume-slack-thread');
  if (resumeArg && !threadTs) {
    threadTs = readSlackThreadFromFile();
  }
  
  // Check for --queue flag to enable queue-based processing
  const useQueue = process.argv.includes('--queue');
  
  return {
    slack: {
      token: process.env.CCPRETTY_SLACK_TOKEN,
      channel: process.env.CCPRETTY_SLACK_CHANNEL,
      threadTs: threadTs,
    },
    useQueue
  };
}

// Read Slack thread timestamp from temporary file
function readSlackThreadFromFile(): string | undefined {
  try {
    const filePath = path.join(os.homedir(), '.ccpretty_slack_ts');
    if (fs.existsSync(filePath)) {
      const content = fs.readFileSync(filePath, 'utf8').trim();
      return content || undefined;
    }
  } catch (error) {
    // Silently ignore file read errors
  }
  return undefined;
}

// Write Slack thread timestamp to temporary file
function writeSlackThreadToFile(threadTs: string): void {
  try {
    const filePath = path.join(os.homedir(), '.ccpretty_slack_ts');
    fs.writeFileSync(filePath, threadTs, 'utf8');
  } catch (error) {
    // Silently ignore file write errors
    console.error('Failed to write Slack thread timestamp to file');
  }
}


// Use isSignificantEvent from slack.ts
const isSignificantEvent = slackIsSignificantEvent;

// Use getMessageType from slack.ts
const getMessageType = slackGetMessageType;

// Use extractAssistantContent from slack.ts
const extractAssistantContent = slackExtractAssistantContent;

// Extract full assistant content without truncation (for deduplication)
function extractFullAssistantContent(data: LogEntry): string {
  try {
    if (isAssistantResponse(data) && data.message?.content && Array.isArray(data.message.content)) {
      const textContent = data.message.content.filter(c => isTextContent(c)) as any[];
      if (textContent.length > 0) {
        return textContent.map((c: any) => c.text || '').join('\n\n');
      }
    }
    return '';
  } catch (error) {
    return '';
  }
}

// Format multiple assistant messages as blocks
function formatAssistantMessageBlocks(messages: string[]): any[] {
  if (messages.length === 1) {
    return [
      {
        type: "section",
        text: {
          type: "mrkdwn",
          text: `💬 *Assistant:*\n${messages[0]}`
        }
      }
    ];
  }
  
  const blocks = [
    {
      type: "section",
      text: {
        type: "mrkdwn",
        text: `💬 *Assistant (${messages.length} messages):*`
      }
    }
  ];
  
  messages.forEach((msg, index) => {
    // Split long messages into multiple blocks if needed
    const maxLength = 2800;
    if (msg.length > maxLength) {
      const chunks = [];
      for (let i = 0; i < msg.length; i += maxLength) {
        chunks.push(msg.substring(i, i + maxLength));
      }
      
      chunks.forEach((chunk, chunkIndex) => {
        blocks.push({
          type: "section",
          text: {
            type: "mrkdwn",
            text: `*${index + 1}.${chunkIndex > 0 ? ` (cont.)` : ''}*\n${chunk}`
          }
        });
      });
    } else {
      blocks.push({
        type: "section",
        text: {
          type: "mrkdwn",
          text: `*${index + 1}.* ${msg}`
        }
      });
    }
  });
  
  return blocks;
}

// Format multiple assistant messages as a list (fallback)
function formatAssistantMessageList(messages: string[]): string {
  if (messages.length === 1) {
    return `💬 *Assistant:*\n${messages[0]}`;
  }
  
  const header = `💬 *Assistant (${messages.length} messages):*\n`;
  const formattedMessages = messages.map((msg, index) => {
    // Indent each line of the message for better formatting
    const indentedMsg = msg.split('\n').map(line => `   ${line}`).join('\n');
    return `${index + 1}. ${indentedMsg}`;
  }).join('\n\n');
  
  return header + formattedMessages;
}

// Use createSlackBlocks from slack.ts
const createSlackBlocks = slackCreateSlackBlocks;

// Use createSlackMessage from slack.ts
const createSlackMessage = slackCreateSlackMessage;

// Add reaction to a Slack message (non-blocking)
async function addReaction(slackConfig: SlackConfig, timestamp: string, reaction: string): Promise<void> {
  try {
    await slackConfig.client.reactions.add({
      channel: slackConfig.channel,
      timestamp: timestamp,
      name: reaction,
    });
  } catch (error: any) {
    // Silently ignore all reaction errors to prevent script failure
    // Only log in debug if needed
  }
}

// Remove reaction from a Slack message (non-blocking)
async function removeReaction(slackConfig: SlackConfig, timestamp: string, reaction: string): Promise<void> {
  try {
    await slackConfig.client.reactions.remove({
      channel: slackConfig.channel,
      timestamp: timestamp,
      name: reaction,
    });
  } catch (error: any) {
    // Silently ignore all reaction errors to prevent script failure
    // Only log in debug if needed
  }
}

// Safely manage reactions without blocking
async function safeManageReactions(slackConfig: SlackConfig, timestamp: string, addReactions: string[], removeReactions: string[]): Promise<void> {
  // Fire and forget - don't await
  Promise.all([
    ...removeReactions.map(r => removeReaction(slackConfig, timestamp, r)),
    ...addReactions.map(r => addReaction(slackConfig, timestamp, r))
  ]).catch(() => {
    // Silently ignore any errors
  });
}

// Create combined blocks for multiple tool uses
async function createCombinedToolUseBlocks(slackConfig: SlackConfig, newData: LogEntry, totalCount: number): Promise<any[]> {
  const blocks: any[] = [
    {
      type: "header",
      text: {
        type: "plain_text",
        text: `🔧 Tools (${totalCount} operations)`
      }
    }
  ];
  
  // Add new tool uses from the current message
  if (isAssistantResponse(newData)) {
    const toolUses = newData.message.content.filter(c => isToolUseContent(c)) as any[];
    
    toolUses.forEach((tool: any, index: number) => {
      // Add divider between tools
      if (blocks.length > 1) {
        blocks.push({ type: "divider" });
      }
      
      // Special formatting for TodoWrite
      if (tool.name === 'TodoWrite' && tool.input.todos) {
        blocks.push({
          type: "section",
          text: {
            type: "mrkdwn",
            text: "*📝 TodoWrite*"
          }
        });
        
        // Group todos by status
        const pendingTodos = tool.input.todos.filter((t: any) => t.status === 'pending');
        const inProgressTodos = tool.input.todos.filter((t: any) => t.status === 'in_progress');
        const completedTodos = tool.input.todos.filter((t: any) => t.status === 'completed');
        
        // Add pending todos
        if (pendingTodos.length > 0) {
          const pendingText = pendingTodos.map((todo: any) => {
            const priorityEmoji = todo.priority === 'high' ? '🔴' : 
                                todo.priority === 'medium' ? '🟡' : '🟢';
            return `${priorityEmoji} ${todo.content}`;
          }).join('\n');
          
          blocks.push({
            type: "section",
            text: {
              type: "mrkdwn",
              text: `*⏳ Pending:*\n${pendingText}`
            }
          });
        }
        
        // Add in-progress todos
        if (inProgressTodos.length > 0) {
          const inProgressText = inProgressTodos.map((todo: any) => {
            const priorityEmoji = todo.priority === 'high' ? '🔴' : 
                                todo.priority === 'medium' ? '🟡' : '🟢';
            return `${priorityEmoji} ${todo.content}`;
          }).join('\n');
          
          blocks.push({
            type: "section",
            text: {
              type: "mrkdwn",
              text: `*🔄 In Progress:*\n${inProgressText}`
            }
          });
        }
        
        // Add completed todos
        if (completedTodos.length > 0) {
          const completedText = completedTodos.map((todo: any) => `~${todo.content}~`).join('\n');
          
          blocks.push({
            type: "section",
            text: {
              type: "mrkdwn",
              text: `*✅ Completed:*\n${completedText}`
            }
          });
        }
        
        // Add summary
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
          type: "section",
          text: {
            type: "mrkdwn",
            text: `*${tool.name}*`
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
  }
  
  return blocks;
}

// Update a tool_use message with completion status
async function updateToolUseMessage(slackConfig: SlackConfig, messageTs: string, toolName: string, toolInput: any, toolResult: any): Promise<void> {
  try {
    const isError = toolResult.is_error || false;
    const statusIcon = isError ? '🔴' : '🟢';
    const statusText = isError ? 'Failed' : 'Completed';
    
    // Create blocks for the updated status
    const blocks: any[] = [
      {
        type: "header",
        text: {
          type: "plain_text",
          text: `🔧 ${toolName}`
        }
      }
    ];
    
    // Add original tool input fields
    const fields: any[] = [];
    
    // Add file path for file-related tools
    if (toolInput.file_path) {
      const trimmedPath = trimFilePath(toolInput.file_path);
      fields.push({
        type: "mrkdwn",
        text: `*File:*\n\`${trimmedPath}\``
      });
    }
    
    if (toolInput.command) {
      fields.push({
        type: "mrkdwn",
        text: `*Command:*\n\`${toolInput.command}\``
      });
    }
    if (toolInput.description) {
      fields.push({
        type: "mrkdwn",
        text: `*Description:*\n${toolInput.description}`
      });
    }
    
    // Add other relevant parameters
    if (toolInput.pattern) {
      fields.push({
        type: "mrkdwn",
        text: `*Pattern:*\n\`${toolInput.pattern}\``
      });
    }
    if (toolInput.limit && typeof toolInput.limit === 'number') {
      fields.push({
        type: "mrkdwn",
        text: `*Limit:*\n${toolInput.limit} lines`
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
          text: `${statusIcon} *${statusText}*`
        }
      ]
    });
    
    // If there's an error message, include it
    if (isError && toolResult.content) {
      const errorMessage = toolResult.content.length > 500 
        ? toolResult.content.substring(0, 497) + '...' 
        : toolResult.content;
      blocks.push({
        type: "section",
        text: {
          type: "mrkdwn",
          text: `⚠️ *Error:*\n\`\`\`${errorMessage}\`\`\``
        }
      });
    }
    
    await slackConfig.client.chat.update({
      channel: slackConfig.channel,
      ts: messageTs,
      text: `${statusIcon} *${toolName} ${statusText}*`,
      blocks: blocks
    });
    
  } catch (error: any) {
    console.error('Failed to update tool use message:', error?.data?.error || error.message);
  }
}

// Post message to Slack
async function postToSlack(slackConfig: SlackConfig, data: LogEntry): Promise<void> {
  try {
    const messageType = getMessageType(data);
    
    // Handle tool_result updates first
    if (messageType === 'tool_result' && isUserResponse(data)) {
      const toolResults = data.message.content.filter(c => isToolResultContent(c)) as any[];
      for (const toolResult of toolResults) {
        const toolInfo = slackConfig.pendingToolUses.get(toolResult.tool_use_id);
        if (toolInfo) {
          await updateToolUseMessage(slackConfig, toolInfo.messageTs, toolInfo.toolName, toolInfo.toolInput, toolResult);
          slackConfig.pendingToolUses.delete(toolResult.tool_use_id);
        }
      }
      return; // Don't post a separate message for tool results
    }
    
    // Generate a unique content identifier for deduplication
    // For assistant messages, use the full original content instead of truncated text
    let contentForDedup = '';
    if (isAssistantResponse(data)) {
      const textContent = data.message.content.filter(c => isTextContent(c)) as any[];
      if (textContent.length > 0) {
        // Use full original content for deduplication
        contentForDedup = textContent.map((c: any) => c.text).join('\n\n');
      } else {
        // For tool uses, create a stable identifier
        const toolUses = data.message.content.filter(c => isToolUseContent(c)) as any[];
        contentForDedup = toolUses.map((t: any) => `${t.name}:${JSON.stringify(t.input)}`).join('|');
      }
    } else {
      // For non-assistant messages, use the formatted message
      contentForDedup = createSlackMessage(data);
    }
    
    // Check for duplicate content - skip posting if identical to last message
    if (slackConfig.lastPostedContent && slackConfig.lastPostedContent === contentForDedup) {
      return; // Skip duplicate message
    }
    
    const messageText = createSlackMessage(data);
    
    // Special deduplication for result messages that match the last assistant message
    // Only deduplicate if the result text is substantial (more than just status)
    if (messageType === 'result' && data.result && slackConfig.lastAssistantText && data.result.length > 50) {
      const normalizedResult = data.result.trim();
      const normalizedAssistant = slackConfig.lastAssistantText.trim();
      if (normalizedResult === normalizedAssistant) {
        return; // Skip duplicate result message
      }
    }
    
    if (!slackConfig.threadTs) {
      // Create initial thread message
      const postParams: any = {
        channel: slackConfig.channel,
        text: messageText,
        blocks: createSlackBlocks(data)
      };
      
      const result = await slackConfig.client.chat.postMessage(postParams);
      
      if (result.ts) {
        slackConfig.threadTs = result.ts;
        slackConfig.initialMessageTs = result.ts; // Track initial message for reactions
        // Save the thread timestamp for future use
        writeSlackThreadToFile(result.ts);
        
        // Track the posted content for deduplication
        slackConfig.lastPostedContent = contentForDedup;
        
        // Add rocket reaction to indicate workflow started
        if (messageType === 'system_init') {
          safeManageReactions(slackConfig, result.ts, ['rocket'], []);
        }
        
        // Store last message info
        slackConfig.lastMessage = {
          ts: result.ts,
          type: messageType,
          content: messageType === 'assistant' ? extractFullAssistantContent(data) : contentForDedup,
          count: 1
        };
        
        // Track tool_use IDs if this is a tool_use message
        if (messageType === 'tool_use' && isAssistantResponse(data)) {
          const toolUses = data.message.content.filter(c => isToolUseContent(c)) as any[];
          toolUses.forEach((tool: any) => {
            if (tool.id && result.ts) {
              slackConfig.pendingToolUses.set(tool.id, {
                messageTs: result.ts,
                toolName: tool.name,
                toolInput: tool.input
              });
            }
          });
        }
        
        // Track assistant text for result deduplication
        if (messageType === 'assistant') {
          slackConfig.lastAssistantText = extractFullAssistantContent(data);
        }
      }
    } else {
      // Set initial message timestamp if not already set (for existing threads)
      if (!slackConfig.initialMessageTs && slackConfig.threadTs) {
        slackConfig.initialMessageTs = slackConfig.threadTs;
        // Add rocket reaction if this is the first message in existing thread
        if (messageType === 'system_init') {
          safeManageReactions(slackConfig, slackConfig.threadTs, ['rocket'], []);
        }
      }
      
      // Handle result messages - add success/failure reactions
      if (messageType === 'result' && slackConfig.initialMessageTs) {
        const isSuccess = data.subtype === 'success' && !data.is_error;
        if (isSuccess) {
          safeManageReactions(slackConfig, slackConfig.initialMessageTs, ['white_check_mark'], ['rocket']);
        } else {
          safeManageReactions(slackConfig, slackConfig.initialMessageTs, ['rotating_light'], ['rocket']);
        }
      }
      
      // Check if we should update the previous message
      const shouldUpdate = slackConfig.lastMessage && 
                          slackConfig.lastMessage.type === messageType &&
                          ['assistant', 'tool_use', 'system_init'].includes(messageType); // Update assistant, tool_use, and system_init messages
      
      if (shouldUpdate && slackConfig.lastMessage) {
        try {
          let updatedBlocks: any[] = [];
          let updatedMessage = '';
          let updatedContent = '';
          
          if (messageType === 'assistant') {
            // Extract new full content and append to existing
            const newContent = extractFullAssistantContent(data);
            const existingMessages = slackConfig.lastMessage.content.split('\n---\n');
            existingMessages.push(newContent);
            
            // Format as blocks and fallback text
            updatedBlocks = formatAssistantMessageBlocks(existingMessages);
            updatedMessage = formatAssistantMessageList(existingMessages);
            updatedContent = existingMessages.join('\n---\n');
            
            // Update last assistant text with the latest message
            slackConfig.lastAssistantText = existingMessages[existingMessages.length - 1];
          } else if (messageType === 'tool_use') {
            // Handle tool_use message updates
            const existingCount = slackConfig.lastMessage.count;
            const newCount = existingCount + 1;
            
            // Create combined blocks for multiple tool uses
            updatedBlocks = await createCombinedToolUseBlocks(slackConfig, data, newCount);
            updatedMessage = `🔧 *Tools (${newCount} operations)*`;
            updatedContent = contentForDedup;
          } else if (messageType === 'system_init') {
            // Handle system_init message updates (rare, but possible)
            const existingCount = slackConfig.lastMessage.count;
            const newCount = existingCount + 1;
            
            updatedBlocks = createSlackBlocks(data);
            updatedMessage = `🚀 *Claude Code Sessions (${newCount})*`;
            updatedContent = contentForDedup;
          }
          
          // Try to update the previous message
          const updateResult = await slackConfig.client.chat.update({
            channel: slackConfig.channel,
            ts: slackConfig.lastMessage.ts,
            text: updatedMessage,
            blocks: updatedBlocks,
          });
          
          if (updateResult.ok) {
            // Update stored content
            slackConfig.lastMessage.content = updatedContent;
            slackConfig.lastMessage.count = messageType === 'assistant' ? 
              updatedContent.split('\n---\n').length : 
              slackConfig.lastMessage.count + 1;
            // Update deduplication tracking with the full combined content
            slackConfig.lastPostedContent = updatedContent;
            
            // Track new tool_use IDs if this is a tool_use message
            if (messageType === 'tool_use' && isAssistantResponse(data)) {
              const toolUses = data.message.content.filter(c => isToolUseContent(c)) as any[];
              toolUses.forEach((tool: any) => {
                if (tool.id) {
                  slackConfig.pendingToolUses.set(tool.id, {
                    messageTs: slackConfig.lastMessage!.ts,
                    toolName: tool.name,
                    toolInput: tool.input
                  });
                }
              });
            }
            
            return; // Successfully updated
          }
        } catch (updateError: any) {
          // Update failed, fall back to posting a new message
          console.error('Failed to update previous message, posting new message instead');
        }
      }
      
      // Post to existing thread as a new message
      const postParams: any = {
        channel: slackConfig.channel,
        text: messageText,
        thread_ts: slackConfig.threadTs,
        blocks: createSlackBlocks(data)
      };
      
      const result = await slackConfig.client.chat.postMessage(postParams);
      
      // Store last message info and track tool_use IDs
      if (result.ts) {
        // Track the posted content for deduplication
        slackConfig.lastPostedContent = contentForDedup;
        
        // Store last message info
        slackConfig.lastMessage = {
          ts: result.ts,
          type: messageType,
          content: messageType === 'assistant' ? extractFullAssistantContent(data) : contentForDedup,
          count: 1
        };
        
        // Track tool_use IDs if this is a tool_use message
        if (messageType === 'tool_use' && isAssistantResponse(data)) {
          const toolUses = data.message.content.filter(c => isToolUseContent(c)) as any[];
          toolUses.forEach((tool: any) => {
            if (tool.id && result.ts) {
              slackConfig.pendingToolUses.set(tool.id, {
                messageTs: result.ts,
                toolName: tool.name,
                toolInput: tool.input
              });
            }
          });
        }
        
        // Track assistant text for result deduplication
        if (messageType === 'assistant') {
          slackConfig.lastAssistantText = extractFullAssistantContent(data);
        }
      }
    }
  } catch (error: any) {
    // Check for authentication errors specifically
    if (error?.data?.error === 'invalid_auth' || error?.data?.error === 'account_inactive' || error?.data?.error === 'token_revoked') {
      console.error('Slack authentication failed:', error.data.error);
      console.error('Please check your CCPRETTY_SLACK_TOKEN environment variable');
    } else if (error?.data?.error === 'channel_not_found') {
      console.error('Slack channel not found:', slackConfig.channel);
      console.error('Please check your CCPRETTY_SLACK_CHANNEL environment variable');
    } else {
      console.error('Failed to post to Slack:', error?.data?.error || error.message || error);
    }
  }
}

function formatLogEntry(data: LogEntry): string {
  // Handle assistant responses with special formatting
  if (isAssistantResponse(data)) {
    return formatAssistantResponse(data as AssistantResponse);
  }
  
  // Handle user responses
  if (isUserResponse(data)) {
    return formatUserResponse(data as UserResponse);
  }
  
  // Handle system responses
  if (isSystemResponse(data)) {
    return formatSystemResponse(data as SystemResponse);
  }
  
  // Handle result responses
  if (data.type === 'result') {
    return formatResultResponse(data);
  }
  
  // Default: format unknown event with full details
  return formatUnknownResponse(data);
}


async function main() {
  const config = getConfig();
  const { slack: { token, channel, threadTs }, useQueue } = config;
  
  // Initialize Slack configuration if token and channel are provided
  let slackConfig: SlackConfig | null = null;
  if (token && channel) {
    slackConfig = {
      token,
      channel,
      threadTs,
      client: new WebClient(token),
      pendingToolUses: new Map(),
    };
    
    // Print Slack configuration confirmation
    console.error('Slack integration active:');
    console.error(`  Channel: ${channel}`);
    console.error(`  Thread: ${threadTs ? threadTs : 'New thread will be created'}`);
  }
  
  // Initialize queue-based processing if enabled
  let messageQueue: MessageQueue | null = null;
  let messageReducer: MessageReducer | null = null;
  
  if (useQueue) {
    console.error('Queue-based processing enabled');
    
    messageReducer = new MessageReducer();
    messageQueue = new MessageQueue((groups: MessageGroup[]) => {
      if (messageReducer) {
        const processedMessages = messageReducer.reduceGroups(groups);
        
        for (const processed of processedMessages) {
          console.log(processed.content);
          
          // Post to Slack if configured
          if (slackConfig && groups.length > 0) {
            // Convert back to LogEntry for Slack posting
            const firstMessage = groups[0].messages[0];
            if (isSignificantEvent(firstMessage.logEntry)) {
              postToSlack(slackConfig, firstMessage.logEntry);
            }
          }
        }
      }
    });
    
    messageQueue.start();
  }

  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
    terminal: false
  });

  let buffer = '';
  let braceCount = 0;
  let inString = false;
  let escapeNext = false;

  rl.on('line', async (line: string) => {
    // If this line starts with a timestamp and we have a buffer, process it first
    if (buffer && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d+Z/.test(line)) {
      await processJsonBuffer(buffer);
      buffer = '';
      braceCount = 0;
      inString = false;
      escapeNext = false;
    }

    // Add line to buffer
    if (buffer) {
      buffer += '\n' + line;
    } else {
      buffer = line;
    }

    // Count braces to track JSON structure, accounting for strings
    for (let i = 0; i < line.length; i++) {
      const char = line[i];
      
      if (escapeNext) {
        escapeNext = false;
        continue;
      }
      
      if (char === '\\') {
        escapeNext = true;
        continue;
      }
      
      if (char === '"' && !escapeNext) {
        inString = !inString;
        continue;
      }
      
      if (!inString) {
        if (char === '{') {
          braceCount++;
        } else if (char === '}') {
          braceCount--;
          
          // If we've closed all braces, we have a complete JSON object
          if (braceCount === 0) {
            await processJsonBuffer(buffer);
            buffer = '';
            braceCount = 0;
            inString = false;
            escapeNext = false;
          }
        }
      }
    }
  });

  rl.on('close', async () => {
    // Process any remaining buffer
    if (buffer) {
      await processJsonBuffer(buffer);
    }
    
    // Stop queue processing if enabled
    if (messageQueue) {
      // Give the queue a moment to process any final messages
      // that might have just been enqueued
      await new Promise(resolve => setTimeout(resolve, 1000));
      messageQueue.stop();
    }
    
    process.exit(0);
  });

  async function processJsonBuffer(text: string) {
    try {
      // Extract JSON objects from the buffer
      const jsonObjects = await extractJson(text);
      
      if (jsonObjects.length === 0) {
        console.log(text);
        return;
      }
      
      // Process each JSON object found
      for (const obj of jsonObjects) {
        try {
          const logEntry = obj as LogEntry;
          
          if (useQueue && messageQueue) {
            // Queue-based processing
            messageQueue.enqueue(logEntry);
          } else {
            // Original immediate processing
            console.log(formatLogEntry(logEntry));
            
            // Post significant events to Slack if configured
            if (slackConfig && isSignificantEvent(logEntry)) {
              await postToSlack(slackConfig, logEntry);
            }
          }
        } catch (entryError: any) {
          // Handle individual message processing errors gracefully
          console.error('Error processing log entry:', entryError.message);
          console.log(JSON.stringify(obj, null, 2)); // Still show the raw JSON
        }
      }
    } catch (error) {
      // If extraction fails, just print the text
      console.log(text);
    }
  }
}

main();