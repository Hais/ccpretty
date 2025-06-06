"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.InputParser = void 0;
const extract_json_js_1 = require("@axync/extract-json/dist/internal/extract-json.js");
class InputParser {
    constructor() {
        this.buffer = '';
        this.braceCount = 0;
        this.currentJsonStart = -1;
    }
    /**
     * Parse a line of input and extract any complete JSON objects
     */
    parseLine(line) {
        const messages = [];
        // Add line to buffer with newline (preserve original formatting)
        this.buffer += line + '\n';
        // Track brace counting to detect complete JSON objects
        for (let i = 0; i < line.length; i++) {
            const char = line[i];
            if (char === '{') {
                if (this.braceCount === 0) {
                    // Mark the start of a new JSON object in the buffer
                    this.currentJsonStart = this.buffer.length - line.length - 1 + i;
                }
                this.braceCount++;
            }
            else if (char === '}') {
                this.braceCount--;
                if (this.braceCount === 0 && this.currentJsonStart !== -1) {
                    // We have a complete JSON object
                    const jsonString = this.buffer.substring(this.currentJsonStart);
                    try {
                        const extracted = (0, extract_json_js_1.extractJsonSync)(jsonString);
                        if (extracted.length > 0) {
                            const parsed = extracted[0];
                            if (this.isValidMessage(parsed)) {
                                messages.push(parsed);
                            }
                        }
                    }
                    catch (e) {
                        // Ignore parsing errors
                    }
                    // Clear the processed part of the buffer
                    this.buffer = this.buffer.substring(this.buffer.length - line.length - 1 + i + 1);
                    this.currentJsonStart = -1;
                }
            }
        }
        return messages;
    }
    /**
     * Validate that an object is a valid Message
     */
    isValidMessage(obj) {
        return obj &&
            typeof obj === 'object' &&
            'type' in obj &&
            ['assistant', 'user', 'system', 'result'].includes(obj.type);
    }
    /**
     * Reset the parser state
     */
    reset() {
        this.buffer = '';
        this.braceCount = 0;
        this.currentJsonStart = -1;
    }
}
exports.InputParser = InputParser;
