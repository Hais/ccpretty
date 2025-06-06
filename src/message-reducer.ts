import { MessageGroup } from './message-queue';
import { 
  Message,
  isAssistantResponse, 
  isUserResponse, 
  isSystemResponse,
  AssistantResponse,
  UserResponse,
  SystemResponse
} from './models';

export interface ReducedMessage {
  message: Message;
  metadata: {
    type: 'single' | 'tool_complete' | 'tool_failed' | 'tool_interrupted';
    originalCount: number;
    duration?: number;
    toolName?: string;
    toolStatus?: 'completed' | 'failed' | 'interrupted';
    toolResult?: any;
  };
  // Compatibility properties for tests
  type?: string;
  content?: string;
}

export class MessageReducer {
  private lastMessageHash: string = '';
  
  /**
   * Reduce message groups into simplified messages with metadata
   */
  reduceGroups(groups: MessageGroup[]): ReducedMessage[] {
    const results: ReducedMessage[] = [];
    
    for (const group of groups) {
      const reduced = this.reduceGroup(group);
      if (reduced && this.shouldInclude(reduced)) {
        results.push(reduced);
      }
    }
    
    return results;
  }
  
  /**
   * Reduce a single message group
   */
  private reduceGroup(group: MessageGroup): ReducedMessage | null {
    switch (group.type) {
      case 'tool_pair':
        return this.reduceToolPair(group);
      case 'single':
        return this.reduceSingleMessage(group);
      case 'assistant_batch':
        return this.reduceAssistantBatch(group);
      default:
        return null;
    }
  }
  
  /**
   * Reduce a tool pair (tool_use + tool_result)
   */
  private reduceToolPair(group: MessageGroup): ReducedMessage {
    const { toolPair } = group;
    if (!toolPair || !toolPair.toolResult) {
      // Fallback to single message if no result
      return this.reduceSingleMessage(group);
    }
    
    const duration = group.endTime - group.startTime;
    const toolUseEntry = toolPair.toolUse.logEntry as any;
    const toolResultEntry = toolPair.toolResult.logEntry as any;
    
    // Extract tool information
    const toolUse = toolUseEntry.message.content.find((c: any) => c.type === 'tool_use');
    const toolResult = toolResultEntry.message.content.find((c: any) => c.type === 'tool_result');
    
    const isError = toolResult?.is_error || false;
    const status = isError ? 'failed' : 'completed';
    
    // Create a synthetic message that represents the tool execution
    const syntheticMessage: AssistantResponse = {
      type: 'assistant',
      message: {
        id: toolUseEntry.id || 'synthetic-' + Date.now(),
        type: 'message',
        role: 'assistant',
        model: toolUseEntry.model || 'unknown',
        content: [
          {
            type: 'tool_use',
            id: toolUse.id,
            name: toolPair.toolName,
            input: toolUse.input
          }
        ],
        stop_reason: 'tool_use',
        stop_sequence: null,
        usage: toolUseEntry.usage || { input_tokens: 0, output_tokens: 0 },
        ttftMs: 0
      },
      session_id: toolUseEntry.session_id || ''
    } as any;
    
    // Add toolResult as additional metadata
    (syntheticMessage as any).toolResult = toolResult;
    
    const reduced = {
      message: syntheticMessage,
      metadata: {
        type: (isError ? 'tool_failed' : 'tool_complete') as 'tool_failed' | 'tool_complete',
        originalCount: 2,
        duration,
        toolName: toolPair.toolName,
        toolStatus: status as 'completed' | 'failed',
        toolResult: toolResult?.content
      }
    };
    
    return this.addCompatibilityProperties(reduced);
  }
  
  /**
   * Reduce a single message
   */
  private reduceSingleMessage(group: MessageGroup): ReducedMessage {
    const message = group.messages[0];
    const logEntry = message.logEntry;
    
    // Check if this is an interrupted tool
    if (isAssistantResponse(logEntry)) {
      const assistantContent = (logEntry as any).message?.content || [];
      const toolUse = assistantContent.find((c: any) => c.type === 'tool_use');
      
      if (toolUse) {
        // This is an interrupted tool
        const reduced = {
          message: logEntry as Message,
          metadata: {
            type: 'tool_interrupted' as const,
            originalCount: 1,
            toolName: toolUse.name,
            toolStatus: 'interrupted' as const
          }
        };
        
        return this.addCompatibilityProperties(reduced);
      }
    }
    
    const reduced = {
      message: logEntry as Message,
      metadata: {
        type: 'single' as const,
        originalCount: 1
      }
    };
    
    return this.addCompatibilityProperties(reduced);
  }
  
  /**
   * Reduce a batch of assistant messages
   */
  private reduceAssistantBatch(group: MessageGroup): ReducedMessage {
    // For now, just process each message separately
    // Could be enhanced to combine multiple assistant messages
    return this.reduceSingleMessage(group);
  }
  
  /**
   * Add compatibility properties for backwards compatibility with tests
   */
  private addCompatibilityProperties(reduced: ReducedMessage): ReducedMessage {
    // Set type for compatibility
    reduced.type = reduced.metadata.type;
    
    // Generate content for compatibility
    if (reduced.metadata.type === 'tool_complete') {
      reduced.content = `✅ Tool: ${reduced.metadata.toolName} - COMPLETED`;
    } else if (reduced.metadata.type === 'tool_failed') {
      reduced.content = `❌ Tool: ${reduced.metadata.toolName} - FAILED`;
    } else if (reduced.metadata.type === 'tool_interrupted') {
      reduced.content = `⚠️ Tool: ${reduced.metadata.toolName} - INTERRUPTED`;
    } else {
      // For single messages, try to extract content from the message
      const message = reduced.message as any;
      if (message.message?.content) {
        const textContent = message.message.content.find((c: any) => c.type === 'text');
        if (textContent) {
          reduced.content = textContent.text;
        }
      }
    }
    
    return reduced;
  }
  
  /**
   * Generate a hash for deduplication
   */
  private generateHash(message: Message): string {
    // Simple hash based on message type and content
    return `${message.type}:${JSON.stringify(message)}`;
  }
  
  /**
   * Check if message should be included (deduplication)
   */
  private shouldInclude(reduced: ReducedMessage): boolean {
    const hash = this.generateHash(reduced.message);
    
    // Skip if identical to last message
    if (hash === this.lastMessageHash) {
      return false;
    }
    
    this.lastMessageHash = hash;
    return true;
  }
  
  /**
   * Reset deduplication state
   */
  reset(): void {
    this.lastMessageHash = '';
  }
}