"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.isTextContent = isTextContent;
exports.isToolUseContent = isToolUseContent;
exports.isToolResultContent = isToolResultContent;
exports.isAssistantResponse = isAssistantResponse;
exports.isUserResponse = isUserResponse;
exports.isSystemResponse = isSystemResponse;
exports.isSystemInitMessage = isSystemInitMessage;
// Type guards
function isTextContent(content) {
    return content.type === 'text';
}
function isToolUseContent(content) {
    return content.type === 'tool_use';
}
function isToolResultContent(content) {
    return content.type === 'tool_result';
}
function isAssistantResponse(response) {
    return response?.type === 'assistant' && response?.message?.role === 'assistant';
}
function isUserResponse(response) {
    return response?.type === 'user' && response?.message?.role === 'user';
}
function isSystemResponse(response) {
    return response?.type === 'system';
}
function isSystemInitMessage(response) {
    return response?.type === 'system' && response?.subtype === 'init';
}
