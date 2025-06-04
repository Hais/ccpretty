import {
  TextContent,
  ToolUseContent,
  ToolResultContent,
  AssistantResponse,
  UserResponse,
  SystemResponse,
  SystemInitMessage,
  isTextContent,
  isToolUseContent,
  isToolResultContent,
  isAssistantResponse,
  isUserResponse,
  isSystemResponse,
  isSystemInitMessage,
} from '../src/models';

describe('Type Guards', () => {
  describe('isTextContent', () => {
    it('should return true for text content', () => {
      const textContent: TextContent = {
        type: 'text',
        text: 'Hello world'
      };
      expect(isTextContent(textContent)).toBe(true);
    });

    it('should return false for non-text content', () => {
      const toolContent: ToolUseContent = {
        type: 'tool_use',
        id: 'test-id',
        name: 'TestTool',
        input: {}
      };
      expect(isTextContent(toolContent)).toBe(false);
    });
  });

  describe('isToolUseContent', () => {
    it('should return true for tool use content', () => {
      const toolContent: ToolUseContent = {
        type: 'tool_use',
        id: 'test-id',
        name: 'TestTool',
        input: { command: 'test' }
      };
      expect(isToolUseContent(toolContent)).toBe(true);
    });

    it('should return false for non-tool-use content', () => {
      const textContent: TextContent = {
        type: 'text',
        text: 'Hello world'
      };
      expect(isToolUseContent(textContent)).toBe(false);
    });
  });

  describe('isToolResultContent', () => {
    it('should return true for tool result content', () => {
      const resultContent: ToolResultContent = {
        type: 'tool_result',
        tool_use_id: 'test-id',
        content: 'Result content'
      };
      expect(isToolResultContent(resultContent)).toBe(true);
    });

    it('should return false for non-tool-result content', () => {
      const textContent: TextContent = {
        type: 'text',
        text: 'Hello world'
      };
      expect(isToolResultContent(textContent)).toBe(false);
    });
  });

  describe('isAssistantResponse', () => {
    it('should return true for valid assistant response', () => {
      const assistantResponse: AssistantResponse = {
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
          usage: {
            input_tokens: 10,
            output_tokens: 5
          },
          ttftMs: 100
        },
        session_id: 'test-session'
      };
      expect(isAssistantResponse(assistantResponse)).toBe(true);
    });

    it('should return false for invalid assistant response', () => {
      expect(isAssistantResponse({})).toBe(false);
      expect(isAssistantResponse({ type: 'user' })).toBe(false);
      expect(isAssistantResponse({ type: 'assistant' })).toBe(false);
      expect(isAssistantResponse({ type: 'assistant', message: { role: 'user' } })).toBe(false);
    });
  });

  describe('isUserResponse', () => {
    it('should return true for valid user response', () => {
      const userResponse: UserResponse = {
        type: 'user',
        message: {
          role: 'user',
          content: [{
            type: 'text',
            text: 'Hello'
          }]
        },
        session_id: 'test-session'
      };
      expect(isUserResponse(userResponse)).toBe(true);
    });

    it('should return false for invalid user response', () => {
      expect(isUserResponse({})).toBe(false);
      expect(isUserResponse({ type: 'assistant' })).toBe(false);
      expect(isUserResponse({ type: 'user' })).toBe(false);
      expect(isUserResponse({ type: 'user', message: { role: 'assistant' } })).toBe(false);
    });
  });

  describe('isSystemResponse', () => {
    it('should return true for valid system response', () => {
      const systemResponse: SystemResponse = {
        type: 'system',
        subtype: 'init',
        session_id: 'test-session',
        tools: [],
        mcp_servers: []
      };
      expect(isSystemResponse(systemResponse)).toBe(true);
    });

    it('should return false for invalid system response', () => {
      expect(isSystemResponse({})).toBe(false);
      expect(isSystemResponse({ type: 'user' })).toBe(false);
    });
  });

  describe('isSystemInitMessage', () => {
    it('should return true for valid system init message', () => {
      const initMessage: SystemInitMessage = {
        type: 'system',
        subtype: 'init',
        session_id: 'test-session',
        tools: ['Bash', 'Read'],
        mcp_servers: []
      };
      expect(isSystemInitMessage(initMessage)).toBe(true);
    });

    it('should return false for invalid system init message', () => {
      expect(isSystemInitMessage({})).toBe(false);
      expect(isSystemInitMessage({ type: 'system' })).toBe(false);
      expect(isSystemInitMessage({ type: 'system', subtype: 'other' })).toBe(false);
    });
  });
});