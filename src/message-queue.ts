// LogEntry interface - represents any log message
interface LogEntry {
  type?: string;
  [key: string]: any;
}

export interface QueuedMessage {
  id: string;
  timestamp: number;
  logEntry: LogEntry;
  processed: boolean;
}

export interface ToolPair {
  toolUse: QueuedMessage;
  toolResult?: QueuedMessage;
  startTime: number;
  toolId: string;
  toolName: string;
  interrupted?: boolean; // True if this tool was interrupted by a new tool
}

export interface MessageGroup {
  type: 'single' | 'tool_pair' | 'assistant_batch';
  messages: QueuedMessage[];
  toolPair?: ToolPair;
  startTime: number;
  endTime: number;
}

export class MessageQueue {
  private queue: QueuedMessage[] = [];
  private pendingToolUses: Map<string, ToolPair> = new Map();
  private currentActiveTool: ToolPair | null = null; // Only one tool can run at a time
  private lastProcessedTime: number = 0;
  private intervalId: NodeJS.Timeout | null = null;
  
  // Configuration
  private readonly SAMPLE_INTERVAL_MS = 500; // Process queue every 500ms
  private readonly TOOL_TIMEOUT_MS = 30000; // 30s timeout for tool completion
  private readonly MAX_QUEUE_SIZE = 1000; // Prevent memory issues
  
  constructor(private onProcessMessages: (groups: MessageGroup[]) => void | Promise<void>) {}
  
  /**
   * Add a message to the queue
   */
  enqueue(logEntry: LogEntry): void {
    const message: QueuedMessage = {
      id: this.generateId(),
      timestamp: Date.now(),
      logEntry,
      processed: false
    };
    
    this.queue.push(message);
    
    // Prevent memory leaks
    if (this.queue.length > this.MAX_QUEUE_SIZE) {
      this.queue = this.queue.slice(-this.MAX_QUEUE_SIZE);
    }
  }
  
  /**
   * Start periodic processing
   */
  start(): void {
    if (this.intervalId) return;
    
    this.intervalId = setInterval(() => {
      this.processQueue();
    }, this.SAMPLE_INTERVAL_MS);
  }
  
  /**
   * Stop periodic processing and flush remaining messages
   */
  stop(): void {
    if (this.intervalId) {
      clearInterval(this.intervalId);
      this.intervalId = null;
    }
    
    // Process any remaining messages
    this.processQueue(true);
    
    // Force process any remaining pending tool uses
    if (this.pendingToolUses.size > 0) {
      const orphanedGroups: MessageGroup[] = [];
      
      for (const [toolId, toolPair] of this.pendingToolUses.entries()) {
        const group: MessageGroup = {
          type: 'single',
          messages: [toolPair.toolUse],
          startTime: toolPair.startTime,
          endTime: Date.now()
        };
        orphanedGroups.push(group);
        toolPair.toolUse.processed = true;
      }
      
      if (orphanedGroups.length > 0) {
        this.onProcessMessages(orphanedGroups);
      }
      
      this.pendingToolUses.clear();
    }
  }
  
  /**
   * Process queued messages into groups
   */
  private processQueue(forceProcess: boolean = false): void {
    const now = Date.now();
    const groups: MessageGroup[] = [];
    
    // Find messages ready for processing
    const readyMessages = this.queue.filter(msg => 
      !msg.processed && (
        forceProcess || 
        now - msg.timestamp > this.SAMPLE_INTERVAL_MS ||
        this.isImmediateMessage(msg.logEntry)
      )
    );
    
    if (readyMessages.length === 0) return;
    
    // Group messages by type and relationships
    for (const message of readyMessages) {
      const group = this.createMessageGroup(message);
      if (group) {
        groups.push(group);
        message.processed = true;
      }
    }
    
    // Clean up old pending tool uses
    this.cleanupStaleToolUses(now);
    
    // Process groups if any
    if (groups.length > 0) {
      this.onProcessMessages(groups);
    }
    
    // Clean up processed messages
    this.queue = this.queue.filter(msg => !msg.processed);
  }
  
  /**
   * Determine if a message should be processed immediately
   */
  private isImmediateMessage(logEntry: LogEntry): boolean {
    // System messages and errors should be immediate
    return logEntry.type === 'system' || 
           (logEntry.type === 'result' && logEntry.is_error);
  }
  
  /**
   * Create a message group from a message
   */
  private createMessageGroup(message: QueuedMessage): MessageGroup | null {
    const logEntry = message.logEntry;
    
    // Handle tool_use messages
    if (this.isToolUseMessage(logEntry)) {
      return this.handleToolUseMessage(message);
    }
    
    // Handle tool_result messages
    if (this.isToolResultMessage(logEntry)) {
      return this.handleToolResultMessage(message);
    }
    
    // Handle regular messages
    return this.createSingleMessageGroup(message);
  }
  
  /**
   * Handle tool_use messages
   */
  private handleToolUseMessage(message: QueuedMessage): MessageGroup | null {
    const logEntry = message.logEntry as any;
    const content = logEntry.message?.content || [];
    const toolUse = content.find((c: any) => c.type === 'tool_use');
    
    if (!toolUse || !toolUse.id) {
      return this.createSingleMessageGroup(message);
    }
    
    // If there's already an active tool, mark it as interrupted
    let interruptedGroup: MessageGroup | null = null;
    if (this.currentActiveTool && !this.currentActiveTool.toolResult) {
      this.currentActiveTool.interrupted = true;
      
      // Create a group for the interrupted tool
      interruptedGroup = {
        type: 'single',
        messages: [this.currentActiveTool.toolUse],
        startTime: this.currentActiveTool.startTime,
        endTime: message.timestamp
      };
      
      // Mark as processed and remove from pending
      this.currentActiveTool.toolUse.processed = true;
      this.pendingToolUses.delete(this.currentActiveTool.toolId);
    }
    
    // Create a new tool pair for the current tool
    const toolPair: ToolPair = {
      toolUse: message,
      startTime: message.timestamp,
      toolId: toolUse.id,
      toolName: toolUse.name
    };
    
    // Set as the new active tool
    this.currentActiveTool = toolPair;
    this.pendingToolUses.set(toolUse.id, toolPair);
    
    // Return the interrupted group if any - this will be processed in the main queue loop
    // instead of triggering immediate recursive processing
    return interruptedGroup;
  }
  
  /**
   * Handle tool_result messages
   */
  private handleToolResultMessage(message: QueuedMessage): MessageGroup | null {
    const logEntry = message.logEntry as any;
    const content = logEntry.message?.content || [];
    const toolResult = content.find((c: any) => c.type === 'tool_result');
    
    if (!toolResult || !toolResult.tool_use_id) {
      return this.createSingleMessageGroup(message);
    }
    
    // Find matching tool_use
    const toolPair = this.pendingToolUses.get(toolResult.tool_use_id);
    if (!toolPair) {
      return this.createSingleMessageGroup(message);
    }
    
    // Complete the tool pair
    toolPair.toolResult = message;
    this.pendingToolUses.delete(toolResult.tool_use_id);
    
    // Clear active tool if this was the active one
    if (this.currentActiveTool && this.currentActiveTool.toolId === toolResult.tool_use_id) {
      this.currentActiveTool = null;
    }
    
    // Create a tool pair group
    return {
      type: 'tool_pair',
      messages: [toolPair.toolUse, message],
      toolPair,
      startTime: toolPair.startTime,
      endTime: message.timestamp
    };
  }
  
  /**
   * Create a single message group
   */
  private createSingleMessageGroup(message: QueuedMessage): MessageGroup {
    return {
      type: 'single',
      messages: [message],
      startTime: message.timestamp,
      endTime: message.timestamp
    };
  }
  
  /**
   * Check if message is a tool_use
   */
  private isToolUseMessage(logEntry: LogEntry): boolean {
    if (logEntry.type !== 'assistant') return false;
    const content = (logEntry as any).message?.content || [];
    return Array.isArray(content) && content.some((c: any) => c.type === 'tool_use');
  }
  
  /**
   * Check if message is a tool_result
   */
  private isToolResultMessage(logEntry: LogEntry): boolean {
    if (logEntry.type !== 'user') return false;
    const content = (logEntry as any).message?.content || [];
    return Array.isArray(content) && content.some((c: any) => c.type === 'tool_result');
  }
  
  /**
   * Clean up stale tool uses that haven't received results
   */
  private cleanupStaleToolUses(now: number): void {
    for (const [toolId, toolPair] of this.pendingToolUses.entries()) {
      if (now - toolPair.startTime > this.TOOL_TIMEOUT_MS) {
        // Create a group for the orphaned tool_use
        const group: MessageGroup = {
          type: 'single',
          messages: [toolPair.toolUse],
          startTime: toolPair.startTime,
          endTime: toolPair.startTime
        };
        
        this.onProcessMessages([group]);
        toolPair.toolUse.processed = true;
        this.pendingToolUses.delete(toolId);
      }
    }
  }
  
  /**
   * Generate a unique ID for messages
   */
  private generateId(): string {
    return `msg_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
  }
  
  /**
   * Get queue status for debugging
   */
  getStatus(): { queueSize: number; pendingTools: number } {
    return {
      queueSize: this.queue.length,
      pendingTools: this.pendingToolUses.size
    };
  }
}