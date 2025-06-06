"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.isSignificantEvent = isSignificantEvent;
exports.getMessageType = getMessageType;
exports.extractAssistantContent = extractAssistantContent;
exports.createSlackMessage = createSlackMessage;
exports.createSlackBlocks = createSlackBlocks;
const models_1 = require("./models");
const formatters_1 = require("./formatters");
// Check if an event is significant enough to post to Slack
function isSignificantEvent(data) {
    try {
        // System init messages (session start)
        if ((0, models_1.isSystemResponse)(data) && (0, models_1.isSystemInitMessage)(data)) {
            return true;
        }
        // Result messages (task completion/failure)
        if (data.type === 'result') {
            return true;
        }
        // Assistant messages with text content (no tool use)
        if ((0, models_1.isAssistantResponse)(data) && data.message?.type === 'message') {
            const content = data.message.content;
            if (!Array.isArray(content))
                return false;
            const hasText = content.some(c => (0, models_1.isTextContent)(c));
            const hasToolUse = content.some(c => (0, models_1.isToolUseContent)(c));
            // Include text-only messages OR tool use messages
            return hasText || hasToolUse;
        }
        // User messages with tool results
        if ((0, models_1.isUserResponse)(data) && data.message?.content) {
            const content = data.message.content;
            if (!Array.isArray(content))
                return false;
            return content.some(c => (0, models_1.isToolResultContent)(c));
        }
        return false;
    }
    catch (error) {
        // If anything goes wrong, just return false
        return false;
    }
}
// Get the type of message for grouping purposes
function getMessageType(data) {
    try {
        if ((0, models_1.isSystemResponse)(data) && (0, models_1.isSystemInitMessage)(data)) {
            return 'system_init';
        }
        if (data.type === 'result') {
            return 'result';
        }
        if ((0, models_1.isAssistantResponse)(data) && data.message?.content) {
            const content = data.message.content;
            if (Array.isArray(content)) {
                const hasToolUse = content.some(c => (0, models_1.isToolUseContent)(c));
                return hasToolUse ? 'tool_use' : 'assistant';
            }
        }
        if ((0, models_1.isUserResponse)(data)) {
            return 'tool_result';
        }
        return 'unknown';
    }
    catch (error) {
        return 'unknown';
    }
}
// Extract assistant message content without formatting
function extractAssistantContent(data) {
    try {
        if ((0, models_1.isAssistantResponse)(data) && data.message?.content && Array.isArray(data.message.content)) {
            const textContent = data.message.content.filter(c => (0, models_1.isTextContent)(c));
            if (textContent.length > 0) {
                const message = textContent.map((c) => c.text || '').join('\n\n');
                // Truncate long messages
                return message.length > 500 ? message.substring(0, 497) + '...' : message;
            }
        }
        return '';
    }
    catch (error) {
        return '';
    }
}
// Create a simplified message for Slack (fallback)
function createSlackMessage(data) {
    if ((0, models_1.isSystemResponse)(data) && (0, models_1.isSystemInitMessage)(data)) {
        // Check for custom environment variables
        const customTitle = process.env.CCPRETTY_TITLE;
        const customDescription = process.env.CCPRETTY_DESCRIPTION;
        const customUrl = process.env.CCPRETTY_URL;
        if (customTitle || customDescription || customUrl) {
            let message = '';
            if (customTitle) {
                message += `🚀 *${customTitle}*`;
            }
            if (customDescription) {
                message += `\n${customDescription}`;
            }
            if (customUrl) {
                message += `\nURL: ${customUrl}`;
            }
            message += `\nSession ID: \`${data.session_id}\``;
            return message;
        }
        else {
            return `🚀 *Claude Code Session Started*\nSession ID: \`${data.session_id}\``;
        }
    }
    if (data.type === 'result') {
        const isSuccess = data.subtype === 'success' && !data.is_error;
        const icon = isSuccess ? '✅' : '❌';
        const status = isSuccess ? 'Completed' : 'Failed';
        return `${icon} *Task ${status}*\nDuration: ${(data.duration_ms / 1000).toFixed(2)}s | Cost: $${data.cost_usd.toFixed(4)} USD`;
    }
    if ((0, models_1.isAssistantResponse)(data)) {
        const content = data.message.content;
        const toolUses = content.filter(c => (0, models_1.isToolUseContent)(c));
        const textContent = content.filter(c => (0, models_1.isTextContent)(c));
        // Handle tool use messages
        if (toolUses.length > 0) {
            const toolMessages = toolUses.map((tool) => {
                // Special formatting for TodoWrite
                if (tool.name === 'TodoWrite' && tool.input.todos) {
                    let msg = `📝 *Todo List Update*\n`;
                    // Group todos by status
                    const pendingTodos = tool.input.todos.filter((t) => t.status === 'pending');
                    const inProgressTodos = tool.input.todos.filter((t) => t.status === 'in_progress');
                    const completedTodos = tool.input.todos.filter((t) => t.status === 'completed');
                    if (pendingTodos.length > 0) {
                        msg += `\n*⏳ Pending:*\n`;
                        msg += pendingTodos.map((todo) => {
                            const priorityEmoji = todo.priority === 'high' ? '🔴' :
                                todo.priority === 'medium' ? '🟡' : '🟢';
                            return `${priorityEmoji} ${todo.content}`;
                        }).join('\n');
                    }
                    if (inProgressTodos.length > 0) {
                        msg += `\n\n*🔄 In Progress:*\n`;
                        msg += inProgressTodos.map((todo) => {
                            const priorityEmoji = todo.priority === 'high' ? '🔴' :
                                todo.priority === 'medium' ? '🟡' : '🟢';
                            return `${priorityEmoji} ${todo.content}`;
                        }).join('\n');
                    }
                    if (completedTodos.length > 0) {
                        msg += `\n\n*✅ Completed:*\n`;
                        msg += completedTodos.map((todo) => `~${todo.content}~`).join('\n');
                    }
                    msg += `\n\n📊 *Summary:* ${completedTodos.length}/${tool.input.todos.length} completed`;
                    return msg;
                }
                // Standard tool formatting
                let msg = `🔧 *${tool.name}*`;
                // Add file path for file-related tools
                if (tool.input.file_path) {
                    const trimmedPath = (0, formatters_1.trimFilePath)(tool.input.file_path);
                    msg += `\nFile: \`${trimmedPath}\``;
                }
                if (tool.input.command) {
                    msg += `\nCommand: \`${tool.input.command}\``;
                }
                if (tool.input.description) {
                    msg += `\nDescription: ${tool.input.description}`;
                }
                // Add other relevant parameters
                if (tool.input.pattern) {
                    msg += `\nPattern: \`${tool.input.pattern}\``;
                }
                if (tool.input.limit && typeof tool.input.limit === 'number') {
                    msg += `\nLimit: ${tool.input.limit} lines`;
                }
                if (tool.input.offset && typeof tool.input.offset === 'number') {
                    msg += `\nOffset: ${tool.input.offset}`;
                }
                msg += `\n🟡 *Running...*`;
                return msg;
            });
            return toolMessages.join('\n\n');
        }
        // Handle text content from assistant messages
        if (textContent.length > 0) {
            // Combine all text content
            const message = textContent.map((c) => c.text).join('\n\n');
            // Truncate long messages for Slack
            const truncated = message.length > 500 ? message.substring(0, 497) + '...' : message;
            return `💬 *Assistant:*\n${truncated}`;
        }
    }
    return 'Event processed';
}
// Create Slack blocks for better formatting
function createSlackBlocks(data) {
    if ((0, models_1.isSystemResponse)(data) && (0, models_1.isSystemInitMessage)(data)) {
        // Check for custom environment variables
        const customTitle = process.env.CCPRETTY_TITLE;
        const customDescription = process.env.CCPRETTY_DESCRIPTION;
        const customUrl = process.env.CCPRETTY_URL;
        const blocks = [];
        // Header
        blocks.push({
            type: "header",
            text: {
                type: "plain_text",
                text: customTitle ? `🚀 ${customTitle}` : "🚀 Claude Code Session Started"
            }
        });
        // Section with fields
        const fields = [];
        // Add session ID field
        fields.push({
            type: "mrkdwn",
            text: `*Session ID:*\n\`${data.session_id}\``
        });
        // Add custom fields if present
        if (customDescription) {
            fields.push({
                type: "mrkdwn",
                text: `*Description:*\n${customDescription}`
            });
        }
        if (customUrl) {
            fields.push({
                type: "mrkdwn",
                text: `*URL:*\n${customUrl}`
            });
        }
        blocks.push({
            type: "section",
            fields: fields
        });
        return blocks;
    }
    if (data.type === 'result') {
        const isSuccess = data.subtype === 'success' && !data.is_error;
        const icon = isSuccess ? '✅' : '❌';
        const status = isSuccess ? 'Completed' : 'Failed';
        return [
            {
                type: "header",
                text: {
                    type: "plain_text",
                    text: `${icon} Task ${status}`
                }
            },
            {
                type: "section",
                fields: [
                    {
                        type: "mrkdwn",
                        text: `*Duration:*\n${(data.duration_ms / 1000).toFixed(2)}s`
                    },
                    {
                        type: "mrkdwn",
                        text: `*Cost:*\n$${data.cost_usd.toFixed(4)} USD`
                    },
                    {
                        type: "mrkdwn",
                        text: `*Turns:*\n${data.num_turns}`
                    },
                    {
                        type: "mrkdwn",
                        text: `*API Time:*\n${(data.duration_api_ms / 1000).toFixed(2)}s`
                    }
                ]
            }
        ];
    }
    if ((0, models_1.isAssistantResponse)(data)) {
        const content = data.message.content;
        const toolUses = content.filter(c => (0, models_1.isToolUseContent)(c));
        const textContent = content.filter(c => (0, models_1.isTextContent)(c));
        // Handle tool use messages
        if (toolUses.length > 0) {
            const blocks = [];
            toolUses.forEach((tool) => {
                // Special formatting for TodoWrite
                if (tool.name === 'TodoWrite' && tool.input.todos) {
                    blocks.push({
                        type: "header",
                        text: {
                            type: "plain_text",
                            text: "📝 Todo List Update",
                            emoji: true
                        }
                    });
                    // Group todos by status
                    const pendingTodos = tool.input.todos.filter((t) => t.status === 'pending');
                    const inProgressTodos = tool.input.todos.filter((t) => t.status === 'in_progress');
                    const completedTodos = tool.input.todos.filter((t) => t.status === 'completed');
                    // Add pending todos
                    if (pendingTodos.length > 0) {
                        blocks.push({
                            type: "section",
                            text: {
                                type: "mrkdwn",
                                text: "*⏳ Pending:*"
                            }
                        });
                        const pendingText = pendingTodos.map((todo) => {
                            const priorityEmoji = todo.priority === 'high' ? '🔴' :
                                todo.priority === 'medium' ? '🟡' : '🟢';
                            return `${priorityEmoji} ${todo.content}`;
                        }).join('\n');
                        blocks.push({
                            type: "section",
                            text: {
                                type: "mrkdwn",
                                text: pendingText
                            }
                        });
                    }
                    // Add in-progress todos
                    if (inProgressTodos.length > 0) {
                        blocks.push({
                            type: "section",
                            text: {
                                type: "mrkdwn",
                                text: "*🔄 In Progress:*"
                            }
                        });
                        const inProgressText = inProgressTodos.map((todo) => {
                            const priorityEmoji = todo.priority === 'high' ? '🔴' :
                                todo.priority === 'medium' ? '🟡' : '🟢';
                            return `${priorityEmoji} ${todo.content}`;
                        }).join('\n');
                        blocks.push({
                            type: "section",
                            text: {
                                type: "mrkdwn",
                                text: inProgressText
                            }
                        });
                    }
                    // Add completed todos
                    if (completedTodos.length > 0) {
                        blocks.push({
                            type: "section",
                            text: {
                                type: "mrkdwn",
                                text: "*✅ Completed:*"
                            }
                        });
                        const completedText = completedTodos.map((todo) => {
                            return `~${todo.content}~`;
                        }).join('\n');
                        blocks.push({
                            type: "section",
                            text: {
                                type: "mrkdwn",
                                text: completedText
                            }
                        });
                    }
                    // Add divider
                    blocks.push({
                        type: "divider"
                    });
                    // Add summary context
                    blocks.push({
                        type: "context",
                        elements: [
                            {
                                type: "mrkdwn",
                                text: `📊 *Summary:* ${completedTodos.length}/${tool.input.todos.length} completed`
                            }
                        ]
                    });
                }
                else {
                    // Standard tool formatting
                    blocks.push({
                        type: "header",
                        text: {
                            type: "plain_text",
                            text: `🔧 ${tool.name}`
                        }
                    });
                    const fields = [];
                    // Add file path for file-related tools
                    if (tool.input.file_path) {
                        const trimmedPath = (0, formatters_1.trimFilePath)(tool.input.file_path);
                        fields.push({
                            type: "mrkdwn",
                            text: `*File:*\n\`${trimmedPath}\``
                        });
                    }
                    if (tool.input.command) {
                        fields.push({
                            type: "mrkdwn",
                            text: `*Command:*\n\`${tool.input.command}\``
                        });
                    }
                    if (tool.input.description) {
                        fields.push({
                            type: "mrkdwn",
                            text: `*Description:*\n${tool.input.description}`
                        });
                    }
                    // Add other relevant parameters
                    if (tool.input.pattern) {
                        fields.push({
                            type: "mrkdwn",
                            text: `*Pattern:*\n\`${tool.input.pattern}\``
                        });
                    }
                    if (tool.input.limit && typeof tool.input.limit === 'number') {
                        fields.push({
                            type: "mrkdwn",
                            text: `*Limit:*\n${tool.input.limit} lines`
                        });
                    }
                    if (fields.length > 0) {
                        blocks.push({
                            type: "section",
                            fields: fields
                        });
                    }
                    // Add status indicator
                    blocks.push({
                        type: "context",
                        elements: [
                            {
                                type: "mrkdwn",
                                text: "🟡 *Running...*"
                            }
                        ]
                    });
                }
            });
            return blocks;
        }
        // Handle text content from assistant messages
        if (textContent.length > 0) {
            // Combine all text content
            const message = textContent.map((c) => c.text).join('\n\n');
            // Truncate long messages for Slack (blocks have a 3000 char limit)
            const truncated = message.length > 2800 ? message.substring(0, 2797) + '...' : message;
            return [
                {
                    type: "section",
                    text: {
                        type: "mrkdwn",
                        text: `💬 *Assistant:*\n${truncated}`
                    }
                }
            ];
        }
    }
    // Handle tool results
    if ((0, models_1.isUserResponse)(data)) {
        const toolResults = data.message.content.filter(c => (0, models_1.isToolResultContent)(c));
        if (toolResults.length > 0) {
            // This will be handled by updating existing tool_use messages
            return [];
        }
    }
    return [
        {
            type: "section",
            text: {
                type: "plain_text",
                text: "Event processed"
            }
        }
    ];
}
