import { spawn, ChildProcess } from 'child_process';
import * as path from 'path';
import * as fs from 'fs';

describe('CLI Integration Tests', () => {
  const cliPath = path.join(__dirname, '..', 'dist', 'index.js');
  
  beforeAll(() => {
    // Ensure the CLI is built
    if (!fs.existsSync(cliPath)) {
      throw new Error('CLI not built. Run `npm run build` first.');
    }
  });

  function runCLI(input: string, env: Record<string, string> = {}): Promise<{
    stdout: string;
    stderr: string;
    exitCode: number;
  }> {
    return new Promise((resolve) => {
      const child = spawn('node', [cliPath], {
        env: { ...process.env, ...env },
        stdio: ['pipe', 'pipe', 'pipe']
      });

      let stdout = '';
      let stderr = '';

      child.stdout.on('data', (data) => {
        stdout += data.toString();
      });

      child.stderr.on('data', (data) => {
        stderr += data.toString();
      });

      child.on('close', (code) => {
        resolve({
          stdout,
          stderr,
          exitCode: code || 0
        });
      });

      // Send input and close stdin
      child.stdin.write(input);
      child.stdin.end();
    });
  }

  describe('JSON Processing', () => {
    it('should format valid assistant message', async () => {
      const input = JSON.stringify({
        type: 'assistant',
        message: {
          id: 'test-id',
          type: 'message',
          role: 'assistant',
          model: 'claude-3',
          content: [{
            type: 'text',
            text: 'Hello from CLI test'
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
      });

      const result = await runCLI(input);
      expect(result.exitCode).toBe(0);
      expect(result.stdout).toContain('Hello from CLI test');
      expect(result.stdout).toContain('assistant');
      expect(result.stdout).toContain('claude-3');
      expect(result.stdout).toContain('5 tokens');
    });

    it('should format valid system init message', async () => {
      const input = JSON.stringify({
        type: 'system',
        subtype: 'init',
        session_id: 'test-session',
        tools: ['Bash', 'Read', 'Write'],
        mcp_servers: []
      });

      const result = await runCLI(input);
      expect(result.exitCode).toBe(0);
      expect(result.stdout).toContain('🚀 Session Initialized');
      expect(result.stdout).toContain('test-session');
      expect(result.stdout).toContain('Bash, Read, Write');
      expect(result.stdout).toContain('system');
    });

    it('should format valid result message', async () => {
      const input = JSON.stringify({
        type: 'result',
        subtype: 'success',
        is_error: false,
        result: 'Task completed successfully',
        duration_ms: 5000,
        duration_api_ms: 2000,
        num_turns: 3,
        cost_usd: 0.0124
      });

      const result = await runCLI(input);
      expect(result.exitCode).toBe(0);
      expect(result.stdout).toContain('✅ Task Completed');
      expect(result.stdout).toContain('Task completed successfully');
      expect(result.stdout).toContain('Duration: 5.00s');
      expect(result.stdout).toContain('Cost: $0.0124 USD');
      expect(result.stdout).toContain('result');
    });

    it('should handle tool use messages', async () => {
      const input = JSON.stringify({
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
              description: 'List files in directory'
            }
          }],
          stop_reason: 'tool_use',
          stop_sequence: null,
          usage: {
            input_tokens: 20,
            output_tokens: 10
          },
          ttftMs: 150
        },
        session_id: 'test-session'
      });

      const result = await runCLI(input);
      expect(result.exitCode).toBe(0);
      expect(result.stdout).toContain('Tool: Bash');
      expect(result.stdout).toContain('Command: ls -la');
      expect(result.stdout).toContain('Description: List files in directory');
    });

    it('should handle TodoWrite tool specially', async () => {
      const input = JSON.stringify({
        type: 'assistant',
        message: {
          id: 'test-id',
          type: 'message',
          role: 'assistant',
          model: 'claude-3',
          content: [{
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
          }],
          stop_reason: 'tool_use',
          stop_sequence: null,
          usage: {
            input_tokens: 30,
            output_tokens: 15
          },
          ttftMs: 200
        },
        session_id: 'test-session'
      });

      const result = await runCLI(input);
      expect(result.exitCode).toBe(0);
      expect(result.stdout).toContain('📝 Todo List:');
      expect(result.stdout).toContain('Test task');
      expect(result.stdout).toContain('Another task');
      expect(result.stdout).toContain('[HIGH]');
      expect(result.stdout).toContain('[MEDIUM]');
    });
  });

  describe('Non-JSON Input', () => {
    it('should pass through non-JSON text unchanged', async () => {
      const input = 'This is just plain text, not JSON';

      const result = await runCLI(input);
      expect(result.exitCode).toBe(0);
      expect(result.stdout).toContain('This is just plain text, not JSON');
    });

    it('should handle mixed JSON and non-JSON input', async () => {
      const jsonPart = JSON.stringify({
        type: 'assistant',
        message: {
          id: 'test-id',
          type: 'message',
          role: 'assistant',
          model: 'claude-3',
          content: [{ type: 'text', text: 'Hello' }],
          stop_reason: 'end_turn',
          stop_sequence: null,
          usage: { input_tokens: 5, output_tokens: 3 },
          ttftMs: 80
        },
        session_id: 'test-session'
      });
      const input = `Plain text before\n${jsonPart}\nPlain text after`;

      const result = await runCLI(input);
      expect(result.exitCode).toBe(0);
      expect(result.stdout).toContain('Hello');
      expect(result.stdout).toContain('assistant');
    });
  });

  describe('Slack Integration', () => {
    it('should show Slack config when environment variables are set', async () => {
      const input = JSON.stringify({
        type: 'system',
        subtype: 'init',
        session_id: 'test-session',
        tools: ['Bash'],
        mcp_servers: []
      });

      const result = await runCLI(input, {
        CCPRETTY_SLACK_TOKEN: 'test-token',
        CCPRETTY_SLACK_CHANNEL: '#test-channel'
      });

      expect(result.exitCode).toBe(0);
      expect(result.stderr).toContain('Slack integration active:');
      expect(result.stderr).toContain('Channel: #test-channel');
      expect(result.stderr).toContain('Thread: New thread will be created');
    });

    it('should not show Slack config when environment variables are missing', async () => {
      const input = JSON.stringify({
        type: 'system',
        subtype: 'init',
        session_id: 'test-session',
        tools: ['Bash'],
        mcp_servers: []
      });

      const result = await runCLI(input);
      expect(result.exitCode).toBe(0);
      expect(result.stderr).not.toContain('Slack integration active:');
    });

    it('should handle invalid Slack token gracefully', async () => {
      const input = JSON.stringify({
        type: 'result',
        subtype: 'success',
        is_error: false,
        result: 'Test completed',
        duration_ms: 1000,
        duration_api_ms: 500,
        num_turns: 1,
        cost_usd: 0.001
      });

      const result = await runCLI(input, {
        CCPRETTY_SLACK_TOKEN: 'invalid-token',
        CCPRETTY_SLACK_CHANNEL: '#test-channel'
      });

      expect(result.exitCode).toBe(0);
      expect(result.stdout).toContain('✅ Task Completed');
      expect(result.stderr).toContain('Slack authentication failed: invalid_auth');
    });
  });

  describe('Error Handling', () => {
    it('should handle malformed JSON gracefully', async () => {
      const input = '{"invalid": json, "missing": "quotes"}';

      const result = await runCLI(input);
      expect(result.exitCode).toBe(0);
      // Should output the original text when JSON parsing fails
      expect(result.stdout).toContain('{"invalid": json, "missing": "quotes"}');
    });

    it('should handle empty input', async () => {
      const result = await runCLI('');
      expect(result.exitCode).toBe(0);
      expect(result.stdout).toBe('');
    });

    it('should handle very large input', async () => {
      const largeText = 'a'.repeat(10000);
      const input = JSON.stringify({
        type: 'assistant',
        message: {
          id: 'large-id',
          type: 'message',
          role: 'assistant',
          model: 'claude-3',
          content: [{ type: 'text', text: largeText }],
          stop_reason: 'end_turn',
          stop_sequence: null,
          usage: { input_tokens: 1000, output_tokens: 500 },
          ttftMs: 300
        },
        session_id: 'test-session'
      });

      const result = await runCLI(input);
      expect(result.exitCode).toBe(0);
      expect(result.stdout).toContain('assistant');
    });
  });

  describe('Multiple Messages', () => {
    it('should handle multiple JSON objects in sequence', async () => {
      const msg1 = JSON.stringify({
        type: 'system',
        subtype: 'init',
        session_id: 'test-session',
        tools: ['Bash'],
        mcp_servers: []
      });
      
      const msg2 = JSON.stringify({
        type: 'assistant',
        message: {
          id: 'test-id',
          type: 'message',
          role: 'assistant',
          model: 'claude-3',
          content: [{ type: 'text', text: 'Hello' }],
          stop_reason: 'end_turn',
          stop_sequence: null,
          usage: { input_tokens: 5, output_tokens: 3 },
          ttftMs: 80
        },
        session_id: 'test-session'
      });

      const input = `${msg1}\n${msg2}`;

      const result = await runCLI(input);
      expect(result.exitCode).toBe(0);
      expect(result.stdout).toContain('🚀 Session Initialized');
      expect(result.stdout).toContain('Hello');
      expect(result.stdout).toContain('assistant');
    });
  });
});