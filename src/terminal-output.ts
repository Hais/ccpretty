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
import { formatSessionDisplay } from './github-utils';

export class TerminalOutput {
  /**
   * Format and output a message to the terminal
   */
  output(message: Message): void {
    try {
      const formatted = this.format(message);
      if (formatted) {
        console.log(formatted);
      }
    } catch (error) {
      console.error('Error formatting terminal output:', error);
      if (process.env.CCPRETTY_DEBUG) {
        console.error('Problematic message:', JSON.stringify(message, null, 2));
      }
    }
  }
  
  /**
   * Format a message for terminal display
   */
  private format(message: Message): string | null {
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
      
      const sessionDisplay = formatSessionDisplay(response.session_id);
      if (sessionDisplay.isLink) {
        output += `GitHub Actions Run: ${pico.cyan(sessionDisplay.text)}\n`;
      } else {
        output += `Session ID: ${sessionDisplay.text}\n`;
      }
      
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
      
      const sessionDisplay = formatSessionDisplay(response.session_id);
      if (sessionDisplay.isLink) {
        output += `GitHub Actions Run: ${pico.cyan(sessionDisplay.text)}`;
      } else {
        output += `Session ID: ${sessionDisplay.text}`;
      }
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
    
    // Add session statistics with null checks
    if (response.duration_ms != null) {
      output += `⏱️  Duration: ${(response.duration_ms / 1000).toFixed(2)}s\n`;
    }
    if (response.duration_api_ms != null) {
      output += `🔄 API Time: ${(response.duration_api_ms / 1000).toFixed(2)}s\n`;
    }
    if (response.num_turns != null) {
      output += `💬 Turns: ${response.num_turns}\n`;
    }
    if (response.total_cost_usd != null) {
      output += `💰 Cost: $${response.total_cost_usd.toFixed(4)}\n`;
    }
    
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
    // Check if this is a TodoWrite result by examining the content
    if (typeof content.content === 'string' && content.content.includes('Todos have been modified successfully')) {
      let output = `\n✅ TodoWrite Result:\n`;
      output += `${content.content}\n`;
      return output;
    }
    
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