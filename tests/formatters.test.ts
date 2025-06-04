import {
  formatAssistantResponse,
  formatUserResponse,
  formatSystemResponse,
  formatResultResponse,
  trimFilePath,
} from '../src/formatters';
import {
  AssistantResponse,
  UserResponse,
  SystemResponse,
  SystemInitMessage,
} from '../src/models';

// Mock picocolors to avoid ANSI escape sequences in tests
jest.mock('picocolors', () => ({
  white: jest.fn((text) => text),
  yellow: jest.fn((text) => text),
  dim: jest.fn((text) => text),
  bold: jest.fn((text) => text),
  red: jest.fn((text) => text),
  green: jest.fn((text) => text),
}));

// Mock boxen to return simple formatted text
jest.mock('boxen', () => jest.fn((content, options) => `[${options?.title || 'box'}]\n${content}`));

describe('Formatters', () => {
  describe('trimFilePath', () => {
    const originalCwd = process.cwd();

    beforeEach(() => {
      // Mock process.cwd() to return a known value
      jest.spyOn(process, 'cwd').mockReturnValue('/Users/test/project');
    });

    afterEach(() => {
      jest.restoreAllMocks();
    });

    it('should trim file path relative to current working directory', () => {
      const filePath = '/Users/test/project/src/index.ts';
      const result = trimFilePath(filePath);
      expect(result).toBe('src/index.ts');
    });

    it('should return ./ for the current directory', () => {
      const filePath = '/Users/test/project';
      const result = trimFilePath(filePath);
      expect(result).toBe('./');
    });

    it('should return original path if not in current directory', () => {
      const filePath = '/Users/other/file.ts';
      const result = trimFilePath(filePath);
      expect(result).toBe('/Users/other/file.ts');
    });

    it('should handle errors gracefully', () => {
      jest.spyOn(process, 'cwd').mockImplementation(() => {
        throw new Error('Access denied');
      });
      const filePath = '/Users/test/file.ts';
      const result = trimFilePath(filePath);
      expect(result).toBe('/Users/test/file.ts');
    });
  });

  describe('formatAssistantResponse', () => {
    it('should format text content correctly', () => {
      const response: AssistantResponse = {
        type: 'assistant',
        message: {
          id: 'test-id',
          type: 'message',
          role: 'assistant',
          model: 'claude-3',
          content: [
            {
              type: 'text',
              text: 'Hello, world!'
            }
          ],
          stop_reason: 'end_turn',
          stop_sequence: null,
          usage: {
            input_tokens: 10,
            output_tokens: 5
          },
          ttftMs: 100
        },
        session_id: 'test-session'
      };

      const result = formatAssistantResponse(response);
      expect(result).toContain('Hello, world!');
      expect(result).toContain('[claude-3 | 5 tokens | 100ms]');
      expect(result).toContain('[assistant]');
    });

    it('should format tool use content correctly', () => {
      const response: AssistantResponse = {
        type: 'assistant',
        message: {
          id: 'test-id',
          type: 'message',
          role: 'assistant',
          model: 'claude-3',
          content: [
            {
              type: 'tool_use',
              id: 'tool-id',
              name: 'Bash',
              input: {
                command: 'ls -la',
                description: 'List files'
              }
            }
          ],
          stop_reason: 'tool_use',
          stop_sequence: null,
          usage: {
            input_tokens: 10,
            output_tokens: 5
          },
          ttftMs: 100
        },
        session_id: 'test-session'
      };

      const result = formatAssistantResponse(response);
      expect(result).toContain('Tool: Bash');
      expect(result).toContain('Command: ls -la');
      expect(result).toContain('Description: List files');
    });

    it('should format TodoWrite tool specially', () => {
      const response: AssistantResponse = {
        type: 'assistant',
        message: {
          id: 'test-id',
          type: 'message',
          role: 'assistant',
          model: 'claude-3',
          content: [
            {
              type: 'tool_use',
              id: 'tool-id',
              name: 'TodoWrite',
              input: {
                todos: [
                  {
                    id: '1',
                    content: 'Test task',
                    status: 'completed',
                    priority: 'high'
                  },
                  {
                    id: '2',
                    content: 'Another task',
                    status: 'pending',
                    priority: 'medium'
                  }
                ]
              }
            }
          ],
          stop_reason: 'tool_use',
          stop_sequence: null,
          usage: {
            input_tokens: 10,
            output_tokens: 5
          },
          ttftMs: 100
        },
        session_id: 'test-session'
      };

      const result = formatAssistantResponse(response);
      expect(result).toContain('📝 Todo List:');
      expect(result).toContain('Test task');
      expect(result).toContain('Another task');
      expect(result).toContain('[HIGH]');
      expect(result).toContain('[MEDIUM]');
    });
  });

  describe('formatUserResponse', () => {
    it('should format text content correctly', () => {
      const response: UserResponse = {
        type: 'user',
        message: {
          role: 'user',
          content: [
            {
              type: 'text',
              text: 'User message'
            }
          ]
        },
        session_id: 'test-session'
      };

      const result = formatUserResponse(response);
      expect(result).toContain('User message');
      expect(result).toContain('[user]');
    });

    it('should format tool result content correctly', () => {
      const response: UserResponse = {
        type: 'user',
        message: {
          role: 'user',
          content: [
            {
              type: 'tool_result',
              tool_use_id: 'tool-id',
              content: 'Command output',
              is_error: false
            }
          ]
        },
        session_id: 'test-session'
      };

      const result = formatUserResponse(response);
      expect(result).toContain('Tool Result');
      expect(result).toContain('Tool ID: tool-id');
      expect(result).toContain('Result: Command output');
    });

    it('should format error tool result correctly', () => {
      const response: UserResponse = {
        type: 'user',
        message: {
          role: 'user',
          content: [
            {
              type: 'tool_result',
              tool_use_id: 'tool-id',
              content: 'Error message',
              is_error: true
            }
          ]
        },
        session_id: 'test-session'
      };

      const result = formatUserResponse(response);
      expect(result).toContain('Tool Result');
      expect(result).toContain('Tool ID: tool-id');
      expect(result).toContain('Result: Error message');
    });
  });

  describe('formatSystemResponse', () => {
    it('should format system init message correctly', () => {
      const response: SystemInitMessage = {
        type: 'system',
        subtype: 'init',
        session_id: 'test-session',
        tools: ['Bash', 'Read', 'Write'],
        mcp_servers: ['server1']
      };

      const result = formatSystemResponse(response);
      expect(result).toContain('🚀 Session Initialized');
      expect(result).toContain('Session ID: test-session');
      expect(result).toContain('Tools: Bash, Read, Write');
      expect(result).toContain('MCP Servers: server1');
      expect(result).toContain('[system]');
    });

    it('should format generic system message correctly', () => {
      const response: SystemResponse = {
        type: 'system',
        subtype: 'other',
        session_id: 'test-session'
      };

      const result = formatSystemResponse(response);
      expect(result).toContain('System Event: other');
      expect(result).toContain('Session ID: test-session');
      expect(result).toContain('[system]');
    });
  });

  describe('formatResultResponse', () => {
    it('should format successful result correctly', () => {
      const data = {
        type: 'result',
        subtype: 'success',
        is_error: false,
        result: 'Task completed successfully',
        duration_ms: 5000,
        duration_api_ms: 2000,
        num_turns: 3,
        cost_usd: 0.0124
      };

      const result = formatResultResponse(data);
      expect(result).toContain('✅ Task Completed');
      expect(result).toContain('Task completed successfully');
      expect(result).toContain('Duration: 5.00s');
      expect(result).toContain('API Time: 2.00s');
      expect(result).toContain('Turns: 3');
      expect(result).toContain('Cost: $0.0124 USD');
      expect(result).toContain('[result]');
    });

    it('should format failed result correctly', () => {
      const data = {
        type: 'result',
        subtype: 'error',
        is_error: true,
        result: 'Task failed',
        duration_ms: 3000,
        duration_api_ms: 1000,
        num_turns: 2,
        cost_usd: 0.0050
      };

      const result = formatResultResponse(data);
      expect(result).toContain('❌ Task Failed');
      expect(result).toContain('Task failed');
      expect(result).toContain('Duration: 3.00s');
      expect(result).toContain('API Time: 1.00s');
      expect(result).toContain('Turns: 2');
      expect(result).toContain('Cost: $0.0050 USD');
    });

    it('should handle result without message', () => {
      const data = {
        type: 'result',
        subtype: 'success',
        is_error: false,
        duration_ms: 1000,
        duration_api_ms: 500,
        num_turns: 1,
        cost_usd: 0.0010
      };

      const result = formatResultResponse(data);
      expect(result).toContain('✅ Task Completed');
      expect(result).toContain('Duration: 1.00s');
      expect(result).not.toContain('result:');
    });
  });
});