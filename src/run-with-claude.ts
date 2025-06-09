import { spawn, SpawnOptions } from 'child_process';
import { createWriteStream, promises as fs } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { InputParser } from './input-parser';
import { MessageQueue, MessageGroup } from './message-queue';
import { MessageReducer } from './message-reducer';
import { TerminalOutput } from './terminal-output';
import { SlackOutput } from './slack-output';

export interface RunWithClaudeOptions {
  /** Enable queue-based processing with tool pairing and deduplication */
  useQueue?: boolean;
  /** Slack configuration for posting updates */
  slack?: {
    token: string;
    channel: string;
    threadTs?: string;
  };
  /** Debug mode - logs additional information */
  debug?: boolean;
  /** Custom temporary directory for logs */
  tempDir?: string;
  /** Timeout in milliseconds for Claude Code execution */
  timeout?: number;
}

export interface RunWithClaudeResult {
  /** Exit code from Claude Code process */
  exitCode: number;
  /** Whether Claude Code completed successfully */
  success: boolean;
  /** Raw output from Claude Code */
  rawOutput: string;
  /** Formatted output from ccpretty */
  formattedOutput: string;
  /** Path to temporary log file (for debugging) */
  tempLogPath?: string;
  /** Any errors that occurred during processing */
  errors: string[];
}

/**
 * Run Claude Code with ccpretty formatting and handle crashes gracefully.
 * This function mimics the behavior of run-with-claude.sh script.
 * 
 * @param command - Command array to execute (e.g., ['claude', 'ask', 'hello'])
 * @param options - Configuration options
 * @returns Promise resolving to execution result
 */
export async function runWithClaude(
  command: string[],
  options: RunWithClaudeOptions = {}
): Promise<RunWithClaudeResult> {
  const {
    useQueue = false,
    slack,
    debug = false,
    tempDir = tmpdir(),
    timeout = 300000 // 5 minutes default
  } = options;

  // Create temporary files
  const tempLogPath = join(tempDir, `claude-${Date.now()}.log`);
  const ccprettyLogPath = join(tempDir, `ccpretty-${Date.now()}.log`);
  
  const result: RunWithClaudeResult = {
    exitCode: 0,
    success: false,
    rawOutput: '',
    formattedOutput: '',
    tempLogPath: debug ? tempLogPath : undefined,
    errors: []
  };

  if (debug) {
    console.log('Running Claude Code with ccpretty...');
    console.log('Temp log:', tempLogPath);
    console.log('ccpretty log:', ccprettyLogPath);
  }

  try {
    // Set up Slack environment if provided
    if (slack) {
      process.env.CCPRETTY_SLACK_TOKEN = slack.token;
      process.env.CCPRETTY_SLACK_CHANNEL = slack.channel;
      if (slack.threadTs) {
        process.env.CCPRETTY_SLACK_THREAD_TS = slack.threadTs;
      }
    }

    // Run Claude Code and capture output
    const claudeResult = await runClaudeCode(command, tempLogPath, timeout);
    result.exitCode = claudeResult.exitCode;
    result.rawOutput = claudeResult.output;

    if (claudeResult.exitCode === 0) {
      if (debug) {
        console.log('Claude Code completed successfully');
      }
    } else {
      if (debug) {
        console.log(`Claude Code crashed with exit code: ${claudeResult.exitCode}`);
      }
      result.errors.push(`Claude Code exited with code ${claudeResult.exitCode}`);
    }

    // Process output with ccpretty
    try {
      const formattedOutput = await processWithCcpretty(
        result.rawOutput,
        { useQueue, slack: !!slack, debug }
      );
      result.formattedOutput = formattedOutput;
      result.success = claudeResult.exitCode === 0;
      
      if (debug) {
        console.log('ccpretty processing completed successfully');
      }
    } catch (ccprettyError) {
      const errorMsg = `ccpretty processing failed: ${ccprettyError}`;
      result.errors.push(errorMsg);
      if (debug) {
        console.error(errorMsg);
      }
    }

  } catch (error) {
    const errorMsg = `Execution failed: ${error}`;
    result.errors.push(errorMsg);
    if (debug) {
      console.error(errorMsg);
    }
  } finally {
    // Cleanup temporary files unless in debug mode
    if (!debug) {
      try {
        await fs.unlink(tempLogPath).catch(() => {});
        await fs.unlink(ccprettyLogPath).catch(() => {});
      } catch {
        // Ignore cleanup errors
      }
    }
  }

  return result;
}

/**
 * Execute Claude Code command and capture output
 */
async function runClaudeCode(
  command: string[],
  outputPath: string,
  timeout: number
): Promise<{ exitCode: number; output: string }> {
  return new Promise((resolve, reject) => {
    const outputStream = createWriteStream(outputPath);
    let output = '';

    const spawnOptions: SpawnOptions = {
      stdio: ['inherit', 'pipe', 'pipe']
    };

    const child = spawn(command[0], command.slice(1), spawnOptions);
    
    // Set up timeout
    const timeoutId = setTimeout(() => {
      child.kill('SIGTERM');
      reject(new Error(`Command timed out after ${timeout}ms`));
    }, timeout);

    // Capture stdout and stderr
    child.stdout?.on('data', (data) => {
      const chunk = data.toString();
      output += chunk;
      outputStream.write(chunk);
    });

    child.stderr?.on('data', (data) => {
      const chunk = data.toString();
      output += chunk;
      outputStream.write(chunk);
    });

    child.on('close', (code) => {
      clearTimeout(timeoutId);
      outputStream.end();
      resolve({ exitCode: code || 0, output });
    });

    child.on('error', (error) => {
      clearTimeout(timeoutId);
      outputStream.end();
      reject(error);
    });
  });
}

/**
 * Process Claude Code output with ccpretty formatting
 */
async function processWithCcpretty(
  input: string,
  options: { useQueue: boolean; slack: boolean; debug: boolean }
): Promise<string> {
  let formattedOutput = '';
  
  // Initialize components
  const inputParser = new InputParser();
  const terminalOutput = new TerminalOutput();
  let slackOutput: SlackOutput | null = null;
  let messageQueue: MessageQueue | null = null;
  let messageReducer: MessageReducer | null = null;

  // Initialize Slack output if configured
  if (options.slack) {
    const slack = {
      token: process.env.CCPRETTY_SLACK_TOKEN!,
      channel: process.env.CCPRETTY_SLACK_CHANNEL!,
      threadTs: process.env.CCPRETTY_SLACK_THREAD_TS
    };
    slackOutput = new SlackOutput(slack);
  }

  // Initialize queue-based processing if enabled
  if (options.useQueue) {
    messageReducer = new MessageReducer();
    messageQueue = new MessageQueue(async (groups: MessageGroup[]) => {
      try {
        if (!messageReducer) return;
        
        const reducedMessages = messageReducer.reduceGroups(groups);
        
        for (const reduced of reducedMessages) {
          try {
            // Capture terminal output
            const originalLog = console.log;
            const originalError = console.error;
            let capturedOutput = '';
            
            console.log = (...args) => {
              capturedOutput += args.join(' ') + '\n';
            };
            console.error = (...args) => {
              capturedOutput += args.join(' ') + '\n';
            };
            
            // Output to terminal
            terminalOutput.output(reduced);
            
            // Restore console
            console.log = originalLog;
            console.error = originalError;
            
            formattedOutput += capturedOutput;
            
            // Output to Slack if configured
            if (slackOutput) {
              await slackOutput.output(reduced);
            }
          } catch (error) {
            if (options.debug) {
              console.warn(`Failed to process message: ${error}`);
            }
          }
        }
      } catch (error) {
        if (options.debug) {
          console.warn(`Failed to process queue: ${error}`);
        }
      }
    });
    
    messageQueue.start();
  }

  // Process input line by line
  const lines = input.split('\n');
  for (const line of lines) {
    if (line.trim()) {
      try {
        const messages = inputParser.parseLine(line);
        
        for (const message of messages) {
          if (options.useQueue && messageQueue) {
            // Queue-based processing
            messageQueue.enqueue(message);
          } else {
            // Direct processing
            const reduced = {
              message,
              metadata: {
                type: 'single' as const,
                originalCount: 1
              }
            };
            
            // Capture terminal output
            const originalLog = console.log;
            const originalError = console.error;
            let capturedOutput = '';
            
            console.log = (...args) => {
              capturedOutput += args.join(' ') + '\n';
            };
            console.error = (...args) => {
              capturedOutput += args.join(' ') + '\n';
            };
            
            // Output to terminal
            terminalOutput.output(reduced);
            
            // Restore console
            console.log = originalLog;
            console.error = originalError;
            
            formattedOutput += capturedOutput;
            
            // Output to Slack if configured
            if (slackOutput) {
              await slackOutput.output(reduced);
            }
          }
        }
      } catch (error) {
        if (options.debug) {
          console.warn(`Failed to process line: ${error}`);
        }
      }
    }
  }

  // Finalize queue processing
  if (messageQueue) {
    // Give the queue a moment to process any final messages
    await new Promise(resolve => setTimeout(resolve, 1000));
    messageQueue.stop();
  }

  // Wait for Slack completion
  if (slackOutput) {
    await slackOutput.waitForCompletion();
  }

  return formattedOutput;
}