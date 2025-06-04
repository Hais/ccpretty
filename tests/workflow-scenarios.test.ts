// Mock the formatters module since it imports ESM modules
jest.mock('../src/formatters', () => ({
  formatAssistantResponse: jest.fn(() => 'Mocked assistant response'),
  formatUserResponse: jest.fn(() => 'Mocked user response'),
  formatSystemResponse: jest.fn(() => 'Mocked system response'),
  formatResultResponse: jest.fn(() => 'Mocked result response'),
  trimFilePath: jest.fn((path: string) => path),
}));

import { MessageQueue, MessageGroup } from '../src/message-queue';
import { MessageReducer } from '../src/message-reducer';

describe('Workflow Scenario Tests', () => {
  let messageQueue: MessageQueue;
  let messageReducer: MessageReducer;
  let capturedGroups: MessageGroup[];

  beforeEach(() => {
    capturedGroups = [];
    messageReducer = new MessageReducer();
    messageQueue = new MessageQueue((groups: MessageGroup[]) => {
      capturedGroups.push(...groups);
    });
    messageQueue.start(); // Start the queue processing
  });

  afterEach(() => {
    messageQueue.stop();
  });

  /**
   * Scenario: Simple file reading task
   * Events: System init → Assistant text → Read tool → Tool result → Success result
   * Expected: 4 distinct messages with proper tool pairing
   */
  describe('Scenario: Simple File Reading', () => {
    it('should process file reading workflow correctly', async () => {
      // Arrange: File reading workflow events
      const events = [
        {
          type: 'system',
          subtype: 'init',
          session_id: 'file_read_session',
          tools: ['Read', 'Write'],
          mcp_servers: []
        },
        {
          type: 'assistant',
          message: {
            id: 'msg_1',
            content: [{ type: 'text', text: 'I\'ll read the file for you.' }],
            stop_reason: 'end_turn'
          },
          session_id: 'file_read_session'
        },
        {
          type: 'assistant',
          message: {
            id: 'msg_2',
            content: [{
              type: 'tool_use',
              id: 'read_123',
              name: 'Read',
              input: {
                file_path: '/Users/test/document.txt',
                limit: 50
              }
            }],
            stop_reason: 'tool_use'
          },
          session_id: 'file_read_session'
        },
        {
          type: 'user',
          message: {
            role: 'user',
            content: [{
              type: 'tool_result',
              tool_use_id: 'read_123',
              content: 'This is the content of the document.\nIt has multiple lines.\nAnd some important information.',
              is_error: false
            }]
          },
          session_id: 'file_read_session'
        },
        {
          type: 'result',
          subtype: 'success',
          is_error: false,
          duration_ms: 2500,
          duration_api_ms: 800,
          num_turns: 2,
          cost_usd: 0.0045
        }
      ];

      // Act
      events.forEach(event => messageQueue.enqueue(event));
      await new Promise(resolve => setTimeout(resolve, 600));

      // Assert
      expect(capturedGroups).toHaveLength(4);
      
      // Verify group types
      expect(capturedGroups[0].type).toBe('single'); // system init
      expect(capturedGroups[1].type).toBe('single'); // assistant text
      expect(capturedGroups[2].type).toBe('tool_pair'); // read operation
      expect(capturedGroups[3].type).toBe('single'); // result

      // Reduce and verify output
      const reduced = messageReducer.reduceGroups(capturedGroups);
      expect(reduced).toHaveLength(4);
      
      // System init
      expect(reduced[0].content).toContain('🚀 Session Initialized');
      expect(reduced[0].content).toContain('file_read_session');
      
      // Assistant message
      expect(reduced[1].content).toContain('I\'ll read the file for you');
      
      // Tool execution
      expect(reduced[2].type).toBe('tool_complete');
      expect(reduced[2].content).toContain('✅ Tool: Read - COMPLETED');
      expect(reduced[2].content).toContain('📁 File: /Users/test/document.txt');
      expect(reduced[2].content).toContain('📊 Limit: 50');
      expect(reduced[2].content).toContain('📄 Result: This is the content');
      
      // Final result
      expect(reduced[3].content).toContain('✅ Task Completed');
      expect(reduced[3].content).toContain('Duration: 2.50s');
      expect(reduced[3].content).toContain('Cost: $0.0045 USD');
    });
  });

  /**
   * Scenario: Tool interruption cascade
   * Events: Tool A starts → Tool B interrupts → Tool C interrupts → Tool C completes
   * Expected: 2 interrupted tools + 1 completed tool
   */
  describe('Scenario: Tool Interruption Cascade', () => {
    it('should handle cascading tool interruptions', async () => {
      // Arrange: Cascading interruption scenario
      const events = [
        // First tool starts
        {
          type: 'assistant',
          message: {
            id: 'cascade_1',
            content: [{
              type: 'tool_use',
              id: 'tool_a',
              name: 'Read',
              input: {
                file_path: '/large_file.txt',
                limit: 1000
              }
            }],
            stop_reason: 'tool_use'
          },
          session_id: 'cascade_test'
        },
        // Second tool interrupts first
        {
          type: 'assistant',
          message: {
            id: 'cascade_2',
            content: [{
              type: 'tool_use',
              id: 'tool_b',
              name: 'Write',
              input: {
                file_path: '/output.txt',
                content: 'some content'
              }
            }],
            stop_reason: 'tool_use'
          },
          session_id: 'cascade_test'
        },
        // Third tool interrupts second
        {
          type: 'assistant',
          message: {
            id: 'cascade_3',
            content: [{
              type: 'tool_use',
              id: 'tool_c',
              name: 'Bash',
              input: {
                command: 'ls -la',
                description: 'Quick directory listing'
              }
            }],
            stop_reason: 'tool_use'
          },
          session_id: 'cascade_test'
        },
        // Only the last tool gets a result
        {
          type: 'user',
          message: {
            role: 'user',
            content: [{
              type: 'tool_result',
              tool_use_id: 'tool_c',
              content: 'total 8\ndrwxr-xr-x  3 user staff  96 Jan 1 12:00 .\ndrwxr-xr-x  4 user staff 128 Jan 1 11:00 ..',
              is_error: false
            }]
          },
          session_id: 'cascade_test'
        }
      ];

      // Act
      events.forEach(event => messageQueue.enqueue(event));
      await new Promise(resolve => setTimeout(resolve, 600));

      // Assert
      expect(capturedGroups).toHaveLength(3);
      
      // First two should be single (interrupted)
      expect(capturedGroups[0].type).toBe('single');
      expect(capturedGroups[1].type).toBe('single');
      
      // Last should be tool_pair (completed)
      expect(capturedGroups[2].type).toBe('tool_pair');

      const reduced = messageReducer.reduceGroups(capturedGroups);
      expect(reduced).toHaveLength(3);
      
      // Verify interruption sequence
      expect(reduced[0].type).toBe('tool_interrupted');
      expect(reduced[0].content).toContain('⚠️ Tool: Read - INTERRUPTED');
      expect(reduced[0].content).toContain('/large_file.txt');
      
      expect(reduced[1].type).toBe('tool_interrupted');
      expect(reduced[1].content).toContain('⚠️ Tool: Write - INTERRUPTED');
      expect(reduced[1].content).toContain('/output.txt');
      
      expect(reduced[2].type).toBe('tool_complete');
      expect(reduced[2].content).toContain('✅ Tool: Bash - COMPLETED');
      expect(reduced[2].content).toContain('ls -la');
    });
  });

  /**
   * Scenario: Error handling workflow
   * Events: Tool use → Error result → Recovery attempt → Success
   * Expected: Failed tool + successful recovery tool
   */
  describe('Scenario: Error Recovery Workflow', () => {
    it('should handle error and recovery sequence', async () => {
      // Arrange: Error and recovery scenario
      const events = [
        // Initial tool that fails
        {
          type: 'assistant',
          message: {
            id: 'error_1',
            content: [{
              type: 'tool_use',
              id: 'fail_tool',
              name: 'Read',
              input: {
                file_path: '/nonexistent/file.txt'
              }
            }],
            stop_reason: 'tool_use'
          },
          session_id: 'error_test'
        },
        // Error result
        {
          type: 'user',
          message: {
            role: 'user',
            content: [{
              type: 'tool_result',
              tool_use_id: 'fail_tool',
              content: 'FileNotFoundError: No such file or directory: \'/nonexistent/file.txt\'',
              is_error: true
            }]
          },
          session_id: 'error_test'
        },
        // Recovery attempt
        {
          type: 'assistant',
          message: {
            id: 'error_2',
            content: [{
              type: 'tool_use',
              id: 'recovery_tool',
              name: 'Bash',
              input: {
                command: 'find . -name "*.txt" -type f',
                description: 'Find alternative text files'
              }
            }],
            stop_reason: 'tool_use'
          },
          session_id: 'error_test'
        },
        // Successful recovery
        {
          type: 'user',
          message: {
            role: 'user',
            content: [{
              type: 'tool_result',
              tool_use_id: 'recovery_tool',
              content: './documents/readme.txt\n./logs/error.txt\n./config/settings.txt',
              is_error: false
            }]
          },
          session_id: 'error_test'
        }
      ];

      // Act
      events.forEach(event => messageQueue.enqueue(event));
      await new Promise(resolve => setTimeout(resolve, 600));

      // Assert
      expect(capturedGroups).toHaveLength(2);
      
      // Both should be tool_pair
      expect(capturedGroups[0].type).toBe('tool_pair');
      expect(capturedGroups[1].type).toBe('tool_pair');

      const reduced = messageReducer.reduceGroups(capturedGroups);
      expect(reduced).toHaveLength(2);
      
      // Failed tool
      expect(reduced[0].type).toBe('tool_failed');
      expect(reduced[0].content).toContain('❌ Tool: Read - FAILED');
      expect(reduced[0].content).toContain('🚨 Error: FileNotFoundError');
      
      // Successful recovery
      expect(reduced[1].type).toBe('tool_complete');
      expect(reduced[1].content).toContain('✅ Tool: Bash - COMPLETED');
      expect(reduced[1].content).toContain('Find alternative text files');
      expect(reduced[1].content).toContain('readme.txt');
    });
  });

  /**
   * Scenario: Mixed content workflow
   * Events: System init → Assistant text → Tool use → Assistant text → Tool result → Result
   * Expected: Multiple message types with proper ordering
   */
  describe('Scenario: Mixed Content Workflow', () => {
    it('should handle mixed assistant content correctly', async () => {
      // Arrange: Mixed content workflow
      const events = [
        {
          type: 'system',
          subtype: 'init',
          session_id: 'mixed_test',
          tools: ['Bash', 'Read', 'Write'],
          mcp_servers: []
        },
        {
          type: 'assistant',
          message: {
            id: 'mixed_1',
            content: [{ type: 'text', text: 'I\'ll process this step by step.' }],
            stop_reason: 'end_turn'
          },
          session_id: 'mixed_test'
        },
        {
          type: 'assistant',
          message: {
            id: 'mixed_2',
            content: [{
              type: 'tool_use',
              id: 'mixed_tool',
              name: 'Bash',
              input: {
                command: 'echo "processing..."',
                description: 'Show progress'
              }
            }],
            stop_reason: 'tool_use'
          },
          session_id: 'mixed_test'
        },
        {
          type: 'assistant',
          message: {
            id: 'mixed_3',
            content: [{ type: 'text', text: 'Now I\'ll wait for the result...' }],
            stop_reason: 'end_turn'
          },
          session_id: 'mixed_test'
        },
        {
          type: 'user',
          message: {
            role: 'user',
            content: [{
              type: 'tool_result',
              tool_use_id: 'mixed_tool',
              content: 'processing...',
              is_error: false
            }]
          },
          session_id: 'mixed_test'
        },
        {
          type: 'assistant',
          message: {
            id: 'mixed_4',
            content: [{ type: 'text', text: 'Perfect! The task is complete.' }],
            stop_reason: 'end_turn'
          },
          session_id: 'mixed_test'
        }
      ];

      // Act
      events.forEach(event => messageQueue.enqueue(event));
      await new Promise(resolve => setTimeout(resolve, 600));

      // Assert
      expect(capturedGroups).toHaveLength(5);
      
      // Verify sequence: system, assistant, tool_pair, assistant
      expect(capturedGroups[0].type).toBe('single'); // system
      expect(capturedGroups[1].type).toBe('single'); // assistant text 1
      expect(capturedGroups[2].type).toBe('single'); // assistant text 2 (interrupted by tool)
      expect(capturedGroups[3].type).toBe('tool_pair'); // tool execution
      expect(capturedGroups[4].type).toBe('single'); // assistant text 3

      const reduced = messageReducer.reduceGroups(capturedGroups);
      
      // Verify content ordering
      const textContents = reduced.filter(r => r.type === 'single').map(r => r.content);
      expect(textContents[0]).toContain('🚀 Session Initialized');
      expect(textContents[1]).toContain('step by step');
      expect(textContents[2]).toContain('wait for the result');
      expect(textContents[3]).toContain('Perfect! The task is complete');
      
      const toolContent = reduced.find(r => r.type === 'tool_complete');
      expect(toolContent).toBeDefined();
      expect(toolContent!.content).toContain('✅ Tool: Bash - COMPLETED');
    });
  });

  /**
   * Scenario: Rapid tool switching
   * Events: 5 quick tools in succession, only last one completes
   * Expected: 4 interrupted + 1 completed
   */
  describe('Scenario: Rapid Tool Switching', () => {
    it('should handle rapid tool switching correctly', async () => {
      // Arrange: Rapid succession of tools
      const toolCount = 5;
      const events = [];
      
      // Create rapid tool sequence
      for (let i = 0; i < toolCount; i++) {
        events.push({
          type: 'assistant',
          message: {
            id: `rapid_${i}`,
            content: [{
              type: 'tool_use',
              id: `rapid_tool_${i}`,
              name: 'Bash',
              input: {
                command: `echo "step ${i}"`,
                description: `Step ${i} of rapid sequence`
              }
            }],
            stop_reason: 'tool_use'
          },
          session_id: 'rapid_test'
        });
      }
      
      // Only the last tool gets a result
      events.push({
        type: 'user',
        message: {
          role: 'user',
          content: [{
            type: 'tool_result',
            tool_use_id: `rapid_tool_${toolCount - 1}`,
            content: `step ${toolCount - 1}`,
            is_error: false
          }]
        },
        session_id: 'rapid_test'
      });

      // Act
      events.forEach(event => messageQueue.enqueue(event));
      await new Promise(resolve => setTimeout(resolve, 600));

      // Assert
      expect(capturedGroups).toHaveLength(toolCount);
      
      // First 4 should be single (interrupted)
      for (let i = 0; i < toolCount - 1; i++) {
        expect(capturedGroups[i].type).toBe('single');
      }
      
      // Last should be tool_pair (completed)
      expect(capturedGroups[toolCount - 1].type).toBe('tool_pair');

      const reduced = messageReducer.reduceGroups(capturedGroups);
      expect(reduced).toHaveLength(toolCount);
      
      // Verify interruption pattern
      for (let i = 0; i < toolCount - 1; i++) {
        expect(reduced[i].type).toBe('tool_interrupted');
        expect(reduced[i].content).toContain('INTERRUPTED');
        expect(reduced[i].content).toContain(`Step ${i} of rapid sequence`);
      }
      
      // Last should be completed
      expect(reduced[toolCount - 1].type).toBe('tool_complete');
      expect(reduced[toolCount - 1].content).toContain('COMPLETED');
      expect(reduced[toolCount - 1].content).toContain(`Step ${toolCount - 1}`);
    });
  });

  /**
   * Scenario: Empty and malformed messages
   * Events: Valid tool → Empty content → Malformed tool → Valid result
   * Expected: Graceful handling of edge cases
   */
  describe('Scenario: Edge Case Handling', () => {
    it('should handle malformed and empty messages gracefully', async () => {
      // Arrange: Mixed valid and invalid messages
      const events = [
        // Valid tool
        {
          type: 'assistant',
          message: {
            id: 'edge_1',
            content: [{
              type: 'tool_use',
              id: 'edge_tool_valid',
              name: 'Bash',
              input: { command: 'echo valid' }
            }],
            stop_reason: 'tool_use'
          },
          session_id: 'edge_test'
        },
        // Empty message
        {
          type: 'assistant',
          message: {
            id: 'edge_2',
            content: [],
            stop_reason: 'end_turn'
          },
          session_id: 'edge_test'
        },
        // Malformed tool (no ID)
        {
          type: 'assistant',
          message: {
            id: 'edge_3',
            content: [{
              type: 'tool_use',
              // Missing id field
              name: 'Bash',
              input: { command: 'echo malformed' }
            }],
            stop_reason: 'tool_use'
          },
          session_id: 'edge_test'
        },
        // Valid result for first tool
        {
          type: 'user',
          message: {
            role: 'user',
            content: [{
              type: 'tool_result',
              tool_use_id: 'edge_tool_valid',
              content: 'valid',
              is_error: false
            }]
          },
          session_id: 'edge_test'
        }
      ];

      // Act
      events.forEach(event => messageQueue.enqueue(event));
      await new Promise(resolve => setTimeout(resolve, 600));

      // Assert: Should handle gracefully without errors
      expect(capturedGroups.length).toBeGreaterThan(0);
      
      const reduced = messageReducer.reduceGroups(capturedGroups);
      expect(reduced.length).toBeGreaterThan(0);
      
      // Should find at least one successful tool completion
      const completedTool = reduced.find(r => r.type === 'tool_complete');
      expect(completedTool).toBeDefined();
      expect(completedTool!.content).toContain('✅ Tool: Bash - COMPLETED');
    });
  });
});