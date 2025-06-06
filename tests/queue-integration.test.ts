// Mock the formatters module since it imports ESM modules
jest.mock('../src/formatters', () => ({
  formatAssistantResponse: jest.fn(() => 'Mocked assistant response'),
  formatUserResponse: jest.fn(() => 'Mocked user response'),
  formatSystemResponse: jest.fn(() => 'Mocked system response'),
  formatResultResponse: jest.fn(() => 'Mocked result response'),
  trimFilePath: jest.fn((path: string) => path),
}));

import { MessageQueue, MessageGroup } from '../src/message-queue';
import { MessageReducer, ReducedMessage } from '../src/message-reducer';

describe('Queue Integration Tests', () => {
  let messageQueue: MessageQueue;
  let messageReducer: MessageReducer;
  let processedGroups: MessageGroup[];

  beforeEach(() => {
    processedGroups = [];
    messageReducer = new MessageReducer();
    messageQueue = new MessageQueue((groups: MessageGroup[]) => {
      processedGroups.push(...groups);
    });
    messageQueue.start(); // Start the queue processing
  });

  afterEach(() => {
    messageQueue.stop();
  });

  describe('Simple Tool Execution', () => {
    it('should pair tool_use with tool_result into single message', async () => {
      // Arrange: Tool use followed by tool result
      const toolUseEvent = {
        type: 'assistant',
        message: {
          id: 'msg_1',
          content: [{
            type: 'tool_use',
            id: 'tool_123',
            name: 'Bash',
            input: {
              command: 'ls -la',
              description: 'List files'
            }
          }],
          stop_reason: 'tool_use'
        },
        session_id: 'test'
      };

      const toolResultEvent = {
        type: 'user',
        message: {
          role: 'user',
          content: [{
            type: 'tool_result',
            tool_use_id: 'tool_123',
            content: 'file1.txt\nfile2.txt',
            is_error: false
          }]
        },
        session_id: 'test'
      };

      // Act: Process events
      messageQueue.enqueue(toolUseEvent);
      messageQueue.enqueue(toolResultEvent);
      
      // Wait for processing
      await new Promise(resolve => setTimeout(resolve, 600));

      // Assert: Should have one tool_pair group
      expect(processedGroups).toHaveLength(1);
      expect(processedGroups[0].type).toBe('tool_pair');
      expect(processedGroups[0].messages).toHaveLength(2);
      expect(processedGroups[0].toolPair?.toolName).toBe('Bash');
      expect(processedGroups[0].toolPair?.toolResult).toBeDefined();

      // Reduce and check output
      const reduced = messageReducer.reduceGroups(processedGroups);
      expect(reduced).toHaveLength(1);
      expect(reduced[0].metadata.type).toBe('tool_complete');
      expect(reduced[0].metadata.toolName).toBe('Bash');
      expect(reduced[0].metadata.toolStatus).toBe('completed');
    });

    it('should handle tool errors correctly', async () => {
      // Arrange: Tool use followed by error result
      const toolUseEvent = {
        type: 'assistant',
        message: {
          id: 'msg_2',
          content: [{
            type: 'tool_use',
            id: 'tool_456',
            name: 'Bash',
            input: {
              command: 'invalidcommand',
              description: 'This will fail'
            }
          }],
          stop_reason: 'tool_use'
        },
        session_id: 'test'
      };

      const toolErrorEvent = {
        type: 'user',
        message: {
          role: 'user',
          content: [{
            type: 'tool_result',
            tool_use_id: 'tool_456',
            content: 'Command not found: invalidcommand',
            is_error: true
          }]
        },
        session_id: 'test'
      };

      // Act
      messageQueue.enqueue(toolUseEvent);
      messageQueue.enqueue(toolErrorEvent);
      await new Promise(resolve => setTimeout(resolve, 600));

      // Assert
      expect(processedGroups).toHaveLength(1);
      expect(processedGroups[0].type).toBe('tool_pair');

      const reduced = messageReducer.reduceGroups(processedGroups);
      expect(reduced).toHaveLength(1);
      expect(reduced[0].metadata.type).toBe('tool_failed');
      expect(reduced[0].metadata.toolName).toBe('Bash');
      expect(reduced[0].metadata.toolStatus).toBe('failed');
    });
  });

  describe('Tool Interruption Scenarios', () => {
    it('should handle tool interruption correctly', async () => {
      // Arrange: First tool starts, second tool interrupts, second tool completes
      const firstToolEvent = {
        type: 'assistant',
        message: {
          id: 'msg_3',
          type: 'message',
          role: 'assistant',
          model: 'claude-3-sonnet',
          content: [{
            type: 'tool_use',
            id: 'tool_first',
            name: 'Read',
            input: {
              file_path: '/path/to/file.txt'
            }
          }],
          stop_reason: 'tool_use',
          stop_sequence: null,
          usage: { input_tokens: 100, output_tokens: 20 },
          ttftMs: 500
        },
        session_id: 'test'
      };

      const secondToolEvent = {
        type: 'assistant',
        message: {
          id: 'msg_4',
          type: 'message',
          role: 'assistant',
          model: 'claude-3-sonnet',
          content: [{
            type: 'tool_use',
            id: 'tool_second',
            name: 'Bash',
            input: {
              command: 'pwd',
              description: 'Get current directory'
            }
          }],
          stop_reason: 'tool_use',
          stop_sequence: null,
          usage: { input_tokens: 100, output_tokens: 20 },
          ttftMs: 500
        },
        session_id: 'test'
      };

      const secondToolResult = {
        type: 'user',
        message: {
          role: 'user',
          content: [{
            type: 'tool_result',
            tool_use_id: 'tool_second',
            content: '/current/directory',
            is_error: false
          }]
        },
        session_id: 'test'
      };

      // Act
      messageQueue.enqueue(firstToolEvent);
      messageQueue.enqueue(secondToolEvent); // This should interrupt the first
      messageQueue.enqueue(secondToolResult);
      await new Promise(resolve => setTimeout(resolve, 600));

      // Assert: Should have two groups - interrupted tool and completed tool
      expect(processedGroups).toHaveLength(2);
      
      // First group should be the interrupted tool
      expect(processedGroups[0].type).toBe('single');
      expect(processedGroups[0].messages).toHaveLength(1);
      
      // Second group should be the completed tool pair
      expect(processedGroups[1].type).toBe('tool_pair');
      expect(processedGroups[1].toolPair?.toolName).toBe('Bash');

      const reduced = messageReducer.reduceGroups(processedGroups);
      expect(reduced).toHaveLength(2);
      
      // First reduced message should be interrupted
      expect(reduced[0].metadata.type).toBe('tool_interrupted');
      expect(reduced[0].metadata.toolName).toBe('Read');
      expect(reduced[0].metadata.toolStatus).toBe('interrupted');
      
      // Second reduced message should be completed
      expect(reduced[1].metadata.type).toBe('tool_complete');
      expect(reduced[1].metadata.toolName).toBe('Bash');
      expect(reduced[1].metadata.toolStatus).toBe('completed');
    });

    it('should handle multiple interruptions', async () => {
      // Arrange: Three tools, each interrupting the previous
      const tools = [
        {
          id: 'tool_a',
          name: 'Read',
          input: { file_path: '/file1.txt' }
        },
        {
          id: 'tool_b', 
          name: 'Write',
          input: { file_path: '/file2.txt', content: 'test' }
        },
        {
          id: 'tool_c',
          name: 'Bash',
          input: { command: 'echo hello' }
        }
      ];

      const events = tools.map((tool, index) => ({
        type: 'assistant',
        message: {
          id: `msg_${index + 5}`,
          content: [{
            type: 'tool_use',
            id: tool.id,
            name: tool.name,
            input: tool.input
          }],
          stop_reason: 'tool_use'
        },
        session_id: 'test'
      }));

      // Final result for the last tool
      const finalResult = {
        type: 'user',
        message: {
          role: 'user',
          content: [{
            type: 'tool_result',
            tool_use_id: 'tool_c',
            content: 'hello',
            is_error: false
          }]
        },
        session_id: 'test'
      };

      // Act
      events.forEach(event => messageQueue.enqueue(event));
      messageQueue.enqueue(finalResult);
      await new Promise(resolve => setTimeout(resolve, 600));

      // Assert: Should have 3 groups - 2 interrupted + 1 completed
      expect(processedGroups).toHaveLength(3);
      
      // First two should be interruptions
      expect(processedGroups[0].type).toBe('single');
      expect(processedGroups[1].type).toBe('single');
      
      // Last should be completed tool pair
      expect(processedGroups[2].type).toBe('tool_pair');

      const reduced = messageReducer.reduceGroups(processedGroups);
      expect(reduced).toHaveLength(3);
      
      // Check interruption messages
      expect(reduced[0].metadata.type).toBe('tool_interrupted');
      expect(reduced[0].metadata.toolName).toBe('Read');
      
      expect(reduced[1].metadata.type).toBe('tool_interrupted');
      expect(reduced[1].metadata.toolName).toBe('Write');
      
      expect(reduced[2].metadata.type).toBe('tool_complete');
      expect(reduced[2].metadata.toolName).toBe('Bash');
    });
  });

  describe('Message Deduplication', () => {
    it('should deduplicate identical assistant messages', () => {
      // Arrange: Two identical assistant messages
      const message1 = {
        type: 'assistant',
        message: {
          id: 'msg_8',
          content: [{
            type: 'text',
            text: 'Hello, how can I help you?'
          }],
          stop_reason: 'end_turn'
        },
        session_id: 'test'
      };

      const message2 = { ...message1 }; // Exact duplicate

      // Act
      messageQueue.enqueue(message1);
      messageQueue.enqueue(message2);

      // Process immediately since these aren't tools
      const group1 = { type: 'single' as const, messages: [{ 
        id: '1', timestamp: Date.now(), logEntry: message1, processed: false 
      }], startTime: Date.now(), endTime: Date.now() };
      
      const group2 = { type: 'single' as const, messages: [{ 
        id: '2', timestamp: Date.now(), logEntry: message2, processed: false 
      }], startTime: Date.now(), endTime: Date.now() };

      // Assert: MessageReducer should deduplicate
      const reduced1 = messageReducer.reduceGroups([group1]);
      const reduced2 = messageReducer.reduceGroups([group2]);
      
      expect(reduced1).toHaveLength(1);
      expect(reduced2).toHaveLength(0); // Deduplicated
    });

    it('should not deduplicate different messages', () => {
      // Arrange: Two different assistant messages
      const message1 = {
        type: 'assistant',
        message: {
          id: 'msg_10',
          content: [{
            type: 'text',
            text: 'First message'
          }],
          stop_reason: 'end_turn'
        },
        session_id: 'test'
      };

      const message2 = {
        type: 'assistant',
        message: {
          id: 'msg_11',
          content: [{
            type: 'text',
            text: 'Second message'
          }],
          stop_reason: 'end_turn'
        },
        session_id: 'test'
      };

      // Act & Assert
      const group1 = { type: 'single' as const, messages: [{ 
        id: '1', timestamp: Date.now(), logEntry: message1, processed: false 
      }], startTime: Date.now(), endTime: Date.now() };
      
      const group2 = { type: 'single' as const, messages: [{ 
        id: '2', timestamp: Date.now(), logEntry: message2, processed: false 
      }], startTime: Date.now(), endTime: Date.now() };

      const reduced1 = messageReducer.reduceGroups([group1]);
      const reduced2 = messageReducer.reduceGroups([group2]);
      
      expect(reduced1).toHaveLength(1);
      expect(reduced2).toHaveLength(1); // Not deduplicated
    });
  });

  describe('Complex Workflow Scenarios', () => {
    it('should handle mixed message types correctly', async () => {
      // Arrange: System init, assistant text, tool use, tool result, final result
      const events = [
        {
          type: 'system',
          subtype: 'init',
          session_id: 'test_session',
          tools: ['Bash', 'Read'],
          mcp_servers: []
        },
        {
          type: 'assistant',
          message: {
            id: 'msg_12',
            content: [{
              type: 'text',
              text: 'I will help you with that task.'
            }],
            stop_reason: 'end_turn'
          },
          session_id: 'test_session'
        },
        {
          type: 'assistant',
          message: {
            id: 'msg_13',
            content: [{
              type: 'tool_use',
              id: 'tool_final',
              name: 'Bash',
              input: {
                command: 'echo "task complete"',
                description: 'Complete the task'
              }
            }],
            stop_reason: 'tool_use'
          },
          session_id: 'test_session'
        },
        {
          type: 'user',
          message: {
            role: 'user',
            content: [{
              type: 'tool_result',
              tool_use_id: 'tool_final',
              content: 'task complete',
              is_error: false
            }]
          },
          session_id: 'test_session'
        },
        {
          type: 'result',
          subtype: 'success',
          is_error: false,
          duration_ms: 5000,
          cost_usd: 0.0124
        }
      ];

      // Act
      events.forEach(event => messageQueue.enqueue(event));
      await new Promise(resolve => setTimeout(resolve, 600));

      // Assert: Should have multiple groups for different message types
      expect(processedGroups.length).toBeGreaterThanOrEqual(3);
      
      // Should have system message, assistant message, tool pair, and result
      const types = processedGroups.map(g => g.type);
      expect(types).toContain('single'); // System and assistant messages
      expect(types).toContain('tool_pair'); // Tool execution

      const reduced = messageReducer.reduceGroups(processedGroups);
      expect(reduced.length).toBeGreaterThanOrEqual(3);
      
      // Find the tool completion in reduced messages
      const toolMessage = reduced.find(r => r.metadata.type === 'tool_complete');
      expect(toolMessage).toBeDefined();
      expect(toolMessage?.metadata.toolName).toBe('Bash');
      expect(toolMessage?.metadata.toolStatus).toBe('completed');
    });

    it('should handle rapid fire tool calls', async () => {
      // Arrange: Multiple quick tool calls that interrupt each other
      const rapidTools = Array.from({ length: 5 }, (_, i) => ({
        type: 'assistant',
        message: {
          id: `rapid_${i}`,
          content: [{
            type: 'tool_use',
            id: `rapid_tool_${i}`,
            name: 'Bash',
            input: {
              command: `echo "step ${i}"`,
              description: `Step ${i}`
            }
          }],
          stop_reason: 'tool_use'
        },
        session_id: 'rapid_test'
      }));

      // Only the last tool gets a result
      const lastResult = {
        type: 'user',
        message: {
          role: 'user',
          content: [{
            type: 'tool_result',
            tool_use_id: 'rapid_tool_4',
            content: 'step 4',
            is_error: false
          }]
        },
        session_id: 'rapid_test'
      };

      // Act
      rapidTools.forEach(tool => messageQueue.enqueue(tool));
      messageQueue.enqueue(lastResult);
      await new Promise(resolve => setTimeout(resolve, 600));

      // Assert: Should have 5 groups - 4 interrupted + 1 completed
      expect(processedGroups).toHaveLength(5);
      
      // First 4 should be interruptions
      for (let i = 0; i < 4; i++) {
        expect(processedGroups[i].type).toBe('single');
      }
      
      // Last should be completed
      expect(processedGroups[4].type).toBe('tool_pair');

      const reduced = messageReducer.reduceGroups(processedGroups);
      expect(reduced).toHaveLength(5);
      
      // First 4 should be interrupted
      for (let i = 0; i < 4; i++) {
        expect(reduced[i].metadata.type).toBe('tool_interrupted');
        expect(reduced[i].metadata.toolStatus).toBe('interrupted');
      }
      
      // Last should be completed
      expect(reduced[4].metadata.type).toBe('tool_complete');
      expect(reduced[4].metadata.toolStatus).toBe('completed');
    });
  });

  describe('Edge Cases', () => {
    it('should handle orphaned tool_use (no result)', async () => {
      // Arrange: Tool use without result
      const orphanedTool = {
        type: 'assistant',
        message: {
          id: 'orphan_msg',
          content: [{
            type: 'tool_use',
            id: 'orphan_tool',
            name: 'Read',
            input: {
              file_path: '/nonexistent.txt'
            }
          }],
          stop_reason: 'tool_use'
        },
        session_id: 'orphan_test'
      };

      // Act
      messageQueue.enqueue(orphanedTool);
      
      // Wait longer than timeout (we'll use a shorter timeout for testing)
      await new Promise(resolve => setTimeout(resolve, 1100));

      // Assert: Should timeout and create single message
      expect(processedGroups).toHaveLength(1);
      expect(processedGroups[0].type).toBe('single');

      const reduced = messageReducer.reduceGroups(processedGroups);
      expect(reduced).toHaveLength(1);
      // Should be formatted as single message since it never completed
      expect(reduced[0].metadata.type).toBe('single');
    });

    it('should handle malformed tool messages', async () => {
      // Arrange: Tool use without proper ID
      const malformedTool = {
        type: 'assistant',
        message: {
          id: 'malformed_msg',
          content: [{
            type: 'tool_use',
            // Missing id
            name: 'Bash',
            input: {
              command: 'echo test'
            }
          }],
          stop_reason: 'tool_use'
        },
        session_id: 'malformed_test'
      };

      // Act
      messageQueue.enqueue(malformedTool);
      await new Promise(resolve => setTimeout(resolve, 600));

      // Assert: Should process as single message
      expect(processedGroups).toHaveLength(1);
      expect(processedGroups[0].type).toBe('single');

      const reduced = messageReducer.reduceGroups(processedGroups);
      expect(reduced).toHaveLength(1);
      // Should use standard formatting since tool processing failed
      expect(reduced[0].metadata.type).toBe('single');
    });
  });
});