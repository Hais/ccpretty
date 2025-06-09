#!/usr/bin/env node
"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
var __exportStar = (this && this.__exportStar) || function(m, exports) {
    for (var p in m) if (p !== "default" && !Object.prototype.hasOwnProperty.call(exports, p)) __createBinding(exports, m, p);
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.runWithClaude = void 0;
const readline = __importStar(require("readline"));
const fs = __importStar(require("fs"));
const path = __importStar(require("path"));
const os = __importStar(require("os"));
const dotenv_1 = require("dotenv");
const input_parser_1 = require("./input-parser");
const message_queue_1 = require("./message-queue");
const message_reducer_1 = require("./message-reducer");
const terminal_output_1 = require("./terminal-output");
const slack_output_1 = require("./slack-output");
// Export public API
var run_with_claude_1 = require("./run-with-claude");
Object.defineProperty(exports, "runWithClaude", { enumerable: true, get: function () { return run_with_claude_1.runWithClaude; } });
__exportStar(require("./models"), exports);
__exportStar(require("./formatters"), exports);
__exportStar(require("./slack"), exports);
__exportStar(require("./message-queue"), exports);
__exportStar(require("./message-reducer"), exports);
// Load environment variables from .env files
function loadEnvironmentVariables() {
    // Load .env file from current working directory
    (0, dotenv_1.config)({ path: path.join(process.cwd(), '.env') });
    // Also try to load from user's home directory for global config
    const globalEnvPath = path.join(os.homedir(), '.ccpretty.env');
    if (fs.existsSync(globalEnvPath)) {
        (0, dotenv_1.config)({ path: globalEnvPath, override: false });
    }
}
// Get configuration from environment variables and arguments
function getConfig() {
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
function readSlackThreadFromFile() {
    try {
        const filePath = path.join(os.homedir(), '.ccpretty_slack_ts');
        if (fs.existsSync(filePath)) {
            const content = fs.readFileSync(filePath, 'utf8').trim();
            return content || undefined;
        }
    }
    catch (error) {
        // Silently ignore file read errors
    }
    return undefined;
}
async function main() {
    const config = getConfig();
    const { slack, useQueue, resumeSlackThread } = config;
    // Initialize components
    const inputParser = new input_parser_1.InputParser();
    const terminalOutput = new terminal_output_1.TerminalOutput();
    let slackOutput = null;
    let messageQueue = null;
    let messageReducer = null;
    // Initialize Slack output if configured
    if (slack) {
        // Load saved thread if resuming
        if (resumeSlackThread && !slack.threadTs) {
            const savedThreadTs = await slack_output_1.SlackOutput.loadSavedThreadTs();
            if (savedThreadTs) {
                slack.threadTs = savedThreadTs;
            }
        }
        slackOutput = new slack_output_1.SlackOutput(slack);
        // Print Slack configuration confirmation
        console.error('Slack integration active:');
        console.error(`  Channel: ${slack.channel}`);
        console.error(`  Thread: ${slack.threadTs ? slack.threadTs : 'New thread will be created'}`);
    }
    // Initialize queue-based processing if enabled
    if (useQueue) {
        console.error('Queue-based processing enabled');
        messageReducer = new message_reducer_1.MessageReducer();
        messageQueue = new message_queue_1.MessageQueue(async (groups) => {
            try {
                if (!messageReducer)
                    return;
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
                    }
                    catch (error) {
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
            }
            catch (error) {
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
    const handleTermination = async (signal) => {
        console.error(`\nReceived ${signal}, cleaning up...`);
        try {
            if (messageQueue) {
                messageQueue.stop();
            }
            if (slackOutput) {
                await slackOutput.waitForCompletion();
            }
            process.exit(0);
        }
        catch (error) {
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
    let activityTimer;
    const resetActivityTimer = () => {
        lastActivity = Date.now();
        if (activityTimer) {
            clearTimeout(activityTimer);
        }
        // Set a 30-second timeout for stdin activity
        activityTimer = setTimeout(() => {
            const inactiveTime = Date.now() - lastActivity;
            if (inactiveTime > 30000) {
                console.error(`No input received for ${Math.round(inactiveTime / 1000)}s. Upstream process may have crashed.`);
                handleTermination('TIMEOUT');
            }
        }, 30000);
    };
    resetActivityTimer();
    rl.on('line', async (line) => {
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
                    }
                    else {
                        // Direct processing
                        const reduced = {
                            message,
                            metadata: {
                                type: 'single',
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
                }
                catch (error) {
                    // Log message processing errors but continue
                    console.error('Error processing message:', error);
                    if (process.env.CCPRETTY_DEBUG) {
                        console.error('Problematic message:', JSON.stringify(message, null, 2));
                    }
                }
            }
        }
        catch (error) {
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
        }
        catch (error) {
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
