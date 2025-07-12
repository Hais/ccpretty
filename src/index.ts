#!/usr/bin/env node

import * as readline from 'readline';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { config as loadEnv } from 'dotenv';
import { InputParser } from './input-parser';
import { TerminalOutput } from './terminal-output';
import { SlackOutput } from './slack-output';
import { 
  isAssistantResponse, 
  isUserResponse, 
  isSystemResponse
} from './models';

// Export public API - runWithClaude temporarily disabled due to dependencies
export * from './models';
export * from './formatters';
export * from './slack';

interface CliConfig {
  slack?: {
    token: string;
    channel: string;
    threadTs?: string;
  };
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
  
  const token = process.env.CCPRETTY_SLACK_TOKEN;
  const channel = process.env.CCPRETTY_SLACK_CHANNEL;
  let threadTs = process.env.CCPRETTY_SLACK_THREAD_TS;
  
  // Load saved thread if resuming
  if (resumeSlackThread && !threadTs) {
    threadTs = readSlackThreadFromFile();
  }
  
  return {
    slack: token && channel ? { token, channel, threadTs } : undefined,
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
  const { slack, resumeSlackThread } = config;
  
  // Initialize components
  const inputParser = new InputParser();
  const terminalOutput = new TerminalOutput();
  let slackOutput: SlackOutput | null = null;
  
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

  // Handle process termination signals
  const handleTermination = async (signal: string) => {
    console.error(`\nReceived ${signal}, cleaning up...`);
    try {
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
            // Output to terminal
            terminalOutput.output(message);
            
            // Output to Slack if configured
            if (slackOutput) {
              await slackOutput.output(message);
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