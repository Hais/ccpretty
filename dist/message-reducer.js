"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.MessageReducer = void 0;
const formatters_1 = require("./formatters");
const models_1 = require("./models");
class MessageReducer {
    constructor() {
        this.lastContent = '';
    }
    /**
     * Reduce message groups into formatted output
     */
    reduceGroups(groups) {
        const results = [];
        for (const group of groups) {
            const processed = this.reduceGroup(group);
            if (processed && this.shouldOutput(processed.content)) {
                results.push(processed);
            }
        }
        return results;
    }
    /**
     * Reduce a single message group
     */
    reduceGroup(group) {
        switch (group.type) {
            case 'tool_pair':
                return this.reduceToolPair(group);
            case 'single':
                return this.reduceSingleMessage(group);
            case 'assistant_batch':
                return this.reduceAssistantBatch(group);
            default:
                return null;
        }
    }
    /**
     * Reduce a tool pair (tool_use + tool_result)
     */
    reduceToolPair(group) {
        const { toolPair } = group;
        if (!toolPair || !toolPair.toolResult) {
            // Fallback to single message if no result
            return this.reduceSingleMessage(group);
        }
        const duration = group.endTime - group.startTime;
        const toolUseEntry = toolPair.toolUse.logEntry;
        const toolResultEntry = toolPair.toolResult.logEntry;
        // Extract tool information
        const toolUse = toolUseEntry.message.content.find((c) => c.type === 'tool_use');
        const toolResult = toolResultEntry.message.content.find((c) => c.type === 'tool_result');
        const isError = toolResult?.is_error || false;
        const status = isError ? 'FAILED' : 'COMPLETED';
        const statusIcon = isError ? '❌' : '✅';
        // Format tool execution summary
        let content = this.formatToolHeader(toolPair.toolName, status, statusIcon, duration);
        // Add tool parameters
        if (toolUse?.input) {
            content += this.formatToolParameters(toolUse.input);
        }
        // Add result summary (truncated)
        if (toolResult?.content && !isError) {
            const resultText = typeof toolResult.content === 'string'
                ? toolResult.content
                : JSON.stringify(toolResult.content);
            if (resultText.length > 200) {
                content += `\n\n📄 Result: ${resultText.substring(0, 197)}...`;
            }
            else if (resultText.trim()) {
                content += `\n\n📄 Result: ${resultText}`;
            }
        }
        // Add error details
        if (isError && toolResult?.content) {
            const errorText = typeof toolResult.content === 'string'
                ? toolResult.content
                : JSON.stringify(toolResult.content);
            content += `\n\n🚨 Error: ${errorText.substring(0, 300)}`;
        }
        return {
            content: this.wrapInBox(content, 'tool'),
            type: isError ? 'tool_failed' : 'tool_complete',
            originalCount: 2,
            duration
        };
    }
    /**
     * Reduce a single message
     */
    reduceSingleMessage(group) {
        const message = group.messages[0];
        const logEntry = message.logEntry;
        let content;
        // Check if this is an interrupted tool
        if ((0, models_1.isAssistantResponse)(logEntry)) {
            const assistantContent = logEntry.message?.content || [];
            const toolUse = assistantContent.find((c) => c.type === 'tool_use');
            if (toolUse) {
                // This is an interrupted tool - format specially
                const statusIcon = '⚠️';
                const toolName = toolUse.name;
                let interruptedContent = `${statusIcon} Tool: ${toolName} - INTERRUPTED`;
                // Add tool parameters
                if (toolUse.input) {
                    interruptedContent += this.formatToolParameters(toolUse.input);
                }
                interruptedContent += '\n\n🚫 Tool execution was interrupted by a new tool request';
                content = this.wrapInBox(interruptedContent, 'interrupted');
                return {
                    content,
                    type: 'tool_interrupted',
                    originalCount: 1
                };
            }
            else {
                content = (0, formatters_1.formatAssistantResponse)(logEntry);
            }
        }
        else if ((0, models_1.isUserResponse)(logEntry)) {
            content = (0, formatters_1.formatUserResponse)(logEntry);
        }
        else if ((0, models_1.isSystemResponse)(logEntry)) {
            content = (0, formatters_1.formatSystemResponse)(logEntry);
        }
        else if (logEntry.type === 'result') {
            content = (0, formatters_1.formatResultResponse)(logEntry);
        }
        else {
            content = `Unknown message type: ${logEntry.type || 'undefined'}`;
        }
        return {
            content,
            type: 'single',
            originalCount: 1
        };
    }
    /**
     * Reduce a batch of assistant messages
     */
    reduceAssistantBatch(group) {
        // For now, just process each message separately
        // Could be enhanced to combine multiple assistant messages
        return this.reduceSingleMessage(group);
    }
    /**
     * Format tool header with status
     */
    formatToolHeader(toolName, status, icon, duration) {
        const durationStr = duration ? ` (${(duration / 1000).toFixed(2)}s)` : '';
        return `${icon} Tool: ${toolName} - ${status}${durationStr}`;
    }
    /**
     * Format tool parameters
     */
    formatToolParameters(input) {
        let params = '';
        if (input.command) {
            params += `\n🔧 Command: ${input.command}`;
        }
        if (input.file_path) {
            params += `\n📁 File: ${input.file_path}`;
        }
        if (input.pattern) {
            params += `\n🔍 Pattern: ${input.pattern}`;
        }
        if (input.description) {
            params += `\n📝 Description: ${input.description}`;
        }
        // Add other common parameters
        if (input.limit) {
            params += `\n📊 Limit: ${input.limit}`;
        }
        if (input.offset) {
            params += `\n📍 Offset: ${input.offset}`;
        }
        return params;
    }
    /**
     * Wrap content in a simple box
     */
    wrapInBox(content, type) {
        const lines = content.split('\n');
        const maxLength = Math.max(...lines.map(line => line.length), type.length + 4);
        const width = Math.min(maxLength + 4, 80);
        const border = '═'.repeat(width - 2);
        const header = `╔${'═'.repeat((width - type.length - 4) / 2)} ${type} ${'═'.repeat((width - type.length - 4) / 2)}╗`;
        const footer = `╚${border}╝`;
        const wrappedLines = lines.map(line => {
            const padding = ' '.repeat(Math.max(0, width - line.length - 4));
            return `║  ${line}${padding}  ║`;
        });
        return [header, '║' + ' '.repeat(width - 2) + '║', ...wrappedLines, '║' + ' '.repeat(width - 2) + '║', footer].join('\n');
    }
    /**
     * Check if content should be output (deduplication)
     */
    shouldOutput(content) {
        // Simple deduplication - skip if identical to last content
        if (content === this.lastContent) {
            return false;
        }
        this.lastContent = content;
        return true;
    }
    /**
     * Reset deduplication state
     */
    reset() {
        this.lastContent = '';
    }
}
exports.MessageReducer = MessageReducer;
