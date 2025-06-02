#!/usr/bin/env node

import * as readline from 'readline';
import { extractJson } from '@axync/extract-json';
import pc from 'picocolors';
import boxen from 'boxen';
import { 
  AssistantResponse, 
  UserResponse, 
  SystemResponse,
  isAssistantResponse, 
  isUserResponse, 
  isSystemResponse,
  isSystemInitMessage,
  isTextContent, 
  isToolUseContent, 
  isToolResultContent 
} from './models';

interface LogEntry {
  type?: string;
  [key: string]: any;
}

function formatLogEntry(data: LogEntry): string {
  // Handle assistant responses with special formatting
  if (isAssistantResponse(data)) {
    return formatAssistantResponse(data as AssistantResponse);
  }
  
  // Handle user responses
  if (isUserResponse(data)) {
    return formatUserResponse(data as UserResponse);
  }
  
  // Handle system responses
  if (isSystemResponse(data)) {
    return formatSystemResponse(data as SystemResponse);
  }
  
  // Handle result responses
  if (data.type === 'result') {
    return formatResultResponse(data);
  }
  
  // Default: just return the type
  const type = data.type || 'unknown';
  return type;
}

function formatAssistantResponse(response: AssistantResponse): string {
  const msg = response.message;
  const lines: string[] = [];
  
  // Process content
  for (const content of msg.content) {
    if (isTextContent(content)) {
      lines.push(pc.white(content.text));
    } else if (isToolUseContent(content)) {
      if (content.name === 'TodoWrite' && content.input.todos) {
        // Special formatting for TodoWrite
        lines.push(`${pc.yellow('Tool:')} ${content.name}`);
        lines.push('');
        lines.push(pc.bold('📝 Todo List:'));
        
        for (const todo of content.input.todos) {
          const statusIcon = todo.status === 'completed' ? '✅' : 
                           todo.status === 'in_progress' ? '🔄' : '⏳';
          const priorityColor = todo.priority === 'high' ? pc.red : 
                              todo.priority === 'medium' ? pc.yellow : pc.green;
          
          lines.push(
            `  ${statusIcon} ${priorityColor(`[${todo.priority.toUpperCase()}]`)} ${todo.content}`
          );
        }
      } else {
        // Default tool formatting
        lines.push(
          `${pc.yellow('Tool:')} ${content.name}\n` +
          `${pc.dim('Command:')} ${content.input.command || 'N/A'}\n` +
          `${pc.dim('Description:')} ${content.input.description || 'N/A'}`
        );
      }
    }
  }
  
  // Add metadata
  const metadata = pc.dim(`[${msg.model} | ${msg.usage.output_tokens} tokens | ${msg.ttftMs}ms]`);
  lines.push(metadata);
  
  // Wrap everything in a box with "assistant" as the title
  return boxen(lines.join('\n'), {
    padding: 1,
    borderColor: 'cyan',
    borderStyle: 'round',
    title: 'assistant',
    titleAlignment: 'center'
  });
}

function formatUserResponse(response: UserResponse): string {
  const msg = response.message;
  const lines: string[] = [];
  
  // Process content
  for (const content of msg.content) {
    if (isTextContent(content)) {
      lines.push(pc.white(content.text));
    } else if (isToolResultContent(content)) {
      const isError = content.is_error || false;
      const icon = isError ? '❌' : '✅';
      
      lines.push(
        `${pc.bold(`${icon} Tool Result`)}\n` +
        `${pc.dim('Tool ID:')} ${content.tool_use_id}\n` +
        `${pc.dim('Result:')} ${content.content}`
      );
    }
  }
  
  // Wrap everything in a box with "user" as the title
  return boxen(lines.join('\n'), {
    padding: 1,
    borderColor: 'green',
    borderStyle: 'round',
    title: 'user',
    titleAlignment: 'center'
  });
}

function formatSystemResponse(response: SystemResponse): string {
  const lines: string[] = [];
  
  if (isSystemInitMessage(response)) {
    lines.push(`${pc.bold('🚀 Session Initialized')}`);
    lines.push(`${pc.dim('Session ID:')} ${response.session_id}`);
    lines.push(`${pc.dim('Tools:')} ${response.tools.join(', ')}`);
    if (response.mcp_servers.length > 0) {
      lines.push(`${pc.dim('MCP Servers:')} ${response.mcp_servers.join(', ')}`);
    }
  } else {
    // Generic system message
    lines.push(`${pc.bold('System Event:')} ${response.subtype}`);
    lines.push(`${pc.dim('Session ID:')} ${response.session_id}`);
  }
  
  // Wrap in a box with "system" title
  return boxen(lines.join('\n'), {
    padding: 1,
    borderColor: 'magenta',
    borderStyle: 'round',
    title: 'system',
    titleAlignment: 'center'
  });
}

function formatResultResponse(data: any): string {
  const lines: string[] = [];
  const isSuccess = data.subtype === 'success' && !data.is_error;
  const icon = isSuccess ? '✅' : '❌';
  const borderColor = isSuccess ? 'green' : 'red';
  
  lines.push(`${pc.bold(`${icon} Task ${data.subtype === 'success' ? 'Completed' : 'Failed'}`)}`);
  
  if (data.result) {
    lines.push('');
    lines.push(data.result);
  }
  
  lines.push('');
  lines.push(pc.dim('─'.repeat(50)));
  lines.push(`${pc.dim('Duration:')} ${(data.duration_ms / 1000).toFixed(2)}s`);
  lines.push(`${pc.dim('API Time:')} ${(data.duration_api_ms / 1000).toFixed(2)}s`);
  lines.push(`${pc.dim('Turns:')} ${data.num_turns}`);
  lines.push(`${pc.dim('Cost:')} $${data.cost_usd.toFixed(4)} USD`);
  
  // Wrap in a box with "result" title
  return boxen(lines.join('\n'), {
    padding: 1,
    borderColor: borderColor,
    borderStyle: 'double',
    title: 'result',
    titleAlignment: 'center'
  });
}

async function main() {
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
    terminal: false
  });

  let buffer = '';
  let braceCount = 0;
  let inString = false;
  let escapeNext = false;

  rl.on('line', async (line: string) => {
    // If this line starts with a timestamp and we have a buffer, process it first
    if (buffer && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d+Z/.test(line)) {
      await processJsonBuffer(buffer);
      buffer = '';
      braceCount = 0;
      inString = false;
      escapeNext = false;
    }

    // Add line to buffer
    if (buffer) {
      buffer += '\n' + line;
    } else {
      buffer = line;
    }

    // Count braces to track JSON structure, accounting for strings
    for (let i = 0; i < line.length; i++) {
      const char = line[i];
      
      if (escapeNext) {
        escapeNext = false;
        continue;
      }
      
      if (char === '\\') {
        escapeNext = true;
        continue;
      }
      
      if (char === '"' && !escapeNext) {
        inString = !inString;
        continue;
      }
      
      if (!inString) {
        if (char === '{') {
          braceCount++;
        } else if (char === '}') {
          braceCount--;
          
          // If we've closed all braces, we have a complete JSON object
          if (braceCount === 0) {
            await processJsonBuffer(buffer);
            buffer = '';
            inString = false;
            escapeNext = false;
          }
        }
      }
    }
  });

  rl.on('close', async () => {
    // Process any remaining buffer
    if (buffer) {
      await processJsonBuffer(buffer);
    }
    process.exit(0);
  });

  async function processJsonBuffer(text: string) {
    try {
      // Extract JSON objects from the buffer
      const jsonObjects = await extractJson(text);
      
      if (jsonObjects.length === 0) {
        console.log(text);
        return;
      }
      
      // Format and print each JSON object found
      for (const obj of jsonObjects) {
        console.log(formatLogEntry(obj as LogEntry));
      }
    } catch (error) {
      // If extraction fails, just print the text
      console.log(text);
    }
  }
}

main();