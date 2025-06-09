#!/usr/bin/env node

import * as readline from 'readline';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { config as loadEnv } from 'dotenv';
import { InputParser } from './input-parser';
import { MessageQueue } from './message-queue';
import { MessageReducer } from './message-reducer';
import { TerminalOutput } from './terminal-output';
import { SlackOutput } from './slack-output';
import { 
  isAssistantResponse, 
  isUserResponse, 
  isSystemResponse
} from './models';

// Export public API
export { runWithClaude, RunWithClaudeOptions, RunWithClaudeResult } from './run-with-claude';
export * from './models';
export * from './formatters';
export * from './slack';
export * from './message-queue';
export * from './message-reducer';

interface CliConfig {
  slack?: {
    token: string;
    channel: string;
    threadTs?: string;
  };
  useQueue: boolean;
  resumeSlackThread: boolean;
}

// Load environment variables from .env files
function loadEnvironmentVariables() {
  // Load .env file from current working directory
  loadEnv({ path: path.join(process.cwd(), '.env') });
  
  // Also try to load from user's home directory for global config
  const globalEnvPath = path.join(os.homedir(), '.ccpretty.env');
  if (fs.existsSync(globalEnvPath)) {
    loadEnv({ path: globalEnvPath, override: false });
  }
}

// Get configuration from environment variables and arguments
function getConfig(): CliConfig {
  // Load environment variables first
  loadEnvironmentVariables();
  
  const resumeSlackThread = process.argv.includes('--resume-slack-thread');
  const useQueue = process.argv.includes('--queue');
  
  const token = process.env.CCPRETTY_SLACK_TOKEN;
  const channel = process.env.CCPRETTY_SLACK_CHANNEL;
  let threadTs = process.env.CCPRETTY_SLACK_THREAD_TS;
  
  // Load saved thread if resuming
  if (resumeSlackThread && !threadTs) {
    threadTs = readSlackThreadFromFile();
  }
  
  return {
    slack: token && channel ? { token, channel, threadTs } : undefined,
    useQueue,
    resumeSlackThread
  };
}

// Read Slack thread timestamp from temporary file
function readSlackThreadFromFile(): string | undefined {
  try {
    const filePath = path.join(os.homedir(), '.ccpretty_slack_ts');
    if (fs.existsSync(filePath)) {
      const content = fs.readFileSync(filePath, 'utf8').trim();
      return content || undefined;
    }
  } catch (error) {
    // Silently ignore file read errors
  }
  return undefined;
}


async function main() {
  const config = getConfig();
  const { slack, useQueue, resumeSlackThread } = config;
  
  // Initialize components
  const inputParser = new InputParser();
  const terminalOutput = new TerminalOutput();
  let slackOutput: SlackOutput | null = null;
  let messageQueue: MessageQueue | null = null;
  let messageReducer: MessageReducer | null = null;
  
  // Initialize Slack output if configured
  if (slack) {
    // Load saved thread if resuming
    if (resumeSlackThread && !slack.threadTs) {
      const savedThreadTs = await SlackOutput.loadSavedThreadTs();
      if (savedThreadTs) {
        slack.threadTs = savedThreadTs;
      }
    }
    
    slackOutput = new SlackOutput(slack);
    
    // Print Slack configuration confirmation
    console.error('Slack integration active:');
    console.error(`  Channel: ${slack.channel}`);
    console.error(`  Thread: ${slack.threadTs ? slack.threadTs : 'New thread will be created'}`);
  }
  
  // Initialize queue-based processing if enabled
  if (useQueue) {
    console.error('Queue-based processing enabled');
    
    messageReducer = new MessageReducer();
    messageQueue = new MessageQueue(async (groups) => {
      try {
        if (!messageReducer) return;
        
        if (process.env.CCPRETTY_DEBUG) {
          console.error(`[MessageQueue] Processing ${groups.length} groups`);
        }
        
        const reducedMessages = messageReducer.reduceGroups(groups);
        
        if (process.env.CCPRETTY_DEBUG) {
          console.error(`[MessageQueue] Reduced to ${reducedMessages.length} messages`);
        }
        
        for (let i = 0; i < reducedMessages.length; i++) {
          const reduced = reducedMessages[i];
          try {
            if (process.env.CCPRETTY_DEBUG) {
              console.error(`[MessageQueue] Processing message ${i + 1}/${reducedMessages.length}: ${reduced.message.type} (${reduced.metadata.type})`);
            }
            
            // Output to terminal
            terminalOutput.output(reduced);
            
            // Output to Slack if configured
            if (slackOutput) {
              if (process.env.CCPRETTY_DEBUG) {
                console.error(`[MessageQueue] Sending to Slack: ${reduced.message.type} (${reduced.metadata.type})`);
              }
              await slackOutput.output(reduced);
              if (process.env.CCPRETTY_DEBUG) {
                console.error(`[MessageQueue] Slack processing complete for message ${i + 1}`);
              }
            }
          } catch (error) {
            // Log message output errors but continue
            console.error(`Error outputting message ${i + 1}/${reducedMessages.length}:`, error);
            if (process.env.CCPRETTY_DEBUG) {
              console.error('Problematic reduced message:', JSON.stringify(reduced, null, 2));
            }
          }
        }
        
        if (process.env.CCPRETTY_DEBUG) {
          console.error(`[MessageQueue] Completed processing ${groups.length} groups`);
        }
      } catch (error) {
        // Log queue processing errors but continue
        console.error('Error processing message queue:', error);
        if (process.env.CCPRETTY_DEBUG) {
          console.error('Problematic groups:', JSON.stringify(groups, null, 2));
        }
      }
    });
    
    messageQueue.start();
  }

  // Handle process termination signals
  const handleTermination = async (signal: string) => {
    console.error(`\nReceived ${signal}, cleaning up...`);
    try {
      if (messageQueue) {
        messageQueue.stop();
      }
      if (slackOutput) {
        await slackOutput.waitForCompletion();
      }
      process.exit(0);
    } catch (error) {
      console.error('Error during signal cleanup:', error);
      process.exit(1);
    }
  };

  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
    terminal: false
  });

  // Add a timeout to detect if Claude Code stops sending data
  let lastActivity = Date.now();
  let activityTimer: NodeJS.Timeout;
  
  const resetActivityTimer = () => {
    lastActivity = Date.now();
    if (activityTimer) {
      clearTimeout(activityTimer);
    }
    // Set a 30-second timeout for stdin activity
    activityTimer = setTimeout(() => {
      const inactiveTime = Date.now() - lastActivity;
      if (inactiveTime > 30000) {
        console.error(`No input received for ${Math.round(inactiveTime/1000)}s. Upstream process may have crashed.`);
        handleTermination('TIMEOUT');
      }
    }, 30000);
  };
  
  resetActivityTimer();

  rl.on('line', async (line: string) => {
    try {
      // Reset activity timer since we received input
      resetActivityTimer();
      
      // Parse line for JSON messages
      const messages = inputParser.parseLine(line);
      
      for (const message of messages) {
        try {
          if (useQueue && messageQueue) {
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
            
            // Output to terminal
            terminalOutput.output(reduced);
            
            // Output to Slack if configured
            if (slackOutput) {
              await slackOutput.output(reduced);
            }
          }
        } catch (error) {
          // Log message processing errors but continue
          console.error('Error processing message:', error);
          if (process.env.CCPRETTY_DEBUG) {
            console.error('Problematic message:', JSON.stringify(message, null, 2));
          }
        }
      }
    } catch (error) {
      // Log line parsing errors but continue
      console.error('Error parsing line:', error);
      if (process.env.CCPRETTY_DEBUG) {
        console.error('Problematic line:', line);
      }
    }
  });

  // Handle stdin end/close
  rl.on('close', async () => {
    try {
      // Stop queue processing if enabled
      if (messageQueue) {
        // Give the queue a moment to process any final messages
        await new Promise(resolve => setTimeout(resolve, 1000));
        messageQueue.stop();
      }
      
      // Wait for all Slack messages to be sent before exiting
      if (slackOutput) {
        const pendingCount = slackOutput.getPendingCount();
        if (pendingCount > 0) {
          console.error(`Waiting for ${pendingCount} Slack messages to be sent...`);
        }
        await slackOutput.waitForCompletion();
      }
      
      process.exit(0);
    } catch (error) {
      console.error('Error during cleanup:', error);
      process.exit(1);
    }
  });

  process.on('SIGINT', () => handleTermination('SIGINT'));
  process.on('SIGTERM', () => handleTermination('SIGTERM'));
  
  // Handle stdin errors (like when Claude Code crashes)
  process.stdin.on('error', (error) => {
    console.error('Stdin error (upstream process may have crashed):', error);
    handleTermination('STDIN_ERROR');
  });
  
  // Handle unexpected process exit
  process.on('disconnect', () => {
    console.error('Process disconnected (upstream process may have crashed)');
    handleTermination('DISCONNECT');
  });
}

main().catch((error) => {
  console.error('Fatal error in ccpretty:', error);
  process.exit(1);
});