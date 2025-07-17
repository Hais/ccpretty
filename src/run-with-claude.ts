import { query } from '@anthropic-ai/claude-code';
import type { SDKOptions } from './models';
import { InputParser } from './input-parser';
// Removed MessageQueue and MessageReducer dependencies
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
  /** Timeout in milliseconds for Claude Code execution */
  timeout?: number;
  /** SDK options passed to Claude Code query() */
  sdkOptions?: SDKOptions;
}

export interface RunWithClaudeResult {
  /** Whether Claude Code completed successfully */
  success: boolean;
  /** Formatted output from ccpretty */
  formattedOutput: string;
  /** Any errors that occurred during processing */
  errors: string[];
  /** Final session statistics from result message */
  sessionStats?: {
    duration_ms: number;
    duration_api_ms: number;
    num_turns: number;
    total_cost_usd: number;
    is_error: boolean;
  };
}

/**
 * Run Claude Code with ccpretty formatting using the official SDK.
 * 
 * @param prompt - The prompt to send to Claude Code
 * @param options - Configuration options
 * @returns Promise resolving to execution result
 */
export async function runWithClaude(
  prompt: string,
  options: RunWithClaudeOptions = {}
): Promise<RunWithClaudeResult> {
  const {
    useQueue = false,
    slack,
    debug = false,
    timeout = 300000, // 5 minutes default
    sdkOptions = {}
  } = options;

  const result: RunWithClaudeResult = {
    success: false,
    formattedOutput: '',
    errors: []
  };

  if (debug) {
    console.log('Running Claude Code with SDK...');
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

    // Set up abort controller for timeout
    const abortController = new AbortController();
    const timeoutId = setTimeout(() => {
      abortController.abort();
    }, timeout);

    try {
      // Run Claude Code using the SDK
      const claudeQuery = query({
        prompt,
        abortController,
        options: {
          ...sdkOptions
        }
      });

      // Process messages with ccpretty
      const formattedOutput = await processWithCcprettySDK(
        claudeQuery,
        { useQueue, slack: !!slack, debug }
      );

      result.formattedOutput = formattedOutput;
      result.success = true;
      
      if (debug) {
        console.log('Claude Code SDK execution completed successfully');
      }

    } finally {
      clearTimeout(timeoutId);
    }

  } catch (error) {
    const errorMsg = `SDK execution failed: ${error}`;
    result.errors.push(errorMsg);
    if (debug) {
      console.error(errorMsg);
    }
  }

  return result;
}

/**
 * Process Claude Code SDK messages with ccpretty formatting
 */
async function processWithCcprettySDK(
  claudeQuery: AsyncGenerator<any>,
  options: { useQueue: boolean; slack: boolean; debug: boolean }
): Promise<string> {
  let formattedOutput = '';
  
  // Initialize components
  const terminalOutput = new TerminalOutput();
  let slackOutput: SlackOutput | null = null;
  let sessionStats: any = null;

  // Initialize Slack output if configured
  if (options.slack) {
    const slack = {
      token: process.env.CCPRETTY_SLACK_TOKEN!,
      channel: process.env.CCPRETTY_SLACK_CHANNEL!,
      threadTs: process.env.CCPRETTY_SLACK_THREAD_TS
    };
    slackOutput = new SlackOutput(slack);
  }

  try {
    // Process SDK messages
    for await (const message of claudeQuery) {
      try {
        // Store session stats from result messages
        if (message.type === 'result') {
          sessionStats = message;
        }

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
        terminalOutput.output(message);
        
        // Restore console
        console.log = originalLog;
        console.error = originalError;
        
        formattedOutput += capturedOutput;
        
        // Output to Slack if configured
        if (slackOutput) {
          await slackOutput.output(message);
        }
      } catch (error) {
        if (options.debug) {
          console.warn(`Failed to process message: ${error}`);
        }
      }
    }
  } catch (error) {
    if (options.debug) {
      console.warn(`Failed to process SDK messages: ${error}`);
    }
    throw error;
  }

  // Wait for Slack completion
  if (slackOutput) {
    await slackOutput.waitForCompletion();
  }

  return formattedOutput;
}

