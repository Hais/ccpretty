// Mock the formatters module since it imports ESM modules
jest.mock('../src/formatters', () => ({
  formatMessage: jest.fn(() => 'Mocked formatted message'),
  trimFilePath: jest.fn((path: string) => path),
}));

import {
  isSignificantEvent,
  getMessageType,
  extractAssistantContent,
  createSlackMessage,
  createSlackBlocks,
  LogEntry,
} from '../src/slack';
import {
  AssistantResponse,
  UserResponse,
  SystemInitMessage,
} from '../src/models';

describe('Slack Integration', () => {
  describe('isSignificantEvent', () => {
    it('should return true for system init messages', () => {
      const systemInit: SystemInitMessage = {
        type: 'system',
        subtype: 'init',
        session_id: 'test-session',
        tools: ['Bash', 'Read'],
        mcp_servers: []
      };
      expect(isSignificantEvent(systemInit)).toBe(true);
    });

    it('should return true for result messages', () => {
      const result: LogEntry = {
        type: 'result',
        subtype: 'success',
        is_error: false
      };
      expect(isSignificantEvent(result)).toBe(true);
    });

    it('should return true for assistant messages with text', () => {
      const assistant: AssistantResponse = {
        type: 'assistant',
        message: {
          id: 'test-id',
          type: 'message',
          role: 'assistant',
          model: 'claude-3',
          content: [{
            type: 'text',
            text: 'Hello'
          }],
          stop_reason: 'end_turn',
          stop_sequence: null,
          usage: { input_tokens: 10, output_tokens: 5 },
          ttftMs: 100
        },
        session_id: 'test-session'
      };
      expect(isSignificantEvent(assistant)).toBe(true);
    });

    it('should return true for assistant messages with tool use', () => {
      const assistant: AssistantResponse = {
        type: 'assistant',
        message: {
          id: 'test-id',
          type: 'message',
          role: 'assistant',
          model: 'claude-3',
          content: [{
            type: 'tool_use',
            id: 'tool-id',
            name: 'Bash',
            input: { command: 'ls' }
          }],
          stop_reason: 'tool_use',
          stop_sequence: null,
          usage: { input_tokens: 10, output_tokens: 5 },
          ttftMs: 100
        },
        session_id: 'test-session'
      };
      expect(isSignificantEvent(assistant)).toBe(true);
    });

    it('should return true for user messages with tool results', () => {
      const user: UserResponse = {
        type: 'user',
        message: {
          role: 'user',
          content: [{
            type: 'tool_result',
            tool_use_id: 'tool-id',
            content: 'Result'
          }]
        },
        session_id: 'test-session'
      };
      expect(isSignificantEvent(user)).toBe(true);
    });

    it('should return false for invalid data', () => {
      expect(isSignificantEvent({})).toBe(false);
      expect(isSignificantEvent({ type: 'unknown' })).toBe(false);
    });

    it('should handle errors gracefully', () => {
      const invalidData: LogEntry = {
        type: 'assistant',
        message: null // This will cause an error
      };
      expect(isSignificantEvent(invalidData)).toBe(false);
    });
  });

  describe('getMessageType', () => {
    it('should return "system_init" for system init messages', () => {
      const systemInit: SystemInitMessage = {
        type: 'system',
        subtype: 'init',
        session_id: 'test-session',
        tools: ['Bash'],
        mcp_servers: []
      };
      expect(getMessageType(systemInit)).toBe('system_init');
    });

    it('should return "result" for result messages', () => {
      const result: LogEntry = {
        type: 'result',
        subtype: 'success'
      };
      expect(getMessageType(result)).toBe('result');
    });

    it('should return "tool_use" for assistant messages with tool use', () => {
      const assistant: AssistantResponse = {
        type: 'assistant',
        message: {
          id: 'test-id',
          type: 'message',
          role: 'assistant',
          model: 'claude-3',
          content: [{
            type: 'tool_use',
            id: 'tool-id',
            name: 'Bash',
            input: {}
          }],
          stop_reason: 'tool_use',
          stop_sequence: null,
          usage: { input_tokens: 10, output_tokens: 5 },
          ttftMs: 100
        },
        session_id: 'test-session'
      };
      expect(getMessageType(assistant)).toBe('tool_use');
    });

    it('should return "assistant" for assistant messages with text', () => {
      const assistant: AssistantResponse = {
        type: 'assistant',
        message: {
          id: 'test-id',
          type: 'message',
          role: 'assistant',
          model: 'claude-3',
          content: [{
            type: 'text',
            text: 'Hello'
          }],
          stop_reason: 'end_turn',
          stop_sequence: null,
          usage: { input_tokens: 10, output_tokens: 5 },
          ttftMs: 100
        },
        session_id: 'test-session'
      };
      expect(getMessageType(assistant)).toBe('assistant');
    });

    it('should return "tool_result" for user messages', () => {
      const user: UserResponse = {
        type: 'user',
        message: {
          role: 'user',
          content: []
        },
        session_id: 'test-session'
      };
      expect(getMessageType(user)).toBe('tool_result');
    });

    it('should return "unknown" for invalid data', () => {
      expect(getMessageType({})).toBe('unknown');
      expect(getMessageType({ type: 'invalid' })).toBe('unknown');
    });
  });

  describe('extractAssistantContent', () => {
    it('should extract text content from assistant messages', () => {
      const assistant: AssistantResponse = {
        type: 'assistant',
        message: {
          id: 'test-id',
          type: 'message',
          role: 'assistant',
          model: 'claude-3',
          content: [{
            type: 'text',
            text: 'Hello world'
          }],
          stop_reason: 'end_turn',
          stop_sequence: null,
          usage: { input_tokens: 10, output_tokens: 5 },
          ttftMs: 100
        },
        session_id: 'test-session'
      };
      expect(extractAssistantContent(assistant)).toBe('Hello world');
    });

    it('should combine multiple text contents', () => {
      const assistant: AssistantResponse = {
        type: 'assistant',
        message: {
          id: 'test-id',
          type: 'message',
          role: 'assistant',
          model: 'claude-3',
          content: [
            { type: 'text', text: 'First part' },
            { type: 'text', text: 'Second part' }
          ],
          stop_reason: 'end_turn',
          stop_sequence: null,
          usage: { input_tokens: 10, output_tokens: 5 },
          ttftMs: 100
        },
        session_id: 'test-session'
      };
      expect(extractAssistantContent(assistant)).toBe('First part\n\nSecond part');
    });

    it('should truncate long messages', () => {
      const longText = 'a'.repeat(600);
      const assistant: AssistantResponse = {
        type: 'assistant',
        message: {
          id: 'test-id',
          type: 'message',
          role: 'assistant',
          model: 'claude-3',
          content: [{
            type: 'text',
            text: longText
          }],
          stop_reason: 'end_turn',
          stop_sequence: null,
          usage: { input_tokens: 10, output_tokens: 5 },
          ttftMs: 100
        },
        session_id: 'test-session'
      };
      const result = extractAssistantContent(assistant);
      expect(result.length).toBe(500);
      expect(result.endsWith('...')).toBe(true);
    });

    it('should return empty string for non-assistant messages', () => {
      expect(extractAssistantContent({})).toBe('');
      expect(extractAssistantContent({ type: 'user' })).toBe('');
    });

    it('should handle errors gracefully', () => {
      const invalidData: LogEntry = {
        type: 'assistant',
        message: {
          content: null // This will cause an error
        }
      };
      expect(extractAssistantContent(invalidData)).toBe('');
    });
  });

  describe('createSlackMessage', () => {
    it('should create message for system init', () => {
      const systemInit: SystemInitMessage = {
        type: 'system',
        subtype: 'init',
        session_id: 'test-session',
        tools: ['Bash', 'Read'],
        mcp_servers: []
      };
      const result = createSlackMessage(systemInit);
      expect(result).toContain('🚀 *Claude Code Session Started*');
      expect(result).toContain('Session ID: `test-session`');
      expect(result).toContain('Tools: Bash, Read');
    });

    it('should create message for successful result', () => {
      const result: LogEntry = {
        type: 'result',
        subtype: 'success',
        is_error: false,
        duration_ms: 5000,
        cost_usd: 0.0124
      };
      const message = createSlackMessage(result);
      expect(message).toContain('✅ *Task Completed*');
      expect(message).toContain('Duration: 5.00s');
      expect(message).toContain('Cost: $0.0124 USD');
    });

    it('should create message for failed result', () => {
      const result: LogEntry = {
        type: 'result',
        subtype: 'error',
        is_error: true,
        duration_ms: 3000,
        cost_usd: 0.0050
      };
      const message = createSlackMessage(result);
      expect(message).toContain('❌ *Task Failed*');
      expect(message).toContain('Duration: 3.00s');
      expect(message).toContain('Cost: $0.0050 USD');
    });

    it('should create message for assistant text', () => {
      const assistant: AssistantResponse = {
        type: 'assistant',
        message: {
          id: 'test-id',
          type: 'message',
          role: 'assistant',
          model: 'claude-3',
          content: [{
            type: 'text',
            text: 'Hello world'
          }],
          stop_reason: 'end_turn',
          stop_sequence: null,
          usage: { input_tokens: 10, output_tokens: 5 },
          ttftMs: 100
        },
        session_id: 'test-session'
      };
      const result = createSlackMessage(assistant);
      expect(result).toContain('💬 *Assistant:*');
      expect(result).toContain('Hello world');
    });

    it('should create message for tool use', () => {
      const assistant: AssistantResponse = {
        type: 'assistant',
        message: {
          id: 'test-id',
          type: 'message',
          role: 'assistant',
          model: 'claude-3',
          content: [{
            type: 'tool_use',
            id: 'tool-id',
            name: 'Bash',
            input: {
              command: 'ls -la',
              description: 'List files'
            }
          }],
          stop_reason: 'tool_use',
          stop_sequence: null,
          usage: { input_tokens: 10, output_tokens: 5 },
          ttftMs: 100
        },
        session_id: 'test-session'
      };
      const result = createSlackMessage(assistant);
      expect(result).toContain('🔧 *Bash*');
      expect(result).toContain('Command: `ls -la`');
      expect(result).toContain('Description: List files');
      expect(result).toContain('🟡 *Running...*');
    });

    it('should return default message for unknown types', () => {
      const result = createSlackMessage({});
      expect(result).toBe('Event processed');
    });
  });

  describe('createSlackBlocks', () => {
    it('should create blocks for system init', () => {
      const systemInit: SystemInitMessage = {
        type: 'system',
        subtype: 'init',
        session_id: 'test-session',
        tools: ['Bash', 'Read'],
        mcp_servers: []
      };
      const blocks = createSlackBlocks(systemInit);
      expect(blocks).toHaveLength(2);
      expect(blocks[0].type).toBe('header');
      expect(blocks[0].text.text).toContain('🚀 Claude Code Session Started');
      expect(blocks[1].type).toBe('section');
      expect(blocks[1].fields).toHaveLength(2);
    });

    it('should create blocks for result messages', () => {
      const result: LogEntry = {
        type: 'result',
        subtype: 'success',
        is_error: false,
        duration_ms: 5000,
        duration_api_ms: 2000,
        num_turns: 3,
        cost_usd: 0.0124
      };
      const blocks = createSlackBlocks(result);
      expect(blocks).toHaveLength(2);
      expect(blocks[0].type).toBe('header');
      expect(blocks[0].text.text).toContain('✅ Task Completed');
      expect(blocks[1].type).toBe('section');
      expect(blocks[1].fields).toHaveLength(4);
    });

    it('should create blocks for assistant tool use', () => {
      const assistant: AssistantResponse = {
        type: 'assistant',
        message: {
          id: 'test-id',
          type: 'message',
          role: 'assistant',
          model: 'claude-3',
          content: [{
            type: 'tool_use',
            id: 'tool-id',
            name: 'Bash',
            input: {
              command: 'ls -la',
              description: 'List files'
            }
          }],
          stop_reason: 'tool_use',
          stop_sequence: null,
          usage: { input_tokens: 10, output_tokens: 5 },
          ttftMs: 100
        },
        session_id: 'test-session'
      };
      const blocks = createSlackBlocks(assistant);
      expect(blocks.length).toBeGreaterThan(0);
      expect(blocks[0].type).toBe('header');
      expect(blocks[0].text.text).toContain('🔧 Bash');
    });

    it('should create blocks for assistant text content', () => {
      const assistant: AssistantResponse = {
        type: 'assistant',
        message: {
          id: 'test-id',
          type: 'message',
          role: 'assistant',
          model: 'claude-3',
          content: [{
            type: 'text',
            text: 'Hello world'
          }],
          stop_reason: 'end_turn',
          stop_sequence: null,
          usage: { input_tokens: 10, output_tokens: 5 },
          ttftMs: 100
        },
        session_id: 'test-session'
      };
      const blocks = createSlackBlocks(assistant);
      expect(blocks).toHaveLength(1);
      expect(blocks[0].type).toBe('section');
      expect(blocks[0].text.text).toContain('💬 *Assistant:*');
      expect(blocks[0].text.text).toContain('Hello world');
    });

    it('should return empty blocks for user tool results', () => {
      const user: UserResponse = {
        type: 'user',
        message: {
          role: 'user',
          content: [{
            type: 'tool_result',
            tool_use_id: 'tool-id',
            content: 'Result'
          }]
        },
        session_id: 'test-session'
      };
      const blocks = createSlackBlocks(user);
      expect(blocks).toHaveLength(0);
    });
  });
});