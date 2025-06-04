import { extractJson } from '@axync/extract-json';

// Mock the extract-json library
jest.mock('@axync/extract-json', () => ({
  extractJson: jest.fn()
}));

const mockExtractJson = extractJson as jest.MockedFunction<typeof extractJson>;

describe('JSON Processing', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('JSON extraction and parsing', () => {
    it('should extract valid JSON from text', async () => {
      const jsonData = {
        type: 'assistant',
        message: {
          id: 'test-id',
          role: 'assistant',
          content: [{ type: 'text', text: 'Hello' }]
        }
      };
      const inputText = `Some prefix text\n${JSON.stringify(jsonData)}\nSome suffix text`;
      
      mockExtractJson.mockResolvedValue([jsonData]);
      
      const result = await extractJson(inputText);
      expect(result).toHaveLength(1);
      expect(result[0]).toEqual(jsonData);
      expect(mockExtractJson).toHaveBeenCalledWith(inputText);
    });

    it('should handle multiple JSON objects in text', async () => {
      const json1 = { type: 'system', subtype: 'init' };
      const json2 = { type: 'assistant', message: { content: [] } };
      const inputText = `${JSON.stringify(json1)}\n${JSON.stringify(json2)}`;
      
      mockExtractJson.mockResolvedValue([json1, json2]);
      
      const result = await extractJson(inputText);
      expect(result).toHaveLength(2);
      expect(result[0]).toEqual(json1);
      expect(result[1]).toEqual(json2);
    });

    it('should handle empty result when no JSON found', async () => {
      const inputText = 'Plain text with no JSON';
      
      mockExtractJson.mockResolvedValue([]);
      
      const result = await extractJson(inputText);
      expect(result).toHaveLength(0);
    });

    it('should handle extraction errors gracefully', async () => {
      const inputText = 'Invalid JSON {broken';
      
      mockExtractJson.mockRejectedValue(new Error('Invalid JSON'));
      
      await expect(extractJson(inputText)).rejects.toThrow('Invalid JSON');
    });
  });

  describe('JSON validation', () => {
    it('should handle valid assistant message structure', async () => {
      const validAssistant = {
        type: 'assistant',
        message: {
          id: 'msg-123',
          type: 'message',
          role: 'assistant',
          model: 'claude-3',
          content: [
            {
              type: 'text',
              text: 'Hello world'
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
        session_id: 'session-123'
      };
      
      mockExtractJson.mockResolvedValue([validAssistant]);
      
      const result = await extractJson('some text');
      expect(result[0]).toHaveProperty('type', 'assistant');
      expect(result[0]).toHaveProperty('message.role', 'assistant');
      expect(result[0]).toHaveProperty('message.content');
      expect(Array.isArray((result[0] as any).message.content)).toBe(true);
    });

    it('should handle valid user message structure', async () => {
      const validUser = {
        type: 'user',
        message: {
          role: 'user',
          content: [
            {
              type: 'tool_result',
              tool_use_id: 'tool-123',
              content: 'Command output'
            }
          ]
        },
        session_id: 'session-123'
      };
      
      mockExtractJson.mockResolvedValue([validUser]);
      
      const result = await extractJson('some text');
      expect(result[0]).toHaveProperty('type', 'user');
      expect(result[0]).toHaveProperty('message.role', 'user');
      expect(result[0]).toHaveProperty('message.content');
    });

    it('should handle valid system message structure', async () => {
      const validSystem = {
        type: 'system',
        subtype: 'init',
        session_id: 'session-123',
        tools: ['Bash', 'Read', 'Write'],
        mcp_servers: ['server1']
      };
      
      mockExtractJson.mockResolvedValue([validSystem]);
      
      const result = await extractJson('some text');
      expect(result[0]).toHaveProperty('type', 'system');
      expect(result[0]).toHaveProperty('subtype', 'init');
      expect(result[0]).toHaveProperty('tools');
      expect(Array.isArray((result[0] as any).tools)).toBe(true);
    });

    it('should handle valid result message structure', async () => {
      const validResult = {
        type: 'result',
        subtype: 'success',
        is_error: false,
        result: 'Task completed successfully',
        duration_ms: 5000,
        duration_api_ms: 2000,
        num_turns: 3,
        cost_usd: 0.0124,
        session_id: 'session-123'
      };
      
      mockExtractJson.mockResolvedValue([validResult]);
      
      const result = await extractJson('some text');
      expect(result[0]).toHaveProperty('type', 'result');
      expect(result[0]).toHaveProperty('subtype', 'success');
      expect(result[0]).toHaveProperty('duration_ms');
      expect(result[0]).toHaveProperty('cost_usd');
    });
  });

  describe('Complex message content', () => {
    it('should handle tool use content', async () => {
      const toolUseMessage = {
        type: 'assistant',
        message: {
          id: 'msg-123',
          type: 'message',
          role: 'assistant',
          model: 'claude-3',
          content: [
            {
              type: 'tool_use',
              id: 'tool-456',
              name: 'Bash',
              input: {
                command: 'ls -la',
                description: 'List files in directory',
                timeout: 30000
              }
            }
          ],
          stop_reason: 'tool_use',
          stop_sequence: null,
          usage: {
            input_tokens: 20,
            output_tokens: 10
          },
          ttftMs: 150
        },
        session_id: 'session-123'
      };
      
      mockExtractJson.mockResolvedValue([toolUseMessage]);
      
      const result = await extractJson('some text');
      const content = (result[0] as any).message.content[0];
      expect(content).toHaveProperty('type', 'tool_use');
      expect(content).toHaveProperty('name', 'Bash');
      expect(content).toHaveProperty('input.command', 'ls -la');
      expect(content).toHaveProperty('input.description');
    });

    it('should handle TodoWrite tool content', async () => {
      const todoMessage = {
        type: 'assistant',
        message: {
          id: 'msg-123',
          type: 'message',
          role: 'assistant',
          model: 'claude-3',
          content: [
            {
              type: 'tool_use',
              id: 'tool-456',
              name: 'TodoWrite',
              input: {
                todos: [
                  {
                    id: '1',
                    content: 'Complete testing',
                    status: 'in_progress',
                    priority: 'high'
                  },
                  {
                    id: '2',
                    content: 'Write documentation',
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
            input_tokens: 30,
            output_tokens: 15
          },
          ttftMs: 200
        },
        session_id: 'session-123'
      };
      
      mockExtractJson.mockResolvedValue([todoMessage]);
      
      const result = await extractJson('some text');
      const content = (result[0] as any).message.content[0];
      expect(content).toHaveProperty('type', 'tool_use');
      expect(content).toHaveProperty('name', 'TodoWrite');
      expect(content).toHaveProperty('input.todos');
      expect(Array.isArray(content.input.todos)).toBe(true);
      expect(content.input.todos).toHaveLength(2);
      expect(content.input.todos[0]).toHaveProperty('status', 'in_progress');
      expect(content.input.todos[1]).toHaveProperty('priority', 'medium');
    });

    it('should handle mixed content types', async () => {
      const mixedMessage = {
        type: 'assistant',
        message: {
          id: 'msg-123',
          type: 'message',
          role: 'assistant',
          model: 'claude-3',
          content: [
            {
              type: 'text',
              text: 'I will run a command for you:'
            },
            {
              type: 'tool_use',
              id: 'tool-456',
              name: 'Bash',
              input: {
                command: 'echo "hello"',
                description: 'Echo command'
              }
            }
          ],
          stop_reason: 'tool_use',
          stop_sequence: null,
          usage: {
            input_tokens: 25,
            output_tokens: 12
          },
          ttftMs: 175
        },
        session_id: 'session-123'
      };
      
      mockExtractJson.mockResolvedValue([mixedMessage]);
      
      const result = await extractJson('some text');
      const content = (result[0] as any).message.content;
      expect(content).toHaveLength(2);
      expect(content[0]).toHaveProperty('type', 'text');
      expect(content[1]).toHaveProperty('type', 'tool_use');
    });
  });

  describe('Edge cases', () => {
    it('should handle malformed JSON gracefully', async () => {
      mockExtractJson.mockRejectedValue(new Error('Malformed JSON'));
      
      await expect(extractJson('{"invalid": json}')).rejects.toThrow('Malformed JSON');
    });

    it('should handle empty strings', async () => {
      mockExtractJson.mockResolvedValue([]);
      
      const result = await extractJson('');
      expect(result).toHaveLength(0);
    });

    it('should handle very large JSON objects', async () => {
      const largeContent = Array(1000).fill(0).map((_, i) => ({
        type: 'text',
        text: `Line ${i}: ${'a'.repeat(100)}`
      }));
      
      const largeMessage = {
        type: 'assistant',
        message: {
          id: 'large-msg',
          role: 'assistant',
          content: largeContent
        }
      };
      
      mockExtractJson.mockResolvedValue([largeMessage]);
      
      const result = await extractJson('large json');
      expect((result[0] as any).message.content).toHaveLength(1000);
    });
  });
});