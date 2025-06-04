"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.trimFilePath = trimFilePath;
exports.formatAssistantResponse = formatAssistantResponse;
exports.formatUserResponse = formatUserResponse;
exports.formatSystemResponse = formatSystemResponse;
exports.formatResultResponse = formatResultResponse;
const picocolors_1 = __importDefault(require("picocolors"));
const boxen_1 = __importDefault(require("boxen"));
const models_1 = require("./models");
// Trim file path to be relative to current working directory if possible
function trimFilePath(filePath) {
    try {
        const cwd = process.cwd();
        if (filePath.startsWith(cwd)) {
            // Remove the CWD and leading slash
            const relativePath = filePath.substring(cwd.length).replace(/^\/+/, '');
            return relativePath || './';
        }
        return filePath;
    }
    catch (error) {
        return filePath;
    }
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
                let toolInfo = `${picocolors_1.default.yellow('Tool:')} ${content.name}`;
                // Add file path if present
                if (content.input.file_path) {
                    const trimmedPath = trimFilePath(content.input.file_path);
                    toolInfo += `\n${picocolors_1.default.dim('File:')} ${trimmedPath}`;
                }
                // Add other parameters
                if (content.input.command) {
                    toolInfo += `\n${picocolors_1.default.dim('Command:')} ${content.input.command}`;
                }
                else if (!content.input.file_path) {
                    toolInfo += `\n${picocolors_1.default.dim('Command:')} N/A`;
                }
                if (content.input.description) {
                    toolInfo += `\n${picocolors_1.default.dim('Description:')} ${content.input.description}`;
                }
                else if (!content.input.file_path) {
                    toolInfo += `\n${picocolors_1.default.dim('Description:')} N/A`;
                }
                // Add other relevant parameters
                if (content.input.pattern) {
                    toolInfo += `\n${picocolors_1.default.dim('Pattern:')} ${content.input.pattern}`;
                }
                if (content.input.limit && typeof content.input.limit === 'number') {
                    toolInfo += `\n${picocolors_1.default.dim('Limit:')} ${content.input.limit} lines`;
                }
                if (content.input.offset && typeof content.input.offset === 'number') {
                    toolInfo += `\n${picocolors_1.default.dim('Offset:')} ${content.input.offset}`;
                }
                lines.push(toolInfo);
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
