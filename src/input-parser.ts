import { extractJsonSync } from '@axync/extract-json/dist/internal/extract-json.js';
import { Message } from './models';

export class InputParser {
    private buffer = '';
    private braceCount = 0;
    private currentJsonStart = -1;
    
    /**
     * Parse a line of input and extract any complete JSON objects
     */
    parseLine(line: string): Message[] {
        const messages: Message[] = [];
        
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
            } else if (char === '}') {
                this.braceCount--;
                if (this.braceCount === 0 && this.currentJsonStart !== -1) {
                    // We have a complete JSON object
                    const jsonString = this.buffer.substring(this.currentJsonStart);
                    
                    try {
                        const extracted = extractJsonSync(jsonString);
                        if (extracted.length > 0) {
                            const parsed = extracted[0];
                            if (this.isValidMessage(parsed)) {
                                messages.push(parsed as Message);
                            }
                        }
                    } catch (e) {
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
    private isValidMessage(obj: any): boolean {
        return obj && 
               typeof obj === 'object' && 
               'type' in obj &&
               ['assistant', 'user', 'system', 'result'].includes(obj.type);
    }
    
    /**
     * Reset the parser state
     */
    reset(): void {
        this.buffer = '';
        this.braceCount = 0;
        this.currentJsonStart = -1;
    }
}