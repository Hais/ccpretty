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
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const readline = __importStar(require("readline"));
const extract_json_1 = require("@axync/extract-json");
const picocolors_1 = __importDefault(require("picocolors"));
const boxen_1 = __importDefault(require("boxen"));
const models_1 = require("./models");
function formatLogEntry(data) {
    // Handle assistant responses with special formatting
    if ((0, models_1.isAssistantResponse)(data)) {
        return formatAssistantResponse(data);
    }
    // Handle user responses
    if ((0, models_1.isUserResponse)(data)) {
        return formatUserResponse(data);
    }
    // Handle system responses
    if ((0, models_1.isSystemResponse)(data)) {
        return formatSystemResponse(data);
    }
    // Handle result responses
    if (data.type === 'result') {
        return formatResultResponse(data);
    }
    // Default: just return the type
    const type = data.type || 'unknown';
    return type;
}
function formatAssistantResponse(response) {
    const msg = response.message;
    const lines = [];
    // Process content
    for (const content of msg.content) {
        if ((0, models_1.isTextContent)(content)) {
            lines.push(picocolors_1.default.white(content.text));
        }
        else if ((0, models_1.isToolUseContent)(content)) {
            if (content.name === 'TodoWrite' && content.input.todos) {
                // Special formatting for TodoWrite
                lines.push(`${picocolors_1.default.yellow('Tool:')} ${content.name}`);
                lines.push('');
                lines.push(picocolors_1.default.bold('📝 Todo List:'));
                for (const todo of content.input.todos) {
                    const statusIcon = todo.status === 'completed' ? '✅' :
                        todo.status === 'in_progress' ? '🔄' : '⏳';
                    const priorityColor = todo.priority === 'high' ? picocolors_1.default.red :
                        todo.priority === 'medium' ? picocolors_1.default.yellow : picocolors_1.default.green;
                    lines.push(`  ${statusIcon} ${priorityColor(`[${todo.priority.toUpperCase()}]`)} ${todo.content}`);
                }
            }
            else {
                // Default tool formatting
                lines.push(`${picocolors_1.default.yellow('Tool:')} ${content.name}\n` +
                    `${picocolors_1.default.dim('Command:')} ${content.input.command || 'N/A'}\n` +
                    `${picocolors_1.default.dim('Description:')} ${content.input.description || 'N/A'}`);
            }
        }
    }
    // Add metadata
    const metadata = picocolors_1.default.dim(`[${msg.model} | ${msg.usage.output_tokens} tokens | ${msg.ttftMs}ms]`);
    lines.push(metadata);
    // Wrap everything in a box with "assistant" as the title
    return (0, boxen_1.default)(lines.join('\n'), {
        padding: 1,
        borderColor: 'cyan',
        borderStyle: 'round',
        title: 'assistant',
        titleAlignment: 'center'
    });
}
function formatUserResponse(response) {
    const msg = response.message;
    const lines = [];
    // Process content
    for (const content of msg.content) {
        if ((0, models_1.isTextContent)(content)) {
            lines.push(picocolors_1.default.white(content.text));
        }
        else if ((0, models_1.isToolResultContent)(content)) {
            const isError = content.is_error || false;
            const icon = isError ? '❌' : '✅';
            lines.push(`${picocolors_1.default.bold(`${icon} Tool Result`)}\n` +
                `${picocolors_1.default.dim('Tool ID:')} ${content.tool_use_id}\n` +
                `${picocolors_1.default.dim('Result:')} ${content.content}`);
        }
    }
    // Wrap everything in a box with "user" as the title
    return (0, boxen_1.default)(lines.join('\n'), {
        padding: 1,
        borderColor: 'green',
        borderStyle: 'round',
        title: 'user',
        titleAlignment: 'center'
    });
}
function formatSystemResponse(response) {
    const lines = [];
    if ((0, models_1.isSystemInitMessage)(response)) {
        lines.push(`${picocolors_1.default.bold('🚀 Session Initialized')}`);
        lines.push(`${picocolors_1.default.dim('Session ID:')} ${response.session_id}`);
        lines.push(`${picocolors_1.default.dim('Tools:')} ${response.tools.join(', ')}`);
        if (response.mcp_servers.length > 0) {
            lines.push(`${picocolors_1.default.dim('MCP Servers:')} ${response.mcp_servers.join(', ')}`);
        }
    }
    else {
        // Generic system message
        lines.push(`${picocolors_1.default.bold('System Event:')} ${response.subtype}`);
        lines.push(`${picocolors_1.default.dim('Session ID:')} ${response.session_id}`);
    }
    // Wrap in a box with "system" title
    return (0, boxen_1.default)(lines.join('\n'), {
        padding: 1,
        borderColor: 'magenta',
        borderStyle: 'round',
        title: 'system',
        titleAlignment: 'center'
    });
}
function formatResultResponse(data) {
    const lines = [];
    const isSuccess = data.subtype === 'success' && !data.is_error;
    const icon = isSuccess ? '✅' : '❌';
    const borderColor = isSuccess ? 'green' : 'red';
    lines.push(`${picocolors_1.default.bold(`${icon} Task ${data.subtype === 'success' ? 'Completed' : 'Failed'}`)}`);
    if (data.result) {
        lines.push('');
        lines.push(data.result);
    }
    lines.push('');
    lines.push(picocolors_1.default.dim('─'.repeat(50)));
    lines.push(`${picocolors_1.default.dim('Duration:')} ${(data.duration_ms / 1000).toFixed(2)}s`);
    lines.push(`${picocolors_1.default.dim('API Time:')} ${(data.duration_api_ms / 1000).toFixed(2)}s`);
    lines.push(`${picocolors_1.default.dim('Turns:')} ${data.num_turns}`);
    lines.push(`${picocolors_1.default.dim('Cost:')} $${data.cost_usd.toFixed(4)} USD`);
    // Wrap in a box with "result" title
    return (0, boxen_1.default)(lines.join('\n'), {
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
    rl.on('line', async (line) => {
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
        }
        else {
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
                }
                else if (char === '}') {
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
    async function processJsonBuffer(text) {
        try {
            // Extract JSON objects from the buffer
            const jsonObjects = await (0, extract_json_1.extractJson)(text);
            if (jsonObjects.length === 0) {
                console.log(text);
                return;
            }
            // Format and print each JSON object found
            for (const obj of jsonObjects) {
                console.log(formatLogEntry(obj));
            }
        }
        catch (error) {
            // If extraction fails, just print the text
            console.log(text);
        }
    }
}
main();
