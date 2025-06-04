// Mock the formatters module since it imports ESM modules
jest.mock('../src/formatters', () => ({
  formatAssistantResponse: jest.fn(() => 'Mocked assistant response'),
  formatUserResponse: jest.fn(() => 'Mocked user response'),
  formatSystemResponse: jest.fn(() => 'Mocked system response'),
  formatResultResponse: jest.fn(() => 'Mocked result response'),
  trimFilePath: jest.fn((path: string) => path),
}));

import { MessageReducer, ProcessedMessage } from '../src/message-reducer';
import { MessageGroup, ToolPair, QueuedMessage } from '../src/message-queue';

describe('MessageReducer State Transformation Tests', () => {
  let reducer: MessageReducer;

  beforeEach(() => {
    reducer = new MessageReducer();
  });

  describe('Tool Pair Reduction', () => {
    it('should transform successful tool execution into completion message', () => {
      // Arrange: Tool pair with successful result
      const toolUse: QueuedMessage = {
        id: 'msg1',
        timestamp: 1000,
        processed: false,
        logEntry: {
          type: 'assistant',
          message: {
            content: [{
              type: 'tool_use',
              id: 'tool_123',
              name: 'Bash',
              input: {
                command: 'ls -la',
                description: 'List directory contents'
              }
            }]
          }
        }
      };

      const toolResult: QueuedMessage = {
        id: 'msg2',
        timestamp: 1500,
        processed: false,
        logEntry: {
          type: 'user',
          message: {
            content: [{
              type: 'tool_result',
              tool_use_id: 'tool_123',
              content: 'file1.txt\nfile2.txt\nfile3.txt',
              is_error: false
            }]
          }
        }
      };

      const toolPair: ToolPair = {
        toolUse,
        toolResult,
        startTime: 1000,
        toolId: 'tool_123',
        toolName: 'Bash'
      };

      const group: MessageGroup = {
        type: 'tool_pair',
        messages: [toolUse, toolResult],
        toolPair,
        startTime: 1000,
        endTime: 1500
      };

      // Act
      const result = reducer.reduceGroups([group]);

      // Assert
      expect(result).toHaveLength(1);
      const processed = result[0];
      
      expect(processed.type).toBe('tool_complete');
      expect(processed.originalCount).toBe(2);
      expect(processed.duration).toBe(500);
      expect(processed.content).toContain('✅ Tool: Bash - COMPLETED (0.50s)');
      expect(processed.content).toContain('🔧 Command: ls -la');
      expect(processed.content).toContain('📝 Description: List directory contents');
      expect(processed.content).toContain('📄 Result: file1.txt');
    });

    it('should transform failed tool execution into failure message', () => {
      // Arrange: Tool pair with error result
      const toolUse: QueuedMessage = {
        id: 'msg3',
        timestamp: 2000,
        processed: false,
        logEntry: {
          type: 'assistant',
          message: {
            content: [{
              type: 'tool_use',
              id: 'tool_456',
              name: 'Read',
              input: {
                file_path: '/nonexistent/file.txt'
              }
            }]
          }
        }
      };

      const toolError: QueuedMessage = {
        id: 'msg4',
        timestamp: 2200,
        processed: false,
        logEntry: {
          type: 'user',
          message: {
            content: [{
              type: 'tool_result',
              tool_use_id: 'tool_456',
              content: 'File not found: /nonexistent/file.txt',
              is_error: true
            }]
          }
        }
      };

      const toolPair: ToolPair = {
        toolUse,
        toolResult: toolError,
        startTime: 2000,
        toolId: 'tool_456',
        toolName: 'Read'
      };

      const group: MessageGroup = {
        type: 'tool_pair',
        messages: [toolUse, toolError],
        toolPair,
        startTime: 2000,
        endTime: 2200
      };

      // Act
      const result = reducer.reduceGroups([group]);

      // Assert
      expect(result).toHaveLength(1);
      const processed = result[0];
      
      expect(processed.type).toBe('tool_failed');
      expect(processed.duration).toBe(200);
      expect(processed.content).toContain('❌ Tool: Read - FAILED (0.20s)');
      expect(processed.content).toContain('📁 File: /nonexistent/file.txt');
      expect(processed.content).toContain('🚨 Error: File not found');
    });

    it('should handle long tool results with truncation', () => {
      // Arrange: Tool with very long result
      const longResult = 'A'.repeat(500) + 'B'.repeat(500);
      
      const toolUse: QueuedMessage = {
        id: 'msg5',
        timestamp: 3000,
        processed: false,
        logEntry: {
          type: 'assistant',
          message: {
            content: [{
              type: 'tool_use',
              id: 'tool_789',
              name: 'Bash',
              input: { command: 'cat large_file.txt' }
            }]
          }
        }
      };

      const toolResult: QueuedMessage = {
        id: 'msg6',
        timestamp: 3300,
        processed: false,
        logEntry: {
          type: 'user',
          message: {
            content: [{
              type: 'tool_result',
              tool_use_id: 'tool_789',
              content: longResult,
              is_error: false
            }]
          }
        }
      };

      const group: MessageGroup = {
        type: 'tool_pair',
        messages: [toolUse, toolResult],
        toolPair: {
          toolUse,
          toolResult,
          startTime: 3000,
          toolId: 'tool_789',
          toolName: 'Bash'
        },
        startTime: 3000,
        endTime: 3300
      };

      // Act
      const result = reducer.reduceGroups([group]);

      // Assert
      expect(result).toHaveLength(1);
      const processed = result[0];
      
      expect(processed.content).toContain('📄 Result:');
      // Should be truncated to 200 chars with ...
      const resultMatch = processed.content.match(/📄 Result: (.+)/);
      expect(resultMatch).toBeTruthy();
      expect(resultMatch![1]).toHaveLength(200); // 197 chars + "..."
      expect(resultMatch![1].endsWith('...')).toBe(true);
    });
  });

  describe('Interrupted Tool Reduction', () => {
    it('should transform interrupted tool into warning message', () => {
      // Arrange: Single tool use message (interrupted)
      const interruptedTool: QueuedMessage = {
        id: 'msg7',
        timestamp: 4000,
        processed: false,
        logEntry: {
          type: 'assistant',
          message: {
            content: [{
              type: 'tool_use',
              id: 'tool_interrupted',
              name: 'Write',
              input: {
                file_path: '/tmp/test.txt',
                content: 'test content'
              }
            }]
          }
        }
      };

      const group: MessageGroup = {
        type: 'single',
        messages: [interruptedTool],
        startTime: 4000,
        endTime: 4000
      };

      // Act
      const result = reducer.reduceGroups([group]);

      // Assert
      expect(result).toHaveLength(1);
      const processed = result[0];
      
      expect(processed.type).toBe('tool_interrupted');
      expect(processed.originalCount).toBe(1);
      expect(processed.content).toContain('⚠️ Tool: Write - INTERRUPTED');
      expect(processed.content).toContain('📁 File: /tmp/test.txt');
      expect(processed.content).toContain('🚫 Tool execution was interrupted');
      expect(processed.content).toContain('interrupted'); // Box type
    });

    it('should handle interrupted tool with minimal parameters', () => {
      // Arrange: Tool with only command parameter
      const minimalTool: QueuedMessage = {
        id: 'msg8',
        timestamp: 5000,
        processed: false,
        logEntry: {
          type: 'assistant',
          message: {
            content: [{
              type: 'tool_use',
              id: 'tool_minimal',
              name: 'Bash',
              input: {
                command: 'pwd'
              }
            }]
          }
        }
      };

      const group: MessageGroup = {
        type: 'single',
        messages: [minimalTool],
        startTime: 5000,
        endTime: 5000
      };

      // Act
      const result = reducer.reduceGroups([group]);

      // Assert
      expect(result).toHaveLength(1);
      const processed = result[0];
      
      expect(processed.type).toBe('tool_interrupted');
      expect(processed.content).toContain('⚠️ Tool: Bash - INTERRUPTED');
      expect(processed.content).toContain('🔧 Command: pwd');
      expect(processed.content).not.toContain('📝 Description:'); // No description provided
    });
  });

  describe('Deduplication Behavior', () => {
    it('should deduplicate identical content', () => {
      // Arrange: Two groups with identical formatted output
      const message1: QueuedMessage = {
        id: 'msg9',
        timestamp: 6000,
        processed: false,
        logEntry: {
          type: 'assistant',
          message: {
            content: [{ type: 'text', text: 'Hello world' }]
          }
        }
      };

      const message2: QueuedMessage = {
        id: 'msg10',
        timestamp: 6100,
        processed: false,
        logEntry: {
          type: 'assistant',
          message: {
            content: [{ type: 'text', text: 'Hello world' }]
          }
        }
      };

      const group1: MessageGroup = {
        type: 'single',
        messages: [message1],
        startTime: 6000,
        endTime: 6000
      };

      const group2: MessageGroup = {
        type: 'single',
        messages: [message2],
        startTime: 6100,
        endTime: 6100
      };

      // Act
      const result1 = reducer.reduceGroups([group1]);
      const result2 = reducer.reduceGroups([group2]);

      // Assert
      expect(result1).toHaveLength(1);
      expect(result2).toHaveLength(0); // Deduplicated
    });

    it('should not deduplicate different content', () => {
      // Arrange: Two groups with different content
      const message1: QueuedMessage = {
        id: 'msg11',
        timestamp: 7000,
        processed: false,
        logEntry: {
          type: 'assistant',
          message: {
            content: [{ type: 'text', text: 'First message' }]
          }
        }
      };

      const message2: QueuedMessage = {
        id: 'msg12',
        timestamp: 7100,
        processed: false,
        logEntry: {
          type: 'assistant',
          message: {
            content: [{ type: 'text', text: 'Second message' }]
          }
        }
      };

      const group1: MessageGroup = {
        type: 'single',
        messages: [message1],
        startTime: 7000,
        endTime: 7000
      };

      const group2: MessageGroup = {
        type: 'single',
        messages: [message2],
        startTime: 7100,
        endTime: 7100
      };

      // Act
      const result1 = reducer.reduceGroups([group1]);
      const result2 = reducer.reduceGroups([group2]);

      // Assert
      expect(result1).toHaveLength(1);
      expect(result2).toHaveLength(1); // Not deduplicated
      expect(result1[0].content).not.toBe(result2[0].content);
    });

    it('should reset deduplication state on reset()', () => {
      // Arrange: Same message processed twice with reset in between
      const message: QueuedMessage = {
        id: 'msg13',
        timestamp: 8000,
        processed: false,
        logEntry: {
          type: 'assistant',
          message: {
            content: [{ type: 'text', text: 'Test message' }]
          }
        }
      };

      const group: MessageGroup = {
        type: 'single',
        messages: [message],
        startTime: 8000,
        endTime: 8000
      };

      // Act
      const result1 = reducer.reduceGroups([group]);
      reducer.reset(); // Reset deduplication state
      const result2 = reducer.reduceGroups([group]);

      // Assert
      expect(result1).toHaveLength(1);
      expect(result2).toHaveLength(1); // Not deduplicated after reset
    });
  });

  describe('Multiple Group Processing', () => {
    it('should process complex workflow sequence correctly', () => {
      // Arrange: System init + assistant text + tool pair + result
      const systemInit: QueuedMessage = {
        id: 'sys1',
        timestamp: 9000,
        processed: false,
        logEntry: {
          type: 'system',
          subtype: 'init',
          session_id: 'test',
          tools: ['Bash', 'Read'],
          mcp_servers: []
        }
      };

      const assistantText: QueuedMessage = {
        id: 'ast1',
        timestamp: 9100,
        processed: false,
        logEntry: {
          type: 'assistant',
          message: {
            content: [{ type: 'text', text: 'I will help you with this task.' }]
          }
        }
      };

      const toolUse: QueuedMessage = {
        id: 'tool1',
        timestamp: 9200,
        processed: false,
        logEntry: {
          type: 'assistant',
          message: {
            content: [{
              type: 'tool_use',
              id: 'final_tool',
              name: 'Bash',
              input: { command: 'echo "done"' }
            }]
          }
        }
      };

      const toolResult: QueuedMessage = {
        id: 'res1',
        timestamp: 9300,
        processed: false,
        logEntry: {
          type: 'user',
          message: {
            content: [{
              type: 'tool_result',
              tool_use_id: 'final_tool',
              content: 'done',
              is_error: false
            }]
          }
        }
      };

      const finalResult: QueuedMessage = {
        id: 'final1',
        timestamp: 9400,
        processed: false,
        logEntry: {
          type: 'result',
          subtype: 'success',
          is_error: false,
          duration_ms: 5000,
          cost_usd: 0.01
        }
      };

      const groups: MessageGroup[] = [
        {
          type: 'single',
          messages: [systemInit],
          startTime: 9000,
          endTime: 9000
        },
        {
          type: 'single',
          messages: [assistantText],
          startTime: 9100,
          endTime: 9100
        },
        {
          type: 'tool_pair',
          messages: [toolUse, toolResult],
          toolPair: {
            toolUse,
            toolResult,
            startTime: 9200,
            toolId: 'final_tool',
            toolName: 'Bash'
          },
          startTime: 9200,
          endTime: 9300
        },
        {
          type: 'single',
          messages: [finalResult],
          startTime: 9400,
          endTime: 9400
        }
      ];

      // Act
      const result = reducer.reduceGroups(groups);

      // Assert
      expect(result).toHaveLength(4);
      
      // System message
      expect(result[0].type).toBe('single');
      expect(result[0].content).toContain('🚀 Session Initialized');
      
      // Assistant text
      expect(result[1].type).toBe('single');
      expect(result[1].content).toContain('I will help you');
      
      // Tool completion
      expect(result[2].type).toBe('tool_complete');
      expect(result[2].content).toContain('✅ Tool: Bash - COMPLETED');
      expect(result[2].content).toContain('Result: done');
      
      // Final result
      expect(result[3].type).toBe('single');
      expect(result[3].content).toContain('✅ Task Completed');
    });
  });

  describe('Parameter Formatting', () => {
    it('should format all supported tool parameters', () => {
      // Arrange: Tool with all parameter types
      const toolUse: QueuedMessage = {
        id: 'full_params',
        timestamp: 10000,
        processed: false,
        logEntry: {
          type: 'assistant',
          message: {
            content: [{
              type: 'tool_use',
              id: 'param_tool',
              name: 'MultiTool',
              input: {
                command: 'complex_command',
                file_path: '/path/to/file.txt',
                pattern: '*.js',
                description: 'A complex operation',
                limit: 100,
                offset: 50
              }
            }]
          }
        }
      };

      const group: MessageGroup = {
        type: 'single',
        messages: [toolUse],
        startTime: 10000,
        endTime: 10000
      };

      // Act
      const result = reducer.reduceGroups([group]);

      // Assert
      expect(result).toHaveLength(1);
      const content = result[0].content;
      
      expect(content).toContain('🔧 Command: complex_command');
      expect(content).toContain('📁 File: /path/to/file.txt');
      expect(content).toContain('🔍 Pattern: *.js');
      expect(content).toContain('📝 Description: A complex operation');
      expect(content).toContain('📊 Limit: 100');
      expect(content).toContain('📍 Offset: 50');
    });
  });
});