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
Object.defineProperty(exports, "__esModule", { value: true });
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
            if (!messageReducer)
                return;
            const reducedMessages = messageReducer.reduceGroups(groups);
            for (const reduced of reducedMessages) {
                // Output to terminal
                terminalOutput.output(reduced);
                // Output to Slack if configured
                if (slackOutput) {
                    await slackOutput.output(reduced);
                }
            }
        });
        messageQueue.start();
    }
    const rl = readline.createInterface({
        input: process.stdin,
        output: process.stdout,
        terminal: false
    });
    rl.on('line', async (line) => {
        // Parse line for JSON messages
        const messages = inputParser.parseLine(line);
        for (const message of messages) {
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
    });
    rl.on('close', async () => {
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
    });
}
main();
