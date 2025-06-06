"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.MessageReducer = void 0;
const models_1 = require("./models");
class MessageReducer {
    constructor() {
        this.lastMessageHash = '';
    }
    /**
     * Reduce message groups into simplified messages with metadata
     */
    reduceGroups(groups) {
        const results = [];
        for (const group of groups) {
            const reduced = this.reduceGroup(group);
            if (reduced && this.shouldInclude(reduced)) {
                results.push(reduced);
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
        if (process.env.CCPRETTY_DEBUG) {
            console.error(`[MessageReducer] Reducing tool pair for tool: ${group.toolPair?.toolName || 'unknown'}`);
        }
        const { toolPair } = group;
        if (!toolPair || !toolPair.toolResult) {
            if (process.env.CCPRETTY_DEBUG) {
                console.error(`[MessageReducer] Incomplete tool pair, falling back to single message`);
            }
            // Fallback to single message if no result
            return this.reduceSingleMessage(group);
        }
        const duration = group.endTime - group.startTime;
        const toolUseEntry = toolPair.toolUse.logEntry;
        const toolResultEntry = toolPair.toolResult.logEntry;
        if (process.env.CCPRETTY_DEBUG) {
            console.error(`[MessageReducer] Tool pair duration: ${duration}ms`);
        }
        // Extract tool information
        const toolUse = toolUseEntry.message.content.find((c) => c.type === 'tool_use');
        const toolResult = toolResultEntry.message.content.find((c) => c.type === 'tool_result');
        const isError = toolResult?.is_error || false;
        const status = isError ? 'failed' : 'completed';
        // Create a synthetic message that represents the tool execution
        const syntheticMessage = {
            type: 'assistant',
            message: {
                id: toolUseEntry.id || 'synthetic-' + Date.now(),
                type: 'message',
                role: 'assistant',
                model: toolUseEntry.model || 'unknown',
                content: [
                    {
                        type: 'tool_use',
                        id: toolUse.id,
                        name: toolPair.toolName,
                        input: toolUse.input
                    }
                ],
                stop_reason: 'tool_use',
                stop_sequence: null,
                usage: toolUseEntry.usage || { input_tokens: 0, output_tokens: 0 },
                ttftMs: 0
            },
            session_id: toolUseEntry.session_id || ''
        };
        // Add toolResult as additional metadata
        syntheticMessage.toolResult = toolResult;
        const reduced = {
            message: syntheticMessage,
            metadata: {
                type: (isError ? 'tool_failed' : 'tool_complete'),
                originalCount: 2,
                duration,
                toolName: toolPair.toolName,
                toolStatus: status,
                toolResult: toolResult?.content
            }
        };
        return this.addCompatibilityProperties(reduced);
    }
    /**
     * Reduce a single message
     */
    reduceSingleMessage(group) {
        const message = group.messages[0];
        const logEntry = message.logEntry;
        // Check if this is an interrupted tool
        if ((0, models_1.isAssistantResponse)(logEntry)) {
            const assistantContent = logEntry.message?.content || [];
            const toolUse = assistantContent.find((c) => c.type === 'tool_use');
            if (toolUse) {
                // This is an interrupted tool
                const reduced = {
                    message: logEntry,
                    metadata: {
                        type: 'tool_interrupted',
                        originalCount: 1,
                        toolName: toolUse.name,
                        toolStatus: 'interrupted'
                    }
                };
                return this.addCompatibilityProperties(reduced);
            }
        }
        const reduced = {
            message: logEntry,
            metadata: {
                type: 'single',
                originalCount: 1
            }
        };
        return this.addCompatibilityProperties(reduced);
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
     * Add compatibility properties for backwards compatibility with tests
     */
    addCompatibilityProperties(reduced) {
        // Set type for compatibility
        reduced.type = reduced.metadata.type;
        // Generate content for compatibility
        if (reduced.metadata.type === 'tool_complete') {
            reduced.content = `✅ Tool: ${reduced.metadata.toolName} - COMPLETED`;
        }
        else if (reduced.metadata.type === 'tool_failed') {
            reduced.content = `❌ Tool: ${reduced.metadata.toolName} - FAILED`;
        }
        else if (reduced.metadata.type === 'tool_interrupted') {
            reduced.content = `⚠️ Tool: ${reduced.metadata.toolName} - INTERRUPTED`;
        }
        else {
            // For single messages, try to extract content from the message
            const message = reduced.message;
            if (message.message?.content) {
                const textContent = message.message.content.find((c) => c.type === 'text');
                if (textContent) {
                    reduced.content = textContent.text;
                }
            }
        }
        return reduced;
    }
    /**
     * Generate a hash for deduplication
     */
    generateHash(message) {
        // Simple hash based on message type and content
        return `${message.type}:${JSON.stringify(message)}`;
    }
    /**
     * Check if message should be included (deduplication)
     */
    shouldInclude(reduced) {
        const hash = this.generateHash(reduced.message);
        // Skip if identical to last message
        if (hash === this.lastMessageHash) {
            return false;
        }
        this.lastMessageHash = hash;
        return true;
    }
    /**
     * Reset deduplication state
     */
    reset() {
        this.lastMessageHash = '';
    }
}
exports.MessageReducer = MessageReducer;
