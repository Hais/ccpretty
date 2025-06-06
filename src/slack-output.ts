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
import { ReducedMessage } from './message-reducer';
import { RateLimiter } from './rate-limiter';
import { isSignificantEvent } from './slack';
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
  private toolMessages: Map<string, string> = new Map();
  private lastSlackContent: string = '';
  private consecutiveAssistantMessages: string[] = [];
  private sessionId?: string;
  private pendingToolUses: any[] = [];
  private lastMessageType?: string;
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
   * Output a reduced message to Slack
   */
  async output(reduced: ReducedMessage): Promise<void> {
    try {
      const { message, metadata } = reduced;
      const currentType = message.type;
    
    // Debug log all messages
    if (process.env.CCPRETTY_DEBUG) {
      console.error(`[SlackOutput] Received ${currentType} message, metadata type: ${metadata.type}`);
    }
    
    // Check if this is a significant event worth posting to Slack
    // Note: We always process tool execution metadata regardless of significance
    const isToolExecution = metadata.type === 'tool_complete' || 
                           metadata.type === 'tool_failed' || 
                           metadata.type === 'tool_interrupted';
    
    if (!isToolExecution && !isSignificantEvent(message as any)) {
      if (process.env.CCPRETTY_DEBUG) {
        console.error(`[SlackOutput] Skipping non-significant ${currentType} message`);
      }
      return;
    }
    
    // Flush any pending messages when switching to a different postable message type
    // (user messages don't count as they're not posted to Slack)
    const isPostableType = currentType !== 'user';
    const wasPostableType = this.lastMessageType && this.lastMessageType !== 'user';
    
    if (wasPostableType && isPostableType && this.lastMessageType !== currentType) {
      await this.flushPendingMessages();
      
      // Add divider between different message types 
      await this.postDivider();
    }
    
    // Handle different message types
    if (isSystemResponse(message)) {
      await this.handleSystemMessage(message as SystemResponse);
    } else if (isAssistantResponse(message)) {
      await this.handleAssistantMessage(message as AssistantResponse, metadata);
    } else if (message.type === 'result') {
      await this.handleResultMessage(message as ResultResponse);
    } else if (isUserResponse(message)) {
      // Handle user messages that contain tool results
      await this.handleUserMessage(message as UserResponse);
    }
    
    // Update last message type (only for postable types)
    if (isPostableType) {
      this.lastMessageType = currentType;
    }
    } catch (error) {
      console.error('Error processing Slack output:', error);
      if (process.env.CCPRETTY_DEBUG) {
        console.error('Problematic reduced message:', JSON.stringify(reduced, null, 2));
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
    
    // Create or update the initial message
    const text = `*Session Started* (${this.sessionId})\n_Available tools: ${tools.join(', ')}_`;
    
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
    } catch (error) {
      console.error('Failed to post to Slack:', error);
    }
  }
  
  /**
   * Handle assistant messages
   */
  private async handleAssistantMessage(response: AssistantResponse, metadata: any): Promise<void> {
    const contents = response.message?.content || [];
    
    // Check if this is a tool execution
    if (metadata.type === 'tool_complete' || metadata.type === 'tool_failed' || metadata.type === 'tool_interrupted') {
      // Flush any pending assistant messages before handling tool execution
      await this.flushAssistantMessages();
      await this.handleToolExecution(response, metadata);
      return;
    }
    
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
   * Handle tool execution messages
   */
  private async handleToolExecution(response: AssistantResponse, metadata: any): Promise<void> {
    const { toolName, toolStatus, duration, toolResult } = metadata;
    
    // Find the tool use content
    const contents = response.message?.content || [];
    const toolUse = contents.find((c: any) => c.type === 'tool_use');
    
    if (!toolUse) return;
    
    const toolId = (toolUse as any).id;
    const existingMessageTs = this.toolMessages.get(toolId);
    
    const blocks = this.createToolBlocks(toolName, toolStatus, duration, (toolUse as any).input, toolResult);
    
    try {
      if (existingMessageTs) {
        // Update existing message
        const updatePayload = {
          channel: this.config.channel,
          ts: existingMessageTs,
          blocks,
          text: `${toolName} ${toolStatus}`
        };
        
        this.logSlackCall('chat.update', updatePayload);
        
        const updateResult = await this.rateLimiter.execute(() =>
          this.client.chat.update(updatePayload)
        );
        
        this.logSlackCall('chat.update', updatePayload, updateResult);
      } else {
        // Post new message
        const postPayload = {
          channel: this.config.channel,
          thread_ts: this.threadTs,
          blocks,
          text: `${toolName} ${toolStatus}`
        };
        
        this.logSlackCall('chat.postMessage', postPayload);
        
        const result = await this.rateLimiter.execute(() =>
          this.client.chat.postMessage(postPayload)
        );
        
        this.logSlackCall('chat.postMessage', postPayload, result);
        
        if (result.ts) {
          this.toolMessages.set(toolId, result.ts);
        }
      }
    } catch (error) {
      console.error('Failed to post tool update to Slack:', error);
    }
  }
  
  /**
   * Create Slack blocks for tool execution
   */
  private createToolBlocks(toolName: string, status: string, duration: number | undefined, input: any, result: any): any[] {
    // Special formatting for TodoWrite
    if (toolName === 'TodoWrite' && input?.todos) {
      const statusEmoji = status === 'completed' ? '✅' : 
                         status === 'failed' ? '❌' : 
                         status === 'interrupted' ? '⚠️' : '⏳';
      const durationStr = duration ? ` (${(duration / 1000).toFixed(2)}s)` : '';
      
      const blocks: any[] = [
        {
          type: "header",
          text: {
            type: "plain_text",
            text: `📝 Todo List ${status}${durationStr}`,
            emoji: true
          }
        }
      ];
      
      // Group todos by status
      const pendingTodos = input.todos.filter((t: any) => t.status === 'pending');
      const inProgressTodos = input.todos.filter((t: any) => t.status === 'in_progress');
      const completedTodos = input.todos.filter((t: any) => t.status === 'completed');
      
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
      
      // Add summary context
      blocks.push({
        type: "context",
        elements: [
          {
            type: "mrkdwn",
            text: `📊 *Summary:* ${completedTodos.length}/${input.todos.length} completed`
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
        type: 'section',
        text: {
          type: 'mrkdwn',
          text: `${statusEmoji} *${toolName}* ${status}${durationStr}`
        }
      }
    ];
    
    // Add context with parameters
    const contextElements: any[] = [];
    
    if (input?.command) {
      contextElements.push({
        type: 'mrkdwn',
        text: `*Command:* \`${input.command}\``
      });
    }
    
    if (input?.description) {
      contextElements.push({
        type: 'mrkdwn',
        text: `*Description:* ${input.description}`
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
    
    // Add result for completed tools
    if (status === 'completed' && result) {
      const resultText = typeof result === 'string' ? result : JSON.stringify(result);
      if (resultText.length > 200) {
        blocks.push({
          type: 'section',
          text: {
            type: 'mrkdwn',
            text: `*Result:* ${resultText.substring(0, 197)}...`
          }
        });
      }
    }
    
    // Add error for failed tools
    if (status === 'failed' && result) {
      const errorText = typeof result === 'string' ? result : JSON.stringify(result);
      blocks.push({
        type: 'section',
        text: {
          type: 'mrkdwn',
          text: `*Error:* ${errorText.substring(0, 300)}`
        }
      });
    }
    
    return blocks;
  }
  
  /**
   * Post assistant text content
   */
  private async postAssistantText(text: string): Promise<void> {
    if (!text.trim()) return;
    
    // Accumulate consecutive assistant messages
    this.consecutiveAssistantMessages.push(text);
    
    // Debug log
    if (process.env.CCPRETTY_DEBUG) {
      console.error(`[SlackOutput] Accumulated assistant message (${this.consecutiveAssistantMessages.length} total)`);
    }
    
    // We'll post them together when we get a non-assistant message
  }
  
  /**
   * Post accumulated assistant messages
   */
  private async flushAssistantMessages(): Promise<void> {
    // First flush any pending tool uses
    await this.flushToolUses();
    
    if (this.consecutiveAssistantMessages.length === 0) return;
    
    // Debug log
    if (process.env.CCPRETTY_DEBUG) {
      console.error(`[SlackOutput] Flushing ${this.consecutiveAssistantMessages.length} assistant messages`);
    }
    
    let combinedText: string;
    
    if (this.consecutiveAssistantMessages.length === 1) {
      combinedText = this.consecutiveAssistantMessages[0];
    } else {
      // Number the messages
      combinedText = this.consecutiveAssistantMessages
        .map((msg, idx) => `${idx + 1}. ${msg}`)
        .join('\n\n');
    }
    
    // Clear the accumulator
    this.consecutiveAssistantMessages = [];
    
    // Check for deduplication
    if (combinedText === this.lastSlackContent) {
      if (process.env.CCPRETTY_DEBUG) {
        console.error('[SlackOutput] Skipping duplicate assistant message');
      }
      return;
    }
    
    this.lastSlackContent = combinedText;
    
    // Truncate if too long
    if (combinedText.length > 2800) {
      combinedText = combinedText.substring(0, 2800) + '...';
    }
    
    try {
      const payload = {
        channel: this.config.channel,
        thread_ts: this.threadTs,
        text: combinedText
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
    // Accumulate tool uses
    this.pendingToolUses.push(content);
  }
  
  /**
   * Flush pending tool uses as a single message
   */
  private async flushToolUses(): Promise<void> {
    if (this.pendingToolUses.length === 0) return;
    
    const blocks: any[] = [];
    
    // Add a header if multiple tools
    if (this.pendingToolUses.length > 1) {
      blocks.push({
        type: 'header',
        text: {
          type: 'plain_text',
          text: `Running ${this.pendingToolUses.length} tools`
        }
      });
    }
    
    // Group tools into sections
    for (const tool of this.pendingToolUses) {
      const toolBlocks = this.createToolBlocks(tool.name, 'running', undefined, tool.input, null);
      blocks.push(...toolBlocks);
      
      // Store the tool ID for later updates
      this.toolMessages.set(tool.id, 'pending');
    }
    
    try {
      const payload = {
        channel: this.config.channel,
        thread_ts: this.threadTs,
        blocks,
        text: this.pendingToolUses.length > 1 ? 
          `Running ${this.pendingToolUses.length} tools` : 
          `Running ${this.pendingToolUses[0]?.name || 'tool'}`
      };
      
      this.logSlackCall('chat.postMessage', payload);
      
      const result = await this.rateLimiter.execute(() =>
        this.client.chat.postMessage(payload)
      );
      
      this.logSlackCall('chat.postMessage', payload, result);
      
      // Update all tool IDs with the message timestamp
      if (result.ts) {
        for (const tool of this.pendingToolUses) {
          this.toolMessages.set(tool.id, result.ts);
        }
      }
    } catch (error) {
      console.error('Failed to post tool uses to Slack:', error);
    }
    
    // Clear pending tools
    this.pendingToolUses = [];
  }
  
  /**
   * Post a divider between different message types
   */
  private async postDivider(): Promise<void> {
    try {
      const payload = {
        channel: this.config.channel,
        thread_ts: this.threadTs,
        blocks: [{
          type: 'divider'
        }],
        text: '---'
      };
      
      this.logSlackCall('chat.postMessage', payload);
      
      const result = await this.rateLimiter.execute(() =>
        this.client.chat.postMessage(payload)
      );
      
      this.logSlackCall('chat.postMessage', payload, result);
    } catch (error) {
      // Ignore divider errors
    }
  }
  
  /**
   * Handle result messages
   */
  private async handleResultMessage(response: ResultResponse): Promise<void> {
    // Flush any remaining assistant messages and tools
    await this.flushAssistantMessages();
    
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
    const fallbackText = `Task ${status} - Duration: ${(response.duration_ms / 1000).toFixed(2)}s, Cost: $${response.cost_usd.toFixed(4)}`;
    
    const blocks: any[] = [
      {
        type: "header",
        text: {
          type: "plain_text",
          text: `Task ${status}`,
          emoji: true
        }
      },
      {
        type: "section",
        fields: [
          {
            type: "mrkdwn",
            text: `*⏱️ Duration:*\n${(response.duration_ms / 1000).toFixed(2)}s`
          },
          {
            type: "mrkdwn", 
            text: `*🔄 API Time:*\n${(response.duration_api_ms / 1000).toFixed(2)}s`
          },
          {
            type: "mrkdwn",
            text: `*💬 Turns:*\n${response.num_turns}`
          },
          {
            type: "mrkdwn",
            text: `*💰 Cost:*\n$${response.cost_usd.toFixed(4)}`
          }
        ]
      }
    ];

    // Add result content if it exists
    if (typeof response.result === 'string' && response.result.trim()) {
      // Truncate long results for Slack
      const resultText = response.result.length > 2000 
        ? response.result.substring(0, 1997) + '...'
        : response.result;
      
      blocks.push({
        type: "section",
        text: {
          type: "mrkdwn",
          text: resultText
        }
      });
    }
    
    try {
      const payload = {
        channel: this.config.channel,
        thread_ts: this.threadTs,
        text: fallbackText,
        blocks: blocks
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
    // First flush any pending messages
    await this.flushPendingMessages();
    
    // Then wait for rate limiter to finish
    await this.rateLimiter.waitForCompletion();
  }
  
  /**
   * Flush all pending messages (assistant messages and tool uses)
   */
  private async flushPendingMessages(): Promise<void> {
    await this.flushAssistantMessages();
    await this.flushToolUses();
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
    const toolResults = contents.filter((c: any) => c.type === 'tool_result');
    
    if (toolResults.length === 0) {
      return; // Skip user messages without tool results
    }
    
    // For now, we don't post standalone tool results as they're handled
    // by the tool execution flow. But this ensures we don't drop them.
    // In the future, we might want to post orphaned tool results.
  }
}