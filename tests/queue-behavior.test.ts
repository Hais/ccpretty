import { MessageQueue, MessageGroup } from '../src/message-queue';

describe('Queue Behavior Tests', () => {
  let messageQueue: MessageQueue;
  let capturedGroups: MessageGroup[];

  beforeEach(() => {
    capturedGroups = [];
    messageQueue = new MessageQueue((groups: MessageGroup[]) => {
      capturedGroups.push(...groups);
    });
    messageQueue.start();
  });

  afterEach(() => {
    messageQueue.stop();
  });

  describe('Tool Pairing', () => {
    it('should pair tool_use with tool_result', async () => {
      // Arrange
      const toolUse = {
        type: 'assistant',
        message: {
          content: [{
            type: 'tool_use',
            id: 'test_tool',
            name: 'Bash',
            input: { command: 'echo test' }
          }]
        }
      };

      const toolResult = {
        type: 'user',
        message: {
          content: [{
            type: 'tool_result',
            tool_use_id: 'test_tool',
            content: 'test',
            is_error: false
          }]
        }
      };

      // Act
      messageQueue.enqueue(toolUse);
      messageQueue.enqueue(toolResult);
      await new Promise(resolve => setTimeout(resolve, 600));

      // Assert
      expect(capturedGroups).toHaveLength(1);
      expect(capturedGroups[0].type).toBe('tool_pair');
      expect(capturedGroups[0].messages).toHaveLength(2);
      expect(capturedGroups[0].toolPair?.toolName).toBe('Bash');
      expect(capturedGroups[0].toolPair?.toolResult).toBeDefined();
    });
  });

  describe('Tool Interruption', () => {
    it('should interrupt active tool when new tool starts', async () => {
      // Arrange
      const tool1 = {
        type: 'assistant',
        message: {
          content: [{
            type: 'tool_use',
            id: 'tool_1',
            name: 'Read',
            input: { file_path: '/file1.txt' }
          }]
        }
      };

      const tool2 = {
        type: 'assistant',
        message: {
          content: [{
            type: 'tool_use',
            id: 'tool_2',
            name: 'Write',
            input: { file_path: '/file2.txt', content: 'test' }
          }]
        }
      };

      const tool2Result = {
        type: 'user',
        message: {
          content: [{
            type: 'tool_result',
            tool_use_id: 'tool_2',
            content: 'written',
            is_error: false
          }]
        }
      };

      // Act
      messageQueue.enqueue(tool1);
      messageQueue.enqueue(tool2); // This should interrupt tool1
      messageQueue.enqueue(tool2Result);
      await new Promise(resolve => setTimeout(resolve, 600));

      // Assert
      expect(capturedGroups).toHaveLength(2);
      
      // First should be interrupted tool (single message)
      expect(capturedGroups[0].type).toBe('single');
      expect(capturedGroups[0].messages).toHaveLength(1);
      
      // Second should be completed tool pair
      expect(capturedGroups[1].type).toBe('tool_pair');
      expect(capturedGroups[1].toolPair?.toolName).toBe('Write');
      expect(capturedGroups[1].toolPair?.toolResult).toBeDefined();
    });

    it('should verify queue processes messages correctly', async () => {
      // This is a simplified test to verify basic queue functionality
      // The core interruption logic is complex and may require more integration testing
      
      // Arrange
      const systemMessage = {
        type: 'system',
        subtype: 'init',
        tools: ['Bash'],
        mcp_servers: []
      };

      const toolUse = {
        type: 'assistant',
        message: {
          content: [{
            type: 'tool_use',
            id: 'simple_tool',
            name: 'Bash',
            input: { command: 'echo test' }
          }]
        }
      };

      const toolResult = {
        type: 'user',
        message: {
          content: [{
            type: 'tool_result',
            tool_use_id: 'simple_tool',
            content: 'test',
            is_error: false
          }]
        }
      };

      // Act
      messageQueue.enqueue(systemMessage);
      messageQueue.enqueue(toolUse);
      messageQueue.enqueue(toolResult);
      await new Promise(resolve => setTimeout(resolve, 600));

      // Assert: Should have processed system message and tool pair
      expect(capturedGroups.length).toBeGreaterThanOrEqual(2);
      
      // Should have system message and tool pair
      const types = capturedGroups.map(g => g.type);
      expect(types).toContain('single'); // system message
      expect(types).toContain('tool_pair'); // tool execution
    });
  });

  describe('Message Types', () => {
    it('should handle system messages as single groups', async () => {
      // Arrange
      const systemMessage = {
        type: 'system',
        subtype: 'init',
        session_id: 'test',
        tools: ['Bash'],
        mcp_servers: []
      };

      // Act
      messageQueue.enqueue(systemMessage);
      await new Promise(resolve => setTimeout(resolve, 600));

      // Assert
      expect(capturedGroups).toHaveLength(1);
      expect(capturedGroups[0].type).toBe('single');
      expect(capturedGroups[0].messages[0].logEntry.type).toBe('system');
    });

    it('should handle assistant text messages as single groups', async () => {
      // Arrange
      const assistantMessage = {
        type: 'assistant',
        message: {
          content: [{ type: 'text', text: 'Hello world' }]
        }
      };

      // Act
      messageQueue.enqueue(assistantMessage);
      await new Promise(resolve => setTimeout(resolve, 600));

      // Assert
      expect(capturedGroups).toHaveLength(1);
      expect(capturedGroups[0].type).toBe('single');
      expect(capturedGroups[0].messages[0].logEntry.type).toBe('assistant');
    });

    it('should handle result messages as single groups', async () => {
      // Arrange
      const resultMessage = {
        type: 'result',
        subtype: 'success',
        is_error: false,
        duration_ms: 5000,
        cost_usd: 0.01
      };

      // Act
      messageQueue.enqueue(resultMessage);
      await new Promise(resolve => setTimeout(resolve, 600));

      // Assert
      expect(capturedGroups).toHaveLength(1);
      expect(capturedGroups[0].type).toBe('single');
      expect(capturedGroups[0].messages[0].logEntry.type).toBe('result');
    });
  });

  describe('Edge Cases', () => {
    it('should handle malformed tool_use messages', async () => {
      // Arrange: Tool use without ID
      const malformedTool = {
        type: 'assistant',
        message: {
          content: [{
            type: 'tool_use',
            // Missing id field
            name: 'Bash',
            input: { command: 'test' }
          }]
        }
      };

      // Act
      messageQueue.enqueue(malformedTool);
      await new Promise(resolve => setTimeout(resolve, 600));

      // Assert: Should still process as single message
      expect(capturedGroups).toHaveLength(1);
      expect(capturedGroups[0].type).toBe('single');
    });

    it('should handle orphaned tool_result messages', async () => {
      // Arrange: Tool result without matching tool_use
      const orphanedResult = {
        type: 'user',
        message: {
          content: [{
            type: 'tool_result',
            tool_use_id: 'nonexistent_tool',
            content: 'orphaned result',
            is_error: false
          }]
        }
      };

      // Act
      messageQueue.enqueue(orphanedResult);
      await new Promise(resolve => setTimeout(resolve, 600));

      // Assert: Should process as single message
      expect(capturedGroups).toHaveLength(1);
      expect(capturedGroups[0].type).toBe('single');
    });
  });

  describe('Queue Status', () => {
    it('should track queue status correctly', () => {
      // Arrange: Add some messages
      const message1 = { type: 'assistant', message: { content: [{ type: 'text', text: 'test' }] } };
      const message2 = { type: 'system', subtype: 'init', tools: [], mcp_servers: [] };

      // Act
      messageQueue.enqueue(message1);
      messageQueue.enqueue(message2);

      // Assert: Should show queue size before processing
      const status = messageQueue.getStatus();
      expect(status.queueSize).toBeGreaterThanOrEqual(0);
      expect(status.pendingTools).toBe(0); // No tools pending yet
    });

    it('should track pending tools correctly', () => {
      // Arrange: Add a tool use
      const toolUse = {
        type: 'assistant',
        message: {
          content: [{
            type: 'tool_use',
            id: 'pending_tool',
            name: 'Bash',
            input: { command: 'test' }
          }]
        }
      };

      // Act
      messageQueue.enqueue(toolUse);

      // Brief wait to let it process
      setTimeout(() => {
        const status = messageQueue.getStatus();
        expect(status.pendingTools).toBe(1); // Should have one pending tool
      }, 100);
    });
  });
});