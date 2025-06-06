import pc from 'picocolors';
import boxen from 'boxen';
import {
  AssistantResponse,
  UserResponse,
  SystemResponse,
  isSystemInitMessage,
  isTextContent,
  isToolUseContent,
  isToolResultContent,
} from './models';

// Trim file path to be relative to current working directory if possible
export function trimFilePath(filePath: string): string {
  try {
    const cwd = process.cwd();
    if (filePath.startsWith(cwd)) {
      // Remove the CWD and leading slash
      const relativePath = filePath.substring(cwd.length).replace(/^\/+/, '');
      return relativePath || './';
    }
    return filePath;
  } catch (error) {
    return filePath;
  }
}

export function formatAssistantResponse(response: AssistantResponse): string {
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
        let toolInfo = `${pc.yellow('Tool:')} ${content.name}`;
        
        // Add file path if present
        if (content.input.file_path) {
          const trimmedPath = trimFilePath(content.input.file_path);
          toolInfo += `\n${pc.dim('File:')} ${trimmedPath}`;
        }
        
        // Add other parameters
        if (content.input.command) {
          toolInfo += `\n${pc.dim('Command:')} ${content.input.command}`;
        } else if (!content.input.file_path) {
          toolInfo += `\n${pc.dim('Command:')} N/A`;
        }
        
        if (content.input.description) {
          toolInfo += `\n${pc.dim('Description:')} ${content.input.description}`;
        } else if (!content.input.file_path) {
          toolInfo += `\n${pc.dim('Description:')} N/A`;
        }
        
        // Add other relevant parameters
        if (content.input.pattern) {
          toolInfo += `\n${pc.dim('Pattern:')} ${content.input.pattern}`;
        }
        if (content.input.limit && typeof content.input.limit === 'number') {
          toolInfo += `\n${pc.dim('Limit:')} ${content.input.limit} lines`;
        }
        if (content.input.offset && typeof content.input.offset === 'number') {
          toolInfo += `\n${pc.dim('Offset:')} ${content.input.offset}`;
        }
        
        lines.push(toolInfo);
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

export function formatUserResponse(response: UserResponse): string {
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

export function formatSystemResponse(response: SystemResponse): string {
  const lines: string[] = [];
  
  if (isSystemInitMessage(response)) {
    // Check for custom environment variables
    const customTitle = process.env.CCPRETTY_TITLE;
    const customDescription = process.env.CCPRETTY_DESCRIPTION;
    const customUrl = process.env.CCPRETTY_URL;
    
    if (customTitle || customDescription || customUrl) {
      // Use custom format
      if (customTitle) {
        lines.push(`${pc.bold(`🚀 ${customTitle}`)}`);
      }
      if (customDescription) {
        lines.push(`${pc.dim(customDescription)}`);
      }
      if (customUrl) {
        lines.push(`${pc.dim('URL:')} ${customUrl}`);
      }
      lines.push(`${pc.dim('Session ID:')} ${response.session_id}`);
    } else {
      // Use default format without tools
      lines.push(`${pc.bold('🚀 Session Initialized')}`);
      lines.push(`${pc.dim('Session ID:')} ${response.session_id}`);
    }
    
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

export function formatResultResponse(data: any): string {
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

export function formatUnknownResponse(data: any): string {
  const lines: string[] = [];
  const type = data.type || 'unknown';
  
  lines.push(`${pc.bold(`⚠️  Unknown Event Type: ${type}`)}`);
  lines.push('');
  lines.push(pc.dim('Full event details:'));
  lines.push('');
  
  // Pretty print the JSON with indentation
  try {
    const jsonStr = JSON.stringify(data, null, 2);
    // Add syntax highlighting to JSON
    const highlighted = jsonStr
      .replace(/"([^"]+)":/g, pc.cyan('"$1":')) // Keys
      .replace(/: "([^"]+)"/g, ': ' + pc.green('"$1"')) // String values
      .replace(/: (\d+)/g, ': ' + pc.yellow('$1')) // Numbers
      .replace(/: (true|false)/g, ': ' + pc.magenta('$1')) // Booleans
      .replace(/: null/g, ': ' + pc.gray('null')); // Null
    
    lines.push(highlighted);
  } catch (error) {
    // Fallback to simple stringification
    lines.push(String(data));
  }
  
  // Wrap in a box with warning color
  return boxen(lines.join('\n'), {
    padding: 1,
    borderColor: 'yellow',
    borderStyle: 'round',
    title: `unknown: ${type}`,
    titleAlignment: 'center'
  });
}