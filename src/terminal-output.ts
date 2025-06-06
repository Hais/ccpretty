import boxen from 'boxen';
import pico from 'picocolors';
import { 
  Message,
  isAssistantResponse, 
  isUserResponse, 
  isSystemResponse,
  isTextContent,
  isToolUseContent,
  AssistantResponse,
  UserResponse,
  SystemResponse,
  ResultResponse
} from './models';
import { ReducedMessage } from './message-reducer';

export class TerminalOutput {
  /**
   * Format and output a reduced message to the terminal
   */
  output(reduced: ReducedMessage): void {
    const formatted = this.format(reduced);
    if (formatted) {
      console.log(formatted);
    }
  }
  
  /**
   * Format a reduced message for terminal display
   */
  private format(reduced: ReducedMessage): string | null {
    const { message, metadata } = reduced;
    
    // Handle tool executions with special formatting
    if (metadata.type === 'tool_complete' || metadata.type === 'tool_failed' || metadata.type === 'tool_interrupted') {
      return this.formatToolExecution(message, metadata);
    }
    
    // Handle regular messages
    if (isAssistantResponse(message)) {
      return this.formatAssistantResponse(message as AssistantResponse);
    } else if (isUserResponse(message)) {
      return this.formatUserResponse(message as UserResponse);
    } else if (isSystemResponse(message)) {
      return this.formatSystemResponse(message as SystemResponse);
    } else if (message.type === 'result') {
      return this.formatResultResponse(message as ResultResponse);
    }
    
    return null;
  }
  
  /**
   * Format assistant response
   */
  private formatAssistantResponse(response: AssistantResponse): string {
    const contents = response.message?.content || [];
    let output = '';
    
    for (const content of contents) {
      if (isTextContent(content)) {
        output += content.text + '\n';
      } else if (isToolUseContent(content)) {
        output += this.formatToolUse(content);
      }
    }
    
    return boxen(output.trim(), {
      padding: 1,
      borderColor: 'blue',
      title: '🤖 Assistant',
      titleAlignment: 'left'
    });
  }
  
  /**
   * Format user response
   */
  private formatUserResponse(response: UserResponse): string {
    const contents = response.message?.content || [];
    let output = '';
    
    for (const content of contents) {
      if (typeof content === 'string') {
        output += content + '\n';
      } else if (content.type === 'text') {
        output += content.text + '\n';
      } else if (content.type === 'tool_result') {
        output += this.formatToolResult(content);
      }
    }
    
    return boxen(output.trim(), {
      padding: 1,
      borderColor: 'green',
      title: '👤 User',
      titleAlignment: 'left'
    });
  }
  
  /**
   * Format system response
   */
  private formatSystemResponse(response: SystemResponse): string {
    let output = '';
    
    if (response.subtype === 'init' && 'tools' in response) {
      output += pico.bold('🚀 Session Initialized\n');
      output += `Session ID: ${response.session_id}\n`;
      
      if (response.tools?.length > 0) {
        output += '\nAvailable Tools:\n';
        for (const tool of response.tools) {
          output += `  • ${tool}\n`;
        }
      }
    } else if ('message' in response && response.message) {
      output += response.message;
    } else {
      output += `System Event: ${response.subtype}\n`;
      output += `Session ID: ${response.session_id}`;
    }
    
    const title = process.env.CCPRETTY_TITLE || 'Claude Code Session Started';
    
    return boxen(output.trim(), {
      padding: 1,
      borderColor: 'magenta',
      title: `📋 ${title}`,
      titleAlignment: 'left'
    });
  }
  
  /**
   * Format result response
   */
  private formatResultResponse(response: ResultResponse): string {
    let output = '';
    
    const isSuccess = response.subtype === 'success' && !response.is_error;
    const statusIcon = isSuccess ? '✅' : '❌';
    const status = isSuccess ? 'Success' : 'Failed';
    
    output += `${statusIcon} Task ${status}\n\n`;
    
    // Add the result text if it exists
    if (typeof response.result === 'string' && response.result.trim()) {
      output += `${response.result}\n\n`;
    }
    
    // Add session statistics
    output += `⏱️  Duration: ${(response.duration_ms / 1000).toFixed(2)}s\n`;
    output += `🔄 API Time: ${(response.duration_api_ms / 1000).toFixed(2)}s\n`;
    output += `💬 Turns: ${response.num_turns}\n`;
    output += `💰 Cost: $${response.cost_usd.toFixed(4)}\n`;
    
    return boxen(output.trim(), {
      padding: 1,
      borderColor: isSuccess ? 'green' : 'red',
      title: '📊 Session Result',
      titleAlignment: 'left'
    });
  }
  
  /**
   * Format tool use content
   */
  private formatToolUse(content: any): string {
    let output = `\n🔧 Using Tool: ${pico.yellow(content.name)}\n`;
    
    // Special formatting for TodoWrite
    if (content.name === 'TodoWrite' && content.input?.todos) {
      output += this.formatTodoList(content.input.todos);
    } else if (content.input) {
      // Format tool parameters
      if (content.input.command) {
        output += `  Command: ${content.input.command}\n`;
      }
      if (content.input.description) {
        output += `  Description: ${content.input.description}\n`;
      }
      if (content.input.file_path) {
        output += `  File: ${content.input.file_path}\n`;
      }
      if (content.input.pattern) {
        output += `  Pattern: ${content.input.pattern}\n`;
      }
    }
    
    return output;
  }
  
  /**
   * Format tool result content
   */
  private formatToolResult(content: any): string {
    let output = `\n📤 Tool Result (${content.tool_use_id}):\n`;
    
    if (content.is_error) {
      output += pico.red('❌ Error: ');
    }
    
    const resultText = typeof content.content === 'string' 
      ? content.content 
      : JSON.stringify(content.content, null, 2);
    
    // Truncate very long results
    if (resultText.length > 500) {
      output += resultText.substring(0, 497) + '...';
    } else {
      output += resultText;
    }
    
    return output;
  }
  
  /**
   * Format tool execution with metadata
   */
  private formatToolExecution(message: Message, metadata: any): string {
    const { toolName, toolStatus, duration, toolResult } = metadata;
    
    const statusIcon = toolStatus === 'completed' ? '✅' : 
                      toolStatus === 'failed' ? '❌' : '⚠️';
    const statusText = toolStatus.toUpperCase();
    const durationStr = duration ? ` (${(duration / 1000).toFixed(2)}s)` : '';
    
    let output = `${statusIcon} Tool: ${toolName} - ${statusText}${durationStr}\n`;
    
    // Add tool parameters if available
    if (isAssistantResponse(message)) {
      const assistantContent = (message as any).message?.content || [];
      const toolUse = assistantContent.find((c: any) => c.type === 'tool_use');
      
      if (toolUse?.input) {
        output += '\n📥 Parameters:\n';
        if (toolUse.input.command) {
          output += `  Command: ${toolUse.input.command}\n`;
        }
        if (toolUse.input.description) {
          output += `  Description: ${toolUse.input.description}\n`;
        }
        if (toolUse.input.file_path) {
          output += `  File: ${toolUse.input.file_path}\n`;
        }
        if (toolUse.input.pattern) {
          output += `  Pattern: ${toolUse.input.pattern}\n`;
        }
      }
    }
    
    // Add result summary
    if (toolResult && toolStatus === 'completed') {
      output += '\n📤 Result:\n';
      const resultText = typeof toolResult === 'string' 
        ? toolResult 
        : JSON.stringify(toolResult, null, 2);
      
      if (resultText.length > 300) {
        output += resultText.substring(0, 297) + '...';
      } else {
        output += resultText;
      }
    } else if (toolResult && toolStatus === 'failed') {
      output += '\n❌ Error:\n';
      const errorText = typeof toolResult === 'string' 
        ? toolResult 
        : JSON.stringify(toolResult, null, 2);
      output += pico.red(errorText.substring(0, 500));
    } else if (toolStatus === 'interrupted') {
      output += '\n⚠️ Tool execution was interrupted by a new request';
    }
    
    const borderColor = toolStatus === 'completed' ? 'green' : 
                       toolStatus === 'failed' ? 'red' : 'yellow';
    
    return boxen(output.trim(), {
      padding: 1,
      borderColor,
      title: '🔧 Tool Execution',
      titleAlignment: 'left'
    });
  }
  
  /**
   * Format todo list with status icons
   */
  private formatTodoList(todos: any[]): string {
    let output = '\n📋 Todo List:\n';
    
    for (const todo of todos) {
      const statusIcon = todo.status === 'completed' ? '✅' : 
                        todo.status === 'in_progress' ? '🔄' : '⬜';
      const priority = todo.priority === 'high' ? '🔴' : 
                      todo.priority === 'medium' ? '🟡' : '🟢';
      
      output += `  ${statusIcon} ${priority} ${todo.content}\n`;
    }
    
    return output;
  }
}