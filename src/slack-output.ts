import { WebClient } from '@slack/web-api';
import { 
  Message,
  isAssistantResponse, 
  isUserResponse, 
  isSystemResponse,
  isTextContent,
  isToolUseContent,
  isToolResultContent,
  AssistantResponse,
  UserResponse,
  SystemResponse,
  ResultResponse
} from './models';
// Removed ReducedMessage dependency
import { RateLimiter } from './rate-limiter';
import { isSignificantEvent } from './slack';
import { formatSessionDisplay } from './github-utils';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

interface SlackConfig {
  token: string;
  channel: string;
  threadTs?: string;
}

export class SlackOutput {
  private client: WebClient;
  private config: SlackConfig;
  private threadTs?: string;
  private initialMessageTs?: string;
  private toolMessages: Map<string, { ts: string; name: string; input: any }> = new Map();
  private lastSlackContent: string = '';
  private sessionId?: string;
  private rateLimiter: RateLimiter;
  private debugMode: boolean;
  private debugLogPath?: string;
  
  constructor(config: SlackConfig) {
    this.config = config;
    this.client = new WebClient(config.token);
    this.threadTs = config.threadTs;
    // Rate limit to 1 call per second to avoid Slack rate limits
    this.rateLimiter = new RateLimiter(1);
    
    // Initialize debug mode
    this.debugLogPath = process.env.CCPRETTY_SLACK_DEBUG;
    this.debugMode = !!this.debugLogPath;
    if (this.debugMode) {
      this.initializeDebugLog();
    }
  }
  
  /**
   * Initialize debug logging
   */
  private initializeDebugLog(): void {
    if (!this.debugLogPath) return;
    
    try {
      // Ensure directory exists
      const debugDir = path.dirname(this.debugLogPath);
      if (!fs.existsSync(debugDir)) {
        fs.mkdirSync(debugDir, { recursive: true });
      }
      
      // Write header to log file
      const timestamp = new Date().toISOString();
      const header = `\n=== CCPRETTY SLACK DEBUG SESSION STARTED AT ${timestamp} ===\n`;
      fs.appendFileSync(this.debugLogPath, header);
      
      console.log(`Slack debug logging enabled: ${this.debugLogPath}`);
    } catch (error) {
      console.error('Failed to initialize Slack debug log:', error);
      this.debugMode = false;
    }
  }
  
  /**
   * Log Slack API call to debug file
   */
  private logSlackCall(method: string, payload: any, response?: any): void {
    if (!this.debugMode || !this.debugLogPath) return;
    
    try {
      const timestamp = new Date().toISOString();
      const logEntry = {
        timestamp,
        method,
        payload,
        response: response ? { ts: response.ts, ok: response.ok } : undefined
      };
      
      const logLine = `${JSON.stringify(logEntry, null, 2)}\n`;
      fs.appendFileSync(this.debugLogPath, logLine);
    } catch (error) {
      // Silently ignore debug logging errors
    }
  }

  /**
   * Output a message to Slack
   */
  async output(message: Message): Promise<void> {
    try {
      const currentType = message.type;
    
    // Debug log all messages
    if (process.env.CCPRETTY_DEBUG) {
      console.error(`[SlackOutput] Received ${currentType} message`);
    }
    
    // Check if this is a significant event worth posting to Slack
    if (!isSignificantEvent(message as any)) {
      if (process.env.CCPRETTY_DEBUG) {
        console.error(`[SlackOutput] Skipping non-significant ${currentType} message`);
      }
      return;
    }
    
    // Handle different message types
    try {
      if (isSystemResponse(message)) {
        await this.handleSystemMessage(message as SystemResponse);
      } else if (isAssistantResponse(message)) {
        await this.handleAssistantMessage(message as AssistantResponse);
      } else if (message.type === 'result') {
        await this.handleResultMessage(message as ResultResponse);
      } else if (isUserResponse(message)) {
        // Handle user messages that contain tool results
        await this.handleUserMessage(message as UserResponse);
      }
    } catch (error) {
      console.error('Error handling specific message type:', error);
      if (process.env.CCPRETTY_DEBUG) {
        console.error('Message type:', currentType);
      }
      // Continue processing despite message handling errors
    }
    } catch (error) {
      console.error('Error processing Slack output:', error);
      if (process.env.CCPRETTY_DEBUG) {
        console.error('Problematic message:', JSON.stringify(message, null, 2));
      }
    }
  }
  
  /**
   * Handle system messages (session start)
   */
  private async handleSystemMessage(response: SystemResponse): Promise<void> {
    if (response.subtype !== 'init') return;
    
    this.sessionId = response.session_id;
    const tools = 'tools' in response ? response.tools : [];
    
    // Create the initial session message without tools
    const sessionDisplay = formatSessionDisplay(this.sessionId || '');
    let text: string;
    
    if (sessionDisplay.isLink) {
      text = `*Session Started*\n<${sessionDisplay.text}|GitHub Actions Run>`;
    } else {
      text = `*Session Started* (${sessionDisplay.text})`;
    }
    
    try {
      const payload = {
        channel: this.config.channel,
        text,
        thread_ts: this.threadTs
      };
      
      this.logSlackCall('chat.postMessage', payload);
      
      const result = await this.rateLimiter.execute(() => 
        this.client.chat.postMessage(payload)
      );
      
      this.logSlackCall('chat.postMessage', payload, result);
      
      if (!this.threadTs && result.ts) {
        this.threadTs = result.ts;
        this.initialMessageTs = result.ts;
        await this.saveThreadTs(result.ts);
      }
      
      // Add initial reaction
      if (this.initialMessageTs) {
        const reactionPayload = {
          channel: this.config.channel,
          timestamp: this.initialMessageTs!,
          name: 'rocket'
        };
        
        this.logSlackCall('reactions.add', reactionPayload);
        
        const reactionResult = await this.rateLimiter.execute(() =>
          this.client.reactions.add(reactionPayload)
        );
        
        this.logSlackCall('reactions.add', reactionPayload, reactionResult);
      }

      // Post available tools as a separate message in the thread
      if (tools.length > 0) {
        await this.postAvailableTools(tools);
      }
    } catch (error) {
      console.error('Failed to post to Slack:', error);
    }
  }

  /**
   * Post available tools as a separate message
   */
  private async postAvailableTools(tools: string[]): Promise<void> {
    try {
      const blocks = [
        {
          type: "divider"
        },
        {
          type: "section",
          text: {
            type: "mrkdwn",
            text: "🔧 *Available Tools*"
          }
        }
      ];

      // Show up to 9 tools, then add remaining count if needed
      const contextElements = tools.slice(0, 9).map(tool => ({
        type: "mrkdwn",
        text: `\`${tool}\``
      }));

      // Add remaining count if there are more than 9 tools
      if (tools.length > 9) {
        const remainingCount = tools.length - 9;
        contextElements.push({
          type: "mrkdwn",
          text: `_+${remainingCount} more_`
        });
      }

      blocks.push({
        type: "context",
        elements: contextElements
      } as any);

      const payload = {
        channel: this.config.channel,
        thread_ts: this.threadTs,
        blocks,
        text: `Available tools: ${tools.join(', ')}`
      };
      
      this.logSlackCall('chat.postMessage', payload);
      
      const result = await this.rateLimiter.execute(() =>
        this.client.chat.postMessage(payload)
      );
      
      this.logSlackCall('chat.postMessage', payload, result);
    } catch (error) {
      console.error('Failed to post available tools to Slack:', error);
    }
  }
  
  /**
   * Handle assistant messages
   */
  private async handleAssistantMessage(response: AssistantResponse): Promise<void> {
    const contents = response.message?.content || [];
    
    // Handle text content and tool uses
    let hasText = false;
    let hasToolUse = false;
    
    for (const content of contents) {
      if (isTextContent(content)) {
        hasText = true;
        await this.postAssistantText(content.text);
      } else if (isToolUseContent(content)) {
        hasToolUse = true;
        await this.postToolUse(content);
      }
    }
    
    // Note: Tool uses are accumulated and will be flushed when message type changes
    // or when waitForCompletion() is called
  }
  
  
  /**
   * Create Slack blocks for tool execution
   */
  private createToolBlocks(toolName: string, status: string, duration: number | undefined, input: any, result: any): any[] {
    // Special formatting for TodoWrite
    if (toolName === 'TodoWrite' && input?.todos) {
      const statusEmoji = status === 'completed' ? '✅' : 
                         status === 'failed' ? '❌' : 
                         status === 'interrupted' ? '⚠️' : '🔧';
      const durationStr = duration ? ` (${(duration / 1000).toFixed(2)}s)` : '';
      
      const blocks: any[] = [
        {
          "type": "divider"
        },
        {
          type: "header",
          text: {
            type: "plain_text",
            text: `📝 Todo List`,
            emoji: true
          }
        }
      ];
      
      // Create single todo list with rich formatting
      const todoElements = input.todos.map((todo: any) => {
        const statusText = todo.status === 'pending' ? '[ ]' :
               todo.status === 'in_progress' ? '[•]' :
               todo.status === 'completed' ? '[X]' : '[?]';
        
        const listItem = [
          {
            type: "text",
            text: "- "
          },
          {
            type: "text",
            text: statusText,
            style: {
              code: true
            }
          },
          {
            type: "text",
            text: " "
          }
        ];

        if (todo.status === 'completed') {
          listItem.push({
            type: "text",
            text: todo.content,
            style: {
              strike: true
            }
          } as any);
        } else {
          listItem.push({
            type: "text",
            text: todo.content
          });
        }

        return {
          type: "rich_text_section",
          elements: listItem
        };
      });

      blocks.push({
        type: "rich_text",
        elements: [
          {
            type: "rich_text_list",
            style: "ordered",
            elements: todoElements
          }
        ]
      });
      
      // Add summary context
      const completedCount = input.todos.filter((t: any) => t.status === 'completed').length;
      blocks.push({
        type: "context",
        elements: [
          {
            type: "mrkdwn",
            text: `📊 *Summary:* ${completedCount}/${input.todos.length} completed`
          }
        ]
      });
      
      return blocks;
    }
    
    // Standard tool formatting
    const statusEmoji = status === 'completed' ? '✅' : 
                       status === 'failed' ? '❌' : 
                       status === 'interrupted' ? '⚠️' : '⏳';
    
    const durationStr = duration ? ` (${(duration / 1000).toFixed(2)}s)` : '';
    
    const blocks: any[] = [
      {
        type: "divider"
      },
      {
        type: "rich_text",
        elements: [
          {
            type: "rich_text_section",
            elements: [
              {
                type: "text",
                text: `${statusEmoji} `
              },
              {
                type: "text",
                text: toolName,
                style: {
                  bold: true
                }
              },
              {
                type: "text",
                text: ` ${status}${durationStr}`
              }
            ]
          }
        ]
      }
    ];
    
    // Add description as a section block if present
    if (input?.description) {
      blocks.push({
        type: 'section',
        text: {
          type: 'mrkdwn',
          text: `${input.description}`
        }
      });
    }

    // Add context with parameters (command and file_path)
    const contextElements: any[] = [];

    if (input?.command) {
      contextElements.push({
        type: 'mrkdwn',
        text: `\`\`\`\n${input.command}\n\`\`\``
      });
    }
    
    if (input?.file_path) {
      contextElements.push({
        type: 'mrkdwn',
        text: `*File:* \`${input.file_path}\``
      });
    }
    
    if (contextElements.length > 0) {
      blocks.push({
        type: 'context',
        elements: contextElements.slice(0, 10) // Slack limit
      });
    }
    
    // Add error for failed tools
    if (status === 'failed' && result) {
      const errorText = typeof result === 'string' ? result : JSON.stringify(result);
      blocks.push({
        type: "rich_text",
        elements: [
          {
            type: "rich_text_preformatted",
            elements: [
              {
                type: "text",
                text: "Error: ",
                style: {
                  bold: true
                }
              },
              {
                type: "text",
                text: errorText.substring(0, 300)
              }
            ]
          }
        ]
      });
    }
    
    return blocks;
  }
  
  /**
   * Post assistant text content
   */
  private async postAssistantText(text: string): Promise<void> {
    if (!text.trim()) return;
    
    // Check for deduplication
    if (text === this.lastSlackContent) {
      if (process.env.CCPRETTY_DEBUG) {
        console.error('[SlackOutput] Skipping duplicate assistant message');
      }
      return;
    }
    
    this.lastSlackContent = text;
    
    // Split text into paragraphs and create sections
    const paragraphs = text.split(/\n\s*\n/).filter(p => p.trim());
    
    try {
      const blocks = [
        {
          type: "divider"
        },
        {
          type: "header",
          text: {
            type: "plain_text",
            text: `💬 Assistant`,
            emoji: true
          }
        }
      ];

      // Add each paragraph as a separate section
      for (const paragraph of paragraphs) {
        const trimmedParagraph = paragraph.trim();
        if (trimmedParagraph) {
          // Truncate individual paragraphs if too long for a single section
          let sectionText = trimmedParagraph;
          if (trimmedParagraph.length > 2900) {
            sectionText = trimmedParagraph.substring(0, 2900) + '...';
          }
          
          blocks.push({
            type: "section",
            text: {
              type: "mrkdwn",
              text: sectionText
            }
          } as any);
        }
      }

      // If no paragraphs were created (single line text), add as one section
      if (blocks.length === 2) {
        let sectionText = text.trim();
        if (sectionText.length > 2900) {
          sectionText = sectionText.substring(0, 2900) + '...';
        }
        blocks.push({
          type: "section",
          text: {
            type: "mrkdwn",
            text: sectionText
          }
        } as any);
      }

      const payload = {
        channel: this.config.channel,
        thread_ts: this.threadTs,
        blocks,
        text: `💬 ${text.length > 100 ? text.substring(0, 100) + '...' : text}`
      };
      
      this.logSlackCall('chat.postMessage', payload);
      
      const result = await this.rateLimiter.execute(() =>
        this.client.chat.postMessage(payload)
      );
      
      this.logSlackCall('chat.postMessage', payload, result);
      
      if (process.env.CCPRETTY_DEBUG) {
        console.error('[SlackOutput] Successfully posted assistant message to Slack');
      }
    } catch (error) {
      console.error('Failed to post assistant message to Slack:', error);
    }
  }
  
  
  /**
   * Post tool use
   */
  private async postToolUse(content: any): Promise<void> {
    const blocks = this.createToolBlocks(content.name, '', undefined, content.input, null);
    
    try {
      const payload = {
        channel: this.config.channel,
        thread_ts: this.threadTs,
        blocks,
        text: `Running ${content.name}`
      };
      
      this.logSlackCall('chat.postMessage', payload);
      
      const result = await this.rateLimiter.execute(() =>
        this.client.chat.postMessage(payload)
      );
      
      this.logSlackCall('chat.postMessage', payload, result);
      
      // Store tool info with the message timestamp
      if (result.ts) {
        this.toolMessages.set(content.id, {
          ts: result.ts,
          name: content.name,
          input: content.input
        });
      }
    } catch (error) {
      console.error('Failed to post tool use to Slack:', error);
    }
  }
  
  
  
  /**
   * Handle result messages
   */
  private async handleResultMessage(response: ResultResponse): Promise<void> {
    
    const isSuccess = response.subtype === 'success' && !response.is_error;
    
    // Update initial message reaction
    if (this.initialMessageTs) {
      try {
        // Remove rocket
        const removePayload = {
          channel: this.config.channel,
          timestamp: this.initialMessageTs!,
          name: 'rocket'
        };
        
        this.logSlackCall('reactions.remove', removePayload);
        
        const removeResult = await this.rateLimiter.execute(() =>
          this.client.reactions.remove(removePayload)
        );
        
        this.logSlackCall('reactions.remove', removePayload, removeResult);
        
        // Add final status
        const addPayload = {
          channel: this.config.channel,
          timestamp: this.initialMessageTs!,
          name: isSuccess ? 'white_check_mark' : 'warning'
        };
        
        this.logSlackCall('reactions.add', addPayload);
        
        const addResult = await this.rateLimiter.execute(() =>
          this.client.reactions.add(addPayload)
        );
        
        this.logSlackCall('reactions.add', addPayload, addResult);
      } catch (error) {
        // Ignore reaction errors
      }
    }
    
    // Create result blocks
    const status = isSuccess ? '✅ Success' : '❌ Failed';
    const fallbackText = `Task ${status} - Duration: ${(response.duration_ms / 1000).toFixed(2)}s, Cost: $${response.total_cost_usd.toFixed(4)}`;
    
    const blocks: any[] = [
      {
        "type": "divider"
      },
      {
        type: "header",
        text: {
          type: "plain_text",
          text: `Task ${status}`,
          emoji: true
        }
      },
      {
        type: "context",
        elements: [
          {
            type: "mrkdwn",
            text: `⏱️ *Duration:* ${(response.duration_ms / 1000).toFixed(2)}s`
          },
          {
            type: "mrkdwn", 
            text: `🔄 *API Time:* ${(response.duration_api_ms / 1000).toFixed(2)}s`
          },
          {
            type: "mrkdwn",
            text: `💬 *Turns:* ${response.num_turns}`
          },
          {
            type: "mrkdwn",
            text: `💰 *Cost:* $${response.total_cost_usd.toFixed(4)}`
          }
        ]
      }
    ];
    
    try {
      const payload = {
        channel: this.config.channel,
        thread_ts: this.threadTs,
        blocks: blocks,
        text: fallbackText
      };
      
      this.logSlackCall('chat.postMessage', payload);
      
      const result = await this.rateLimiter.execute(() =>
        this.client.chat.postMessage(payload)
      );
      
      this.logSlackCall('chat.postMessage', payload, result);
    } catch (error) {
      console.error('Failed to post result to Slack:', error);
    }
  }
  
  /**
   * Save thread timestamp for reuse
   */
  private async saveThreadTs(ts: string): Promise<void> {
    const filePath = path.join(os.homedir(), '.ccpretty_slack_ts');
    try {
      await fs.promises.writeFile(filePath, ts, 'utf8');
    } catch (error) {
      // Ignore save errors
    }
  }
  
  /**
   * Load saved thread timestamp
   */
  static async loadSavedThreadTs(): Promise<string | undefined> {
    const filePath = path.join(os.homedir(), '.ccpretty_slack_ts');
    try {
      const ts = await fs.promises.readFile(filePath, 'utf8');
      return ts.trim();
    } catch (error) {
      return undefined;
    }
  }

  /**
   * Wait for all pending Slack messages to be sent
   */
  async waitForCompletion(): Promise<void> {
    // If we have an initial message but haven't posted a result, finalize with neutral status
    if (this.initialMessageTs) {
      await this.finalizeSessionWithoutResult();
    }
    
    // Then wait for rate limiter to finish with a timeout
    await Promise.race([
      this.rateLimiter.waitForCompletion(),
      new Promise(resolve => setTimeout(resolve, 10000)) // 10 second timeout
    ]);
  }

  /**
   * Wait for completion and mark as failure
   */
  async waitForCompletionWithFailure(): Promise<void> {
    // If we have an initial message but haven't posted a result, finalize with failure status
    if (this.initialMessageTs) {
      await this.finalizeSessionWithoutResult(true);
    }
    
    // Then wait for rate limiter to finish with a timeout
    await Promise.race([
      this.rateLimiter.waitForCompletion(),
      new Promise(resolve => setTimeout(resolve, 10000)) // 10 second timeout
    ]);
  }
  
  /**
   * Finalize Slack session when no result message is received
   */
  private async finalizeSessionWithoutResult(isFailure: boolean = false): Promise<void> {
    if (!this.initialMessageTs) return;
    
    try {
      // Remove rocket emoji
      const removePayload = {
        channel: this.config.channel,
        timestamp: this.initialMessageTs,
        name: 'rocket'
      };
      
      this.logSlackCall('reactions.remove', removePayload);
      
      await this.rateLimiter.execute(() =>
        this.client.reactions.remove(removePayload)
      );
      
      // Add completion emoji (warning for failures, checkmark for neutral completion)
      const addPayload = {
        channel: this.config.channel,
        timestamp: this.initialMessageTs,
        name: isFailure ? 'warning' : 'white_check_mark'
      };
      
      this.logSlackCall('reactions.add', addPayload);
      
      await this.rateLimiter.execute(() =>
        this.client.reactions.add(addPayload)
      );
    } catch (error) {
      // Ignore finalization errors
      if (process.env.CCPRETTY_DEBUG) {
        console.error('Error finalizing Slack session:', error);
      }
    }
  }
  

  /**
   * Get the number of pending Slack messages
   */
  getPendingCount(): number {
    return this.rateLimiter.getPendingCount();
  }
  
  /**
   * Handle user messages (mainly for tool results)
   */
  private async handleUserMessage(response: UserResponse): Promise<void> {
    const contents = response.message?.content || [];
    
    // Check if this contains tool results
    const toolResults = Array.isArray(contents) ? contents.filter((c: any) => c.type === 'tool_result') : [];
    
    if (toolResults.length === 0) {
      return; // Skip user messages without tool results
    }
    
    // Update the tool messages with their results
    for (const result of toolResults) {
      await this.updateToolMessage(result);
    }
  }
  
  /**
   * Update a tool message with its result
   */
  private async updateToolMessage(result: any): Promise<void> {
    const toolInfo = this.toolMessages.get(result.tool_use_id);
    if (!toolInfo) {
      // Tool message not found or not yet posted
      return;
    }
    
    // Determine the status and duration
    const status = result.is_error ? 'failed' : 'completed';
    const duration = undefined; // We don't have duration info in the result
    
    // Create updated blocks with the original tool info and result
    const blocks = this.createToolBlocks(toolInfo.name, status, duration, toolInfo.input, result);
    
    try {
      const payload = {
        channel: this.config.channel,
        ts: toolInfo.ts,
        blocks,
        text: `${status === 'completed' ? '✅' : '❌'} ${toolInfo.name} ${status}`
      };
      
      this.logSlackCall('chat.update', payload);
      
      await this.rateLimiter.execute(() =>
        this.client.chat.update(payload)
      );
      
      this.logSlackCall('chat.update', payload, { ok: true });
      
      // Remove the tool from tracking after update
      this.toolMessages.delete(result.tool_use_id);
    } catch (error) {
      console.error('Failed to update tool message:', error);
    }
  }
}